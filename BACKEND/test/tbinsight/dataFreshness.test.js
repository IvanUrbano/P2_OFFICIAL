/**
 * TBInsight — Data Freshness Tests (GET /api/tb/data-freshness)
 *
 * The Dashboard header shows three DISTINCT timestamps that must never be
 * collapsed into one ambiguous "Last Updated":
 *
 *   MONITORING PERIOD — latest reporting period in the TB case data, derived
 *     on the frontend from the monthly trend (not this endpoint's job).
 *   LAST DATA SYNC    — most recent SUCCESSFUL transfer/import of TB data.
 *     Primary source: webhook_logs rows with status 'processed'. Fallback:
 *     MAX(tb_cases.imported_at), reported with syncSource 'import' so the UI
 *     can say it was a file import rather than a confirmed webhook sync.
 *   LAST MODEL RUN    — newest model_metadata row with run_type = 'pipeline'.
 *     A 'pipeline_historical' backfill must NOT replace it.
 *
 * webhook_logs.status is constrained to ('received','processed','failed'):
 * 'failed' is a failed attempt and 'received' means arrived-but-not-imported,
 * so neither counts as a successful data sync.
 *
 * Mock pool only — no database required.
 * Run: node --test BACKEND/test/tbinsight/dataFreshness.test.js
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-freshness-tests';

const MODULE_DB = require.resolve('../../db');
let handlers = {};

function installMockDb() {
  require.cache[MODULE_DB] = {
    id: MODULE_DB, filename: MODULE_DB, loaded: true,
    exports: {
      query: async (sql, params) => {
        const s = String(sql);
        // Route by the distinctive fragment of each freshness query.
        if (s.includes('webhook_logs')) return handlers.webhook(s, params);
        if (s.includes('MAX(imported_at)')) return handlers.imported(s, params);
        if (s.includes('model_metadata')) return handlers.model(s, params);
        if (s.includes('MAX(date_of_diagnosis)')) return handlers.cases(s, params);
        return { rows: [] };
      },
      connect: async () => {}, end: async () => {},
    },
  };
}

function uninstallMockDb() { delete require.cache[MODULE_DB]; }

function clearTbinsightCache() {
  Object.keys(require.cache)
    .filter((k) => k.includes('tbinsight') || k.includes('middleware/auth'))
    .forEach((k) => delete require.cache[k]);
}

/** Defaults: one successful webhook, an import, an operational pipeline run. */
const WEBHOOK_AT = '2026-09-27T08:09:51.908Z';
const IMPORT_AT = '2026-09-27T16:09:33.282Z';
const PIPELINE_AT = '2026-09-30T04:47:28.678Z';
const HISTORICAL_AT = '2026-09-30T05:01:29.134Z'; // NEWER than the pipeline run

function setHandlers(overrides = {}) {
  handlers = {
    webhook: async () => ({ rows: [{ last_received: WEBHOOK_AT }] }),
    imported: async () => ({ rows: [{ last_imported: IMPORT_AT }] }),
    model: async () => ({
      rows: [{
        trained_at: PIPELINE_AT, model_version: 'arima-v1.0-rf-v1.0',
        rf_status: 'success', arima_status: 'success', training_months: 36,
      }],
    }),
    cases: async () => ({ rows: [{ latest_case: '2025-12-29T16:00:00.000Z' }] }),
    ...overrides,
  };
}

