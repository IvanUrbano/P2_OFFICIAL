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
      connect: mockConnectFn || (async () => ({
        query: async () => {},
        release: () => {},
      })),
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
    app.use(express.json());
    app.use('/api/webhook', webhook);

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .send(buildPayload());

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid signature');
  });

  it('rejects request with wrong secret', async () => {
    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json());
    app.use('/api/webhook', webhook);

    const payload = buildPayload();
    const wrongSignature = crypto
      .createHmac('sha256', 'wrong-secret')
      .update(JSON.stringify(payload))
      .digest('hex');

    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Secret', 'wrong-secret')
      .set('X-Webhook-Signature', `sha256=${wrongSignature}`)
      .send(payload);

    assert.equal(res.status, 401);
  });

  it('rejects invalid payload structure', async () => {
    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json());
    app.use('/api/webhook', webhook);

    const payload = { source: 'pasig-clone', sheets: 'not-an-array' };
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Secret', TEST_SECRET)
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid payload structure');
  });

  it('rejects payload with wrong source', async () => {
    clearWebhookCache();
    const webhook = require('../tbinsight/webhook');
    const app = express();
    app.use(express.json());
    app.use('/api/webhook', webhook);

    const payload = buildPayload({ source: 'unknown' });
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Secret', TEST_SECRET)
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
    app.use(express.json());
    app.use('/api/webhook', webhook);

    const payload = buildPayload();
    const res = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Secret', TEST_SECRET)
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
    app.use(express.json());
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
      .set('X-Webhook-Secret', TEST_SECRET)
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.importedCount, 0);
    assert.equal(res.body.errorCount, 1);
    assert.ok(res.body.errors.length > 0);
  });
});
