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
      k.includes('middleware/rateLimiter') ||
      k.includes('utils/passwordValidator') ||
      k.includes('utils/loginAttemptLogger') ||
      k.includes('utils/tempPasswordGenerator') ||
      k.includes('utils/auditLogger')
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
const STAFF_HASH = bcrypt.hashSync('Staffpass1', 4);
const ADMIN_HASH = bcrypt.hashSync('Adminpass1', 4);

const STAFF_USER = {
  id: 1, username: 'staff1', email: 'staff@test.com',
  password_hash: STAFF_HASH, role: 'staff',
  created_at: '2025-01-01T00:00:00Z',
};

const ADMIN_USER = {
  id: 2, username: 'admin1', email: 'admin@test.com',
  password_hash: ADMIN_HASH, role: 'admin',
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
  process.env.LOGIN_LIMIT_MAX = '100';
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
    assert.ok(res.body.error.includes('Invalid credentials'));
  });

  it('returns 401 for wrong password', async () => {
    mockQueryFn = async () => ({ rows: [STAFF_USER] });
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'staff@test.com', password: 'wrongpassword' });
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error.includes('Invalid credentials'));
  });

  it('returns user on valid login (no token in body)', async () => {
    mockQueryFn = async () => ({ rows: [STAFF_USER] });
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'staff@test.com', password: 'Staffpass1' });
    assert.strictEqual(res.status, 200);
    assert.ok(!res.body.token, 'token must not be in response body');
    assert.strictEqual(res.body.user.email, 'staff@test.com');
    assert.strictEqual(res.body.user.role, 'staff');
    assert.ok(!res.body.user.password_hash, 'password_hash must not be returned');
  });

  it('sets httpOnly cookie with token', async () => {
    mockQueryFn = async () => ({ rows: [STAFF_USER] });
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'staff@test.com', password: 'Staffpass1' });
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

  it('returns generic error message for wrong password (no enumeration)', async () => {
    // First call: user lookup returns user, second call: lockout check, third: log attempt, fourth: record failed
    let callCount = 0;
    mockQueryFn = async (sql) => {
      callCount++;
      const s = String(sql);
      if (s.includes('SELECT * FROM users')) return { rows: [STAFF_USER] };
      if (s.includes('locked_until')) return { rows: [{ locked_until: null }] };
      if (s.includes('INSERT INTO login_attempts')) return { rows: [] };
      if (s.includes('UPDATE users')) return { rows: [{ failed_attempts: 1, locked_until: null }] };
      return { rows: [] };
    };
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'staff@test.com', password: 'wrong' });
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error.includes('Invalid credentials'));
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
      .send({ username: 'new', email: 'new@test.com' });
    assert.strictEqual(res.status, 401);
  });

  it('returns 403 for non-admin user', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ username: 'new', email: 'new@test.com' });
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
      .send({ username: 'new', email: 'new@test.com', role: 'superadmin' });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Invalid role'));
  });

  it('returns 409 for duplicate user', async () => {
    mockQueryFn = async () => ({ rows: [{ id: 99 }] });
    const res = await request(buildApp())
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'dup', email: 'dup@test.com' });
    assert.strictEqual(res.status, 409);
    assert.ok(res.body.error.includes('already exists'));
  });

  it('returns 201 with temp password on successful registration', async () => {
    mockQueryFn = async (sql, params) => {
      const s = String(sql);
      if (s.includes('SELECT id FROM users')) return { rows: [] };
      if (s.includes('SELECT id FROM health_facilities')) return { rows: [{ id: 1 }] };
      if (s.includes('INSERT INTO users')) {
        return {
          rows: [{
            id: 10, username: params[0], email: params[1],
            role: params[3], facility_id: params[4], created_at: new Date().toISOString(),
          }],
        };
      }
      return { rows: [] };
    };
    const res = await request(buildApp())
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'newstaff', email: 'new@test.com', facility_id: 1 });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.user.username, 'newstaff');
    assert.strictEqual(res.body.user.email, 'new@test.com');
    assert.strictEqual(res.body.user.facility_id, 1);
    assert.ok(!res.body.user.password_hash, 'password_hash must not be returned');
    assert.ok(res.body.tempPassword, 'should return tempPassword');
    assert.ok(typeof res.body.tempPassword === 'string');
    assert.ok(res.body.tempPassword.length >= 8, 'temp password should be at least 8 chars');
  });

  it('defaults role to staff when not specified', async () => {
    let capturedRole;
    let capturedFacility;
    mockQueryFn = async (sql, params) => {
      const s = String(sql);
      if (s.includes('SELECT id FROM users')) return { rows: [] };
      if (s.includes('SELECT id FROM health_facilities')) return { rows: [{ id: 1 }] };
      if (s.includes('INSERT INTO users')) {
        capturedRole = params[3];
        capturedFacility = params[4];
        return { rows: [{ id: 10, username: params[0], email: params[1], role: params[3], facility_id: params[4], created_at: new Date() }] };
      }
      return { rows: [] };
    };
    await request(buildApp())
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'newstaff', email: 'new@test.com', facility_id: 1 });
    assert.strictEqual(capturedRole, 'staff');
    assert.strictEqual(capturedFacility, 1);
  });

  it('rejects staff registration without a facility', async () => {
    mockQueryFn = async (sql) => {
      const s = String(sql);
      if (s.includes('SELECT id FROM users')) return { rows: [] };
      return { rows: [] };
    };
    const res = await request(buildApp())
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'nofac', email: 'nofac@test.com', role: 'staff' });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('facility'));
  });

  it('rejects registration with an unknown facility', async () => {
    mockQueryFn = async (sql) => {
      const s = String(sql);
      if (s.includes('SELECT id FROM users')) return { rows: [] };
      if (s.includes('SELECT id FROM health_facilities')) return { rows: [] };
      return { rows: [] };
    };
    const res = await request(buildApp())
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'badfac', email: 'badfac@test.com', role: 'staff', facility_id: 9999 });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Unknown health facility'));
  });

  it('allows admin registration without a facility', async () => {
    mockQueryFn = async (sql, params) => {
      const s = String(sql);
      if (s.includes('SELECT id FROM users')) return { rows: [] };
      if (s.includes('INSERT INTO users')) {
        return { rows: [{ id: 11, username: params[0], email: params[1], role: params[3], facility_id: params[4], created_at: new Date() }] };
      }
      return { rows: [] };
    };
    const res = await request(buildApp())
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'newadmin', email: 'newadmin@test.com', role: 'admin' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.user.role, 'admin');
    assert.strictEqual(res.body.user.facility_id, null);
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

/* ═══════════════════════════════════════════════════════ */
/*                    PUT /api/auth/profile                */
/* ═══════════════════════════════════════════════════════ */

describe('PUT /api/auth/profile', () => {
  it('returns 401 without token', async () => {
    const res = await request(buildApp()).put('/api/auth/profile').send({ username: 'x', email: 'x@y.com' });
    assert.strictEqual(res.status, 401);
  });

  it('returns 400 when fields are missing', async () => {
    const token = makeToken(STAFF_USER);
    const res = await request(buildApp())
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'staff1' });
    assert.strictEqual(res.status, 400);
  });

  it('returns 409 when username/email is taken by another account', async () => {
    mockQueryFn = async () => ({ rows: [{ id: 2 }] });
    const token = makeToken(STAFF_USER);
    const res = await request(buildApp())
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'taken', email: 'taken@test.com' });
    assert.strictEqual(res.status, 409);
    assert.ok(res.body.error.includes('already in use'));
  });

  it('updates profile successfully', async () => {
    mockQueryFn = async (sql) => {
      if (String(sql).includes('UPDATE')) {
        return { rows: [{ id: 1, username: 'staff-new', email: 'staff-new@test.com', role: 'staff', created_at: '2025-01-01' }] };
      }
      return { rows: [] };
    };
    const token = makeToken(STAFF_USER);
    const res = await request(buildApp())
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'staff-new', email: 'staff-new@test.com' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.username, 'staff-new');
    assert.ok(res.body.message.includes('updated'));
  });

  it('returns 500 on database error', async () => {
    mockQueryFn = async () => { throw new Error('DB fail'); };
    const token = makeToken(STAFF_USER);
    const res = await request(buildApp())
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'a', email: 'a@b.com' });
    assert.strictEqual(res.status, 500);
  });
});

