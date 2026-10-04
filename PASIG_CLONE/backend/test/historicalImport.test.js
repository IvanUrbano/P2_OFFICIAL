/**
 * "Historical dataset" import option (POST /api/data/import, field `historical`):
 *   - default (checkbox on) -> batch identity_class 'historical', whatever the approval flag
 *   - historical=false before approval -> still 'historical'
 *   - historical=false after approval (PATIENT_NAMES_ENABLED) -> 'operational'
 *   - GET /import-options tells the form whether names are approved
 * Uses an in-memory stand-in for the database (nothing real is touched).
 * Run: node --test test/historicalImport.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const fileUpload = require('express-fileupload');
const jwt = require('jsonwebtoken');

const SECRET = 'test-historical-import-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

const CONFIG = { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {}, patientNames: { enabled: false } };
let insertedClass;
function query(sql, params = []) {
  const q = String(sql).replace(/\s+/g, ' ').trim();
  if (q.startsWith('INSERT INTO import_batches')) {
    insertedClass = params[7];
    return { rows: [{ id: '00000000-0000-0000-0000-0000000000aa' }] };
  }
  return { rows: [] };
}
stub('../config', CONFIG);
stub('../db/pasigSchema', {
  pool: { query: async (s, p) => query(s, p), connect: async () => ({ query: async (s, p) => query(s, p), release() {} }) },
  authPool: { query: async () => ({ rows: [] }) },
  insertRawCases: async () => {},
});
stub('../utils/auditLogger', { logAuditEvent: async () => {} });
stub('../services/webhookSender', { sendWebhook: async () => ({ success: true }) });

const router = require('../routes/csvImport');

let server; let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use(fileUpload());
  app.use('/api/data', router);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/data`;
});
after(() => server.close());
beforeEach(() => { insertedClass = undefined; CONFIG.patientNames.enabled = false; });

const token = jwt.sign({ id: 1, username: 'admin1', role: 'admin' }, SECRET);
let n = 0;
async function upload(historical) {
  n += 1; // a different file each time (duplicate-file detection hashes the content)
  const csv = `Brgy,Age,Sex,Date of Diagnosis,Last Name,First Name,Date of Birth\nRosario,40,Male,2024-01-0${(n % 9) + 1},Cruz,Juan,1984-01-01\n`;
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), `test${n}.csv`);
  if (historical !== undefined) form.append('historical', historical);
  const res = await fetch(`${base}/import`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  return { status: res.status, body: await res.json() };
}

describe('Historical dataset import option', () => {
  it('defaults to historical', async () => {
    const r = await upload();
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(insertedClass, 'historical');
    assert.strictEqual(r.body.batch.identityClass, 'historical');
  });

  it('stays historical when checked, even after names are approved', async () => {
    CONFIG.patientNames.enabled = true;
    await upload('true');
    assert.strictEqual(insertedClass, 'historical');
  });

  it('unchecked before approval is still historical', async () => {
    await upload('false');
    assert.strictEqual(insertedClass, 'historical');
  });

  it('unchecked after approval is operational', async () => {
    CONFIG.patientNames.enabled = true;
    const r = await upload('false');
    assert.strictEqual(insertedClass, 'operational');
    assert.strictEqual(r.body.batch.identityClass, 'operational');
  });

  it('import-options reports whether names are approved', async () => {
    const get = async () => (await (await fetch(`${base}/import-options`, { headers: { authorization: `Bearer ${token}` } })).json()).namesEnabled;
    assert.strictEqual(await get(), false);
    CONFIG.patientNames.enabled = true;
    assert.strictEqual(await get(), true);
  });
});
