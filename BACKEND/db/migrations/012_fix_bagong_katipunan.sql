-- Migration 008: Fix incorrect "Kapasigan Extension" barangay -> real "Bagong Katipunan"
-- Reason: pasig-barangays.geojson and pasig-health-facilities.csv incorrectly listed a
-- non-existent barangay "Kapasigan Extension" in place of the real Pasig City barangay
-- "Bagong Katipunan" (PSA PSGC code 1381200002, population ~945). This affected the
-- barangays reference table, the barangays_geom GIS polygons, and health_facilities.
--
-- The polygon coordinates below are a manually-estimated approximation (nestled between
-- Sumilang, San Jose, Santa Rosa, and San Nicolas per a reference map), not a surveyed
-- boundary. Replace with official survey data (e.g. from Pasig City Assessor's Office or
-- NAMRIA) when available.

-- 1. Remove the erroneous "Kapasigan Extension" rows
DELETE FROM barangays WHERE name = 'Kapasigan Extension';
DELETE FROM barangays_geom WHERE name = 'Kapasigan Extension';
DELETE FROM health_facilities WHERE barangay_name = 'Kapasigan Extension';

-- 2. Insert the real "Bagong Katipunan" barangay (idempotent)
INSERT INTO barangays (name, population, centroid_lon, centroid_lat)
VALUES ('Bagong Katipunan', 945, 121.074, 14.5595)
ON CONFLICT (name) DO UPDATE SET
  population = EXCLUDED.population,
  centroid_lon = EXCLUDED.centroid_lon,
  centroid_lat = EXCLUDED.centroid_lat;

INSERT INTO barangays_geom (name, population, geom)
VALUES (
  'Bagong Katipunan',
  945,
  ST_SetSRID(ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[121.073,14.5615],[121.0758,14.5608],[121.0755,14.5582],[121.0735,14.5578],[121.0722,14.5592],[121.073,14.5615]]]]}'), 4326)
)
ON CONFLICT (name) DO UPDATE SET
  population = EXCLUDED.population,
  geom = EXCLUDED.geom;

INSERT INTO health_facilities (name, barangay_name, facility_type)
VALUES ('Bagong Katipunan HC', 'Bagong Katipunan', 'HC')
ON CONFLICT (name, barangay_name) DO UPDATE SET
  facility_type = EXCLUDED.facility_type;

-- 3. Fix any case records that were (mis)tagged with the non-existent barangay
UPDATE tb_cases SET barangay_name = 'Bagong Katipunan' WHERE LOWER(barangay_name) = 'kapasigan extension';
UPDATE tb_cases_raw SET barangay_name = 'Bagong Katipunan' WHERE LOWER(barangay_name) = 'kapasigan extension';
