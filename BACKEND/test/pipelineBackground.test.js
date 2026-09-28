/**
 * Background Pipeline Run Tests
 *
 * Covers the auto-trigger machinery added to tbinsight/pipeline.js:
 *   - runPipelineInBackground: single-flight state machine, run counters
 *   - schedulePipelineRun: debounce collapsing sync bursts into one run
 *   - getPipelineRunStatus: shape consumed by GET /pipeline/status + GIS banner
 *
 * DB pool and ML client are mocked BEFORE pipeline.js loads, so no network
 * calls are made and a run deterministically finishes with status 'no_data'
 * (mocked barangays query returns zero rows).
 * Run: node --test BACKEND/test/pipelineBackground.test.js
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert');

/* ─── Mock DB pool (installed before pipeline is required) ─── */
const MODULE_DB = require.resolve('../db');
require.cache[MODULE_DB] = {
  id: MODULE_DB, filename: MODULE_DB, loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release: () => {},
    }),
    end: async () => {},
  },
};

/* ─── Mock ML client — no calls to the Python service ─── */
const MODULE_ML = require.resolve('../tbinsight/mlClient');
require.cache[MODULE_ML] = {
  id: MODULE_ML, filename: MODULE_ML, loaded: true,
  exports: {
    healthCheck: async () => true,
    forecast: async () => ({ forecasts: [] }),
    classify: async () => ({ predictions: [] }),
    thresholds: async () => ({ low_max: 150.0, med_max: 350.0 }),
    evaluate: async () => ({}),
  },
};

const {
  runPipelineTracked,
  runPipelineInBackground,
  schedulePipelineRun,
  getPipelineRunStatus,
} = require('../tbinsight/pipeline');

after(() => {
  delete require.cache[MODULE_DB];
  delete require.cache[MODULE_ML];
});

describe('background pipeline run state machine', () => {
  it('exposes idle status before any run', () => {
    const s = getPipelineRunStatus();
    assert.strictEqual(s.running, false);
    assert.strictEqual(s.runsCompleted, 0);
    assert.strictEqual(s.runsFinished, 0);
    assert.strictEqual(s.scheduled, false);
    assert.strictEqual(s.lastError, null);
    assert.strictEqual(s.trigger, null);
    assert.strictEqual(s.lastRunStatus, null);
    assert.strictEqual(s.lastRiskScoresCount, null);
    assert.strictEqual(s.lastAlertsCount, null);
  });

  it('runs a background pipeline to completion and updates state', async () => {
    const before = getPipelineRunStatus();
    const result = await runPipelineInBackground('test-trigger');
    const s = getPipelineRunStatus();

    // Mocked reference data is empty → normal 'no_data' outcome, not an error
    assert.ok(result);
    assert.strictEqual(result.status, 'no_data');
    assert.strictEqual(s.running, false);
    assert.strictEqual(s.runsCompleted, before.runsCompleted + 1);
    assert.strictEqual(s.runsFinished, before.runsFinished + 1);
    assert.strictEqual(s.lastTrigger, 'test-trigger');
    assert.strictEqual(s.lastError, null);
    // Outcome exposed for the GIS banner (insufficient-data state)
    assert.strictEqual(s.lastRunStatus, 'no_data');
    assert.strictEqual(s.lastRiskScoresCount, 0);
    assert.ok(s.startedAt);
    assert.ok(s.finishedAt);
    assert.strictEqual(typeof s.lastDurationMs, 'number');
  });

  it('records manual-route runs through the same tracked runner', async () => {
    const before = getPipelineRunStatus();
    const result = await runPipelineTracked({ forecastHorizon: 1 }, 'manual');
    assert.ok(result);
    const s = getPipelineRunStatus();
    assert.strictEqual(s.lastTrigger, 'manual');
    assert.strictEqual(s.lastRunStatus, 'no_data');
    assert.strictEqual(s.runsCompleted, before.runsCompleted + 1);
    assert.strictEqual(s.running, false);
  });

  it('skips a second trigger while a run is in progress', async () => {
    const before = getPipelineRunStatus().runsFinished;

    const p1 = runPipelineInBackground('first');
    const p2 = runPipelineInBackground('second'); // overlaps synchronously
    const r2 = await p2;
    assert.strictEqual(r2, null); // rejected while running

    const r1 = await p1;
    assert.ok(r1);

    const s = getPipelineRunStatus();
    assert.strictEqual(s.runsFinished, before + 1);
    assert.strictEqual(s.lastTrigger, 'first');
    assert.strictEqual(s.running, false);
  });

  it('records failures in lastError without incrementing runsCompleted', async () => {
    const before = getPipelineRunStatus();

    // Break the DB mock so the run throws
    const db = require.cache[MODULE_DB];
    const origConnect = db.exports.connect;
    db.exports.connect = async () => { throw new Error('boom'); };

    try {
      const result = await runPipelineInBackground('failing-trigger');
      assert.strictEqual(result, null);

      const s = getPipelineRunStatus();
      assert.strictEqual(s.running, false);
      assert.strictEqual(s.lastError, 'boom');
      assert.strictEqual(s.lastRunStatus, 'error'); // banner "Failed" state
      assert.strictEqual(s.runsCompleted, before.runsCompleted); // unchanged
      assert.strictEqual(s.runsFinished, before.runsFinished + 1);
      assert.strictEqual(s.lastTrigger, before.lastTrigger); // only set on success
    } finally {
      db.exports.connect = origConnect;
    }
  });

  it('collapses rapid schedule calls into one run', async () => {
    const before = getPipelineRunStatus().runsFinished;

    schedulePipelineRun('debounce-a', 20);
    schedulePipelineRun('debounce-b', 20); // re-arms the same timer
    await new Promise((resolve) => setTimeout(resolve, 200));

    const s = getPipelineRunStatus();
    assert.strictEqual(s.runsFinished, before + 1); // exactly one run fired
    assert.strictEqual(s.running, false);
    assert.strictEqual(s.lastTrigger, 'debounce-b'); // last arming wins
    assert.strictEqual(s.scheduled, false); // timer consumed
  });
});
