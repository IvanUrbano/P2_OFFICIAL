const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDate,
  normalizeSex,
  detectSheetType,
  buildColumnMap,
} = require('../services/multiSheetParser');
const { validateRecord, getValidBarangays } = require('../services/validator');

// ==================== parseDate ====================
describe('parseDate', () => {
  it('returns null for empty input', () => {
    assert.equal(parseDate(null), null);
    assert.equal(parseDate(''), null);
    assert.equal(parseDate(undefined), null);
  });

  it('parses ISO format YYYY-MM-DD', () => {
    assert.equal(parseDate('2025-02-06'), '2025-02-06');
    assert.equal(parseDate('2025-12-31'), '2025-12-31');
  });

  it('parses written month format "February 06, 2025"', () => {
    assert.equal(parseDate('February 06, 2025'), '2025-02-06');
  });

  it('parses written month format "January 14, 2025"', () => {
    assert.equal(parseDate('January 14, 2025'), '2025-01-14');
  });

  it('parses Date objects', () => {
    const d = new Date('2025-01-14T00:00:00Z');
    assert.equal(parseDate(d), '2025-01-14');
  });

  it('returns null for invalid Date objects', () => {
    assert.equal(parseDate(new Date('invalid')), null);
  });

  it('parses US format MM/DD/YYYY', () => {
    // US format parsing uses new Date() which is timezone-sensitive;
    // verify it returns a valid date string rather than exact value
    const result = parseDate('01/15/2025');
    assert.ok(result, 'should parse US format date');
    assert.ok(result.startsWith('2025-01-'), `expected Jan 2025, got ${result}`);
  });

  it('returns null for unparseable strings', () => {
    assert.equal(parseDate('not-a-date'), null);
  });
});

// ==================== normalizeSex ====================
describe('normalizeSex', () => {
  it('returns null for empty input', () => {
    assert.equal(normalizeSex(null), null);
    assert.equal(normalizeSex(''), null);
  });

  it('normalizes M to Male', () => {
    assert.equal(normalizeSex('M'), 'Male');
    assert.equal(normalizeSex('m'), 'Male');
  });

  it('normalizes F to Female', () => {
    assert.equal(normalizeSex('F'), 'Female');
    assert.equal(normalizeSex('f'), 'Female');
  });

  it('normalizes male to Male', () => {
    assert.equal(normalizeSex('male'), 'Male');
    assert.equal(normalizeSex('Male'), 'Male');
  });

  it('normalizes female to Female', () => {
    assert.equal(normalizeSex('female'), 'Female');
    assert.equal(normalizeSex('Female'), 'Female');
  });

  it('returns null for unrecognized values', () => {
    assert.equal(normalizeSex('X'), null);
    assert.equal(normalizeSex('other'), null);
  });
});

// ==================== detectSheetType ====================
describe('detectSheetType', () => {
  it('detects DSTB sheets', () => {
    assert.equal(detectSheetType('DSTB'), 'DSTB');
    assert.equal(detectSheetType('dstb'), 'DSTB');
    assert.equal(detectSheetType('B-MODE'), 'DSTB');
  });

  it('detects MN sheets', () => {
    assert.equal(detectSheetType('MN'), 'MN');
    assert.equal(detectSheetType('mn'), 'MN');
    assert.equal(detectSheetType('M-N'), 'MN');
    assert.equal(detectSheetType('MICROSCOPIC'), 'MN');
  });

  it('returns null for unknown sheets', () => {
    assert.equal(detectSheetType('Sheet1'), null);
    assert.equal(detectSheetType('Data'), null);
    assert.equal(detectSheetType('MAIN DATA'), null);
  });
});

// ==================== buildColumnMap ====================
describe('buildColumnMap', () => {
  it('maps common headers for DSTB', () => {
    const headers = ['No.', 'Date of Diagnosis', 'Barangay', 'Sex', 'Age'];
    const map = buildColumnMap(headers, 'DSTB');
    assert.equal(map[1], 'date_of_diagnosis');
    assert.equal(map[2], 'barangay_name');
    assert.equal(map[3], 'sex');
    assert.equal(map[4], 'age');
  });

  it('skips No. column', () => {
    const headers = ['No.', 'Sex'];
    const map = buildColumnMap(headers, 'DSTB');
    assert.equal(map[0], undefined);
    assert.equal(map[1], 'sex');
  });

  it('maps validation_status for DSTB', () => {
    const headers = ['Validation Status'];
    const map = buildColumnMap(headers, 'DSTB');
    assert.equal(map[0], 'validation_status');
  });

  it('does not map validation_status for MN', () => {
    const headers = ['Validation Status'];
    const map = buildColumnMap(headers, 'MN');
    assert.equal(map[0], undefined);
  });

  it('ignores the ITIS Lite Case No. column for MN', () => {
    const headers = ['ITIS Lite Case No.'];
    const map = buildColumnMap(headers, 'MN');
    assert.equal(map[0], undefined);
  });
});

