/**
 * Import History permissions are kept separate from TB Records permissions:
 *   - staff see shared batch-level history only (file, uploader, counts, status) —
 *     exactly what IMPORT HISTORY answers: "what files entered the system?"
 *   - a batch never hands out the patients inside it: the raw-rows endpoint
 *     (GET /batches/:id, names + birth dates) is admin-only
 *   - destructive / import-administrative actions (archive, unarchive, delete) are
 *     admin-only; staff are refused by the role gate before the handler runs
 * Run: node --test test/importHistoryPermissions.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-import-perms-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

const archiveCalls = [];
stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {} });
stub('../db/pasigSchema', {
  pool: {
    query: async (sql) => {
      const q = String(sql).replace(/\s+/g, ' ');
      if (q.includes('FROM webhook_logs')) {
        return { rows: [{ id: 1, batch_id: 'b1', status: 'sent', sent_at: '2026-10-01T00:00:00Z', username: 'admin' }] };
      }
      throw new Error(`Unexpected pool query: ${q.slice(0, 90)}`);
    },
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
  },
  // Uploader names come from the auth database (services/userNames.js).
  authPool: {
    query: async (sql) => (String(sql).includes('FROM users WHERE id = ANY')
      ? { rows: [{ id: 1, username: 'admin', full_name: 'City Admin' }] }
      : { rows: [] }),
  },
  WEBHOOK_LOG_COLUMNS: 'wl.id, wl.batch_id, wl.status, wl.sent_at',
  getImportHistory: async () => ({
    rows: [{
      id: 'batch-1', filename: 'Citywide_October.xlsx', uploaded_by: 1,
      total_rows: 500, valid_count: 480, error_count: 20,
      status: 'validated', sync_status: 'pending', created_at: '2026-10-01T00:00:00Z',
      validated_at: null, synced_at: null, is_archived: false,
      archived_by: null, archived_at: null, archive_reason: null, archived_by_username: null,
    }],
  }),
  archiveBatch: async (id, by, reason) => {
    archiveCalls.push({ id, by, reason });
    return { rows: [{ id, is_archived: true }] };
  },
  unarchiveBatch: async (id) => ({ rows: [{ id, is_archived: false }] }),
  getBatch: async (id) => ({ rows: [{ id, filename: 'Citywide_October.xlsx' }] }),
  getRawCases: async () => ({ rows: [{ last_name: 'Dela Cruz', date_of_birth: '1990-01-01' }] }),
  getBatchWithUsers: async (id) => ({
    rows: [{ id, filename: 'Citywide_October.xlsx', total_rows: 500, status: 'validated', is_archived: false }],
  }),
  deleteBatch: async (id) => ({ deleted: true, batch: { id, filename: 'Citywide_October.xlsx' } }),
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
async function call(role, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token(role)}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe('import history permissions', () => {
  it('staff can read the shared batch-level history', async () => {
    const r = await call('staff', 'GET', '/import-history?status=active');
    assert.strictEqual(r.status, 200);
    const b = r.body.batches[0];
    assert.strictEqual(b.filename, 'Citywide_October.xlsx');
    assert.strictEqual(b.importedBy, 'City Admin');
    assert.strictEqual(b.importedByUsername, 'admin');
    assert.strictEqual(b.records, 500);
    assert.strictEqual(b.status, 'validated');
    // Batch metadata only — no patient fields ever cross this endpoint.
    for (const key of ['last_name', 'first_name', 'date_of_birth', 'patient_no']) {
      assert.ok(!(key in b), `${key} must not appear in import history`);
    }
  });

  it("staff can open a batch's detail view (metadata + sync logs, no patients)", async () => {
    const r = await call('staff', 'GET', '/batches/b1/details');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.batch.filename, 'Citywide_October.xlsx');
    assert.strictEqual(r.body.batch.total_rows, 500);
    assert.ok(Array.isArray(r.body.syncLogs));
    assert.ok(!('records' in r.body), 'details must not include patient rows');
  });

  it('staff cannot read the raw rows of a batch (patients)', async () => {
    const r = await call('staff', 'GET', '/batches/b1');
    assert.strictEqual(r.status, 403);
  });

  it('staff cannot archive an import', async () => {
    const before = archiveCalls.length;
    const r = await call('staff', 'PATCH', '/batches/b1/archive', { reason: 'nope' });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(archiveCalls.length, before, 'handler must not run for staff');
  });

  it('admin can archive an import', async () => {
    const r = await call('admin', 'PATCH', '/batches/b1/archive', { reason: 'duplicate upload' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(archiveCalls.length, 1);
    assert.strictEqual(archiveCalls[0].reason, 'duplicate upload');
  });

  it('staff cannot unarchive an import', async () => {
    assert.strictEqual((await call('staff', 'PATCH', '/batches/b1/unarchive')).status, 403);
  });

  it('staff cannot delete an import', async () => {
    assert.strictEqual((await call('staff', 'DELETE', '/batches/b1')).status, 403);
  });
});
