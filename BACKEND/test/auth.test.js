/**
 * Auth Routes Tests
 *
 * Tests auth endpoints using real bcrypt + JWT.
 * Only the database pool is mocked (same pattern as routes.test.js).
 * Run: node --test BACKEND/test/auth.test.js
 */

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const TEST_SECRET = 'test-jwt-secret-do-not-use-in-production';

/* ─── Mock pool ─── */
const MODULE_DB = require.resolve('../db');
let mockQueryFn;

function installMockDb() {
  require.cache[MODULE_DB] = {
    id: MODULE_DB, filename: MODULE_DB, loaded: true,
    exports: {
      get query() { return mockQueryFn || (async () => ({ rows: [] })); },
      connect: async () => {}, end: async () => {},
    },
  };
}

function uninstallMockDb() {
  delete require.cache[MODULE_DB];
}

function clearAuthCache() {
  Object.keys(require.cache)
    .filter(k =>
      k.includes('routes/auth') ||
      k.includes('middleware/auth') ||
      k.includes('middleware/rateLimiter')
    )
    .forEach(k => delete require.cache[k]);
}

function buildApp() {
  uninstallMockDb();
  installMockDb();
  clearAuthCache();
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  return app;
}

function teardown() {
  uninstallMockDb();
  clearAuthCache();
}

/* ─── Test data helpers ─── */
const STAFF_HASH = bcrypt.hashSync('staffpass123', 4); // low rounds for speed
const ADMIN_HASH = bcrypt.hashSync('adminpass123', 4);

const STAFF_USER = {
  id: 1, username: 'staff1', email: 'staff@test.com',
  password: STAFF_HASH, role: 'staff',
  created_at: '2025-01-01T00:00:00Z',
};

const ADMIN_USER = {
  id: 2, username: 'admin1', email: 'admin@test.com',
  password: ADMIN_HASH, role: 'admin',
  created_at: '2025-01-01T00:00:00Z',
};

function makeToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email, role: user.role },
    TEST_SECRET,
    { expiresIn: '1h' }
  );
}

/* ═══════════════════════════════════════════════════════ */
/*                    SETUP & TEARDOWN                    */
/* ═══════════════════════════════════════════════════════ */

before(() => {
  process.env.JWT_SECRET = TEST_SECRET;
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.LOGIN_LIMIT_MAX = '100'; // high limit so tests don't trigger 429
  process.env.LOGIN_LIMIT_WINDOW_MINS = '1';
});

after(() => {
  delete process.env.JWT_SECRET;
  delete process.env.JWT_EXPIRES_IN;
  delete process.env.LOGIN_LIMIT_MAX;
  delete process.env.LOGIN_LIMIT_WINDOW_MINS;
  teardown();
});

afterEach(teardown);

/* ═══════════════════════════════════════════════════════ */
/*                    POST /api/auth/login                 */
/* ═══════════════════════════════════════════════════════ */

describe('POST /api/auth/login', () => {
  it('returns 400 when email is missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ password: 'pass' });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('required'));
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'a@b.com' });
    assert.strictEqual(res.status, 400);
  });

  it('returns 401 for non-existent email', async () => {
    mockQueryFn = async () => ({ rows: [] });
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'nobody@test.com', password: 'pass' });
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error.includes('Invalid email or password'));
  });

  it('returns 401 for wrong password', async () => {
    mockQueryFn = async () => ({ rows: [STAFF_USER] });
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'staff@test.com', password: 'wrongpassword' });
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error.includes('Invalid email or password'));
  });

  it('returns token and user on valid login', async () => {
    mockQueryFn = async () => ({ rows: [STAFF_USER] });
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'staff@test.com', password: 'staffpass123' });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.token, 'response should include token');
    assert.strictEqual(res.body.user.email, 'staff@test.com');
    assert.strictEqual(res.body.user.role, 'staff');
    assert.ok(!res.body.user.password, 'password must not be returned');
  });

  it('sets httpOnly cookie with token', async () => {
    mockQueryFn = async () => ({ rows: [STAFF_USER] });
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'staff@test.com', password: 'staffpass123' });
    assert.strictEqual(res.status, 200);
    const cookies = res.headers['set-cookie'];
    assert.ok(cookies, 'should set cookies');
    const tokenCookie = cookies.find(c => c.startsWith('token='));
    assert.ok(tokenCookie, 'should set token cookie');
    assert.ok(tokenCookie.includes('HttpOnly'));
  });

  it('returns 500 on database error', async () => {
    mockQueryFn = async () => { throw new Error('DB connection lost'); };
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'x@y.com', password: 'pass' });
    assert.strictEqual(res.status, 500);
    assert.ok(res.body.error.includes('Server error'));
  });
});

/* ═══════════════════════════════════════════════════════ */
/*                    POST /api/auth/register              */
/* ═══════════════════════════════════════════════════════ */

