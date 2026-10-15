/**
 * API rate limiter (middleware/rateLimiter.js):
 *   the status checks pages poll on a timer must not use up the request budget,
 *   while every other API request is still counted; only failed logins count toward the login limit.
 * Run: node --test BACKEND/test/rateLimiter.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');

process.env.API_LIMIT_MAX = '3';
process.env.LOGIN_LIMIT_MAX = '2';
delete require.cache[require.resolve('../middleware/rateLimiter')];
const { apiLimiter, loginLimiter, isPollingRequest } = require('../middleware/rateLimiter');

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
    assert.strictEqual(isPollingRequest(req('GET', '/api/tb/data-freshness')), true);
    assert.strictEqual(isPollingRequest(req('POST', '/api/tb/pipeline/status')), false);
    assert.strictEqual(isPollingRequest(req('POST', '/api/tb/pipeline')), false);
    assert.strictEqual(isPollingRequest(req('GET', '/api/tb/alerts')), false);
    assert.strictEqual(isPollingRequest(req('GET', '/api/tb/pipeline/status/../../auth/users')), false);
  });
});

describe('loginLimiter', () => {
  function buildLoginApp() {
    const app = express();
    app.use(express.json());
    app.post('/api/auth/login', loginLimiter, (req, res) => (
      req.body.password === 'right' ? res.json({ ok: true }) : res.status(401).json({ error: 'Invalid credentials' })
    ));
    return app;
  }
  const login = (app, password) => request(app).post('/api/auth/login').send({ password });

  it('does not count successful logins', async () => {
    const app = buildLoginApp();
    for (let i = 0; i < 5; i++) assert.strictEqual((await login(app, 'right')).status, 200);
  });

  it('blocks after too many failed logins', async () => {
    const app = buildLoginApp();
    assert.strictEqual((await login(app, 'wrong')).status, 401);
    assert.strictEqual((await login(app, 'wrong')).status, 401);
    const blocked = await login(app, 'right');
    assert.strictEqual(blocked.status, 429);
    assert.ok(blocked.body.retryAfter > 0);
  });
});
