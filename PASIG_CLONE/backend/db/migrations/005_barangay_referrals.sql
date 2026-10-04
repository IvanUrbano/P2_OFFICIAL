-- Migration 005: barangay-based referrals (hybrid staff access)
--
-- SAFE / ADDITIVE ONLY: adds columns and indexes and relaxes one NOT NULL. No row is
-- deleted and no existing value changes. Idempotent.
--
-- Staff access (policies/caseAccessPolicy.js):
--   PRIMARY    — the case's responsible barangay is the staff member's barangay
--   REFERRED IN  — an accepted referral moved responsibility to their barangay
--   REFERRED OUT — the patient lives in their barangay but responsibility moved away:
--                  view only
--
-- validated_tb_cases.responsible_barangay: NULL means "the patient's barangay"
-- (barangay_name). It is set only when a referral/transfer to another barangay is
-- ACCEPTED. The patient's own barangay_name is never changed by a referral.
--
-- case_transfers: the target is now a barangay (to_barangay). to_facility_id becomes
-- optional and informational only. Barangay names are plain text, matching how
-- validated_tb_cases stores barangay_name (barangays live in the TBInsight database).

ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS responsible_barangay TEXT;
CREATE INDEX IF NOT EXISTS idx_validated_cases_responsible_barangay
  ON validated_tb_cases (lower(responsible_barangay)) WHERE responsible_barangay IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_validated_cases_barangay_lower
  ON validated_tb_cases (lower(barangay_name));

ALTER TABLE case_transfers ADD COLUMN IF NOT EXISTS from_barangay TEXT;
ALTER TABLE case_transfers ADD COLUMN IF NOT EXISTS to_barangay TEXT;
ALTER TABLE case_transfers ALTER COLUMN to_facility_id DROP NOT NULL;
ALTER TABLE case_transfers ADD COLUMN IF NOT EXISTS cancelled_by_user_id INTEGER;
ALTER TABLE case_transfers ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_case_transfers_from_barangay ON case_transfers (lower(from_barangay));
CREATE INDEX IF NOT EXISTS idx_case_transfers_to_barangay ON case_transfers (lower(to_barangay));
