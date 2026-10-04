-- Migration 015: barangay_population table for year-specific population references
-- 2025 population remains in GeoJSON (authoritative)
-- Future years (2026+) stored here

CREATE TABLE IF NOT EXISTS barangay_population (
    id SERIAL PRIMARY KEY,
    barangay_name TEXT NOT NULL REFERENCES barangays(name) ON DELETE CASCADE,
    population INTEGER NOT NULL CHECK (population > 0),
    reference_year INTEGER NOT NULL,
    source_organization TEXT NOT NULL,
    source_reference TEXT NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'INCOMPLETE', 'ACTIVE')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    updated_by INTEGER REFERENCES users(id),
    UNIQUE(barangay_name, reference_year)
);

CREATE INDEX IF NOT EXISTS idx_barangay_population_year
    ON barangay_population(reference_year);

CREATE INDEX IF NOT EXISTS idx_barangay_population_status
    ON barangay_population(status);