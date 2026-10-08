/**
 * Webhook Endpoint Tests
 *
 * Tests POST /api/webhook/pasig-clone with HMAC verification.
 * Database pool is mocked (same pattern as auth.test.js).
 * Run: node --test BACKEND/test/webhook.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const TEST_SECRET = 'test-webhook-secret';

/* ─── Mock pool ─── */
const MODULE_DB = require.resolve('../db');
let mockQueryFn;
let mockConnectFn;
// Result of the batch claim (INSERT ... ON CONFLICT into webhook_logs). Claimed by
// default; a test simulating a duplicate / in-flight batch sets it to { rows: [] }.
let mockClaimResult;
const claimLogUpdates = [];

const isClaimSql = (sql) => sql.includes('INSERT INTO webhook_logs') && sql.includes('ON CONFLICT');

function installMockDb() {
  require.cache[MODULE_DB] = {
    id: MODULE_DB, filename: MODULE_DB, loaded: true,
    exports: {
      get query() {
        const fn = mockQueryFn || (async () => ({ rows: [] }));
        return async (sql, params) => {
          if (isClaimSql(sql)) return mockClaimResult || { rows: [{ id: 42 }] };
          if (sql.includes('UPDATE webhook_logs')) claimLogUpdates.push({ sql, params });
          return fn(sql, params);
        };
      },
      get connect() { return mockConnectFn || (async () => ({
        query: async () => ({ rows: [] }),
        release: () => {},
      })); },
      end: async () => {},
    },
  };
}

function uninstallMockDb() {
  delete require.cache[MODULE_DB];
}

/* ─── Mock aggregateMonthly ─── */
const MODULE_AGG = require.resolve('../tbinsight/aggregateMonthly');

function installMockAgg() {
  require.cache[MODULE_AGG] = {
    id: MODULE_AGG, filename: MODULE_AGG, loaded: true,
    exports: {
      rebuildAggregations: async () => {},
      rebuildAllAggregations: async () => {},
    },
  };
}

function uninstallMockAgg() {
  delete require.cache[MODULE_AGG];
}

/* ─── Mock pipeline module (auto-run trigger after successful import) ─── */
const MODULE_PIPELINE = require.resolve('../tbinsight/pipeline');
const mockScheduleCalls = [];

function installMockPipeline() {
  require.cache[MODULE_PIPELINE] = {
    id: MODULE_PIPELINE, filename: MODULE_PIPELINE, loaded: true,
    exports: {
      schedulePipelineRun: (trigger, delayMs) => { mockScheduleCalls.push({ trigger, delayMs }); },
      runPipelineInBackground: async () => null,
      getPipelineRunStatus: () => ({ running: false }),
      runPipeline: async () => ({}),
    },
  };
}

function uninstallMockPipeline() {
  delete require.cache[MODULE_PIPELINE];
}

/* ─── Clear module cache for webhook and its deps ─── */
function clearWebhookCache() {
  Object.keys(require.cache)
    .filter(k =>
      k.includes('tbinsight/webhook') ||
      k.includes('tbinsight/parseCaseFile') ||
      k.includes('tbinsight/aggregateMonthly')
    )
    .forEach(k => delete require.cache[k]);
}

/* ─── Raw body capture (mirrors server.js: the HMAC is verified over the raw request body) ─── */
const RAW_BODY_CAPTURE = {
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
};