/* ═══════════════════════════════════════════════════════ */
/*                    PUT /api/auth/password               */
/* ═══════════════════════════════════════════════════════ */

describe('PUT /api/auth/password', () => {
  it('returns 401 without token', async () => {
    const res = await request(buildApp()).put('/api/auth/password').send({ currentPassword: 'x', newPassword: 'y' });
    assert.strictEqual(res.status, 401);
  });

  it('returns 400 when fields are missing', async () => {
    const token = makeToken(STAFF_USER);
    const res = await request(buildApp())
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Staffpass1' });
    assert.strictEqual(res.status, 400);
  });

  it('returns 400 when new password is too short', async () => {
    const token = makeToken(STAFF_USER);
    const res = await request(buildApp())
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Staffpass1', newPassword: 'Ab1' });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('8 characters'));
  });

  it('returns 400 when new password lacks uppercase', async () => {
    const token = makeToken(STAFF_USER);
    const res = await request(buildApp())
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Staffpass1', newPassword: 'weakpass1' });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('uppercase'));
  });

  it('returns 401 when current password is incorrect', async () => {
    mockQueryFn = async () => ({ rows: [{ id: 1, password_hash: STAFF_HASH }] });
    const token = makeToken(STAFF_USER);
    const res = await request(buildApp())
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrongpass', newPassword: 'Newpass1' });
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error.includes('incorrect'));
  });

  it('changes password successfully', async () => {
    mockQueryFn = async (sql) => {
      if (String(sql).includes('SELECT')) {
        return { rows: [{ id: 1, password_hash: STAFF_HASH }] };
      }
      return { rows: [] };
    };
    const token = makeToken(STAFF_USER);
    const res = await request(buildApp())
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Staffpass1', newPassword: 'Newpass1' });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.message.includes('changed'));
  });

  it('returns 500 on database error', async () => {
    mockQueryFn = async () => { throw new Error('DB fail'); };
    const token = makeToken(STAFF_USER);
    const res = await request(buildApp())
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'x', newPassword: 'Abcdefg1' });
    assert.strictEqual(res.status, 500);
  });
});

