-- Migration 022: 2026 barangay population (projection)
--
-- TBInsight matches every incidence figure to the SAME calendar year's
-- population and never substitutes another year. With case data running into
-- 2026 and no 2026 reference, every 2026 month had no incidence: RF training
-- rows stopped at Dec 2025 and the current-period risk scores stored a null
-- incidence for all 30 barangays.
--
-- Projected from 2025 with each barangay's PSA 2020-2024 census annual growth
-- factor, the same factor the 2023 back-cast uses, so 2023-2026 sit on one
-- basis. ON CONFLICT DO NOTHING: an official 2026 figure entered through the
-- Population settings page is never overwritten.

INSERT INTO barangay_population
    (barangay_name, population, reference_year, source_organization, source_reference, notes, status)
SELECT v.name, v.population, 2026,
       'Derived — 2025 population with PSA census growth rate',
       'Pasig 2025 barangay population projected to 2026 using each barangay''s PSA 2020–2024 Census annual growth factor',
       'ESTIMATE, not a census count: no 2026 census or FHSIS figure is held yet. Method: pop_2026 = pop_2025 x (census_2024/census_2020)^(1/4), the same per-barangay PSA annual growth factor used to back-cast 2023 (equal to pop_2024/pop_2023 in this table). Replace with the official FHSIS 2026 figure when released.',
       'ACTIVE'
FROM (VALUES
    ('Bagong Ilog', 21744),
    ('Bagong Katipunan', 908),
    ('Bambang', 21855),
    ('Buting', 10952),
    ('Caniogan', 29592),
    ('Dela Paz', 20958),
    ('Kalawaan', 34127),
    ('Kapasigan', 5053),
    ('Kapitolyo', 9916),
    ('Malinao', 5189),
    ('Manggahan', 93150),
    ('Maybunga', 48944),
    ('Oranbo', 3448),
    ('Palatiw', 29030),
    ('Pinagbuhatan', 174218),
    ('Pineda', 20838),
    ('Rosario', 79166),
    ('Sagad', 6415),
    ('San Antonio', 13067),
    ('San Joaquin', 14611),
    ('San Jose', 1919),
    ('San Miguel', 43298),
    ('San Nicolas', 2791),
    ('Santa Cruz', 5937),
    ('Santa Lucia', 46270),
    ('Santa Rosa', 1043),
    ('Santo Tomas', 13818),
    ('Santolan', 61663),
    ('Sumilang', 4589),
    ('Ugong', 30890)
) AS v(name, population)
ON CONFLICT (barangay_name, reference_year) DO NOTHING;
