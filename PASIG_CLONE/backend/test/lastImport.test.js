/**
 * Last Import (global header) endpoint:
 *   GET /api/data/last-import answers "when was the most recent Excel/CSV file
 *   successfully uploaded?" for the brand bar. Only file uploads count — manual
 *   entry and correction batches share import_batches but carry no file_hash,
 *   and a batch row only exists if the upload itself succeeded (failures return
 *   4xx/rollback before any row is written).
 * Run: node --test test/lastImport.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-last-import-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

let lastImportRows = [];
const capturedSql = [];
stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {} });
stub('../db/pasigSchema', {
  pool: {
    query: async (sql) => {
      const q = String(sql).replace(/\s+/g, ' ');
      if (q.includes('FROM import_batches')) {
        capturedSql.push(q);
        return { rows: lastImportRows };
      }
      throw new Error(`Unexpected pool query: ${q.slice(0, 90)}`);
    },
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
  },
  authPool: { query: async () => ({ rows: [] }) },
  WEBHOOK_LOG_COLUMNS: 'wl.id',
  getImportHistory: async () => ({ rows: [] }),
  archiveBatch: async (id) => ({ rows: [{ id }] }),
  unarchiveBatch: async (id) => ({ rows: [{ id }] }),
  getBatch: async (id) => ({ rows: [{ id }] }),
  getRawCases: async () => ({ rows: [] }),
  getBatchWithUsers: async (id) => ({ rows: [{ id }] }),
  deleteBatch: async (id) => ({ deleted: true, batch: { id } }),
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
async function get(path, role) {
  const res = await fetch(base + path, {
    method: 'GET',
    headers: role ? { authorization: `Bearer ${token(role)}` } : {},
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe('GET /last-import', () => {
  beforeEach(() => { lastImportRows = []; });

  it('returns the upload timestamp of the newest file import', async () => {
    lastImportRows = [{ created_at: '2026-10-01T08:30:00Z' }];
    const r = await get('/last-import', 'admin');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.lastImport, '2026-10-01T08:30:00Z');
  });

  it('staff can read it too', async () => {
    lastImportRows = [{ created_at: '2026-10-02T09:00:00Z' }];
    const r = await get('/last-import', 'staff');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.lastImport, '2026-10-02T09:00:00Z');
  });

  it('returns null when no file import has ever succeeded', async () => {
    const r = await get('/last-import', 'admin');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.lastImport, null);
  });

  it('counts only real file uploads: file_hash present, active, not failed, newest first', async () => {
    lastImportRows = [{ created_at: '2026-10-03T00:00:00Z' }];
    await get('/last-import', 'admin');
    const sql = capturedSql[capturedSql.length - 1];
    assert.ok(sql.includes('file_hash IS NOT NULL'), 'must exclude manual-entry/correction batches');
    assert.ok(sql.includes('COALESCE(is_archived, false) = false'), 'must ignore archived imports');
    assert.ok(sql.includes("status <> 'failed'"), 'must ignore failed batches');
    assert.ok(sql.includes('ORDER BY created_at DESC'), 'must pick the newest import');
    assert.ok(sql.includes('LIMIT 1'), 'must return a single row');
  });

  it('rejects unauthenticated requests', async () => {
    const r = await get('/last-import');
    assert.strictEqual(r.status, 401);
  });
});
