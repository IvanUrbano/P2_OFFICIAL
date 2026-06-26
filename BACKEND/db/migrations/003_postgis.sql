-- 003_postgis.sql — Enable PostGIS + create barangays_geom table
-- Idempotent: runs on every startup

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Barangays with PostGIS geometry
CREATE TABLE IF NOT EXISTS barangays_geom (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  population INTEGER DEFAULT 0,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial index for fast containment/distance queries
CREATE INDEX IF NOT EXISTS idx_barangays_geom
ON barangays_geom USING GIST (geom);
