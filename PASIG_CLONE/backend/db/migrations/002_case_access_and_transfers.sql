-- ==========================================
-- Migration 002: Case Access & Transfers
-- ==========================================
-- Adds facility-scoped access control and
-- acceptance-based transfer workflow.
-- ==========================================
-- NOTE: health_facilities lives on AUTH_DATABASE_URL
-- (shared with TBInsight), not on this database.
-- Therefore we use plain INTEGER columns without
-- FK constraints. The logical reference to
-- health_facilities(id) is enforced at the
-- application layer.
-- ==========================================

-- Add current responsible facility column to validated_tb_cases
-- (logical reference to health_facilities.id on AUTH_DATABASE_URL)
ALTER TABLE validated_tb_cases
ADD COLUMN IF NOT EXISTS current_responsible_facility_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_validated_cases_current_facility
ON validated_tb_cases(current_responsible_facility_id);

-- Create case transfers table
-- (from_facility_id and to_facility_id are logical references
--  to health_facilities.id on AUTH_DATABASE_URL)
CREATE TABLE IF NOT EXISTS case_transfers (
    id SERIAL PRIMARY KEY,
    validated_case_id BIGINT NOT NULL REFERENCES validated_tb_cases(id),
    from_facility_id INTEGER,
    to_facility_id INTEGER NOT NULL,
    transfer_type TEXT NOT NULL CHECK (transfer_type IN ('referral', 'transfer')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'completed', 'cancelled')),
    initiated_by_user_id INTEGER NOT NULL,
    accepted_by_user_id INTEGER,
    notes TEXT,
    initiated_at TIMESTAMP DEFAULT NOW(),
    accepted_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_transfers_case_id ON case_transfers(validated_case_id);
CREATE INDEX IF NOT EXISTS idx_case_transfers_status ON case_transfers(status);
CREATE INDEX IF NOT EXISTS idx_case_transfers_from ON case_transfers(from_facility_id);
CREATE INDEX IF NOT EXISTS idx_case_transfers_to ON case_transfers(to_facility_id);