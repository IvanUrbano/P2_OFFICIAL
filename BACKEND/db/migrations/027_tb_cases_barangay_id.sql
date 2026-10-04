-- Migration 027: patient barangay as a key on TBInsight cases
--
-- SAFE / ADDITIVE: adds tb_cases.barangay_id (-> barangays.id), fills it from the
-- existing barangay_name, and keeps it in step with a trigger. barangay_name stays (it
-- is still what analytics group by). No row is deleted; no existing value changes.
-- Idempotent.
--
-- TBInsight is analytics-only and city-wide, so it holds only the PATIENT's barangay.
-- Responsible barangay and referrals are operational and live in PASIG TB-IS.

ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS barangay_id INTEGER
  REFERENCES barangays(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_tb_cases_barangay_id ON tb_cases(barangay_id);

CREATE OR REPLACE FUNCTION trg_tb_cases_barangay_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.barangay_id := (SELECT b.id FROM barangays b WHERE b.name = NEW.barangay_name);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tb_cases_barangay_id ON tb_cases;
CREATE TRIGGER tb_cases_barangay_id
  BEFORE INSERT OR UPDATE OF barangay_name ON tb_cases
  FOR EACH ROW EXECUTE FUNCTION trg_tb_cases_barangay_id();

UPDATE tb_cases t
SET barangay_id = b.id
FROM barangays b
WHERE b.name = t.barangay_name
  AND t.barangay_id IS DISTINCT FROM b.id;
