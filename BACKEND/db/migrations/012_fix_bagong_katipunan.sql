-- Migration 012: Fix incorrect "Kapasigan Extension" barangay -> real "Bagong Katipunan"
-- Reason: pasig-barangays.geojson and pasig-health-facilities.csv incorrectly listed a
-- non-existent barangay "Kapasigan Extension" in place of the real Pasig City barangay
-- "Bagong Katipunan" (PSA PSGC code 1381200002, population ~945). This affected the
-- barangays reference table, the barangays_geom GIS polygons, and health_facilities.
--
-- ORDER MATTERS: "barangays" is referenced by 11 tables. tb_cases has an ON DELETE
-- RESTRICT foreign key on barangay_name, so any existing case rows tagged with
-- "Kapasigan Extension" must be retagged to "Bagong Katipunan" BEFORE the old row is
-- deleted -- and "Bagong Katipunan" must exist in barangays BEFORE we can retag onto it.
--
-- Aggregated L3/L4 tables (monthly_case_summary, demographic_summary, outcome_summary,
-- facility_summary, bacteriological_summary, model_predictions, barangay_risk_scores,
-- alerts) are all ON DELETE CASCADE from barangays. Any stale rows under "Kapasigan
-- Extension" in those tables will be dropped when the old barangay row is deleted below --
-- this is fine, they are recomputed by rebuildAggregations/pipeline runs. Re-run the
-- aggregation pipeline after this migration to regenerate them under the correct name.
--
-- The polygon boundary below is a manually-estimated approximation, but centered on the
-- real PhilAtlas-published centroid (14.5584, 121.0749) and sized/oriented to touch its
-- 5 real neighboring barangays per PhilAtlas: Bambang, Malinao, San Jose, Sumilang, and
-- Santa Rosa. Still not a surveyed boundary -- replace with official survey data
-- (e.g. from Pasig City Assessor's Office or NAMRIA) when available.
-- Sources: https://www.philatlas.com/luzon/ncr/pasig/bagong-katipunan.html
--          https://ph.geoview.info/bulwagang_pambarangay_ng_bagong_katipunan,346183386w

-- 1. Insert the real "Bagong Katipunan" barangay FIRST (idempotent) so retagging below
--    has a valid foreign key target.
INSERT INTO barangays (name, population, centroid_lon, centroid_lat)
VALUES ('Bagong Katipunan', 945, 121.0749, 14.5584)
ON CONFLICT (name) DO UPDATE SET
  population = EXCLUDED.population,
  centroid_lon = EXCLUDED.centroid_lon,
  centroid_lat = EXCLUDED.centroid_lat;

INSERT INTO barangays_geom (name, population, geom)
VALUES (
  'Bagong Katipunan',
  945,
  ST_SetSRID(ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[121.0752,14.5601],[121.0768,14.5595],[121.0762,14.5578],[121.0748,14.5568],[121.0732,14.5578],[121.0728,14.5595],[121.0752,14.5601]]]]}'), 4326)
)
ON CONFLICT (name) DO UPDATE SET
  population = EXCLUDED.population,
  geom = EXCLUDED.geom;

INSERT INTO health_facilities (name, barangay_name, facility_type)
VALUES ('Bagong Katipunan HC', 'Bagong Katipunan', 'HC')
ON CONFLICT (name, barangay_name) DO UPDATE SET
  facility_type = EXCLUDED.facility_type;

-- 2. Retag any existing case records off the fake barangay and onto the real one,
--    now that "Bagong Katipunan" exists as a valid foreign key target.
UPDATE tb_cases SET barangay_name = 'Bagong Katipunan' WHERE LOWER(barangay_name) = 'kapasigan extension';
UPDATE tb_cases_raw SET barangay_name = 'Bagong Katipunan' WHERE LOWER(barangay_name) = 'kapasigan extension';

-- 3. Now safe to remove the erroneous "Kapasigan Extension" rows -- nothing in tb_cases
--    references it anymore, and health_facilities/L3/L4 tables cascade automatically.
DELETE FROM barangays WHERE name = 'Kapasigan Extension';
DELETE FROM barangays_geom WHERE name = 'Kapasigan Extension';
