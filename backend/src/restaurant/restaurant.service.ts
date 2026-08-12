import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { WalletService } from '../wallet/wallet.service';
import { AiUsageService } from '../common/ai-usage.service';
import { GeminiVisionProvider } from '../vision-analysis/providers/gemini.vision.provider';
import {
  MAX_PRICE_VARIANTS,
  parsePriceVariants,
  PriceVariant,
  parseBusinessHours,
  BusinessHoursRow,
} from '../common/restaurant-delivery';

const VALID_UNITS = ['gm', 'kg', 'pcs', 'ml', 'liter'];

export interface MenuDish {
  name: string;
  category: string | null;
  description: string | null;
  variants: { label: string; price: number; pieces: number | null }[];
  ingredients?: { name: string; qty: number; unit: string }[];
}

@Injectable()
export class RestaurantService {
  private readonly logger = new Logger(RestaurantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
    private readonly walletService: WalletService,
    private readonly aiUsage: AiUsageService,
    private readonly geminiVision: GeminiVisionProvider,
  ) {}

  // ── Ingredients ─────────────────────────────────────────────────────────────

  async listIngredients(pageId: number) {
    const items = await this.prisma.ingredient.findMany({
      where: { pageId },
      orderBy: { name: 'asc' },
    });
    return items.map((i) => ({ ...i, low: i.stockQty <= i.minStock }));
  }

  private sanitizeIngredient(body: any) {
    const out: any = {};
    if ('name' in body) {
      const name = String(body.name ?? '').trim();
      if (!name) throw new BadRequestException('Ingredient-এর নাম দিন');
      out.name = name.slice(0, 80);
    }
    if ('unit' in body) {
      const unit = String(body.unit ?? 'pcs')
        .trim()
        .toLowerCase();
      if (!VALID_UNITS.includes(unit))
        throw new BadRequestException(
          `Unit হতে হবে: ${VALID_UNITS.join(', ')}`,
        );
      out.unit = unit;
    }
    if ('stockQty' in body) {
      const v = Number(body.stockQty);
      if (!Number.isFinite(v))
        throw new BadRequestException('Stock সংখ্যা দিন');
      out.stockQty = v;
    }
    if ('minStock' in body) {
      const v = Number(body.minStock);
      if (!Number.isFinite(v) || v < 0)
        throw new BadRequestException('Minimum stock সঠিক নয়');
      out.minStock = v;
    }
    if ('costPerUnit' in body) {
      const v = Number(body.costPerUnit);
      if (!Number.isFinite(v) || v < 0)
        throw new BadRequestException('Cost per unit সঠিক নয়');
      out.costPerUnit = v;
    }
    if ('isActive' in body) out.isActive = Boolean(body.isActive);
    return out;
  }

  async createIngredient(pageId: number, body: any) {
    const data = this.sanitizeIngredient(body);
    if (!data.name) throw new BadRequestException('Ingredient-এর নাম দিন');
    try {
      return await this.prisma.ingredient.create({
        data: { pageId, unit: 'pcs', ...data },
      });
    } catch (err: any) {
      if (err?.code === 'P2002')
        throw new BadRequestException('এই নামে ingredient আগে থেকেই আছে');
      throw err;
    }
  }

  private async ensureIngredient(pageId: number, id: number) {
    const ing = await this.prisma.ingredient.findFirst({
      where: { id, pageId },
    });
    if (!ing) throw new NotFoundException('Ingredient not found');
    return ing;
  }

  async updateIngredient(pageId: number, id: number, body: any) {
    await this.ensureIngredient(pageId, id);
    const data = this.sanitizeIngredient(body);
    try {
      return await this.prisma.ingredient.update({ where: { id }, data });
    } catch (err: any) {
      if (err?.code === 'P2002')
        throw new BadRequestException('এই নামে ingredient আগে থেকেই আছে');
      throw err;
    }
  }

  async adjustIngredientStock(pageId: number, id: number, delta: number) {
    if (!Number.isFinite(delta) || delta === 0)
      throw new BadRequestException('Delta সংখ্যা দিন');
    await this.ensureIngredient(pageId, id);
    return this.prisma.ingredient.update({
      where: { id },
      data: { stockQty: { increment: delta } },
    });
  }

