/**
 * Recent Activity feed (GET /recent-activity):
 *   - whitelist      = core operational actions only; password/login/user-account
 *                      and delete/archive/undo noise never leave the SQL params
 *   - safety         = items carry exactly {id, text, createdAt} — sentences are
 *                      built server-side, so no ip_address/details/action leak
 *   - templates      = the exact dashboard wording (import, sync, referral, ...)
 *   - roles          = admin and staff both get the feed; anonymous gets 401
 * Run: node --test test/recentActivity.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-recent-activity-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

const captured = { sql: null, params: null };
let rows = [];

stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {} });
stub('../db/pasigSchema', {
  pool: {
    query: async () => ({ rows: [] }),
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
  },
  authPool: {
    query: async (sql, params) => {
      const q = String(sql).replace(/\s+/g, ' ');
      if (q.includes('FROM audit_logs')) {
        captured.sql = q;
        captured.params = params || [];
        return { rows };
      }
      throw new Error(`Unexpected authPool query: ${q.slice(0, 100)}`);
    },
  },
});
stub('../utils/auditLogger', { logAuditEvent: async () => {} });

const csvImportRouter = require('../routes/csvImport');

let server; let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/data', csvImportRouter);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/data`;
});
after(() => server.close());

const token = (role, id = 1) => jwt.sign({ id, username: `${role}${id}`, role }, SECRET);
async function call(role) {
  const res = await fetch(base + '/recent-activity', {
    headers: role ? { authorization: `Bearer ${token(role)}` } : {},
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const row = (over = {}) => ({
  id: 42,
  action: 'IMPORT_FILE',
  result: 'SUCCESS',
  details: null,
  created_at: '2026-10-04T01:00:00.000Z',
  actor_name: 'IvanUrbano',
  filename: null,
  ...over,
});

describe('recent activity', () => {
  it('items expose exactly {id, text, createdAt} — nothing technical', async () => {
    rows = [row({ filename: '2024_tbdata.xlsx' })];
    const r = await call('admin');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.activity.length, 1);
    const item = r.body.activity[0];
    assert.deepStrictEqual(Object.keys(item).sort(), ['createdAt', 'id', 'text']);
    assert.strictEqual(item.text, 'IvanUrbano imported 2024_tbdata.xlsx');
    assert.strictEqual(item.createdAt, '2026-10-04T01:00:00.000Z');
    assert.ok(!JSON.stringify(r.body).includes('ip_address'), 'no IP ever leaves the server');
    assert.ok(!JSON.stringify(r.body).includes('details'), 'no raw details payload');
  });

  it('query runs only the core whitelist, newest first, capped for formatting', async () => {
    rows = [];
    await call('admin');
    assert.ok(captured.sql.includes('FROM audit_logs'), 'reads the audit trail');
    assert.ok(captured.sql.includes('action = ANY('), 'whitelist in SQL, not post-filter');
    assert.ok(captured.sql.includes('ORDER BY a.created_at DESC'), 'newest first');
    assert.ok(captured.sql.includes('LIMIT 12'), 'fetch window for formatting buffer');
    assert.ok(!captured.sql.includes('ip_address'), 'IP column never selected');
    const wl = captured.params[0];
    for (const a of ['IMPORT_FILE', 'SYNC_BATCH', 'TRANSFER_ACCEPTED', 'ASSIGN_BARANGAY', 'MANUAL_ENTRY']) {
      assert.ok(wl.includes(a), `whitelist includes ${a}`);
    }
    for (const a of ['CHANGE_PASSWORD', 'LOGIN', 'ROLE_CHANGED', 'DELETE_BATCH', 'UPDATE_CASE']) {
      assert.ok(!wl.includes(a), `whitelist excludes ${a}`);
    }
  });

  it('templates produce the dashboard sentences', async () => {
    rows = [
      row({ action: 'IMPORT_FILE', actor_name: 'system', filename: '2024_tbdata.xlsx' }),
      row({ action: 'VALIDATE_BATCH', actor_name: 'system', filename: null }),
      row({ action: 'SYNC_BATCH', result: 'SUCCESS' }),
      row({ action: 'SYNC_BATCH', result: 'FAILURE' }),
      row({ action: 'TRANSFER_ACCEPTED', details: { to_barangay: 'Rosario' } }),
    ];
    const r = await call('staff');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.activity.map(a => a.text), [
      'System imported 2024_tbdata.xlsx',
      'System validated a batch',
      'TBInsight synchronization completed',
      'TBInsight synchronization failed',
      'Rosario accepted a referral',
    ]);

    rows = [
      row({ action: 'ASSIGN_BARANGAY' }),
      row({ action: 'RESOLVE_MATCHES_BULK', details: { requested: 20 } }),
      row({ action: 'TRANSFER_INITIATED', details: { to_barangay: 'Ugong' } }),
      row({ action: 'FIX_DATA_ISSUE' }),
      row({ action: 'MANUAL_ENTRY', actor_name: 'julianamen' }),
    ];
    const r2 = await call('staff');
    assert.deepStrictEqual(r2.body.activity.map(a => a.text), [
      'IvanUrbano resolved a barangay assignment',
      'IvanUrbano resolved 20 possible matches',
      'IvanUrbano referred a case to Ugong',
      'IvanUrbano corrected a data issue',
      'julianamen added a manual record',
    ]);
  });

  it('rows without a safe template are dropped, and at most 5 items ship', async () => {
    rows = [
      row({ action: 'UPDATE_CASE' }),
      row({ action: 'IMPORT_FILE', result: 'FAILURE' }),
      ...Array.from({ length: 8 }, (_, i) => row({ id: 100 + i, action: 'SYNC_BATCH', result: 'SUCCESS' })),
    ];
    const r = await call('admin');
    assert.strictEqual(r.body.activity.length, 5, 'cap at 5 after dropping unsafe rows');
    assert.ok(r.body.activity.every(a => a.text === 'TBInsight synchronization completed'));
    assert.ok(!r.body.activity.some(a => a.text.includes('UPDATE_CASE')));
  });

  it('staff may read the feed; anonymous requests are refused', async () => {
    rows = [];
    const s = await call('staff');
    assert.strictEqual(s.status, 200);
    const anon = await fetch(base + '/recent-activity');
    assert.strictEqual(anon.status, 401);
  });
});
