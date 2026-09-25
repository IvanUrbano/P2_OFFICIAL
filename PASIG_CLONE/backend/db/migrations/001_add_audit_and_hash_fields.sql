-- Migration: Add audit and hash fields for multi-user support
-- File: PASIG_CLONE/backend/db/migrations/001_add_audit_and_hash_fields.sql
-- Description: Adds file hash, audit trail fields, and record classification

-- =====================================================
-- 1. Add file_hash to import_batches
-- =====================================================
ALTER TABLE IF EXISTS import_batches ADD COLUMN IF NOT EXISTS file_hash TEXT UNIQUE;

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_import_batches_file_hash ON import_batches(file_hash);

-- =====================================================
-- 2. Add audit trail fields to import_batches
-- =====================================================
ALTER TABLE IF EXISTS import_batches ADD COLUMN IF NOT EXISTS validated_by INTEGER;
ALTER TABLE IF EXISTS import_batches ADD COLUMN IF NOT EXISTS validated_at TIMESTAMP;
ALTER TABLE IF EXISTS import_batches ADD COLUMN IF NOT EXISTS synced_by INTEGER;
ALTER TABLE IF EXISTS import_batches ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP;
ALTER TABLE IF EXISTS import_batches ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'pending' 
  CHECK (sync_status IN ('pending', 'syncing', 'synced', 'sync_failed'));
ALTER TABLE IF EXISTS import_batches ADD COLUMN IF NOT EXISTS sync_error TEXT;

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_import_batches_sync_status ON import_batches(sync_status);

-- =====================================================
-- 3. Add record classification to validated_tb_cases
-- =====================================================
ALTER TABLE IF EXISTS validated_tb_cases ADD COLUMN IF NOT EXISTS source_record_id TEXT;
ALTER TABLE IF EXISTS validated_tb_cases ADD COLUMN IF NOT EXISTS record_status TEXT DEFAULT 'new'
  CHECK (record_status IN ('new', 'existing', 'updated', 'duplicate'));
ALTER TABLE IF EXISTS validated_tb_cases ADD COLUMN IF NOT EXISTS updated_by INTEGER;
ALTER TABLE IF EXISTS validated_tb_cases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

-- Index for duplicate detection
CREATE INDEX IF NOT EXISTS idx_validated_cases_source_record ON validated_tb_cases(source_type, source_record_id)
  WHERE source_record_id IS NOT NULL;

-- =====================================================
-- 4. Create audit_logs table
-- =====================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  result TEXT,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- =====================================================
-- 5. Update webhook_logs to track sync initiator
-- =====================================================
ALTER TABLE IF EXISTS webhook_logs ADD COLUMN IF NOT EXISTS initiated_by INTEGER;
ALTER TABLE IF EXISTS webhook_logs ADD COLUMN IF NOT EXISTS initiated_at TIMESTAMP;

-- =====================================================
-- 6. Ensure backward compatibility
-- =====================================================
-- For existing batches without file_hash or audit fields,
-- set defaults so queries don't fail
UPDATE import_batches 
SET sync_status = COALESCE(sync_status, 'pending') 
WHERE sync_status IS NULL;

UPDATE import_batches
SET status = COALESCE(status, 'uploaded')
WHERE status IS NULL;

-- Set synced_at based on sent_at for legacy data
UPDATE import_batches
SET synced_at = sent_at, sync_status = 'synced'
WHERE sent_at IS NOT NULL AND synced_at IS NULL AND status = 'sent';

-- Mark legacy failed syncs
UPDATE import_batches
SET sync_status = 'sync_failed'
WHERE status = 'failed' AND sync_status = 'pending';

-- =====================================================
-- 7. Create view for dashboard stats (optional but helpful)
-- =====================================================
CREATE OR REPLACE VIEW import_batch_summary AS
SELECT 
  b.id,
  b.filename,
  b.file_hash,
  u.username as imported_by_username,
  b.uploaded_by,
  b.total_rows,
  b.valid_count,
  b.error_count,
  b.status,
  b.sync_status,
  b.created_at,
  b.validated_at,
  b.synced_at,
  v.username as validated_by_username,
  s.username as synced_by_username
FROM import_batches b
LEFT JOIN users u ON b.uploaded_by = u.id
LEFT JOIN users v ON b.validated_by = v.id
LEFT JOIN users s ON b.synced_by = s.id;

-- =====================================================
-- Summary of changes
-- =====================================================
-- import_batches:
--   + file_hash (TEXT UNIQUE) - for duplicate detection
--   + validated_by (INTEGER) - user who validated
--   + validated_at (TIMESTAMP) - when validation completed
--   + synced_by (INTEGER) - user who initiated sync
--   + synced_at (TIMESTAMP) - when sync completed
--   + sync_status (TEXT) - pending/syncing/synced/sync_failed
--   + sync_error (TEXT) - error message if sync failed
--
-- validated_tb_cases:
--   + source_record_id (TEXT) - stable ID for duplicate detection
--   + record_status (TEXT) - new/existing/updated/duplicate
--   + updated_by (INTEGER) - user who updated record
--   + updated_at (TIMESTAMP) - when record was updated
--
-- webhook_logs:
--   + initiated_by (INTEGER) - user who initiated sync
--   + initiated_at (TIMESTAMP) - when sync initiated
--
-- audit_logs (new table):
--   id, user_id, action, resource_type, resource_id, result, details, created_at