function buildApp() {
  uninstallMockDb();
  installMockDb();
  clearTbinsightCache();
  const app = express();
  app.use(express.json());
  const token = jwt.sign({ id: 1, role: 'staff' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  app.use((req, _res, next) => { req.headers.authorization = `Bearer ${token}`; next(); });
  app.use('/api/tb', require('../../tbinsight/routes'));
  return app;
}

const get = () => request(buildApp()).get('/api/tb/data-freshness');

afterEach(() => uninstallMockDb());

// ==================== 28. SUCCESSFUL SYNC ====================

describe('Last Data Sync — successful webhook', () => {
  it('uses the newest processed webhook timestamp', async () => {
    setHandlers();
    const res = await get();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(new Date(res.body.lastSynced).toISOString(), new Date(WEBHOOK_AT).toISOString());
    assert.strictEqual(res.body.syncSource, 'webhook');
  });

  it('prefers the webhook timestamp over the import timestamp', async () => {
    // imported_at is NEWER here; a confirmed sync still wins, because the
    // import timestamp is only a fallback for when no sync is logged.
    setHandlers({ imported: async () => ({ rows: [{ last_imported: '2030-01-01T00:00:00.000Z' }] }) });
    const res = await get();
    assert.strictEqual(res.body.syncSource, 'webhook');
    assert.strictEqual(new Date(res.body.lastSynced).toISOString(), new Date(WEBHOOK_AT).toISOString());
  });

  it('queries only processed webhooks, excluding received and failed', async () => {
    let capturedSql = '';
    setHandlers({
      webhook: async (sql) => { capturedSql = sql; return { rows: [{ last_received: WEBHOOK_AT }] }; },
    });
    await get();
    assert.match(capturedSql, /status\s*=\s*'processed'/);
    assert.ok(!/'received'/.test(capturedSql), "must not count 'received' as a successful sync");
    assert.ok(!/'failed'/.test(capturedSql), "must not count 'failed' as a successful sync");
  });
});

// ==================== 29. FAILED WEBHOOK ====================

describe('Last Data Sync — failed webhook', () => {
  it('does not use a failed attempt, falling back to the import timestamp', async () => {
    // The SQL filters to 'processed', so a database holding only failed rows
    // yields NULL here — exactly what a failed-only history produces.
    setHandlers({ webhook: async () => ({ rows: [{ last_received: null }] }) });
    const res = await get();
    assert.strictEqual(res.body.syncSource, 'import');
    assert.strictEqual(new Date(res.body.lastSynced).toISOString(), new Date(IMPORT_AT).toISOString());
  });

  it('does not report a sync at all when a failed webhook is the only event and nothing was imported', async () => {
    setHandlers({
      webhook: async () => ({ rows: [{ last_received: null }] }),
      imported: async () => ({ rows: [{ last_imported: null }] }),
    });
    const res = await get();
    assert.strictEqual(res.body.lastSynced, null);
    assert.strictEqual(res.body.syncSource, null);
  });
});

// ==================== 30. IMPORT FALLBACK ====================

describe('Last Data Sync — import fallback', () => {
  it('falls back to MAX(tb_cases.imported_at) and labels the source', async () => {
    setHandlers({ webhook: async () => ({ rows: [{ last_received: null }] }) });
    const res = await get();
    assert.strictEqual(new Date(res.body.lastSynced).toISOString(), new Date(IMPORT_AT).toISOString());
    assert.strictEqual(res.body.syncSource, 'import',
      'the UI must be able to say this was a file import, not a webhook sync');
  });

  it('degrades to null rather than guessing when the webhook query fails', async () => {
    setHandlers({ webhook: async () => { throw new Error('db down'); } });
    const res = await get();
    assert.strictEqual(res.status, 200, 'one failing sub-query must not 500 the endpoint');
    assert.strictEqual(res.body.syncSource, 'import');
  });
});

// ==================== 31 & 32. LAST MODEL RUN ====================

describe('Last Model Run', () => {
  it('uses the newest operational pipeline run', async () => {
    setHandlers();
    const res = await get();
    assert.strictEqual(new Date(res.body.lastModelRun).toISOString(), new Date(PIPELINE_AT).toISOString());
    assert.strictEqual(res.body.modelRfStatus, 'success');
    assert.strictEqual(res.body.modelArimaStatus, 'success');
  });

  it("queries run_type = 'pipeline', so a historical backfill cannot replace it", async () => {
    let capturedSql = '';
    let capturedParams = null;
    setHandlers({
      model: async (sql, params) => {
        capturedSql = sql;
        capturedParams = params;
        // A newer pipeline_historical row exists in the table; it must not be
        // the one selected, which the WHERE clause is what guarantees.
        return { rows: [{ trained_at: PIPELINE_AT, model_version: 'v', rf_status: 'success', arima_status: 'success', training_months: 36 }] };
      },
    });
    const res = await get();
    assert.match(capturedSql, /run_type\s*=\s*'pipeline'/);
    assert.ok(!/pipeline_historical/.test(capturedSql), 'must not select a historical backfill');
    assert.strictEqual(capturedParams, undefined);
    assert.notStrictEqual(new Date(res.body.lastModelRun).toISOString(), new Date(HISTORICAL_AT).toISOString());
  });

  it('reports null when no pipeline run exists', async () => {
    setHandlers({ model: async () => ({ rows: [] }) });
    const res = await get();
    assert.strictEqual(res.body.lastModelRun, null);
  });
});

// ==================== SEPARATION OF CONCEPTS ====================

describe('the three freshness concepts stay independent', () => {
  it('Last Data Sync and Last Model Run are different fields with different values', async () => {
    setHandlers();
    const res = await get();
    assert.ok(res.body.lastSynced, 'lastSynced present');
    assert.ok(res.body.lastModelRun, 'lastModelRun present');
    assert.notStrictEqual(
      new Date(res.body.lastSynced).toISOString(),
      new Date(res.body.lastModelRun).toISOString(),
      'a model run must not be reported as a data sync'
    );
  });

  it('exposes the latest case date separately, never as a freshness timestamp', async () => {
    setHandlers();
    const res = await get();
    // A clinical coverage date — it must not be reused as lastSynced.
    assert.ok(res.body.latestCaseDate);
    assert.notStrictEqual(
      new Date(res.body.latestCaseDate).toISOString(),
      new Date(res.body.lastSynced).toISOString()
    );
  });

  it('names the data source as PASIG TB-IS', async () => {
    setHandlers();
    const res = await get();
    assert.strictEqual(res.body.dataSource, 'PASIG TB-IS');
  });
});

// ==================== 33. READ-ONLY ====================

describe('refresh behaviour', () => {
  it('is read-only — repeated calls issue no writes and change no timestamp', async () => {
    const statements = [];
    setHandlers({
      webhook: async (sql) => { statements.push(sql); return { rows: [{ last_received: WEBHOOK_AT }] }; },
      imported: async (sql) => { statements.push(sql); return { rows: [{ last_imported: IMPORT_AT }] }; },
      model: async (sql) => {
        statements.push(sql);
        return { rows: [{ trained_at: PIPELINE_AT, model_version: 'v', rf_status: 'success', arima_status: 'success', training_months: 36 }] };
      },
      cases: async (sql) => { statements.push(sql); return { rows: [{ latest_case: '2025-12-29' }] }; },
    });

    const app = buildApp();
    const first = await request(app).get('/api/tb/data-freshness');
    const second = await request(app).get('/api/tb/data-freshness');

    // Refreshing the Dashboard must not move either timestamp.
    assert.strictEqual(first.body.lastSynced, second.body.lastSynced);
    assert.strictEqual(first.body.lastModelRun, second.body.lastModelRun);

    assert.ok(statements.length > 0);
    for (const sql of statements) {
      assert.ok(/^\s*SELECT/i.test(sql.trim()), `expected a read, got: ${sql.trim().slice(0, 50)}`);
      assert.ok(
        !/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP)\b/i.test(sql),
        'the freshness endpoint must never write'
      );
    }
  });
});
