-- Migration 006: barangay ids on cases and referrals; referral review fields
--
-- SAFE / ADDITIVE: adds a table, columns, indexes and triggers; the referral status
-- constraint is replaced by a stricter one added NOT VALID (existing rows are not
-- re-checked). No row is deleted and no existing value is changed — the new id
-- columns are filled from the barangay names already stored. Idempotent.
--
-- WHY IDS: the database must distinguish, by key, the patient's barangay
-- (barangay_id), the barangay responsible for the case (responsible_barangay_id, NULL =
-- follows the patient's barangay), the facilities (separate text fields), and the
-- referral route (from/to_barangay_id). The *_name / text columns are kept for display
-- and for older code paths.
--
-- barangay_ref mirrors TBInsight's barangays (id, name) — that table lives in the other
-- database, so it cannot be referenced or joined directly. services/barangayRegistry.js
-- refreshes it at startup and every 10 minutes. Triggers then keep every *_barangay_id
-- in step with its name column on INSERT/UPDATE, so no write path in the code has to
-- remember to set the ids.

CREATE TABLE IF NOT EXISTS barangay_ref (
  id INTEGER PRIMARY KEY,               -- = TBInsight barangays.id
  name TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_barangay_ref_name ON barangay_ref (lower(name));

CREATE OR REPLACE FUNCTION barangay_ref_id(p_name TEXT) RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT id FROM barangay_ref WHERE lower(name) = lower(trim(p_name)) LIMIT 1
$$;

-- ---------- cases ----------
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS barangay_id INTEGER;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS responsible_barangay_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_validated_cases_barangay_id ON validated_tb_cases (barangay_id);
CREATE INDEX IF NOT EXISTS idx_validated_cases_responsible_barangay_id
  ON validated_tb_cases (responsible_barangay_id) WHERE responsible_barangay_id IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_cases_barangay_ids() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.barangay_id := barangay_ref_id(NEW.barangay_name);
  NEW.responsible_barangay_id := CASE
    WHEN NEW.responsible_barangay IS NULL OR trim(NEW.responsible_barangay) = '' THEN NULL
    ELSE barangay_ref_id(NEW.responsible_barangay) END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cases_barangay_ids ON validated_tb_cases;
CREATE TRIGGER cases_barangay_ids
  BEFORE INSERT OR UPDATE OF barangay_name, responsible_barangay ON validated_tb_cases
  FOR EACH ROW EXECUTE FUNCTION trg_cases_barangay_ids();

-- ---------- referrals ----------
ALTER TABLE case_transfers ADD COLUMN IF NOT EXISTS from_barangay_id INTEGER;
ALTER TABLE case_transfers ADD COLUMN IF NOT EXISTS to_barangay_id INTEGER;
ALTER TABLE case_transfers ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE case_transfers ADD COLUMN IF NOT EXISTS reviewed_by_user_id INTEGER;
ALTER TABLE case_transfers ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_case_transfers_from_barangay_id ON case_transfers (from_barangay_id);
CREATE INDEX IF NOT EXISTS idx_case_transfers_to_barangay_id ON case_transfers (to_barangay_id);

CREATE OR REPLACE FUNCTION trg_transfers_barangay_ids() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.from_barangay_id := barangay_ref_id(NEW.from_barangay);
  NEW.to_barangay_id := barangay_ref_id(NEW.to_barangay);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS transfers_barangay_ids ON case_transfers;
CREATE TRIGGER transfers_barangay_ids
  BEFORE INSERT OR UPDATE OF from_barangay, to_barangay ON case_transfers
  FOR EACH ROW EXECUTE FUNCTION trg_transfers_barangay_ids();

-- Referral lifecycle: PENDING -> ACCEPTED / REJECTED / CANCELLED.
-- (COMPLETED is retired: responsibility already moves on ACCEPTED.) NOT VALID keeps
-- any historical row from blocking the migration; every new write is checked.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_transfers_status_check'
             AND pg_get_constraintdef(oid) NOT LIKE '%rejected%') THEN
    ALTER TABLE case_transfers DROP CONSTRAINT case_transfers_status_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_transfers_status_check') THEN
    ALTER TABLE case_transfers ADD CONSTRAINT case_transfers_status_check
      CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')) NOT VALID;
  END IF;
END $$;
