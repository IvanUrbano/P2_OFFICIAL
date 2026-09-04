-- ==========================================
-- Migration 007: Webhook Logs
-- ==========================================
-- Tracks incoming webhooks from Pasig Clone system.
-- Runs on P2_OFFICIAL backend startup (idempotent).
-- ==========================================

CREATE TABLE IF NOT EXISTS webhook_logs (
    id SERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    batch_id UUID,
    payload JSONB,
    status TEXT DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed')),
    records_received INTEGER DEFAULT 0,
    records_imported INTEGER DEFAULT 0,
    error_message TEXT,
    received_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_source ON webhook_logs(source);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_received ON webhook_logs(received_at);
