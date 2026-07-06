-- Phase 1 (ALERTS-DESIGN.md Section 3): subscriber capture + double opt-in.
-- provider_status_snapshot and notification_log are added in later phases
-- (4 and 5) once there's a cron job that needs them.

CREATE TABLE IF NOT EXISTS subscribers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  email             TEXT NOT NULL,
  phone             TEXT,
  providers         TEXT[] NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending_confirmation',
  email_verified_at TIMESTAMPTZ,
  sms_opt_in        BOOLEAN NOT NULL DEFAULT false,
  confirm_token     TEXT,
  confirm_token_expires_at TIMESTAMPTZ,
  manage_token      TEXT UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  unsubscribed_at   TIMESTAMPTZ,
  UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_subscribers_confirm_token ON subscribers (confirm_token)
  WHERE confirm_token IS NOT NULL;
