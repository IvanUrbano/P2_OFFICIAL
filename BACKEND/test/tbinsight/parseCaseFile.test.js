const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDate,
  validateRow,
  parseCaseFile,
  normalizeSex,
  matchHeader,
  buildColumnMap,
} = require('../../tbinsight/parseCaseFile');

// ==================== matchHeader ====================
describe('matchHeader', () => {
  it('maps "barangay"', () => {
    assert.equal(matchHeader('barangay'), 'barangay_name');
  });

  it('maps "date of diagnosis"', () => {
    assert.equal(matchHeader('date of diagnosis'), 'date_of_diagnosis');
  });

  it('maps "date of notification"', () => {
    assert.equal(matchHeader('date of notification'), 'date_of_notification');
  });

  it('maps "date of screening"', () => {
    assert.equal(matchHeader('date of screening'), 'date_of_screening');
  });

  it('maps "date started treatment"', () => {
    assert.equal(matchHeader('date started treatment'), 'date_started_treatment');
  });

  it('maps "date of outcome/status"', () => {
    assert.equal(matchHeader('date of outcome/status'), 'date_of_outcome');
  });

  it('maps "outcome/status" (no date)', () => {
    assert.equal(matchHeader('outcome/status'), 'outcome_status');
  });

  it('maps "screening/diagnosis health facility"', () => {
    assert.equal(matchHeader('screening/diagnosis health facility'), 'screening_facility');
  });

  it('maps mangled "screening/diagnosis health" (no Facility)', () => {
    assert.equal(matchHeader('screening/diagnosis health'), 'screening_facility');
  });

  it('maps "treatment health facility"', () => {
    assert.equal(matchHeader('treatment health facility'), 'treatment_facility');
  });

  it('maps mangled "facilitytreatment health facility"', () => {
    assert.equal(matchHeader('facilitytreatment health facility'), 'treatment_facility');
  });

  it('maps "date/time record created"', () => {
    assert.equal(matchHeader('date/time record created'), 'record_created_at');
  });

  it('maps "sex"', () => {
    assert.equal(matchHeader('sex'), 'sex');
  });

  it('maps "age"', () => {
    assert.equal(matchHeader('age'), 'age');
  });

  it('maps "city"', () => {
    assert.equal(matchHeader('city'), 'city');
  });

  it('maps "city/municipality"', () => {
    assert.equal(matchHeader('city/municipality'), 'city');
  });

  it('maps "no." to null (skip)', () => {
    assert.equal(matchHeader('no.'), null);
  });

  it('maps "validation status"', () => {
    assert.equal(matchHeader('validation status'), 'validation_status');
  });

  it('maps "bacteriological status"', () => {
    assert.equal(matchHeader('bacteriological status'), 'bacteriological_status');
  });

  it('maps "source of patient"', () => {
    assert.equal(matchHeader('source of patient'), 'source_of_patient');
  });

  it('maps "anatomical site"', () => {
    assert.equal(matchHeader('anatomical site'), 'anatomical_site');
  });

  it('maps "registration group"', () => {
    assert.equal(matchHeader('registration group'), 'registration_group');
  });

  it('returns null for unknown header', () => {
    assert.equal(matchHeader('some random column'), null);
  });
});

// ==================== buildColumnMap ====================
describe('buildColumnMap', () => {
  it('maps old 18-col headers', () => {
    const headers = [
      'Validation Status', 'Date of Screening', 'Date of Diagnosis',
      'Date of Notification', 'Age', 'Sex', 'Barangay', 'City',
      'Screening/Diagnosis Health Facility', 'Treatment Health Facility',
      'Source of Patient', 'Anatomical Site', 'Registration Group',
      'Bacteriological Status', 'Date Started Treatment', 'Outcome/Status',
      'Date of Outcome/Status', 'Date/Time Record Created',
    ];
    const map = buildColumnMap(headers);
    assert.equal(map['Barangay'], 'barangay_name');
    assert.equal(map['Date of Diagnosis'], 'date_of_diagnosis');
    assert.equal(map['Sex'], 'sex');
    assert.equal(map['Screening/Diagnosis Health Facility'], 'screening_facility');
    assert.equal(map['Treatment Health Facility'], 'treatment_facility');
    assert.equal(Object.keys(map).length, 18);
  });

  it('maps new 19-col headers with mangled names', () => {
    const headers = [
      'No.', 'Validation Status', 'Date of Screening', 'Date of Diagnosis',
      ' Date of Notification', 'Age', 'Sex', 'Barangay', 'City',
      'Screening/Diagnosis Health', 'FacilityTreatment Health Facility',
      'Source of Patient', 'Anatomical Site', 'Registration Group',
      'Bacteriological Status', 'Date Started Treatment', 'Outcome/Status',
      'Date of Outcome/Status', 'Date/Time Record Created',
    ];
    const map = buildColumnMap(headers);
    assert.equal(map['Barangay'], 'barangay_name');
    assert.equal(map['Date of Diagnosis'], 'date_of_diagnosis');
    assert.equal(map['Screening/Diagnosis Health'], 'screening_facility');
    assert.equal(map['FacilityTreatment Health Facility'], 'treatment_facility');
    assert.equal(map[' Date of Notification'], 'date_of_notification');
    assert.equal(map['No.'], undefined); // skipped
    assert.equal(Object.keys(map).length, 18); // 19 minus "No."
  });
});

