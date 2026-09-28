-- Phase 2A: User Facility Assignment (idempotent)
-- Each Staff account is assigned to a registered health facility.
-- Admin accounts may have no facility (NULL).
ALTER TABLE users ADD COLUMN IF NOT EXISTS facility_id INTEGER REFERENCES health_facilities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_facility ON users(facility_id);
