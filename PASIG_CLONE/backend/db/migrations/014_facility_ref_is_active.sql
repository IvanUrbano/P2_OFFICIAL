-- Facility deactivation must follow the facility into the validation queue: an
-- INACTIVE facility may keep its id on existing records, but it must never be offered
-- as a target for a NEW mapping (GET /assignment facility options filters on it).
-- health_facilities.is_active lives in the TBInsight database, so it is mirrored into
-- facility_ref the same way name/category are (services/barangayRegistry.syncFacilityRef).
ALTER TABLE facility_ref ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT TRUE;