// ==================== normalizeSex ====================
describe('normalizeSex', () => {
  it('normalizes "M" to "Male"', () => {
    assert.equal(normalizeSex('M'), 'Male');
  });

  it('normalizes "F" to "Female"', () => {
    assert.equal(normalizeSex('F'), 'Female');
  });

  it('normalizes "male" to "Male"', () => {
    assert.equal(normalizeSex('male'), 'Male');
  });

  it('normalizes "Female" to "Female"', () => {
    assert.equal(normalizeSex('Female'), 'Female');
  });

  it('normalizes " m " (with spaces) to "Male"', () => {
    assert.equal(normalizeSex(' m '), 'Male');
  });

  it('returns null for empty', () => {
    assert.equal(normalizeSex(''), null);
    assert.equal(normalizeSex(null), null);
  });

  it('returns null for unknown value', () => {
    assert.equal(normalizeSex('Other'), null);
  });
});

// ==================== parseDate ====================
describe('parseDate', () => {
  it('parses ISO format YYYY-MM-DD', () => {
    assert.equal(parseDate('2024-01-15'), '2024-01-15');
  });

  it('parses US format MM/DD/YYYY', () => {
    assert.equal(parseDate('01/15/2024'), '2024-01-15');
  });

  it('parses US format M/D/YYYY', () => {
    assert.equal(parseDate('1/5/2024'), '2024-01-05');
  });

  it('parses format with dashes MM-DD-YYYY', () => {
    assert.equal(parseDate('03-20-2024'), '2024-03-20');
  });

  it('parses DD-Mon-YY (e.g. "8-Jul-26")', () => {
    assert.equal(parseDate('8-Jul-26'), '2026-07-08');
  });

  it('parses DD-Mon-YY (e.g. "16-Dec-25")', () => {
    assert.equal(parseDate('16-Dec-25'), '2025-12-16');
  });

  it('parses DD-Mon-YY (e.g. "9-Jan-26")', () => {
    assert.equal(parseDate('9-Jan-26'), '2026-01-09');
  });

  it('parses DD-Mon-YYYY', () => {
    assert.equal(parseDate('8-Jul-2026'), '2026-07-08');
  });

  it('returns null for empty string', () => {
    assert.equal(parseDate(''), null);
  });

  it('returns null for null', () => {
    assert.equal(parseDate(null), null);
  });

  it('returns null for invalid date', () => {
    assert.equal(parseDate('not-a-date'), null);
  });

  it('handles Date objects', () => {
    const d = new Date(2024, 0, 15); // Jan 15 2024
    assert.equal(parseDate(d), '2024-01-15');
  });

  it('returns null for invalid Date object', () => {
    assert.equal(parseDate(new Date('invalid')), null);
  });
});

