import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption.service';

@Injectable()
export class PageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async getById(id: number) {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  async getBusinessSettings(id: number) {
    const page: any = await this.getById(id);
    return {
      pageId: page.id,
      pageName: page.pageName || '',
      businessName: page.businessName || page.pageName || '',
      businessPhone: page.businessPhone || page.phone || '',
      businessAddress: page.businessAddress || page.address || '',
      websiteUrl: page.websiteUrl || '',
      logoUrl: page.logoUrl || '',
      memoFooterText: page.memoFooterText || 'Thank you for your order',
      codLabel: page.codLabel || 'COD',
      currencySymbol: page.currencySymbol || '৳',
      primaryColor: page.primaryColor || '',
      deliveryFeeInsideDhaka: Number(page.deliveryFeeInsideDhaka ?? 0) || 0,
      deliveryFeeOutsideDhaka: Number(page.deliveryFeeOutsideDhaka ?? 0) || 0,
      deliveryTimeText: page.deliveryTimeText || '',
      deliveryTimeInsideDhaka: page.deliveryTimeInsideDhaka || '',
      deliveryTimeOutsideDhaka: page.deliveryTimeOutsideDhaka || '',
      paymentMode: page.paymentMode || 'cod',
      // V24: Restaurant mode — used by bot replies to swap Dhaka-zone fees
      // for distance-slab rates
      restaurantModeEnabled: Boolean(page.restaurantModeEnabled),
      restaurantLat: page.restaurantLat ?? null,
      restaurantLng: page.restaurantLng ?? null,
      deliverySlabsJson: page.deliverySlabsJson ?? null,
      advanceAmount: Number(page.advanceAmount ?? 0) || 0,
      codEnabled: page.codEnabled !== false,
      advanceThresholdAmount: Number(page.advanceThresholdAmount ?? 0) || 0,
      infoModeOn: Boolean(page.infoModeOn),
      orderModeOn: Boolean(page.orderModeOn),
      printModeOn: Boolean(page.printModeOn),
      memoSaveModeOn: Boolean(page.memoSaveModeOn),
      memoTemplateModeOn: Boolean(page.memoTemplateModeOn),
      autoMemoDesignModeOn: Boolean(page.autoMemoDesignModeOn),
      // SECURITY: pageToken is NEVER returned here
    };
  }

