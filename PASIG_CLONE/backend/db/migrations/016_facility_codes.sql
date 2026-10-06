-- Migration 016: facility codes in PASIG (Case ID = <CODE>-<D|M>-<YEAR>-<NNNNN>)
--
-- facility_ref.facility_code mirrors health_facilities.facility_code (TBInsight migration
-- 030; copied by services/barangayRegistry.js syncFacilityRef). Every treatment-facility
-- name found in the 2023-2026 files is registered as an alias of its facility, so a later
-- import finds the facility (and its code) from the name in the file.
--
-- SAFE / ADDITIVE: one column, aliases inserted only when missing. Idempotent.
-- Aliases need facility_ref to carry the codes (synced at startup); before that they are
-- skipped and the next run adds them.

ALTER TABLE facility_ref ADD COLUMN IF NOT EXISTS facility_code TEXT;

INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('THE MEDICAL CITY-PASIG - IDOTS'), 'THE MEDICAL CITY-PASIG - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'TMCP'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('THE MEDICAL CITY-PASIG - MTBN'), 'THE MEDICAL CITY-PASIG - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'TMCP'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('PINAGBUHATAN PUERICULTURE CENTER - IDOTS'), 'PINAGBUHATAN PUERICULTURE CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'PINPC'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('PINAGBUHATAN HEALTH CENTER - IDOTS'), 'PINAGBUHATAN HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'PIN'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('ROSARIO HEALTH CENTER - IDOTS'), 'ROSARIO HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'ROS'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('MANGGAHAN HEALTH CENTER - IDOTS'), 'MANGGAHAN HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'MAN'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('SANTA LUCIA HEALTH CENTER - IDOTS'), 'SANTA LUCIA HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'SLU'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('NAGPAYONG HEALTH CENTER - IDOTS'), 'NAGPAYONG HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'NAG'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('SANTOLAN HEALTH CENTER - IDOTS'), 'SANTOLAN HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'SNT'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('MAYBUNGA FLOODWAY HEALTH CENTER - IDOTS'), 'MAYBUNGA FLOODWAY HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'MBFW'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('NAPICO HEALTH CENTER - IDOTS'), 'NAPICO HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'NAP'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('KALAWAAN HEALTH CENTER - IDOTS'), 'KALAWAAN HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'KAL'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('SAN MIGUEL HEALTH CENTER - IDOTS'), 'SAN MIGUEL HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'SMI'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('LUSTRE MEDICAL AND DIAGNOSTIC CLINIC - MTBN'), 'LUSTRE MEDICAL AND DIAGNOSTIC CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'LUS'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('BAMBANG HEALTH CENTER - IDOTS'), 'BAMBANG HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'BAM'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('CANIOGAN HEALTH CENTER - IDOTS'), 'CANIOGAN HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'CAN'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('PALATIW HEALTH CENTER - IDOTS'), 'PALATIW HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'PAL'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('PASIG CITY JAIL - IDOTS'), 'PASIG CITY JAIL - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'PCJ'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('TRICITY MEDICAL CENTER - MTBN'), 'TRICITY MEDICAL CENTER - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'TRI'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('LU QUEZON MEDICAL CLINIC - MTBN'), 'LU QUEZON MEDICAL CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'LUQ'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('MAYBUNGA HEALTH CENTER - IDOTS'), 'MAYBUNGA HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'MAY'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('ARDI HEALTH SERVICES INC.-MALINAO-PASIG - MTBN'), 'ARDI HEALTH SERVICES INC.-MALINAO-PASIG - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'ARDIM'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('PINEDA HEALTH CENTER - IDOTS'), 'PINEDA HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'PND'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('ALFONSO SPECIALIST HOSPITAL - MTBN'), 'ALFONSO SPECIALIST HOSPITAL - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'ALF'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('S. A. ALVAREZ MEDICAL CLINIC-PASIG - MTBN'), 'S. A. ALVAREZ MEDICAL CLINIC-PASIG - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'ALV'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('HOLYLIFE HOSPITAL - MTBN'), 'HOLYLIFE HOSPITAL - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'HOLY'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('E. SANTOS HEALTH CENTER - IDOTS'), 'E. SANTOS HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'ESA'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('BAGONG ILOG PUERICULTURE CENTER - IDOTS'), 'BAGONG ILOG PUERICULTURE CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'BILPC'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('SAN JOAQUIN HEALTH CENTER - IDOTS'), 'SAN JOAQUIN HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'SJQ'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('RIZAL MEDICAL CENTER - IDOTS'), 'RIZAL MEDICAL CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'RMC'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('BAGONG ILOG HEALTH CENTER - IDOTS'), 'BAGONG ILOG HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'BIL'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('BUTING HEALTH CENTER - IDOTS'), 'BUTING HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'BUT'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('KAPITOLYO HEALTH CENTER - IDOTS'), 'KAPITOLYO HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'KAP'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('KAPASIGAN HEALTH CENTER - IDOTS'), 'KAPASIGAN HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'KPS'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('SAN ANTONIO HEALTH CENTER - IDOTS'), 'SAN ANTONIO HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'SAN'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('RJR DEL ROSARIO MEDICAL CLINIC CO. - MTBN'), 'RJR DEL ROSARIO MEDICAL CLINIC CO. - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'RJR'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('UGONG HEALTH CENTER-PASIG - IDOTS'), 'UGONG HEALTH CENTER-PASIG - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'UGO'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('SANTO TOMAS HEALTH CENTER - IDOTS'), 'SANTO TOMAS HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'STO'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('MALINAO HEALTH CENTER - IDOTS'), 'MALINAO HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'MAL'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('KARANGALAN HEALTH CENTER - IDOTS'), 'KARANGALAN HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'KAR'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('STA. LUCIA MINI FLOODWAY HEALTH CENTER - IDOTS'), 'STA. LUCIA MINI FLOODWAY HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'SLUFW'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('SALVE REGINA GENERAL HOSPITAL INC. - MTBN'), 'SALVE REGINA GENERAL HOSPITAL INC. - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'SRGH'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('ISMAR HEALTH CENTER - IDOTS'), 'ISMAR HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'ISM'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('DE LA PAZ HEALTH CENTER - IDOTS'), 'DE LA PAZ HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'DLP'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('SANTA CRUZ HEALTH CENTER - IDOTS'), 'SANTA CRUZ HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'SCR'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('FAIRCARE X-RAY AND CLINIC LABORATORY - MTBN'), 'FAIRCARE X-RAY AND CLINIC LABORATORY - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'FAIR'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('PASIG CITY GENERAL HOSPITAL - IDOTS'), 'PASIG CITY GENERAL HOSPITAL - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'PCGH'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('JRVEAJEDOR MEDICAL CLINIC - MTBN'), 'JRVEAJEDOR MEDICAL CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'JRV'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('ST. CAMILLUS MEDICAL CENTER - IDOTS'), 'ST. CAMILLUS MEDICAL CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'SCMC'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('ST. CAMILLUS MEDICAL CENTER - MTBN'), 'ST. CAMILLUS MEDICAL CENTER - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'SCMC'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('SAN NICOLAS HEALTH CENTER - IDOTS'), 'SAN NICOLAS HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'SNI'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('SAGAD HEALTH CENTER - IDOTS'), 'SAGAD HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'SAG'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('PURISIMA PASIG CLINIC-PASIG - MTBN'), 'PURISIMA PASIG CLINIC-PASIG - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'PURI'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('SAN JOSE HEALTH CENTER - IDOTS'), 'SAN JOSE HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'SJO'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('ARDI HEALTH SERVICES INC.-MERCEDES-PASIG - MTBN'), 'ARDI HEALTH SERVICES INC.-MERCEDES-PASIG - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'ARDIR'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('MISSION HOSPITAL - MTBN'), 'MISSION HOSPITAL - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'MISH'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('ORANBO HEALTH CENTER - IDOTS'), 'ORANBO HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'ORA'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('SUMILANG SUPER HEALTH CENTER - IDOTS'), 'SUMILANG SUPER HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'SUMSH'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('FRANCISCO MEDICAL CLINIC - MTBN'), 'FRANCISCO MEDICAL CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'FRAN'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('A. BAUTISTA MEDICAL CLINIC - MTBN'), 'A. BAUTISTA MEDICAL CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'BAUT'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('STO. ROSARIO POLYCLINIC - MTBN'), 'STO. ROSARIO POLYCLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'SRP'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('ACCUDETEK HEALTH DIAGNOSTICS - MTBN'), 'ACCUDETEK HEALTH DIAGNOSTICS - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'ACCU'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('THE MEDICAL CITY CLINIC-SM ORTIGAS EAST - MTBN'), 'THE MEDICAL CITY CLINIC-SM ORTIGAS EAST - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'TMCSM'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('MARIKINA DOCTORS HOSPITAL AND MEDICAL CENTER - MTBN'), 'MARIKINA DOCTORS HOSPITAL AND MEDICAL CENTER - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'MDH'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('SUMILANG HEALTH CENTER - IDOTS'), 'SUMILANG HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'SUM'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('PASIG CITY CHILDREN HOSPITAL HOPE - IDOTS'), 'PASIG CITY CHILDREN HOSPITAL HOPE - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'PCCH'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('HEALTHLOCK MEDICAL DENTAL DIAGNOSTIC SERVICES - MTBN'), 'HEALTHLOCK MEDICAL DENTAL DIAGNOSTIC SERVICES - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'HLOCK'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('MERCIHUB MULTISPECIALTY AND DIAGNOSTICS - MTBN'), 'MERCIHUB MULTISPECIALTY AND DIAGNOSTICS - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'MERCI'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('BAGONG KATIPUNAN HEALTH CENTER - IDOTS'), 'BAGONG KATIPUNAN HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'BKA'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('DOÑA BETANG HEALTH CENTER - IDOTS'), 'DOÑA BETANG HEALTH CENTER - IDOTS', f.id FROM facility_ref f WHERE f.facility_code = 'DBE'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('HEALTH CONNECTION MEDICAL CLINIC - MTBN'), 'HEALTH CONNECTION MEDICAL CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'HCON'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('RIGOR MEDICAL CLINIC-PASIG - MTBN'), 'RIGOR MEDICAL CLINIC-PASIG - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'RIGOR'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('ST. HANNAH MEDICAL CENTER - MTBN'), 'ST. HANNAH MEDICAL CENTER - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'HANNA'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('SHAMMAH DIAGNOSTICS LABORATORY - MTBN'), 'SHAMMAH DIAGNOSTICS LABORATORY - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'SHAM'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('LIFES HOPE MEDICAL CLINIC - MTBN'), 'LIFES HOPE MEDICAL CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'LHOPE'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('THE MEDICAL CITY CLINIC- ESTANCIA MALL - MTBN'), 'THE MEDICAL CITY CLINIC- ESTANCIA MALL - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'TMCEM'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('THE CLINIC BY MBCI - MTBN'), 'THE CLINIC BY MBCI - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'MBCI'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('STA. ROSA DE LIMA MEDICAL CLINIC AND PHARMACY INC. - MTBN'), 'STA. ROSA DE LIMA MEDICAL CLINIC AND PHARMACY INC. - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'SRDL'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('L. O. CEZAR POLYCLINIC - MTBN'), 'L. O. CEZAR POLYCLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'CEZAR'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('ALVEZ-CUNANAN FAMILY CARE CLINIC - MTBN'), 'ALVEZ-CUNANAN FAMILY CARE CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'ALVEZ'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('MT. HERMONT MEDICAL CLINIC - MTBN'), 'MT. HERMONT MEDICAL CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'HERM'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('VENTURA`S MEDICAL CLINIC - MTBN'), 'VENTURA`S MEDICAL CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'VENT'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('COUNTRYSIDE MEDICAL CLINIC-PASIG - MTBN'), 'COUNTRYSIDE MEDICAL CLINIC-PASIG - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'CTRY'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('PARKWOOD DENTAL AND PEDRIATIC CLINIC - MTBN'), 'PARKWOOD DENTAL AND PEDRIATIC CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'PARK'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('VISTA CARE MEDICAL CLINIC AND DIAGNOSTIC CENTER - MTBN'), 'VISTA CARE MEDICAL CLINIC AND DIAGNOSTIC CENTER - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'VISTA'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('VLF MEDICAL CLINIC - MTBN'), 'VLF MEDICAL CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'VLF'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('THE MEDICAL CITY CLINIC-AYALA FELIZ - MTBN'), 'THE MEDICAL CITY CLINIC-AYALA FELIZ - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'TMCAF'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('SAN ANTONIO ABAD HEALTH CARE - MTBN'), 'SAN ANTONIO ABAD HEALTH CARE - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'SAABD'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('CORAZON E. CASTILLO CONDE M.D. MEDICAL CLINIC - MTBN'), 'CORAZON E. CASTILLO CONDE M.D. MEDICAL CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'CONDE'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('MED HELP CLINIC & DIAGNOSTICS - MTBN'), 'MED HELP CLINIC & DIAGNOSTICS - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'MEDH'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('LDC DIAGNOSTICS-PASIG - MTBN'), 'LDC DIAGNOSTICS-PASIG - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'LDC'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('BASILICA DE PIAT MEDICAL CLINIC - MTBN'), 'BASILICA DE PIAT MEDICAL CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'PIAT'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('NEW WORLD DIAGNOSTICS INC.-PASIG CITY - MTBN'), 'NEW WORLD DIAGNOSTICS INC.-PASIG CITY - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'NWD'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('ST. CHRISTIANA HOSPITAL INC. - MTBN'), 'ST. CHRISTIANA HOSPITAL INC. - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'CHRIS'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('F.B. ANCHETA CHILDREN`S MEDICAL & DIAGNOSTIC CLINIC - MTBN'), 'F.B. ANCHETA CHILDREN`S MEDICAL & DIAGNOSTIC CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'ANCH'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('DR. GINA FAUSTINO CLINIC - MTBN'), 'DR. GINA FAUSTINO CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'FAUS'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('ST. NICOLAS MEDICAL AND PEDIATRIC CLINIC - MTBN'), 'ST. NICOLAS MEDICAL AND PEDIATRIC CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'SNMP'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('ST. JOHN MEDICAL CLINIC - MTBN'), 'ST. JOHN MEDICAL CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'SJMC'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('TLCC MEDICAL SERVICES - MTBN'), 'TLCC MEDICAL SERVICES - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'TLCC'
ON CONFLICT (alias_norm) DO NOTHING;
INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
SELECT norm_facility('FLORESMED MEDICAL CARE CLINIC - MTBN'), 'FLORESMED MEDICAL CARE CLINIC - MTBN', f.id FROM facility_ref f WHERE f.facility_code = 'FLOR'
ON CONFLICT (alias_norm) DO NOTHING;
