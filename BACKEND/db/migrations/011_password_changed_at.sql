-- ==========================================
-- Migration 011: Password Changed At
-- ==========================================
-- Tracks when a password was last changed.
-- Used to notify users on login if their
-- password was recently reset by an admin.
-- ==========================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP NULL;
