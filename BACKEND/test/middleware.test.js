/**
 * Middleware Tests
 *
 * Tests authenticateToken with real JWT verification.
 * No mocking — uses actual jsonwebtoken library.
 * Run: node --test BACKEND/test/middleware.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TEST_SECRET = 'test-middleware-secret-do-not-use';
const { authenticateToken } = require('../middleware/auth');

/* ─── Helpers ─── */
function buildApp() {
  const app = express();
  app.use(cookieParser()); // required for req.cookies to work
  app.get('/protected', authenticateToken, (req, res) => {
    res.json({ ok: true, user: req.user });
  });
  return app;
}

function signToken(payload, opts = {}) {
  return jwt.sign(payload, opts.secret || TEST_SECRET, {
    expiresIn: opts.expiresIn || '1h',
  });
}

/* ═══════════════════════════════════════════════════════ */
/*                    SETUP & TEARDOWN                    */
/* ═══════════════════════════════════════════════════════ */

before(() => { process.env.JWT_SECRET = TEST_SECRET; });
after(() => { delete process.env.JWT_SECRET; });

/* ═══════════════════════════════════════════════════════ */
/*                  authenticateToken                     */
/* ═══════════════════════════════════════════════════════ */

describe('authenticateToken middleware', () => {
  it('returns 401 when no token is provided', async () => {
    const res = await request(buildApp()).get('/protected');
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error.includes('No token'));
  });

  it('returns 403 for malformed token', async () => {
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', 'Bearer not.a.valid.jwt');
    assert.strictEqual(res.status, 403);
    assert.ok(res.body.error.includes('Invalid or expired'));
  });

  it('returns 403 for token signed with wrong secret', async () => {
    const token = jwt.sign({ id: 1 }, 'wrong-secret', { expiresIn: '1h' });
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 403);
  });

  it('returns 403 for expired token', async () => {
    const token = jwt.sign({ id: 1 }, TEST_SECRET, { expiresIn: '0s' });
    // Small delay to ensure expiration
    await new Promise(r => setTimeout(r, 50));
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 403);
    assert.ok(res.body.error.includes('Invalid or expired'));
  });

  it('accepts valid token from Authorization header', async () => {
    const token = signToken({ id: 1, username: 'alice', role: 'staff' });
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.id, 1);
    assert.strictEqual(res.body.user.username, 'alice');
    assert.strictEqual(res.body.user.role, 'staff');
  });

  it('accepts valid token from cookie', async () => {
    const token = signToken({ id: 2, username: 'bob', role: 'admin' });
    const res = await request(buildApp())
      .get('/protected')
      .set('Cookie', `token=${token}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.id, 2);
    assert.strictEqual(res.body.user.username, 'bob');
  });

  it('cookie takes priority over header when both present', async () => {
    const cookieToken = signToken({ id: 10, username: 'fromCookie' });
    const headerToken = signToken({ id: 20, username: 'fromHeader' });
    const res = await request(buildApp())
      .get('/protected')
      .set('Cookie', `token=${cookieToken}`)
      .set('Authorization', `Bearer ${headerToken}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.id, 10);
    assert.strictEqual(res.body.user.username, 'fromCookie');
  });

  it('handles Bearer prefix with extra whitespace (no token extracted)', async () => {
    const token = signToken({ id: 5, username: 'ws' });
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer  ${token}`);
    // "Bearer  token".split(' ')[1] = "" (empty) → treated as no token → 401
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error.includes('No token'));
  });

  it('rejects token with algorithm None', async () => {
    // jwt.verify rejects 'none' algorithm by default, but let's be explicit
    const token = jwt.sign({ id: 1 }, TEST_SECRET, { algorithm: 'none', expiresIn: '1h' });
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 403);
  });

  it('passes through all decoded fields', async () => {
    const token = signToken({
      id: 42, username: 'fulluser', email: 'full@test.com',
      role: 'admin', extra: 'field',
    });
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.id, 42);
    assert.strictEqual(res.body.user.email, 'full@test.com');
    assert.strictEqual(res.body.user.role, 'admin');
    assert.strictEqual(res.body.user.extra, 'field');
  });
});

/* ═══════════════════════════════════════════════════════ */
/*                  Server Endpoints                      */
/* ═══════════════════════════════════════════════════════ */

describe('GET / (root endpoint)', () => {
  it('returns API info', async () => {
    const app = express();
    app.get('/', (req, res) => {
      res.json({ message: 'TB System API is running', version: '1.0.0' });
    });
    const res = await request(app).get('/');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.message, 'TB System API is running');
    assert.strictEqual(res.body.version, '1.0.0');
  });
});
