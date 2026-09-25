-- Adds Page.behaviorInstructions — client-authored supplementary business
-- rules injected into the AI prompt, separate from knowledgeText (FAQ) and
-- customPersonaPrompt (tone). Default "" — no backfill needed, existing rows
-- just get "".
ALTER TABLE "Page" ADD COLUMN "behaviorInstructions" TEXT NOT NULL DEFAULT '';
