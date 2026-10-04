UPDATE validated_tb_cases v
SET barangay_id = r.id
FROM barangay_ref r
WHERE lower(trim(v.barangay_name)) = lower(trim(r.name))
  AND v.barangay_id IS NULL;

UPDATE validated_tb_cases v
SET responsible_barangay_id = r.id
FROM barangay_ref r
WHERE lower(trim(v.responsible_barangay)) = lower(trim(r.name))
  AND v.responsible_barangay_id IS NULL;

UPDATE case_transfers t
SET from_barangay_id = r.id
FROM barangay_ref r
WHERE lower(trim(t.from_barangay)) = lower(trim(r.name))
  AND t.from_barangay_id IS NULL;

UPDATE case_transfers t
SET to_barangay_id = r.id
FROM barangay_ref r
WHERE lower(trim(t.to_barangay)) = lower(trim(r.name))
  AND t.to_barangay_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'validated_tb_cases'::regclass AND conname = 'fk_validated_cases_barangay_id') THEN
    ALTER TABLE validated_tb_cases ADD CONSTRAINT fk_validated_cases_barangay_id
      FOREIGN KEY (barangay_id) REFERENCES barangay_ref(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'validated_tb_cases'::regclass AND conname = 'fk_validated_cases_responsible_barangay_id') THEN
    ALTER TABLE validated_tb_cases ADD CONSTRAINT fk_validated_cases_responsible_barangay_id
      FOREIGN KEY (responsible_barangay_id) REFERENCES barangay_ref(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'case_transfers'::regclass AND conname = 'fk_case_transfers_from_barangay_id') THEN
    ALTER TABLE case_transfers ADD CONSTRAINT fk_case_transfers_from_barangay_id
      FOREIGN KEY (from_barangay_id) REFERENCES barangay_ref(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'case_transfers'::regclass AND conname = 'fk_case_transfers_to_barangay_id') THEN
    ALTER TABLE case_transfers ADD CONSTRAINT fk_case_transfers_to_barangay_id
      FOREIGN KEY (to_barangay_id) REFERENCES barangay_ref(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trg_cases_barangay_ids() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  resolved_id INTEGER;
  resolved_name TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.barangay_id IS DISTINCT FROM OLD.barangay_id THEN
    IF NEW.barangay_id IS NOT NULL THEN
      SELECT id, name INTO resolved_id, resolved_name FROM barangay_ref WHERE id = NEW.barangay_id;
      IF resolved_id IS NULL THEN RAISE EXCEPTION 'Unknown barangay id: %', NEW.barangay_id; END IF;
      NEW.barangay_name := resolved_name;
    END IF;
  ELSIF NEW.barangay_id IS NOT NULL
        AND (TG_OP = 'INSERT' OR NEW.barangay_name IS NOT DISTINCT FROM OLD.barangay_name) THEN
    SELECT id, name INTO resolved_id, resolved_name FROM barangay_ref WHERE id = NEW.barangay_id;
    IF resolved_id IS NULL THEN RAISE EXCEPTION 'Unknown barangay id: %', NEW.barangay_id; END IF;
    NEW.barangay_name := resolved_name;
  ELSE
    SELECT id, name INTO resolved_id, resolved_name FROM barangay_ref
    WHERE lower(trim(name)) = lower(trim(NEW.barangay_name)) LIMIT 1;
    NEW.barangay_id := resolved_id;
    IF resolved_name IS NOT NULL THEN NEW.barangay_name := resolved_name; END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.responsible_barangay_id IS DISTINCT FROM OLD.responsible_barangay_id THEN
    IF NEW.responsible_barangay_id IS NULL THEN
      NEW.responsible_barangay := NULL;
    ELSE
      SELECT id, name INTO resolved_id, resolved_name FROM barangay_ref WHERE id = NEW.responsible_barangay_id;
      IF resolved_id IS NULL THEN RAISE EXCEPTION 'Unknown responsible barangay id: %', NEW.responsible_barangay_id; END IF;
      NEW.responsible_barangay := resolved_name;
    END IF;
  ELSIF NEW.responsible_barangay_id IS NOT NULL
        AND (TG_OP = 'INSERT' OR NEW.responsible_barangay IS NOT DISTINCT FROM OLD.responsible_barangay) THEN
    SELECT id, name INTO resolved_id, resolved_name FROM barangay_ref WHERE id = NEW.responsible_barangay_id;
    IF resolved_id IS NULL THEN RAISE EXCEPTION 'Unknown responsible barangay id: %', NEW.responsible_barangay_id; END IF;
    NEW.responsible_barangay := resolved_name;
  ELSE
    SELECT id, name INTO resolved_id, resolved_name FROM barangay_ref
    WHERE lower(trim(name)) = lower(trim(NEW.responsible_barangay)) LIMIT 1;
    NEW.responsible_barangay_id := resolved_id;
    IF resolved_name IS NOT NULL THEN NEW.responsible_barangay := resolved_name; END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cases_barangay_ids ON validated_tb_cases;
CREATE TRIGGER cases_barangay_ids
  BEFORE INSERT OR UPDATE OF barangay_id, barangay_name, responsible_barangay_id, responsible_barangay
  ON validated_tb_cases
  FOR EACH ROW EXECUTE FUNCTION trg_cases_barangay_ids();

CREATE OR REPLACE FUNCTION trg_transfers_barangay_ids() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  resolved_id INTEGER;
  resolved_name TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.from_barangay_id IS DISTINCT FROM OLD.from_barangay_id THEN
    IF NEW.from_barangay_id IS NOT NULL THEN
      SELECT id, name INTO resolved_id, resolved_name FROM barangay_ref WHERE id = NEW.from_barangay_id;
      IF resolved_id IS NULL THEN RAISE EXCEPTION 'Unknown source barangay id: %', NEW.from_barangay_id; END IF;
      NEW.from_barangay := resolved_name;
    END IF;
  ELSIF NEW.from_barangay_id IS NOT NULL
        AND (TG_OP = 'INSERT' OR NEW.from_barangay IS NOT DISTINCT FROM OLD.from_barangay) THEN
    SELECT id, name INTO resolved_id, resolved_name FROM barangay_ref WHERE id = NEW.from_barangay_id;
    IF resolved_id IS NULL THEN RAISE EXCEPTION 'Unknown source barangay id: %', NEW.from_barangay_id; END IF;
    NEW.from_barangay := resolved_name;
  ELSE
    SELECT id, name INTO resolved_id, resolved_name FROM barangay_ref
    WHERE lower(trim(name)) = lower(trim(NEW.from_barangay)) LIMIT 1;
    NEW.from_barangay_id := resolved_id;
    IF resolved_name IS NOT NULL THEN NEW.from_barangay := resolved_name; END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.to_barangay_id IS DISTINCT FROM OLD.to_barangay_id THEN
    IF NEW.to_barangay_id IS NOT NULL THEN
      SELECT id, name INTO resolved_id, resolved_name FROM barangay_ref WHERE id = NEW.to_barangay_id;
      IF resolved_id IS NULL THEN RAISE EXCEPTION 'Unknown target barangay id: %', NEW.to_barangay_id; END IF;
      NEW.to_barangay := resolved_name;
    END IF;
  ELSIF NEW.to_barangay_id IS NOT NULL
        AND (TG_OP = 'INSERT' OR NEW.to_barangay IS NOT DISTINCT FROM OLD.to_barangay) THEN
    SELECT id, name INTO resolved_id, resolved_name FROM barangay_ref WHERE id = NEW.to_barangay_id;
    IF resolved_id IS NULL THEN RAISE EXCEPTION 'Unknown target barangay id: %', NEW.to_barangay_id; END IF;
    NEW.to_barangay := resolved_name;
  ELSE
    SELECT id, name INTO resolved_id, resolved_name FROM barangay_ref
    WHERE lower(trim(name)) = lower(trim(NEW.to_barangay)) LIMIT 1;
    NEW.to_barangay_id := resolved_id;
    IF resolved_name IS NOT NULL THEN NEW.to_barangay := resolved_name; END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transfers_barangay_ids ON case_transfers;
CREATE TRIGGER transfers_barangay_ids
  BEFORE INSERT OR UPDATE OF from_barangay_id, from_barangay, to_barangay_id, to_barangay
  ON case_transfers
  FOR EACH ROW EXECUTE FUNCTION trg_transfers_barangay_ids();