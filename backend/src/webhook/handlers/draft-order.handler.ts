import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BotIntentService } from '../../bot/bot-intent.service';
import { AiIntentService } from '../../bot/ai-intent.service';
import { DHAKA_AREA_WHITELIST, isInsideDhakaAddress } from './dhaka-areas';
import {
  ConversationContextService,
  DraftSession,
  CustomFieldDef,
} from '../../conversation-context/conversation-context.service';
import { CallService } from '../../call/call.service';
import { ProductsService } from '../../products/products.service';
import { BotKnowledgeService } from '../../bot-knowledge/bot-knowledge.service';
import { CrmService } from '../../crm/crm.service';
import { FollowUpService } from '../../followup/followup.service';
import { BillingService } from '../../billing/billing.service';
import { SpamCheckerService } from '../../spam-checker/spam-checker.service';
import { PaymentVerifyService } from '../../payment-verify/payment-verify.service';
import { SmsGatewayService } from '../../sms-gateway/sms-gateway.service';
import { CourierService } from '../../courier/courier.service';
import { TelegramNotificationService } from '../../telegram/telegram-notification.service';
import { OrderOwnerMailerService } from '../../orders/order-owner-mailer.service';
import { AgentCoreFieldDef } from '../../agents/agent-behavior-config.interface';
import { isRestaurantReady } from '../../common/restaurant-delivery';
import { PricingService } from '../../pricing/pricing.service';
import { isSkipReply, queueAiOrderFields } from '../../common/order-fields';

// Verbatim defaults — reproduces today's exact name/phone/address prompts.
// Used whenever an agent type has no AgentBehaviorConfig.coreFields override
// (or an incomplete one — all 3 keys are required), so agentType='commerce'
// pages see byte-identical prompts to before this config layer existed.
//
// Known scoping limit: only label/prompt wording is configurable here — the
// 3rd field's captured value still physically lands in DraftSession.address /
// Order.address regardless of its label (e.g. a restaurant's "Table Time"
// answer is stored in the address column). Full field remapping (separate
// storage per vertical) is out of scope for this layer.
const DEFAULT_CORE_FIELDS: AgentCoreFieldDef[] = [
  {
    key: 'name',
    label: 'নাম',
    askPrompt: 'আপনার নামটা দিন 💖',
    retryPrompt: 'আপনার নামটা দিন 💖 (যেমন: রাহেলা বেগম)',
    statusPrompt: 'চলমান order — আপনার নাম দিন 💖',
  },
  {
    key: 'phone',
    label: 'ফোন নম্বর',
    askPrompt: 'ফোন নম্বরটা দিন 💖 (01XXXXXXXXX)',
    retryPrompt: 'ফোন নাম্বারটা আবার দিন 💖 (01XXXXXXXXX)',
    statusPrompt: 'চলমান order — ফোন নাম্বার দিন 💖',
  },
  {
    key: 'address',
    label: 'পুরো ঠিকানা',
    askPrompt: 'পুরো ঠিকানাটা দিন 💖',
    retryPrompt: 'পুরো ঠিকানাটা দিন 💖 (বাসা/রোড/এলাকা/জেলা)',
    statusPrompt: 'চলমান order — পুরো ঠিকানা দিন 💖',
  },
];

@Injectable()
export class DraftOrderHandler {
  private readonly logger = new Logger(DraftOrderHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly botIntent: BotIntentService,
    private readonly aiIntent: AiIntentService,
    private readonly ctx: ConversationContextService,
    private readonly callService: CallService,
    private readonly products: ProductsService,
    private readonly botKnowledge: BotKnowledgeService,
    private readonly crm: CrmService,
    private readonly followUpSvc: FollowUpService,
    private readonly billing: BillingService,
    private readonly spamChecker: SpamCheckerService,
    private readonly courier: CourierService,
    private readonly telegram: TelegramNotificationService,
    private readonly orderOwnerMailer: OrderOwnerMailerService,
    private readonly pricing: PricingService,
    @Optional() private readonly paymentVerify?: PaymentVerifyService,
    @Optional() private readonly smsGateway?: SmsGatewayService,
  ) {}

  // Duplicate-confirm guard: pageId:psid -> last finalize timestamp
  private readonly recentConfirms = new Map<string, number>();

  /** Resolves per-agent-type core field labels/prompts, falling back to the commerce defaults. */
  private async resolveCoreFields(page: any): Promise<Record<string, AgentCoreFieldDef>> {
    const behavior = await this.botKnowledge
      .getAgentBehavior(page?.agentType || 'commerce')
      .catch(() => null);
    const fields =
      behavior?.coreFields?.length === 3 ? behavior.coreFields : DEFAULT_CORE_FIELDS;
    return Object.fromEntries(fields.map((f) => [f.key, f])) as Record<string, AgentCoreFieldDef>;
  }

  normalizeVariantOptions(raw: any): CustomFieldDef[] {
    if (!Array.isArray(raw) || raw.length === 0) return [];

    const cleaned = raw
      .map((item: any) => {
        if (typeof item === 'string') {
          return { label: item.trim(), choices: [] as string[] };
        }
        const label = String(item?.label || '').trim();
        const choices = Array.isArray(item?.choices)
          ? item.choices.map((c: any) => String(c).trim()).filter(Boolean)
          : [];
        return { label, choices };
      })
      .filter((item) => item.label || item.choices.length > 0);

    if (!cleaned.length) return [];

    const looksLikeChoiceList = cleaned.every(
      (item) => item.label && item.choices.length === 0,
    );

    if (looksLikeChoiceList) {
      const labels = cleaned.map((item) => item.label);
      return [
        {
          label: this.guessVariantLabel(labels),
          choices: labels,
        },
      ];
    }

    return cleaned.map((item) => ({
      label: item.label || 'Option',
      choices: item.choices,
    }));
  }

  private guessVariantLabel(labels: string[]): string {
    const joined = labels.join(' ').toLowerCase();
    if (
      /^(xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl)$/i.test(labels[0] || '') ||
      /\b(xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl)\b/.test(joined)
    ) {
      return 'Size';
    }
    if (
      /\b(red|blue|green|black|white|yellow|pink|purple|brown|grey|gray|orange)\b/.test(
        joined,
      ) ||
      /(লাল|নীল|সবুজ|কালো|সাদা|হলুদ|গোলাপি|বাদামি|ধূসর)/.test(joined)
    ) {
      return 'Color';
    }
    return 'Option';
  }

