// V29: merchant-defined order fields ("Edit Order Fields").
// Definitions live in Page.orderFieldsJson; captured values live in
// Order.customFieldsJson keyed by field label (same shape the bot already uses
// for product variant fields in DraftSession.customFieldValues).

export type OrderFieldType = 'text' | 'number' | 'select';

export interface OrderFieldDef {
  key: string;
  label: string;
  type: OrderFieldType;
  choices: string[];
  helpText: string;
  optional: boolean;
  visibleToAi: boolean;
}

const MAX_FIELDS = 20;

function slugify(label: string, used: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'field';
  let key = base;
  let n = 2;
  while (used.has(key)) key = `${base}_${n++}`;
  used.add(key);
  return key;
}

/** Validates/cleans a raw field list (from the dashboard or the DB). */
export function normalizeOrderFields(raw: unknown): OrderFieldDef[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const seenLabels = new Set<string>();
  const out: OrderFieldDef[] = [];
  for (const item of raw.slice(0, MAX_FIELDS)) {
    const label = String((item as any)?.label ?? '').trim().slice(0, 60);
    if (!label || seenLabels.has(label.toLowerCase())) continue;
    seenLabels.add(label.toLowerCase());
    const type: OrderFieldType = ['text', 'number', 'select'].includes(
      (item as any)?.type,
    )
      ? (item as any).type
      : 'text';
    const choices =
      type === 'select' && Array.isArray((item as any)?.choices)
        ? (item as any).choices
            .map((c: unknown) => String(c).trim().slice(0, 60))
            .filter(Boolean)
            .slice(0, 30)
        : [];
    const rawKey = String((item as any)?.key ?? '').trim();
    const key =
      /^[a-z0-9_]{1,40}$/.test(rawKey) && !used.has(rawKey)
        ? (used.add(rawKey), rawKey)
        : slugify(label, used);
    out.push({
      key,
      label,
      type: type === 'select' && choices.length === 0 ? 'text' : type,
      choices,
      helpText: String((item as any)?.helpText ?? '').trim().slice(0, 200),
      optional: Boolean((item as any)?.optional),
      visibleToAi: Boolean((item as any)?.visibleToAi),
    });
  }
  return out;
}

export function parseOrderFields(json: string | null | undefined): OrderFieldDef[] {
  if (!json) return [];
  try {
    return normalizeOrderFields(JSON.parse(json));
  } catch {
    return [];
  }
}

export function parseCustomFieldValues(
  json: string | null | undefined,
): Record<string, string> {
  if (!json) return {};
  try {
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, String(v ?? '')]),
    );
  } catch {
    return {};
  }
}

/**
 * Queues the page's AI-visible order fields into the draft (once per draft)
 * and points currentStep at the first one. Returns true when something was
 * queued — the caller must then ask that field instead of moving to
 * payment/confirm. Draft is typed loosely to keep this module dependency-free.
 */
export function queueAiOrderFields(
  draft: {
    currentStep: string;
    orderFieldsQueued?: boolean;
    pendingCustomFields?: Array<{
      label: string;
      choices?: string[];
      optional?: boolean;
      helpText?: string;
    }>;
    customFieldValues?: Record<string, string>;
  },
  page: { orderFieldsJson?: string | null } | null | undefined,
): boolean {
  if (draft.orderFieldsQueued) return false;
  draft.orderFieldsQueued = true;
  const answered = new Set(
    Object.keys(draft.customFieldValues || {}).map((k) => k.toLowerCase()),
  );
  const queued = parseOrderFields(page?.orderFieldsJson)
    .filter((f) => f.visibleToAi && !answered.has(f.label.toLowerCase()))
    .map((f) => ({
      label: f.label,
      choices: f.choices,
      optional: f.optional,
      helpText: f.helpText,
    }));
  if (!queued.length) return false;
  draft.pendingCustomFields = [...(draft.pendingCustomFields || []), ...queued];
  draft.currentStep = `cf:${draft.pendingCustomFields[0].label}`;
  return true;
}

/** Replies that mean "skip this optional field". */
export function isSkipReply(text: string): boolean {
  return /^(skip|no|na|nai|nei|না|নাই|নেই|দরকার নেই|লাগবে না|-)$/i.test(
    text.trim(),
  );
}