  async updateById(id: number, body: any) {
    const data: any = {};

    if (typeof body.pageId === 'string') data.pageId = body.pageId.trim();
    if (typeof body.pageName === 'string') data.pageName = body.pageName.trim();
    if (typeof body.verifyToken === 'string')
      data.verifyToken = body.verifyToken.trim();
    if (typeof body.phone === 'string') data.phone = body.phone.trim();
    if (typeof body.address === 'string') data.address = body.address.trim();

    // SECURITY: if pageToken is provided via updateById, encrypt it before saving
    if (typeof body.pageToken === 'string') {
      data.pageToken = this.encryption.encryptIfNeeded(body.pageToken.trim());
    }

    // WhatsApp Business API settings
    if (typeof body.waEnabled === 'boolean') data.waEnabled = body.waEnabled;
    if (typeof body.waPhoneNumberId === 'string')
      data.waPhoneNumberId = body.waPhoneNumberId.trim() || null;
    if (typeof body.waToken === 'string' && body.waToken.trim()) {
      data.waToken = this.encryption.encryptIfNeeded(body.waToken.trim());
    }
    if (typeof body.waVerifyToken === 'string')
      data.waVerifyToken = body.waVerifyToken.trim() || null;

    if (typeof body.igEnabled === 'boolean') data.igEnabled = body.igEnabled;
    if (typeof body.igBusinessAccountId === 'string')
      data.igBusinessAccountId = body.igBusinessAccountId.trim() || null;
    if (typeof body.igToken === 'string' && body.igToken.trim()) {
      data.igToken = this.encryption.encryptIfNeeded(body.igToken.trim());
    }
    if (typeof body.igVerifyToken === 'string')
      data.igVerifyToken = body.igVerifyToken.trim() || null;

    // Telegram merchant notifications
    if (typeof body.telegramNotifEnabled === 'boolean')
      data.telegramNotifEnabled = body.telegramNotifEnabled;
    if (typeof body.telegramChatId === 'string')
      data.telegramChatId = body.telegramChatId.trim() || null;
    if (
      typeof body.telegramBotToken === 'string' &&
      body.telegramBotToken.trim()
    ) {
      data.telegramBotToken = this.encryption.encryptIfNeeded(
        body.telegramBotToken.trim(),
      );
    }

    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
    if (typeof body.automationOn === 'boolean')
      data.automationOn = body.automationOn;
    if (typeof body.ocrOn === 'boolean') data.ocrOn = body.ocrOn;

    if (typeof body.infoModeOn === 'boolean') data.infoModeOn = body.infoModeOn;
    if (typeof body.orderModeOn === 'boolean')
      data.orderModeOn = body.orderModeOn;
    if (typeof body.printModeOn === 'boolean')
      data.printModeOn = body.printModeOn;
    if (typeof body.callConfirmModeOn === 'boolean')
      data.callConfirmModeOn = body.callConfirmModeOn;
    if (typeof body.memoSaveModeOn === 'boolean')
      data.memoSaveModeOn = body.memoSaveModeOn;
    if (typeof body.memoTemplateModeOn === 'boolean')
      data.memoTemplateModeOn = body.memoTemplateModeOn;
    if (typeof body.autoMemoDesignModeOn === 'boolean')
      data.autoMemoDesignModeOn = body.autoMemoDesignModeOn;

    // V18: image recognition settings
    if (typeof body.imageRecognitionOn === 'boolean')
      data.imageRecognitionOn = body.imageRecognitionOn;
    if (typeof body.imageFallbackAiOn === 'boolean')
      data.imageFallbackAiOn = body.imageFallbackAiOn;
    if (typeof body.textFallbackAiOn === 'boolean')
      data.textFallbackAiOn = body.textFallbackAiOn;
    if (typeof body.businessBotOn === 'boolean')
      data.businessBotOn = body.businessBotOn;
    if (typeof body.businessInfo === 'string')
      data.businessInfo = body.businessInfo.trim() || null;
    if (body.imageHighConfidence !== undefined)
      data.imageHighConfidence = Math.min(
        1,
        Math.max(0, Number(body.imageHighConfidence) || 0.75),
      );
    if (body.imageMediumConfidence !== undefined)
      data.imageMediumConfidence = Math.min(
        1,
        Math.max(0, Number(body.imageMediumConfidence) || 0.45),
      );

    if (typeof body.knowledgeText === 'string')
      data.knowledgeText = body.knowledgeText.slice(0, 3000);
    if (typeof body.businessName === 'string')
      data.businessName = body.businessName.trim();
    if (typeof body.businessPhone === 'string')
      data.businessPhone = body.businessPhone.trim();
    if (typeof body.businessAddress === 'string')
      data.businessAddress = body.businessAddress.trim();
    if (typeof body.websiteUrl === 'string')
      data.websiteUrl = body.websiteUrl.trim();
    if (typeof body.logoUrl === 'string') data.logoUrl = body.logoUrl.trim();
    if (typeof body.memoFooterText === 'string')
      data.memoFooterText = body.memoFooterText.trim();
    if (typeof body.codLabel === 'string') data.codLabel = body.codLabel.trim();
    if (typeof body.currencySymbol === 'string')
      data.currencySymbol = body.currencySymbol.trim();
    if (typeof body.primaryColor === 'string')
      data.primaryColor = body.primaryColor.trim();
    // V8: custom product code prefix — any letters/digits, shop owner's choice
    if (typeof body.productCodePrefix === 'string') {
      const p = body.productCodePrefix
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      if (p.length >= 1 && p.length <= 10) data.productCodePrefix = p;
    }

    if (body.deliveryFeeInsideDhaka !== undefined)
      data.deliveryFeeInsideDhaka = Number(body.deliveryFeeInsideDhaka) || 0;
    if (body.deliveryFeeOutsideDhaka !== undefined)
      data.deliveryFeeOutsideDhaka = Number(body.deliveryFeeOutsideDhaka) || 0;
    if (typeof body.deliveryTimeInsideDhaka === 'string')
      data.deliveryTimeInsideDhaka = body.deliveryTimeInsideDhaka.trim();
    if (typeof body.deliveryTimeOutsideDhaka === 'string')
      data.deliveryTimeOutsideDhaka = body.deliveryTimeOutsideDhaka.trim();

    // Dual Photo Mode
    if (typeof body.dualPhotoMode === 'boolean')
      data.dualPhotoMode = body.dualPhotoMode;
    if ('dualWearingProductId' in body)
      data.dualWearingProductId = body.dualWearingProductId
        ? Number(body.dualWearingProductId)
        : null;
    if ('dualHoldingProductId' in body)
      data.dualHoldingProductId = body.dualHoldingProductId
        ? Number(body.dualHoldingProductId)
        : null;

    if (Object.keys(data).length === 0) return this.getById(id);

    try {
      return await this.prisma.page.update({ where: { id }, data });
    } catch {
      throw new NotFoundException('Page not found');
    }
  }

