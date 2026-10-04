/**
 * Analysis results stay consistent with case data (tbinsight/caseDataLock.js).
 *  - a run requested while another is in progress is queued, not dropped
 *  - the case-data fingerprint changes when cases are added or removed
 * DB and ML client mocked. Run: node --test BACKEND/test/pipelineConsistency.test.js
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert');

let fingerprintRow = { n: '10', max_id: '10', sum_id: '55' };
const fakeQuery = async (sql) => (String(sql).includes('FROM tb_cases') && String(sql).includes('SUM(id)')
  ? { rows: [fingerprintRow] }
  : { rows: [] });

const MODULE_DB = require.resolve('../db');
require.cache[MODULE_DB] = {
  id: MODULE_DB, filename: MODULE_DB, loaded: true,
  exports: { query: fakeQuery, connect: async () => ({ query: fakeQuery, release: () => {} }), end: async () => {} },
};
const MODULE_ML = require.resolve('../tbinsight/mlClient');
require.cache[MODULE_ML] = {
  id: MODULE_ML, filename: MODULE_ML, loaded: true,
  exports: {
    healthCheck: async () => true, forecast: async () => ({ forecasts: [] }), classify: async () => ({ predictions: [] }),
    thresholds: async () => ({ low_max: 150, med_max: 350 }), evaluate: async () => ({}),
  },
};

const { runPipelineTracked, getPipelineRunStatus } = require('../tbinsight/pipeline');
const { caseDataFingerprint, lockCaseData, CASE_DATA_LOCK_KEY } = require('../tbinsight/caseDataLock');

after(() => {
  delete require.cache[MODULE_DB];
  delete require.cache[MODULE_ML];
});

describe('pipeline run queueing', () => {
  it('queues a run requested while one is running, and schedules it afterwards', async () => {
    const first = runPipelineTracked({}, 'undo:batch-1');
    const second = await runPipelineTracked({}, 'undo:batch-2'); // arrives mid-run
    assert.strictEqual(second, null, 'not run concurrently');
    await first;
    assert.strictEqual(getPipelineRunStatus().scheduled, true, 'a follow-up run was scheduled instead of being dropped');
  });
});

describe('caseDataLock', () => {
  it('fingerprint changes when cases are removed or replaced', async () => {
    const q = { query: fakeQuery };
    const before = await caseDataFingerprint(q);
    fingerprintRow = { n: '0', max_id: '0', sum_id: '0' };          // every batch deleted
    assert.notStrictEqual(await caseDataFingerprint(q), before);
    fingerprintRow = { n: '10', max_id: '20', sum_id: '155' };       // same count, re-imported
    assert.notStrictEqual(await caseDataFingerprint(q), before);
  });

  it('takes a transaction-scoped advisory lock on the shared key', async () => {
    const seen = [];
    await lockCaseData({ query: async (sql, params) => { seen.push([sql, params]); return { rows: [] }; } });
    assert.match(seen[0][0], /pg_advisory_xact_lock/);
    assert.deepStrictEqual(seen[0][1], [CASE_DATA_LOCK_KEY]);
  });
});
