-- Past incidents history: one row per resolved incident, written by
-- /api/cron/check-status at the moment an incident leaves the active set and
-- read by /api/incidents/history for the dashboard's collapsed "Past
-- incidents" section. Rows older than HISTORY_RETENTION_DAYS (90) are purged
-- by /api/cron/cleanup.
--
-- Written only on resolution, never on every cron tick — a per-tick Postgres
-- write is what kept Neon from autosuspending before (see api/_lib/redis.ts).

CREATE TABLE IF NOT EXISTS incident_history (
  provider     TEXT NOT NULL,
  incident_id  TEXT NOT NULL,
  title        TEXT NOT NULL,
  start_time   TIMESTAMPTZ,
  resolved_at  TIMESTAMPTZ NOT NULL,
  snapshot     JSONB NOT NULL,          -- full Incident, status = 'resolved'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, incident_id)
);

CREATE INDEX IF NOT EXISTS idx_incident_history_resolved_at ON incident_history (resolved_at DESC);

-- One-time backfill from the Incident Briefing Engine's own 'resolved' runs,
-- which hold the final incident snapshot — the only record of pre-launch
-- incidents, since the provider feeds don't retain history. Idempotent:
-- ON CONFLICT DO NOTHING leaves rows already written by check-status alone.
INSERT INTO incident_history (provider, incident_id, title, start_time, resolved_at, snapshot)
SELECT DISTINCT ON (provider, incident_id)
  provider,
  incident_id,
  COALESCE(incident_snapshot->>'title', incident_id),
  (incident_snapshot->>'startTime')::timestamptz,
  COALESCE((incident_snapshot->>'endTime')::timestamptz, created_at),
  incident_snapshot || jsonb_build_object(
    'status', 'resolved',
    'endTime', to_jsonb(COALESCE(incident_snapshot->>'endTime', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
  )
FROM incident_analysis
WHERE trigger_event = 'resolved'
  AND created_at > now() - INTERVAL '90 days'
ORDER BY provider, incident_id, created_at DESC
ON CONFLICT (provider, incident_id) DO NOTHING;
