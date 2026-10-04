-- Migration 026: who created each account
--
-- SAFE / ADDITIVE ONLY: adds one column and fills it for existing accounts only where
-- the audit log already recorded the creation. Idempotent.
--
-- Accounts created before user creation was audited stay NULL ("not recorded");
-- nothing is guessed.

ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER
  REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by_user_id);

-- Backfill from the earliest successful CREATE_USER audit entry per account, when the
-- creating admin still exists.
UPDATE users u
SET created_by_user_id = a.user_id
FROM (
  SELECT DISTINCT ON (target_user_id) target_user_id, user_id
  FROM audit_logs
  WHERE action = 'CREATE_USER'
    AND COALESCE(result, 'SUCCESS') = 'SUCCESS'
    AND target_user_id IS NOT NULL
    AND user_id IS NOT NULL
  ORDER BY target_user_id, created_at ASC
) a
WHERE u.id = a.target_user_id
  AND u.created_by_user_id IS NULL
  AND a.user_id <> u.id
  AND EXISTS (SELECT 1 FROM users c WHERE c.id = a.user_id);
