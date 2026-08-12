-- Credit-based pricing system: replaces the flat BDT wallet with a new
-- "credit" currency. Existing BDT balances/prices are rescaled at
-- 1 BDT = 40 credit so no page loses value; per-unit prices are rounded to
-- the nearest whole credit (minimum 1). Text/SmartBot no longer use a flat
-- per-page rate — costPerTextMsgBdt is dropped outright (see
-- backend/src/wallet/text-tier-pricing.ts for the new global tier formula).

-- ── CreditPackage (admin-managed fixed recharge packages) ────────────────
CREATE TABLE "CreditPackage" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "priceBdt" DOUBLE PRECISION NOT NULL,
    "credits" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditPackage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CreditPackage_isActive_idx" ON "CreditPackage"("isActive");

INSERT INTO "CreditPackage" ("name", "priceBdt", "credits", "sortOrder", "updatedAt")
VALUES
    ('Starter', 2000, 75000, 0, CURRENT_TIMESTAMP),
    ('Growth', 2500, 100000, 1, CURRENT_TIMESTAMP);

-- ── Page.walletBalanceBdt → Page.creditBalance ────────────────────────────
ALTER TABLE "Page" ADD COLUMN "creditBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;
UPDATE "Page" SET "creditBalance" = ROUND(CAST("walletBalanceBdt" * 40 AS numeric), 0);
ALTER TABLE "Page" DROP COLUMN "walletBalanceBdt";

-- ── Page pricing fields: Bdt → Credit (rescaled ×40, rounded, min 1) ──────
ALTER TABLE "Page" ADD COLUMN "costPerVoiceMsgCredit" DOUBLE PRECISION NOT NULL DEFAULT 40;
UPDATE "Page" SET "costPerVoiceMsgCredit" = GREATEST(1, ROUND(CAST("costPerVoiceMsgBdt" * 40 AS numeric), 0));
ALTER TABLE "Page" DROP COLUMN "costPerVoiceMsgBdt";

ALTER TABLE "Page" ADD COLUMN "costPerImageCredit" DOUBLE PRECISION NOT NULL DEFAULT 8;
UPDATE "Page" SET "costPerImageCredit" = GREATEST(1, ROUND(CAST("costPerImageBdt" * 40 AS numeric), 0));
ALTER TABLE "Page" DROP COLUMN "costPerImageBdt";

ALTER TABLE "Page" ADD COLUMN "costPerImageLocalCredit" DOUBLE PRECISION NOT NULL DEFAULT 4;
UPDATE "Page" SET "costPerImageLocalCredit" = GREATEST(1, ROUND(CAST("costPerImageLocalBdt" * 40 AS numeric), 0));
ALTER TABLE "Page" DROP COLUMN "costPerImageLocalBdt";

ALTER TABLE "Page" ADD COLUMN "costPerAnalyzeCredit" DOUBLE PRECISION NOT NULL DEFAULT 8;
UPDATE "Page" SET "costPerAnalyzeCredit" = GREATEST(1, ROUND(CAST("costPerAnalyzeBdt" * 40 AS numeric), 0));
ALTER TABLE "Page" DROP COLUMN "costPerAnalyzeBdt";

ALTER TABLE "Page" ADD COLUMN "costPerAiGenerateCredit" DOUBLE PRECISION NOT NULL DEFAULT 4;
UPDATE "Page" SET "costPerAiGenerateCredit" = GREATEST(1, ROUND(CAST("costPerAiGenerateBdt" * 40 AS numeric), 0));
ALTER TABLE "Page" DROP COLUMN "costPerAiGenerateBdt";

ALTER TABLE "Page" ADD COLUMN "costPerKeywordReplyCredit" DOUBLE PRECISION NOT NULL DEFAULT 1;
UPDATE "Page" SET "costPerKeywordReplyCredit" = GREATEST(1, ROUND(CAST("costPerKeywordReplyBdt" * 40 AS numeric), 0));
ALTER TABLE "Page" DROP COLUMN "costPerKeywordReplyBdt";

