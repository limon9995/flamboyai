import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BotKnowledgeService } from '../bot-knowledge/bot-knowledge.service';
import { isRestaurantReady, parseSlabs } from '../common/restaurant-delivery';

export interface BusinessProduct {
  code: string;
  name: string;
  price: number;
  stockQty: number;
  category: string | null;
  productType?: string;
  unit?: string | null;
  orderEnabled?: boolean;
  // Full product info the bot reads to answer detailed customer questions
  description?: string | null;
  // "FREE" — bot always says delivery is free for this item, ignoring the
  // page's inside/outside Dhaka rate. "PAID" (default) — normal rate applies.
  deliveryCharge?: string;
  // V24: regular price the product is discounted from; only relevant when > price.
  originalPrice?: number | null;
  // V24: per-product pricing-policy override (JSON string) — see resolveEffectivePricingPolicy.
  pricingPolicyOverride?: string | null;
  // V25: size/portion pricing JSON [{label, price, pieces?}] — bot quotes
  // per-size prices ("5 pcs ৳120 / 10 pcs ৳220") when present.
  priceVariantsJson?: string | null;
  // V25: false = BOM-tracked food item, stockQty is meaningless
  trackStock?: boolean;
}

export interface DualProduct {
  name: string;
  code: string;
  price: number;
}

export interface BusinessContext {
  businessName: string | null;
  deliveryInsideFee: number;
  deliveryOutsideFee: number;
  // V24: Restaurant mode — when true, inside/outside Dhaka fees don't apply;
  // the bot quotes distance-slab rates and shares the website link instead
  restaurantMode: boolean;
  deliverySlabs: { maxKm: number; fee: number }[];
  deliveryTime: string;
  deliveryTimeInside: string;
  deliveryTimeOutside: string;
  products: BusinessProduct[];
  paymentRules: Record<string, any>;
  pricingPolicy: Record<string, any>;
  knowledgeText: string;
  behaviorInstructions: string;
  pricingInfo: string;
  dualPhotoMode: boolean;
  dualWearingProduct: DualProduct | null;
  dualHoldingProduct: DualProduct | null;
  // Conversation state — injected by webhook before calling AI
  lastBotReply?: string | null;
  lastPresentedProducts?: { code: string; name?: string; price?: number }[];
  // Page's bot agent type — used to resolve per-agent-type persona/tone overrides
  agentType?: string;
  // Per-page persona override — takes priority over the agentType-level persona
  customPersonaPrompt?: string;
}

@Injectable()
export class BotContextService {
  private readonly logger = new Logger(BotContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly botKnowledge: BotKnowledgeService,
  ) {}

  async buildBusinessContext(pageId: number): Promise<BusinessContext> {
    const [page, products, knowledgeConfig] = await Promise.all([
      this.prisma.page.findUnique({
        where: { id: pageId },
        select: {
          businessName: true,
          deliveryFeeInsideDhaka: true,
          deliveryFeeOutsideDhaka: true,
          deliveryTimeText: true,
          deliveryTimeInsideDhaka: true,
          deliveryTimeOutsideDhaka: true,
          knowledgeText: true,
          behaviorInstructions: true,
          customPersonaPrompt: true,
          dualPhotoMode: true,
          dualWearingProductId: true,
          dualHoldingProductId: true,
          restaurantModeEnabled: true,
          restaurantLat: true,
          restaurantLng: true,
          deliverySlabsJson: true,
        },
      }),
      this.prisma.product.findMany({
        where: { pageId, isActive: true },
        select: {
          code: true,
          name: true,
          price: true,
          stockQty: true,
          category: true,
          productType: true,
          unit: true,
          orderEnabled: true,
          description: true,
          deliveryCharge: true,
          originalPrice: true,
          pricingPolicyOverride: true,
          priceVariantsJson: true,
          trackStock: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.botKnowledge.getConfig(pageId).catch(() => null),
    ]);

    let dualWearingProduct: DualProduct | null = null;
    let dualHoldingProduct: DualProduct | null = null;

    if ((page as any)?.dualPhotoMode) {
      const wearingId = (page as any)?.dualWearingProductId;
      const holdingId = (page as any)?.dualHoldingProductId;
      const [wearing, holding] = await Promise.all([
        wearingId
          ? this.prisma.product.findUnique({
              where: { id: wearingId },
              select: { name: true, code: true, price: true },
            })
          : Promise.resolve(null),
        holdingId
          ? this.prisma.product.findUnique({
              where: { id: holdingId },
              select: { name: true, code: true, price: true },
            })
          : Promise.resolve(null),
      ]);
      dualWearingProduct = wearing
        ? {
            name: wearing.name ?? '',
            code: wearing.code,
            price: Number(wearing.price),
          }
        : null;
      dualHoldingProduct = holding
        ? {
            name: holding.name ?? '',
            code: holding.code,
            price: Number(holding.price),
          }
        : null;
    }

    return {
      businessName: page?.businessName ?? null,
      deliveryInsideFee: (page as any)?.deliveryFeeInsideDhaka ?? 80,
      deliveryOutsideFee: (page as any)?.deliveryFeeOutsideDhaka ?? 130,
      restaurantMode: isRestaurantReady(page as any),
      deliverySlabs: parseSlabs((page as any)?.deliverySlabsJson),
      deliveryTime: (page as any)?.deliveryTimeText ?? '',
      deliveryTimeInside: (page as any)?.deliveryTimeInsideDhaka ?? '',
      deliveryTimeOutside: (page as any)?.deliveryTimeOutsideDhaka ?? '',
      products: products as BusinessProduct[],
      paymentRules: (knowledgeConfig as any)?.paymentRules ?? {},
      pricingPolicy: (knowledgeConfig as any)?.pricingPolicy ?? {},
      knowledgeText: (page as any)?.knowledgeText ?? '',
      behaviorInstructions: (page as any)?.behaviorInstructions ?? '',
      pricingInfo: (knowledgeConfig as any)?.pricingInfo ?? '',
      agentType: (knowledgeConfig as any)?.agentType ?? 'commerce',
      customPersonaPrompt: (page as any)?.customPersonaPrompt ?? '',
      dualPhotoMode: Boolean((page as any)?.dualPhotoMode),
      dualWearingProduct,
      dualHoldingProduct,
    };
  }
}
