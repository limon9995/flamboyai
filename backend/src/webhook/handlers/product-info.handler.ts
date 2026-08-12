import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MessengerService } from '../../messenger/messenger.service';
import { BotKnowledgeService } from '../../bot-knowledge/bot-knowledge.service';
import { BotIntentService } from '../../bot/bot-intent.service';
import { ConversationContextService } from '../../conversation-context/conversation-context.service';
import { ProductsService } from '../../products/products.service';
import { buildProductCardButtons } from '../../common/product-card-buttons';

function getFullImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const base = process.env.API_BASE_URL || 'https://api.flamboyai.com';
  return `${base.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** First reference/angle image URL, if any — used as a fallback when a product
 *  has no main Image URL set (e.g. photos were only pasted into Reference Images). */
function firstReferenceImage(referenceImagesJson?: string | null): string | undefined {
  if (!referenceImagesJson) return undefined;
  try {
    const arr = JSON.parse(referenceImagesJson);
    return Array.isArray(arr) ? arr.find((u) => typeof u === 'string' && u.trim()) : undefined;
  } catch {
    return undefined;
  }
}

@Injectable()
export class ProductInfoHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messenger: MessengerService,
    private readonly botKnowledge: BotKnowledgeService,
    private readonly botIntent: BotIntentService,
    private readonly ctx: ConversationContextService,
    private readonly products: ProductsService,
  ) {}

  async sendProductInfo(page: any, psid: string, code: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { pageId: page.id, code },
    });
    if (!product) {
      const reply = await this.botKnowledge.resolveSystemReply(
        page.id,
        'product_not_found',
        { productCode: code },
      );
      await this.messenger.sendText(page.pageToken, psid, reply);
      return;
    }
    await this.ctx.setLastPresentedProducts(page.id, psid, [product]);

    if (product.stockQty <= 0) {
      const reply = await this.botKnowledge.resolveSystemReply(
        page.id,
        'stock_out',
        { productCode: product.code },
      );
      await this.messenger.sendText(page.pageToken, psid, reply);
      return;
    }

    // Send generic template card
    const [withRefs] = await this.products.attachReferenceImagesList(page.id, [product]);
    const imageUrl = getFullImageUrl(product.imageUrl) || getFullImageUrl(firstReferenceImage(withRefs?.referenceImagesJson));
    const catalogBase = (page.catalogBaseUrl || '').replace(/\/$/, '') ||
      `https://api.flamboyai.com/catalog/${page.id}`;
    const productUrl = `${catalogBase}/product/${product.code}`;
    const sym = page.currencySymbol || '৳';

    await this.messenger.sendGenericTemplate(page.pageToken, psid, [
      {
        title: product.name || product.code,
        image_url: imageUrl,
        subtitle: `${sym}${Number(product.price).toLocaleString()} · Code: ${product.code}`,
        buttons: buildProductCardButtons(page, { code: product.code, productUrl }, [
          {
            type: 'web_url' as const,
            url: productUrl,
            title: '🛍 Details দেখুন',
          },
        ]),
      },
    ]);

    let msg = await this.botKnowledge.resolveSystemReply(
      page.id,
      'product_info',
      {
        productCode: product.code,
        productPrice: product.price,
        productStock: product.stockQty,
        productInfoNote: product.description || '',
      },
    );
    // Append catalog link as plain text (visible on Facebook Lite too)
    msg += `\n\n🔗 ${productUrl}`;
    if (page.orderModeOn) {
      const prompt = await this.botKnowledge.resolveSystemReply(
        page.id,
        'order_prompt',
      );
      if (prompt) msg += `\n\n${prompt}`;
    }
    await this.messenger.sendText(page.pageToken, psid, msg.trim());
  }

  async sendMultiProductPreview(
    page: any,
    psid: string,
    codes: string[],
  ): Promise<void> {
    const products = await this.prisma.product.findMany({
      where: { pageId: page.id, code: { in: codes } },
    });
    if (!products.length) return;

    const sym = page.currencySymbol || '৳';
    await this.ctx.setLastPresentedProducts(page.id, psid, products);

    // Send generic template carousel
    const productsWithRefs = await this.products.attachReferenceImagesList(page.id, products);
    const elements = productsWithRefs.map((p: any) => {
      const imageUrl = getFullImageUrl(p.imageUrl) || getFullImageUrl(firstReferenceImage(p.referenceImagesJson));
      const productUrl = `https://api.flamboyai.com/catalog/${page.id}/product/${p.code}`;
      return {
        title: p.name || p.code,
        image_url: imageUrl,
        subtitle: `${sym}${Number(p.price).toLocaleString()} · Code: ${p.code}${p.stockQty <= 0 ? ' (Stock Out)' : ''}`,
        buttons: buildProductCardButtons(page, { code: p.code, productUrl }, [
          {
            type: 'web_url' as const,
            url: productUrl,
            title: 'View product',
          },
        ]),
      };
    });

    await this.messenger.sendGenericTemplate(page.pageToken, psid, elements);

    await this.messenger.sendText(
      page.pageToken,
      psid,
      'সবগুলো order করতে চান? **confirm** / **cancel** লিখুন 💖',
    );
  }

  async getProductsByCodes(pageId: number, codes: string[]) {
    return this.prisma.product.findMany({
      where: { pageId, code: { in: codes } },
    });
  }

  /**
   * Sends vision match results as generic template cards (Messenger)
   * + plain text with links (Facebook Lite fallback).
   */
  async sendVisionMatchCards(
    page: any,
    psid: string,
    codes: string[],
    introText: string,
  ): Promise<void> {
    const products = await this.prisma.product.findMany({
      where: { pageId: page.id, code: { in: codes }, isActive: true },
    });
    if (!products.length) return;

    // Remember these as the products just discussed — without this, a later
    // "koto dam?" / negotiation message with no active draft and no literal
    // Messenger reply-quote has no way to know which product it refers to.
    await this.ctx.setLastPresentedProducts(page.id, psid, products);

    const sym = page.currencySymbol || '৳';
    const catalogBase = (page.catalogBaseUrl || '').replace(/\/$/, '') ||
      `https://api.flamboyai.com/catalog/${page.id}`;

    await this.messenger.sendText(page.pageToken, psid, introText);

    // Generic template cards for Messenger
    const productsWithRefs = await this.products.attachReferenceImagesList(page.id, products);
    const elements = productsWithRefs.map((p: any) => {
      const imageUrl = getFullImageUrl(p.imageUrl) || getFullImageUrl(firstReferenceImage(p.referenceImagesJson));
      const productUrl = `${catalogBase}/product/${p.code}`;
      return {
        title: p.name || p.code,
        image_url: imageUrl,
        subtitle: `${sym}${Number(p.price).toLocaleString()}${p.stockQty <= 0 ? ' · স্টক নেই' : ''}`,
        buttons: buildProductCardButtons(page, { code: p.code, productUrl }, [
          {
            type: 'postback' as const,
            title: '✅ এটা নিব',
            payload: `SELECT_PRODUCT:${p.code}`,
          },
          {
            type: 'web_url' as const,
            url: productUrl,
            title: '🔗 Details',
          },
        ]),
      };
    });

    await this.messenger.sendGenericTemplate(page.pageToken, psid, elements);

    // Plain text links for Facebook Lite users
    const linkLines = products
      .map((p: any) => `• ${p.name || p.code} — ${sym}${Number(p.price).toLocaleString()}\n  ${catalogBase}/product/${p.code}`)
      .join('\n');
    await this.messenger.sendText(
      page.pageToken,
      psid,
      `যেটা নিতে চান তার নিচের "✅ এটা নিব" button চাপুন অথবা product code লিখুন:\n\n${linkLines}`,
    );
  }
}
