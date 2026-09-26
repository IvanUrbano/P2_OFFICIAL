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
        query: async () => {},
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
  });

  after(() => {
    uninstallMockDb();
    uninstallMockAgg();
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
      query: async () => {},
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

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.importedCount, 1);
    assert.equal(res.body.errorCount, 0);
  });

  it('returns errors for invalid records', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT name FROM barangays')) {
        return { rows: [{ name: 'san antonio' }] };
      }
      return { rows: [] };
    };

    mockConnectFn = async () => ({
      query: async () => {},
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

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.importedCount, 0);
    assert.equal(res.body.errorCount, 1);
    assert.ok(res.body.errors.length > 0);
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
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.message.includes('already processed'));
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
      query: async () => {},
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
      query: async () => {},
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

  it('rejects payload with record_count mismatch', async () => {
    mockQueryFn = async (sql) => {
      if (sql.includes('SELECT name FROM barangays')) {
        return { rows: [{ name: 'san antonio' }] };
      }
      return { rows: [] };
    };
    mockConnectFn = async () => ({
      query: async () => {},
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
        }
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
      query: async () => {},
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
        }
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
        }
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
});
