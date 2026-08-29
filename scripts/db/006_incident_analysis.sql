-- Phase 1 of the Incident Briefing Engine design doc (Bedrock-generated
-- technical/executive briefs per incident trigger event). One row per
-- (provider, incident_id, trigger_event) analysis run, not one row per
-- incident — a single incident accumulates rows over its lifetime as it
-- moves new -> content_changed (possibly several times) -> resolved, which
-- is what lets /api/analysis/run's debounce check look up
-- MAX(created_at) per (provider, incident_id) instead of assuming a single
-- row per incident.
--
-- technical_brief/executive_brief are nullable: a status='failed' row (a
-- Bedrock error, a malformed tool-use response) has no brief to store, only
-- an `error` message. pdf_technical_url/pdf_executive_url are created now,
-- unpopulated, because a later phase needs them and adding columns then
-- would be a second migration for no reason.

CREATE TABLE IF NOT EXISTS incident_analysis (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           TEXT NOT NULL,
  incident_id        TEXT NOT NULL,
  trigger_event      TEXT NOT NULL,       -- new | content_changed | resolved
  incident_snapshot  JSONB NOT NULL,
  technical_brief    TEXT,
  executive_brief    TEXT,
  model              TEXT NOT NULL,
  input_tokens       INT,
  output_tokens      INT,
  pdf_technical_url  TEXT,
  pdf_executive_url  TEXT,
  status             TEXT NOT NULL DEFAULT 'complete',  -- pending | complete | failed
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_analysis_incident ON incident_analysis (provider, incident_id, created_at DESC);
