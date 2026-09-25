-- Adds merchant-defined order fields ("Edit Order Fields") and the per-order
-- values captured for them. Both nullable — no backfill needed.
ALTER TABLE "Page" ADD COLUMN "orderFieldsJson" TEXT;
ALTER TABLE "Order" ADD COLUMN "customFieldsJson" TEXT;