// ==================== validateRow ====================
describe('validateRow', () => {
  const validBarangays = new Set(['bagong ilog', 'kalawaan', 'manggahan', 'santolan', 'maybunga', 'pinagbuhatan', 'caniogan']);

  it('validates a correct row', () => {
    const row = {
      barangay_name: 'Bagong Ilog',
      date_of_diagnosis: '2024-01-15',
      sex: 'Male',
      age: 25,
      city: 'Pasig',
    };
    const result = validateRow(row, validBarangays);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects missing barangay', () => {
    const row = {
      barangay_name: '',
      date_of_diagnosis: '2024-01-15',
      sex: 'Male',
    };
    const result = validateRow(row, validBarangays);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Barangay is required')));
  });

  it('rejects unknown barangay for Pasig records', () => {
    const row = {
      barangay_name: 'Unknown Barangay',
      date_of_diagnosis: '2024-01-15',
      sex: 'Male',
      city: 'Pasig',
    };
    const result = validateRow(row, validBarangays);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Unknown barangay')));
  });

  it('warns on unknown barangay for non-Pasig records', () => {
    const row = {
      barangay_name: 'Unknown Barangay',
      date_of_diagnosis: '2024-01-15',
      sex: 'Male',
      city: 'Manila',
    };
    const result = validateRow(row, validBarangays);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some(w => w.includes('Non-Pasig record')));
  });

  it('rejects missing date_of_diagnosis', () => {
    const row = {
      barangay_name: 'Bagong Ilog',
      date_of_diagnosis: null,
      sex: 'Male',
    };
    const result = validateRow(row, validBarangays);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Date of Diagnosis is required')));
  });

  it('rejects missing sex', () => {
    const row = {
      barangay_name: 'Bagong Ilog',
      date_of_diagnosis: '2024-01-15',
      sex: '',
    };
    const result = validateRow(row, validBarangays);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Sex is required')));
  });

  it('rejects invalid sex value', () => {
    const row = {
      barangay_name: 'Bagong Ilog',
      date_of_diagnosis: '2024-01-15',
      sex: 'Other',
    };
    const result = validateRow(row, validBarangays);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Invalid sex')));
  });

  it('rejects age out of range', () => {
    const row = {
      barangay_name: 'Bagong Ilog',
      date_of_diagnosis: '2024-01-15',
      sex: 'Male',
      age: 150,
    };
    const result = validateRow(row, validBarangays);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Invalid age')));
  });

  it('accepts valid age', () => {
    const row = {
      barangay_name: 'Bagong Ilog',
      date_of_diagnosis: '2024-01-15',
      sex: 'Female',
      age: 45,
    };
    const result = validateRow(row, validBarangays);
    assert.equal(result.valid, true);
  });

  it('warns on city mismatch', () => {
    const row = {
      barangay_name: 'Bagong Ilog',
      date_of_diagnosis: '2024-01-15',
      sex: 'Male',
      city: 'Manila',
    };
    const result = validateRow(row, validBarangays);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some(w => w.includes('City is "Manila"')));
  });

  it('warns on facility mismatch', () => {
    const row = {
      barangay_name: 'Kalawaan',
      date_of_diagnosis: '2024-01-15',
      sex: 'Male',
      screening_facility: 'Some Unknown HC',
    };
    const result = validateRow(row, validBarangays);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some(w => w.includes('Screening facility')));
  });

  it('accepts matching facility', () => {
    const row = {
      barangay_name: 'Kalawaan',
      date_of_diagnosis: '2024-01-15',
      sex: 'Male',
      screening_facility: 'Ismar HC',
    };
    const result = validateRow(row, validBarangays);
    assert.equal(result.valid, true);
    assert.equal(result.warnings.length, 0);
  });
});

