/**
 * API rate limiter (middleware/rateLimiter.js):
 *   the status checks pages poll on a timer must not use up the request budget,
 *   while every other API request is still counted.
 * Run: node --test BACKEND/test/rateLimiter.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');

process.env.API_LIMIT_MAX = '3';
delete require.cache[require.resolve('../middleware/rateLimiter')];
const { apiLimiter, isPollingRequest } = require('../middleware/rateLimiter');

function buildApp() {
  const app = express();
  const router = express.Router();
  router.get('/pipeline/status', (req, res) => res.json({ ok: true }));
  router.get('/alerts/unread-count', (req, res) => res.json({ count: 0 }));
  router.get('/dashboard/summary', (req, res) => res.json({ ok: true }));
  // Mounted the same way as server.js: app.use('/api/tb', apiLimiter, routes)
  app.use('/api/tb', apiLimiter, router);
  return app;
}

describe('apiLimiter', () => {
  it('does not count polling status checks', async () => {
    const app = buildApp();
    for (let i = 0; i < 10; i++) {
      const r1 = await request(app).get('/api/tb/pipeline/status');
      assert.strictEqual(r1.status, 200);
      const r2 = await request(app).get('/api/tb/alerts/unread-count?x=1');
      assert.strictEqual(r2.status, 200);
    }
    // The budget is untouched: normal requests still get their full allowance.
    for (let i = 0; i < 3; i++) {
      assert.strictEqual((await request(app).get('/api/tb/dashboard/summary')).status, 200);
    }
  });

  it('still limits everything else', async () => {
    const app = buildApp();
    for (let i = 0; i < 3; i++) await request(app).get('/api/tb/dashboard/summary');
    assert.strictEqual((await request(app).get('/api/tb/dashboard/summary')).status, 429);
  });

  it('only exempts GET on the exact polling paths', () => {
    const req = (method, originalUrl) => ({ method, originalUrl });
    assert.strictEqual(isPollingRequest(req('GET', '/api/tb/pipeline/status')), true);
    assert.strictEqual(isPollingRequest(req('GET', '/api/tb/pipeline/status?run_type=pipeline')), true);
    assert.strictEqual(isPollingRequest(req('POST', '/api/tb/pipeline/status')), false);
    assert.strictEqual(isPollingRequest(req('POST', '/api/tb/pipeline')), false);
    assert.strictEqual(isPollingRequest(req('GET', '/api/tb/alerts')), false);
    assert.strictEqual(isPollingRequest(req('GET', '/api/tb/pipeline/status/../../auth/users')), false);
  });
});
