import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../crm/phone.util';
import { parseBusinessHours, isOpenNow } from '../common/restaurant-delivery';

export interface LoyaltyStatus {
  enabled: boolean;
  isLoyal: boolean;
  ordersSoFar: number;
  ordersNeeded: number;
  discountPercent: number;
  message: string;
}

export interface HappyHourStatus {
  active: boolean;
  discountPercent: number;
  label: string;
}

export interface MilestoneReward {
  interval: number;
  rewardType: 'FREE_ITEM' | 'FREE_DELIVERY' | 'DISCOUNT';
  productId?: number;
  productCode?: string;
  productName?: string;
  qty: number;
  discountPercent?: number;
}

export interface MilestonePreview {
  enabled: boolean;
  thisOrderNumber: number;
  rewards: MilestoneReward[];
  next: { interval: number; ordersAway: number; rewardType: string; productName?: string; discountPercent?: number } | null;
}

export interface DiscountResult {
  loyaltyDiscount: number;
  loyaltyMessage?: string;
  happyHourDiscount: number;
  happyHourLabel?: string;
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * How many non-cancelled orders this phone number has placed at this page
   * so far. `excludeOrderId` lets a caller that already created the order row
   * (before pricing runs, e.g. the manual/quick-order flow) avoid counting
   * that just-created order as one of its own "prior" orders.
   */
  private async countPriorOrders(
    pageId: number,
    phone: string,
    excludeOrderId?: number,
  ): Promise<number> {
    return this.prisma.order.count({
      where: {
        pageIdRef: pageId,
        phone,
        status: { not: 'CANCELLED' },
        ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
      },
    });
  }

