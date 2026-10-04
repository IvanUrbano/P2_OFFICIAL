-- Migration 010: barangay id on data issues (staff scoping by key)
--
-- SAFE / ADDITIVE: adds validation_issues.barangay_id (-> barangay_ref.id), fills it
-- from the barangay name already stored, keeps it in step with a trigger, and indexes
-- it. barangay_name stays — it is what staff see in the queue. No row is deleted and no
-- existing value changes. Idempotent.
--
-- WHY: scoping and permissions for data issues compared names
-- (routes/validationQueue.js issueScope, policies/permissions.js issuePermissions).
-- From now on they compare this id, like every other access check in the system
-- (migrations 006 / 008). An issue whose barangay is not in the registry keeps a NULL
-- id and therefore matches no staff — the same fail-closed behaviour the name compare
-- had for a name outside the barangay list.

ALTER TABLE validation_issues ADD COLUMN IF NOT EXISTS barangay_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_validation_issues_barangay_id ON validation_issues (barangay_id);

UPDATE validation_issues v
SET barangay_id = r.id
FROM barangay_ref r
WHERE lower(trim(v.barangay_name)) = lower(trim(r.name))
  AND v.barangay_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'validation_issues'::regclass
      AND contype = 'f'
      AND conname IN ('validation_issues_barangay_id_fkey', 'fk_validation_issues_barangay_id')
  ) THEN
    ALTER TABLE validation_issues
      ADD CONSTRAINT fk_validation_issues_barangay_id
      FOREIGN KEY (barangay_id) REFERENCES barangay_ref(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END;
$$;

-- The id is authoritative: whatever a write path puts in barangay_id wins, the name is
-- rewritten from it; a write that only carries a name (the queue's fix endpoint) has the
-- id resolved from that name.
CREATE OR REPLACE FUNCTION trg_issues_barangay_ids() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  resolved_id INTEGER;
  resolved_name TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.barangay_id IS DISTINCT FROM OLD.barangay_id THEN
    IF NEW.barangay_id IS NOT NULL THEN
      SELECT id, name INTO resolved_id, resolved_name FROM barangay_ref WHERE id = NEW.barangay_id;
      IF resolved_id IS NULL THEN
        RAISE EXCEPTION 'Unknown barangay id: %', NEW.barangay_id;
      END IF;
      NEW.barangay_name := resolved_name;
    END IF;
  ELSIF NEW.barangay_id IS NOT NULL
        AND (TG_OP = 'INSERT' OR NEW.barangay_name IS NOT DISTINCT FROM OLD.barangay_name) THEN
    SELECT id, name INTO resolved_id, resolved_name FROM barangay_ref WHERE id = NEW.barangay_id;
    IF resolved_id IS NULL THEN
      RAISE EXCEPTION 'Unknown barangay id: %', NEW.barangay_id;
    END IF;
    NEW.barangay_name := resolved_name;
  ELSE
    SELECT id, name INTO resolved_id, resolved_name
    FROM barangay_ref
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

DROP TRIGGER IF EXISTS issues_barangay_ids ON validation_issues;
CREATE TRIGGER issues_barangay_ids
  BEFORE INSERT OR UPDATE OF barangay_id, barangay_name
  ON validation_issues
  FOR EACH ROW EXECUTE FUNCTION trg_issues_barangay_ids();

COMMENT ON COLUMN validation_issues.barangay_id IS
  'Barangay this issue belongs to — the key staff scoping and permissions compare. Authoritative; barangay_name is the display copy kept in step by trigger.';
COMMENT ON COLUMN validation_issues.barangay_name IS
  'Display copy of barangay_id, kept in step by trigger. Not authoritative.';
