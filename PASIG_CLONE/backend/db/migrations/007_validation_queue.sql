-- Migration 007: validation work queue (Ready / Possible Matches / Needs Assignment /
-- Data Issues)
--
-- SAFE / ADDITIVE ONLY: adds tables, columns, functions, indexes and a trigger. No row
-- is deleted and no existing value changes. Idempotent.

-- ---------- Data Issues ----------
-- Rows that failed validation used to be reported once and dropped. They are now kept
-- here so they can be corrected (then they become normal validated cases) or
-- deliberately excluded. raw_tb_cases is never modified: corrections live in `record`.
CREATE TABLE IF NOT EXISTS validation_issues (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL,
  raw_case_id BIGINT,
  row_number INTEGER,
  source_type TEXT,
  record JSONB NOT NULL,              -- cleaned row (+ corrections)
  errors JSONB NOT NULL DEFAULT '[]',
  warnings JSONB NOT NULL DEFAULT '[]',
  barangay_name TEXT,                 -- for staff scoping
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'excluded')),
  resolved_case_id BIGINT,            -- validated_tb_cases.id created by the fix
  resolved_by_user_id INTEGER,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_validation_issues_batch ON validation_issues (batch_id);
CREATE INDEX IF NOT EXISTS idx_validation_issues_open ON validation_issues (status) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS uq_validation_issues_raw ON validation_issues (raw_case_id) WHERE raw_case_id IS NOT NULL;

-- ---------- Needs Assignment: location ----------
-- NULL = undecided. 'outside_pasig' = an admin confirmed the patient lives outside Pasig:
-- the record stays in PASIG (never sent to TBInsight) and leaves the queue.
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS location_resolution TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS location_resolved_by INTEGER;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS location_resolved_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'validated_cases_location_resolution_check') THEN
    ALTER TABLE validated_tb_cases ADD CONSTRAINT validated_cases_location_resolution_check
      CHECK (location_resolution IS NULL OR location_resolution IN ('outside_pasig'));
  END IF;
END $$;

-- ---------- Needs Assignment: facilities ----------
-- Mirror of TBInsight's health_facilities (other database), refreshed by
-- services/barangayRegistry.js. Facility names in source files rarely match the
-- registry exactly ("ROSARIO HEALTH CENTER - IDOTS" vs "Rosario HC"), so each distinct
-- source name is mapped ONCE (facility_aliases) and every record with that name follows.
CREATE TABLE IF NOT EXISTS facility_ref (
  id INTEGER PRIMARY KEY,             -- = TBInsight health_facilities.id
  name TEXT NOT NULL,
  norm_name TEXT NOT NULL,
  barangay_name TEXT,
  ownership TEXT,
  facility_category TEXT,
  is_external BOOLEAN NOT NULL DEFAULT FALSE,
  is_reference BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_facility_ref_norm ON facility_ref (norm_name);

CREATE TABLE IF NOT EXISTS facility_aliases (
  alias_norm TEXT PRIMARY KEY,
  alias_text TEXT NOT NULL,           -- the name exactly as it appeared in the file
  facility_id INTEGER NOT NULL,       -- = health_facilities.id
  created_by_user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION norm_facility(p TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]', '', 'g')
$$;

CREATE OR REPLACE FUNCTION facility_ref_id(p TEXT) RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN norm_facility(p) = '' THEN NULL ELSE COALESCE(
    (SELECT facility_id FROM facility_aliases WHERE alias_norm = norm_facility(p)),
    (SELECT id FROM facility_ref WHERE norm_name = norm_facility(p) ORDER BY id LIMIT 1)
  ) END
$$;

ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS treatment_facility_id INTEGER;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS screening_facility_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_validated_cases_treatment_facility_norm
  ON validated_tb_cases (norm_facility(treatment_facility));
CREATE INDEX IF NOT EXISTS idx_validated_cases_screening_facility_norm
  ON validated_tb_cases (norm_facility(screening_facility));

CREATE OR REPLACE FUNCTION trg_cases_facility_ids() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.treatment_facility_id := facility_ref_id(NEW.treatment_facility);
  NEW.screening_facility_id := facility_ref_id(NEW.screening_facility);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cases_facility_ids ON validated_tb_cases;
CREATE TRIGGER cases_facility_ids
  BEFORE INSERT OR UPDATE OF treatment_facility, screening_facility ON validated_tb_cases
  FOR EACH ROW EXECUTE FUNCTION trg_cases_facility_ids();