  startDraftFromCodes(
    codes: string[],
    products: Array<{ code: string; price: number }>,
    variantOptions: CustomFieldDef[] = [],
    platform = 'FACEBOOK',
  ): DraftSession {
    const normalizedVariantOptions =
      this.normalizeVariantOptions(variantOptions);
    const priceMap = new Map(products.map((p) => [p.code, p.price]));
    const firstStep =
      normalizedVariantOptions.length > 0
        ? `cf:${normalizedVariantOptions[0].label}`
        : 'name';
    return {
      items: codes.map((code) => ({
        productCode: code,
        qty: 1,
        unitPrice: priceMap.get(code) ?? 0,
      })),
      customerName: null,
      phone: null,
      address: null,
      currentStep: firstStep,
      pendingCustomFields: [...normalizedVariantOptions],
      customFieldValues: {},
      platform,
    };
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

  /**
   * Parse labeled form reply from customer.
   * Matches patterns like:
   *   নাম: Limon  /  name: Limon
   *   ফোন: 01720450797  /  phone: 01720450797
   *   ঠিকানা: Savar, Dhaka  /  address: Savar, Dhaka
   */
  parseLabeledForm(text: string): { name?: string; phone?: string; address?: string } | null {
    const nameMatch = text.match(/(?:নাম|name)\s*[:\-]\s*([^\n]+)/i);
    const phoneMatch = text.match(/(?:ফোন|phone|মোবাইল|mobile|নম্বর|number)\s*[:\-]\s*([^\n]+)/i);
    const addressMatch = text.match(/(?:ঠিকানা|address|addr|লোকেশন|location)\s*[:\-]\s*([^\n]+)/i);

    if (!nameMatch && !phoneMatch && !addressMatch) return null;

    const result: { name?: string; phone?: string; address?: string } = {};
    if (nameMatch) result.name = nameMatch[1].trim().slice(0, 80);
    if (phoneMatch) {
      const raw = phoneMatch[1].trim().replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
      const ph = raw.match(/(?:\+?88)?01[3-9]\d{8}/);
      if (ph) result.phone = ph[0];
    }
    if (addressMatch) result.address = addressMatch[1].trim().slice(0, 200);

    return result;
  }

  async captureField(
    pageId: number,
    psid: string,
    text: string,
    draft: DraftSession,
    page: any,
  ): Promise<string | null | false> {
    const step = draft.currentStep;
    let workingText = text;
    const fields = await this.resolveCoreFields(page);

    // ── Labeled form fast-path: customer filled the template ───────────────
    // Zero AI cost — pure regex extraction from "নাম: X\nফোন: Y\nঠিকানা: Z"
    if (step === 'name' || step === 'phone' || step === 'address') {
      const form = this.parseLabeledForm(text);
      if (form && (form.name || form.phone || form.address)) {
        if (form.name && !draft.customerName) draft.customerName = form.name;
        if (form.phone && !draft.phone) draft.phone = form.phone;
        if (form.address && !draft.address) draft.address = form.address;
        await this.ctx.saveDraft(pageId, psid, draft);

        // If all three collected, move to next step
        if (draft.customerName && draft.phone && draft.address) {
          return this.proceedAfterCoreFields(pageId, psid, draft, page);
        }
        // Ask for what's still missing
        if (!draft.customerName) return fields.name.askPrompt;
        if (!draft.phone) return fields.phone.askPrompt;
        if (!draft.address) return fields.address.askPrompt;
      }
    }

    // ── Regex-first gate: skip AI for clear-cut inputs ─────────────────────
    // For phone/name/address steps, if the input is unambiguous, skip the
    // AI reviewDraftStep call entirely (saves cost + avoids false REJECTs).
    // "না" to an optional order field means "skip" — must not reach the AI
    // review, which would read it as an order cancel.
    const optionalFieldSkip =
      step.startsWith('cf:') &&
      Boolean(
        (draft.pendingCustomFields || []).find((f) => f.label === step.slice(3))
          ?.optional,
      ) &&
      isSkipReply(text);
    const regexCapture = optionalFieldSkip
      ? text.trim()
      : this.tryRegexCapture(step, text);
    if (regexCapture === 'CANCEL') {
      await this.ctx.clearDraft(pageId, psid);
      return null;
    }
    if (regexCapture !== null) {
      // Regex gave a clean value — use it directly, no AI needed
      workingText = regexCapture;
    } else {
      // Only call AI when regex can't conclusively decide
      const aiReview = await this.aiIntent.reviewDraftStep(
        pageId,
        text,
        step,
        page?.businessName ?? null,
      );
      if (aiReview) {
        if (aiReview.action === 'EXIT_DRAFT') {
          await this.ctx.clearDraft(pageId, psid);
          return aiReview.reply ?? 'ঠিক আছে 💖 আপনি যা জানতে চান সেটাই বলুন।';
        }
        if (aiReview.action === 'RETRY') {
          return aiReview.reply ?? this.reminder(draft);
        }
        if (aiReview.action === 'CONFIRM')
          workingText = aiReview.normalizedValue ?? 'confirm';
        if (aiReview.action === 'CANCEL')
          workingText = aiReview.normalizedValue ?? 'cancel';
        if (aiReview.action === 'EDIT')
          workingText = aiReview.normalizedValue ?? 'change';
        if (aiReview.action === 'CAPTURE' && aiReview.normalizedValue) {
          workingText = aiReview.normalizedValue;
        }
      }
    }

    // ── CONFIRM SAVED ADDRESS (returning customer) ────────────────────────────
    if (step === 'confirm_address') {
      const confirmIntent = this.botIntent.detectIntent(workingText, true);
      if (
        confirmIntent === 'CONFIRM' ||
        /^(ha|haa|hea|yes|ok|হ্যাঁ|জি|ঠিক)/i.test(workingText.trim())
      ) {
        // Keep saved address → order fields, then advance_payment check or confirm
        return this.proceedAfterCoreFields(pageId, psid, draft, page);
      }
      // Customer gave a new address
      if (this.isAddressLike(workingText)) {
        draft.address = workingText.trim();
        return this.proceedAfterCoreFields(pageId, psid, draft, page);
      }
      return `আগের ঠিকানায় পাঠাব?\n📍 *${draft.address}*\n\n"হ্যাঁ" বললে এই ঠিকানায় যাবে, অথবা নতুন ঠিকানা লিখুন 💖`;
    }

    // ── CONFIRM ──────────────────────────────────────────────────────────────
    if (step === 'confirm') {
      const intent = this.botIntent.detectIntent(workingText, true);
      if (intent === 'CONFIRM') {
        // Wallet-based check (primary): page must be ACTIVE with positive balance
        const walletOk =
          page.subscriptionStatus === 'ACTIVE' && page.creditBalance > 0;
        // Legacy billing check (fallback): only block if wallet check also fails
        if (!walletOk && page.ownerId) {
          const billingStatus = await this.billing.getStatus(page.ownerId);
          if (!billingStatus.canTakeOrders) {
            await this.ctx.clearDraft(pageId, psid);
            return 'দুঃখিত, এই মুহূর্তে অর্ডার নেওয়া সম্ভব হচ্ছে না। পরে আবার চেষ্টা করুন।';
          }
        }
        await this.finalizeDraftOrder(pageId, psid, draft, page);
        return null;
      }
      if (intent === 'CANCEL') {
        await this.ctx.clearDraft(pageId, psid);
        return null;
      }
      if (intent === 'EDIT_ORDER') {
        // Let webhook.service handleDraftEdit take over — return false so caller handles it
        return false;
      }
      // If customer sends a bare phone number, update it directly
      const inlinePhone = this.extractPhone(workingText);
      if (
        inlinePhone &&
        /^\+?8?8?01[3-9]\d{8}$/.test(inlinePhone) &&
        workingText.trim().replace(/\D/g, '').length >= 10
      ) {
        draft.phone = inlinePhone;
        draft.currentStep = 'confirm';
        await this.ctx.saveDraft(pageId, psid, draft);
        return this.buildSummary(draft, page);
      }
      return `সব ঠিক থাকলে **confirm** লিখুন 💖\nকিছু বদলাতে চাইলে: ${this.buildEditOptions(draft)}`;
    }

    // ── ADVANCE PAYMENT PROOF ─────────────────────────────────────────────────
    if (step === 'advance_payment') {
      // Customer explicitly refuses to pay advance → cancel the draft
      if (this.isPaymentRefusal(workingText) || this.botIntent.detectIntent(workingText, false) === 'CANCEL') {
        await this.ctx.clearDraft(pageId, psid);
        return '😔 ঠিক আছে, order টি বাতিল করা হলো। পরে আবার order করতে পারবেন 💖';
      }

      // Detect problem/complaint instead of payment proof → route to agent
      if (this.isPaymentProblem(workingText)) {
        draft.paymentIssueNote = workingText.trim().slice(0, 300);
        await this.finalizeDraftOrder(pageId, psid, draft, page);
        await this.ctx.setAgentHandling(pageId, psid, true);
        return '⚠️ সমস্যার কথা বুঝতে পেরেছি। আমাদের agent শীঘ্রই যোগাযোগ করবে 💙';
      }

      const screenshotAlreadySent = Boolean(draft.paymentScreenshotUrl);

      // Phone number as payment sender — match via SMS gateway
      const senderPhoneMatch = workingText.trim().match(/^(?:\+?88)?01[3-9]\d{8}$/);
      if (senderPhoneMatch && this.smsGateway && page.smsGatewayEnabled) {
        const expectedAmount = this.calcAdvanceAmount(draft, page);
        const smsMatch = await this.smsGateway.matchPayment(pageId, null, workingText.trim(), expectedAmount);
        if (smsMatch.matched) {
          draft.paymentProof = `Phone: ${workingText.trim()}`;
          draft.paymentVerified = true;
          draft.currentStep = 'confirm';
          await this.ctx.saveDraft(pageId, psid, draft);
          return `✅ Payment পাওয়া গেছে! ৳${smsMatch.amount} (${(smsMatch.method ?? 'SMS').toUpperCase()})\n\n${this.buildSummary(draft, page)}`;
        }
        return `এই নম্বর থেকে payment পাইনি এখনো 😊 একটু পর আবার চেষ্টা করুন, অথবা Transaction ID দিন।`;
      }

      // Try to extract TxID from natural sentences
      const extracted = this.extractTxIdFromSentence(workingText);
      const proofText = extracted || workingText.trim();

      if (!screenshotAlreadySent && !this.isValidTransactionId(proofText)) {
        return 'Transaction ID টা দিন 💖 (যেমন: 8N7G3DKXYZ) অথবা payment-এর screenshot পাঠান।';
      }

      // ── Auto-verify via bKash/Nagad API if credentials configured ──────────
      if (this.paymentVerify && !screenshotAlreadySent) {
        const activeCred = await this.paymentVerify.getActiveCredential(pageId);
        if (activeCred?.type === 'direct') {
          const expectedAmount = this.calcAdvanceAmount(draft, page);
          const result = await this.paymentVerify.verifyDirect(
            pageId,
            activeCred.method,
            proofText,
            expectedAmount,
          );
          if (result.verified) {
            draft.paymentProof = proofText.slice(0, 200);
            draft.paymentVerified = true;
            draft.currentStep = 'confirm';
            await this.ctx.saveDraft(pageId, psid, draft);
            return (
              `✅ Payment verify হয়েছে! (${activeCred.method.toUpperCase()})\n\n` +
              this.buildSummary(draft, page)
            );
          } else if (
            !result.needsManual &&
            result.errorMessage &&
            !result.errorMessage.startsWith('credentials')
          ) {
            // Transaction genuinely not found — ask customer to retry
            return `❌ Transaction ID টি verify হয়নি। সঠিক ID দিন অথবা screenshot পাঠান 💖`;
          }
          // needsManual or API error → fall through to manual proof collection
        }
      }
      // ── End auto-verify ─────────────────────────────────────────────────────

      // ── SMS Gateway match — check merchant's phone received SMS ─────────────
      if (this.smsGateway && !screenshotAlreadySent) {
        const page2 = page;
        if (page2.smsGatewayEnabled) {
          const expectedAmount = this.calcAdvanceAmount(draft, page);
          const smsMatch = await this.smsGateway.matchPayment(
            pageId,
            proofText,
            draft.phone ?? null,
            expectedAmount,
          );
          if (smsMatch.matched) {
            draft.paymentProof = proofText.slice(0, 200);
            draft.paymentVerified = true;
            draft.currentStep = 'confirm';
            await this.ctx.saveDraft(pageId, psid, draft);
            return (
              `✅ Payment verify হয়েছে! (${(smsMatch.method ?? 'SMS').toUpperCase()})\n\n` +
              this.buildSummary(draft, page)
            );
          }
        }
      }
      // ── End SMS gateway match ───────────────────────────────────────────────

      draft.paymentProof = proofText.slice(0, 200);
      draft.currentStep = 'confirm';
      await this.ctx.saveDraft(pageId, psid, draft);
      return this.buildSummary(draft, page);
    }

    // ── AWAITING GATEWAY PAYMENT ──────────────────────────────────────────────
    if (step === 'awaiting_gateway_payment') {
      return 'পেমেন্ট লিংকে ক্লিক করে payment করুন 💖\nপেমেন্ট হলে অর্ডার automatically confirm হবে।';
    }

    // ── CUSTOM FIELD (cf:FieldLabel) ──────────────────────────────────────────
    if (step.startsWith('cf:')) {
      const fieldLabel = step.slice(3);
      const currentField = (draft.pendingCustomFields || []).find(
        (f) => f.label === fieldLabel,
      );

      // Validate against choices if field has a predefined list
      let resolvedValue = workingText.trim();
      const skipped =
        Boolean(currentField?.optional) && isSkipReply(resolvedValue);
      if (!skipped && currentField?.choices?.length) {
        const choices = currentField.choices;

        // 1. Exact match first (case-insensitive) — e.g. "34", "M", "নীল"
        const exactMatch = choices.find(
          (c) => c.toLowerCase() === resolvedValue.toLowerCase(),
        );
        if (exactMatch) {
          resolvedValue = exactMatch;
        } else {
          // 2. Numeric index — e.g. "1" → first choice, "2" → second choice
          const numericMatch = resolvedValue.match(/^(\d+)$/);
          if (numericMatch) {
            const idx = parseInt(numericMatch[1], 10) - 1;
            if (idx >= 0 && idx < choices.length) {
              resolvedValue = choices[idx];
            } else {
              const opts = choices.map((c, i) => `${i + 1}. ${c}`).join('\n');
              return `❌ "${workingText}" সঠিক না। নিচের list থেকে বেছে নিন:\n${opts}`;
            }
          } else {
            // Not in choices, not a valid index
            const opts = choices.map((c, i) => `${i + 1}. ${c}`).join('\n');
            return `❌ "${workingText}" list এ নেই। নিচের option থেকে বেছে নিন:\n${opts}`;
          }
        }
      }

      if (!skipped) {
        draft.customFieldValues = {
          ...(draft.customFieldValues || {}),
          [fieldLabel]: resolvedValue,
        };
      }
      draft.pendingCustomFields = (draft.pendingCustomFields || []).filter(
        (f) => f.label !== fieldLabel,
      );

      if (draft.pendingCustomFields.length > 0) {
        const next = draft.pendingCustomFields[0];
        draft.currentStep = `cf:${next.label}`;
        await this.ctx.saveDraft(pageId, psid, draft);
        return this.promptForCustomField(next);
      }

      // Page order fields are asked after name/phone/address — continue
      // straight to payment/confirm instead of re-asking customer info
      if (draft.customerName && draft.phone && draft.address) {
        return this.proceedAfterCoreFields(pageId, psid, draft, page);
      }

      // All custom fields done → now collect customer info
      draft.currentStep = 'name';
      await this.ctx.saveDraft(pageId, psid, draft);
      return this.buildInfoFormPrompt(fields);
    }

    // ── NAME / PHONE / ADDRESS — Smart multi-field parsing ───────────────────
    //
    // Try to extract all three from a single customer message first.
    // Then fall back to strict per-step handling for whatever is still missing.
    //
    // Name correction at phone/address step — e.g. "na amr name Limon", "naam change"
    if ((step === 'phone' || step === 'address') && draft.customerName) {
      const nameCorrection = workingText.match(
        /(?:amr?|amar|আমার|ami|নাম|naam?|name)\s+(?:holo|হলো|হচ্ছে|হবে|is|:)?\s*([^\d\n,।]{3,40})/i,
      );
      if (nameCorrection) {
        draft.customerName = nameCorrection[1].trim().slice(0, 80);
        await this.ctx.saveDraft(pageId, psid, draft);
        return step === 'phone'
          ? `নাম আপডেট হয়েছে: ${draft.customerName} 💖 এখন ফোন নম্বর দিন।`
          : `নাম আপডেট হয়েছে: ${draft.customerName} 💖 এখন পুরো ঠিকানা দিন।`;
      }
    }

    // For phone/address steps, name is already collected — skip multi-field parsing.
    // At address step: extract phone if present, then treat ALL remaining text as address
    // to avoid mis-classifying "Savar,Dhaka" → name="Savar", address="Dhaka".
    let parsed: { name?: string; phone?: string; address?: string };
    if (step === 'address') {
      const phoneOnly = this.parseCustomerInfo(workingText).phone;
      let addrText = workingText;
      if (phoneOnly) {
        // strip phone from text, rest is address
        addrText = workingText
          .replace(/(?:\+?88)?01[3-9]\d{8}/, '')
          .trim()
          .replace(/\s{2,}/g, ' ');
      }
      parsed = { phone: phoneOnly, address: addrText || undefined };
    } else if (step === 'phone') {
      parsed = {
        name: undefined,
        phone: this.parseCustomerInfo(workingText).phone,
        address: this.parseCustomerInfo(workingText).address,
      };
    } else {
      parsed = this.parseCustomerInfo(workingText);
    }

    if (!draft.customerName && parsed.name && !this.isFillerWord(parsed.name)) {
      draft.customerName = parsed.name;
    }
    if (!draft.phone && parsed.phone) draft.phone = parsed.phone;
    // Only trust an address extracted at the 'name' step when it came from a genuine
    // multi-field message that ALSO produced a name or phone (e.g. "Limon, Mirpur, Dhaka").
    // A lone address-shaped reply to "what's your name?" must never silently become the
    // address — it's handled as a name-step fallback below instead.
    if (
      !draft.address &&
      parsed.address &&
      (step !== 'name' || parsed.name || parsed.phone)
    ) {
      draft.address = parsed.address;
    }

    // At name step: if parser didn't find a usable name (may have mis-classified as
    // address due to length heuristic, or been a filler word), treat the raw input as
    // the name — but still reject filler/greeting words ("ok"/"hi") so the bot re-asks.
    if (step === 'name' && !draft.customerName) {
      if (this.botIntent.detectIntent(workingText, false) === 'CANCEL') {
        return fields.name.retryPrompt;
      }
      const raw = workingText.trim();
      if (this.isFillerWord(raw)) {
        return fields.name.retryPrompt;
      }
      if (!parsed.phone) draft.customerName = raw.slice(0, 80);
    }

    // If smart parser found nothing, apply strict current-step logic
    if (!parsed.name && !parsed.phone && !parsed.address) {
      if (step === 'phone') {
        if (this.botIntent.detectIntent(workingText, false) === 'CANCEL') {
          await this.ctx.clearDraft(pageId, psid);
          return null;
        }
        const ph = this.extractPhone(workingText);
        if (!ph) return fields.phone.retryPrompt;
        draft.phone = ph;
        // Async spam check — runs while customer continues to address step
        this.spamChecker
          .checkPhone(ph, pageId)
          .then((r) => {
            (draft as any).spamResult = r;
          })
          .catch(() => {});
        // Loyalty ("Lucky Customer") — real-time status shown right after phone capture
        const loyalty = await this.pricing
          .getLoyaltyStatus(pageId, ph)
          .catch(() => null);
        if (loyalty?.enabled) (draft as any).loyaltyMessage = loyalty.message;
        // Milestone Rewards — preview what this order (or an upcoming one) earns
        const milestone = await this.pricing
          .getMilestonePreview(pageId, ph)
          .catch(() => null);
        if (milestone?.enabled) {
          if (milestone.rewards.length) {
            const whats = milestone.rewards.map((r) =>
              r.rewardType === 'FREE_DELIVERY' ? 'ফ্রি ডেলিভারি'
              : r.rewardType === 'DISCOUNT' ? `${r.discountPercent}% ছাড়`
              : `ফ্রি ${r.productName}`,
            );
            (draft as any).milestoneMessage = `🎁 এই অর্ডারেই আপনি পাচ্ছেন ${whats.join(' + ')}!`;
          } else if (milestone.next) {
            const what =
              milestone.next.rewardType === 'FREE_DELIVERY' ? 'ফ্রি ডেলিভারি'
              : milestone.next.rewardType === 'DISCOUNT' ? `${milestone.next.discountPercent}% ছাড়`
              : `ফ্রি ${milestone.next.productName}`;
            (draft as any).milestoneMessage = `🎁 আরও ${milestone.next.ordersAway}টা অর্ডার করলে পাবেন ${what}!`;
          }
        }
      } else if (step === 'address') {
        if (!this.isAddressLike(workingText))
          return fields.address.retryPrompt;
        draft.address = workingText.trim();
      }
    }

    // Determine next missing field and ask
    if (!draft.customerName) {
      draft.currentStep = 'name';
      await this.ctx.saveDraft(pageId, psid, draft);
      return this.buildInfoFormPrompt(fields);
    }
    if (!draft.phone) {
      draft.currentStep = 'phone';
      await this.ctx.saveDraft(pageId, psid, draft);
      return `ধন্যবাদ ${draft.customerName} 💖 এখন ${fields.phone.label} দিন।`;
    }
    if (!draft.address) {
      draft.currentStep = 'address';
      await this.ctx.saveDraft(pageId, psid, draft);
      const loyaltyLine = (draft as any).loyaltyMessage
        ? `\n\n${(draft as any).loyaltyMessage}`
        : '';
      const milestoneLine = (draft as any).milestoneMessage
        ? `\n\n${(draft as any).milestoneMessage}`
        : '';
      return `ঠিক আছে 💖 এখন ${fields.address.label} দিন।${loyaltyLine}${milestoneLine}`;
    }

    return this.proceedAfterCoreFields(pageId, psid, draft, page);
  }

  /**
   * Name/phone/address are all collected — ask the page's AI-visible order
   * fields first (once per draft), then move on to advance payment or the
   * confirm summary. Every path that completes the core fields funnels here.
   */
  private async proceedAfterCoreFields(
    pageId: number,
    psid: string,
    draft: DraftSession,
    page: any,
  ): Promise<string> {
    if (queueAiOrderFields(draft, page)) {
      await this.ctx.saveDraft(pageId, psid, draft);
      return this.promptForCustomField(draft.pendingCustomFields![0]);
    }

    // All collected → check if advance payment required
    if (this.isAdvanceNeeded(draft, page)) {
      // If gateway credentials configured → send payment link instead of asking for TxID
      if (this.paymentVerify) {
        const activeCred = await this.paymentVerify.getActiveCredential(pageId);
        if (activeCred?.type === 'gateway') {
          const amount = this.calcAdvanceAmount(draft, page);
          const apiBaseUrl =
            process.env.API_BASE_URL || `https://api.flamboyai.com`;
          try {
            const pending = await this.paymentVerify.createPendingPayment(
              pageId,
              psid,
              draft,
              amount,
              activeCred.method,
            );
            const paymentLink = await this.paymentVerify.generateGatewayLink(
              pageId,
              activeCred.method,
              pending.sessionToken,
              amount,
              apiBaseUrl,
            );
            if (paymentLink) {
              draft.currentStep = 'awaiting_gateway_payment';
              draft.pendingPaymentId = pending.id;
              await this.ctx.saveDraft(pageId, psid, draft);
              const sym = page.currencySymbol || '৳';
              const manualLines = this.buildManualAccountLines(page);
              const manualSection = manualLines
                ? `\n\n──────────────────\n*অথবা manually পাঠান:*\n${manualLines}\n\nManually পাঠালে Transaction ID বা screenshot পাঠান 💖`
                : '';
              return `💳 *Payment করুন* (${sym}${amount})\n\n🔗 এই লিংকে ক্লিক করে সহজে পেমেন্ট করুন:\n${paymentLink}\n(bKash / Nagad / Rocket সব option থাকবে)\n\nপেমেন্ট হলে অর্ডার automatically confirm হবে ✅${manualSection}`;
            }
          } catch (err) {
            this.logger.error(
              `[DraftOrder] gateway link error: ${err.message}`,
            );
          }
        }
      }
      draft.currentStep = 'advance_payment';
      await this.ctx.saveDraft(pageId, psid, draft);
      return this.buildAdvancePrompt(page, draft);
    }

    // No advance needed → show summary and ask for confirm
    draft.currentStep = 'confirm';
    await this.ctx.saveDraft(pageId, psid, draft);
    return this.buildSummary(draft, page);
  }

  buildInfoFormPrompt(fields?: Record<string, AgentCoreFieldDef>): string {
    // Uses this compact form-field vocabulary by default (নাম/ফোন/ঠিকানা), which
    // is intentionally shorter than each field's general `label` (e.g. "ফোন নম্বর")
    // used elsewhere — only substituted when an agent-type override is active,
    // so the default (no override) output stays byte-identical to before.
    const isOverride = !!fields && fields !== undefined && Object.values(fields).some(
      (f, i) => f.label !== DEFAULT_CORE_FIELDS[i]?.label,
    );
    if (!isOverride) {
      return `📋 নিচের ফর্মটি **copy** করে পূরণ করুন:\n\nনাম: \nফোন: \nঠিকানা: \n\n💡 অথবা এক এক করে পাঠান — প্রথমে নামটা বলুন।`;
    }
    const f = Object.values(fields!);
    const formLines = f.map((field) => `${field.label}: `).join('\n');
    return `📋 নিচের ফর্মটি **copy** করে পূরণ করুন:\n\n${formLines}\n\n💡 অথবা এক এক করে পাঠান — প্রথমে ${f[0]?.label ?? 'নাম'} বলুন।`;
  }

  // V24: Restaurant pages use distance-slab fees (exact fee needs a website
  // map pin) — inside/outside Dhaka rates must never be applied to them.
  private zoneDeliveryFee(address: string, page: any): number {
    if (isRestaurantReady(page)) return 0;
    const isOut = !this.isInsideDhaka(address || '', page);
    return Number(
      isOut
        ? (page.deliveryFeeOutsideDhaka ?? 120)
        : (page.deliveryFeeInsideDhaka ?? 80),
    );
  }

  buildSummary(draft: DraftSession, page: any): string {
    const sym = page.currencySymbol || '৳';
    const isRestaurant = isRestaurantReady(page);
    const fee = this.zoneDeliveryFee(draft.address || '', page);
    let subtotal = 0;
    const lines = draft.items.map((i) => {
      const t = i.unitPrice * i.qty;
      subtotal += t;
      return `• ${i.productCode} ×${i.qty} = ${sym}${t}`;
    });

    const cfLines = Object.entries(draft.customFieldValues || {}).map(
      ([k, v]) => `📌 ${k}: ${v}`,
    );

    const negLine =
      draft.negotiationRequested && draft.offeredPrice
        ? `⚠️ Offered: ${sym}${draft.offeredPrice}`
        : '';

    const proofLine = draft.paymentProof
      ? `💳 Payment: ${draft.paymentProof}`
      : '';

    return [
      '📦 *Order Summary*',
      ...lines,
      ...(cfLines.length ? cfLines : []),
      isRestaurant
        ? `🛵 Delivery: দূরত্ব অনুযায়ী (delivery-র সময় জানানো হবে)`
        : `🚚 Delivery: ${sym}${fee}`,
      isRestaurant
        ? `💰 Total: ${sym}${subtotal} + delivery charge`
        : `💰 Total: ${sym}${subtotal + fee}`,
      '',
      `👤 Name:    ${draft.customerName ?? '—'}`,
      `📞 Phone:   ${draft.phone ?? '—'}`,
      `📍 Address: ${draft.address ?? '—'}`,
      ...(proofLine ? [proofLine] : []),
      ...(negLine ? [negLine] : []),
      '',
      'সব ঠিক থাকলে **confirm** লিখুন 💖',
    ]
      .filter((l) => l !== undefined)
      .join('\n');
  }

  reminder(draft: DraftSession): string {
    const step = draft.currentStep;
    if (step === 'confirm_address')
      return 'চলমান order — ঠিকানা confirm করুন 💖';
    if (step === 'confirm')
      return `সব ঠিক থাকলে **confirm** লিখুন 💖\nকিছু বদলাতে চাইলে: ${this.buildEditOptions(draft)}`;
    if (step === 'advance_payment')
      return 'চলমান order — advance payment পাঠান 💖';
    if (step.startsWith('cf:'))
      return `চলমান order — ${step.slice(3)} জানান 💖`;
    if (step === 'name') return 'চলমান order — আপনার নাম দিন 💖';
    if (step === 'phone') return 'চলমান order — ফোন নাম্বার দিন 💖';
    if (step === 'address') return 'চলমান order — পুরো ঠিকানা দিন 💖';
    return '';
  }

  private buildEditOptions(draft: DraftSession): string {
    const options = ['"name change"', '"phone change"', '"address change"'];
    for (const key of Object.keys(draft.customFieldValues || {})) {
      options.push(`"${key} change"`);
    }
    return options.join(' / ');
  }

  async finalizeDraftOrder(
    pageId: number,
    psid: string,
    draft: DraftSession,
    page: any,
  ): Promise<number> {
    // Duplicate-confirm guard — ignore a second finalize call for the same
    // customer within 10s (fast double-tap "confirm" or a webhook retry)
    const confirmKey = `${pageId}:${psid}`;
    const lastConfirm = this.recentConfirms.get(confirmKey);
    if (lastConfirm && Date.now() - lastConfirm < 10_000) {
      this.logger.warn(
        `[DraftOrder] Duplicate confirm ignored for ${confirmKey}`,
      );
      return -1;
    }
    this.recentConfirms.set(confirmKey, Date.now());

    // Merge custom fields + payment proof + issue note into order note
    const cfNote = Object.entries(draft.customFieldValues || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    const proofNote = draft.paymentProof
      ? `Payment proof: ${draft.paymentProof}`
      : '';
    const issueNote = draft.paymentIssueNote
      ? `⚠️ Payment Issue: ${draft.paymentIssueNote}`
      : '';
    const combinedNote =
      [cfNote, proofNote, issueNote, draft.orderNote]
        .filter(Boolean)
        .join(' | ') || null;

    // Determine payment status and order status
    const paymentMode = (page.paymentMode as string) || 'cod';
    const hasProof = Boolean(draft.paymentProof);
    let paymentStatus = 'not_required';
    let orderStatus = 'RECEIVED';
    let confirmedAt: Date | null = null;

    if (paymentMode !== 'cod') {
      if (hasProof) {
        paymentStatus = 'advance_paid';
        orderStatus = 'CONFIRMED';
        confirmedAt = new Date();
      } else {
        paymentStatus = 'agent_required';
      }
    }

    const spamResult = (draft as any).spamResult as
      | import('../../spam-checker/spam-checker.service').SpamResult
      | undefined;

    // Resolve effective pageId (linked pages share master's product catalog)
    const effectivePageId = await this.products.getEffectivePageId(pageId);

    // M-3: Stock check before creating order — abort if any item is out of stock
    for (const item of draft.items) {
      const product = await this.prisma.product.findUnique({
        where: {
          pageId_code: {
            pageId: effectivePageId,
            code: item.productCode,
          },
        },
        select: { stockQty: true, name: true },
      });
      if (product && product.stockQty <= 0) {
        throw new Error(`Product ${item.productCode} is out of stock`);
      }
    }

    // Lead shortcut — skip stock check, create order with source=LEAD
    if ((draft as any).isLead) {
      const lead = await this.prisma.order.create({
        data: {
          pageIdRef: pageId,
          customerPsid: psid,
          customerName: draft.customerName || 'Lead',
          phone: draft.phone ?? null,
          address: '',
          status: 'RECEIVED',
          source: 'LEAD',
          orderNote: `WhatsApp: ${draft.phone ?? '-'} | Trial/Setup inquiry`,
          paymentStatus: 'not_required',
          items: { create: [] },
        },
      });
      this.logger.log(
        `[DraftOrder] Lead saved orderId=${lead.id} name=${lead.customerName} phone=${lead.phone}`,
      );
      return lead.id;
    }

    // Loyalty/Happy Hour/Milestone — computed before the transaction so a slow
    // pricing query can't hold the DB transaction open.
    const orderSubtotal = draft.items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
    const [discounts, isCombo] = await Promise.all([
      this.pricing
        .computeDiscounts(pageId, draft.phone ?? null, orderSubtotal)
        .catch(() => ({ loyaltyDiscount: 0, happyHourDiscount: 0 })),
      this.pricing
        .isComboOrder(pageId, draft.items.map((i) => i.productCode))
        .catch(() => false),
    ]);
    const { thisOrderNumber, rewards: milestoneRewards } = await this.pricing
      .getMilestoneRewards(pageId, draft.phone ?? null, isCombo)
      .catch(() => ({ thisOrderNumber: 0, rewards: [] as any[] }));
    const milestoneFreeDelivery = milestoneRewards.some((r) => r.rewardType === 'FREE_DELIVERY');
    const milestoneDiscountAmount = this.pricing.computeMilestoneDiscount(milestoneRewards, orderSubtotal);

    // C-3: Create order AND decrement stock atomically
    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          pageIdRef: pageId,
          customerPsid: psid,
          customerName: draft.customerName || 'Customer',
          phone: draft.phone ?? null,
          address: draft.address ?? '',
          status: orderStatus,
          source: draft.platform ?? 'FACEBOOK',
          confirmedAt: confirmedAt,
          stockDecremented: true,
          negotiationRequested: draft.negotiationRequested ?? false,
          customerOfferedPrice: draft.offeredPrice ?? null,
          orderNote: combinedNote,
          customFieldsJson: Object.keys(draft.customFieldValues || {}).length
            ? JSON.stringify(draft.customFieldValues)
            : null,
          paymentStatus,
          transactionId: draft.paymentProof ?? null,
          paymentScreenshotUrl: draft.paymentScreenshotUrl ?? null,
          spamRisk: spamResult?.risk ?? 'unknown',
          spamScore: spamResult?.score ?? null,
          spamTotalOrders: spamResult?.totalOrders ?? null,
          spamDelivered: spamResult?.delivered ?? null,
          spamCancelled: spamResult?.cancelled ?? null,
          spamSource: spamResult?.source ?? null,
          spamCheckedAt: spamResult ? new Date() : null,
          loyaltyDiscountAmount: discounts.loyaltyDiscount,
          happyHourDiscountAmount: discounts.happyHourDiscount,
          milestoneDiscountAmount,
          milestoneRewardAppliedJson: milestoneRewards.length
            ? JSON.stringify(milestoneRewards.map((r) => ({ ...r, orderNumber: thisOrderNumber })))
            : null,
          ...(milestoneFreeDelivery ? { deliveryFee: 0 } : {}),
          items: {
            create: [
              ...draft.items.map((i) => ({
                productCode: i.productCode,
                qty: i.qty,
                unitPrice: i.unitPrice,
              })),
              ...milestoneRewards
                .filter((r) => r.rewardType === 'FREE_ITEM' && r.productCode)
                .map((r) => ({
                  productCode: r.productCode,
                  qty: r.qty,
                  unitPrice: 0,
                  productName: `🎁 Free — ${r.productName}`,
                })),
            ],
          },
        },
      });

