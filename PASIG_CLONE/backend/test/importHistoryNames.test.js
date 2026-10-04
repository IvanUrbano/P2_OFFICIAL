/**
 * Import History shows WHO imported each file — the real account from the auth database
 * (full name, else username), never a join against the leftover local `users` table
 * (which mapped ids to stale "admin"/"staff" rows).
 * Run: node --test test/importHistoryNames.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-import-history-names';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

const BATCHES = [
  { id: 'b1', filename: '2023_tbdata.xlsx', uploaded_by: 1, archived_by: null, total_rows: 5100, status: 'validated' },
  { id: 'b2', filename: 'rosario_oct.csv', uploaded_by: 15, archived_by: null, total_rows: 120, status: 'uploaded' },
  { id: 'b3', filename: 'old.csv', uploaded_by: 99, archived_by: null, total_rows: 3, status: 'uploaded' }, // deleted account
];
const AUTH_USERS = [
  { id: 1, username: 'IvanUrbano', full_name: 'Ivan Urbano' },
  { id: 15, username: 'julianamen', full_name: '' },
];
let pasigSql = [];

stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {}, patientNames: { enabled: false } });
stub('../db/pasigSchema', {
  pool: { query: async (sql) => { pasigSql.push(String(sql)); return { rows: [] }; } },
  authPool: {
    query: async (sql, params) => (String(sql).includes('FROM users WHERE id = ANY')
      ? { rows: AUTH_USERS.filter(u => params[0].includes(u.id)) }
      : { rows: [] }),
  },
  getImportHistory: async () => ({ rows: BATCHES.map(b => ({ ...b })) }),
});
stub('../utils/auditLogger', { logAuditEvent: async () => {} });
stub('../services/webhookSender', { sendWebhook: async () => ({ success: true }) });

const router = require('../routes/csvImport');

let server; let url;
before(async () => {
  const app = express();
  app.use('/api/data', router);
  await new Promise(r => { server = app.listen(0, r); });
  url = `http://127.0.0.1:${server.address().port}/api/data/import-history`;
});
after(() => server.close());

describe('Import History — imported by', () => {
  it('names the real uploader from the auth database', async () => {
    const token = jwt.sign({ id: 1, username: 'IvanUrbano', role: 'admin' }, SECRET);
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    assert.strictEqual(res.status, 200);
    const { batches } = await res.json();
    const by = Object.fromEntries(batches.map(b => [b.id, [b.importedBy, b.importedByUsername]]));
    assert.deepStrictEqual(by.b1, ['Ivan Urbano', 'IvanUrbano'], 'full name + login');
    assert.deepStrictEqual(by.b2, ['julianamen', 'julianamen'], 'no full name -> username');
    assert.deepStrictEqual(by.b3, ['Unknown', null], 'deleted account');
    assert.ok(!pasigSql.some(q => /JOIN users/i.test(q)), 'never joins the local users table');
  });
});
