-- Migration 006: Add STIS integration fields
-- Reason: TBInsight integrates with an external system (STIS) that has two data sources:
--   1. DSTB sheet — Drug-Susceptible TB records with validation workflow
--   2. MN sheet — Microscopic-Negative records with external case IDs
-- All records live in a single tb_cases table. Different fields apply to different
-- record types, with unused fields left as NULL. source_type acts as the discriminator.

-- validation_status: Only applies to DSTB records (Validated / Not Validated).
--   MN records leave this NULL since they don't have a validation workflow.
-- itis_case_id: Only applies to MN records (external STIS case ID).
--   DSTB records leave this NULL since they don't come from the external system.
-- source_type: Applies to ALL records. Indicates "DSTB" or "MN".
--   Used to identify which sheet the record came from.
-- location_classification: Applies to ALL records. Derived during import from the
--   barangays table — if the barangay exists in Pasig City → "Pasig City", else → "Non-Pasig".

ALTER TABLE tb_cases
  ADD COLUMN IF NOT EXISTS validation_status TEXT,
  ADD COLUMN IF NOT EXISTS itis_case_id TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS location_classification TEXT;

ALTER TABLE tb_cases_raw
  ADD COLUMN IF NOT EXISTS itis_case_id TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS location_classification TEXT;
