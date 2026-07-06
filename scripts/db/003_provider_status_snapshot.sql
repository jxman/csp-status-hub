-- Phase 4 (ALERTS-DESIGN.md Section 3/7): last-known status per provider,
-- used by /api/cron/check-status to detect operational -> non-operational
-- transitions. notification_log (Phase 5) is not needed yet since this phase
-- only logs detected changes, it doesn't email anyone.

CREATE TABLE IF NOT EXISTS provider_status_snapshot (
  provider            TEXT PRIMARY KEY,
  overall_status      TEXT NOT NULL,
  active_incident_ids TEXT[] NOT NULL DEFAULT '{}',
  last_checked_at     TIMESTAMPTZ NOT NULL,
  raw_signature       TEXT NOT NULL
);