      // Decrement stock atomically inside same transaction
      for (const item of draft.items) {
        await tx.product.updateMany({
          where: {
            pageId: effectivePageId,
            code: item.productCode,
            stockQty: { gt: 0 },
          },
          data: { stockQty: { decrement: item.qty } },
        });
      }

      return created;
    });

    await this.ctx.clearDraft(pageId, psid);
    await this.ctx.clearHistory(pageId, psid).catch(() => {});

    // V9: upsert CRM customer record
    const subtotal = draft.items.reduce((s, i) => s + i.unitPrice * i.qty, 0);

    // Telegram merchant alert — new order with inline buttons
    {
      const addr = (order.address || '').toLowerCase();
      const insideDhaka = DHAKA_AREA_WHITELIST.some((a) => addr.includes(a.toLowerCase()));
      const zoneLabel = order.address
        ? (insideDhaka ? '🏙️ ঢাকার ভিতরে' : '🌍 ঢাকার বাইরে')
        : '📍 ঠিকানা অজানা';
      const riskEmoji = order.spamRisk === 'high' ? '🔴' : order.spamRisk === 'medium' ? '🟡' : order.spamRisk === 'low' ? '🟢' : '⚪';
      // Manual advance proof (trxID/screenshot) needs the merchant's eye —
      // surface the proof and let them approve/reject straight from Telegram.
      const needsPayVerify = paymentStatus === 'advance_paid';
      const payLabel = needsPayVerify
        ? '⏳ Advance দিয়েছে — verify বাকি'
        : paymentStatus === 'advance_paid_verified'
          ? '✅ Advance paid'
          : paymentStatus === 'not_required' ? '💵 COD' : '⏳ Payment pending';

      const proofLines = needsPayVerify
        ? [
            `💳 Payment proof: <code>${order.transactionId ?? '-'}</code>${order.paymentScreenshotUrl ? ' (📸 screenshot পাঠিয়েছে)' : ''}`,
          ]
        : [];

      const msg = [
        `🛒 <b>New Order #${order.id}</b>`,
        `👤 ${order.customerName}`,
        `📞 ${order.phone || '-'}`,
        `📍 ${order.address || '-'} — ${zoneLabel}`,
        `💰 ৳${subtotal} | ${payLabel}`,
        ...proofLines,
        `${riskEmoji} Fraud: ${order.spamRisk ?? 'unknown'}`,
      ].join('\n');

      const buttons = [
        ...(needsPayVerify
          ? [
              [
                { text: '✅ Payment Approve', callback_data: `payok_${order.id}` },
                { text: '❌ Payment Reject', callback_data: `payfail_${order.id}` },
              ],
            ]
          : [
              [
                { text: '✅ Confirm Order', callback_data: `confirm_${order.id}` },
              ],
            ]),
        [
          { text: '🔍 Fraud Check', callback_data: `fraud_${order.id}` },
          { text: '🚚 Courier পাঠাও', callback_data: `courier_${order.id}` },
        ],
        [
          { text: `📞 Call ${order.phone || ''}`, url: `tel:${order.phone || ''}` },
        ],
      ];

      this.telegram.notifyWithButtons(pageId, msg, buttons).catch(() => {});
      this.orderOwnerMailer.sendNewOrderAlert(pageId, order.id).catch(() => {});
    }

    // Auto courier booking — only when the order is already CONFIRMED (e.g.
    // advance payment paid upfront). CourierService.autoBookOnConfirm() also
    // checks autoBookOnConfirm/defaultCourier itself and is the single
    // shared hook called from every place an order becomes CONFIRMED (see
    // orders.service.ts and call.service.ts), so a COD order confirmed
    // later via the dashboard or a confirmation call gets auto-booked too.
    if (orderStatus === 'CONFIRMED') {
      this.courier.autoBookOnConfirm(pageId, order.id).catch(() => {});
    }

    this.crm
      .upsertFromOrder(pageId, {
        customerPsid: psid,
        customerName: draft.customerName,
        phone: draft.phone,
        address: draft.address,
        totalAmount: subtotal,
      })
      .catch((e) => this.logger.error(`[CRM] upsert failed: ${e.message}`));

    // V15: increment billing order usage (non-blocking)
    this.prisma.page
      .findUnique({ where: { id: pageId }, select: { ownerId: true } })
      .then((p) => {
        if (p?.ownerId)
          this.billing.incrementOrderUsage(p.ownerId).catch(() => {});
      })
      .catch(() => {});

    // V9: schedule follow-up if enabled
    this.scheduleFollowUp(pageId, psid, order.id).catch(() => {});

    this.callService
      .triggerAutoCallIfEnabled(pageId, order.id)
      .catch((err) =>
        this.logger.error(`[AUTO-CALL] order=${order.id}: ${err}`),
      );

    this.logger.log(
      `[ORDER] Finalized #${order.id} for page ${pageId} psid=${psid}`,
    );
    return order.id;
  }

  // ── Payment problem detection ─────────────────────────────────────────────

  private isPaymentRefusal(text: string): boolean {
    const t = text.toLowerCase();
    return /দেব না|দিব না|দিতে পারব না|দিতে পারবো না|দিতে চাই না|advance দেব না|advance নেব না|অগ্রিম দেব না|অগ্রিম দিব না|cancel করুন|বাতিল করুন|cancel দেন|বাতিল দেন|cancel kro|বাদ দেন|বাদ দিন|আর চাই না|অর্ডার বাতিল|order cancel/.test(t);
  }

  private isPaymentProblem(text: string): boolean {
    const t = text.toLowerCase();
    return /সমস্যা|সমস্যায়|সমস্যাতে|problem|issue|কাজ করছে না|কাজ হচ্ছে না|হচ্ছে না|পারছি না|পরে দেব|পরে করব|পরে পাঠাব|এখন না|এখন পারব না|টাকা নেই|ব্যালেন্স নেই|balance নেই|বুঝতে পারছি না|error|fail|failed|block|blocked|সাহায্য|help|agent|ঝামেলা|trouble|ভুল|number নাই|নম্বর নেই|কাজ করতেছে না/.test(
      t,
    );
  }

  /**
   * Accepts text as a valid Transaction ID if it:
   *  - Has a labeled prefix (TrxID / Transaction ID / Ref / Txn) followed by 6-20 alphanumeric chars
   *  - OR is a Bkash/Nagad-style block: 8-15 chars containing uppercase letters + digits
   *  - OR is a pure numeric string of 8-15 digits (some banks use numeric-only refs)
   * Rejects casual chat text, single words, Bengali-only text, very short strings, etc.
   */
  private isValidTransactionId(text: string): boolean {
    const t = text.trim();
    // Labeled: "TrxID: ABC123XYZ" or "Transaction ID: 1234567890" — label makes any length ok
    if (
      /(?:TrxID|Transaction\s*ID|Ref(?:erence)?|Txn)[:\s#]*([A-Za-z0-9]{6,20})/i.test(
        t,
      )
    )
      return true;
    // Bkash/Nagad uppercase+digit block — must be 8+ chars
    if (/^[A-Z0-9]{8,15}$/.test(t)) return true;
    // Mixed alphanumeric — must be 8+ chars with both letters AND digits
    if (/^[A-Za-z0-9]{8,20}$/.test(t) && /[A-Za-z]/.test(t) && /[0-9]/.test(t))
      return true;
    // Pure numeric bank reference — must be 10+ digits (4-9 digit numbers rejected)
    if (/^\d{10,15}$/.test(t)) return true;
    return false;
  }

  /**
   * Extracts a TxID embedded in a natural sentence.
   * Handles patterns like:
   *   "আমার last digit হলো 1234"
   *   "আমার txid হলো 8N7G3DKXYZ"
   *   "last 4 digit: 5678"
   *   "আমি 8N7G3DKXYZ দিয়ে পাঠিয়েছি"
   *   "transaction id হলো ABC12345"
   * Returns the extracted TxID string, or null if not found.
   */
  private extractTxIdFromSentence(text: string): string | null {
    const t = text.trim();

    // Pattern 1: labeled — "txid হলো/is/:" followed by alphanumeric block
    const labeled = t.match(
      /(?:txid|transaction\s*id|trxid|ref|last\s*\d*\s*digit)[:\s=হলো is]+([A-Za-z0-9]{4,20})/i,
    );
    if (labeled) return labeled[1];

    // Pattern 2: "আমি XXXX দিয়ে / পাঠিয়েছি / করেছি"
    const sent = t.match(
      /(?:আমি|আমার)\s+([A-Za-z0-9]{6,20})\s+(?:দিয়ে|পাঠিয়েছি|করেছি|send|পাঠাইছি)/i,
    );
    if (sent) return sent[1];

    // Pattern 3: sentence contains exactly one valid-looking TxID block (uppercase+digit, 6-20 chars)
    const blocks = t.match(/\b[A-Z0-9]{6,20}\b/g);
    if (blocks?.length === 1) return blocks[0];

    // Pattern 4: last 4 digits mentioned — extract the number
    const lastDigit = t.match(/last\s*(?:4|char|digit)[^\d]*(\d{4})/i);
    if (lastDigit) return lastDigit[1];

    return null;
  }

  // ── Payment mode helpers ──────────────────────────────────────────────────

  calcAdvanceAmount(draft: DraftSession, page: any): number {
    const sym = page.currencySymbol || '৳';
    const fee = this.zoneDeliveryFee(draft.address || '', page);
    const subtotal = draft.items.reduce(
      (s: number, i: any) => s + i.unitPrice * i.qty,
      0,
    );
    const mode = (page.paymentMode as string) || 'cod';
    if (mode === 'full_advance') return subtotal + fee;
    return page.advanceAmount && Number(page.advanceAmount) > 0
      ? Number(page.advanceAmount)
      : fee;
  }

  private isAdvanceNeeded(draft: DraftSession, page: any): boolean {
    if (draft.paymentProof) return false; // already collected — never re-ask

    // COD entirely disabled by merchant → advance always required, regardless of
    // paymentMode/threshold (merchant said "no COD", not "COD above X taka").
    if (page.codEnabled === false) return true;

    const mode = (page.paymentMode as string) || 'cod';
    if (mode === 'cod') return false;

    // Order-value threshold: skip advance when subtotal is at/under the configured amount.
    const threshold = Number(page.advanceThresholdAmount) || 0;
    if (threshold > 0) {
      const subtotal = draft.items.reduce(
        (s: number, i: any) => s + i.unitPrice * i.qty,
        0,
      );
      if (subtotal <= threshold) return false;
    }

    if (mode === 'full_advance') return true;
    if (mode === 'advance_outside') {
      return !this.isInsideDhaka(draft.address || '', page);
    }
    return false;
  }

  buildAdvancePrompt(page: any, draft: DraftSession): string {
    const sym = page.currencySymbol || '৳';
    const mode = (page.paymentMode as string) || 'cod';
    const fee = this.zoneDeliveryFee(draft.address || '', page);
    const subtotal = draft.items.reduce((s, i) => s + i.unitPrice * i.qty, 0);

    let amount: number;
    if (mode === 'full_advance') {
      amount = subtotal + fee;
    } else {
      amount =
        page.advanceAmount && Number(page.advanceAmount) > 0
          ? Number(page.advanceAmount)
          : fee;
    }

    // Use client's custom template if set
    if (page.advancePaymentMessage?.trim()) {
      return page.advancePaymentMessage
        .replace(/\{\{amount\}\}/g, `${sym}${amount}`)
        .replace(/\{\{bkash\}\}/g, page.advanceBkash || '')
        .replace(/\{\{nagad\}\}/g, page.advanceNagad || '')
        .replace(/\{\{rocket\}\}/g, page.advanceRocket || '')
        .replace(/\{\{currency\}\}/g, sym);
    }

    // Default template
    const lines = [
      mode === 'full_advance'
        ? `💳 *Full Advance Payment প্রয়োজন*`
        : `💳 *Advance Payment প্রয়োজন* (Outside Dhaka)`,
      `পরিমাণ: ${sym}${amount}`,
      '',
    ];
    if (page.advanceBkash)
      lines.push(`📱 Bkash (Send Money): ${page.advanceBkash}`);
    if (page.advanceNagad)
      lines.push(`📱 Nagad (Send Money): ${page.advanceNagad}`);
    if (page.advanceRocket)
      lines.push(`📱 Rocket (Send Money): ${page.advanceRocket}`);
    lines.push('');
    lines.push('Payment করার পর **Transaction ID** অথবা screenshot পাঠান 💖');
    return lines.join('\n');
  }

  /** Returns manual account lines for appending to gateway payment messages */
  buildManualAccountLines(page: any): string {
    const lines: string[] = [];
    if (page.advanceBkash) lines.push(`📱 Bkash: ${page.advanceBkash}`);
    if (page.advanceNagad) lines.push(`📱 Nagad: ${page.advanceNagad}`);
    if (page.advanceRocket) lines.push(`📱 Rocket: ${page.advanceRocket}`);
    return lines.join('\n');
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Try to extract phone, name, and/or address from a single customer message.
   * Works for combined inputs like "Limon 01720450797 Mirpur, Dhaka"
   * as well as single sends like "Limon" or "01720450797".
   */
  parseCustomerInfo(text: string): {
    name?: string;
    phone?: string;
    address?: string;
  } {
    const result: { name?: string; phone?: string; address?: string } = {};
    let remaining = text.trim();

    // 1. Extract phone number (also handles Bangla digits)
    const normalized = remaining.replace(/[০-৯]/g, (d) =>
      String('০১২৩৪৫৬৭৮৯'.indexOf(d)),
    );
    const phoneMatch = normalized.match(/(?:\+?88)?01[3-9]\d{8}/);
    if (phoneMatch) {
      result.phone = phoneMatch[0];
      const phoneIdx = normalized.indexOf(phoneMatch[0]);
      remaining = (
        remaining.slice(0, phoneIdx) +
        remaining.slice(phoneIdx + phoneMatch[0].length)
      )
        .trim()
        .replace(/\s{2,}/g, ' ');
    }

    if (!remaining) return result;

    // 2. Classify remaining text as name / address
    const parts = remaining
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const hasComma = parts.length >= 2;
    const hasGeo = this.hasGeoKeyword(remaining);
    const isLong = remaining.length >= 25;

    if (hasComma) {
      // "Name, Area, District" — first short non-geo part = name, rest = address
      const first = parts[0];
      const firstIsName =
        first.length <= 35 &&
        first.split(' ').length <= 4 &&
        !this.hasGeoKeyword(first);
      if (firstIsName) {
        result.name = first;
        result.address = parts.slice(1).join(', ');
      } else {
        result.address = remaining;
      }
    } else if (hasGeo || isLong) {
      result.address = remaining;
    } else if (remaining.length <= 50 && remaining.split(' ').length <= 5) {
      result.name = remaining;
    }

    return result;
  }

  private hasGeoKeyword(text: string): boolean {
    return /\b(road|rd|house|flat|village|gram|para|ward|thana|upazila|district|zila|জেলা|থানা|উপজেলা|বাসা|রোড|গ্রাম|পাড়া|মহল্লা|mirpur|uttara|dhaka|ঢাকা|chittagong|চট্টগ্রাম|sylhet|সিলেট|rajshahi|রাজশাহী|khulna|খুলনা|barisal|বরিশাল|rangpur|রংপুর|mymensingh|ময়মনসিংহ|tangail|টাঙ্গাইল|narayanganj|gazipur|comilla|cumilla|noakhali|brahmanbaria|feni|cox|faridpur|jessore|jashore|dinajpur|bogra|bogura|sirajganj|pabna|jamalpur|netrokona|kishoreganj|manikganj|munshiganj|narsingdi|sherpur|habiganj|moulvibazar|kalihati|ellenga|savar|সাভার|ashulia|আশুলিয়া|keraniganj|কেরানীগঞ্জ|dohar|নবাবগঞ্জ|nawabganj|tongi|টঙ্গী|gazipur|গাজীপুর|kaliakair|কালিয়াকৈর|kapasia|sreepur|মাওনা|maona|dhamrai|ধামরাই|manikganj|মানিকগঞ্জ|singair|শিবালয়|saturia|harirampur|ghior|munshiganj|মুন্সীগঞ্জ|sirajdikhan|louhajang|sreenagar|gazaria|laksam|chandpur|lakshmipur|noakhali|feni|comilla|cumilla|brahmanbaria|habiganj|moulvibazar|sylhet|sunamganj|netrokona|kishoreganj|mymensingh|sherpur|jamalpur|rangpur|dinajpur|thakurgaon|panchagarh|nilphamari|lalmonirhat|kurigram|gaibandha|joypurhat|naogaon|chapai|nawabganj|rajshahi|natore|sirajganj|pabna|kushtia|meherpur|chuadanga|jhenaidah|magura|narail|satkhira|khulna|bagerhat|pirojpur|jhalokathi|barguna|patuakhali|barisal|bhola|madaripur|shariatpur|gopalganj|faridpur|rajbari|jessore|jashore|narsingdi|gazipur|narayanganj|munshiganj|manikganj|dhaka|ঢাকা)\b/i.test(
      text,
    );
  }

  private static readonly NAME_DENYLIST = new Set([
    'ok', 'okk', 'okay', 'okey', 'k', 'kk',
    'hi', 'hii', 'hello', 'hey',
    'yes', 'ya', 'na', 'no',
    'thanks', 'thank you', 'tnx', 'thx',
    'হ্যাঁ', 'জি', 'জি হ্যাঁ', 'আচ্ছা', 'ধন্যবাদ',
    'thik', 'thik ache', 'thik ase', 'accha', 'achha',
  ]);

  /** True for greeting/affirmation filler words that should never be captured as a name. */
  private isFillerWord(text: string): boolean {
    const clean = text.trim().toLowerCase().replace(/[.,!?।~]/g, '').trim();
    return !clean || DraftOrderHandler.NAME_DENYLIST.has(clean);
  }

  /** Heuristic: does this look like a genuine question rather than field data? */
  looksLikeQuestion(text: string): boolean {
    const t = text.trim();
    return t.includes('?') || (t.includes('।') === false && /কি|কী|কেন|কোন|কত/.test(t));
  }

  private extractPhone(text: string): string | null {
    const normalized = text.replace(/[০-৯]/g, (d) =>
      String('০১২৩৪৫৬৭৮৯'.indexOf(d)),
    );
    const m = normalized.match(/(?:\+?88)?01[3-9]\d{8}/);
    return m ? m[0] : null;
  }

  /**
   * Fast regex-based capture decision — runs BEFORE AI to avoid false rejects.
   *
   * Returns:
   *   'CANCEL'   → clear draft immediately
   *   string     → clean captured value (use as workingText, skip AI)
   *   null       → inconclusive, let AI decide
   */
  private tryRegexCapture(
    step: string,
    text: string,
  ): string | 'CANCEL' | null {
    const t = text.trim();

    // Always treat explicit cancel keywords as CANCEL regardless of step
    if (this.botIntent.detectIntent(t, false) === 'CANCEL') return 'CANCEL';

    if (step === 'phone') {
      const ph = this.extractPhone(t);
      if (ph) return ph; // clear phone → CAPTURE directly
      // No phone found — let AI decide if it's RETRY or EXIT_DRAFT
      return null;
    }

    if (step === 'address') {
      if (this.isAddressLike(t)) return t; // clearly address → CAPTURE
      return null;
    }

    if (step === 'name') {
      // Short text with no phone, no geo keyword, no question mark, no product code,
      // and not a generic filler/greeting word → name
      const hasPhone = /\d{7,}/.test(t);
      const hasCode = /\bDF[-\s]?\d{3,}/i.test(t);
      const isShort = t.length <= 50 && t.split(' ').length <= 6;
      if (
        isShort &&
        !hasPhone &&
        !this.looksLikeQuestion(t) &&
        !hasCode &&
        !this.hasGeoKeyword(t) &&
        !this.isFillerWord(t)
      ) {
        return t;
      }
      return null;
    }

    // For confirm/advance_payment/custom fields — let AI handle
    return null;
  }

  promptForCustomField(field: CustomFieldDef): string {
    const help = field.helpText ? `\n💡 ${field.helpText}` : '';
    const skip = field.optional ? `\n(না থাকলে "না" লিখুন)` : '';
    if (field.choices?.length) {
      const opts = field.choices.map((c, i) => `${i + 1}. ${c}`).join('\n');
      return `${field.label} কোনটা নেবেন? 💖\n${opts}${help}${skip}`;
    }
    return `${field.label} জানান 💖${help}${skip}`;
  }

  isInsideDhaka(address: string, page: any): boolean {
    return isInsideDhakaAddress(address, page);
  }

  private isAddressLike(text: string): boolean {
    const t = text.trim();
    if (t.length < 8) return false;
    return (
      t.length >= 15 ||
      t.includes(',') ||
      this.hasGeoKeyword(t) ||
      /road|rd|house|flat|village|gram|para|ward|floor|apt|block|sector|zone|thana|upazila|district|zila|জেলা|থানা|উপজেলা|বাসা|রোড|গ্রাম|পাড়া|মহল্লা|ইউনিয়ন/i.test(
        t,
      )
    );
  }

  private async scheduleFollowUp(
    pageId: number,
    psid: string,
    orderId: number,
  ) {
    const settings = await this.followUpSvc.getSettings(pageId);
    if (!settings.orderReceivedEnabled) return;
    await this.followUpSvc.schedule(pageId, {
      psid,
      orderId,
      triggerType: 'order_received',
      message: settings.orderReceivedMsg.replace(
        '{{orderId}}',
        String(orderId),
      ),
      delayHours: settings.orderReceivedDelay,
    });
  }
}