// ==================== validateRecord ====================
describe('validateRecord', () => {
  const validBarangays = new Set([
    'san antonio', 'bambang', 'pinagbuhatan', 'dela paz',
    'bagong ilog', 'buting', 'caniogan', 'kalawaan', 'kapasigan',
    'kapitolyo', 'malinao', 'manggahan', 'maybunga', 'oranbo',
    'palatiw', 'pineda', 'rosario', 'sagad', 'san joaquin',
    'san jose', 'san miguel', 'san nicolas', 'santa cruz',
    'santa lucia', 'santa rosa', 'santo tomas', 'santolan',
    'sumilang', 'ugong',
  ]);

  const validRecord = {
    last_name: 'Dela Cruz',
    first_name: 'Juan',
    date_of_birth: '1995-01-10',
    barangay_name: 'San Antonio',
    date_of_diagnosis: '2025-02-06',
    sex: 'Male',
    age: 30,
    city: 'Pasig City',
    source_case_id: 'ROS-D-2025-00042',
  };

  it('passes for a valid record', () => {
    const result = validateRecord(validRecord, 'DSTB', validBarangays);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('keeps a record with no barangay (Needs Assignment) instead of rejecting it', () => {
    const result = validateRecord({ ...validRecord, barangay_name: '' }, 'DSTB', validBarangays);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some(w => w.includes('Needs Assignment')));
  });

  it('keeps a Pasig record with an unknown barangay (Needs Assignment)', () => {
    const result = validateRecord({ ...validRecord, barangay_name: 'Unknown' }, 'DSTB', validBarangays);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some(w => w.includes('Unknown barangay') && w.includes('Needs Assignment')));
  });

  // Imports (DSTB/MN) no longer require them — see test/historicalImportRules.test.js.
  it('manual entry requires last name, first name and date of birth', () => {
    const result = validateRecord(
      { ...validRecord, last_name: '', first_name: ' ', date_of_birth: null }, 'MANUAL', validBarangays
    );
    assert.equal(result.valid, false);
    for (const msg of ['Last name is required', 'First name is required', 'Date of birth is required']) {
      assert.ok(result.errors.includes(msg), msg);
    }
  });

  it('rejects a date of birth after the diagnosis date', () => {
    const result = validateRecord({ ...validRecord, date_of_birth: '2025-03-01' }, 'DSTB', validBarangays);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Date of birth cannot be after')));
  });

  it('requires date_of_diagnosis', () => {
    const result = validateRecord({ ...validRecord, date_of_diagnosis: null }, 'DSTB', validBarangays);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Date of Diagnosis is required')));
  });

  it('requires sex', () => {
    const result = validateRecord({ ...validRecord, sex: '' }, 'DSTB', validBarangays);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Sex is required')));
  });

  it('rejects invalid sex', () => {
    const result = validateRecord({ ...validRecord, sex: 'X' }, 'DSTB', validBarangays);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Invalid sex')));
  });

  it('rejects age out of range', () => {
    const result = validateRecord({ ...validRecord, age: 200 }, 'DSTB', validBarangays);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Invalid age')));
  });

  it('warns about non-Pasig city (still valid)', () => {
    const result = validateRecord({ ...validRecord, city: 'Manila' }, 'DSTB', validBarangays);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some(w => w.includes('Non-Pasig')));
  });

  it('MN no longer needs an ITIS Lite Case No. (Case ID is generated / from the file)', () => {
    const result = validateRecord({ ...validRecord, itis_case_id: '' }, 'MN', validBarangays);
    assert.equal(result.valid, true);
    assert.ok(!result.warnings.some(w => w.includes('ITIS')));
  });
});

// ==================== getValidBarangays ====================
describe('getValidBarangays', () => {
  it('returns a Set with Pasig barangays', async () => {
    const barangays = await getValidBarangays();
    assert.ok(barangays instanceof Set);
    assert.ok(barangays.size >= 28, `Expected at least 28 barangays, got ${barangays.size}`);
  });

  it('includes San Antonio', async () => {
    const barangays = await getValidBarangays();
    assert.ok(barangays.has('san antonio'));
  });

  it('includes Pinagbuhatan', async () => {
    const barangays = await getValidBarangays();
    assert.ok(barangays.has('pinagbuhatan'));
  });
});