/* ═══════════════════════════════════════════════════════ */
/*            PUT /api/auth/users/:id/password             */
/* ═══════════════════════════════════════════════════════ */

describe('PUT /api/auth/users/:id/password', () => {
  const adminToken = makeToken(ADMIN_USER);
  const staffToken = makeToken(STAFF_USER);

  it('returns 401 without token', async () => {
    const res = await request(buildApp()).put('/api/auth/users/1/password');
    assert.strictEqual(res.status, 401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(buildApp())
      .put('/api/auth/users/1/password')
      .set('Authorization', `Bearer ${staffToken}`);
    assert.strictEqual(res.status, 403);
  });

  it('returns 404 when user not found', async () => {
    mockQueryFn = async () => ({ rows: [] });
    const res = await request(buildApp())
      .put('/api/auth/users/999/password')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.strictEqual(res.status, 404);
  });

  it('generates temp password and returns it once', async () => {
    mockQueryFn = async (sql) => {
      if (String(sql).includes('SELECT')) return { rows: [{ id: 1, username: 'staff1' }] };
      return { rows: [] };
    };
    const res = await request(buildApp())
      .put('/api/auth/users/1/password')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.message.includes('reset'));
    assert.ok(res.body.tempPassword, 'should return tempPassword');
    assert.ok(typeof res.body.tempPassword === 'string');
    assert.ok(res.body.tempPassword.length >= 8, 'temp password should be at least 8 chars');
  });

  it('temp password meets policy (uppercase, lowercase, digit)', () => {
    const { generateTempPassword } = require('../utils/tempPasswordGenerator');
    for (let i = 0; i < 10; i++) {
      const pw = generateTempPassword();
      assert.ok(/[A-Z]/.test(pw), `temp password "${pw}" should have uppercase`);
      assert.ok(/[a-z]/.test(pw), `temp password "${pw}" should have lowercase`);
      assert.ok(/[0-9]/.test(pw), `temp password "${pw}" should have digit`);
      assert.ok(pw.length >= 8, `temp password "${pw}" should be at least 8 chars`);
    }
  });

  it('temp password format matches XXXX-XXXX-XXXX-XXXX', () => {
    const { generateTempPassword } = require('../utils/tempPasswordGenerator');
    const pw = generateTempPassword();
    assert.ok(/^\w{4}-\w{4}-\w{4}-\w{4}$/.test(pw), `temp password "${pw}" should match format XXXX-XXXX-XXXX-XXXX`);
  });

  it('resets failed_attempts and locked_until on reset', async () => {
    let resetLockout = false;
    mockQueryFn = async (sql) => {
      const s = String(sql);
      if (s.includes('SELECT') && s.includes('FROM users')) return { rows: [{ id: 1, username: 'staff1' }] };
      if (s.includes('UPDATE users') && s.includes('failed_attempts = 0')) {
        resetLockout = true;
        return { rows: [] };
      }
      return { rows: [] };
    };
    await request(buildApp())
      .put('/api/auth/users/1/password')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.ok(resetLockout, 'should reset failed_attempts and locked_until');
  });
});

