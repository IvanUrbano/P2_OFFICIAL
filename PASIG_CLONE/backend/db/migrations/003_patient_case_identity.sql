-- ==========================================
-- Migration 003: Patient # / Case ID identity
-- ==========================================
-- Patient # identifies a person; Case ID identifies one TB episode. Both are
-- generated here (never typed by users) and are unique. A relapse gets a new
-- Case ID under the same Patient #.
--
-- Names and date of birth are stored ONLY in this database (PASIG). They are
-- never included in the webhook payload to TBInsight — only case_no,
-- patient_no and the computed age are.
-- ==========================================

CREATE SEQUENCE IF NOT EXISTS patient_no_seq;
CREATE SEQUENCE IF NOT EXISTS case_no_seq;

CREATE TABLE IF NOT EXISTS patients (
    id BIGSERIAL PRIMARY KEY,
    patient_no TEXT NOT NULL UNIQUE,
    -- Lets re-validating or deleting a batch remove the patients it created
    -- (only when no other record still belongs to them).
    created_by_batch_id UUID,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Identity as reported on each record (a person's name can be spelled
-- differently across episodes, so it lives on the record, not the patient).
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS middle_name TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS suffix TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS date_of_birth DATE;

ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS patient_id BIGINT REFERENCES patients(id);
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS case_no TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_validated_cases_case_no
  ON validated_tb_cases(case_no) WHERE case_no IS NOT NULL;

-- Possible-match review. A record whose Last + First name + date of birth
-- matches an existing case is held as 'pending' (no Patient #/Case ID yet)
-- until a person decides:
--   same_case        -> its outcome/treatment fields update the existing case;
--                       this record itself does not become a case
--   new_episode      -> new Case ID under the existing Patient #
--   different_person -> new Patient # and new Case ID
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS match_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE validated_tb_cases DROP CONSTRAINT IF EXISTS validated_cases_match_status_check;
ALTER TABLE validated_tb_cases ADD CONSTRAINT validated_cases_match_status_check
  CHECK (match_status IN ('none', 'pending', 'resolved'));
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS match_candidate_case_no TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS match_suggestion TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS match_resolution TEXT;
ALTER TABLE validated_tb_cases DROP CONSTRAINT IF EXISTS validated_cases_match_resolution_check;
ALTER TABLE validated_tb_cases ADD CONSTRAINT validated_cases_match_resolution_check
  CHECK (match_resolution IS NULL OR match_resolution IN ('same_case', 'new_episode', 'different_person'));
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS merged_into_case_no TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS match_resolved_by INTEGER;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS match_resolved_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_validated_cases_identity
  ON validated_tb_cases (lower(last_name), lower(first_name), date_of_birth);
CREATE INDEX IF NOT EXISTS idx_validated_cases_patient ON validated_tb_cases(patient_id);
CREATE INDEX IF NOT EXISTS idx_validated_cases_match_status ON validated_tb_cases(match_status);
CREATE INDEX IF NOT EXISTS idx_validated_cases_merged_into ON validated_tb_cases(merged_into_case_no)
  WHERE merged_into_case_no IS NOT NULL;
