// Global, fixed character-count tier for TEXT and SMART_BOT AI replies.
// Not admin-editable and not per-page — see the pricing plan for rationale.
// totalChars = system prompt (incl. product name+description context) length
//            + customer message length + AI reply length, summed.
export const TEXT_TIER_BASE_CREDITS = 10;
export const TEXT_TIER_CHAR_THRESHOLD = 3000;
export const TEXT_TIER_CHAR_STEP = 2000;

export function computeTextTierCredits(totalChars: number): number {
  if (totalChars <= TEXT_TIER_CHAR_THRESHOLD) return TEXT_TIER_BASE_CREDITS;
  return (
    TEXT_TIER_BASE_CREDITS +
    Math.ceil((totalChars - TEXT_TIER_CHAR_THRESHOLD) / TEXT_TIER_CHAR_STEP)
  );
}
