/**
 * Client-configurable buttons for Messenger generic-template product cards.
 *
 * Each page can define its own set of up to MAX_CARD_BUTTONS buttons that
 * appear on every product card sent to customers (vision-match cards,
 * catalog fallback cards, single-product info cards, ...). When a page has
 * no config saved (productCardButtonsJson is null), each call site falls
 * back to its own historical hardcoded button set — existing pages see zero
 * behavior change until the client opts in from Settings.
 *
 * Pure functions — imported directly (no DI), same style as
 * restaurant-delivery.ts.
 */

export type CardButtonType = 'order' | 'details' | 'custom';

export interface CardButtonConfig {
  id: string;
  type: CardButtonType;
  label: string;
  /** 'custom' only: opens this URL (web_url button). */
  url?: string;
  /** 'custom' only: sent back to the customer as a text reply when clicked (postback button). */
  replyText?: string;
}

export interface MessengerCardButton {
  type: 'web_url' | 'postback';
  title: string;
  url?: string;
  payload?: string;
}

export const MAX_CARD_BUTTONS = 3;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** Postback payload prefix routed back to a custom-reply button's config. */
export const CUSTOM_CARD_BTN_PREFIX = 'CARDBTN:';

/**
 * Parse productCardButtonsJson safely: drop invalid entries, cap the row
 * count. Returns [] on any malformed input or when unset — callers treat []
 * as "use the legacy default for this card".
 */
export function parseCardButtons(
  json: string | null | undefined,
): CardButtonConfig[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b: any): CardButtonConfig | null => {
      const id = String(b?.id ?? '').trim();
      const type = b?.type;
      const label = String(b?.label ?? '').trim().slice(0, 30);
      if (!ID_RE.test(id) || !label) return null;
      if (type === 'order' || type === 'details') {
        return { id, type, label };
      }
      if (type === 'custom') {
        const url = typeof b?.url === 'string' ? b.url.trim() : '';
        const replyText =
          typeof b?.replyText === 'string' ? b.replyText.trim().slice(0, 500) : '';
        if (url && /^https?:\/\//i.test(url)) {
          return { id, type, label, url };
        }
        if (replyText) {
          return { id, type, label, replyText };
        }
        return null; // custom button with neither action configured
      }
      return null;
    })
    .filter((b): b is CardButtonConfig => b !== null)
    .slice(0, MAX_CARD_BUTTONS);
}

/**
 * Build the Messenger button array for one product card. When the page has
 * no valid config, `fallback` (the call site's existing hardcoded buttons)
 * is returned unchanged.
 */
export function buildProductCardButtons(
  page: { productCardButtonsJson?: string | null; websiteUrl?: string | null },
  product: { code: string; productUrl: string },
  fallback: MessengerCardButton[],
): MessengerCardButton[] {
  const configured = parseCardButtons(page.productCardButtonsJson);
  if (!configured.length) return fallback;

  const usesOwnWebsite = !!String(page.websiteUrl || '').trim();
  return configured.map((btn): MessengerCardButton => {
    if (btn.type === 'order') {
      return { type: 'postback', title: btn.label, payload: `ORDER_${product.code}` };
    }
    if (btn.type === 'details') {
      return usesOwnWebsite
        ? { type: 'postback', title: btn.label, payload: `DETAILS_${product.code}` }
        : { type: 'web_url', title: btn.label, url: product.productUrl };
    }
    // custom
    if (btn.url) {
      return { type: 'web_url', title: btn.label, url: btn.url };
    }
    return {
      type: 'postback',
      title: btn.label,
      payload: `${CUSTOM_CARD_BTN_PREFIX}${btn.id}:${product.code}`,
    };
  });
}
