-- Migration 034: 2022 barangay population (official city total, FHSIS barangay split)
--
-- TBInsight matches every incidence figure to the SAME calendar year's
-- population and never substitutes another year. 2022 case data had no 2022
-- reference, so none of its months could become an RF training label and the
-- neighbour feature read 0 for all of them.
--
-- City total: 828,114, the official 2022 Pasig City population in the DOH Metro
-- Manila CHD eFOI response on tuberculosis (source: LGU CHO/FHSIS report, Table 3).
-- Split across barangays by each barangay's share of the FHSIS 2024 figures held for
-- 2024 (largest-remainder rounding, so the barangays add up to the city total exactly).
-- ON CONFLICT DO NOTHING: an official 2022 barangay figure entered through the
-- Population settings page is never overwritten.

INSERT INTO barangay_population
    (barangay_name, population, reference_year, source_organization, source_reference, notes, status)
SELECT v.name, v.population, 2022,
       'Derived — DOH-NCR eFOI 2022 city total with FHSIS 2024 barangay shares',
       'Pasig City 2022 population 828,114 (DOH Metro Manila CHD eFOI, Tuberculosis Table 3, source LGU CHO/FHSIS) split by barangay share of the FHSIS 2024 Pasig population estimates',
       'ESTIMATE at barangay level: the city total is the official 2022 figure; the split per barangay assumes each barangay''s 2024 FHSIS share. Replace with official 2022 barangay figures if obtained.',
       'ACTIVE'
FROM (VALUES
    ('Bagong Ilog', 20977),
    ('Bagong Katipunan', 875),
    ('Bambang', 21449),
    ('Buting', 10669),
    ('Caniogan', 28965),
    ('Dela Paz', 20427),
    ('Kalawaan', 33144),
    ('Kapasigan', 4928),
    ('Kapitolyo', 9491),
    ('Malinao', 4964),
    ('Manggahan', 90824),
    ('Maybunga', 46981),
    ('Oranbo', 3365),
    ('Palatiw', 28353),
    ('Pinagbuhatan', 168694),
    ('Pineda', 20104),
    ('Rosario', 76287),
    ('Sagad', 6222),
    ('San Antonio', 12087),
    ('San Joaquin', 14249),
    ('San Jose', 1859),
    ('San Miguel', 41454),
    ('San Nicolas', 2685),
    ('Santa Cruz', 5776),
    ('Santa Lucia', 45117),
    ('Santa Rosa', 1014),
    ('Santo Tomas', 13307),
    ('Santolan', 59741),
    ('Sumilang', 4466),
    ('Ugong', 29640)
) AS v(name, population)
ON CONFLICT (barangay_name, reference_year) DO NOTHING;
