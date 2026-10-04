-- Migration 024: user profile, status and first-login password change
--
-- SAFE / ADDITIVE ONLY: adds columns and relaxes one NOT NULL. No row is deleted and
-- no existing value is changed. Idempotent: safe to run on every startup.
--
--   full_name            — display name (existing accounts show their username until set)
--   email                — now OPTIONAL. The UNIQUE constraint stays; PostgreSQL allows
--                          any number of NULLs under it.
--   status               — 'active' | 'inactive'. Inactive accounts cannot log in.
--                          Existing accounts default to 'active'.
--   last_login_at        — set on each successful login
--   must_change_password — TRUE while the account still uses a system-generated
--                          temporary password (new accounts, admin password resets);
--                          cleared when the user sets their own password.
--                          Existing accounts default to FALSE.

ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'inactive'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