ALTER TABLE "Page" ADD COLUMN "costPerBroadcastMsgCredit" DOUBLE PRECISION NOT NULL DEFAULT 2;
UPDATE "Page" SET "costPerBroadcastMsgCredit" = GREATEST(1, ROUND(CAST("costPerBroadcastMsgBdt" * 40 AS numeric), 0));
ALTER TABLE "Page" DROP COLUMN "costPerBroadcastMsgBdt";

ALTER TABLE "Page" ADD COLUMN "costPerOcrLocalCredit" DOUBLE PRECISION NOT NULL DEFAULT 1;
UPDATE "Page" SET "costPerOcrLocalCredit" = GREATEST(1, ROUND(CAST("costPerOcrLocalBdt" * 40 AS numeric), 0));
ALTER TABLE "Page" DROP COLUMN "costPerOcrLocalBdt";

ALTER TABLE "Page" ADD COLUMN "costPerOcrAiCredit" DOUBLE PRECISION NOT NULL DEFAULT 2;
UPDATE "Page" SET "costPerOcrAiCredit" = GREATEST(1, ROUND(CAST("costPerOcrAiBdt" * 40 AS numeric), 0));
ALTER TABLE "Page" DROP COLUMN "costPerOcrAiBdt";

ALTER TABLE "Page" ADD COLUMN "costPerRecurringNotifCredit" DOUBLE PRECISION NOT NULL DEFAULT 4;
UPDATE "Page" SET "costPerRecurringNotifCredit" = GREATEST(1, ROUND(CAST("costPerRecurringNotifBdt" * 40 AS numeric), 0));
ALTER TABLE "Page" DROP COLUMN "costPerRecurringNotifBdt";

ALTER TABLE "Page" ADD COLUMN "costPerCommentReplyCredit" DOUBLE PRECISION NOT NULL DEFAULT 2;
UPDATE "Page" SET "costPerCommentReplyCredit" = GREATEST(1, ROUND(CAST("costPerCommentReplyBdt" * 40 AS numeric), 0));
ALTER TABLE "Page" DROP COLUMN "costPerCommentReplyBdt";

ALTER TABLE "Page" ADD COLUMN "costPerMemoPrintCredit" DOUBLE PRECISION NOT NULL DEFAULT 4;
UPDATE "Page" SET "costPerMemoPrintCredit" = GREATEST(1, ROUND(CAST("costPerMemoPrintBdt" * 40 AS numeric), 0));
ALTER TABLE "Page" DROP COLUMN "costPerMemoPrintBdt";

-- Text/SmartBot per-page flat rate removed entirely — replaced by the global
-- fixed character-count tier formula (not a Page column any more).
ALTER TABLE "Page" DROP COLUMN "costPerTextMsgBdt";

-- ── WalletTransaction.amountBdt → amountCredit ────────────────────────────
ALTER TABLE "WalletTransaction" ADD COLUMN "amountCredit" DOUBLE PRECISION;
UPDATE "WalletTransaction" SET "amountCredit" = "amountBdt" * 40;
ALTER TABLE "WalletTransaction" ALTER COLUMN "amountCredit" SET NOT NULL;
ALTER TABLE "WalletTransaction" DROP COLUMN "amountBdt";

-- ── WalletRechargeRequest: keep amountBdt (real money paid), add credit fields ──
ALTER TABLE "WalletRechargeRequest" ADD COLUMN "creditsAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "WalletRechargeRequest" ADD COLUMN "packageId" INTEGER;
UPDATE "WalletRechargeRequest" SET "creditsAmount" = "amountBdt" * 40 WHERE "status" = 'approved';

ALTER TABLE "WalletRechargeRequest" ADD CONSTRAINT "WalletRechargeRequest_packageId_fkey"
    FOREIGN KEY ("packageId") REFERENCES "CreditPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WalletRechargeRequest_packageId_idx" ON "WalletRechargeRequest"("packageId");
