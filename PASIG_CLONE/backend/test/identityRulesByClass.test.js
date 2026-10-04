/**
 * Regression: name / date-of-birth rules follow the record's identity class.
 *   historical DSTB/MN  -> accepted without First Name, Last Name or DOB; when the file
 *                          carries them they are kept and validated (DOB only if given)
 *   operational DSTB/MN -> identifiable: name + DOB required (support not removed)
 *   manual entry        -> always required
 *   Age, Sex, Diagnosis Date unchanged; unresolved barangay -> Needs Assignment
 * Stale stored errors: Data Issues shows errors under the CURRENT rules, issues of
 * deleted batches are never listed or counted, and a startup refresh rewrites stale text.
 * In-memory database stand-in — nothing real is touched.
 * Run: node --test test/identityRulesByClass.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

const SECRET = 'test-identity-rules';
const BATCH = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
let batchClass = 'historical';
let RAW = []; let inserted = []; let issuesInserted = []; let seq = 0;
let ISSUES = []; let updates = []; let listSql = '';

async function q(sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (s.startsWith('SELECT identity_class FROM import_batches')) return { rows: [{ identity_class: batchClass }] };
  if (s.startsWith('SELECT sync_status FROM import_batches')) return { rows: [{ sync_status: 'pending' }] };
  if (s.startsWith('SELECT case_no, date_of_diagnosis::text')) return { rows: [] };
  if (s.includes("nextval('patient_no_seq')") || s.includes("nextval('case_no_seq')")) {
    return { rows: Array.from({ length: params[0] }, () => ({ n: ++seq })) };
  }
  if (s.startsWith('INSERT INTO patients')) return { rows: params.slice(0, -1).map((no, i) => ({ id: 500 + seq + i, patient_no: no })) };
  if (s.startsWith('INSERT INTO validation_issues')) { issuesInserted.push(...JSON.parse(params[1])); return { rows: [] }; }
  if (s.startsWith('INSERT INTO validated_tb_cases')) {
    const cols = require('../services/validator').INSERT_COLUMNS;
    for (let i = 0; i < params.length; i += cols.length) inserted.push(Object.fromEntries(cols.map((c, k) => [c, params[i + k]])));
    return { rows: [] };
  }
  // Data Issues list / refresh
  if (s.startsWith('SELECT i.id, i.source_type, i.record, i.errors, i.identity_class FROM validation_issues i')) {
    return { rows: ISSUES.filter(x => x.status === 'open' && !x.orphan) };
  }
  if (s.startsWith('UPDATE validation_issues SET errors')) { updates.push({ id: params[0], errors: JSON.parse(params[1]) }); return { rows: [] }; }
  if (s.startsWith('SELECT COUNT(*)::int AS n FROM validation_issues i')) {
    listSql = s;
    return { rows: [{ n: ISSUES.filter(x => x.status === 'open' && !x.orphan).length }] };
  }
  if (s.startsWith('SELECT i.id, i.batch_id, i.row_number')) {
    listSql = s;
    return { rows: ISSUES.filter(x => x.status === 'open' && !(s.includes('EXISTS (SELECT 1 FROM import_batches') && x.orphan)) };
  }
  if (s.includes('COUNT(*)::int AS n')) return { rows: [{ n: 0 }] };
  return { rows: [] };
}
stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {}, patientNames: { enabled: false } });
stub('../db/pasigSchema', {
  pool: { query: q, connect: async () => ({ query: q, release() {} }) },
  authPool: { query: async () => ({ rows: [] }) },
  getRawCases: async () => ({ rows: RAW }),
});
stub('../utils/auditLogger', { logAuditEvent: async () => {} });

const {
  validateRecord, validateManual, identityRuleFor, currentIssueErrors, refreshOpenIssueErrors,
  validateBatch, getValidBarangays,
} = require('../services/validator');

const deid = { barangay_name: 'Rosario', city: 'Pasig City', date_of_diagnosis: '2025-03-04', sex: 'Male', age: 41 };
const person = { last_name: 'DELA CRUZ', first_name: 'JUAN', date_of_birth: '1984-01-15' };
const NAME_ERRORS = ['Last name is required', 'First name is required', 'Date of birth is required'];
let BGY;
before(async () => { BGY = await getValidBarangays(); });

describe('rules by identity class', () => {
  for (const type of ['DSTB', 'MN']) {
    it(`historical ${type}: accepted without First Name, Last Name or DOB`, () => {
      const r = validateRecord(deid, type, BGY, identityRuleFor('historical'));
      assert.strictEqual(r.valid, true, JSON.stringify(r.errors));
      assert.ok(!r.errors.some(e => /name|birth/i.test(e)));
    });

    it(`historical ${type}: name + DOB present are kept valid, DOB still checked when given`, () => {
      assert.strictEqual(validateRecord({ ...deid, ...person }, type, BGY, identityRuleFor('historical')).valid, true);
      const late = validateRecord({ ...deid, ...person, date_of_birth: '2025-06-01' }, type, BGY, identityRuleFor('historical'));
      assert.ok(late.errors.includes('Date of birth cannot be after the date of diagnosis'));
    });

    it(`operational ${type}: identifiable — name + DOB required`, () => {
      const r = validateRecord(deid, type, BGY, identityRuleFor('operational'));
      assert.strictEqual(r.valid, false);
      for (const m of NAME_ERRORS) assert.ok(r.errors.includes(m), m);
      assert.strictEqual(validateRecord({ ...deid, ...person }, type, BGY, identityRuleFor('operational')).valid, true);
    });

    it(`${type}: Age, Sex and Diagnosis Date stay required for both classes`, () => {
      for (const cls of ['historical', 'operational']) {
        const base = { ...deid, ...person };
        assert.ok(validateRecord({ ...base, age: null }, type, BGY, identityRuleFor(cls)).errors.includes('Age is required'));
        assert.ok(validateRecord({ ...base, sex: '' }, type, BGY, identityRuleFor(cls)).errors.includes('Sex is required'));
        assert.ok(validateRecord({ ...base, date_of_diagnosis: null }, type, BGY, identityRuleFor(cls)).errors.includes('Date of Diagnosis is required'));
        const noBgy = validateRecord({ ...base, barangay_name: '' }, type, BGY, identityRuleFor(cls));
        assert.strictEqual(noBgy.valid, true, 'unresolved barangay is not a rejection');
        assert.ok(noBgy.warnings.some(w => w.includes('Needs Assignment')));
      }
    });
  }

  it('a missing class counts as historical (fail closed)', () => {
    assert.deepStrictEqual(identityRuleFor(undefined), { requireIdentity: false });
    assert.deepStrictEqual(identityRuleFor('operational'), { requireIdentity: true });
  });

  it('manual entry always requires name + DOB, even if a caller passes requireIdentity: false', () => {
    const r = validateManual(deid, BGY, { requireIdentity: false });
    for (const m of NAME_ERRORS) assert.ok(r.errors.includes(m), m);
    assert.strictEqual(validateRecord(deid, 'MANUAL', BGY, identityRuleFor('historical')).valid, false);
  });
});

describe('import + data-issue generation + revalidation follow the batch class', () => {
  beforeEach(() => { inserted = []; issuesInserted = []; seq = 0; });
  const rows = () => [
    { id: 1, sheet_name: 'DSTB', source_type: 'DSTB', row_number: 7, csv_data: { ...deid } },
    { id: 2, sheet_name: 'DSTB', source_type: 'DSTB', row_number: 8, csv_data: { ...deid, ...person } },
    { id: 3, sheet_name: 'MN', source_type: 'MN', row_number: 2, csv_data: { ...deid, itis_case_id: 'PSG-1' } },
    { id: 4, sheet_name: 'DSTB', source_type: 'DSTB', row_number: 9, csv_data: { ...deid, ...person, date_of_birth: '2026-01-01' } },
  ];

  it('historical batch: de-identified rows become cases; names kept when present; DOB error only where DOB given', async () => {
    batchClass = 'historical';
    RAW = rows();
    const res = await validateBatch(BATCH);
    assert.strictEqual(res.valid, 3);
    assert.deepStrictEqual(issuesInserted.map(i => [i.row_number, i.errors]), [[9, ['Date of birth cannot be after the date of diagnosis']]]);
    const r8 = inserted.find(c => c.source_record_id === `${BATCH}:DSTB:R8`);
    assert.strictEqual(r8.last_name, 'DELA CRUZ', 'names in the file are preserved');
    assert.strictEqual(r8.date_of_birth, '1984-01-15');
    assert.strictEqual(inserted.find(c => c.source_record_id === `${BATCH}:DSTB:R7`).last_name, null);
  });

  it('operational batch: rows without name / DOB become data issues (identifiable support kept)', async () => {
    batchClass = 'operational';
    RAW = rows();
    const res = await validateBatch(BATCH);
    assert.strictEqual(res.valid, 1, 'only the complete identifiable row is valid');
    const byRow = Object.fromEntries(issuesInserted.map(i => [i.row_number, i.errors]));
    for (const m of NAME_ERRORS) assert.ok(byRow[7].includes(m) && byRow[2].includes(m), m);
    batchClass = 'historical';
  });

  it('revalidating a historical batch gives the same result (no name errors reappear)', async () => {
    batchClass = 'historical';
    RAW = rows();
    await validateBatch(BATCH);
    const first = issuesInserted.map(i => i.errors);
    issuesInserted = []; inserted = [];
    await validateBatch(BATCH);
    assert.deepStrictEqual(issuesInserted.map(i => i.errors), first);
  });
});

describe('stale stored validation errors', () => {
  beforeEach(() => {
    updates = [];
    ISSUES = [
      { id: 1, batch_id: BATCH, status: 'open', source_type: 'DSTB', identity_class: 'historical', record: { ...deid }, errors: ['First name is required'] },
      { id: 2, batch_id: BATCH, status: 'open', source_type: 'MN', identity_class: 'historical', record: { ...deid, age: null }, errors: ['Date of birth is required'] },
      { id: 3, batch_id: BATCH, status: 'open', source_type: 'DSTB', identity_class: 'operational', record: { ...deid }, errors: NAME_ERRORS },
      { id: 4, batch_id: 'deleted-batch', status: 'open', orphan: true, source_type: 'DSTB', identity_class: 'historical', record: { ...deid }, errors: ['First name is required'] },
    ];
  });

  it('current errors drop old name/DOB messages for historical rows only', () => {
    assert.deepStrictEqual(currentIssueErrors(ISSUES[0], BGY), []);
    assert.deepStrictEqual(currentIssueErrors(ISSUES[1], BGY), ['Age is required'], 'real problems stay');
    assert.deepStrictEqual(currentIssueErrors(ISSUES[2], BGY), NAME_ERRORS, 'operational keeps name rules');
  });

  it('startup refresh rewrites only stale stored errors and skips deleted batches', async () => {
    const r = await refreshOpenIssueErrors();
    assert.deepStrictEqual(r, { checked: 3, updated: 2 });
    assert.deepStrictEqual(updates, [{ id: 1, errors: [] }, { id: 2, errors: ['Age is required'] }]);
  });

  describe('Data Issues list', () => {
    let server; let url;
    before(async () => {
      const app = express();
      app.use(express.json());
      app.use('/api/data/validation-queue', require('../routes/validationQueue'));
      await new Promise(res => { server = app.listen(0, res); });
      url = `http://127.0.0.1:${server.address().port}/api/data/validation-queue/issues`;
    });
    after(() => server.close());

    it('shows current errors, flags rows with nothing left, and hides issues of deleted batches', async () => {
      const token = jwt.sign({ id: 1, username: 'admin1', role: 'admin' }, SECRET);
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(listSql.includes('EXISTS (SELECT 1 FROM import_batches'), 'orphans excluded in SQL');
      const byId = Object.fromEntries(body.issues.map(i => [i.id, i]));
      assert.ok(!byId[4], 'issue of a deleted batch is not listed');
      assert.deepStrictEqual(byId[1].errors, []);
      assert.strictEqual(byId[1].no_remaining_errors, true);
      assert.deepStrictEqual(byId[2].errors, ['Age is required']);
      assert.deepStrictEqual(byId[3].errors, NAME_ERRORS);
      assert.ok(!JSON.stringify(body.issues.filter(i => i.identity_class === 'historical').map(i => i.errors)).match(/name|birth/i));
    });
  });
});
