-- Migration 004: case tracking fields (PASIG source system)
--
-- SAFE / ADDITIVE ONLY: adds a column, two tables and indexes. No row is deleted and
-- no existing value is changed. Idempotent: safe to run on every startup.
--
-- Already present on validated_tb_cases and reused as-is:
--   source_record_id  — record ID in the source file/system (migration 001)
--   validation_status — validation result
--   match_status      — possible-match review state (migration 003)
--   batch_id          — import batch
--   patient_id / case_no — Patient # / Case ID, nullable until confirmed (migration 003)
-- Added here:
--   source_case_id    — the case number as printed in the source file (e.g. ITIS Lite
--                       case no.), kept separate from the system-generated case_no
--   case_history, case_review_history tables
--
-- User IDs refer to the shared users table in the TBInsight database, so they are
-- plain integers here (no cross-database foreign key). validated_case_id has no
-- foreign key either: history must survive when a batch is deleted.

ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS source_case_id TEXT;
CREATE INDEX IF NOT EXISTS idx_validated_cases_source_case
  ON validated_tb_cases(source_case_id) WHERE source_case_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS case_history (
  id BIGSERIAL PRIMARY KEY,
  validated_case_id BIGINT,
  case_no TEXT,
  patient_id BIGINT,
  batch_id UUID,
  change_type TEXT NOT NULL CHECK (change_type IN
    ('created', 'updated', 'merged', 'transferred', 'status_changed', 'deleted', 'restored')),
  changed_fields JSONB,             -- {"field": {"old": ..., "new": ...}}
  source TEXT CHECK (source IS NULL OR source IN
    ('import', 'manual', 'transfer', 'review', 'system')),
  changed_by_user_id INTEGER,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_case_history_case ON case_history(validated_case_id);
CREATE INDEX IF NOT EXISTS idx_case_history_case_no ON case_history(case_no) WHERE case_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_history_changed_at ON case_history(changed_at);

CREATE TABLE IF NOT EXISTS case_review_history (
  id BIGSERIAL PRIMARY KEY,
  validated_case_id BIGINT,
  case_no TEXT,
  review_type TEXT NOT NULL CHECK (review_type IN
    ('validation', 'match', 'duplicate', 'assignment', 'transfer', 'other')),
  decision TEXT,
  previous_status TEXT,
  new_status TEXT,
  notes TEXT,
  reviewed_by_user_id INTEGER,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_case_review_history_case ON case_review_history(validated_case_id);
CREATE INDEX IF NOT EXISTS idx_case_review_history_case_no ON case_review_history(case_no) WHERE case_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_review_history_reviewed_at ON case_review_history(reviewed_at);
