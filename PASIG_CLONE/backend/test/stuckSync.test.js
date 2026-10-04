/**
 * Stuck sync recovery (services/webhookSender.js):
 *   A batch marked 'syncing' whose sync never finished (server restart, crash,
 *   unexpected error) must not stay 'syncing' forever: it is moved to
 *   'sync_failed' so it is counted as failed and can be re-synced.
 * Run: node --test test/stuckSync.test.js
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert');

// No real network: every webhook POST fails as if TBInsight were unreachable.
const FETCH = require.resolve('node-fetch');
require.cache[FETCH] = {
  id: FETCH, filename: FETCH, loaded: true,
  exports: async () => { throw new Error('connect ECONNREFUSED'); },
};

// No real audit writes (they would open a database connection).
const AUDIT = require.resolve('../utils/auditLogger');
require.cache[AUDIT] = { id: AUDIT, filename: AUDIT, loaded: true, exports: { logAuditEvent: async () => {} } };

const db = require('../db/pasigSchema');
const { recoverStuckSyncs, sendWebhook, STUCK_SYNC_MINUTES } = require('../services/webhookSender');

const realConnect = db.pool.connect;
const realQuery = db.pool.query;
const realGetBatch = db.getBatch;
const realGetValidatedCases = db.getValidatedCases;

after(() => {
  db.pool.connect = realConnect;
  db.pool.query = realQuery;
  db.getBatch = realGetBatch;
  db.getValidatedCases = realGetValidatedCases;
});

describe('recoverStuckSyncs', () => {
  it('moves only stale syncing batches to sync_failed', async () => {
    let captured;
    const pool = {
      query: async (sql, params) => {
        captured = { sql, params };
        return { rows: [{ id: 'b-1' }, { id: 'b-2' }] };
      },
    };
    const ids = await recoverStuckSyncs(pool);
    assert.deepStrictEqual(ids, ['b-1', 'b-2']);
    assert.match(captured.sql, /SET sync_status = 'sync_failed'/);
    assert.match(captured.sql, /WHERE sync_status = 'syncing'/);
    assert.match(captured.sql, /sync_started_at IS NULL OR sync_started_at < NOW\(\)/);
    assert.strictEqual(captured.params[0], STUCK_SYNC_MINUTES);
    assert.match(captured.params[1], /Sync again/);
  });

  it('accepts an age of 0 for startup recovery', async () => {
    let params;
    await recoverStuckSyncs({ query: async (_s, p) => { params = p; return { rows: [] }; } }, 0);
    assert.strictEqual(params[0], 0);
  });
});

describe('sendWebhook unexpected error', () => {
  it('does not leave the batch at syncing', async () => {
    const poolUpdates = [];
    db.getBatch = async () => ({ rows: [{ id: 'b-9', status: 'validated' }] });
    db.getValidatedCases = async () => ({ rows: [] });
    db.pool.connect = async () => ({
      query: async (sql) => {
        // Marking 'syncing' works; the next write (sync log) blows up unexpectedly.
        if (sql.includes("sync_status = 'syncing'") || sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        return { rows: [] };
      },
      release: () => {},
    });
    db.pool.query = async (sql, params) => {
      if (sql.includes('UPDATE import_batches')) poolUpdates.push({ sql, params });
      return { rows: [] };
    };
    const realLogWebhook = db.logWebhook;
    const realLogWebhookError = db.logWebhookError;
    db.logWebhook = async () => { throw new Error('log table unavailable'); };
    db.logWebhookError = async () => { throw new Error('log table unavailable'); };
    process.env.WEBHOOK_MAX_RETRIES = '1';
    try {
      await assert.rejects(sendWebhook('b-9', 1), /log table unavailable/);
    } finally {
      db.logWebhook = realLogWebhook;
      db.logWebhookError = realLogWebhookError;
      delete process.env.WEBHOOK_MAX_RETRIES;
    }
    const failed = poolUpdates.find(u => u.sql.includes("sync_status = 'sync_failed'"));
    assert.ok(failed, 'batch must be moved off syncing');
    assert.strictEqual(failed.params[0], 'b-9');
    assert.match(failed.sql, /AND sync_status = 'syncing'/, 'never overwrites a status another path already set');
  });
});
