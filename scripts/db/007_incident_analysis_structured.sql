-- Structured AI Insight briefs (see src/utils/structuredBrief.ts). The model
-- now fills fixed fields (urgency-tagged next actions, executive bottom line,
-- etc.) instead of free-form markdown; this column holds that JSON and is
-- what the dashboard and PDF render from. technical_brief/executive_brief
-- keep being written with a plain-text rendering of the same content.
--
-- Nullable: rows created before this migration have no structured form and
-- render through the legacy markdown path.

ALTER TABLE incident_analysis ADD COLUMN IF NOT EXISTS briefs_structured JSONB;
