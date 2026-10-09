-- Migration 036: 2026 Bagong Katipunan projection on the official 2025 figure
--
-- Migration 022 projected 2026 from each barangay's 2025 population. For Bagong
-- Katipunan that base was 945; the official recomputed 2025 estimate (Pasig Final
-- Recomputed 2025 Population Estimates) is 892 (pasig-barangays.geojson now carries it).
-- Same growth factor as 022 (908 / 945): 892 x 908 / 945 = 857.
-- Only the untouched projection (908, projection label) is changed: a figure entered
-- through the Population settings page is never overwritten. Idempotent.

UPDATE barangay_population
SET population = 857,
    notes = notes || ' Bagong Katipunan re-projected from the official 2025 figure 892 (was 945): 857.',
    updated_at = NOW()
WHERE barangay_name = 'Bagong Katipunan'
  AND reference_year = 2026
  AND population = 908
  AND source_organization = 'Derived — 2025 population with PSA census growth rate';
