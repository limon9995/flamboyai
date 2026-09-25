import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// 'name'|'phone'|'address'|'confirm' or 'cf:FieldLabel' for product custom fields
export type DraftStep = string;

export interface DraftItem {
  productCode: string;
  qty: number;
  unitPrice: number;
}

export interface CustomFieldDef {
  label: string; // e.g. "Size"
  choices?: string[]; // e.g. ["S","M","L","XL"] — empty/absent means free text
  optional?: boolean; // V29: page order fields — customer may reply "না" to skip
  helpText?: string; // V29: extra hint shown with the question
}

export interface DraftSession {
  items: DraftItem[];
  customerName: string | null;
  phone: string | null;
  address: string | null;
  currentStep: DraftStep;
  offeredPrice?: number | null;
  negotiationRequested?: boolean;
  orderNote?: string;
  pendingMultiPreview?: string[];
  pendingVisionMatches?: string[];
  visionSelectionRetryCount?: number;
  // V17: product-specific custom fields (size, color, etc.)
  pendingCustomFields?: CustomFieldDef[];
  customFieldValues?: Record<string, string>;
  // V29: true once the page's AI-visible order fields were queued into
  // pendingCustomFields (so they're asked only once per draft)
  orderFieldsQueued?: boolean;
  // V17: advance payment proof (transaction ID / "screenshot sent")
  paymentProof?: string;
  paymentScreenshotUrl?: string; // URL of screenshot customer sent
  paymentIssueNote?: string; // Customer's problem message — marks order for agent review
  // Platform the order is being placed from (FACEBOOK | INSTAGRAM | WHATSAPP)
  platform?: string;
  // Lead capture mode — only name + phone (whatsapp) needed, no products/address
  isLead?: boolean;
  whatsappNumber?: string | null;
  // Auto-verified payment flag (set by PaymentVerifyService)
  paymentVerified?: boolean;
  // PendingPayment id — set when gateway payment link was sent to customer
  pendingPaymentId?: string;
  // Dual photo clarification — image URL stored while waiting for customer to pick wearing/holding
  pendingDualImageUrl?: string;
  pendingDualAllImageUrls?: string[];
  // Post-order edit — waiting for customer to provide new value for this field
  pendingEditField?: 'name' | 'phone' | 'address' | 'size' | 'color';
}