  async updateBusinessSettings(id: number, body: any) {
    await this.updateById(id, body);
    return this.getBusinessSettings(id);
  }

  // ── Linked pages helpers ──────────────────────────────────────────────────

  /** Returns the masterPageId if this page is linked, otherwise own id. */
  async getEffectivePageId(pageId: number): Promise<number> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { masterPageId: true },
    });
    return page?.masterPageId ?? pageId;
  }

  /** Returns all pages linked to this master page. */
  async getLinkedPages(masterPageId: number) {
    return this.prisma.page.findMany({
      where: { masterPageId },
      select: { id: true, pageId: true, pageName: true, isActive: true },
    });
  }

  /** Link this page to a master page (shares its settings/products/bot-knowledge). */
  async setMasterPage(pageId: number, masterPageId: number, ownerId: string) {
    if (pageId === masterPageId) {
      throw new BadRequestException('A page cannot be linked to itself');
    }

    const master = await this.prisma.page.findUnique({
      where: { id: masterPageId },
      select: { id: true, ownerId: true, masterPageId: true },
    });
    if (!master) throw new NotFoundException('Master page not found');
    if (master.ownerId !== ownerId)
      throw new ForbiddenException('Master page does not belong to you');
    if (master.masterPageId !== null)
      throw new BadRequestException(
        'Target page is itself a linked page. Only standalone pages can be masters.',
      );

    // Ensure this page has no linked children (cannot demote a master)
    const childCount = await this.prisma.page.count({
      where: { masterPageId: pageId },
    });
    if (childCount > 0)
      throw new BadRequestException(
        'This page already has linked pages. Unlink them first before linking to another master.',
      );

    await this.prisma.page.update({
      where: { id: pageId },
      data: { masterPageId },
    });
    return { success: true };
  }

  /** Unlink this page from its master (becomes standalone). */
  async unlinkPage(pageId: number) {
    await this.prisma.page.update({
      where: { id: pageId },
      data: { masterPageId: null },
    });
    return { success: true };
  }

  /**
   * Swap only the Facebook credentials (pageId + token) on an existing page record.
   * All settings, products and bot-knowledge remain untouched.
   */
  async reconnectFbPage(
    id: number,
    verifiedFbPageId: string,
    verifiedPageName: string,
    rawToken: string,
  ) {
    // Check the new FB page ID is not already owned by a different Page record
    const existing = await this.prisma.page.findUnique({
      where: { pageId: verifiedFbPageId },
      select: { id: true },
    });
    if (existing && existing.id !== id) {
      throw new BadRequestException(
        `This Facebook page (${verifiedFbPageId}) is already connected to another profile.`,
      );
    }

    // Save old FB page ID for audit before updating
    const current = await this.prisma.page.findUnique({
      where: { id },
      select: { pageId: true },
    });

    const encryptedToken = this.encryption.encryptIfNeeded(rawToken);
    const updated = await this.prisma.page.update({
      where: { id },
      data: {
        pageId: verifiedFbPageId,
        pageName: verifiedPageName,
        pageToken: encryptedToken,
        lastReconnectedAt: new Date(),
        previousPageId: current?.pageId ?? null,
      },
      select: { id: true, pageId: true, pageName: true, verifyToken: true },
    });
    return { success: true, page: updated };
  }

  async scrapeWebsiteKnowledge(url: string): Promise<{ text: string }> {
    if (!url || !url.startsWith('http')) return { text: '' };
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FlamboyAIBot/1.0)' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { text: '' };
      const html = await res.text();

      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(
          /<(h[1-3]|p|li|td|th)[^>]*>([\s\S]*?)<\/\1>/gi,
          (_m: string, _tag: string, content: string) =>
            content.replace(/<[^>]+>/g, ' ').trim() + '\n',
        )
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 3000);

      return { text };
    } catch {
      return { text: '' };
    }
  }
}