  /** Real-time "how close is this phone number to a loyalty discount" check. */
  async getLoyaltyStatus(
    pageId: number,
    phone: string | null | undefined,
    excludeOrderId?: number,
  ): Promise<LoyaltyStatus> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { loyaltyEnabled: true, loyaltyThresholdOrders: true, loyaltyDiscountPercent: true },
    });
    const threshold = page?.loyaltyThresholdOrders;
    const percent = page?.loyaltyDiscountPercent;
    if (!page?.loyaltyEnabled || !threshold || !percent) {
      return { enabled: false, isLoyal: false, ordersSoFar: 0, ordersNeeded: 0, discountPercent: 0, message: '' };
    }

    const clean = normalizePhone(phone);
    const ordersSoFar = clean
      ? await this.countPriorOrders(pageId, clean, excludeOrderId)
      : 0;
    const isLoyal = ordersSoFar >= threshold;
    const ordersNeeded = Math.max(0, threshold - ordersSoFar);
    const message = isLoyal
      ? `🎉 আপনি Lucky Customer! এই অর্ডারে ${percent}% ছাড় পাচ্ছেন।`
      : `আরও ${ordersNeeded}টা অর্ডার করলে আপনি Lucky Customer হবেন — পরের অর্ডারে ${percent}% ছাড়!`;

    return { enabled: true, isLoyal, ordersSoFar, ordersNeeded, discountPercent: percent, message };
  }

  /** Whether the configured Happy Hour window is active right now (Asia/Dhaka). */
  async getHappyHourStatus(pageId: number, now: Date = new Date()): Promise<HappyHourStatus> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: {
        happyHourEnabled: true,
        happyHourJson: true,
        happyHourDiscountPercent: true,
        happyHourLabel: true,
      },
    });
    if (!page?.happyHourEnabled || !page.happyHourJson || !page.happyHourDiscountPercent) {
      return { active: false, discountPercent: 0, label: '' };
    }
    let windows: unknown;
    try {
      windows = JSON.parse(page.happyHourJson);
    } catch {
      return { active: false, discountPercent: 0, label: '' };
    }
    const active = isOpenNow(parseBusinessHours(windows), now);
    return {
      active,
      discountPercent: page.happyHourDiscountPercent,
      label: page.happyHourLabel || `🎉 Happy Hour চলছে! ${page.happyHourDiscountPercent}% ছাড়`,
    };
  }

  /** Computes both discounts for an order about to be created — called by all order-creation paths. */
  async computeDiscounts(
    pageId: number,
    phone: string | null | undefined,
    subtotal: number,
    now: Date = new Date(),
    excludeOrderId?: number,
  ): Promise<DiscountResult> {
    const [loyalty, happyHour] = await Promise.all([
      this.getLoyaltyStatus(pageId, phone, excludeOrderId),
      this.getHappyHourStatus(pageId, now),
    ]);
    const loyaltyDiscount = loyalty.isLoyal
      ? Math.round(subtotal * loyalty.discountPercent) / 100
      : 0;
    const happyHourDiscount = happyHour.active
      ? Math.round(subtotal * happyHour.discountPercent) / 100
      : 0;
    return {
      loyaltyDiscount,
      loyaltyMessage: loyalty.enabled ? loyalty.message : undefined,
      happyHourDiscount,
      happyHourLabel: happyHour.active ? happyHour.label : undefined,
    };
  }

  /** True if any of these product codes is a COMBO product for this page. */
  async isComboOrder(pageId: number, productCodes: string[]): Promise<boolean> {
    if (!productCodes.length) return false;
    const combo = await this.prisma.product.findFirst({
      where: { pageId, code: { in: productCodes }, productType: 'COMBO' },
      select: { id: true },
    });
    return Boolean(combo);
  }

  /**
   * Order-count-based recurring reward(s) — every Nth order gets a configured
   * free item or free delivery. If an order number satisfies more than one
   * configured interval (e.g. intervals 2 and 3 both hit on order 6), ALL
   * matching rewards apply — not just the first. Combo orders never receive
   * any milestone reward on the order that contains the combo, but they
   * still count toward the running order total.
   */
  async getMilestoneRewards(
    pageId: number,
    phone: string | null | undefined,
    isComboOrder: boolean,
    excludeOrderId?: number,
  ): Promise<{ thisOrderNumber: number; rewards: MilestoneReward[] }> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { milestoneRewardsEnabled: true },
    });
    if (!page?.milestoneRewardsEnabled) return { thisOrderNumber: 0, rewards: [] };

    const clean = normalizePhone(phone);
    if (!clean) return { thisOrderNumber: 0, rewards: [] };

    const priorCount = await this.countPriorOrders(pageId, clean, excludeOrderId);
    const thisOrderNumber = priorCount + 1;
    if (isComboOrder) return { thisOrderNumber, rewards: [] };

    const milestones = await this.prisma.milestoneReward.findMany({
      where: { pageId, isActive: true },
      include: { product: { select: { id: true, code: true, name: true } } },
    });
    const matches = milestones.filter(
      (m) =>
        m.orderInterval > 0 &&
        thisOrderNumber % m.orderInterval === 0 &&
        !(m.rewardType === 'FREE_ITEM' && !m.product) && // skip if reward product was deleted
        !(m.rewardType === 'DISCOUNT' && !m.discountPercent), // skip if misconfigured
    );

    return {
      thisOrderNumber,
      rewards: matches.map((m) => ({
        interval: m.orderInterval,
        rewardType: m.rewardType as 'FREE_ITEM' | 'FREE_DELIVERY' | 'DISCOUNT',
        productId: m.product?.id,
        productCode: m.product?.code,
        productName: m.product?.name ?? m.product?.code,
        qty: m.qty,
        discountPercent: m.discountPercent ?? undefined,
      })),
    };
  }

  /** Public preview (web checkout / bot phone-capture): what's coming up, without placing an order. */
  async getMilestonePreview(pageId: number, phone: string | null | undefined): Promise<MilestonePreview> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { milestoneRewardsEnabled: true },
    });
    if (!page?.milestoneRewardsEnabled) {
      return { enabled: false, thisOrderNumber: 0, rewards: [], next: null };
    }
    const clean = normalizePhone(phone);
    const priorCount = clean ? await this.countPriorOrders(pageId, clean) : 0;
    const thisOrderNumber = priorCount + 1;

    const milestones = await this.prisma.milestoneReward.findMany({
      where: { pageId, isActive: true },
      include: { product: { select: { id: true, code: true, name: true } } },
    });
    const hits = milestones.filter((m) => m.orderInterval > 0 && thisOrderNumber % m.orderInterval === 0);
    const rewards: MilestoneReward[] = hits.map((hit) => ({
      interval: hit.orderInterval,
      rewardType: hit.rewardType as 'FREE_ITEM' | 'FREE_DELIVERY' | 'DISCOUNT',
      productId: hit.product?.id,
      productCode: hit.product?.code,
      productName: hit.product?.name ?? hit.product?.code,
      qty: hit.qty,
      discountPercent: hit.discountPercent ?? undefined,
    }));

    let next: MilestonePreview['next'] = null;
    if (!rewards.length && milestones.length) {
      let best: { interval: number; ordersAway: number; rewardType: string; productName?: string; discountPercent?: number } | null = null;
      for (const m of milestones) {
        if (m.orderInterval <= 0) continue;
        const upcoming = Math.ceil(thisOrderNumber / m.orderInterval) * m.orderInterval;
        const ordersAway = upcoming - thisOrderNumber + 1;
        if (!best || ordersAway < best.ordersAway) {
          best = {
            interval: m.orderInterval,
            ordersAway,
            rewardType: m.rewardType,
            productName: m.product?.name ?? m.product?.code,
            discountPercent: m.discountPercent ?? undefined,
          };
        }
      }
      next = best;
    }

    return { enabled: true, thisOrderNumber, rewards, next };
  }

  /** Sums the % discount of every DISCOUNT-type milestone reward that hit, against subtotal. */
  computeMilestoneDiscount(rewards: MilestoneReward[], subtotal: number): number {
    return rewards
      .filter((r) => r.rewardType === 'DISCOUNT' && r.discountPercent)
      .reduce((sum, r) => sum + Math.round((subtotal * (r.discountPercent ?? 0)) / 100), 0);
  }
}
