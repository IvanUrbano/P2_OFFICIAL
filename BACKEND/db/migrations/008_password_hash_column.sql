-- ==========================================
-- Migration 008: Password Hash Column
-- ==========================================
-- Adds password_hash column for Pasig Clone compatibility.
-- Runs on P2_OFFICIAL backend startup (idempotent).
-- ==========================================

-- Step 1: Add password_hash column (nullable initially)
-- This is safe - IF NOT EXISTS prevents error if column already exists
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Step 2: Add index for performance (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_users_password_hash ON users(password_hash);
