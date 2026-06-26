-- ==========================================
-- TBInsight Plan 01 — Data Layer (D1, D2, D3)
-- ==========================================
-- D2: Barangay Spatial + population (reference data; 30 rows for Pasig)
-- D1: TB Case Data (de-identified; only what forecasting needs)
-- D3: Monthly Case Summary (cases per barangay per month)
-- ==========================================

-- D2 Barangay Spatial + population (reference data; 30 rows for Pasig)
CREATE TABLE IF NOT EXISTS barangays (
  name          TEXT PRIMARY KEY,
  population    INTEGER NOT NULL CHECK (population > 0),
  centroid_lon  DOUBLE PRECISION,
  centroid_lat  DOUBLE PRECISION
);

-- D1 TB Case Data (de-identified; only what forecasting needs)
CREATE TABLE IF NOT EXISTS tb_cases (
  id             BIGSERIAL PRIMARY KEY,
  barangay_name  TEXT NOT NULL REFERENCES barangays(name),
  diagnosis_date DATE NOT NULL,
  source_file    TEXT,
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tb_cases_brgy_date
  ON tb_cases (barangay_name, diagnosis_date);

-- D3 Monthly Case Summary (cases per barangay per month; month = first of month)
CREATE TABLE IF NOT EXISTS monthly_case_summary (
  barangay_name TEXT NOT NULL REFERENCES barangays(name),
  month         DATE NOT NULL,
  case_count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (barangay_name, month)
);
