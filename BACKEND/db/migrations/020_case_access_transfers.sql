-- ==========================================
-- Migration 020: Case Access & Transfers
-- ==========================================
-- Adds facility-scoped access control and
-- transfer history for TB cases.
-- ==========================================

-- Add current responsible facility FK to tb_cases
ALTER TABLE tb_cases
ADD COLUMN IF NOT EXISTS current_responsible_facility_id INTEGER
REFERENCES health_facilities(id);

CREATE INDEX IF NOT EXISTS idx_tb_cases_current_facility
ON tb_cases(current_responsible_facility_id);

-- Create case transfers table (history mirror from PASIG TB-IS)
CREATE TABLE IF NOT EXISTS case_transfers (
    id SERIAL PRIMARY KEY,
    tb_case_id BIGINT NOT NULL REFERENCES tb_cases(id),
    from_facility_id INTEGER REFERENCES health_facilities(id),
    to_facility_id INTEGER NOT NULL REFERENCES health_facilities(id),
    transfer_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    initiated_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tb_case_transfers_case ON case_transfers(tb_case_id);