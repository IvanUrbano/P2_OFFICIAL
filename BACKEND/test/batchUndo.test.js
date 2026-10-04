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
const MODULE_PIPELINE = require.resolve('../tbinsight/pipeline');

let remainingCases;  // tb_cases left after the undo (pool.query after commit)
let scheduled;       // schedulePipelineRun calls

let calls;          // ordered log of SQL text and aggregate invocations
let counts;         // rowCount returned per table
let releasedRows;   // rows returned by the duplicate-flag release UPDATE
let reflagParams;   // params passed to each re-flag UPDATE
let aggregateFails;
let auditFails;
let auditRow;
let released;
let savedSecret;

const mockClient = {
  query: async (sql, params) => {
    calls.push(String(sql).trim().split(/\s+/).slice(0, 4).join(' '));
    const text = String(sql);
    if (text.includes("SET duplicate_status = 'unique'")) {
      assert.deepStrictEqual(params, [BATCH]);
      return { rowCount: releasedRows.length, rows: releasedRows };
    }
    if (text.includes("SET duplicate_status = 'possible_duplicate'")) {
      reflagParams.push({ reason: text.includes('DSTB_FINGERPRINT') ? 'DSTB' : 'MN', params });
      return { rowCount: 1, rows: [{ id: 99 }] };
    }
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
      exports: { query: async () => ({ rows: [{ n: remainingCases }] }), connect: async () => mockClient },
    };
    require.cache[MODULE_PIPELINE] = {
      id: MODULE_PIPELINE, filename: MODULE_PIPELINE, loaded: true,
      exports: { schedulePipelineRun: (trigger) => { scheduled.push(trigger); } },
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
    delete require.cache[MODULE_PIPELINE];
    delete require.cache[MODULE_INTEGRATION];
    if (savedSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = savedSecret;
  });

  beforeEach(() => {
    calls = [];
    released = 0;
    aggregateFails = false;
    auditFails = false;
    auditRow = null;
    releasedRows = [];
    reflagParams = [];
    remainingCases = 0;
    scheduled = [];
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
    assert.deepStrictEqual(calls, [
      'BEGIN',
      'SELECT pg_advisory_xact_lock($1)', // serialized with the pipeline's result store
      'UPDATE tb_cases SET duplicate_status',
      'DELETE FROM tb_cases WHERE',
      'DELETE FROM tb_cases_raw WHERE',
      'DELETE FROM webhook_logs WHERE',
      'AGGREGATE',
      'DELETE FROM barangay_risk_scores',
      'DELETE FROM model_predictions',
      'DELETE FROM alerts',
      'INSERT INTO audit_logs (user_id,',
      'COMMIT',
    ]);
    assert.strictEqual(released, 1);
  });

  it('clears analysis results; re-runs the analysis only when cases remain', async () => {
    const res = await request(buildApp())
      .delete(`/api/tb/integration/batches/${BATCH}`)
      .set('Authorization', `Bearer ${token('admin')}`);
    assert.ok(res.body.modelResultsCleared, 'response reports cleared analysis results');
    assert.strictEqual(res.body.analysisRerunScheduled, false);
    assert.deepStrictEqual(scheduled, [], 'nothing left to analyse');

    remainingCases = 5000;
    const res2 = await request(buildApp())
      .delete(`/api/tb/integration/batches/${BATCH}`)
      .set('Authorization', `Bearer ${token('admin')}`);
    assert.strictEqual(res2.body.analysisRerunScheduled, true);
    assert.deepStrictEqual(scheduled, [`undo:${BATCH}`]);
  });

  it('keeps analysis results if the undo fails', async () => {
    aggregateFails = true;
    await request(buildApp())
      .delete(`/api/tb/integration/batches/${BATCH}`)
      .set('Authorization', `Bearer ${token('admin')}`);
    assert.ok(!calls.includes('DELETE FROM model_predictions'), 'never reached');
    assert.ok(calls.includes('ROLLBACK'));
    assert.deepStrictEqual(scheduled, []);
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
      duplicateFlags: { released: 0, reflagged: 0 },
    });
  });

  it('releases duplicate flags pointing into the batch, then re-flags those groups among remaining rows', async () => {
    releasedRows = [
      { source_type: 'DSTB', dstb_fingerprint: 'fp-a', itis_case_id: null },
      { source_type: 'DSTB', dstb_fingerprint: 'fp-a', itis_case_id: null },
      { source_type: 'MN', dstb_fingerprint: null, itis_case_id: 'ITIS-1' },
    ];
    const res = await request(buildApp())
      .delete(`/api/tb/integration/batches/${BATCH}`)
      .set('Authorization', `Bearer ${token('admin')}`);
    assert.strictEqual(res.status, 200);

    const order = calls.filter(c => c !== 'AGGREGATE');
    const releaseAt = order.indexOf('UPDATE tb_cases SET duplicate_status');
    const deleteAt = order.indexOf('DELETE FROM tb_cases WHERE');
    const reflagAt = order.lastIndexOf('UPDATE tb_cases t SET');
    assert.ok(releaseAt < deleteAt, 'flags must be released before the delete (FK)');
    assert.ok(deleteAt < reflagAt, 're-flag must run after the batch rows are gone');

    assert.deepStrictEqual(reflagParams, [
      { reason: 'DSTB', params: [['fp-a']] },
      { reason: 'MN', params: [['ITIS-1']] },
    ]);
    assert.deepStrictEqual(res.body.duplicateFlags, { released: 3, reflagged: 2 });
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
