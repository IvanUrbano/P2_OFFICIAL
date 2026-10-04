-- ==========================================
-- Pasig Clone Database Schema
-- ==========================================
-- Creates all required tables.
-- Runs on server startup (idempotent: IF NOT EXISTS).
-- NOTE: Uses a SEPARATE database from TBInsight.
-- ==========================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Import batches
CREATE TABLE IF NOT EXISTS import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename TEXT NOT NULL,
    uploaded_by INTEGER,
    file_hash TEXT UNIQUE,
    status TEXT DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'validated', 'sent', 'failed')),
    total_rows INTEGER DEFAULT 0,
    dstb_count INTEGER DEFAULT 0,
    mn_count INTEGER DEFAULT 0,
    valid_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    validated_by INTEGER,
    validated_at TIMESTAMP,
    sent_at TIMESTAMP,
    synced_by INTEGER,
    synced_at TIMESTAMP,
    sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'syncing', 'synced', 'sync_failed')),
    sync_error TEXT
);

-- Raw TB cases (from CSV)
CREATE TABLE IF NOT EXISTS raw_tb_cases (
    id BIGSERIAL PRIMARY KEY,
    batch_id UUID REFERENCES import_batches(id),
    sheet_name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    row_number INTEGER,
    csv_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Validated TB cases (after validation)
CREATE TABLE IF NOT EXISTS validated_tb_cases (
    id BIGSERIAL PRIMARY KEY,
    batch_id UUID REFERENCES import_batches(id),
    source_type TEXT NOT NULL,

    -- Common fields (both sheets)
    barangay_name TEXT,
    date_of_diagnosis DATE,
    date_of_notification DATE,
    age INTEGER,
    sex TEXT,
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
    record_created_at TIMESTAMP,

    -- DSTB-specific fields
    date_of_screening DATE,
    validation_status TEXT,

    -- MN-specific fields
    itis_case_id TEXT,

    -- Validation results
    is_valid BOOLEAN DEFAULT true,
    validation_errors JSONB,
    validation_warnings JSONB,
    is_archived BOOLEAN DEFAULT false,

    -- Record classification and audit
    source_record_id TEXT,
    record_status TEXT DEFAULT 'new' CHECK (record_status IN ('new', 'existing', 'updated', 'duplicate')),
    updated_by INTEGER,
    updated_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT NOW()
);

-- Webhook logs
CREATE TABLE IF NOT EXISTS webhook_logs (
    id SERIAL PRIMARY KEY,
    batch_id UUID REFERENCES import_batches(id),
    payload JSONB,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'acknowledged')),
    response_code INTEGER,
    response_body TEXT,
    error_message TEXT,
    initiated_by INTEGER,
    initiated_at TIMESTAMP,
    sent_at TIMESTAMP DEFAULT NOW(),
    acknowledged_at TIMESTAMP
);

-- Audit logs (complete audit trail)
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    result TEXT,
    details JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ==========================================
-- Migrate existing tables (add missing columns)
-- ==========================================
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS file_hash TEXT;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS uploaded_by INTEGER;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS validated_by INTEGER;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS validated_at TIMESTAMP;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS synced_by INTEGER;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'pending';
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS sync_error TEXT;
-- When the current/last sync attempt began; lets an interrupted 'syncing' batch be recovered.
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS sync_started_at TIMESTAMP;
-- What TBInsight reported for the last successful sync (imported/updated/rejected counts),
-- so the result can be shown after a sync that ran in the background.
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS sync_result JSONB;

ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS source_record_id TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS record_status TEXT DEFAULT 'new';
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS updated_by INTEGER;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

-- New MN-specific clinical/laboratory columns
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS province TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS referred_to_dots TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS referral_status TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS microscopy_result TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS microscopy_release_date DATE;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS rdt_result TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS rdt_release_date DATE;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS outcome_reason TEXT;

-- Manual TB entry attribution — Clone-only provenance, never synced to TBInsight
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS entered_by_user_id INTEGER;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS entered_by_facility_id INTEGER;

ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS initiated_by INTEGER;
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS initiated_at TIMESTAMP;

-- Archive support for import batches
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS archived_by INTEGER;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS archive_reason TEXT;

-- Fix audit_logs columns to match what auth.js writes
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT 'system';
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_user_id INTEGER;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_username TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address TEXT;

-- Barangay population reference data
CREATE TABLE IF NOT EXISTS barangay_population (
    id SERIAL PRIMARY KEY,
    barangay_name TEXT NOT NULL,
    population INTEGER NOT NULL,
    reference_year INTEGER NOT NULL,
    source TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(barangay_name, reference_year)
);

CREATE INDEX IF NOT EXISTS idx_barangay_population_year ON barangay_population(reference_year);
CREATE INDEX IF NOT EXISTS idx_import_batches_archived ON import_batches(is_archived);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_raw_cases_batch ON raw_tb_cases(batch_id);
CREATE INDEX IF NOT EXISTS idx_validated_cases_batch ON validated_tb_cases(batch_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_batch ON webhook_logs(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_file_hash ON import_batches(file_hash);
CREATE INDEX IF NOT EXISTS idx_import_batches_sync_status ON import_batches(sync_status);
CREATE INDEX IF NOT EXISTS idx_validated_cases_source_record ON validated_tb_cases(source_type, source_record_id)
  WHERE source_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- MN-specific fields carried through to TBInsight (idempotent; safe on existing databases)
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS province TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS referred_to_dots TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS referral_status TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS microscopy_result TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS microscopy_release_date DATE;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS rdt_result TEXT;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS rdt_release_date DATE;
ALTER TABLE validated_tb_cases ADD COLUMN IF NOT EXISTS outcome_reason TEXT;
