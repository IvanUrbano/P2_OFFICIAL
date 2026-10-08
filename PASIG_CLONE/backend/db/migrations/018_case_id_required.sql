-- The Case ID is what identifies a case across imports (services/caseIds.js), so from now
-- on a row must carry one: validateCore() rejects rows without it and the file's format is
-- checked (ROS-D-2025-00042).
--
-- Batches uploaded BEFORE this migration are grandfathered: they were validated under the
-- old rule (the system generated an ID for rows that had none), so re-validating one must
-- not turn its rows into data issues. The column is stamped only on the run that adds it,
-- which keeps the migration idempotent — every later startup re-runs these files.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'import_batches' AND column_name = 'case_id_required'
  ) THEN
    ALTER TABLE import_batches ADD COLUMN case_id_required boolean NOT NULL DEFAULT true;
    -- Everything that exists right now was uploaded under the old rule.
    UPDATE import_batches SET case_id_required = false;
  END IF;
END $$;
