/**
 * /api/settings — read-only system information for the Settings page.
 * In-memory stand-ins for the database, config and TBInsight (nothing real is touched).
 * Run: node --test test/settingsRoutes.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-settings-secret';
const SYNC_SECRET = 'do-not-leak-this-sync-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

let lastSuccess; let lastFailure; let counts; let missingMigration; let fetchImpl; let audits; let fetchedUrls;

function query(sql) {
  const q = String(sql).replace(/\s+/g, ' ').trim();
  if (q.includes("sync_status = 'synced' ORDER BY")) return { rows: lastSuccess ? [lastSuccess] : [] };
  if (q.includes("sync_status = 'sync_failed' ORDER BY")) return { rows: lastFailure ? [lastFailure] : [] };
  if (q.includes('COUNT(*) FILTER')) return { rows: [counts] };
  if (q === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
  if (q.includes('information_schema.columns') || q.includes('pg_indexes')) {
    const m = missingMigration;
    const hit = (m === '018' && q.includes('case_id_required')) || (m === '019' && q.includes('uq_validated_case_id'));
    return { rows: hit ? [] : [{ '?column?': 1 }] };
  }
  return { rows: [] };
}

const CONFIG = {
  jwt: { secret: SECRET, expiresIn: '1h' },
  webhook: { url: 'http://tbinsight.test:5050/api/webhook/pasig-clone?token=abc', secret: SYNC_SECRET },
  patientNames: { enabled: false },
};
stub('../config', CONFIG);
stub('../db/pasigSchema', {
  pool: { query: async (s, p) => query(s, p) },
  authPool: { query: async (s, p) => query(s, p) },
});
stub('../utils/auditLogger', { logAuditEvent: async (e) => { audits.push(e); } });
stub('node-fetch', async (url) => {
  fetchedUrls.push(String(url));
  return fetchImpl(url);
});

const router = require('../routes/settings');

let server; let url;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/settings', router);
  await new Promise(r => { server = app.listen(0, r); });
  url = `http://127.0.0.1:${server.address().port}/api/settings`;
});
after(() => server.close());
beforeEach(() => {
  lastSuccess = { id: 'b-1', filename: 'tb.xlsx', synced_at: '2026-10-07T18:44:23.823Z', sync_result: { recordsSent: 10, recordsImported: 8, recordsUpdated: 2, recordsRejected: 0 } };
  lastFailure = null;
  counts = { ready: 0, failed: 0, syncing: 0 };
  missingMigration = null;
  audits = [];
  fetchedUrls = [];
  fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ status: 'ok', database: 'connected' }) });
});

const call = async (role, path, opts = {}) => {
  const token = jwt.sign({ id: 5, username: 'tester', role }, SECRET);
  const res = await fetch(url + path, { ...opts, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) : {} };
};

describe('GET /rules', () => {
  it('is available to staff and reports the Case ID rule from the code', async () => {
    const r = await call('staff', '/rules');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.caseId.example, 'ROS-D-2025-00042');
    assert.ok(new RegExp(r.body.caseId.pattern).test(r.body.caseId.example), 'the example matches the real pattern');
    assert.ok(r.body.duplicates.length >= 3);
    assert.deepStrictEqual(r.body.import.fileTypes, ['.xlsx', '.xls', '.csv']);
    assert.strictEqual(r.body.security.password.minLength, 8);
  });
});

describe('admin-only sections', () => {
  it('staff cannot read sync or system information, or test the connection', async () => {
    for (const [method, path] of [['GET', '/sync'], ['GET', '/system'], ['POST', '/test-connection']]) {
      const r = await call('staff', path, { method, body: method === 'POST' ? '{}' : undefined });
      assert.strictEqual(r.status, 403, path);
    }
    assert.strictEqual(fetchedUrls.length, 0, 'no request to TBInsight was made for staff');
  });
});

describe('GET /sync', () => {
  it('reports the last successful sync and never returns the sync secret or URL credentials', async () => {
    counts = { ready: 2, failed: 1, syncing: 0 };
    const r = await call('admin', '/sync');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.secretConfigured, true);
    assert.strictEqual(r.body.lastSuccess.sent, 10);
    assert.strictEqual(r.body.lastSuccess.imported, 8);
    assert.deepStrictEqual(r.body.counts, { ready: 2, failed: 1, syncing: 0 });
    assert.ok(!r.text.includes(SYNC_SECRET), 'the secret is never in the response');
    assert.ok(!r.text.includes('token=abc'), 'the query string of the address is not shown');
    assert.strictEqual(r.body.endpoint.host, 'tbinsight.test:5050');
  });

  it('says so when nothing has synced yet', async () => {
    lastSuccess = null;
    const r = await call('admin', '/sync');
    assert.strictEqual(r.body.lastSuccess, null);
  });

  it('includes the latest failure and trims a long error', async () => {
    lastFailure = { id: 'b-2', filename: 'x.xlsx', sync_started_at: '2026-10-08T01:00:00.000Z', sync_error: 'x'.repeat(900) };
    const r = await call('admin', '/sync');
    assert.strictEqual(r.body.lastFailure.error.length, 300);
  });
});

describe('POST /test-connection', () => {
  it('reports Connected when TBInsight health is ok, using its /api/health address', async () => {
    const r = await call('admin', '/test-connection', { method: 'POST', body: '{}' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
    assert.strictEqual(r.body.state, 'connected');
    assert.deepStrictEqual(fetchedUrls, ['http://tbinsight.test:5050/api/health']);
    assert.ok(!r.text.includes(SYNC_SECRET));
  });

  it('an unreachable TBInsight is a 200 with ok:false — never 401/403, which would sign the user out', async () => {
    fetchImpl = async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); };
    const r = await call('admin', '/test-connection', { method: 'POST', body: '{}' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, false);
    assert.strictEqual(r.body.state, 'unreachable');
    assert.match(r.body.message, /tbinsight\.test:5050/);
  });

  it('TBInsight running with its database down is reported as a problem, not as connected', async () => {
    fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ status: 'error', database: 'disconnected' }) });
    const r = await call('admin', '/test-connection', { method: 'POST', body: '{}' });
    assert.strictEqual(r.body.ok, false);
    assert.strictEqual(r.body.state, 'error');
    assert.match(r.body.message, /database/);
  });

  it('a button press is written to the audit log; the automatic check is not', async () => {
    await call('admin', '/test-connection', { method: 'POST', body: JSON.stringify({ auto: true }) });
    assert.strictEqual(audits.length, 0);
    await call('admin', '/test-connection', { method: 'POST', body: '{}' });
    assert.strictEqual(audits.length, 1);
    assert.strictEqual(audits[0].action, 'TEST_SYNC_CONNECTION');
    assert.strictEqual(audits[0].result, 'SUCCESS');
  });
});

describe('GET /system', () => {
  it('reports version, database status and an up-to-date schema', async () => {
    const r = await call('admin', '/system');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.name, 'PASIG TB-IS');
    assert.match(r.body.version, /^\d+\.\d+\.\d+/);
    assert.strictEqual(r.body.databases.records.ok, true);
    assert.strictEqual(r.body.schemaUpToDate, true);
  });

  it('flags a schema that is behind (a migration that never ran)', async () => {
    missingMigration = '018';
    const r = await call('admin', '/system');
    assert.strictEqual(r.body.schemaUpToDate, false);
    assert.deepStrictEqual(r.body.schema.filter(s => !s.applied).map(s => s.migration), ['018']);
  });
});
