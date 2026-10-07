/**
 * Historical DSTB / MN import rules (services/validator.js, services/patientIdentity.js):
 *   - DSTB and MN: patient name and date of birth NOT required; Diagnosis Date, Sex and
 *     Age required; a missing / unknown Pasig barangay is kept for Needs Assignment
 *   - DSTB and MN validation are separate functions on a shared core; manual entry
 *     still requires name + date of birth
 *   - MN: the registry's ITIS Lite Case No. is ignored (not stored, not a matching key)
 *   - DSTB: never matched on barangay + date + sex + age; keeps source file/row
 *     traceability (source_record_id)
 *   - the Case ID is never generated: it comes from the file's "Case ID" column, and a row
 *     without one is a data issue (services/caseIds.js, services/validator.js)
 * Uses an in-memory stand-in for the database (nothing real is touched).
 * Run: node --test test/historicalImportRules.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

// ---- minimal database stand-in for validateBatch ----
const BATCH = '11111111-2222-3333-4444-555555555555';
const OLD_BATCH = '99999999-8888-7777-6666-555555555555'; // uploaded before Case IDs were required
let RAW = [];
let EXISTING = [];
let inserted = [];
let issues = [];
let seq = 0;
const INSERT_COLS = () => require('../services/validator').INSERT_COLUMNS;
async function q(sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (s.startsWith('SELECT identity_class, case_id_required FROM import_batches')) {
    return { rows: [{ identity_class: 'historical', case_id_required: params[0] !== OLD_BATCH }] };
  }
  if (s.startsWith('SELECT sync_status FROM import_batches')) return { rows: [{ sync_status: 'pending' }] };
  if (s.includes('COUNT(*)::int AS n')) return { rows: [{ n: 0 }] };
  if (s.startsWith('SELECT id, case_no, date_of_diagnosis::text')) return { rows: EXISTING };
  if (s.startsWith("SELECT nextval('patient_no_seq')") || s.startsWith("SELECT nextval('case_no_seq')")) {
    return { rows: Array.from({ length: params[0] }, () => ({ n: ++seq })) };
  }
  if (s.startsWith('INSERT INTO patients')) {
    return { rows: params.slice(0, -1).map((no, i) => ({ id: 1000 + seq + i, patient_no: no })) };
  }
  if (s.startsWith('INSERT INTO validation_issues')) { issues.push(...JSON.parse(params[1])); return { rows: [] }; }
  if (s.startsWith('INSERT INTO validated_tb_cases')) {
    const cols = INSERT_COLS();
    const rows = [];
    for (let i = 0; i < params.length; i += cols.length) {
      inserted.push(Object.fromEntries(cols.map((c, k) => [c, params[i + k]])));
      rows.push({ id: 9000 + inserted.length });
    }
    return { rows };
  }
  return { rows: [] };
}
stub('../db/pasigSchema', {
  pool: { query: q, connect: async () => ({ query: q, release() {} }) },
  getRawCases: async () => ({ rows: RAW }),
});

const { validateRecord, validateDSTB, validateMN, validateManual, sourceRefs, validateBatch, getValidBarangays } = require('../services/validator');
const { planIdentities } = require('../services/patientIdentity');
const { cleanRecord } = require('../services/dataCleaner');

const deid = { barangay_name: 'Rosario', city: 'Pasig City', date_of_diagnosis: '2023-03-04', sex: 'Male', age: 41, source_case_id: 'ROS-D-2023-00042' };
let BGY;
beforeEach(async () => { BGY = await getValidBarangays(); });

describe('DSTB / MN: de-identified historical rows', () => {
  it('DSTB without name or date of birth is accepted (the Case ID still comes from the file)', () => {
    const r = validateRecord(deid, 'DSTB', BGY);
    assert.strictEqual(r.valid, true, JSON.stringify(r.errors));
    assert.deepStrictEqual(r.errors, []);
  });

  it('MN without name is accepted; ITIS present = no ITIS warning', () => {
    const r = validateRecord({ ...deid, itis_case_id: 'PSG-2023-0001' }, 'MN', BGY);
    assert.strictEqual(r.valid, true);
    assert.ok(!r.warnings.some(w => w.includes('ITIS')));
  });

  it('MN without ITIS Lite Case No. is accepted (ITIS is no longer needed)', () => {
    const r = validateRecord(deid, 'MN', BGY);
    assert.strictEqual(r.valid, true);
    assert.ok(!r.warnings.some(w => w.includes('ITIS')));
  });

  for (const type of ['DSTB', 'MN']) {
    it(`${type}: Diagnosis Date, Sex and Age are required`, () => {
      assert.ok(validateRecord({ ...deid, date_of_diagnosis: null }, type, BGY).errors.includes('Date of Diagnosis is required'));
      assert.ok(validateRecord({ ...deid, sex: '' }, type, BGY).errors.includes('Sex is required'));
      assert.ok(validateRecord({ ...deid, age: null }, type, BGY).errors.includes('Age is required'));
      assert.ok(validateRecord({ ...deid, age: '' }, type, BGY).errors.includes('Age is required'));
    });

    it(`${type}: missing or unknown Pasig barangay goes to Needs Assignment, not rejected`, () => {
      const none = validateRecord({ ...deid, barangay_name: '' }, type, BGY);
      assert.strictEqual(none.valid, true);
      assert.ok(none.warnings.some(w => w.includes('Needs Assignment')));
      const unknown = validateRecord({ ...deid, barangay_name: 'Nowhere' }, type, BGY);
      assert.strictEqual(unknown.valid, true);
      assert.ok(unknown.warnings.some(w => w.includes('Needs Assignment')));
    });
  }

  it('Age can come from the date of birth when the file has no Age column', () => {
    const { record } = cleanRecord({ ...deid, age: undefined, date_of_birth: '1980-01-15' });
    assert.strictEqual(record.age, 43);
    assert.strictEqual(validateRecord(record, 'DSTB', BGY).valid, true);
  });

  it('a partial name is only a warning (not used for matching)', () => {
    const r = validateRecord({ ...deid, last_name: 'Cruz' }, 'DSTB', BGY);
    assert.strictEqual(r.valid, true);
    assert.ok(r.warnings.some(w => w.includes('Incomplete patient name')));
  });

  it('a date of birth after diagnosis is still an error when given', () => {
    assert.strictEqual(validateRecord({ ...deid, date_of_birth: '2024-01-01' }, 'MN', BGY).valid, false);
  });
});

describe('separate validators', () => {
  it('DSTB-only and MN-only checks stay on their own sheet', () => {
    assert.ok(validateDSTB({ ...deid, validation_status: 'odd' }, BGY).warnings.some(w => w.includes('validation status')));
    assert.ok(!validateMN({ ...deid, validation_status: 'odd', itis_case_id: 'X1' }, BGY).warnings.some(w => w.includes('validation status')));
    assert.ok(!validateDSTB(deid, BGY).warnings.some(w => w.includes('ITIS')), 'DSTB never asks for an ITIS no.');
  });

  it('manual entry still requires name and date of birth', () => {
    const r = validateManual(deid, BGY);
    for (const msg of ['Last name is required', 'First name is required', 'Date of birth is required']) {
      assert.ok(r.errors.includes(msg), msg);
    }
    assert.strictEqual(validateRecord(deid, 'MANUAL', BGY).valid, false);
  });

  it('editing an older record saved without Age only warns', () => {
    const r = validateRecord({ ...deid, age: null }, 'DSTB', BGY, { legacyMissingAge: true });
    assert.strictEqual(r.valid, true);
    assert.ok(r.warnings.includes('Age is missing'));
  });
});

describe('source traceability', () => {
  it('DSTB: file row reference, no source Case ID', () => {
    const r = sourceRefs({ batchId: BATCH, sheetName: 'DSTB', sourceType: 'DSTB', rowNumber: 7, itisCaseId: 'IGNORED' });
    assert.strictEqual(r.source_record_id, `${BATCH}:DSTB:R7`);
    assert.strictEqual(r.source_case_id, null);
  });

  it('the Case ID from the file becomes source_case_id (DSTB and MN, normalized); ITIS is not used', () => {
    assert.strictEqual(sourceRefs({ batchId: BATCH, sheetName: 'MN', sourceType: 'MN', rowNumber: 3, fileCaseId: ' tmcp-m-2025-00113 ' }).source_case_id, 'TMCP-M-2025-00113');
    assert.strictEqual(sourceRefs({ batchId: BATCH, sheetName: 'DSTB', sourceType: 'DSTB', rowNumber: 3, fileCaseId: 'ROS-D-2025-00042' }).source_case_id, 'ROS-D-2025-00042');
    assert.strictEqual(sourceRefs({ batchId: BATCH, sheetName: 'MN', sourceType: 'MN', rowNumber: 3, fileCaseId: ' ', itisCaseId: 'PSG-01' }).source_case_id, null);
  });
});

describe('matching', () => {
  it('DSTB rows are never matched on barangay + date + sex + age', () => {
    const rows = [
      { ...deid, source_type: 'DSTB', source_case_id: 'ROS-D-2023-00042' },
      { ...deid, source_type: 'DSTB', source_case_id: 'ROS-D-2023-00043' },
    ];
    const plan = planIdentities(rows, [{ case_no: 'CS-2023-000001', ...deid, source_type: 'DSTB', source_case_id: 'ROS-D-2023-00099' }]);
    assert.deepStrictEqual(plan.map(p => p.kind), ['new', 'new']);
  });

  it('the same Case ID as an existing case is a possible match (never merged)', () => {
    for (const type of ['DSTB', 'MN']) {
      const id = type === 'DSTB' ? 'ROS-D-2023-00007' : 'TMCP-M-2023-00007';
      const plan = planIdentities([{ ...deid, source_type: type, source_case_id: id }],
        [{ case_no: 'CS-2023-000001', date_of_diagnosis: '2023-03-04', source_type: type, source_case_id: id }]);
      assert.strictEqual(plan[0].kind, 'pending', type);
      assert.strictEqual(plan[0].candidate.case_no, 'CS-2023-000001');
    }
  });

  it('an ITIS no. is not a matching key (MN or DSTB)', () => {
    for (const source_type of ['MN', 'DSTB']) {
      const plan = planIdentities(
        [{ ...deid, source_type, itis_case_id: 'psg-0001 ' }],
        [{ case_no: 'CS-2023-000009', date_of_diagnosis: '2023-03-04', source_type: 'MN', itis_case_id: 'PSG-0001' }]
      );
      assert.strictEqual(plan[0].kind, 'new', source_type);
    }
  });

  it('MN: the same ITIS no. twice in one file is caught; different numbers are not', () => {
    const plan = planIdentities([
      { ...deid, source_type: 'MN', source_case_id: 'A-1' },
      { ...deid, source_type: 'MN', source_case_id: 'A-1' },
      { ...deid, source_type: 'MN', source_case_id: 'A-2' },
    ], []);
    assert.deepStrictEqual(plan.map(p => p.kind), ['new', 'pending', 'new']);
    assert.deepStrictEqual(plan[1].candidate, { rowIndex: 0 });
  });

});

describe('validateBatch end to end (de-identified DSTB + MN file)', () => {
  beforeEach(() => { inserted = []; issues = []; seq = 0; EXISTING = []; });

  it('imports de-identified rows with the Case IDs the file carried and full traceability; only a row missing Age becomes a data issue', async () => {
    RAW = [
      { id: 1, sheet_name: 'DSTB', source_type: 'DSTB', row_number: 7, csv_data: { file_case_id: 'ROS-D-2023-00042', barangay_name: 'ROSARIO', date_of_diagnosis: '2023-03-04', sex: 'M', age: 41 } },
      { id: 2, sheet_name: 'DSTB', source_type: 'DSTB', row_number: 8, csv_data: { file_case_id: 'ROS-D-2023-00043', barangay_name: 'ROSARIO', date_of_diagnosis: '2023-03-04', sex: 'M', age: 41 } },
      { id: 3, sheet_name: 'MN', source_type: 'MN', row_number: 5, csv_data: { file_case_id: 'TMCP-M-2023-00113', barangay_name: 'Ugong', date_of_diagnosis: '2023-05-01', sex: 'F', age: 30, itis_case_id: 'PSG-77' } },
      { id: 4, sheet_name: 'MN', source_type: 'MN', row_number: 6, csv_data: { file_case_id: 'PND-M-2023-00001', barangay_name: '', date_of_diagnosis: '2023-05-02', sex: 'F', age: 22 } },
      { id: 5, sheet_name: 'MN', source_type: 'MN', row_number: 9, csv_data: { file_case_id: 'PND-M-2023-00002', barangay_name: 'Ugong', date_of_diagnosis: '2023-05-03', sex: 'F' } },
    ];
    const res = await validateBatch(BATCH);
    assert.strictEqual(res.valid, 4);
    assert.strictEqual(res.invalid, 1, 'only the row without Age is a data issue');
    assert.deepStrictEqual(issues.map(i => [i.row_number, i.errors]), [[9, ['Age is required']]]);
    assert.strictEqual(issues[0].record.source_record_id, `${BATCH}:MN:R9`, 'data issues keep their file row too');

    const byRow = Object.fromEntries(inserted.map(r => [r.source_record_id, r]));
    const dstb7 = byRow[`${BATCH}:DSTB:R7`];
    const dstb8 = byRow[`${BATCH}:DSTB:R8`];
    assert.ok(/^CS-2023-\d{6}$/.test(dstb7.case_no), 'the internal case number is still generated');
    assert.notStrictEqual(dstb7.case_no, dstb8.case_no, 'identical DSTB attributes are two separate cases');
    assert.strictEqual(dstb8.match_status, 'none', 'no attribute matching for DSTB');
    assert.strictEqual(dstb7.source_case_id, 'ROS-D-2023-00042', 'Case ID comes from the file, unchanged');
    assert.strictEqual(dstb8.source_case_id, 'ROS-D-2023-00043');
    assert.strictEqual(dstb7.last_name, null);

    const mn5 = byRow[`${BATCH}:MN:R5`];
    assert.strictEqual(mn5.source_case_id, 'TMCP-M-2023-00113', 'Case ID from the file, not generated');
    assert.strictEqual(mn5.itis_case_id, undefined, 'the ITIS no. is not stored');
    const mn6 = byRow[`${BATCH}:MN:R6`];
    assert.ok(mn6, 'missing barangay is kept (Needs Assignment)');
    assert.strictEqual(mn6.barangay_name, null);
    assert.strictEqual(mn6.source_case_id, 'PND-M-2023-00001');
  });

  it('a row without a Case ID becomes a data issue — the system never invents one', async () => {
    RAW = [{ id: 1, sheet_name: 'DSTB', source_type: 'DSTB', row_number: 3, csv_data: { barangay_name: 'ROSARIO', date_of_diagnosis: '2023-03-04', sex: 'M', age: 41 } }];
    const res = await validateBatch(BATCH);
    assert.strictEqual(res.valid, 0);
    assert.strictEqual(res.invalid, 1);
    assert.deepStrictEqual(issues.map(i => i.errors), [[`Case ID is required — it comes from the file's "Case ID" column`]]);
    assert.strictEqual(inserted.length, 0, 'an invalid row is never written');
  });

  it('a malformed Case ID is an error even when everything else is clean', async () => {
    RAW = [{ id: 1, sheet_name: 'DSTB', source_type: 'DSTB', row_number: 4, csv_data: { file_case_id: '1180031', barangay_name: 'ROSARIO', date_of_diagnosis: '2023-03-04', sex: 'M', age: 41 } }];
    const res = await validateBatch(BATCH);
    assert.strictEqual(res.invalid, 1);
    assert.ok(issues[0].errors[0].startsWith('Case ID must look like ROS-D-2025-00042'), issues[0].errors[0]);
  });

  it('a batch uploaded before Case IDs were required still validates without one (migration 018)', async () => {
    RAW = [{ id: 1, sheet_name: 'DSTB', source_type: 'DSTB', row_number: 3, csv_data: { barangay_name: 'ROSARIO', date_of_diagnosis: '2023-03-04', sex: 'M', age: 41 } }];
    const res = await validateBatch(OLD_BATCH);
    assert.strictEqual(res.valid, 1, JSON.stringify(res.errors));
    assert.strictEqual(inserted[0].source_case_id, null, 'no Case ID is invented for an old batch');
    assert.ok(/^CS-2023-\d{6}$/.test(inserted[0].case_no));
  });

  it('an MN row whose ITIS no. matches an existing case is NOT held as a match', async () => {
    EXISTING = [{ case_no: 'CS-2022-000100', date_of_diagnosis: '2022-11-01', source_type: 'MN', itis_case_id: 'PSG-77', source_case_id: null }];
    RAW = [{ id: 1, sheet_name: 'MN', source_type: 'MN', row_number: 5, csv_data: { file_case_id: 'TMCP-M-2023-00005', barangay_name: 'Ugong', date_of_diagnosis: '2023-05-01', sex: 'F', age: 30, itis_case_id: 'PSG-77' } }];
    const res = await validateBatch(BATCH);
    assert.strictEqual(res.possibleMatches, 0);
    assert.strictEqual(inserted[0].match_status, 'none');
  });
});
