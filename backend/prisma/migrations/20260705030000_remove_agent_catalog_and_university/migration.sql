-- Removes the multi-agent catalog/request system and the University mode
-- subsystem. The product now ships with a single fixed bot agent; tone is
-- controlled per-page via Page.customPersonaPrompt (unaffected by this migration).

-- ── University automation (child tables first, FK order) ────────────────────
DROP TABLE IF EXISTS "GroupLink";
DROP TABLE IF EXISTS "UniversityNotice";
DROP TABLE IF EXISTS "UniversityFaq";
DROP TABLE IF EXISTS "UniversityConfig";

-- ── Bot agent catalog / custom agent requests ────────────────────────────────
DROP TABLE IF EXISTS "AgentRequest";
DROP TABLE IF EXISTS "BotAgentDefinition";

-- ── Page columns no longer used ──────────────────────────────────────────────
ALTER TABLE "Page" DROP COLUMN IF EXISTS "universityModeOn";
ALTER TABLE "Page" DROP COLUMN IF EXISTS "universityModeAllowed";
ALTER TABLE "Page" DROP COLUMN IF EXISTS "agentType";
