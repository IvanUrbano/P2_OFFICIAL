-- ==========================================
-- 029: Non-Pasig residents treated in Pasig facilities
--
-- A TB patient who does not live in Pasig but is treated/managed by a Pasig health
-- facility is now KEPT in TBInsight instead of being rejected at the webhook.
--
--   * Marked location_classification = 'Non-Pasig Resident'
--   * Residence kept as free text (residence_barangay_name, residence_city)
--   * barangay_id / barangay_name stay NULL — the facility NEVER decides the barangay,
--     and a non-Pasig patient must never be stamped with a Pasig barangay, not even
--     when the residence barangay name happens to collide with a Pasig one.
--   * Counted in city-wide totals and facility statistics.
--   * Excluded from barangay GIS, incidence, RF risk, forecasting and barangay stats.
--
-- Value domain of tb_cases.location_classification (plain TEXT, no CHECK):
--   'Pasig City'          resident of Pasig                -> counted everywhere
--   'Non-Pasig Resident'  outside Pasig, treated in Pasig  -> counted city-wide + by facility
--   'Non-Pasig'           legacy rows, never counted
--   NULL                   legacy rows, treated as 'Pasig City'
--
-- Safe to re-run (IF NOT EXISTS / guarded DO blocks).
-- ==========================================

-- ---------- Residence, kept separate from the treatment facility ----------

ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS residence_barangay_name TEXT;
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS residence_city TEXT;

ALTER TABLE tb_cases_raw ADD COLUMN IF NOT EXISTS residence_barangay_name TEXT;
ALTER TABLE tb_cases_raw ADD COLUMN IF NOT EXISTS residence_city TEXT;

-- ---------- barangay_id / barangay_name become optional ----------
-- Only Pasig residents carry a barangay. The 028 trigger already handles
-- (barangay_id IS NULL AND barangay_name IS NULL): its ELSE branch resolves
-- lower(trim(NULL)), matches nothing and writes NULL back.

ALTER TABLE tb_cases ALTER COLUMN barangay_name DROP NOT NULL;

-- ---------- facility_summary must be able to hold a row with no barangay ----------
-- Non-Pasig Resident cases are counted under the facility that manages them, so the
-- table needs a NULL barangay. A PRIMARY KEY column cannot be NULL, so the key moves
-- onto a generated NOT NULL expression that coalesces '' for those rows.

ALTER TABLE facility_summary ALTER COLUMN barangay_name DROP NOT NULL;

ALTER TABLE facility_summary ADD COLUMN IF NOT EXISTS barangay_key TEXT
  GENERATED ALWAYS AS (COALESCE(barangay_name, '')) STORED;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = 'facility_summary'::regclass
      AND i.indisprimary
      AND pg_get_indexdef(i.indexrelid) NOT LIKE '%(facility_name, barangay_key, month)%'
  ) THEN
    ALTER TABLE facility_summary DROP CONSTRAINT facility_summary_pkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'facility_summary'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE facility_summary
      ADD CONSTRAINT facility_summary_pkey
      PRIMARY KEY (facility_name, barangay_key, month);
  END IF;
END;
$$;

-- The barangay FK is kept: a NULL barangay passes a FOREIGN KEY check.

-- ---------- Lookups ----------

CREATE INDEX IF NOT EXISTS idx_tb_cases_location_classification
  ON tb_cases (location_classification);

CREATE INDEX IF NOT EXISTS idx_tb_cases_residence_city
  ON tb_cases (residence_city);