@Injectable()
export class ConversationContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getSession(pageIdRef: number, customerPsid: string) {
    return this.prisma.conversationSession.findUnique({
      where: { pageIdRef_customerPsid: { pageIdRef, customerPsid } },
    });
  }

  async upsertSession(
    pageIdRef: number,
    customerPsid: string,
    patch: {
      activeDraftJson?: string | null;
      lastPresentedProductsJson?: string | null;
      awaitingField?: string | null;
      lastIntent?: string | null;
      referencedMessageId?: string | null;
      agentHandling?: boolean;
      agentHandlingAt?: Date | null;
      lastCustomerMsg?: string | null;
      lastDraftStep?: string | null;
      loopCount?: number;
      chatHistoryJson?: string | null;
    },
  ) {
    return this.prisma.conversationSession.upsert({
      where: { pageIdRef_customerPsid: { pageIdRef, customerPsid } },
      create: { pageIdRef, customerPsid, ...patch },
      update: patch,
    });
  }

  /**
   * Call at the START of each message to detect loops.
   * Returns the current loopCount AFTER incrementing (if stuck).
   * Resets to 0 if progress was made.
   *
   * "Stuck" = same customer message OR same draft step as last time.
   */
  async checkAndUpdateLoop(
    pageIdRef: number,
    customerPsid: string,
    currentMsg: string,
    currentDraftStep: string | null,
  ): Promise<number> {
    const session = await this.getSession(pageIdRef, customerPsid);
    const lastMsg = session?.lastCustomerMsg ?? null;
    const lastStep = session?.lastDraftStep ?? null;
    const prevCount = session?.loopCount ?? 0;

    const sameMessage =
      lastMsg !== null &&
      lastMsg.toLowerCase().trim() === currentMsg.toLowerCase().trim();
    const sameStep =
      currentDraftStep !== null &&
      lastStep !== null &&
      lastStep === currentDraftStep;

    const newCount = sameMessage || sameStep ? prevCount + 1 : 0;
    await this.upsertSession(pageIdRef, customerPsid, {
      lastCustomerMsg: currentMsg,
      loopCount: newCount,
    });
    return newCount;
  }

  /** Call AFTER processing a message to record which draft step we ended on. */
  async recordDraftStepAfterProcessing(
    pageIdRef: number,
    customerPsid: string,
    draftStep: string | null,
  ): Promise<void> {
    await this.upsertSession(pageIdRef, customerPsid, {
      lastDraftStep: draftStep,
      // Reset loop count on successful step change
      ...(draftStep === null ? { loopCount: 0 } : {}),
    });
  }

  /** Reset loop counter (call when meaningful progress is made). */
  async resetLoop(pageIdRef: number, customerPsid: string): Promise<void> {
    await this.upsertSession(pageIdRef, customerPsid, {
      loopCount: 0,
      lastDraftStep: null,
    });
  }

  async getActiveDraft(
    pageIdRef: number,
    customerPsid: string,
  ): Promise<DraftSession | null> {
    const session = await this.getSession(pageIdRef, customerPsid);
    if (!session?.activeDraftJson) return null;
    try {
      return JSON.parse(session.activeDraftJson) as DraftSession;
    } catch {
      return null;
    }
  }

  async saveDraft(
    pageIdRef: number,
    customerPsid: string,
    draft: DraftSession,
  ) {
    await this.upsertSession(pageIdRef, customerPsid, {
      activeDraftJson: JSON.stringify(draft),
      awaitingField: draft.currentStep,
    });
  }

  async setAgentHandling(
    pageIdRef: number,
    customerPsid: string,
    value: boolean,
  ) {
    const patch: any = { agentHandling: value };
    if (value) patch.agentHandlingAt = new Date();
    else patch.agentHandlingAt = null;
    await this.upsertSession(pageIdRef, customerPsid, patch);
  }

  async isAgentHandling(
    pageIdRef: number,
    customerPsid: string,
    timeoutMinutes: number = 120,
  ): Promise<boolean> {
    const session = await this.getSession(pageIdRef, customerPsid);
    if (!session?.agentHandling) return false;
    // Auto-expire after the page's configured timeout (0 = never auto-resume)
    if (session.agentHandlingAt && timeoutMinutes > 0) {
      const ageMs = Date.now() - new Date(session.agentHandlingAt).getTime();
      if (ageMs > timeoutMinutes * 60 * 1000) {
        await this.setAgentHandling(pageIdRef, customerPsid, false);
        return false;
      }
    }
    return true;
  }

  async clearDraft(pageIdRef: number, customerPsid: string) {
    await this.upsertSession(pageIdRef, customerPsid, {
      activeDraftJson: null,
      awaitingField: null,
      lastIntent: null,
    });
  }

  // ── Chat history (last 8 exchanges for AI context) ─────────────────────────

  async getHistory(
    pageIdRef: number,
    customerPsid: string,
  ): Promise<{ role: string; content: string }[]> {
    const session = await this.getSession(pageIdRef, customerPsid);
    if (!session?.chatHistoryJson) return [];
    try {
      return JSON.parse((session as any).chatHistoryJson);
    } catch {
      return [];
    }
  }

  async appendToHistory(
    pageIdRef: number,
    customerPsid: string,
    customerMsg: string,
    botReply: string,
  ): Promise<void> {
    const existing = await this.getHistory(pageIdRef, customerPsid);
    const truncate = (s: string, max: number) =>
      s.length > max ? s.slice(0, max) + '…' : s;

    existing.push(
      { role: 'user', content: truncate(customerMsg, 200) },
      { role: 'assistant', content: truncate(botReply, 250) },
    );

    // Keep only last 8 pairs (16 messages)
    const capped = existing.slice(-16);
    await this.upsertSession(pageIdRef, customerPsid, {
      chatHistoryJson: JSON.stringify(capped),
    });
  }

  async clearHistory(pageIdRef: number, customerPsid: string): Promise<void> {
    await this.upsertSession(pageIdRef, customerPsid, {
      chatHistoryJson: null,
    });
  }

  async setLastPresentedProducts(
    pageIdRef: number,
    customerPsid: string,
    products: { code: string; price: number; name?: string | null }[],
  ) {
    await this.upsertSession(pageIdRef, customerPsid, {
      lastPresentedProductsJson: JSON.stringify(products),
    });
  }

  async getLastPresentedProducts(
    pageIdRef: number,
    customerPsid: string,
  ): Promise<{ code: string; price: number; name?: string | null }[]> {
    const session = await this.getSession(pageIdRef, customerPsid);
    if (!session?.lastPresentedProductsJson) return [];
    try {
      return JSON.parse(session.lastPresentedProductsJson);
    } catch {
      return [];
    }
  }

  async setPendingMultiPreview(
    pageIdRef: number,
    customerPsid: string,
    codes: string[],
  ) {
    const draft =
      (await this.getActiveDraft(pageIdRef, customerPsid)) || this.emptyDraft();
    draft.pendingMultiPreview = codes;
    await this.saveDraft(pageIdRef, customerPsid, draft);
  }

  async clearPendingMultiPreview(pageIdRef: number, customerPsid: string) {
    const draft = await this.getActiveDraft(pageIdRef, customerPsid);
    if (draft) {
      draft.pendingMultiPreview = [];
      await this.saveDraft(pageIdRef, customerPsid, draft);
    }
  }

  async setPendingVisionMatches(
    pageIdRef: number,
    customerPsid: string,
    codes: string[],
  ) {
    const draft =
      (await this.getActiveDraft(pageIdRef, customerPsid)) || this.emptyDraft();
    draft.pendingVisionMatches = codes;
    draft.visionSelectionRetryCount = 0;
    draft.currentStep = 'vision_select';
    await this.saveDraft(pageIdRef, customerPsid, draft);
  }

  async clearPendingVisionMatches(pageIdRef: number, customerPsid: string) {
    const draft = await this.getActiveDraft(pageIdRef, customerPsid);
    if (draft) {
      draft.pendingVisionMatches = [];
      draft.visionSelectionRetryCount = 0;
      if (draft.currentStep === 'vision_select') {
        draft.currentStep = 'name';
      }
      await this.saveDraft(pageIdRef, customerPsid, draft);
    }
  }

  emptyDraft(platform = 'FACEBOOK'): DraftSession {
    return {
      items: [],
      customerName: null,
      phone: null,
      address: null,
      currentStep: 'name',
      platform,
    };
  }

  startDraftFromCodes(
    codes: string[],
    products: { code: string; price: number }[],
    platform = 'FACEBOOK',
  ): DraftSession {
    const priceMap = new Map(products.map((p) => [p.code, p.price]));
    return {
      items: codes.map((code) => ({
        productCode: code,
        qty: 1,
        unitPrice: priceMap.get(code) ?? 0,
      })),
      customerName: null,
      phone: null,
      address: null,
      currentStep: 'name',
      platform,
    };
  }
}
