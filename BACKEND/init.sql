-- ==========================================
-- TB System - Database Initialization Script
-- ==========================================
-- Run this script to create the required tables:
--   psql -U postgres -d tb_system -f init.sql
-- ==========================================

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,  -- Stores bcrypt hash, not plaintext
  role VARCHAR(20) DEFAULT 'staff',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Ensure role column is added if migrating existing DB
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'staff';

-- ==========================================
-- TBInsight tb_cases new columns
-- ==========================================
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS province TEXT;
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS referred_to_dots TEXT;
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS referral_status TEXT;
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS microscopy_result TEXT;
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS microscopy_release_date DATE;
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS rdt_result TEXT;
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS rdt_release_date DATE;
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS outcome_reason TEXT;

