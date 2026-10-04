/**
 * Background sync (services/backgroundSync.js):
 *   - a sync is started without waiting for it, and only one sync of a batch
 *     can run at a time (claimBatchForSync is atomic);
 *   - a sync that fails is recorded on the batch and notified, never lost.
 * Run: node --test test/backgroundSync.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const stub = (rel, exports) => {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};

let poolQueries = [];
let poolResponder = async () => ({ rows: [] });
stub('../db/pasigSchema', {
  pool: { query: async (sql, params) => { poolQueries.push({ sql, params }); return poolResponder(sql, params); } },
});

let sendImpl = async () => ({ success: true, message: 'ok' });
stub('../services/webhookSender', { sendWebhook: (...a) => sendImpl(...a), STUCK_SYNC_MINUTES: 15 });

let notified = [];
stub('../services/notifications', {
  notify: async (recipients, n) => { notified.push({ recipients, n }); },
  admins: async () => [99],
});

const { startBackgroundSync, claimBatchForSync, SYNC_STARTED } = require('../services/backgroundSync');
const user = { id: 1, username: 'ivan' };

beforeEach(() => {
  poolQueries = [];
  notified = [];
  poolResponder = async (sql) => (sql.includes('SELECT filename, uploaded_by')
    ? { rows: [{ filename: 'cases.xlsx', uploaded_by: 1 }] }
    : { rows: [] });
});

describe('claimBatchForSync', () => {
  it('claims a validated batch that is not already syncing', async () => {
    poolResponder = async (sql) => (sql.includes('UPDATE import_batches') ? { rows: [{ id: 'b1' }] } : { rows: [] });
    const r = await claimBatchForSync('b1', 1);
    assert.deepStrictEqual(r, { ok: true });
    const upd = poolQueries[0];
    assert.match(upd.sql, /SET sync_status = 'syncing'/);
    assert.match(upd.sql, /sync_status IS DISTINCT FROM 'syncing'/, 'a running sync is not claimed again');
    assert.match(upd.sql, /status = 'validated'/);
  });

  it('refuses a second sync while one is running', async () => {
    poolResponder = async (sql) => (sql.startsWith('SELECT status')
      ? { rows: [{ status: 'validated', sync_status: 'syncing' }] }
      : { rows: [] });
    const r = await claimBatchForSync('b1', 1);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.inProgress, true);
  });

  it('reports a missing or unvalidated batch', async () => {
    poolResponder = async () => ({ rows: [] });
    assert.strictEqual((await claimBatchForSync('nope', 1)).status, 404);
    poolResponder = async (sql) => (sql.startsWith('SELECT status') ? { rows: [{ status: 'uploaded', sync_status: 'pending' }] } : { rows: [] });
    assert.strictEqual((await claimBatchForSync('b2', 1)).status, 400);
  });
});

describe('startBackgroundSync', () => {
  it('does not make the caller wait for the sync', async () => {
    let release;
    sendImpl = () => new Promise(r => { release = () => r({ success: true, message: 'done' }); });
    let settled = false;
    const p = startBackgroundSync('b1', user).then(() => { settled = true; });
    await new Promise(r => setImmediate(r));
    assert.strictEqual(settled, false, 'sync still running in the background');
    release();
    await p;
    assert.strictEqual(notified[0].n.type, 'sync_completed');
  });

  it('records and notifies a sync that throws', async () => {
    sendImpl = async () => { throw new Error('This batch has 2 possible patient matches to review first.'); };
    await startBackgroundSync('b1', user);
    const failed = poolQueries.find(q => q.sql.includes("sync_status = 'sync_failed'"));
    assert.ok(failed, 'batch is moved off syncing');
    assert.match(failed.sql, /AND sync_status = 'syncing'/);
    assert.match(failed.params[1], /possible patient matches/);
    assert.strictEqual(notified[0].n.type, 'sync_failed');
    assert.ok(notified[0].recipients.includes(99), 'admins hear about failures');
  });

  it('describes the started sync for callers that answer immediately', () => {
    assert.strictEqual(SYNC_STARTED.status, 'syncing');
    assert.match(SYNC_STARTED.message, /background/);
  });
});