describe('POST /api/auth/register', () => {
  const adminToken = makeToken(ADMIN_USER);
  const staffToken = makeToken(STAFF_USER);

  it('returns 401 without token', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ username: 'new', email: 'new@test.com', password: 'pass123' });
    assert.strictEqual(res.status, 401);
  });

  it('returns 403 for non-admin user', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ username: 'new', email: 'new@test.com', password: 'pass123' });
    assert.strictEqual(res.status, 403);
    assert.ok(res.body.error.includes('Access denied'));
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'onlyuser' });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('required'));
  });

  it('returns 400 for invalid role', async () => {
    mockQueryFn = async () => ({ rows: [] });
    const res = await request(buildApp())
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'new', email: 'new@test.com', password: 'pass123', role: 'superadmin' });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Invalid role'));
  });

  it('returns 409 for duplicate user', async () => {
    mockQueryFn = async () => ({ rows: [{ id: 99 }] }); // user exists
    const res = await request(buildApp())
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'dup', email: 'dup@test.com', password: 'pass123' });
    assert.strictEqual(res.status, 409);
    assert.ok(res.body.error.includes('already exists'));
  });

  it('returns 201 on successful registration', async () => {
    let callCount = 0;
    mockQueryFn = async (sql, params) => {
      callCount++;
      if (callCount === 1) return { rows: [] }; // no existing user
      // Second call is the INSERT
      return {
        rows: [{
          id: 10, username: params[0], email: params[1],
          role: params[3], created_at: new Date().toISOString(),
        }],
      };
    };
    const res = await request(buildApp())
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'newstaff', email: 'new@test.com', password: 'pass123' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.user.username, 'newstaff');
    assert.strictEqual(res.body.user.email, 'new@test.com');
  });

  it('defaults role to staff when not specified', async () => {
    let capturedRole;
    let callCount = 0;
    mockQueryFn = async (sql, params) => {
      callCount++;
      if (callCount === 1) return { rows: [] };
      capturedRole = params[3]; // role is 4th param
      return { rows: [{ id: 10, username: params[0], email: params[1], role: params[3], created_at: new Date() }] };
    };
    await request(buildApp())
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'newstaff', email: 'new@test.com', password: 'pass123' });
    assert.strictEqual(capturedRole, 'staff');
  });
});

/* ═══════════════════════════════════════════════════════ */
/*                    POST /api/auth/logout                */
/* ═══════════════════════════════════════════════════════ */

describe('POST /api/auth/logout', () => {
  it('returns success and clears cookie', async () => {
    const res = await request(buildApp()).post('/api/auth/logout');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.message.includes('Logged out'));
  });
});

/* ═══════════════════════════════════════════════════════ */
/*                    GET /api/auth/profile                */
/* ═══════════════════════════════════════════════════════ */

describe('GET /api/auth/profile', () => {
  it('returns 401 without token', async () => {
    const res = await request(buildApp()).get('/api/auth/profile');
    assert.strictEqual(res.status, 401);
  });

  it('returns user profile when authenticated', async () => {
    mockQueryFn = async () => ({
      rows: [{ id: 1, username: 'staff1', email: 'staff@test.com', role: 'staff', created_at: '2025-01-01' }],
    });
    const token = makeToken(STAFF_USER);
    const res = await request(buildApp())
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.email, 'staff@test.com');
  });

  it('returns 404 if user not found in database', async () => {
    mockQueryFn = async () => ({ rows: [] });
    const token = makeToken({ id: 999, username: 'gone', email: 'gone@test.com', role: 'staff' });
    const res = await request(buildApp())
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 404);
  });

  it('returns 500 on database error', async () => {
    mockQueryFn = async () => { throw new Error('DB down'); };
    const token = makeToken(STAFF_USER);
    const res = await request(buildApp())
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 500);
  });
});

/* ═══════════════════════════════════════════════════════ */
/*                    GET /api/auth/users                  */
/* ═══════════════════════════════════════════════════════ */

describe('GET /api/auth/users', () => {
  it('returns 401 without token', async () => {
    const res = await request(buildApp()).get('/api/auth/users');
    assert.strictEqual(res.status, 401);
  });

  it('returns 403 for non-admin', async () => {
    const token = makeToken(STAFF_USER);
    const res = await request(buildApp())
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 403);
    assert.ok(res.body.error.includes('Access denied'));
  });

  it('returns user list for admin', async () => {
    mockQueryFn = async () => ({
      rows: [
        { id: 1, username: 'staff1', email: 's@t.com', role: 'staff', created_at: '2025-01-01' },
        { id: 2, username: 'admin1', email: 'a@t.com', role: 'admin', created_at: '2025-01-02' },
      ],
    });
    const token = makeToken(ADMIN_USER);
    const res = await request(buildApp())
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.users.length, 2);
  });

  it('returns empty list when no users exist', async () => {
    mockQueryFn = async () => ({ rows: [] });
    const token = makeToken(ADMIN_USER);
    const res = await request(buildApp())
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.users.length, 0);
  });
});

/* ═══════════════════════════════════════════════════════ */
/*                    DELETE /api/auth/users/:id           */
/* ═══════════════════════════════════════════════════════ */

describe('DELETE /api/auth/users/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(buildApp()).delete('/api/auth/users/2');
    assert.strictEqual(res.status, 401);
  });

  it('returns 403 for non-admin', async () => {
    const token = makeToken(STAFF_USER);
    const res = await request(buildApp())
      .delete('/api/auth/users/2')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 403);
  });

  it('returns 400 when admin tries to delete self', async () => {
    const token = makeToken(ADMIN_USER);
    const res = await request(buildApp())
      .delete(`/api/auth/users/${ADMIN_USER.id}`)
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('cannot delete your own'));
  });

  it('deletes user successfully as admin', async () => {
    mockQueryFn = async () => ({});
    const token = makeToken(ADMIN_USER);
    const res = await request(buildApp())
      .delete('/api/auth/users/1')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.message.includes('deleted'));
  });

  it('returns 500 on database error', async () => {
    mockQueryFn = async () => { throw new Error('DB fail'); };
    const token = makeToken(ADMIN_USER);
    const res = await request(buildApp())
      .delete('/api/auth/users/1')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 500);
  });
});
