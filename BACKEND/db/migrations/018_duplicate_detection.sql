-- ============================================================
-- Duplicate detection for tb_cases
-- ============================================================
--
-- Three layers of protection against the same underlying case being
-- imported more than once:
--   1. Batch-level idempotency (pre-existing — webhook_logs unique on
--      (source, batch_id)).
--   2. MN record-level duplicate DETECTION using itis_case_id. This is a
--      strong signal, not a guaranteed-unique key: auditing the live
--      dataset found 20 itis_case_id values shared by records with
--      materially different barangay/age/outcome, so a hard UNIQUE
--      constraint here would risk silently rejecting genuinely different
--      patients. A collision is therefore flagged for human review, never
--      used to reject, skip, overwrite, or merge a record.
--   3. Heuristic possible-duplicate DETECTION for DSTB records, which have
--      no case/patient identifier in the source data at all. A DSTB
--      "fingerprint" is a deterministic hash of fields confirmed stable
--      across re-exports of the same case (barangay + diagnosis date + sex
--      + age + anatomical site + registration group) — NOT a claim of true
--      record identity. Two legitimate, distinct patients can share all of
--      these values, so a fingerprint match is flagged for human review,
--      never used to reject or silently merge a record.
--
-- No column here is a UNIQUE key. Both itis_case_id collisions and
-- dstb_fingerprint collisions are detection signals only.

ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS dstb_fingerprint TEXT;
CREATE INDEX IF NOT EXISTS idx_tb_cases_dstb_fingerprint
  ON tb_cases (dstb_fingerprint)
  WHERE dstb_fingerprint IS NOT NULL;

-- Plain (non-unique) lookup index for itis_case_id collision detection.
CREATE INDEX IF NOT EXISTS idx_tb_cases_itis_case_id_lookup
  ON tb_cases (itis_case_id)
  WHERE itis_case_id IS NOT NULL;

-- 'possible_duplicate' means an itis_case_id or DSTB fingerprint matched an
-- earlier row — a signal for manual review, never proof the two rows are
-- the same case. Record identity is never decided automatically.
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS duplicate_status TEXT NOT NULL DEFAULT 'unique';
ALTER TABLE tb_cases DROP CONSTRAINT IF EXISTS tb_cases_duplicate_status_check;
ALTER TABLE tb_cases ADD CONSTRAINT tb_cases_duplicate_status_check
  CHECK (duplicate_status IN ('unique', 'possible_duplicate'));
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS duplicate_of_case_id BIGINT REFERENCES tb_cases(id);
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS duplicate_flag_reason TEXT;
ALTER TABLE tb_cases DROP CONSTRAINT IF EXISTS tb_cases_duplicate_flag_reason_check;
ALTER TABLE tb_cases ADD CONSTRAINT tb_cases_duplicate_flag_reason_check
  CHECK (duplicate_flag_reason IS NULL OR duplicate_flag_reason IN (
    'MN_ITIS_ID_COLLISION', 'DSTB_FINGERPRINT_COLLISION'
  ));

-- One-time backfill: compute dstb_fingerprint for existing DSTB rows from
-- fields already stored (no field is re-derived or guessed).
UPDATE tb_cases
SET dstb_fingerprint = md5(
  UPPER(TRIM(COALESCE(barangay_name, ''))) || '|' ||
  COALESCE(date_of_diagnosis::text, '') || '|' ||
  UPPER(TRIM(COALESCE(sex, ''))) || '|' ||
  COALESCE(age::text, '') || '|' ||
  UPPER(TRIM(COALESCE(anatomical_site, ''))) || '|' ||
  UPPER(TRIM(COALESCE(registration_group, '')))
)
WHERE source_type = 'DSTB' AND dstb_fingerprint IS NULL;

-- One-time backfill: flag existing DSTB fingerprint collisions as possible
-- duplicates (never 'confirmed'). Only duplicate_status/duplicate_of_case_id/
-- duplicate_flag_reason are set; no clinical column is touched, no row is
-- deleted, and case counts are unaffected.
UPDATE tb_cases t
SET duplicate_status = 'possible_duplicate',
    duplicate_of_case_id = earliest.id,
    duplicate_flag_reason = 'DSTB_FINGERPRINT_COLLISION'
FROM (
  SELECT dstb_fingerprint, MIN(id) AS id
  FROM tb_cases
  WHERE source_type = 'DSTB' AND dstb_fingerprint IS NOT NULL
  GROUP BY dstb_fingerprint
  HAVING COUNT(*) > 1
) earliest
WHERE t.dstb_fingerprint = earliest.dstb_fingerprint
  AND t.id != earliest.id
  AND t.source_type = 'DSTB'
  AND t.duplicate_status = 'unique';

-- One-time backfill: flag existing MN itis_case_id collisions the same way.
-- Audit-confirmed as a real data-quality condition (20 groups as of this
-- migration) — flagged for review, not treated as confirmed duplicates and
-- not merged/deleted.
UPDATE tb_cases t
SET duplicate_status = 'possible_duplicate',
    duplicate_of_case_id = earliest.id,
    duplicate_flag_reason = 'MN_ITIS_ID_COLLISION'
FROM (
  SELECT itis_case_id, MIN(id) AS id
  FROM tb_cases
  WHERE source_type = 'MN' AND itis_case_id IS NOT NULL
  GROUP BY itis_case_id
  HAVING COUNT(*) > 1
) earliest
WHERE t.itis_case_id = earliest.itis_case_id
  AND t.id != earliest.id
  AND t.source_type = 'MN'
  AND t.duplicate_status = 'unique';
