-- Migration 030: facility codes (used in the PASIG Case ID: <CODE>-<D|M>-<YEAR>-<NNNNN>)
--
-- Sets health_facilities.facility_code for the Pasig facilities already in the registry
-- and adds the treatment facilities found in the 2023-2026 registry files that were not
-- registered yet (private clinics / hospitals as reference facilities with their city —
-- their barangay is unknown). Codes were reviewed and approved before this migration.
--
-- SAFE / ADDITIVE: only empty facility_code values are filled and only missing facilities
-- are inserted; no row is deleted and no existing code is changed. Idempotent.
-- facility_code is unique (index health_facilities_code_key).

INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'The Medical City-Pasig', NULL, NULL, 'private', 'hospital', true, true, 'Pasig City', 'TMCP', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'TMCP')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('The Medical City-Pasig'));
UPDATE health_facilities SET facility_code = 'PINPC', updated_at = NOW() WHERE name = 'Pinagbuhatan Puericulture Center' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'PIN', updated_at = NOW() WHERE name = 'Pinagbuhatan HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'ROS', updated_at = NOW() WHERE name = 'Rosario HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'MAN', updated_at = NOW() WHERE name = 'Manggahan HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'SLU', updated_at = NOW() WHERE name = 'Santa Lucia HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'NAG', updated_at = NOW() WHERE name = 'Nagpayong HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'SNT', updated_at = NOW() WHERE name = 'Santolan HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'MBFW', updated_at = NOW() WHERE name = 'Maybunga Floodway' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'NAP', updated_at = NOW() WHERE name = 'Napico HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'KAL', updated_at = NOW() WHERE name = 'Kalawaan HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'SMI', updated_at = NOW() WHERE name = 'San Miguel HC' AND facility_code IS NULL;
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Lustre Medical And Diagnostic Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'LUS', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'LUS')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Lustre Medical And Diagnostic Clinic'));
UPDATE health_facilities SET facility_code = 'BAM', updated_at = NOW() WHERE name = 'Bambang HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'CAN', updated_at = NOW() WHERE name = 'Caniogan HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'PAL', updated_at = NOW() WHERE name = 'Palatiw HC' AND facility_code IS NULL;
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Pasig City Jail', NULL, NULL, 'public', 'other', true, true, 'Pasig City', 'PCJ', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'PCJ')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Pasig City Jail'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Tricity Medical Center', NULL, NULL, 'private', 'hospital', true, true, 'Pasig City', 'TRI', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'TRI')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Tricity Medical Center'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Lu Quezon Medical Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'LUQ', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'LUQ')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Lu Quezon Medical Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Maybunga Health Center', 'Maybunga', 'HC', 'public', 'health_center', false, false, NULL, 'MAY', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'MAY')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Maybunga Health Center'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'ARDI Health Services Inc.-Malinao-Pasig', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'ARDIM', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'ARDIM')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('ARDI Health Services Inc.-Malinao-Pasig'));
UPDATE health_facilities SET facility_code = 'PND', updated_at = NOW() WHERE name = 'Pineda HC' AND facility_code IS NULL;
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Alfonso Specialist Hospital', NULL, NULL, 'private', 'hospital', true, true, 'Pasig City', 'ALF', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'ALF')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Alfonso Specialist Hospital'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'S. A. Alvarez Medical Clinic-Pasig', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'ALV', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'ALV')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('S. A. Alvarez Medical Clinic-Pasig'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Holylife Hospital', NULL, NULL, 'private', 'hospital', true, true, 'Pasig City', 'HOLY', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'HOLY')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Holylife Hospital'));
UPDATE health_facilities SET facility_code = 'ESA', updated_at = NOW() WHERE name = 'E. Santos' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'BILPC', updated_at = NOW() WHERE name = 'Bagong Ilog PC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'SJQ', updated_at = NOW() WHERE name = 'San Joaquin HC' AND facility_code IS NULL;
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Rizal Medical Center', NULL, NULL, 'public', 'hospital', true, true, 'Pasig City', 'RMC', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'RMC')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Rizal Medical Center'));
UPDATE health_facilities SET facility_code = 'BIL', updated_at = NOW() WHERE name = 'Bagong Ilog HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'BUT', updated_at = NOW() WHERE name = 'Buting HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'KAP', updated_at = NOW() WHERE name = 'Kapitolyo HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'KPS', updated_at = NOW() WHERE name = 'Kapasigan HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'SAN', updated_at = NOW() WHERE name = 'San Antonio HC' AND facility_code IS NULL;
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'RJR Del Rosario Medical Clinic Co.', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'RJR', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'RJR')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('RJR Del Rosario Medical Clinic Co.'));
UPDATE health_facilities SET facility_code = 'UGO', updated_at = NOW() WHERE name = 'Ugong HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'STO', updated_at = NOW() WHERE name = 'Santo Tomas HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'MAL', updated_at = NOW() WHERE name = 'Malinao HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'KAR', updated_at = NOW() WHERE name = 'Karangalan HC' AND facility_code IS NULL;
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Santa Lucia Mini Floodway Health Center', 'Santa Lucia', 'Floodway', 'public', 'health_center', false, false, NULL, 'SLUFW', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'SLUFW')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Santa Lucia Mini Floodway Health Center'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Salve Regina General Hospital Inc.', NULL, NULL, 'private', 'hospital', true, true, 'Pasig City', 'SRGH', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'SRGH')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Salve Regina General Hospital Inc.'));
UPDATE health_facilities SET facility_code = 'ISM', updated_at = NOW() WHERE name = 'Ismar HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'DLP', updated_at = NOW() WHERE name = 'Dela Paz HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'SCR', updated_at = NOW() WHERE name = 'Santa Cruz HC' AND facility_code IS NULL;
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Faircare X-Ray And Clinic Laboratory', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'FAIR', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'FAIR')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Faircare X-Ray And Clinic Laboratory'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Pasig City General Hospital', NULL, NULL, 'public', 'hospital', true, true, 'Pasig City', 'PCGH', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'PCGH')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Pasig City General Hospital'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Jrveajedor Medical Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'JRV', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'JRV')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Jrveajedor Medical Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'St. Camillus Medical Center', NULL, NULL, 'private', 'hospital', true, true, 'Pasig City', 'SCMC', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'SCMC')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('St. Camillus Medical Center'));
UPDATE health_facilities SET facility_code = 'SNI', updated_at = NOW() WHERE name = 'San Nicolas HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'SAG', updated_at = NOW() WHERE name = 'Sagad HC' AND facility_code IS NULL;
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Purisima Pasig Clinic-Pasig', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'PURI', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'PURI')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Purisima Pasig Clinic-Pasig'));
UPDATE health_facilities SET facility_code = 'SJO', updated_at = NOW() WHERE name = 'San Jose HC' AND facility_code IS NULL;
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'ARDI Health Services Inc.-Mercedes-Pasig', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'ARDIR', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'ARDIR')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('ARDI Health Services Inc.-Mercedes-Pasig'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Mission Hospital', NULL, NULL, 'private', 'hospital', true, true, 'Pasig City', 'MISH', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'MISH')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Mission Hospital'));
UPDATE health_facilities SET facility_code = 'ORA', updated_at = NOW() WHERE name = 'Oranbo HC' AND facility_code IS NULL;
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Sumilang Super Health Center', 'Sumilang', 'HC', 'public', 'health_center', false, false, NULL, 'SUMSH', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'SUMSH')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Sumilang Super Health Center'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Francisco Medical Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'FRAN', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'FRAN')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Francisco Medical Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'A. Bautista Medical Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'BAUT', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'BAUT')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('A. Bautista Medical Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Santo Rosario Polyclinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'SRP', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'SRP')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Santo Rosario Polyclinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Accudetek Health Diagnostics', NULL, NULL, 'private', 'laboratory', true, true, 'Pasig City', 'ACCU', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'ACCU')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Accudetek Health Diagnostics'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'The Medical City Clinic-Sm Ortigas East', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'TMCSM', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'TMCSM')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('The Medical City Clinic-Sm Ortigas East'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Marikina Doctors Hospital And Medical Center', NULL, NULL, 'private', 'hospital', true, true, 'Marikina City', 'MDH', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'MDH')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Marikina Doctors Hospital And Medical Center'));
UPDATE health_facilities SET facility_code = 'SUM', updated_at = NOW() WHERE name = 'Sumilang HC' AND facility_code IS NULL;
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Pasig City Children Hospital Hope', NULL, NULL, 'public', 'hospital', true, true, 'Pasig City', 'PCCH', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'PCCH')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Pasig City Children Hospital Hope'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Healthlock Medical Dental Diagnostic Services', NULL, NULL, 'private', 'laboratory', true, true, 'Pasig City', 'HLOCK', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'HLOCK')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Healthlock Medical Dental Diagnostic Services'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Mercihub Multispecialty And Diagnostics', NULL, NULL, 'private', 'laboratory', true, true, 'Pasig City', 'MERCI', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'MERCI')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Mercihub Multispecialty And Diagnostics'));
UPDATE health_facilities SET facility_code = 'BKA', updated_at = NOW() WHERE name = 'Bagong Katipunan HC' AND facility_code IS NULL;
UPDATE health_facilities SET facility_code = 'DBE', updated_at = NOW() WHERE name = 'Dona Betang HC' AND facility_code IS NULL;
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Health Connection Medical Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'HCON', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'HCON')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Health Connection Medical Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Rigor Medical Clinic-Pasig', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'RIGOR', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'RIGOR')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Rigor Medical Clinic-Pasig'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'St. Hannah Medical Center', NULL, NULL, 'private', 'hospital', true, true, 'Pasig City', 'HANNA', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'HANNA')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('St. Hannah Medical Center'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Shammah Diagnostics Laboratory', NULL, NULL, 'private', 'laboratory', true, true, 'Pasig City', 'SHAM', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'SHAM')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Shammah Diagnostics Laboratory'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Lifes Hope Medical Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'LHOPE', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'LHOPE')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Lifes Hope Medical Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'The Medical City Clinic- Estancia Mall', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'TMCEM', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'TMCEM')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('The Medical City Clinic- Estancia Mall'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'The Clinic By MBCI', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'MBCI', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'MBCI')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('The Clinic By MBCI'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Santa Rosa De Lima Medical Clinic And Pharmacy Inc.', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'SRDL', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'SRDL')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Santa Rosa De Lima Medical Clinic And Pharmacy Inc.'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'L. O. Cezar Polyclinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'CEZAR', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'CEZAR')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('L. O. Cezar Polyclinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Alvez-Cunanan Family Care Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'ALVEZ', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'ALVEZ')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Alvez-Cunanan Family Care Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Mt. Hermont Medical Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'HERM', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'HERM')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Mt. Hermont Medical Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Ventura''s Medical Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'VENT', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'VENT')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Ventura''s Medical Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Countryside Medical Clinic-Pasig', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'CTRY', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'CTRY')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Countryside Medical Clinic-Pasig'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Parkwood Dental And Pedriatic Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'PARK', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'PARK')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Parkwood Dental And Pedriatic Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Vista Care Medical Clinic And Diagnostic Center', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'VISTA', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'VISTA')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Vista Care Medical Clinic And Diagnostic Center'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'VLF Medical Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'VLF', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'VLF')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('VLF Medical Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'The Medical City Clinic-Ayala Feliz', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'TMCAF', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'TMCAF')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('The Medical City Clinic-Ayala Feliz'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'San Antonio Abad Health Care', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'SAABD', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'SAABD')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('San Antonio Abad Health Care'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Corazon E. Castillo Conde M.D. Medical Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'CONDE', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'CONDE')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Corazon E. Castillo Conde M.D. Medical Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Med Help Clinic & Diagnostics', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'MEDH', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'MEDH')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Med Help Clinic & Diagnostics'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'LDC Diagnostics-Pasig', NULL, NULL, 'private', 'laboratory', true, true, 'Pasig City', 'LDC', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'LDC')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('LDC Diagnostics-Pasig'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Basilica De Piat Medical Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'PIAT', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'PIAT')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Basilica De Piat Medical Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'New World Diagnostics Inc.-Pasig City', NULL, NULL, 'private', 'laboratory', true, true, 'Pasig City', 'NWD', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'NWD')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('New World Diagnostics Inc.-Pasig City'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'St. Christiana Hospital Inc.', NULL, NULL, 'private', 'hospital', true, true, 'Pasig City', 'CHRIS', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'CHRIS')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('St. Christiana Hospital Inc.'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'F.B. Ancheta Children''s Medical & Diagnostic Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'ANCH', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'ANCH')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('F.B. Ancheta Children''s Medical & Diagnostic Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Dr. Gina Faustino Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'FAUS', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'FAUS')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Dr. Gina Faustino Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'St. Nicolas Medical And Pediatric Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'SNMP', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'SNMP')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('St. Nicolas Medical And Pediatric Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'St. John Medical Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'SJMC', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'SJMC')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('St. John Medical Clinic'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'TLCC Medical Services', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'TLCC', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'TLCC')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('TLCC Medical Services'));
INSERT INTO health_facilities (name, barangay_name, facility_type, ownership, facility_category, is_external, is_reference, city, facility_code, notes)
SELECT 'Floresmed Medical Care Clinic', NULL, NULL, 'private', 'clinic', true, true, 'Pasig City', 'FLOR', 'Added with facility codes (migration 030)'
WHERE NOT EXISTS (SELECT 1 FROM health_facilities WHERE facility_code = 'FLOR')
  AND NOT EXISTS (SELECT 1 FROM health_facilities WHERE lower(name) = lower('Floresmed Medical Care Clinic'));
