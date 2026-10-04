ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS barangay_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_tb_cases_barangay_id ON tb_cases (barangay_id);

UPDATE tb_cases t
SET barangay_id = b.id
FROM barangays b
WHERE lower(trim(t.barangay_name)) = lower(trim(b.name))
  AND t.barangay_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tb_cases'::regclass
      AND contype = 'f'
      AND conname IN ('tb_cases_barangay_id_fkey', 'fk_tb_cases_barangay_id')
  ) THEN
    ALTER TABLE tb_cases
      ADD CONSTRAINT fk_tb_cases_barangay_id
      FOREIGN KEY (barangay_id) REFERENCES barangays(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trg_tb_cases_barangay_id() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  resolved_id INTEGER;
  resolved_name TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.barangay_id IS DISTINCT FROM OLD.barangay_id THEN
    IF NEW.barangay_id IS NOT NULL THEN
      SELECT id, name INTO resolved_id, resolved_name FROM barangays WHERE id = NEW.barangay_id;
      IF resolved_id IS NULL THEN
        RAISE EXCEPTION 'Unknown barangay id: %', NEW.barangay_id;
      END IF;
      NEW.barangay_name := resolved_name;
    END IF;
  ELSIF NEW.barangay_id IS NOT NULL
        AND (TG_OP = 'INSERT' OR NEW.barangay_name IS NOT DISTINCT FROM OLD.barangay_name) THEN
    SELECT id, name INTO resolved_id, resolved_name FROM barangays WHERE id = NEW.barangay_id;
    IF resolved_id IS NULL THEN
      RAISE EXCEPTION 'Unknown barangay id: %', NEW.barangay_id;
    END IF;
    NEW.barangay_name := resolved_name;
  ELSE
    SELECT id, name INTO resolved_id, resolved_name
    FROM barangays
    WHERE lower(trim(name)) = lower(trim(NEW.barangay_name))
    LIMIT 1;
    NEW.barangay_id := resolved_id;
    IF resolved_name IS NOT NULL THEN
      NEW.barangay_name := resolved_name;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tb_cases_barangay_id ON tb_cases;
CREATE TRIGGER tb_cases_barangay_id
  BEFORE INSERT OR UPDATE OF barangay_id, barangay_name ON tb_cases
  FOR EACH ROW EXECUTE FUNCTION trg_tb_cases_barangay_id();