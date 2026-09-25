-- Configurable bot auto-resume duration, spam-repeat suppression tracking,
-- and real (enforced) COD / advance-threshold controls.

ALTER TABLE "Page" ADD COLUMN "agentHandlingHours" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "Page" ADD COLUMN "codEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Page" ADD COLUMN "advanceThresholdAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "ConversationSession" ADD COLUMN "lastInboundMsg" TEXT;
