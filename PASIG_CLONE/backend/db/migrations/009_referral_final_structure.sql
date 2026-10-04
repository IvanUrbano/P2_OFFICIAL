-- Migration 009: final referral structure (case_transfers)
--
-- FINAL CONTRACT — what the application reads and writes:
--   id
--   validated_case_id
--   from_barangay_id          referring barangay (the case's responsible barangay)
--   to_barangay_id            receiving barangay (required)
--   from_facility_id          optional, informational — never controls access
--   to_facility_id            optional, informational — never controls access
--   reason
--   status                    pending | accepted | rejected | cancelled
--   initiated_by_user_id, initiated_at
--   reviewed_by_user_id, reviewed_at   who closed it and when (accept / reject / cancel)
--
-- Lifecycle: PENDING -> ACCEPTED (receiver; responsibility moves) / REJECTED (receiver)
--            / CANCELLED (sender). All three are final. COMPLETED is retired.
--
-- SAFE / ADDITIVE: no row is deleted and no column dropped. Legacy columns stay
-- (marked DEPRECATED below) and are filled into the final columns only where those are
-- empty. New constraints are added NOT VALID and validated only when no existing row
-- violates them. Idempotent.

-- ---------- carry legacy values into the final columns (only where empty) ----------
UPDATE case_transfers SET reason = notes
WHERE reason IS NULL AND notes IS NOT NULL;

UPDATE case_transfers
SET reviewed_by_user_id = COALESCE(accepted_by_user_id, cancelled_by_user_id),
    reviewed_at = COALESCE(accepted_at, cancelled_at, completed_at)
WHERE status <> 'pending' AND reviewed_at IS NULL
  AND COALESCE(accepted_at, cancelled_at, completed_at) IS NOT NULL;

-- ---------- constraints ----------
DO $$
BEGIN
  -- Final statuses only.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_transfers_status_check'
             AND pg_get_constraintdef(oid) LIKE '%completed%') THEN
    ALTER TABLE case_transfers DROP CONSTRAINT case_transfers_status_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_transfers_status_check') THEN
    ALTER TABLE case_transfers ADD CONSTRAINT case_transfers_status_check
      CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM case_transfers WHERE status NOT IN ('pending', 'accepted', 'rejected', 'cancelled')) THEN
    ALTER TABLE case_transfers VALIDATE CONSTRAINT case_transfers_status_check;
  END IF;

  -- A referral always has a receiving barangay.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_transfers_to_barangay_required') THEN
    ALTER TABLE case_transfers ADD CONSTRAINT case_transfers_to_barangay_required
      CHECK (to_barangay_id IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM case_transfers WHERE to_barangay_id IS NULL) THEN
    ALTER TABLE case_transfers VALIDATE CONSTRAINT case_transfers_to_barangay_required;
  END IF;

  -- Pending = not reviewed yet; every final status records who closed it and when.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_transfers_review_consistency') THEN
    ALTER TABLE case_transfers ADD CONSTRAINT case_transfers_review_consistency
      CHECK ((status = 'pending') = (reviewed_at IS NULL)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM case_transfers WHERE (status = 'pending') <> (reviewed_at IS NULL)) THEN
    ALTER TABLE case_transfers VALIDATE CONSTRAINT case_transfers_review_consistency;
  END IF;

  -- A referral cannot point at the barangay it comes from.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_transfers_distinct_barangays') THEN
    ALTER TABLE case_transfers ADD CONSTRAINT case_transfers_distinct_barangays
      CHECK (from_barangay_id IS NULL OR from_barangay_id <> to_barangay_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM case_transfers WHERE from_barangay_id = to_barangay_id) THEN
    ALTER TABLE case_transfers VALIDATE CONSTRAINT case_transfers_distinct_barangays;
  END IF;
END $$;

-- At most one pending referral per case.
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_transfers_one_pending
  ON case_transfers (validated_case_id) WHERE status = 'pending';
-- Incoming-referrals inbox.
CREATE INDEX IF NOT EXISTS idx_case_transfers_inbox ON case_transfers (to_barangay_id, status);

ALTER TABLE case_transfers ALTER COLUMN initiated_at SET DEFAULT NOW();

-- ---------- documentation ----------
COMMENT ON TABLE case_transfers IS
  'Barangay referrals. Final columns: id, validated_case_id, from/to_barangay_id, from/to_facility_id (informational only), reason, status (pending|accepted|rejected|cancelled), initiated_by_user_id, initiated_at, reviewed_by_user_id, reviewed_at.';
COMMENT ON COLUMN case_transfers.from_facility_id IS 'Optional, informational. Never used for access.';
COMMENT ON COLUMN case_transfers.to_facility_id IS 'Optional, informational. Never used for access.';
COMMENT ON COLUMN case_transfers.reviewed_by_user_id IS 'User who closed the referral: accepted or rejected it (receiver) or cancelled it (sender).';
COMMENT ON COLUMN case_transfers.from_barangay IS 'Display copy of from_barangay_id, kept in step by trigger. Not authoritative.';
COMMENT ON COLUMN case_transfers.to_barangay IS 'Display copy of to_barangay_id, kept in step by trigger. Not authoritative.';
COMMENT ON COLUMN case_transfers.transfer_type IS 'referral | transfer — descriptive label only.';
COMMENT ON COLUMN case_transfers.notes IS 'DEPRECATED — use reason.';
COMMENT ON COLUMN case_transfers.accepted_by_user_id IS 'DEPRECATED — use reviewed_by_user_id.';
COMMENT ON COLUMN case_transfers.accepted_at IS 'DEPRECATED — use reviewed_at.';
COMMENT ON COLUMN case_transfers.cancelled_by_user_id IS 'DEPRECATED — use reviewed_by_user_id.';
COMMENT ON COLUMN case_transfers.cancelled_at IS 'DEPRECATED — use reviewed_at.';
COMMENT ON COLUMN case_transfers.completed_at IS 'DEPRECATED — COMPLETED status retired.';
