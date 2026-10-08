/**
 * POST /api/data/manual-entry — Add TB Record.
 * The Case ID is typed by the user (never generated), identifies the TB case/episode,
 * and a Case ID that already exists is a duplicate. A returning patient (same name + date
 * of birth) with a NEW Case ID is a new episode.
 * In-memory stand-in for the databases. Run: node --test test/manualEntry.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-manual-entry-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

let store;   // validated_tb_cases rows
let writes;  // every UPDATE / INSERT seen
let seq;

const existing = (over = {}) => ({
  id: 1, case_no: 'CS-2025-000001', patient_id: 1, source_case_id: 'ROS-D-2025-00042',
  last_name: 'Dela Cruz', first_name: 'Juan', date_of_birth: '1990-01-01', date_of_diagnosis: '2025-03-04',
  barangay_name: 'Rosario', is_archived: false, merged_into_case_no: null, ...over,
});

function query(sql, params = []) {
  const q = String(sql).replace(/\s+/g, ' ').trim();
  if (q.includes('FROM validated_tb_cases WHERE upper(source_case_id)')) {
    return { rows: store.filter(c => !c.is_archived && !c.merged_into_case_no && c.source_case_id && c.source_case_id.toUpperCase() === String(params[0]).toUpperCase()) };
  }
  if (q.includes('lower(v.last_name)')) {
    return { rows: store.filter(c => c.case_no && !c.is_archived && c.last_name.toLowerCase() === params[0].toLowerCase()
      && c.first_name.toLowerCase() === params[1].toLowerCase() && c.date_of_birth === params[2]) };
  }
  if (q.startsWith('INSERT INTO import_batches')) return { rows: [{ id: 'batch-1' }] };
  if (q.includes("nextval('patient_no_seq')") || q.includes("nextval('case_no_seq')")) return { rows: [{ n: ++seq }] };
  if (q.startsWith('INSERT INTO patients')) return { rows: [{ id: 50 + seq, patient_no: params[0] }] };
  if (q.startsWith('INSERT INTO validated_tb_cases')) {
    const row = {
      id: 100 + store.length, batch_id: params[0], date_of_diagnosis: params[2], patient_id: params[28],
      case_no: params[29], match_status: params[30], match_candidate_case_no: params[31], source_case_id: params[32],
      last_name: params[23], first_name: params[24], date_of_birth: params[27], is_archived: false, merged_into_case_no: null,
    };
    writes.push({ q, params });
    store.push(row);
    return { rows: [row] };
  }
  if (q.startsWith('SELECT * FROM validated_tb_cases WHERE case_no = $1')) return { rows: store.filter(c => c.case_no === params[0]) };
  if (q.startsWith('UPDATE validated_tb_cases')) { writes.push({ q, params }); return { rows: [] }; }
  return { rows: [] };
}

stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {}, patientNames: { enabled: false } });
stub('../db/pasigSchema', {
  pool: { query: async (s, p) => query(s, p), connect: async () => ({ query: async (s, p) => query(s, p), release() {} }) },
  authPool: { query: async (sql) => (String(sql).includes('facility_id') ? { rows: [{ facility_id: null }] } : { rows: [] }) },
});
stub('../utils/auditLogger', { logAuditEvent: async () => {} });
stub('../services/backgroundSync', { startBackgroundSync() {}, SYNC_STARTED: { status: 'syncing', message: 'Syncing…' } });

const router = require('../routes/manualEntry');

let server; let url;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/data', router);
  await new Promise(r => { server = app.listen(0, r); });
  url = `http://127.0.0.1:${server.address().port}/api/data/manual-entry`;
});
after(() => server.close());
beforeEach(() => { store = [existing()]; writes = []; seq = 0; });

const payload = (over = {}) => ({
  source_case_id: 'ROS-D-2025-00077', last_name: 'Santos', first_name: 'Maria', date_of_birth: '1985-05-05',
  barangay_name: 'Rosario', date_of_diagnosis: '2025-06-01', sex: 'Female', ...over,
});
const returning = (over = {}) => payload({ last_name: 'Dela Cruz', first_name: 'Juan', date_of_birth: '1990-01-01', ...over });
const post = async (body) => {
  const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, SECRET);
  const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const caseInserts = () => writes.filter(w => w.q.startsWith('INSERT INTO validated_tb_cases'));

describe('POST /manual-entry — Case ID', () => {
  it('requires a Case ID (never generates one)', async () => {
    const r = await post(payload({ source_case_id: '' }));
    assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    assert.ok(r.body.errors.some(e => /Case ID is required/.test(e)));
    assert.strictEqual(caseInserts().length, 0);
  });

  it('rejects a Case ID in the wrong format, including a system CS- number', async () => {
    const r = await post(payload({ source_case_id: 'CS-2025-000009' }));
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.errors.some(e => /Case ID must look like/.test(e)));
    assert.strictEqual(caseInserts().length, 0);
  });

  it('saves the typed Case ID, normalised, on a brand-new patient', async () => {
    const r = await post(payload({ source_case_id: ' ros-d-2025-00077 ' }));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.message, /Case ID ROS-D-2025-00077/);
    const ins = caseInserts();
    assert.strictEqual(ins.length, 1);
    assert.strictEqual(ins[0].params[32], 'ROS-D-2025-00077');
    assert.match(ins[0].params[29], /^CS-/); // internal System Reference only
  });
});

describe('POST /manual-entry — duplicates and returning patients', () => {
  it('a Case ID that already exists is a duplicate: 409, nothing saved', async () => {
    const r = await post(payload({ source_case_id: 'ros-d-2025-00042' }));
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.code, 'DUPLICATE_CASE_ID');
    assert.strictEqual(r.body.existingCase.case_id, 'ROS-D-2025-00042');
    assert.strictEqual(caseInserts().length, 0);
  });

  it('a duplicate Case ID cannot be forced through with a match resolution', async () => {
    for (const match_resolution of ['new_episode', 'different_person', 'same_case']) {
      const r = await post(returning({ source_case_id: 'ROS-D-2025-00042', match_resolution }));
      assert.strictEqual(r.status, 409, match_resolution);
      assert.strictEqual(r.body.code, 'DUPLICATE_CASE_ID');
    }
    assert.strictEqual(caseInserts().length, 0);
  });

  it('an archived case no longer blocks its Case ID (live cases only)', async () => {
    store = [existing({ is_archived: true })];
    const r = await post(payload({ source_case_id: 'ROS-D-2025-00042' }));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  });

  it('same name + date of birth with a NEW Case ID asks, suggesting a new episode', async () => {
    const r = await post(returning());
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.possibleMatch.suggestion, 'new_episode');
    assert.strictEqual(r.body.possibleMatch.case_id, 'ROS-D-2025-00042');
    assert.strictEqual(r.body.possibleMatch.new_case_id, 'ROS-D-2025-00077');
    assert.strictEqual(r.body.possibleMatch.has_case_id, true);
    assert.strictEqual(r.body.possibleMatch.canUpdateExisting, false);
    assert.strictEqual(caseInserts().length, 0);
  });

  it('"new episode" saves a second case under the new Case ID; the first keeps its own', async () => {
    const r = await post(returning({ match_resolution: 'new_episode' }));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.match_resolution, 'new_episode');
    const ins = caseInserts();
    assert.strictEqual(ins.length, 1);
    assert.strictEqual(ins[0].params[32], 'ROS-D-2025-00077');
    assert.ok(writes.some(w => w.q.includes("match_status = 'resolved'")));
    assert.strictEqual(store[0].source_case_id, 'ROS-D-2025-00042');
  });

  it('"same case" is refused when the existing case already has a different Case ID', async () => {
    const r = await post(returning({ match_resolution: 'same_case' }));
    assert.strictEqual(r.status, 400);
    assert.match(r.body.errors[0], /different episode/);
    assert.strictEqual(caseInserts().length, 0);
  });

  it('"same case" may fill in the Case ID of an older record that has none', async () => {
    store = [existing({ source_case_id: null })];
    const ask = await post(returning());
    assert.strictEqual(ask.status, 409);
    assert.strictEqual(ask.body.possibleMatch.has_case_id, false);
    assert.strictEqual(ask.body.possibleMatch.case_id, null);
    assert.strictEqual(ask.body.possibleMatch.canUpdateExisting, true);
    const r = await post(returning({ match_resolution: 'same_case' }));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.match_resolution, 'same_case');
    assert.ok(writes.some(w => w.q.includes('SET source_case_id = $2') && w.params.includes('ROS-D-2025-00077')));
  });
});
