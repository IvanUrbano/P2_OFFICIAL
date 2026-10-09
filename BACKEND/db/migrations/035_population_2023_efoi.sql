-- Migration 035: 2023 barangay population aligned to the official city total
--
-- The 2023 figures were entered as a back-cast of FHSIS 2024 with PSA census growth
-- rates (city total 821,435). The DOH Metro Manila CHD eFOI response on tuberculosis
-- (Table 4, source LGU CHO/FHSIS report) gives the official 2023 Pasig City population:
-- 825,380. Same method as 2022 (migration 034): the official city total split by each
-- barangay's share of the FHSIS 2024 figures (largest-remainder rounding, exact total).
--
-- Only rows still carrying the back-cast label are updated, so a figure entered later
-- through the Population settings page is never overwritten. Idempotent.

UPDATE barangay_population p
SET population = v.population,
    source_organization = 'Derived — DOH-NCR eFOI 2023 city total with FHSIS 2024 barangay shares',
    source_reference = 'Pasig City 2023 population 825,380 (DOH Metro Manila CHD eFOI, Tuberculosis Table 4, source LGU CHO/FHSIS) split by barangay share of the FHSIS 2024 Pasig population estimates',
    notes = 'ESTIMATE at barangay level: the city total is the official 2023 figure; the split per barangay assumes each barangay''s 2024 FHSIS share. Replaces the earlier FHSIS-2024 back-cast (PSA census growth rate). Replace with official 2023 barangay figures if obtained.',
    updated_at = NOW()
FROM (VALUES
    ('Bagong Ilog', 20908),
    ('Bagong Katipunan', 872),
    ('Bambang', 21378),
    ('Buting', 10634),
    ('Caniogan', 28869),
    ('Dela Paz', 20360),
    ('Kalawaan', 33034),
    ('Kapasigan', 4911),
    ('Kapitolyo', 9460),
    ('Malinao', 4948),
    ('Manggahan', 90524),
    ('Maybunga', 46826),
    ('Oranbo', 3354),
    ('Palatiw', 28260),
    ('Pinagbuhatan', 168137),
    ('Pineda', 20038),
    ('Rosario', 76035),
    ('Sagad', 6201),
    ('San Antonio', 12047),
    ('San Joaquin', 14202),
    ('San Jose', 1853),
    ('San Miguel', 41317),
    ('San Nicolas', 2676),
    ('Santa Cruz', 5757),
    ('Santa Lucia', 44968),
    ('Santa Rosa', 1011),
    ('Santo Tomas', 13264),
    ('Santolan', 59543),
    ('Sumilang', 4451),
    ('Ugong', 29542)
) AS v(name, population)
WHERE p.barangay_name = v.name
  AND p.reference_year = 2023
  AND p.source_organization = 'Derived — DOH FHSIS 2024 with PSA census growth rate';
