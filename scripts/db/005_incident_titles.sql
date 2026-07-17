-- Follow-up to Phase 4/5 (ALERTS-DESIGN.md 14.7b): stores each active incident's
-- title alongside its id so a resolved incident's title is still known on the
-- tick after it disappears from the provider's feed. Title isn't otherwise
-- recoverable once a provider fully drops the entry (Azure's silent removal,
-- OCI's synthesized single incident id) rather than leaving a resolved record.

ALTER TABLE provider_status_snapshot
  ADD COLUMN IF NOT EXISTS active_incident_titles JSONB NOT NULL DEFAULT '{}'::jsonb;
