-- Migration 015: patient-name privacy class (historical vs operational records)
--
-- identity_class on import_batches, validated_tb_cases and validation_issues:
--   historical  — every record that exists today, and every record created while
--                 patient-name display is not approved (PATIENT_NAMES_ENABLED unset).
--                 Names/DOB stay stored exactly as they are but are NEVER returned by
--                 the API: TB Records shows "De-identified".
--   operational — records created after deployment/client approval
--                 (PATIENT_NAMES_ENABLED=true when the batch was created). Names may be
--                 shown to users who can view the case and have unlocked the Records PIN.
--
-- The class is set on the import batch when it is created (routes/csvImport.js,
-- routes/manualEntry.js) and copied onto its cases and data issues by trigger, so
-- every insert path inherits it without code changes.
--
-- SAFE / ADDITIVE: three columns with a constant default (existing rows become
-- 'historical' — no name, DOB or other value is read, changed or deleted), two
-- triggers. Guards: a historical record can never be re-classified as operational,
-- and its stored names/DOB can never be changed. Idempotent.

ALTER TABLE import_batches     ADD COLUMN IF NOT EXISTS identity_class VARCHAR(12) NOT NULL DEFAULT 'historical';
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS identity_class VARCHAR(12) NOT NULL DEFAULT 'historical';
ALTER TABLE validation_issues  ADD COLUMN IF NOT EXISTS identity_class VARCHAR(12) NOT NULL DEFAULT 'historical';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_batches_identity_class_check') THEN
    ALTER TABLE import_batches ADD CONSTRAINT import_batches_identity_class_check
      CHECK (identity_class IN ('historical', 'operational'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'validated_tb_cases_identity_class_check') THEN
    ALTER TABLE validated_tb_cases ADD CONSTRAINT validated_tb_cases_identity_class_check
      CHECK (identity_class IN ('historical', 'operational'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'validation_issues_identity_class_check') THEN
    ALTER TABLE validation_issues ADD CONSTRAINT validation_issues_identity_class_check
      CHECK (identity_class IN ('historical', 'operational'));
  END IF;
END $$;

-- New cases / data issues take the class of their batch (unknown batch -> historical).
CREATE OR REPLACE FUNCTION trg_inherit_identity_class() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT b.identity_class INTO NEW.identity_class FROM import_batches b WHERE b.id = NEW.batch_id;
  IF NEW.identity_class IS NULL THEN NEW.identity_class := 'historical'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validated_tb_cases_identity_class ON validated_tb_cases;
CREATE TRIGGER validated_tb_cases_identity_class
  BEFORE INSERT ON validated_tb_cases
  FOR EACH ROW EXECUTE FUNCTION trg_inherit_identity_class();

DROP TRIGGER IF EXISTS validation_issues_identity_class ON validation_issues;
CREATE TRIGGER validation_issues_identity_class
  BEFORE INSERT ON validation_issues
  FOR EACH ROW EXECUTE FUNCTION trg_inherit_identity_class();

-- Historical records: class is permanent, stored names/DOB are never modified.
CREATE OR REPLACE FUNCTION trg_protect_historical_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.identity_class = 'historical' THEN
    IF NEW.identity_class IS DISTINCT FROM 'historical' THEN
      RAISE EXCEPTION 'A historical record cannot be re-classified as operational.' USING ERRCODE = 'check_violation';
    END IF;
    IF (OLD.last_name IS NOT NULL AND NEW.last_name IS DISTINCT FROM OLD.last_name)
       OR (OLD.first_name IS NOT NULL AND NEW.first_name IS DISTINCT FROM OLD.first_name)
       OR (OLD.middle_name IS NOT NULL AND NEW.middle_name IS DISTINCT FROM OLD.middle_name)
       OR (OLD.suffix IS NOT NULL AND NEW.suffix IS DISTINCT FROM OLD.suffix)
       OR (OLD.date_of_birth IS NOT NULL AND NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth) THEN
      RAISE EXCEPTION 'Historical patient names and dates of birth cannot be modified.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validated_tb_cases_protect_historical ON validated_tb_cases;
CREATE TRIGGER validated_tb_cases_protect_historical
  BEFORE UPDATE ON validated_tb_cases
  FOR EACH ROW EXECUTE FUNCTION trg_protect_historical_identity();

-- Batches: class is permanent once historical.
CREATE OR REPLACE FUNCTION trg_protect_historical_batch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.identity_class = 'historical' AND NEW.identity_class IS DISTINCT FROM 'historical' THEN
    RAISE EXCEPTION 'A historical batch cannot be re-classified as operational.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS import_batches_protect_historical ON import_batches;
CREATE TRIGGER import_batches_protect_historical
  BEFORE UPDATE OF identity_class ON import_batches
  FOR EACH ROW EXECUTE FUNCTION trg_protect_historical_batch();
