-- ==========================================
-- Migration 010: Audit Logs
-- ==========================================
-- Tracks security-sensitive actions (password resets, user creation, etc.).
-- Runs on backend startup (idempotent).
-- ==========================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    target_user_id INTEGER,
    target_username TEXT,
    result TEXT NOT NULL DEFAULT 'SUCCESS',
    ip_address TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_logs(username);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
