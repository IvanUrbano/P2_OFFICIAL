-- ==========================================
-- TBInsight - Full Schema Migration
-- 21 tables across 4 layers + PostGIS
-- ==========================================
-- Run: psql -U <user> -d tb_system -f BACKEND/db/migrations/002_tbinsight_full_schema.sql
-- Safe to re-run (CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN IF NOT EXISTS)
-- ==========================================

-- ==================== POSTGIS EXTENSION ====================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ==================== LAYER 0: REFERENCE DATA ====================

-- Barangays: 30 Pasig barangays with population and map coordinates
CREATE TABLE IF NOT EXISTS barangays (
  name TEXT PRIMARY KEY,
  population INTEGER NOT NULL,
  centroid_lon DOUBLE PRECISION,
  centroid_lat DOUBLE PRECISION
);

-- Health Facilities: maps each facility to its parent barangay
CREATE TABLE IF NOT EXISTS health_facilities (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  barangay_name TEXT NOT NULL REFERENCES barangays(name) ON DELETE CASCADE,
  facility_type TEXT,
  UNIQUE(name, barangay_name)
);

-- barangays_geom: PostGIS polygons for GIS map rendering
CREATE TABLE IF NOT EXISTS barangays_geom (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  population INTEGER DEFAULT 0,
  geom GEOMETRY(MULTIPOLYGON, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_barangays_geom_geom
  ON barangays_geom USING GIST (geom);

-- ==================== LAYER 1: RAW IMPORT ====================

-- tb_cases_raw: verbatim CSV rows for traceability and reprocessing
CREATE TABLE IF NOT EXISTS tb_cases_raw (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL,
  row_number INTEGER,
  validation_status TEXT,
  date_of_screening DATE,
  date_of_diagnosis DATE,
  date_of_notification DATE,
  age INTEGER,
  sex TEXT,
  barangay_name TEXT REFERENCES barangays(name) ON DELETE SET NULL,
  city TEXT,
  screening_facility TEXT,
  treatment_facility TEXT,
  source_of_patient TEXT,
  anatomical_site TEXT,
  registration_group TEXT,
  bacteriological_status TEXT,
  date_started_treatment DATE,
  outcome_status TEXT,
  date_of_outcome DATE,
  record_created_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  source_file TEXT
);

CREATE INDEX IF NOT EXISTS idx_tb_cases_raw_batch ON tb_cases_raw(batch_id);
CREATE INDEX IF NOT EXISTS idx_tb_cases_raw_barangay ON tb_cases_raw(barangay_name);
CREATE INDEX IF NOT EXISTS idx_tb_cases_raw_diagnosis ON tb_cases_raw(date_of_diagnosis);

-- ==================== LAYER 2: CLEANED ====================

-- tb_cases: validated records for all analytics and predictions
CREATE TABLE IF NOT EXISTS tb_cases (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL,
  date_of_diagnosis DATE NOT NULL,
  date_of_screening DATE,
  date_of_notification DATE,
  age INTEGER,
  sex TEXT NOT NULL,
  barangay_name TEXT NOT NULL REFERENCES barangays(name) ON DELETE RESTRICT,
  screening_facility TEXT,
  treatment_facility TEXT,
  source_of_patient TEXT,
  anatomical_site TEXT,
  registration_group TEXT,
  bacteriological_status TEXT,
  date_started_treatment DATE,
  outcome_status TEXT,
  date_of_outcome DATE,
  imported_at TIMESTAMPTZ DEFAULT NOW(),

  -- Validation & sync fields (added by webhook receiver)
  validation_status TEXT,
  itis_case_id TEXT,
  source_type TEXT,
  location_classification TEXT,

  -- New clinical/laboratory columns
  type TEXT,
  province TEXT,
  region TEXT,
  referred_to_dots TEXT,
  referral_status TEXT,
  microscopy_result TEXT,
  microscopy_release_date DATE,
  rdt_result TEXT,
  rdt_release_date DATE,
  outcome_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_tb_cases_batch ON tb_cases(batch_id);
CREATE INDEX IF NOT EXISTS idx_tb_cases_barangay ON tb_cases(barangay_name);
CREATE INDEX IF NOT EXISTS idx_tb_cases_diagnosis ON tb_cases(date_of_diagnosis);
CREATE INDEX IF NOT EXISTS idx_tb_cases_sex ON tb_cases(sex);
CREATE INDEX IF NOT EXISTS idx_tb_cases_outcome ON tb_cases(outcome_status);

-- ==================== LAYER 3: AGGREGATED ====================

-- monthly_case_summary: cases per barangay per month (ARIMA input)
CREATE TABLE IF NOT EXISTS monthly_case_summary (
  barangay_name TEXT NOT NULL REFERENCES barangays(name) ON DELETE CASCADE,
  month DATE NOT NULL,
  case_count INTEGER DEFAULT 0,
  PRIMARY KEY (barangay_name, month)
);

-- demographic_summary: age/sex breakdowns
CREATE TABLE IF NOT EXISTS demographic_summary (
  barangay_name TEXT NOT NULL REFERENCES barangays(name) ON DELETE CASCADE,
  month DATE NOT NULL,
  sex TEXT NOT NULL,
  age_group TEXT NOT NULL,
  case_count INTEGER DEFAULT 0,
  PRIMARY KEY (barangay_name, month, sex, age_group)
);

-- outcome_summary: treatment outcomes per barangay
CREATE TABLE IF NOT EXISTS outcome_summary (
  barangay_name TEXT NOT NULL REFERENCES barangays(name) ON DELETE CASCADE,
  month DATE NOT NULL,
  outcome_status TEXT NOT NULL,
  case_count INTEGER DEFAULT 0,
  PRIMARY KEY (barangay_name, month, outcome_status)
);

-- facility_summary: cases per health facility
CREATE TABLE IF NOT EXISTS facility_summary (
  facility_name TEXT NOT NULL,
  barangay_name TEXT NOT NULL REFERENCES barangays(name) ON DELETE CASCADE,
  month DATE NOT NULL,
  case_count INTEGER DEFAULT 0,
  PRIMARY KEY (facility_name, barangay_name, month)
);

-- bacteriological_summary: bacteriological status breakdown
CREATE TABLE IF NOT EXISTS bacteriological_summary (
  barangay_name TEXT NOT NULL REFERENCES barangays(name) ON DELETE CASCADE,
  month DATE NOT NULL,
  bacteriological_status TEXT NOT NULL,
  case_count INTEGER DEFAULT 0,
  PRIMARY KEY (barangay_name, month, bacteriological_status)
);

-- ==================== LAYER 4: PREDICTIONS & ANALYTICS ====================

-- model_predictions: ARIMA forecasts + RF classification + feedback loop
CREATE TABLE IF NOT EXISTS model_predictions (
  barangay_name TEXT NOT NULL REFERENCES barangays(name) ON DELETE CASCADE,
  period DATE NOT NULL,
  forecasted_count DOUBLE PRECISION,
  confidence_lower DOUBLE PRECISION,
  confidence_upper DOUBLE PRECISION,
  risk_class TEXT,
  incidence_per_100k DOUBLE PRECISION,
  actual_count INTEGER,
  forecast_error DOUBLE PRECISION,
  historical_bias DOUBLE PRECISION DEFAULT 0,
  model_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (barangay_name, period)
);

-- barangay_risk_scores: choropleth data
CREATE TABLE IF NOT EXISTS barangay_risk_scores (
  barangay_name TEXT NOT NULL REFERENCES barangays(name) ON DELETE CASCADE,
  period DATE NOT NULL,
  risk_score DOUBLE PRECISION,
  risk_class TEXT,
  incidence_per_100k DOUBLE PRECISION,
  trend_direction TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (barangay_name, period)
);

-- Add normalized risk component columns (safe to re-run)
ALTER TABLE barangay_risk_scores ADD COLUMN IF NOT EXISTS norm_incidence DOUBLE PRECISION;
ALTER TABLE barangay_risk_scores ADD COLUMN IF NOT EXISTS norm_trend DOUBLE PRECISION;
ALTER TABLE barangay_risk_scores ADD COLUMN IF NOT EXISTS norm_neighbor_risk DOUBLE PRECISION;
ALTER TABLE barangay_risk_scores ADD COLUMN IF NOT EXISTS norm_forecast_error DOUBLE PRECISION;

-- Explicit model provenance: which classifier actually produced risk_class
-- for this row — 'random_forest' or 'rule_based' (fallback). Lets GIS and
-- the frontend distinguish a real RF classification from a rule-based one
-- instead of presenting both under one unlabeled "risk_class".
ALTER TABLE barangay_risk_scores ADD COLUMN IF NOT EXISTS model_type TEXT;

-- Model version string, same as model_predictions.model_version (e.g.
-- 'arima-v1.0-rf-v1.0') — lets a single row identify which model build
-- produced it without joining another table.
ALTER TABLE barangay_risk_scores ADD COLUMN IF NOT EXISTS model_version TEXT;

-- Classifier confidence: predict_proba of the PREDICTED class only (i.e.
-- proba[risk_class]), plus the full per-class distribution. NULL when
-- risk_class came from the rule-based fallback (classify_risk_simple
-- assigns 100% to one class by construction — not a real confidence, so it
-- is intentionally not persisted here as if it were one).
ALTER TABLE barangay_risk_scores ADD COLUMN IF NOT EXISTS classification_confidence DOUBLE PRECISION;
ALTER TABLE barangay_risk_scores ADD COLUMN IF NOT EXISTS prob_low DOUBLE PRECISION;
ALTER TABLE barangay_risk_scores ADD COLUMN IF NOT EXISTS prob_medium DOUBLE PRECISION;
ALTER TABLE barangay_risk_scores ADD COLUMN IF NOT EXISTS prob_high DOUBLE PRECISION;

-- The actual 8 RF feature values used to produce this row's classification
-- (see BACKEND/tbinsight/pipeline.js:buildFeatureRow), persisted so GIS can
-- show "indicators used" without re-running the model. Never presented as a
-- causal explanation — just the inputs the classifier actually saw.
ALTER TABLE barangay_risk_scores ADD COLUMN IF NOT EXISTS features JSONB;

-- alerts: unified alerts + notifications
CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  barangay_name TEXT REFERENCES barangays(name) ON DELETE CASCADE,
  period DATE NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  recommendation TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Notification extension columns
  type TEXT DEFAULT 'alert',
  title TEXT,
  source_module TEXT DEFAULT 'analytics',
  status TEXT DEFAULT 'unread',
  related_record_id TEXT,
  related_entity_type TEXT,
  metadata JSONB,
  read_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_barangay ON alerts(barangay_name);
CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alerts(is_read) WHERE is_read = FALSE;

-- model_metadata: pipeline run tracking
CREATE TABLE IF NOT EXISTS model_metadata (
  id BIGSERIAL PRIMARY KEY,
  run_type TEXT NOT NULL,
  model_version TEXT,
  trained_at TIMESTAMPTZ DEFAULT NOW(),
  training_months INTEGER,
  metrics JSONB,
  config JSONB
);

-- ==================== INTERVENTIONS ====================

-- interventions: TB intervention action planning
CREATE TABLE IF NOT EXISTS interventions (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  intervention_type TEXT NOT NULL,
  barangay_name TEXT NOT NULL,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  assigned_to TEXT,
  team TEXT,
  target_date DATE,
  completed_at TIMESTAMPTZ,
  created_by TEXT,
  related_alert_id BIGINT REFERENCES alerts(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interventions_status ON interventions(status);
CREATE INDEX IF NOT EXISTS idx_interventions_barangay ON interventions(barangay_name);
CREATE INDEX IF NOT EXISTS idx_interventions_priority ON interventions(priority);
