// Deterministic AI-wallet cost estimator — used by FlamboyAI's own sales bots
// (Facebook Page + website chat widget) so pricing answers are computed by
// real code instead of an LLM guessing arithmetic.

export interface PricingCalcInput {
  customersPerDay: number;
  msgsPerCustomer: number;
  imagesPerCustomer: number;
}

const KEYWORD_RATE_BDT = 0.02; // fixed/template reply, no AI call
const SMARTBOT_RATE_BDT = 0.1; // single-AI-call reply (2x plain AI text rate)
const IMAGE_RATE_BDT = 0.2; // customer image — Vision AI
const DAYS_PER_MONTH = 30;
const SETUP_FEE_BDT = 2000;

function sanitize(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function estimateMonthlyCost(input: PricingCalcInput): string {
  const customersPerDay = sanitize(input.customersPerDay);
  const msgsPerCustomer = sanitize(input.msgsPerCustomer);
  const imagesPerCustomer = sanitize(input.imagesPerCustomer);

  const totalMsgsPerDay = customersPerDay * msgsPerCustomer;
  const totalImagesPerDay = customersPerDay * imagesPerCustomer;

  const lowDaily = totalMsgsPerDay * KEYWORD_RATE_BDT + totalImagesPerDay * IMAGE_RATE_BDT;
  const highDaily = totalMsgsPerDay * SMARTBOT_RATE_BDT + totalImagesPerDay * IMAGE_RATE_BDT;

  const lowMonthly = Math.round(lowDaily * DAYS_PER_MONTH);
  const highMonthly = Math.round(highDaily * DAYS_PER_MONTH);

  return [
    `প্রতিদিন আনুমানিক ${Math.round(totalMsgsPerDay)}টা message ও ${Math.round(totalImagesPerDay)}টা ছবি handle হবে।`,
    `৩০ দিনে AI wallet খরচ আনুমানিক ৳${lowMonthly}–৳${highMonthly} (bot mode অনুযায়ী কম-বেশি হতে পারে)।`,
    `+ Setup fee ৳${SETUP_FEE_BDT} (একবার) — নিজে setup করলে একদম FREE।`,
  ].join('\n');
}