  async deleteIngredient(pageId: number, id: number) {
    await this.ensureIngredient(pageId, id);
    await this.prisma.ingredient.delete({ where: { id } }); // RecipeItems cascade
    return { ok: true };
  }

  // ── Recipes ─────────────────────────────────────────────────────────────────

  private async findProduct(pageId: number, code: string) {
    // findByCode resolves linked pages to their master (effectiveId) and
    // throws NotFoundException itself when the code doesn't exist.
    return this.productsService.findByCode(pageId, code) as Promise<any>;
  }

  async getRecipe(pageId: number, code: string) {
    const product = await this.findProduct(pageId, code);
    const items = await this.prisma.recipeItem.findMany({
      where: { productId: product.id },
      include: { ingredient: { select: { id: true, name: true, unit: true } } },
      orderBy: { id: 'asc' },
    });
    return { productCode: product.code, items };
  }

  /** Replace-all recipe rows for a product. */
  async setRecipe(
    pageId: number,
    code: string,
    rows: {
      ingredientId: number;
      qty: number;
      per?: string;
      variantLabel?: string | null;
    }[],
  ) {
    const product = await this.findProduct(pageId, code);
    if (!Array.isArray(rows))
      throw new BadRequestException('rows must be an array');
    if (rows.length > 40)
      throw new BadRequestException('সর্বোচ্চ ৪০টা recipe row');

    const variantLabels = new Set(
      parsePriceVariants(product.priceVariantsJson).map((v) => v.label),
    );
    const ingredientIds = [...new Set(rows.map((r) => Number(r.ingredientId)))];
    const owned = await this.prisma.ingredient.findMany({
      where: { id: { in: ingredientIds }, pageId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((i) => i.id));

    const clean = rows.map((r) => {
      const ingredientId = Number(r.ingredientId);
      const qty = Number(r.qty);
      const per = r.per === 'piece' ? 'piece' : 'item';
      const variantLabel = r.variantLabel
        ? String(r.variantLabel).trim()
        : null;
      if (!ownedIds.has(ingredientId))
        throw new BadRequestException('Invalid ingredient in recipe');
      if (!Number.isFinite(qty) || qty <= 0)
        throw new BadRequestException('Recipe-র পরিমাণ ০-এর বেশি হতে হবে');
      if (variantLabel && !variantLabels.has(variantLabel))
        throw new BadRequestException(
          `Variant "${variantLabel}" এই product-এ নেই`,
        );
      return { productId: product.id, ingredientId, qty, per, variantLabel };
    });

    await this.prisma.$transaction([
      this.prisma.recipeItem.deleteMany({ where: { productId: product.id } }),
      ...(clean.length
        ? [this.prisma.recipeItem.createMany({ data: clean })]
        : []),
    ]);
    return this.getRecipe(pageId, code);
  }

  // ── Per-order packaging ─────────────────────────────────────────────────────

  async getPackaging(pageId: number) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { orderPackagingJson: true },
    });
    let rows: { ingredientId: number; qty: number }[] = [];
    try {
      const raw = JSON.parse(page?.orderPackagingJson || '[]');
      if (Array.isArray(raw))
        rows = raw
          .map((r: any) => ({
            ingredientId: Number(r?.ingredientId),
            qty: Number(r?.qty),
          }))
          .filter(
            (r) =>
              Number.isFinite(r.ingredientId) &&
              Number.isFinite(r.qty) &&
              r.qty > 0,
          );
    } catch {
      rows = [];
    }
    // attach names for the UI
    const ings = rows.length
      ? await this.prisma.ingredient.findMany({
          where: { id: { in: rows.map((r) => r.ingredientId) }, pageId },
          select: { id: true, name: true, unit: true },
        })
      : [];
    const byId = new Map(ings.map((i) => [i.id, i]));
    return rows
      .filter((r) => byId.has(r.ingredientId))
      .map((r) => ({ ...r, ingredient: byId.get(r.ingredientId) }));
  }

  async setPackaging(
    pageId: number,
    rows: { ingredientId: number; qty: number }[],
  ) {
    if (!Array.isArray(rows))
      throw new BadRequestException('rows must be an array');
    if (rows.length > 10)
      throw new BadRequestException('সর্বোচ্চ ১০টা packaging row');
    const ids = [...new Set(rows.map((r) => Number(r.ingredientId)))];
    const owned = await this.prisma.ingredient.findMany({
      where: { id: { in: ids }, pageId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((i) => i.id));
    const clean = rows.map((r) => {
      const ingredientId = Number(r.ingredientId);
      const qty = Number(r.qty);
      if (!ownedIds.has(ingredientId))
        throw new BadRequestException('Invalid ingredient in packaging');
      if (!Number.isFinite(qty) || qty <= 0)
        throw new BadRequestException('Packaging-এর পরিমাণ ০-এর বেশি হতে হবে');
      return { ingredientId, qty };
    });
    await this.prisma.page.update({
      where: { id: pageId },
      data: { orderPackagingJson: clean.length ? JSON.stringify(clean) : null },
    });
    return this.getPackaging(pageId);
  }

  // ── Menu photo AI import ────────────────────────────────────────────────────

  async scanMenu(
    pageId: number,
    imageUrls: string[],
  ): Promise<{ dishes: MenuDish[] }> {
    if (!Array.isArray(imageUrls) || imageUrls.length === 0)
      throw new BadRequestException('Menu-র ছবি দিন');
    if (imageUrls.length > 5)
      throw new BadRequestException('একবারে সর্বোচ্চ ৫টা ছবি scan করা যাবে');
    // Only our own /storage/ uploads — never fetch arbitrary URLs on behalf of a client
    for (const u of imageUrls) {
      if (!/^(https?:\/\/[^/]+)?\/storage\/products\//.test(String(u)))
        throw new BadRequestException(
          'Invalid image URL — আগে ছবি upload করুন',
        );
    }

    const canProcess = await this.walletService.canProcessAi(pageId);
    if (!canProcess)
      throw new BadRequestException(
        'Wallet balance নেই — menu scan করতে balance যোগ করুন',
      );

    const { dishes, usage } =
      await this.geminiVision.extractMenuItems(imageUrls);

    // Keep the menu photos on the page — the bot sends them to customers who
    // ask what's available (latest scan wins).
    const relative = imageUrls.map((u) =>
      String(u).replace(/^https?:\/\/[^/]+/, ''),
    );
    void this.prisma.page
      .update({
        where: { id: pageId },
        data: { menuImagesJson: JSON.stringify(relative.slice(0, 5)) },
      })
      .catch(() => {});

    // Meter: one ADMIN_VISION deduction per image + token-level cost record
    for (let i = 0; i < imageUrls.length; i++) {
      void this.walletService.deductUsage(pageId, 'ADMIN_VISION', {
        provider: 'gemini',
      });
    }
    void this.aiUsage.record({
      pageId,
      provider: 'gemini',
      model: usage.model,
      usageType: 'MENU_IMPORT',
      promptTokens: usage.promptTokens,
      outputTokens: usage.outputTokens,
    });

    this.logger.log(
      `[Restaurant] Menu scan page=${pageId} imgs=${imageUrls.length} dishes=${dishes.length}`,
    );
    return { dishes };
  }

  // ── Menu photos shown/sent to customers ─────────────────────────────────────

  async getMenuImages(pageId: number): Promise<string[]> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { menuImagesJson: true },
    });
    try {
      const raw = JSON.parse(page?.menuImagesJson || '[]');
      return Array.isArray(raw) ? raw.filter((u) => typeof u === 'string') : [];
    } catch {
      return [];
    }
  }

  async setMenuImages(pageId: number, urls: string[]) {
    if (!Array.isArray(urls))
      throw new BadRequestException('urls must be an array');
    const clean = urls
      .map((u) => String(u).replace(/^https?:\/\/[^/]+/, ''))
      .filter((u) => /^\/storage\/products\//.test(u))
      .slice(0, 5);
    await this.prisma.page.update({
      where: { id: pageId },
      data: { menuImagesJson: clean.length ? JSON.stringify(clean) : null },
    });
    return clean;
  }

  // ── Business hours ────────────────────────────────────────────────────────

  async getHours(pageId: number): Promise<BusinessHoursRow[]> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { businessHoursJson: true },
    });
    if (!page?.businessHoursJson) return [];
    try {
      return parseBusinessHours(JSON.parse(page.businessHoursJson));
    } catch {
      return [];
    }
  }

  async setHours(pageId: number, rows: any[]) {
    if (!Array.isArray(rows))
      throw new BadRequestException('rows must be an array');
    const clean = parseBusinessHours(rows);
    await this.prisma.page.update({
      where: { id: pageId },
      data: { businessHoursJson: JSON.stringify(clean) },
    });
    return clean;
  }

  // ── Happy Hour window (same day/time shape as business hours) ──────────────

  async getHappyHourWindow(pageId: number): Promise<BusinessHoursRow[]> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { happyHourJson: true },
    });
    if (!page?.happyHourJson) return [];
    try {
      return parseBusinessHours(JSON.parse(page.happyHourJson));
    } catch {
      return [];
    }
  }

  async setHappyHourWindow(pageId: number, rows: any[]) {
    if (!Array.isArray(rows))
      throw new BadRequestException('rows must be an array');
    const clean = parseBusinessHours(rows);
    await this.prisma.page.update({
      where: { id: pageId },
      data: { happyHourJson: JSON.stringify(clean) },
    });
    return clean;
  }

  // ── Combo offers ────────────────────────────────────────────────────────────
  // A combo is its own Product (productType: "COMBO") so it shows in the menu
  // and orders like any dish; ComboItem rows list its component products.
  // trackStock is false on combos — real inventory comes from each
  // component's own recipe/BOM ingredients (see OrdersService.applyIngredientUsage).

  async listCombos(pageId: number) {
    return this.prisma.product.findMany({
      where: { pageId, productType: 'COMBO' },
      include: {
        comboItems: { include: { component: { select: { id: true, code: true, name: true, price: true } } } },
      },
      orderBy: { id: 'desc' },
    });
  }

  private async sanitizeComboItems(pageId: number, raw: any): Promise<{ componentProductId: number; qty: number }[]> {
    const items = Array.isArray(raw) ? raw : [];
    const clean = items
      .map((i: any) => ({
        componentProductId: Number(i?.componentProductId),
        qty: Math.max(1, Math.round(Number(i?.qty)) || 1),
      }))
      .filter((i: any) => Number.isFinite(i.componentProductId) && i.componentProductId > 0);
    if (clean.length < 2)
      throw new BadRequestException('কমপক্ষে ২টা item দিয়ে combo বানান');
    const ids = [...new Set(clean.map((i) => i.componentProductId))];
    const found = await this.prisma.product.findMany({
      where: { id: { in: ids }, pageId, productType: { not: 'COMBO' } },
      select: { id: true },
    });
    if (found.length !== ids.length)
      throw new BadRequestException('একটা বা একাধিক product খুঁজে পাওয়া যায়নি');
    return clean;
  }

  async createCombo(
    pageId: number,
    body: { name?: string; price?: number; imageUrl?: string; items?: any[] },
  ) {
    const name = String(body?.name || '').trim();
    if (!name) throw new BadRequestException('নাম দিন');
    const price = Number(body?.price);
    if (!Number.isFinite(price) || price < 0)
      throw new BadRequestException('সঠিক দাম দিন');
    const items = await this.sanitizeComboItems(pageId, body?.items);

    const code = `CB-${Date.now().toString().slice(-8)}`;
    return this.prisma.product.create({
      data: {
        pageId,
        code,
        name,
        price,
        productType: 'COMBO',
        trackStock: false,
        imageUrl: body?.imageUrl || null,
        comboItems: { create: items },
      },
      include: { comboItems: { include: { component: { select: { id: true, code: true, name: true } } } } },
    });
  }

  async updateCombo(
    pageId: number,
    code: string,
    body: { name?: string; price?: number; imageUrl?: string; items?: any[]; isActive?: boolean },
  ) {
    const combo = await this.prisma.product.findFirst({
      where: { pageId, code: code.toUpperCase(), productType: 'COMBO' },
    });
    if (!combo) throw new NotFoundException('Combo not found');

    const data: any = {};
    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new BadRequestException('নাম দিন');
      data.name = name;
    }
    if (body?.price !== undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0)
        throw new BadRequestException('সঠিক দাম দিন');
      data.price = price;
    }
    if (body?.imageUrl !== undefined) data.imageUrl = body.imageUrl || null;
    if (body?.isActive !== undefined) data.isActive = Boolean(body.isActive);

    if (body?.items !== undefined) {
      const items = await this.sanitizeComboItems(pageId, body.items);
      return this.prisma.$transaction(async (tx) => {
        if (Object.keys(data).length) {
          await tx.product.update({ where: { id: combo.id }, data });
        }
        await tx.comboItem.deleteMany({ where: { comboProductId: combo.id } });
        await tx.comboItem.createMany({
          data: items.map((i) => ({ comboProductId: combo.id, ...i })),
        });
        return tx.product.findUnique({
          where: { id: combo.id },
          include: { comboItems: { include: { component: { select: { id: true, code: true, name: true } } } } },
        });
      });
    }

    if (!Object.keys(data).length) return combo;
    return this.prisma.product.update({
      where: { id: combo.id },
      data,
      include: { comboItems: { include: { component: { select: { id: true, code: true, name: true } } } } },
    });
  }

  async deleteCombo(pageId: number, code: string) {
    const combo = await this.prisma.product.findFirst({
      where: { pageId, code: code.toUpperCase(), productType: 'COMBO' },
      select: { id: true },
    });
    if (!combo) throw new NotFoundException('Combo not found');
    await this.prisma.product.delete({ where: { id: combo.id } });
    return { success: true };
  }

  // ── Milestone Rewards ───────────────────────────────────────────────────────
  // "Every Nth order gets a reward" — merchant picks the interval (3, 5, 7...)
  // and a reward per interval (a specific free menu item, or free delivery).

  async listMilestones(pageId: number) {
    return this.prisma.milestoneReward.findMany({
      where: { pageId },
      include: { product: { select: { id: true, code: true, name: true } } },
      orderBy: { orderInterval: 'asc' },
    });
  }

  private sanitizeMilestoneInput(body: any) {
    const orderInterval = Math.round(Number(body?.orderInterval));
    if (!Number.isFinite(orderInterval) || orderInterval < 2 || orderInterval > 100)
      throw new BadRequestException('অর্ডার সংখ্যা ২-১০০ এর মধ্যে দিন');
    const rewardType =
      body?.rewardType === 'FREE_DELIVERY' ? 'FREE_DELIVERY'
      : body?.rewardType === 'DISCOUNT' ? 'DISCOUNT'
      : 'FREE_ITEM';
    const qty = Math.max(1, Math.round(Number(body?.qty)) || 1);
    const productId = rewardType === 'FREE_ITEM' ? Number(body?.productId) || null : null;
    if (rewardType === 'FREE_ITEM' && !productId)
      throw new BadRequestException('কোন item free দেবেন সেটা বেছে নিন');
    const discountPercent = rewardType === 'DISCOUNT' ? Number(body?.discountPercent) || null : null;
    if (rewardType === 'DISCOUNT' && (!discountPercent || discountPercent <= 0 || discountPercent > 100))
      throw new BadRequestException('ছাড়ের পরিমাণ ১-১০০% এর মধ্যে দিন');
    return { orderInterval, rewardType, qty, productId, discountPercent };
  }

  async createMilestone(pageId: number, body: any) {
    const clean = this.sanitizeMilestoneInput(body);
    if (clean.productId) {
      const product = await this.prisma.product.findFirst({
        where: { id: clean.productId, pageId },
        select: { id: true },
      });
      if (!product) throw new BadRequestException('Product খুঁজে পাওয়া যায়নি');
    }
    try {
      return await this.prisma.milestoneReward.create({
        data: { pageId, ...clean },
        include: { product: { select: { id: true, code: true, name: true } } },
      });
    } catch (e: any) {
      if (e?.code === 'P2002')
        throw new BadRequestException(`${clean.orderInterval} নম্বর অর্ডারের জন্য একটা reward আগে থেকেই আছে`);
      throw e;
    }
  }

  async updateMilestone(pageId: number, id: number, body: any) {
    const existing = await this.prisma.milestoneReward.findFirst({ where: { id, pageId } });
    if (!existing) throw new NotFoundException('Milestone not found');
    if (body?.isActive !== undefined && Object.keys(body).length === 1) {
      return this.prisma.milestoneReward.update({
        where: { id },
        data: { isActive: Boolean(body.isActive) },
        include: { product: { select: { id: true, code: true, name: true } } },
      });
    }
    const clean = this.sanitizeMilestoneInput(body);
    if (clean.productId) {
      const product = await this.prisma.product.findFirst({
        where: { id: clean.productId, pageId },
        select: { id: true },
      });
      if (!product) throw new BadRequestException('Product খুঁজে পাওয়া যায়নি');
    }
    try {
      return await this.prisma.milestoneReward.update({
        where: { id },
        data: clean,
        include: { product: { select: { id: true, code: true, name: true } } },
      });
    } catch (e: any) {
      if (e?.code === 'P2002')
        throw new BadRequestException(`${clean.orderInterval} নম্বর অর্ডারের জন্য একটা reward আগে থেকেই আছে`);
      throw e;
    }
  }

  async deleteMilestone(pageId: number, id: number) {
    const existing = await this.prisma.milestoneReward.findFirst({ where: { id, pageId } });
    if (!existing) throw new NotFoundException('Milestone not found');
    await this.prisma.milestoneReward.delete({ where: { id } });
    return { success: true };
  }

  // ── Bulk create from reviewed dishes ────────────────────────────────────────

  private validateVariants(raw: any): PriceVariant[] {
    const variants = (Array.isArray(raw) ? raw : [])
      .map((v: any) => {
        const pieces = Number(v?.pieces);
        return {
          label: String(v?.label ?? '').trim(),
          price: Number(v?.price),
          ...(Number.isFinite(pieces) && pieces > 0
            ? { pieces: Math.round(pieces) }
            : {}),
        };
      })
      .filter((v) => v.label && Number.isFinite(v.price) && v.price >= 0);
    if (!variants.length)
      throw new BadRequestException('প্রতিটা item-এ অন্তত একটা price দিন');
    if (variants.length > MAX_PRICE_VARIANTS)
      throw new BadRequestException(
        `সর্বোচ্চ ${MAX_PRICE_VARIANTS}টা size/price`,
      );
    const labels = new Set(variants.map((v) => v.label));
    if (labels.size !== variants.length)
      throw new BadRequestException('একই label-এর দুটো size দেওয়া যাবে না');
    return variants;
  }

  /**
   * Find-or-create ingredients by name (case-insensitive, per page) and wire
   * them as a starter recipe for a freshly created dish — so the merchant
   * opens the Recipe editor to a pre-filled, already-editable list instead of
   * an empty one. Best-effort: never throws (a bad suggestion shouldn't fail
   * the dish creation it's attached to).
   */
  private async applySuggestedRecipe(
    pageId: number,
    productId: number,
    ingredients: { name: string; qty: number; unit: string }[],
    ingredientCache: Map<string, number>,
  ) {
    if (!ingredients?.length) return;
    try {
      const rows: {
        productId: number;
        ingredientId: number;
        qty: number;
        per: string;
      }[] = [];
      for (const ing of ingredients) {
        const key = ing.name.toLowerCase();
        let ingredientId = ingredientCache.get(key);
        if (!ingredientId) {
          const existing = await this.prisma.ingredient.findFirst({
            where: { pageId, name: { equals: ing.name, mode: 'insensitive' } },
            select: { id: true },
          });
          if (existing) {
            ingredientId = existing.id;
          } else {
            const createdIng = await this.prisma.ingredient.create({
              data: {
                pageId,
                name: ing.name,
                unit: ing.unit,
                stockQty: 0,
                minStock: 0,
              },
            });
            ingredientId = createdIng.id;
          }
          ingredientCache.set(key, ingredientId);
        }
        rows.push({ productId, ingredientId, qty: ing.qty, per: 'item' });
      }
      if (rows.length) await this.prisma.recipeItem.createMany({ data: rows });
    } catch (err: any) {
      this.logger.warn(
        `[Restaurant] Suggested recipe skipped: ${err?.message}`,
      );
    }
  }

  async bulkCreateProducts(pageId: number, dishes: any[]) {
    if (!Array.isArray(dishes) || dishes.length === 0)
      throw new BadRequestException('কোনো item নেই');
    if (dishes.length > 100)
      throw new BadRequestException('একবারে সর্বোচ্চ ১০০টা item');

    const created: string[] = [];
    const failed: { name: string; reason: string }[] = [];
    const ingredientCache = new Map<string, number>();
    for (const d of dishes) {
      const name = String(d?.name ?? '').trim();
      try {
        if (!name) throw new BadRequestException('নাম নেই');
        const variants = this.validateVariants(d?.variants);
        const minPrice = Math.min(...variants.map((v) => v.price));
        // Single "Regular" variant with no pieces = plain single-price dish —
        // no need to force a size selection at checkout.
        const isSinglePlain = variants.length === 1 && !variants[0].pieces;
        // Optional per-dish photo uploaded during review — only our own
        // /storage/products/ uploads are accepted
        const rawImg = String(d?.imageUrl ?? '').trim();
        const imageUrl =
          rawImg && /^(https?:\/\/[^/]+)?\/storage\/products\//.test(rawImg)
            ? rawImg
            : undefined;
        const newProduct = await this.productsService.create({
          pageId,
          productType: 'SIMPLE',
          name,
          price: minPrice,
          description: d?.description
            ? String(d.description).trim()
            : undefined,
          category: d?.category ? String(d.category).trim() : null,
          unit: 'piece',
          imageUrl,
          priceVariantsJson: isSinglePlain ? null : JSON.stringify(variants),
          trackStock: false,
          catalogVisible: true,
        });
        const suggestedIngredients = (
          Array.isArray(d?.ingredients) ? d.ingredients : []
        )
          .map((i: any) => ({
            name: String(i?.name ?? '').trim(),
            qty: Number(i?.qty),
            unit: String(i?.unit ?? '').trim(),
          }))
          .filter((i: any) => i.name && Number.isFinite(i.qty) && i.qty > 0);
        await this.applySuggestedRecipe(
          pageId,
          newProduct.id,
          suggestedIngredients,
          ingredientCache,
        );
        created.push(name);
        // SIMPLE auto-codes use a ms timestamp suffix — space out so two
        // dishes created in the same millisecond can't collide.
        await new Promise((r) => setTimeout(r, 2));
      } catch (err: any) {
        failed.push({
          name: name || '(নামহীন)',
          reason: err?.message || 'error',
        });
      }
    }
    return { createdCount: created.length, created, failed };
  }

  // ── Food product update (panel edit form) ───────────────────────────────────

  async updateFoodProduct(pageId: number, code: string, body: any) {
    const patch: any = {};
    if ('name' in body) patch.name = String(body.name ?? '').trim();
    if ('description' in body)
      patch.description = String(body.description ?? '');
    if ('category' in body)
      patch.category = body.category ? String(body.category).trim() : null;
    if ('imageUrl' in body) patch.imageUrl = String(body.imageUrl ?? '');
    if ('isActive' in body) patch.isActive = Boolean(body.isActive);
    if ('isFeatured' in body) patch.isFeatured = Boolean(body.isFeatured);
    if ('catalogVisible' in body)
      patch.catalogVisible = Boolean(body.catalogVisible);
    if ('trackStock' in body) patch.trackStock = Boolean(body.trackStock);
    if ('referenceImagesJson' in body) {
      if (!body.referenceImagesJson) {
        patch.referenceImagesJson = null;
      } else {
        try {
          const arr = JSON.parse(body.referenceImagesJson);
          const clean = (Array.isArray(arr) ? arr : [])
            .map((u: any) => String(u).replace(/^https?:\/\/[^/]+/, ''))
            .filter((u: string) => /^\/storage\/products\//.test(u))
            .slice(0, 8);
          patch.referenceImagesJson = clean.length
            ? JSON.stringify(clean)
            : null;
        } catch {
          throw new BadRequestException('Invalid referenceImagesJson');
        }
      }
    }
    if ('price' in body) {
      const p = Number(body.price);
      if (!Number.isFinite(p) || p < 0)
        throw new BadRequestException('দাম সঠিক নয়');
      patch.price = p;
    }
    if ('priceVariants' in body) {
      if (
        body.priceVariants === null ||
        (Array.isArray(body.priceVariants) && body.priceVariants.length === 0)
      ) {
        patch.priceVariantsJson = null;
      } else {
        const variants = this.validateVariants(body.priceVariants);
        patch.priceVariantsJson = JSON.stringify(variants);
        // keep base price = min variant price so sorting/fallback stays sane
        patch.price = Math.min(...variants.map((v) => v.price));
      }
    }
    return this.productsService.updateOne(pageId, code, patch);
  }

  /** Distinct category values for the panel's category picker. */
  async listCategories(pageId: number) {
    const rows = await this.prisma.product.findMany({
      where: { pageId, isActive: true, category: { not: null } },
      select: { category: true },
      distinct: ['category'],
    });
    return rows.map((r) => r.category).filter(Boolean);
  }
}
