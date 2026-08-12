-- AlterTable: MilestoneReward — supports rewardType = "DISCOUNT" (% off subtotal)
ALTER TABLE "MilestoneReward" ADD COLUMN "discountPercent" DOUBLE PRECISION;

-- AlterTable: Order — amount actually discounted by a DISCOUNT-type milestone reward
ALTER TABLE "Order" ADD COLUMN "milestoneDiscountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
