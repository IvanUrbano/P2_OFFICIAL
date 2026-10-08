-- One Case ID = one case (services/caseIds.js). The system never generates a Case ID, so
-- uniqueness is what stops two rows from becoming two cases for the same file entry.
--
-- Excluded, because they are not live cases:
--   pending rows            still deciding which case they belong to (the app decides
--                            first: auto-merge on a Case ID match, or a person in
--                            Validation -> Possible matches). resolveMatch() refuses a
--                            resolution other than "same case" while the Case ID is taken.
--   merged rows             same_case stubs: the real case keeps the Case ID.
--   archived rows           every lookup in the app filters is_archived = false, so the
--                            index must match those lookups or a clean app-side check
--                            could still fail in the database.
--
-- Guarded: if data already carries duplicates the index is NOT created (a startup must
-- never fail on existing data) — the duplicates are reported instead, so they can be
-- resolved on the Validation page first.
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT upper(source_case_id) AS id
    FROM validated_tb_cases
    WHERE source_case_id IS NOT NULL
      AND is_archived = false
      AND merged_into_case_no IS NULL
      AND match_status IS DISTINCT FROM 'pending'
    GROUP BY 1 HAVING COUNT(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE NOTICE 'Case ID unique index NOT created: % duplicate Case ID group(s) exist. Resolve them (Validation -> Possible matches), then re-run migrations.', dup_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_validated_case_id
      ON validated_tb_cases (upper(source_case_id))
      WHERE source_case_id IS NOT NULL
        AND is_archived = false
        AND merged_into_case_no IS NULL
        AND match_status IS DISTINCT FROM 'pending';
  END IF;
END $$;
