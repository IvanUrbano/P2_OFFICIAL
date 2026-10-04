-- Migration 025: administrator account lock
--
-- SAFE / ADDITIVE ONLY: adds columns. Idempotent.
--
-- Two separate ways an account can be locked:
--   1. Automatic (unchanged): 5 wrong passwords -> locked_until = now + 15 minutes,
--      tracked by failed_attempts / locked_until.
--   2. Manual (new): an administrator locks the account until it is unlocked.
-- Unlocking clears both. Locking differs from deactivating: a locked account is a
-- temporary security hold; an inactive account has been retired. Neither deletes the
-- user, so audit logs and the records they entered stay linked to the account.

ALTER TABLE users ADD COLUMN IF NOT EXISTS manually_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_by_user_id INTEGER
  REFERENCES users(id) ON DELETE SET NULL;
