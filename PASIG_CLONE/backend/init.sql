-- ==========================================
-- Pasig Clone Database Schema
-- ==========================================
-- Creates the pasig_clone schema and all required tables.
-- Runs on server startup (idempotent: IF NOT EXISTS).
-- ==========================================

-- Create separate schema
CREATE SCHEMA IF NOT EXISTS pasig_clone;

-- Users table
CREATE TABLE IF NOT EXISTS pasig_clone.users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Import batches
CREATE TABLE IF NOT EXISTS pasig_clone.import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename TEXT NOT NULL,
    uploaded_by INTEGER REFERENCES pasig_clone.users(id),
    status TEXT DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'validated', 'sent', 'failed')),
    total_rows INTEGER DEFAULT 0,
    dstb_count INTEGER DEFAULT 0,
    mn_count INTEGER DEFAULT 0,
    valid_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    validated_at TIMESTAMP,
    sent_at TIMESTAMP
);

-- Raw TB cases (from CSV)
CREATE TABLE IF NOT EXISTS pasig_clone.raw_tb_cases (
    id BIGSERIAL PRIMARY KEY,
    batch_id UUID REFERENCES pasig_clone.import_batches(id),
    sheet_name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    row_number INTEGER,
    csv_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Validated TB cases (after validation)
CREATE TABLE IF NOT EXISTS pasig_clone.validated_tb_cases (
    id BIGSERIAL PRIMARY KEY,
    batch_id UUID REFERENCES pasig_clone.import_batches(id),
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

    created_at TIMESTAMP DEFAULT NOW()
);

-- Webhook logs
CREATE TABLE IF NOT EXISTS pasig_clone.webhook_logs (
    id SERIAL PRIMARY KEY,
    batch_id UUID REFERENCES pasig_clone.import_batches(id),
    payload JSONB,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'acknowledged')),
    response_code INTEGER,
    response_body TEXT,
    error_message TEXT,
    sent_at TIMESTAMP DEFAULT NOW(),
    acknowledged_at TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_raw_cases_batch ON pasig_clone.raw_tb_cases(batch_id);
CREATE INDEX IF NOT EXISTS idx_validated_cases_batch ON pasig_clone.validated_tb_cases(batch_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_batch ON pasig_clone.webhook_logs(batch_id);
