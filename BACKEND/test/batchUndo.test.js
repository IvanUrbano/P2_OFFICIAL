/**
 * Batch undo (DELETE /api/tb/integration/batches/:batchId) tests.
 * Database and aggregation module are mocked. Run: node --test BACKEND/test/batchUndo.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const SECRET = 'test-jwt-secret-do-not-use-in-production';
const BATCH = '550e8400-e29b-41d4-a716-446655440000';

const MODULE_DB = require.resolve('../db');
const MODULE_AGG = require.resolve('../tbinsight/aggregateMonthly');
const MODULE_INTEGRATION = require.resolve('../tbinsight/integration');

let calls;          // ordered log of SQL text and aggregate invocations
let counts;         // rowCount returned per table
let aggregateFails;
let auditFails;
let auditRow;
let released;
let savedSecret;

const mockClient = {
  query: async (sql, params) => {
    calls.push(String(sql).trim().split(/\s+/).slice(0, 4).join(' '));
    for (const table of ['tb_cases_raw', 'tb_cases', 'webhook_logs']) {
      if (String(sql).startsWith(`DELETE FROM ${table} `)) {
        assert.deepStrictEqual(params, [BATCH]);
        return {
          rowCount: counts[table],
          rows: table === 'webhook_logs' && counts[table]
            ? [{ source: 'pasig-clone', records_received: 15, records_imported: 12, received_at: '2026-09-01T00:00:00Z' }]
            : [],
        };
      }
    }
    if (String(sql).includes('INSERT INTO audit_logs')) {
      if (auditFails) throw new Error('audit write failed');
      auditRow = { sql: String(sql), params };
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  },
  release: () => { released += 1; },
};

const token = (role) => jwt.sign({ id: 1, username: 'tester', role }, SECRET);

function buildApp() {
  delete require.cache[MODULE_INTEGRATION];
  const app = express();
  app.use('/api/tb/integration', require('../tbinsight/integration'));
  return app;
}

describe('DELETE /api/tb/integration/batches/:batchId', () => {
  before(() => {
    savedSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = SECRET;
    require.cache[MODULE_DB] = {
      id: MODULE_DB, filename: MODULE_DB, loaded: true,
      exports: { query: async () => ({ rows: [] }), connect: async () => mockClient },
    };
    require.cache[MODULE_AGG] = {
      id: MODULE_AGG, filename: MODULE_AGG, loaded: true,
      exports: {
        rebuildAllAggregations: async (client) => {
          assert.strictEqual(client, mockClient, 'aggregates must rebuild inside the same transaction');
          calls.push('AGGREGATE');
          if (aggregateFails) throw new Error('boom');
        },
      },
    };
  });

  after(() => {
    delete require.cache[MODULE_DB];
    delete require.cache[MODULE_AGG];
    delete require.cache[MODULE_INTEGRATION];
    if (savedSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = savedSecret;
  });

  beforeEach(() => {
    calls = [];
    released = 0;
    aggregateFails = false;
    auditFails = false;
    auditRow = null;
    counts = { tb_cases: 12, tb_cases_raw: 15, webhook_logs: 1 };
  });

  it('requires authentication', async () => {
    const res = await request(buildApp()).delete(`/api/tb/integration/batches/${BATCH}`);
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(calls, []);
  });

  it('is admin only', async () => {
    const res = await request(buildApp())
      .delete(`/api/tb/integration/batches/${BATCH}`)
      .set('Authorization', `Bearer ${token('user')}`);
    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(calls, []);
  });

  it('rejects a malformed batch id without touching the database', async () => {
    const res = await request(buildApp())
      .delete('/api/tb/integration/batches/not-a-uuid')
      .set('Authorization', `Bearer ${token('admin')}`);
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(calls, []);
  });

  it('deletes cases, raw rows and log, rebuilds aggregates, then commits', async () => {
    const res = await request(buildApp())
      .delete(`/api/tb/integration/batches/${BATCH}`)
      .set('Authorization', `Bearer ${token('admin')}`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.deleted, { cases: 12, rawRows: 15, logs: 1 });
    assert.strictEqual(res.body.aggregatesRebuilt, true);
    assert.strictEqual(res.body.predictionsStale, true);
    assert.deepStrictEqual(calls, [
      'BEGIN',
      'DELETE FROM tb_cases WHERE',
      'DELETE FROM tb_cases_raw WHERE',
      'DELETE FROM webhook_logs WHERE',
      'AGGREGATE',
      'INSERT INTO audit_logs (user_id,',
      'COMMIT',
    ]);
    assert.strictEqual(released, 1);
  });

  it('records the undo in audit_logs with what was removed', async () => {
    await request(buildApp())
      .delete(`/api/tb/integration/batches/${BATCH}`)
      .set('Authorization', `Bearer ${token('admin')}`);
    assert.ok(auditRow, 'audit row should be written');
    const [userId, username, target, , details] = auditRow.params;
    assert.strictEqual(userId, 1);
    assert.strictEqual(username, 'tester');
    assert.strictEqual(target, BATCH);
    assert.deepStrictEqual(JSON.parse(details), {
      batchId: BATCH,
      source: 'pasig-clone',
      originalReceivedAt: '2026-09-01T00:00:00Z',
      recordsReceived: 15,
      recordsImported: 12,
      deleted: { cases: 12, rawRows: 15, logs: 1 },
    });
  });

  it('rolls back the deletion if the audit row cannot be written', async () => {
    auditFails = true;
    const res = await request(buildApp())
      .delete(`/api/tb/integration/batches/${BATCH}`)
      .set('Authorization', `Bearer ${token('admin')}`);
    assert.strictEqual(res.status, 500);
    assert.ok(calls.includes('ROLLBACK'));
    assert.ok(!calls.includes('COMMIT'));
  });

  it('returns 404 and rolls back when the batch has no data anywhere', async () => {
    counts = { tb_cases: 0, tb_cases_raw: 0, webhook_logs: 0 };
    const res = await request(buildApp())
      .delete(`/api/tb/integration/batches/${BATCH}`)
      .set('Authorization', `Bearer ${token('admin')}`);
    assert.strictEqual(res.status, 404);
    assert.ok(calls.includes('ROLLBACK'));
    assert.ok(!calls.includes('COMMIT') && !calls.includes('AGGREGATE'));
    assert.strictEqual(released, 1);
  });

  it('can remove a failed batch that only has a log entry', async () => {
    counts = { tb_cases: 0, tb_cases_raw: 0, webhook_logs: 1 };
    const res = await request(buildApp())
      .delete(`/api/tb/integration/batches/${BATCH}`)
      .set('Authorization', `Bearer ${token('admin')}`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.deleted, { cases: 0, rawRows: 0, logs: 1 });
  });

  it('rolls everything back if the aggregate rebuild fails', async () => {
    aggregateFails = true;
    const res = await request(buildApp())
      .delete(`/api/tb/integration/batches/${BATCH}`)
      .set('Authorization', `Bearer ${token('admin')}`);
    assert.strictEqual(res.status, 500);
    assert.match(res.body.error, /Nothing was deleted/);
    assert.ok(calls.includes('ROLLBACK'));
    assert.ok(!calls.includes('COMMIT'));
    assert.strictEqual(released, 1);
  });
});
