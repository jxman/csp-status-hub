-- Phase 5 (ALERTS-DESIGN.md Section 3/8): audit trail of outage notifications
-- sent, so the admin view can answer "did this person actually get the
-- email" and future phases can avoid re-notifying for the same event.

CREATE TABLE IF NOT EXISTS notification_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID REFERENCES subscribers(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  channel       TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  success       BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_log_subscriber ON notification_log (subscriber_id);