/* ─── Helper: generate HMAC signature ─── */
function generateSignature(payload) {
  const signature = crypto
    .createHmac('sha256', TEST_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
  return `sha256=${signature}`;
}

/* ─── Helper: build valid payload ─── */
function buildPayload(overrides = {}) {
  return {
    schema_version: '1.0',
    source: 'pasig-clone',
    batch_id: '550e8400-e29b-41d4-a716-446655440000',
    timestamp: new Date().toISOString(),
    sheets: [
      {
        sheet_name: 'DSTB',
        source_type: 'DSTB',
        record_count: 1,
        records: [
          {
            barangay_name: 'San Antonio',
            date_of_diagnosis: '2025-02-06',
            sex: 'Male',
            age: 31,
            source_type: 'DSTB',
          },
        ],
      },
    ],
    ...overrides,
  };
}

/* ─── Tests ─── */
describe('Webhook Endpoint', () => {
  let savedEnv;

  before(() => {
    savedEnv = process.env.WEBHOOK_SECRET;
    process.env.WEBHOOK_SECRET = TEST_SECRET;
    installMockDb();
    installMockAgg();
    installMockPipeline();
  });

  beforeEach(() => {
    mockClaimResult = undefined;
    claimLogUpdates.length = 0;
  });

  after(() => {
    uninstallMockDb();
    uninstallMockAgg();
    uninstallMockPipeline();
    clearWebhookCache();
    if (savedEnv !== undefined) {
      process.env.WEBHOOK_SECRET = savedEnv;
    } else {
      delete process.env.WEBHOOK_SECRET;
    }
  });

  it('rejects request without signature headers', async () => {
    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .send(buildPayload());

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Missing X-Webhook-Signature header');
  });

  it('rejects request with wrong signature', async () => {
    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload();
    const wrongSignature = crypto
      .createHmac('sha256', 'wrong-secret')
      .update(JSON.stringify(payload))
      .digest('hex');

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', `sha256=${wrongSignature}`)
      .send(payload);

    assert.equal(res.status, 401);
  });

  it('rejects invalid payload structure', async () => {
    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = { schema_version: '1.0', source: 'pasig-clone', sheets: 'not-an-array' };
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid payload structure');
  });

  it('rejects payload with wrong source', async () => {
    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload({ source: 'unknown' });
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 400);
  });

  it('processes valid payload with correct signature', async () => {
    // Mock: barangays query returns valid list, insert succeeds
    let insertedBarangayId = null;
    mockQueryFn = async (sql, params) => {
      if (sql.includes('SELECT id, name FROM barangays')) {
        return { rows: [{ id: 11, name: 'San Antonio' }] };
      }
      if (sql.includes('INSERT INTO tb_cases')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO webhook_logs')) {
        return { rows: [] };
      }
      return { rows: [] };
    };

    // Mock transaction client
    mockConnectFn = async () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO tb_cases')) {
          insertedBarangayId = params[1];
          return { rows: [{ id: 1, dstb_fingerprint: null, itis_case_id: null, source_type: 'DSTB' }] };
        }
        return { rows: [] };
      },
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload();
    payload.sheets[0].records[0].barangay_id = 11;
    const schedBefore = mockScheduleCalls.length;
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.importedCount, 1);
    assert.equal(res.body.errorCount, 0);
    assert.equal(insertedBarangayId, 11);
    // Successful import triggers exactly one debounced background pipeline run
    assert.equal(mockScheduleCalls.length, schedBefore + 1);
    assert.ok(mockScheduleCalls[schedBefore].trigger.startsWith('webhook:'));
    assert.equal(mockScheduleCalls[schedBefore].delayMs, 5000);
  });

  it('returns errors for invalid records', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) {
        return { rows: [{ name: 'san antonio' }] };
      }
      return { rows: [] };
    };

    mockConnectFn = async () => ({
      query: async () => ({ rows: [] }),
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    // Record with missing required fields
    const payload = buildPayload({
      sheets: [
        {
          sheet_name: 'DSTB',
          source_type: 'DSTB',
          record_count: 1,
          records: [
            {
              barangay_name: '',
              date_of_diagnosis: null,
              sex: '',
              source_type: 'DSTB',
            },
          ],
        },
      ],
    });

    const schedBeforeInvalid = mockScheduleCalls.length;
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.importedCount, 0);
    assert.equal(res.body.errorCount, 1);
    assert.ok(res.body.errors.length > 0);
    // Nothing imported → no pipeline trigger
    assert.equal(mockScheduleCalls.length, schedBeforeInvalid);
  });

  it('lists every rejected record with the sender\'s Case ID and record id', async () => {
    mockQueryFn = async (sql) => (sql.includes('SELECT id, name FROM barangays')
      ? { rows: [{ id: 11, name: 'San Antonio' }] }
      : { rows: [] });
    mockConnectFn = async () => ({ query: async () => ({ rows: [] }), release: () => {} });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const bad = (i) => ({ barangay_name: 'San Antonio', date_of_diagnosis: null, sex: 'Male', case_no: `C-${i}`, record_id: 100 + i });
    const payload = buildPayload({
      sheets: [{
        sheet_name: 'DSTB', source_type: 'DSTB', record_count: 12,
        records: [
          ...Array.from({ length: 11 }, (_, i) => bad(i)),
          { barangay_name: 'Nowhere', date_of_diagnosis: '2025-01-01', sex: 'Male', case_no: 'C-X', record_id: 'not-a-number' },
        ],
      }],
    });
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.errorCount, 12);
    assert.equal(res.body.errors.length, 10, 'the old 10-item sample is unchanged');
    assert.equal(res.body.rejected.length, 12, 'every rejection is listed');
    assert.deepEqual(
      { case_no: res.body.rejected[0].case_no, record_id: res.body.rejected[0].record_id },
      { case_no: 'C-0', record_id: 100 }
    );
    assert.ok(res.body.rejected[0].errors.some(e => /Date of Diagnosis/.test(e)));
    const unknown = res.body.rejected[11];
    assert.equal(unknown.case_no, 'C-X');
    assert.equal(unknown.record_id, null, 'a non-numeric record id is not echoed back');
  });

  it('returns success for duplicate webhook (idempotent)', async () => {
    // Mock: batch already processed in webhook_logs, so the claim is refused
    mockClaimResult = { rows: [] };
    mockQueryFn = async (sql, params) => {
      if (sql.includes('SELECT id, name FROM barangays')) {
        return { rows: [{ name: 'san antonio' }] };
      }
      if (sql.includes("FROM webhook_logs WHERE batch_id")) {
        return { rows: [{ id: 1, status: 'processed' }] }; // Already processed
      }
      return { rows: [] };
    };

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload();
    const schedBefore = mockScheduleCalls.length;
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.message.includes('already processed'));
    // Duplicate batch must NOT trigger another pipeline run
    assert.equal(mockScheduleCalls.length, schedBefore);
  });

  // ══════════════════════════════════════════════════════════════
  //  NEW TESTS — comprehensive webhook coverage
  // ══════════════════════════════════════════════════════════════

  it('accepts request with valid signature (no secret header needed)', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) {
        return { rows: [{ name: 'san antonio' }] };
      }
      if (sql.includes("SELECT id FROM webhook_logs WHERE batch_id")) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO webhook_logs')) {
        return { rows: [] };
      }
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async () => ({ rows: [] }),
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload();
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      // X-Webhook-Secret header intentionally omitted — not needed
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  it('rejects payload with invalid batch_id (non-UUID)', async () => {
    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload({ batch_id: 'abc123' });
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('batch_id'));
  });

  it('rejects payload with missing batch_id', async () => {
    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload();
    delete payload.batch_id;
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('batch_id'));
  });

  it('rejects payload with invalid schema_version', async () => {
    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload({ schema_version: '2.0' });
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('schema_version') || res.body.error.includes('version'));
  });

  it('rejects sheet with unknown source_type', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) {
        return { rows: [{ name: 'san antonio' }] };
      }
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async () => ({ rows: [] }),
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload({
      sheets: [{
        sheet_name: 'Unknown',
        source_type: 'UNKNOWN',
        record_count: 0,
        records: [],
      }],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('source_type'));
  });

  it('accepts MANUAL sheet with a valid record', async () => {
    mockQueryFn = async (sql, params) => {
      if (sql.includes('SELECT id, name FROM barangays')) {
        return { rows: [{ name: 'san antonio' }] };
      }
      if (sql.includes('INSERT INTO tb_cases')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO webhook_logs')) {
        return { rows: [] };
      }
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async (sql) => {
        if (sql.includes('INSERT INTO tb_cases')) {
          return { rows: [{ id: 1, dstb_fingerprint: null, itis_case_id: null, source_type: 'MANUAL' }] };
        }
        return { rows: [] };
      },
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload({
      sheets: [
        {
          sheet_name: 'MANUAL',
          source_type: 'MANUAL',
          record_count: 1,
          records: [
            {
              barangay_name: 'San Antonio',
              date_of_diagnosis: '2025-03-01',
              sex: 'Male',
              age: 28,
              source_type: 'MANUAL',
            },
          ],
        },
      ],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.importedCount, 1);
    assert.equal(res.body.errorCount, 0);
  });

  it('accepts MANUAL sheet with zero records', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) {
        return { rows: [{ name: 'san antonio' }] };
      }
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async () => ({ rows: [] }),
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload({
      sheets: [
        {
          sheet_name: 'MANUAL',
          source_type: 'MANUAL',
          record_count: 0,
          records: [],
        },
      ],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.importedCount, 0);
    assert.equal(res.body.errorCount, 0);
  });

  it('rejects payload with record_count mismatch', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) {
        return { rows: [{ name: 'san antonio' }] };
      }
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async () => ({ rows: [] }),
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload({
      sheets: [{
        sheet_name: 'DSTB',
        source_type: 'DSTB',
        record_count: 2,  // says 2
        records: [{ barangay_name: 'San Antonio', date_of_diagnosis: '2025-01-01', sex: 'Male', source_type: 'DSTB' }], // only 1
      }],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('record_count'));
  });

  it('rejects a Non-Pasig residence that no admin has confirmed', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) {
        return { rows: [{ name: 'santa cruz' }] };
      }
      if (sql.includes('INSERT INTO webhook_logs')) {
        return { rows: [] };
      }
      return { rows: [] };
    };

    mockConnectFn = async () => ({
      query: async (sql) => {
        if (sql.includes('INSERT INTO tb_cases')) {
          throw new Error('a rejected record must never reach the insert');
        }
        return { rows: [] };
      },
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload({
      sheets: [{
        sheet_name: 'DSTB',
        source_type: 'DSTB',
        record_count: 1,
        records: [{
          barangay_name: 'Santa Cruz',
          city: 'Manila',
          date_of_diagnosis: '2025-03-15',
          sex: 'Female',
          age: 45,
          source_type: 'DSTB',
        }],
      }],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.importedCount, 0);
    assert.equal(res.body.errorCount, 1);
    assert.match(res.body.rejected[0].errors[0], /Validation -> Needs Assignment/);
  });

  it('imports a confirmed Non-Pasig resident treated at a Pasig facility', async () => {
    let insertedRow = null;
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) {
        return { rows: [{ name: 'santa cruz' }] };
      }
      if (sql.includes('FROM health_facilities')) {
        return { rows: [{ id: 7 }] };
      }
      if (sql.includes('INSERT INTO webhook_logs')) {
        return { rows: [] };
      }
      return { rows: [] };
    };

    mockConnectFn = async () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO tb_cases')) {
          insertedRow = params;
          return { rows: [{ id: 1, dstb_fingerprint: null, itis_case_id: null, source_type: 'DSTB' }] };
        }
        return { rows: [] };
      },
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload({
      sheets: [{
        sheet_name: 'DSTB',
        source_type: 'DSTB',
        record_count: 1,
        records: [{
          barangay_name: 'Santa Cruz',
          city: 'Manila',
          date_of_diagnosis: '2025-03-15',
          sex: 'Female',
          age: 45,
          source_type: 'DSTB',
          treatment_facility: 'Pasig City Health Center',
          treatment_facility_id: 7,
          location_resolution: 'outside_pasig',
        }],
      }],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.importedCount, 1);
    assert.equal(insertedRow[19], 'Non-Pasig Resident');
    // Never stamped with a Pasig barangay — barangay_id, barangay_name stay NULL
    assert.equal(insertedRow[1], null);
    assert.equal(insertedRow[7], null);
    // Residence is kept as the source wrote it, in its own free-text columns
    // (index 34 is source_case_id — the Case ID users see)
    assert.equal(insertedRow[35], 'Santa Cruz');
    assert.equal(insertedRow[36], 'Manila');
  });

  it('rejects a confirmed Non-Pasig resident whose treatment facility is not Pasig', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) {
        return { rows: [{ name: 'santa cruz' }] };
      }
      if (sql.includes('FROM health_facilities')) {
        return { rows: [{ id: 7 }] };
      }
      if (sql.includes('INSERT INTO webhook_logs')) {
        return { rows: [] };
      }
      return { rows: [] };
    };

    mockConnectFn = async () => ({
      query: async (sql) => {
        if (sql.includes('INSERT INTO tb_cases')) {
          throw new Error('a non-Pasig facility must never admit this record');
        }
        return { rows: [] };
      },
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload({
      sheets: [{
        sheet_name: 'DSTB',
        source_type: 'DSTB',
        record_count: 1,
        records: [{
          barangay_name: 'Santa Cruz',
          city: 'Manila',
          date_of_diagnosis: '2025-03-15',
          sex: 'Female',
          age: 45,
          source_type: 'DSTB',
          treatment_facility: 'Manila Health Center',
          treatment_facility_id: 999,
          location_resolution: 'outside_pasig',
        }],
      }],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.importedCount, 0);
    assert.equal(res.body.errorCount, 1);
    assert.match(res.body.rejected[0].errors[0], /not a Pasig health facility/);
  });

  it('rejects Pasig record with invalid barangay', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) {
        return { rows: [{ name: 'san antonio' }, { name: 'bagong ilog' }] };
      }
      return { rows: [] };
    };

    mockConnectFn = async () => ({
      query: async () => ({ rows: [] }),
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload({
      sheets: [{
        sheet_name: 'DSTB',
        source_type: 'DSTB',
        record_count: 1,
        records: [{
          barangay_name: 'Nonexistent Barangay',
          city: 'Pasig',
          date_of_diagnosis: '2025-04-10',
          sex: 'Male',
          age: 28,
          source_type: 'DSTB',
        }],
      }],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.importedCount, 0);
    assert.equal(res.body.errorCount, 1);
  });

  it('ignores the ITIS field of MN records: it is never stored', async () => {
    let insertSql = '';
    let insertParams = [];
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) {
        return { rows: [{ name: 'caniogan' }] };
      }
      return { rows: [] };
    };

    mockConnectFn = async () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO tb_cases')) {
          insertSql = sql;
          insertParams = params;
          return { rows: [{ id: 1, dstb_fingerprint: null, source_type: 'MN' }] };
        }
        return { rows: [] };
      },
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload({
      sheets: [{
        sheet_name: 'MN',
        source_type: 'MN',
        record_count: 1,
        records: [{
          barangay_name: 'Caniogan',
          date_of_diagnosis: '2025-05-20',
          sex: 'Male',
          age: 55,
          itis_case_id: 'ITIS-2025-001',
          source_type: 'MN',
        }],
      }],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.importedCount, 1);
    assert.ok(!insertSql.includes('itis_case_id'), 'no ITIS column is written');
    assert.ok(!insertParams.includes('ITIS-2025-001'), 'the ITIS number is not stored');
  });

  it('parses various date formats in records', async () => {
    let insertedDates = {};
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) {
        return { rows: [{ name: 'san antonio' }] };
      }
      if (sql.includes('INSERT INTO webhook_logs')) {
        return { rows: [] };
      }
      return { rows: [] };
    };

    mockConnectFn = async () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO tb_cases')) {
          insertedDates = {
            diagnosis: params[2],
            screening: params[3],
            notification: params[4],
          };
          return { rows: [{ id: 1, dstb_fingerprint: null, itis_case_id: null, source_type: 'DSTB' }] };
        }
        return { rows: [] };
      },
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload({
      sheets: [{
        sheet_name: 'DSTB',
        source_type: 'DSTB',
        record_count: 1,
        records: [{
          barangay_name: 'San Antonio',
          date_of_diagnosis: '2025-06-15',
          date_of_screening: '06/01/2025',
          date_of_notification: '2025-06-10',
          sex: 'Female',
          age: 40,
          source_type: 'DSTB',
        }],
      }],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.importedCount, 1);
    assert.ok(insertedDates.diagnosis, 'date_of_diagnosis should be parsed');
  });

  it('returns 500 when DB insert fails during import', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) {
        return { rows: [{ name: 'san antonio' }] };
      }
      if (sql.includes('INSERT INTO webhook_logs')) {
        return { rows: [] };
      }
      return { rows: [] };
    };

    mockConnectFn = async () => ({
      query: async (sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return {};
        if (sql.includes('INSERT INTO tb_cases')) {
          throw new Error('DB insert failed');
        }
        return {};
      },
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload();
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'Webhook processing failed');
  });

  // ══════════════════════════════════════════════════════════════
  //  Duplicate detection — DSTB fingerprint
  //  (detection-only: never reject, never merge, never delete)
  // ══════════════════════════════════════════════════════════════

  it('TEST A — MN records that share an ITIS number are NOT flagged: the ITIS number is ignored', async () => {
    let collisionQueries = 0;
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) return { rows: [{ name: 'san antonio' }] };
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
        if (sql.includes('INSERT INTO tb_cases')) {
          return { rows: [{ id: 9001, dstb_fingerprint: null, source_type: 'MN' }] };
        }
        if (sql.includes('MN_ITIS_ID_COLLISION')) collisionQueries++;
        return { rows: [] };
      },
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload({
      sheets: [{
        sheet_name: 'MN', source_type: 'MN', record_count: 1,
        records: [{
          barangay_name: 'San Antonio', date_of_diagnosis: '2025-07-01',
          sex: 'Female', age: 19, itis_case_id: 'ITIS-COLLIDE-1', source_type: 'MN',
        }],
      }],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.importedCount, 1, 'the record is inserted, never rejected');
    assert.equal(res.body.possibleDuplicatesFlagged, 0);
    assert.equal(res.body.mnCollisionsFlagged, undefined, 'there is no MN/ITIS collision signal any more');
    assert.equal(collisionQueries, 0, 'no ITIS collision query runs');
  });

  it('TEST D — DSTB fingerprint matches an earlier row: flagged as possible duplicate, record preserved', async () => {
    let dstbFlagParams = null;
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) return { rows: [{ name: 'san antonio' }] };
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async (sql, params) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
        if (sql.includes('INSERT INTO tb_cases')) {
          const fp = params[30]; // dstb_fingerprint follows outcome_reason
          return { rows: [{ id: 9004, dstb_fingerprint: fp, itis_case_id: null, source_type: 'DSTB' }] };
        }
        if (sql.includes('DSTB_FINGERPRINT_COLLISION')) {
          dstbFlagParams = params;
          return { rows: [{ id: 9004 }] };
        }
        return { rows: [] };
      },
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const payload = buildPayload({
      sheets: [{
        sheet_name: 'DSTB', source_type: 'DSTB', record_count: 1,
        records: [{
          barangay_name: 'San Antonio', date_of_diagnosis: '2025-07-05',
          sex: 'Male', age: 41, anatomical_site: 'Pulmonary',
          registration_group: 'New', source_type: 'DSTB',
        }],
      }],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.importedCount, 1, 'a fingerprint match must never block the insert');
    assert.equal(res.body.dstbCollisionsFlagged, 1);
    assert.ok(Array.isArray(dstbFlagParams[0]) && dstbFlagParams[0].length === 1);
  });

  it('TEST E — two legitimate DSTB records share all fingerprint fields: neither is silently lost', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) return { rows: [{ name: 'san antonio' }] };
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async (sql, params) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
        if (sql.includes('INSERT INTO tb_cases')) {
          // Both records in this batch normalize to the same fingerprint —
          // simulate both landing as distinct rows sharing it.
          const fp = params[30];
          return {
            rows: [
              { id: 9005, dstb_fingerprint: fp, itis_case_id: null, source_type: 'DSTB' },
              { id: 9006, dstb_fingerprint: fp, itis_case_id: null, source_type: 'DSTB' },
            ],
          };
        }
        if (sql.includes('DSTB_FINGERPRINT_COLLISION')) {
          // Earliest (9005) keeps 'unique'; only the second row is flagged.
          return { rows: [{ id: 9006 }] };
        }
        return { rows: [] };
      },
      release: () => {},
    });

    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);

    const sameDemographics = {
      barangay_name: 'San Antonio', date_of_diagnosis: '2025-07-06',
      sex: 'Male', age: 33, anatomical_site: 'Pulmonary',
      registration_group: 'New', source_type: 'DSTB',
    };
    const payload = buildPayload({
      sheets: [{
        sheet_name: 'DSTB', source_type: 'DSTB', record_count: 2,
        records: [{ ...sameDemographics }, { ...sameDemographics }],
      }],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.importedCount, 2, 'both distinct patients must be preserved even though they share a fingerprint');
    assert.equal(res.body.dstbCollisionsFlagged, 1, 'only the non-earliest row is flagged, the earliest stays unique');
  });

  // ══════════════════════════════════════════════════════════════
  //  Batch claim — a retry must not re-import a batch that is
  //  still being imported by an earlier (timed-out) attempt
  // ══════════════════════════════════════════════════════════════

  function webhookApp() {
    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json(RAW_BODY_CAPTURE));
    app.use('/api/webhook', webhook);
    return app;
  }

  it('claims the batch before importing, and only takes over failed or stale claims', async () => {
    let claimSql = null;
    let claimParams = null;
    mockClaimResult = undefined;
    const origQuery = mockQueryFn;
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) return { rows: [{ id: 11, name: 'San Antonio' }] };
      return { rows: [] };
    };
    // Capture the claim statement itself through the module-level wrapper.
    const wrapped = require.cache[MODULE_DB].exports;
    const realGetter = Object.getOwnPropertyDescriptor(wrapped, 'query').get;
    Object.defineProperty(wrapped, 'query', {
      configurable: true,
      get() {
        const inner = realGetter.call(wrapped);
        return async (sql, params) => {
          if (isClaimSql(sql)) { claimSql = sql; claimParams = params; }
          return inner(sql, params);
        };
      },
    });
    mockConnectFn = async () => ({
      query: async (sql) => (sql.includes('INSERT INTO tb_cases')
        ? { rows: [{ id: 1, dstb_fingerprint: null, itis_case_id: null, source_type: 'DSTB' }] }
        : { rows: [] }),
      release: () => {},
    });

    try {
      const payload = buildPayload();
      payload.sheets[0].records[0].barangay_id = 11;
      const res = await request(webhookApp())
        .post('/api/webhook/pasig-clone')
        .set('X-Webhook-Signature', generateSignature(payload))
        .send(payload);

      assert.equal(res.status, 200);
      assert.ok(claimSql, 'the batch must be claimed in webhook_logs');
      assert.match(claimSql, /status = 'received'/);
      assert.match(claimSql, /webhook_logs\.status = 'failed'/, 'a failed attempt may be retried');
      assert.match(claimSql, /received_at < NOW\(\)/, 'only a stale in-progress claim may be taken over');
      assert.deepEqual(claimParams.slice(0, 2), ['pasig-clone', payload.batch_id]);
      // The claim row is completed (not a second row inserted) once the import commits.
      const done = claimLogUpdates.find(u => u.sql.includes("status = 'processed'"));
      assert.ok(done, 'the claimed row must be marked processed');
      assert.equal(done.params[0], 42);
      // The log keeps a summary, never the records (case/patient data) themselves.
      const logged = JSON.parse(done.params[1]);
      assert.equal(logged.batch_id, payload.batch_id);
      assert.deepEqual(logged.sheets, [{ sheet_name: 'DSTB', source_type: 'DSTB', record_count: 1 }]);
      assert.ok(!done.params[1].includes('San Antonio'), 'no record content in the log');
    } finally {
      Object.defineProperty(wrapped, 'query', { configurable: true, get: realGetter });
      mockQueryFn = origQuery;
    }
  });

  it('does not re-import a batch another attempt is still importing (sender retry after timeout)', async () => {
    mockClaimResult = { rows: [] }; // claim refused: someone holds it
    let tbCasesInserts = 0;
    mockQueryFn = async (sql) => {
      if (sql.includes('FROM webhook_logs WHERE batch_id')) return { rows: [{ id: 7, status: 'received' }] };
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async (sql) => {
        if (sql.includes('INSERT INTO tb_cases')) tbCasesInserts++;
        return { rows: [] };
      },
      release: () => {},
    });

    const payload = buildPayload();
    const schedBefore = mockScheduleCalls.length;
    const res = await request(webhookApp())
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 202);
    assert.equal(res.body.success, true);
    assert.equal(res.body.inProgress, true);
    assert.equal(tbCasesInserts, 0, 'nothing may be imported a second time');
    assert.equal(mockScheduleCalls.length, schedBefore, 'no extra pipeline run');
  });

  it('marks the claim failed when the import errors, so a retry can take it over', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) return { rows: [{ name: 'san antonio' }] };
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async (sql) => {
        if (sql.includes('INSERT INTO tb_cases')) throw new Error('DB insert failed');
        return { rows: [] };
      },
      release: () => {},
    });

    const payload = buildPayload();
    const res = await request(webhookApp())
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 500);
    const failed = claimLogUpdates.find(u => u.sql.includes("status = 'failed'"));
    assert.ok(failed, 'the claim must be released as failed');
    assert.equal(failed.params[0], 42);
  });

  it('releases the claim when the payload is rejected mid-validation', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) return { rows: [{ name: 'san antonio' }] };
      return { rows: [] };
    };
    mockConnectFn = async () => ({ query: async () => ({ rows: [] }), release: () => {} });

    const payload = buildPayload({
      sheets: [{ sheet_name: 'X', source_type: 'UNKNOWN', record_count: 0, records: [] }],
    });
    const res = await request(webhookApp())
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 400);
    assert.ok(claimLogUpdates.some(u => u.sql.includes("status = 'failed'")),
      'a rejected payload must not leave the batch blocked behind an in-progress claim');
  });

  // ══════════════════════════════════════════════════════════════
  //  Same-case outcome update — a later validated update to an
  //  EXISTING Case ID (ON TREATMENT → CURED) must:
  //    * match on the stable Case ID, not on the patient
  //    * update that one row in place (no second row)
  //    * preserve the previous values in case_history
  //    * record what source and who produced the change
  //  A new episode of the same patient is a different Case ID and
  //  therefore a different case — that is what keeps case counts
  //  honest: longitudinal updates never inflate them.
  // ══════════════════════════════════════════════════════════════

  const storedCaseRow = {
    id: 77,
    case_no: 'CS-2025-000042',
    patient_no: 'PT-000009',
    barangay_id: 11,
    barangay_name: 'San Antonio',
    residence_barangay_name: null,
    residence_city: null,
    location_classification: 'Pasig City',
    outcome_status: 'ON TREATMENT',
    source_outcome_status: 'ON TREATMENT',
    date_of_outcome: null,
    date_started_treatment: null,
    treatment_facility: null,
    source_case_id: 'ROS-D-2025-00042',
  };

  /**
   * Transaction-client mock that records what the webhook asked the database to
   * do, in order. `existing` is what the pre-update snapshot query finds.
   */
  function sameCaseHarness({ existing = [storedCaseRow], insertRows = null } = {}) {
    const captured = { order: [], snapshots: [], caseInserts: [], historyInserts: [], missingFlags: [] };
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT id, name FROM barangays')) return { rows: [{ id: 11, name: 'San Antonio' }] };
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async (sql, params) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('FROM tb_cases') && sql.includes('case_no = ANY')) {
          captured.order.push('snapshot');
          captured.snapshots.push({ sql, params });
          return { rows: existing.map(row => ({ ...row })) };
        }
        if (sql.includes('INSERT INTO tb_cases')) {
          captured.order.push('upsert');
          captured.caseInserts.push({ sql, params });
          return { rows: insertRows || [
            {
              id: 77, case_no: 'CS-2025-000042', patient_no: 'PT-000009',
              dstb_fingerprint: null, itis_case_id: null, source_type: 'DSTB',
              inserted: false,
            },
          ] };
        }
        if (sql.includes('INSERT INTO case_history')) {
          captured.order.push('history');
          captured.historyInserts.push({ sql, params });
          return { rows: [] };
        }
        if (sql.includes('MISSING_CASE_ID')) {
          captured.order.push('flag-missing');
          captured.missingFlags.push({ sql, params });
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => {},
    });
    return captured;
  }

  const curedPayload = (overrides = {}) => buildPayload({
    batch_id: '770e8400-e29b-41d4-a716-446655440077',
    actor: { username: 'ana.cruz', role: 'staff' },
    sheets: [{
      sheet_name: 'DSTB', source_type: 'DSTB', record_count: 1,
      records: [{
        barangay_name: 'San Antonio', date_of_diagnosis: '2025-02-06',
        sex: 'Male', age: 31, source_type: 'DSTB',
        case_no: 'CS-2025-000042', source_case_id: 'ROS-D-2025-00042',
        outcome_status: 'CURED', date_of_outcome: '2025-06-10',
      }],
    }],
    ...overrides,
  });

  it('TEST G — same Case ID re-sent as CURED: updates the existing row and preserves the previous outcome in case history', async () => {
    const db = sameCaseHarness();
    const payload = curedPayload();
    const res = await request(webhookApp())
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    // The whole point: an update, not another case.
    assert.equal(res.body.updatedCount, 1, 'the existing case is updated');
    assert.equal(res.body.importedCount, 0, 'no new case row is created');
    assert.equal(res.body.historyEntries, 1, 'the previous values are preserved');

    // Matched strictly by the stable Case ID, snapshot taken before the write.
    assert.equal(db.snapshots.length, 1);
    assert.deepStrictEqual(db.snapshots[0].params[0], ['CS-2025-000042']);
    assert.ok(db.snapshots[0].sql.includes('outcome_status'), 'the snapshot reads the previous outcome');

    // One upsert statement keyed on case_no — the duplicate-avoidance mechanism.
    assert.equal(db.caseInserts.length, 1);
    assert.ok(db.caseInserts[0].sql.includes('ON CONFLICT (case_no)'));
    assert.ok(db.caseInserts[0].sql.includes('updated_at = NOW()'), 'the in-place update is timestamped');

    // Snapshot before the upsert, history written after it, in the same transaction.
    assert.deepStrictEqual(db.order.slice(0, 3), ['snapshot', 'upsert', 'history']);

    const params = db.historyInserts[0].params;
    assert.equal(params[0], 77, 'history is attached to the same case row');
    assert.equal(params[1], 'CS-2025-000042');
    assert.equal(params[4], 'status_changed');
    assert.deepStrictEqual(JSON.parse(params[5]), {
      outcome_status: { old: 'ON TREATMENT', new: 'CURED' },
      source_outcome_status: { old: 'ON TREATMENT', new: 'CURED' },
      date_of_outcome: { old: null, new: '2025-06-10' },
    }, 'the previous outcome survives verbatim');
    assert.equal(params[6], 'webhook', 'what produced the change');
    assert.equal(params[8], 'ana.cruz', 'who produced the change');
    assert.equal(params[3], '770e8400-e29b-41d4-a716-446655440077', 'which sync produced it');
  });

  it('TEST G2 — an unchanged resend updates the case but records no history', async () => {
    const db = sameCaseHarness();
    const payload = buildPayload({
      batch_id: '770e8400-e29b-41d4-a716-446655440078',
      sheets: [{
        sheet_name: 'DSTB', source_type: 'DSTB', record_count: 1,
        records: [{
          barangay_name: 'San Antonio', date_of_diagnosis: '2025-02-06',
          sex: 'Male', age: 31, source_type: 'DSTB',
          case_no: 'CS-2025-000042', source_case_id: 'ROS-D-2025-00042',
          outcome_status: 'ON TREATMENT',
        }],
      }],
    });
    const res = await request(webhookApp())
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.updatedCount, 1);
    assert.equal(res.body.importedCount, 0);
    assert.equal(res.body.historyEntries, 0, 'nothing changed, so nothing is written to history');
    assert.equal(db.historyInserts.length, 0);
  });

  it('TEST G3 — records WHO via the optional actor, and NULL when the sender sends none', async () => {
    const withActor = sameCaseHarness();
    const actorPayload = curedPayload();
    await request(webhookApp())
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(actorPayload))
      .send(actorPayload);
    assert.equal(withActor.historyInserts[0].params[8], 'ana.cruz');

    const withoutActor = sameCaseHarness();
    const anonymous = curedPayload();
    delete anonymous.actor;
    const res = await request(webhookApp())
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(anonymous))
      .send(anonymous);

    // Backward compatible: an older sender changes nothing except the actor label.
    assert.equal(res.status, 200);
    assert.equal(res.body.updatedCount, 1);
    assert.equal(res.body.historyEntries, 1);
    assert.equal(withoutActor.historyInserts[0].params[8], null);
    assert.equal(withoutActor.historyInserts[0].params[6], 'webhook', 'the source is still recorded');
  });

  it('TEST G4 — a record with no Case ID cannot be matched on a resend: flagged for review, still never rejected', async () => {
    const db = sameCaseHarness({
      existing: [],
      insertRows: [{
        id: 555, case_no: null, patient_no: null,
        dstb_fingerprint: null, itis_case_id: null, source_type: 'DSTB',
        inserted: true,
      }],
    });
    const payload = buildPayload({
      batch_id: '770e8400-e29b-41d4-a716-446655440079',
      sheets: [{
        sheet_name: 'DSTB', source_type: 'DSTB', record_count: 1,
        records: [{
          barangay_name: 'San Antonio', date_of_diagnosis: '2025-02-06',
          sex: 'Male', age: 31, source_type: 'DSTB',
          outcome_status: 'CURED',
        }],
      }],
    });
    const res = await request(webhookApp())
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.importedCount, 1, 'still never rejected or merged');
    assert.equal(db.snapshots.length, 0, 'nothing to match without a Case ID');
    assert.equal(db.missingFlags.length, 1, 'but the row is marked for review');
    assert.deepStrictEqual(db.missingFlags[0].params[0], [555]);
    assert.ok(db.missingFlags[0].sql.includes("'MISSING_CASE_ID'"));
    assert.equal(res.body.historyEntries, 0, 'an unmatched record has no Case ID to hang history on');
  });

  it('TEST G5 — patient identity is not case identity: a later episode under the same Patient # is a second case', async () => {
    const db = sameCaseHarness({
      existing: [],
      insertRows: [
        { id: 901, case_no: 'CS-2025-000100', patient_no: 'PT-000009', dstb_fingerprint: null, itis_case_id: null, source_type: 'DSTB', inserted: true },
        { id: 902, case_no: 'CS-2026-000007', patient_no: 'PT-000009', dstb_fingerprint: null, itis_case_id: null, source_type: 'DSTB', inserted: true },
      ],
    });
    const payload = buildPayload({
      batch_id: '770e8400-e29b-41d4-a716-446655440080',
      sheets: [{
        sheet_name: 'DSTB', source_type: 'DSTB', record_count: 2,
        records: [
          {
            barangay_name: 'San Antonio', date_of_diagnosis: '2025-02-06',
            sex: 'Male', age: 31, source_type: 'DSTB',
            case_no: 'CS-2025-000100', patient_no: 'PT-000009',
            outcome_status: 'CURED',
          },
          {
            // Same person, NEW episode → new Case ID → its own case.
            barangay_name: 'San Antonio', date_of_diagnosis: '2026-01-15',
            sex: 'Male', age: 32, source_type: 'DSTB',
            case_no: 'CS-2026-000007', patient_no: 'PT-000009',
            outcome_status: 'ON TREATMENT',
          },
        ],
      }],
    });
    const res = await request(webhookApp())
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.importedCount, 2, 'two episodes = two cases');
    assert.equal(res.body.updatedCount, 0, 'neither is an update of the other');
    // Matching never even looks at patient_no — only at Case IDs.
    assert.deepStrictEqual(db.snapshots[0].params[0], ['CS-2025-000100', 'CS-2026-000007']);
    assert.ok(!db.snapshots[0].sql.includes('patient_no = '), 'never matched on the patient');
  });
});
