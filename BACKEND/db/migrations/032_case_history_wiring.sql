-- ============================================================
-- Same-case outcome updates: make case_history writable, track
-- when a case was last touched, and close the "no Case ID" gap.
-- ============================================================
--
-- Invariants this migration exists to support (see also the comment
-- block in tbinsight/webhook.js and tbinsight/caseHistory.js):
--
--   1. The stable Case ID (tb_cases.case_no) is the ONLY match key for a
--      re-sent record. A later validated update to the same Case ID
--      updates the existing row in place - it never creates a second row.
--   2. Every such update preserves the previous values in case_history,
--      together with what/who produced the change.
--   3. An outcome is only ever whatever the source system sent. Nothing in
--      TBInsight derives an outcome - least of all CURED - from elapsed
--      time, dates, or treatment duration.
--   4. Patient identity is NOT case/episode identity: the same person may
--      have a later, new episode, which is a NEW Case ID and therefore a
--      new case. case_no is never inferred from patient_no (or any other
--      demographic field).
--   5. case_history is append-only and deliberately has no foreign key to
--      tb_cases, so history survives when a case row is removed (e.g. an
--      import batch is undone).
--
-- Migrations 002-031 are registered one-by-one in db.js; this file must be
-- registered there too or it will never run.

-- When a case row was last changed in place. Inserts get DEFAULT NOW();
-- the webhook upsert sets it explicitly so "this outcome changed later"
-- is answerable without reading case_history.
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
UPDATE tb_cases SET updated_at = imported_at WHERE updated_at IS NULL;

-- Who made the change, as a free-text label. changed_by_user_id only accepts
-- TBInsight user ids, but the actor on a synced update lives in the SOURCE
-- system (PASIG) and has no row in TBInsight's users table - so it is stored
-- here instead of being squeezed into notes.
ALTER TABLE case_history ADD COLUMN IF NOT EXISTS changed_by_label TEXT;

-- A record with no Case ID cannot be matched on a resend, so it is always
-- inserted and can silently duplicate an earlier case. Still never rejected
-- or merged automatically - only marked for human review, same as the two
-- collision reasons from migration 018.
ALTER TABLE tb_cases DROP CONSTRAINT IF EXISTS tb_cases_duplicate_flag_reason_check;
ALTER TABLE tb_cases ADD CONSTRAINT tb_cases_duplicate_flag_reason_check
  CHECK (duplicate_flag_reason IS NULL OR duplicate_flag_reason IN (
    'MN_ITIS_ID_COLLISION', 'DSTB_FINGERPRINT_COLLISION', 'MISSING_CASE_ID'
  ));

-- Backfill existing rows that carry no Case ID (flag only; no clinical
-- column is touched, no row is deleted, case counts are unaffected).
UPDATE tb_cases
SET duplicate_status = 'possible_duplicate', duplicate_flag_reason = 'MISSING_CASE_ID'
WHERE case_no IS NULL AND duplicate_flag_reason IS NULL;
