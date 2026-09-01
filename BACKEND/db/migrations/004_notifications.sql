-- 004_notifications.sql
-- Extend alerts table for unified alerts + notifications system

-- Make barangay_name nullable (notifications like "Records Imported" don't have a barangay)
ALTER TABLE alerts ALTER COLUMN barangay_name DROP NOT NULL;

-- Add new columns
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'alert';
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unread';
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_module TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS related_record_id TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS related_entity_type TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS resolved_by TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Indexes for filtering and sorting
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_source ON alerts(source_module);
CREATE INDEX IF NOT EXISTS idx_alerts_created_desc ON alerts(created_at DESC);

-- Migrate existing data
UPDATE alerts SET type = 'alert' WHERE type IS NULL OR type = '';
UPDATE alerts SET status = CASE WHEN is_read THEN 'read' ELSE 'unread' END;
UPDATE alerts SET title = alert_type WHERE title IS NULL;
