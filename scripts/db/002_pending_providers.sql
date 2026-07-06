-- Phase 2 (ALERTS-DESIGN.md Section 4.1 / 5): staged provider changes for
-- already-confirmed subscribers who resubmit the public sign-up form.
-- manage_token already exists on the table (Phase 1 schema) but wasn't
-- populated until now.

ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS pending_providers TEXT[];
