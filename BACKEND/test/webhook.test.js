/**
 * Webhook Endpoint Tests
 *
 * Tests POST /api/webhook/pasig-clone with HMAC verification.
 * Database pool is mocked (same pattern as auth.test.js).
 * Run: node --test BACKEND/test/webhook.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const TEST_SECRET = 'test-webhook-secret';

/* ─── Mock pool ─── */
const MODULE_DB = require.resolve('../db');
let mockQueryFn;
let mockConnectFn;

function installMockDb() {
  require.cache[MODULE_DB] = {
    id: MODULE_DB, filename: MODULE_DB, loaded: true,
    exports: {
      get query() { return mockQueryFn || (async () => ({ rows: [] })); },
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
    mockQueryFn = async (sql, params) => {
      if (sql.includes('SELECT name FROM barangays')) {
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

    // Mock transaction client
    mockConnectFn = async () => ({
      query: async (sql) => {
        if (sql.includes('INSERT INTO tb_cases')) {
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
    const schedBefore = mockScheduleCalls.length;
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.importedCount, 1);
    assert.equal(res.body.errorCount, 0);
    // Successful import triggers exactly one debounced background pipeline run
    assert.equal(mockScheduleCalls.length, schedBefore + 1);
    assert.ok(mockScheduleCalls[schedBefore].trigger.startsWith('webhook:'));
    assert.equal(mockScheduleCalls[schedBefore].delayMs, 5000);
  });

  it('returns errors for invalid records', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT name FROM barangays')) {
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

  it('returns success for duplicate webhook (idempotent)', async () => {
    // Mock: batch already processed in webhook_logs
    mockQueryFn = async (sql, params) => {
      if (sql.includes('SELECT name FROM barangays')) {
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
      if (sql.includes('SELECT name FROM barangays')) {
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
      if (sql.includes('SELECT name FROM barangays')) {
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
      if (sql.includes('SELECT name FROM barangays')) {
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
      if (sql.includes('SELECT name FROM barangays')) {
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
      if (sql.includes('SELECT name FROM barangays')) {
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

  it('imports non-Pasig record with warning classification', async () => {
    let insertedLocation = null;
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT name FROM barangays')) {
        return { rows: [{ name: 'santa cruz' }] };
      }
      if (sql.includes('INSERT INTO webhook_logs')) {
        return { rows: [] };
      }
      return { rows: [] };
    };

    mockConnectFn = async () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO tb_cases')) {
          insertedLocation = params[19]; // location_classification is 20th param
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
    assert.equal(insertedLocation, 'Non-Pasig');
  });

  it('rejects Pasig record with invalid barangay', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT name FROM barangays')) {
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

  it('maps ITIS Lite field for MN sheets', async () => {
    let insertedItisId = null;
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT name FROM barangays')) {
        return { rows: [{ name: 'caniogan' }] };
      }
      if (sql.includes('INSERT INTO webhook_logs')) {
        return { rows: [] };
      }
      return { rows: [] };
    };

    mockConnectFn = async () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO tb_cases')) {
          insertedItisId = params[17]; // itis_case_id is 18th param
          return { rows: [{ id: 1, dstb_fingerprint: null, itis_case_id: insertedItisId, source_type: 'MN' }] };
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
    assert.equal(insertedItisId, 'ITIS-2025-001');
  });

  it('parses various date formats in records', async () => {
    let insertedDates = {};
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT name FROM barangays')) {
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
            diagnosis: params[1],
            screening: params[2],
            notification: params[3],
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
      if (sql.includes('SELECT name FROM barangays')) {
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
  //  Duplicate detection — MN itis_case_id / DSTB fingerprint
  //  (detection-only: never reject, never merge, never delete)
  // ══════════════════════════════════════════════════════════════

  it('TEST A — MN same itis_case_id but clearly different record: both preserved, collision flagged, no silent rejection', async () => {
    let mnFlagParams = null;
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT name FROM barangays')) return { rows: [{ name: 'san antonio' }] };
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async (sql, params) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
        if (sql.includes('INSERT INTO tb_cases')) {
          // A different patient whose itis_case_id happens to already exist
          // on an earlier, unrelated record (the real condition found in
          // live data — see migration 018's audit).
          return { rows: [{ id: 9001, dstb_fingerprint: null, itis_case_id: 'ITIS-COLLIDE-1', source_type: 'MN' }] };
        }
        if (sql.includes('MN_ITIS_ID_COLLISION')) {
          mnFlagParams = params;
          return { rows: [{ id: 9001 }] };
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
    assert.equal(res.body.importedCount, 1, 'the colliding record must be inserted, never rejected');
    assert.equal(res.body.mnCollisionsFlagged, 1, 'the collision must be flagged for review');
    assert.ok(mnFlagParams[0].includes('ITIS-COLLIDE-1'));
  });

  it('TEST B — same MN case resent in a different batch: batch-level idempotency does not apply, but no crash and no data loss', async () => {
    // Batch idempotency (webhook_logs unique on batch_id) only prevents
    // *reprocessing the same batch*. A different batch carrying the same
    // MN case is a separate scenario, handled by record-level detection
    // (TEST A/C), not by batch idempotency — this test documents that
    // distinction by resending under a brand-new batch_id and confirming
    // the record still lands (never silently dropped).
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT name FROM barangays')) return { rows: [{ name: 'san antonio' }] };
      if (sql.includes('FROM webhook_logs WHERE batch_id')) return { rows: [] }; // new batch, not seen before
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
        if (sql.includes('INSERT INTO tb_cases')) {
          return { rows: [{ id: 9002, dstb_fingerprint: null, itis_case_id: 'ITIS-RESENT', source_type: 'MN' }] };
        }
        if (sql.includes('MN_ITIS_ID_COLLISION')) return { rows: [{ id: 9002 }] };
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
      batch_id: '660e8400-e29b-41d4-a716-446655440099',
      sheets: [{
        sheet_name: 'MN', source_type: 'MN', record_count: 1,
        records: [{
          barangay_name: 'San Antonio', date_of_diagnosis: '2025-07-01',
          sex: 'Female', age: 19, itis_case_id: 'ITIS-RESENT', source_type: 'MN',
        }],
      }],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.importedCount, 1);
    assert.equal(res.body.mnCollisionsFlagged, 1);
  });

  it('TEST B2 — same batch_id resent: batch-level idempotency handles it before any record-level processing', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT name FROM barangays')) return { rows: [{ name: 'san antonio' }] };
      if (sql.includes('FROM webhook_logs WHERE batch_id')) return { rows: [{ id: 1, status: 'processed' }] };
      return { rows: [] };
    };

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
          sex: 'Female', age: 19, itis_case_id: 'ITIS-SAME-BATCH', source_type: 'MN',
        }],
      }],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.ok(res.body.message.includes('already processed'));
  });

  it('TEST C — same itis_case_id reappears with a changed outcome_status: still just flagged as possible_duplicate, never auto-confirmed', async () => {
    let mnFlagSql = null;
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT name FROM barangays')) return { rows: [{ name: 'san antonio' }] };
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
        if (sql.includes('INSERT INTO tb_cases')) {
          return { rows: [{ id: 9003, dstb_fingerprint: null, itis_case_id: 'ITIS-OUTCOME-CHANGED', source_type: 'MN' }] };
        }
        if (sql.includes('MN_ITIS_ID_COLLISION')) {
          mnFlagSql = sql;
          return { rows: [{ id: 9003 }] };
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
        sheet_name: 'MN', source_type: 'MN', record_count: 1,
        records: [{
          barangay_name: 'San Antonio', date_of_diagnosis: '2025-07-01',
          sex: 'Female', age: 19, itis_case_id: 'ITIS-OUTCOME-CHANGED',
          outcome_status: 'CURED', source_type: 'MN',
        }],
      }],
    });

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.importedCount, 1);
    assert.equal(res.body.mnCollisionsFlagged, 1);
    // The flagging query only ever sets 'possible_duplicate' — there is no
    // code path that promotes a collision to a "confirmed" status based on
    // outcome_status or any other field.
    assert.ok(mnFlagSql.includes("'possible_duplicate'"));
    assert.ok(!mnFlagSql.toLowerCase().includes('confirmed'));
  });

  it('TEST D — DSTB fingerprint matches an earlier row: flagged as possible duplicate, record preserved', async () => {
    let dstbFlagParams = null;
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT name FROM barangays')) return { rows: [{ name: 'san antonio' }] };
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async (sql, params) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
        if (sql.includes('INSERT INTO tb_cases')) {
          const fp = params[params.length - 1]; // dstb_fingerprint is the last column
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
      if (sql.includes('SELECT name FROM barangays')) return { rows: [{ name: 'san antonio' }] };
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async (sql, params) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
        if (sql.includes('INSERT INTO tb_cases')) {
          // Both records in this batch normalize to the same fingerprint —
          // simulate both landing as distinct rows sharing it.
          const fp = params[params.length - 1];
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
});