// ==================== parseCaseFile ====================
describe('parseCaseFile', () => {
  const validBarangays = new Set(['bagong ilog', 'kalawaan', 'manggahan', 'caniogan']);

  it('parses a valid CSV buffer (old 18-col format)', () => {
    const csvContent = [
      'Validation Status,Date of Screening,Date of Diagnosis,Date of Notification,Age,Sex,Barangay,City,Screening/Diagnosis Health Facility,Treatment Health Facility,Source of Patient,Anatomical Site,Registration Group,Bacteriological Status,Date Started Treatment,Outcome/Status,Date of Outcome/Status,Date/Time Record Created',
      'Validated,01/01/2024,01/15/2024,01/20/2024,25,Male,Bagong Ilog,Pasig,Bagong Ilog HC,Bagong Ilog HC,Barangay,Pulmonary,New,Smear Positive,02/01/2024,Cured,06/01/2024,01/01/2024',
    ].join('\n');

    const buffer = Buffer.from(csvContent, 'utf8');
    const result = parseCaseFile(buffer, 'test.csv', validBarangays);

    assert.equal(result.totalRows, 1);
    assert.equal(result.validCount, 1);
    assert.equal(result.errorCount, 0);
    assert.equal(result.rows[0].barangay_name, 'Bagong Ilog');
    assert.equal(result.rows[0].sex, 'Male');
    assert.equal(result.rows[0].age, 25);
    assert.equal(result.rows[0].date_of_diagnosis, '2024-01-15');
  });

  it('parses new 19-col format with mangled headers', () => {
    const csvContent = [
      'No.,Validation Status,Date of Screening,Date of Diagnosis, Date of Notification,Age,Sex,Barangay,City,Screening/Diagnosis Health,FacilityTreatment Health Facility,Source of Patient,Anatomical Site,Registration Group,Bacteriological Status,Date Started Treatment,Outcome/Status,Date of Outcome/Status,Date/Time Record Created',
      '1,Validated,8-Jul-26,8-Jan-26,8-Jan-26,36,M,CANIOGAN,PASIG CITY,CANIOGAN HEALTH CENTER - IDOTS,CANIOGAN HEALTH CENTER - IDOTS,OTHER PUBLIC FACILITY,P,NEW,BACTORIOLOGICALLY-CONFIRMED TB,16-Dec-25,ON TREATMENT,16-Dec-25,2/1/2026 17:59',
    ].join('\n');

    const buffer = Buffer.from(csvContent, 'utf8');
    const result = parseCaseFile(buffer, 'test.csv', validBarangays);

    assert.equal(result.totalRows, 1);
    assert.equal(result.validCount, 1);
    assert.equal(result.errorCount, 0);
    assert.equal(result.rows[0].barangay_name, 'CANIOGAN');
    assert.equal(result.rows[0].sex, 'Male');
    assert.equal(result.rows[0].age, 36);
    assert.equal(result.rows[0].date_of_diagnosis, '2026-01-08');
    assert.equal(result.rows[0].date_of_screening, '2026-07-08');
    assert.equal(result.rows[0].screening_facility, 'CANIOGAN HEALTH CENTER - IDOTS');
    assert.equal(result.rows[0].treatment_facility, 'CANIOGAN HEALTH CENTER - IDOTS');
  });

  it('normalizes M/F sex to Male/Female', () => {
    const csvContent = [
      'No.,Validation Status,Date of Screening,Date of Diagnosis, Date of Notification,Age,Sex,Barangay,City,Screening/Diagnosis Health,FacilityTreatment Health Facility,Source of Patient,Anatomical Site,Registration Group,Bacteriological Status,Date Started Treatment,Outcome/Status,Date of Outcome/Status,Date/Time Record Created',
      '1,Validated,8-Jul-26,8-Jan-26,8-Jan-26,70,F,CANIOGAN,PASIG CITY,CANIOGAN HEALTH CENTER - IDOTS,CANIOGAN HEALTH CENTER - IDOTS,PUBLIC HEALTH CENTER,P,NEW,CLINICTBALLY-DIAGNOSED ,9-Jan-26,ON TREATMENT,9-Jan-26,2/1/2026 18:12',
    ].join('\n');

    const buffer = Buffer.from(csvContent, 'utf8');
    const result = parseCaseFile(buffer, 'test.csv', validBarangays);

    assert.equal(result.rows[0].sex, 'Female');
  });

  it('parses DD-Mon-YY dates from real CSV', () => {
    const csvContent = [
      'No.,Validation Status,Date of Screening,Date of Diagnosis, Date of Notification,Age,Sex,Barangay,City,Screening/Diagnosis Health,FacilityTreatment Health Facility,Source of Patient,Anatomical Site,Registration Group,Bacteriological Status,Date Started Treatment,Outcome/Status,Date of Outcome/Status,Date/Time Record Created',
      '1,Validated,8-Jul-26,8-Jan-26,8-Jan-26,36,M,CANIOGAN,PASIG CITY,CANIOGAN HEALTH CENTER - IDOTS,CANIOGAN HEALTH CENTER - IDOTS,OTHER PUBLIC FACILITY,P,NEW,BACTORIOLOGICALLY-CONFIRMED TB,16-Dec-25,ON TREATMENT,16-Dec-25,2/1/2026 17:59',
    ].join('\n');

    const buffer = Buffer.from(csvContent, 'utf8');
    const result = parseCaseFile(buffer, 'test.csv', validBarangays);

    assert.equal(result.rows[0].date_of_screening, '2026-07-08');
    assert.equal(result.rows[0].date_of_diagnosis, '2026-01-08');
    assert.equal(result.rows[0].date_of_notification, '2026-01-08');
    assert.equal(result.rows[0].date_started_treatment, '2025-12-16');
    assert.equal(result.rows[0].date_of_outcome, '2025-12-16');
  });

  it('handles empty Source of Patient gracefully', () => {
    const csvContent = [
      'No.,Validation Status,Date of Screening,Date of Diagnosis, Date of Notification,Age,Sex,Barangay,City,Screening/Diagnosis Health,FacilityTreatment Health Facility,Source of Patient,Anatomical Site,Registration Group,Bacteriological Status,Date Started Treatment,Outcome/Status,Date of Outcome/Status,Date/Time Record Created',
      '14,Validated,29-Mar-26,5-Feb-26,5-Feb-26,15,M,CANIOGAN,PASIG CITY,CANIOGAN HEALTH CENTER - IDOTS,CANIOGAN HEALTH CENTER - IDOTS,,P,NEW,CLINICTBALLY-DIAGNOSED ,5-Feb-26,ON TREATMENT,5-Feb-26,3/29/2026 9:49',
    ].join('\n');

    const buffer = Buffer.from(csvContent, 'utf8');
    const result = parseCaseFile(buffer, 'test.csv', validBarangays);

    assert.equal(result.totalRows, 1);
    assert.equal(result.validCount, 1);
    assert.equal(result.rows[0].source_of_patient, '');
  });

  it('rejects rows with unknown barangay', () => {
    const csvContent = [
      'Validation Status,Date of Screening,Date of Diagnosis,Date of Notification,Age,Sex,Barangay,City,Screening/Diagnosis Health Facility,Treatment Health Facility,Source of Patient,Anatomical Site,Registration Group,Bacteriological Status,Date Started Treatment,Outcome/Status,Date of Outcome/Status,Date/Time Record Created',
      'Validated,01/01/2024,01/15/2024,01/20/2024,25,Male,Unknown Barangay,Pasig,,,,,,, ,,,,',
    ].join('\n');

    const buffer = Buffer.from(csvContent, 'utf8');
    const result = parseCaseFile(buffer, 'test.csv', validBarangays);

    assert.equal(result.totalRows, 1);
    assert.equal(result.validCount, 0);
    assert.equal(result.errorCount, 1);
    assert.ok(result.errors[0].errors.some(e => e.includes('Unknown barangay')));
  });

  it('handles empty file gracefully', () => {
    const csvContent = 'Validation Status,Date of Screening,Date of Diagnosis\n';
    const buffer = Buffer.from(csvContent, 'utf8');
    const result = parseCaseFile(buffer, 'test.csv', validBarangays);

    assert.equal(result.totalRows, 0);
    assert.equal(result.validCount, 0);
    assert.equal(result.errorCount, 0);
  });

  it('parses multiple rows from real CSV', () => {
    const csvContent = [
      'No.,Validation Status,Date of Screening,Date of Diagnosis, Date of Notification,Age,Sex,Barangay,City,Screening/Diagnosis Health,FacilityTreatment Health Facility,Source of Patient,Anatomical Site,Registration Group,Bacteriological Status,Date Started Treatment,Outcome/Status,Date of Outcome/Status,Date/Time Record Created',
      '1,Validated,8-Jul-26,8-Jan-26,8-Jan-26,36,M,CANIOGAN,PASIG CITY,CANIOGAN HEALTH CENTER - IDOTS,CANIOGAN HEALTH CENTER - IDOTS,OTHER PUBLIC FACILITY,P,NEW,BACTORIOLOGICALLY-CONFIRMED TB,16-Dec-25,ON TREATMENT,16-Dec-25,2/1/2026 17:59',
      '2,Validated,9-Jan-26,9-Jan-26,9-Jan-26,70,F,CANIOGAN,PASIG CITY,CANIOGAN HEALTH CENTER - IDOTS,CANIOGAN HEALTH CENTER - IDOTS,PUBLIC HEALTH CENTER,P,NEW,CLINICTBALLY-DIAGNOSED ,9-Jan-26,ON TREATMENT,9-Jan-26,2/1/2026 18:12',
      '3,Validated,8-Jan-26,9-Jan-26,9-Jan-26,64,F,CANIOGAN,PASIG CITY,CANIOGAN HEALTH CENTER - IDOTS,CANIOGAN HEALTH CENTER - IDOTS,PUBLIC HEALTH CENTER,P,RELAPSE,BACTORIOLOGICALLY-CONFIRMED TB,9-Jan-26,ON TREATMENT,9-Jan-26,2/1/2026 18:22',
    ].join('\n');

    const buffer = Buffer.from(csvContent, 'utf8');
    const result = parseCaseFile(buffer, 'test.csv', validBarangays);

    assert.equal(result.totalRows, 3);
    assert.equal(result.validCount, 3);
    assert.equal(result.errorCount, 0);
    assert.equal(result.rows[0].sex, 'Male');
    assert.equal(result.rows[1].sex, 'Female');
    assert.equal(result.rows[2].sex, 'Female');
    assert.equal(result.rows[2].registration_group, 'RELAPSE');
  });
});
