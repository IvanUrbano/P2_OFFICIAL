-- Migration 012: in-app notifications (bell in the header)
--
-- One row per recipient. user_id refers to users in the auth database (shared with
-- TBInsight), so there is no foreign key across databases. Messages carry case IDs
-- only — never patient names or dates of birth.
--
--   type          referral_received | referral_accepted | referral_rejected | referral_cancelled
--                 | case_assigned | validation_summary | sync_failed | sync_completed
--                 | account_updated
--   severity      info | success | warning | danger
--   link          in-app path to open on click (e.g. /records?view=referrals)
--   entity_type / entity_id   what the notification is about (e.g. case_transfer / 12)
--
-- SAFE / ADDITIVE: creates a new table and indexes only. Idempotent.

CREATE TABLE IF NOT EXISTS notifications (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL,
  type         VARCHAR(40) NOT NULL,
  severity     VARCHAR(10) NOT NULL DEFAULT 'info',
  title        VARCHAR(200) NOT NULL,
  message      TEXT,
  link         VARCHAR(300),
  entity_type  VARCHAR(40),
  entity_id    VARCHAR(64),
  actor_user_id INTEGER,
  is_read      BOOLEAN NOT NULL DEFAULT false,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_severity_check') THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_severity_check
      CHECK (severity IN ('info', 'success', 'warning', 'danger'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, created_at DESC) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_entity
  ON notifications (entity_type, entity_id);
