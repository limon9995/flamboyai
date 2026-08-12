-- V18: Image recognition migration
-- Run on VPS with: psql -U FlamboyAI -d flamboyai < v18_image_recognition.sql
-- Or copy-paste into psql directly

-- Product table: new image recognition metadata columns
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "category"      TEXT,
  ADD COLUMN IF NOT EXISTS "color"         TEXT,
  ADD COLUMN IF NOT EXISTS "tags"          TEXT,
  ADD COLUMN IF NOT EXISTS "imageKeywords" TEXT,
  ADD COLUMN IF NOT EXISTS "aiDescription" TEXT;

-- Page table: new image recognition feature flags
ALTER TABLE "Page"
  ADD COLUMN IF NOT EXISTS "imageRecognitionOn"    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "imageHighConfidence"   DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  ADD COLUMN IF NOT EXISTS "imageMediumConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.45,
  ADD COLUMN IF NOT EXISTS "imageFallbackAiOn"     BOOLEAN NOT NULL DEFAULT FALSE;
