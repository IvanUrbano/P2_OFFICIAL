-- Migration 011: case_history events for outcome changes
--
-- SAFE / ADDITIVE: one trigger function plus one trigger. No row is deleted and no
-- existing value changes. Idempotent: safe to run on every startup.
--
-- WHY A TRIGGER: outcome_status is written from several code paths (validation issue
-- edits — routes/validationQueue.js, match resolution "same case" updates —
-- services/matchResolution.js, and any future writer). The trigger records every change
-- in case_history (migration 004) with the old and new value, wherever it happens.
--
-- changed_by_user_id stays NULL: the database does not know the acting user. Referral
-- lifecycle events, which do know the user, are written from routes/transfers.js
-- (case_review_history + a case_history "transferred" row on accept).

CREATE OR REPLACE FUNCTION trg_log_outcome_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.outcome_status IS DISTINCT FROM OLD.outcome_status THEN
    INSERT INTO case_history
      (validated_case_id, case_no, patient_id, batch_id, change_type, changed_fields, source, notes)
    VALUES
      (NEW.id, NEW.case_no, NEW.patient_id, NEW.batch_id, 'status_changed',
       jsonb_build_object('outcome_status',
         jsonb_build_object('old', OLD.outcome_status, 'new', NEW.outcome_status)),
       'system',
       format('Outcome changed: %s -> %s',
              COALESCE(NULLIF(btrim(OLD.outcome_status), ''), 'unset'),
              COALESCE(NULLIF(btrim(NEW.outcome_status), ''), 'unset')));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_outcome_change ON validated_tb_cases;
CREATE TRIGGER trg_log_outcome_change
  AFTER UPDATE OF outcome_status ON validated_tb_cases
  FOR EACH ROW EXECUTE FUNCTION trg_log_outcome_change();
