-- Phase 2B: Manual TB Record Entry (idempotent)
-- Provenance columns: which staff user entered the case, and from which facility.
-- entered_by_facility_id is attribution only — distinct from screening_facility /
-- treatment_facility patient fields (never auto-filled from the staff facility).
ALTER TABLE tb_cases
  ADD COLUMN IF NOT EXISTS entered_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entered_by_facility_id INTEGER REFERENCES health_facilities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tb_cases_entered_by_user ON tb_cases(entered_by_user_id);
CREATE INDEX IF NOT EXISTS idx_tb_cases_entered_by_facility ON tb_cases(entered_by_facility_id);
