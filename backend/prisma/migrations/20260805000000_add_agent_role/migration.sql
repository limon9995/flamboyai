-- Adds the "agent" (reseller/partner) role: referral attribution on User,
-- plus append-only AgentEarning / AgentPayout commission ledgers. All new
-- User columns are nullable and both new tables start empty — no backfill
-- needed, and existing admin/client rows/flows are completely unaffected.

ALTER TABLE "User" ADD COLUMN "commissionPercentRecharge" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN "commissionPercentSubscription" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN "referredByAgentId" TEXT;

CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");
CREATE INDEX "User_referredByAgentId_idx" ON "User"("referredByAgentId");

ALTER TABLE "User" ADD CONSTRAINT "User_referredByAgentId_fkey"
    FOREIGN KEY ("referredByAgentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AgentEarning" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUserId" TEXT NOT NULL,
    "sourcePageId" INTEGER,
    "grossAmountBdt" DOUBLE PRECISION NOT NULL,
    "commissionPercent" DOUBLE PRECISION NOT NULL,
    "commissionAmountBdt" DOUBLE PRECISION NOT NULL,
    "referenceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEarning_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentEarning_agentId_idx" ON "AgentEarning"("agentId");
CREATE INDEX "AgentEarning_agentId_createdAt_idx" ON "AgentEarning"("agentId", "createdAt");

ALTER TABLE "AgentEarning" ADD CONSTRAINT "AgentEarning_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AgentPayout" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "amountBdt" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "paidByAdminUsername" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPayout_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentPayout_agentId_idx" ON "AgentPayout"("agentId");
CREATE INDEX "AgentPayout_agentId_createdAt_idx" ON "AgentPayout"("agentId", "createdAt");

ALTER TABLE "AgentPayout" ADD CONSTRAINT "AgentPayout_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
