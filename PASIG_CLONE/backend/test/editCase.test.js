/**
 * PUT /api/data/records/:id — edit case details, enforced on the backend.
 * Uses an in-memory stand-in for the databases (no real database is touched).
 * Run: node --test test/editCase.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-edit-case-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

const STAFF_BARANGAY = { 22: { barangay_id: 17, barangay_name: 'Rosario' } };
let cases;
let writes;
const base = {
  source_type: 'DSTB', is_archived: false, merged_into_case_no: null, match_status: 'none',
  last_name: 'Dela Cruz', first_name: 'Juan', date_of_birth: '1990-01-01', date_of_diagnosis: '2025-03-04',
  sex: 'Male', age: 35, city: 'Pasig City', outcome_status: 'ON TREATMENT', date_of_outcome: null,
  case_no: 'CS-2025-000001', patient_id: 1, batch_id: '00000000-0000-0000-0000-000000000001',
  source_case_id: 'ROS-D-2025-00042',
};

function poolQuery(sql, params = []) {
  const q = String(sql).replace(/\s+/g, ' ').trim();
  if (q.startsWith('SELECT * FROM validated_tb_cases WHERE id = $1')) return { rows: cases.filter(c => c.id === Number(params[0])) };
  if (q.startsWith('SELECT case_id_required FROM import_batches')) return { rows: [{ case_id_required: true }] };
  if (q.startsWith('SELECT case_no FROM validated_tb_cases WHERE upper(source_case_id)')) {
    return { rows: cases.filter(c => c.id !== Number(params[1]) && String(c.source_case_id).toUpperCase() === String(params[0]).toUpperCase()).map(c => ({ case_no: c.case_no })) };
  }
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(q)) return { rows: [] };
  if (q.startsWith('UPDATE validated_tb_cases SET') || q.startsWith('INSERT INTO case_history')) { writes.push({ q, params }); return { rows: [] }; }
  return { rows: [] };
}
const CONFIG = { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {}, patientNames: { enabled: false } };
stub('../config', CONFIG);
stub('../db/pasigSchema', {
  pool: { query: async (s, p) => poolQuery(s, p), connect: async () => ({ query: async (s, p) => poolQuery(s, p), release() {} }) },
  authPool: {
    query: async (sql, params) => (String(sql).includes('FROM users u JOIN barangays b')
      ? { rows: STAFF_BARANGAY[Number(params[0])] ? [STAFF_BARANGAY[Number(params[0])]] : [] }
      : { rows: [] }),
  },
});
stub('../utils/auditLogger', { logAuditEvent: async () => {} });
stub('../services/caseFollowUp', { resyncSyncedCases: async () => ({ status: 'pending', count: 0 }), logReviews: async () => {} });
stub('../services/webhookSender', { sendWebhook: async () => ({ success: true }) });

const router = require('../routes/csvImport');

let server; let base_url;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/data', router);
  await new Promise(r => { server = app.listen(0, r); });
  base_url = `http://127.0.0.1:${server.address().port}/api/data/records`;
});
after(() => server.close());
beforeEach(() => {
  writes = [];
  cases = [
    { ...base, id: 1, barangay_id: 17, barangay_name: 'Rosario', responsible_barangay_id: null, responsible_barangay: null },          // editable
    { ...base, id: 2, barangay_id: 17, barangay_name: 'Rosario', responsible_barangay_id: 12, responsible_barangay: 'Maybunga' },       // view only
    { ...base, id: 3, barangay_id: 30, barangay_name: 'Ugong', responsible_barangay_id: null, responsible_barangay: null },             // not assigned
    { ...base, id: 4, barangay_id: 17, barangay_name: 'Rosario', match_status: 'pending', responsible_barangay_id: null },              // pending match
  ];
});

const put = async (id, changes) => {
  const token = jwt.sign({ id: 22, username: 'maria', role: 'staff' }, SECRET);
  const res = await fetch(`${base_url}/${id}`, {
    method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ changes }),
  });
  return { status: res.status, body: await res.json() };
};

describe('PUT /records/:id', () => {
  it('saves changed fields on an editable case and records history', async () => {
    const r = await put(1, { outcome_status: 'CURED', date_of_outcome: '2025-09-01' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.changed.sort(), ['date_of_outcome', 'outcome_status']);
    assert.ok(writes.some(w => w.q.startsWith('UPDATE validated_tb_cases SET')));
    const hist = writes.find(w => w.q.startsWith('INSERT INTO case_history'));
    assert.strictEqual(hist.params[4], 'status_changed');
    assert.strictEqual(JSON.parse(hist.params[5]).outcome_status.new, 'CURED');
  });

  it('refuses a view-only case (referred out) with the reason — nothing written', async () => {
    const r = await put(2, { outcome_status: 'CURED' });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.body.code, 'VIEW_ONLY');
    assert.match(r.body.error, /Maybunga/);
    assert.strictEqual(writes.length, 0);
  });

  it('refuses a case from another barangay', async () => {
    const r = await put(3, { outcome_status: 'CURED' });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.body.code, 'NOT_ASSIGNED');
  });

  it('refuses identity changes on a historical (de-identified) record', async () => {
    const r = await put(1, { last_name: 'Santos' });
    assert.strictEqual(r.status, 403);
    assert.match(r.body.error, /de-identified historical record/);
    assert.strictEqual(writes.length, 0);
  });

  it('operational record: refuses identity changes while the Records PIN is locked', async () => {
    CONFIG.patientNames.enabled = true;
    cases[0].identity_class = 'operational';
    try {
      const r = await put(1, { last_name: 'Santos' });
      assert.strictEqual(r.status, 403);
      assert.match(r.body.error, /Records PIN/);
      assert.strictEqual(writes.length, 0);
    } finally {
      CONFIG.patientNames.enabled = false;
    }
  });

  it('refuses fields that are not editable here (barangay, diagnosis date)', async () => {
    const r = await put(1, { barangay_name: 'Pineda', date_of_diagnosis: '2024-01-01' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(writes.length, 0);
  });

  it('refuses a record with a pending possible match', async () => {
    const r = await put(4, { outcome_status: 'CURED' });
    assert.strictEqual(r.status, 409);
  });

  it('saves nothing when values are unchanged', async () => {
    const r = await put(1, { outcome_status: 'ON TREATMENT' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.changed, []);
    assert.strictEqual(writes.length, 0);
  });

  describe('Case ID and screening date', () => {
    beforeEach(() => { cases[0].source_case_id = 'ROS-D-2025-00099'; });

    it('saves a corrected Case ID, normalised to upper case without spaces', async () => {
      const r = await put(1, { source_case_id: ' ros-d-2025-00100 ' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual(r.body.changed, ['source_case_id']);
      const upd = writes.find(w => w.q.startsWith('UPDATE validated_tb_cases SET'));
      assert.ok(upd.params.includes('ROS-D-2025-00100'));
    });

    it('refuses a Case ID in the wrong format (e.g. a system CS- number)', async () => {
      const r = await put(1, { source_case_id: 'CS-2025-000001' });
      assert.strictEqual(r.status, 422);
      assert.match(r.body.error, /Case ID must look like/);
      assert.strictEqual(writes.length, 0);
    });

    it('refuses a Case ID that already belongs to another case (duplicate)', async () => {
      const r = await put(1, { source_case_id: 'ros-d-2025-00042' });
      assert.strictEqual(r.status, 409);
      assert.match(r.body.error, /already belongs to case/);
      assert.strictEqual(writes.length, 0);
    });

    it('a pending-match record can have its Case ID corrected', async () => {
      const r = await put(4, { source_case_id: 'ROS-D-2025-00101' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    });

    it('saves the date of screening', async () => {
      const r = await put(1, { date_of_screening: '2025-02-20' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual(r.body.changed, ['date_of_screening']);
    });
  });
});