/* ═══════════════════════════════════════════════════════ */
/*            Account Lockout Tests                       */
/* ═══════════════════════════════════════════════════════ */

describe('Account Lockout', () => {
  it('returns 423 when account is locked', async () => {
    mockQueryFn = async (sql) => {
      const s = String(sql);
      if (s.includes('locked_until') && s.includes('SELECT')) {
        return { rows: [{ locked_until: new Date(Date.now() + 900000) }] };
      }
      return { rows: [] };
    };
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'locked@test.com', password: 'pass' });
    assert.strictEqual(res.status, 423);
    assert.ok(res.body.error.includes('locked'));
    assert.ok(res.body.retryAfter > 0);
  });

  it('allows login when lockout has expired', async () => {
    mockQueryFn = async (sql) => {
      const s = String(sql);
      if (s.includes('locked_until') && s.includes('SELECT')) {
        return { rows: [{ locked_until: new Date(Date.now() - 1000) }] };
      }
      if (s.includes('SELECT * FROM users')) return { rows: [STAFF_USER] };
      return { rows: [] };
    };
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'staff@test.com', password: 'Staffpass1' });
    assert.strictEqual(res.status, 200);
  });

  it('resets failed_attempts on successful login', async () => {
    let resetCalled = false;
    mockQueryFn = async (sql) => {
      const s = String(sql);
      if (s.includes('locked_until') && s.includes('SELECT')) {
        return { rows: [{ locked_until: null }] };
      }
      if (s.includes('SELECT * FROM users')) return { rows: [STAFF_USER] };
      if (s.includes('UPDATE users') && s.includes('failed_attempts = 0')) {
        resetCalled = true;
        return { rows: [] };
      }
      if (s.includes('INSERT INTO login_attempts')) return { rows: [] };
      return { rows: [] };
    };
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'staff@test.com', password: 'Staffpass1' });
    assert.strictEqual(res.status, 200);
    assert.ok(resetCalled, 'failed_attempts should be reset on success');
  });
});

/* ═══════════════════════════════════════════════════════ */
/*            Password Policy Tests                       */
/* ═══════════════════════════════════════════════════════ */

describe('Password Policy', () => {
  const { validatePassword } = require('../utils/passwordValidator');

  it('rejects password shorter than 8 characters', () => {
    const errors = validatePassword('Ab1');
    assert.ok(errors.some(e => e.includes('8 characters')));
  });

  it('rejects password without uppercase', () => {
    const errors = validatePassword('alllower1');
    assert.ok(errors.some(e => e.includes('uppercase')));
  });

  it('rejects password without lowercase', () => {
    const errors = validatePassword('ALLUPPER1');
    assert.ok(errors.some(e => e.includes('lowercase')));
  });

  it('rejects password without number', () => {
    const errors = validatePassword('NoNumberHere');
    assert.ok(errors.some(e => e.includes('number')));
  });

  it('accepts valid strong password', () => {
    const errors = validatePassword('StrongPass1');
    assert.strictEqual(errors.length, 0);
  });

  it('accepts password with exactly 8 characters', () => {
    const errors = validatePassword('Abcdef1x');
    assert.strictEqual(errors.length, 0);
  });
});
