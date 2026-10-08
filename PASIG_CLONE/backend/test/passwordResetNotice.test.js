const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');

process.env.JWT_SECRET = 'password-notice-test-secret';

const dbPath = require.resolve('../db/pasigSchema');
const attemptsPath = require.resolve('../utils/loginAttemptLogger');
const authPath = require.resolve('../middleware/auth');
const routePath = require.resolve('../routes/auth');
const hash = bcrypt.hashSync('Staffpass1', 4);

function loginApp(mustChangePassword) {
  const user = {
    id: 5, username: 'staff5', email: 'staff5@test.com', role: 'staff',
    password_hash: hash, status: 'active', must_change_password: mustChangePassword,
    password_changed_at: new Date().toISOString(),
  };
  const authPool = { query: async (sql, params) => {
    if (String(sql).startsWith('SELECT * FROM users')) return { rows: [user] };
    if (String(sql).startsWith('SELECT id, password_hash FROM users')) return { rows: [user] };
    if (String(sql).startsWith('UPDATE users SET password_hash = $1')) {
      user.password_hash = params[0];
      user.must_change_password = false;
      user.password_changed_at = new Date().toISOString();
      return { rows: [] };
    }
    if (String(sql).includes('SELECT u.barangay_id')) return { rows: [{}] };
    return { rows: [] };
  } };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { authPool, pool: authPool } };
  require.cache[attemptsPath] = { id: attemptsPath, filename: attemptsPath, loaded: true, exports: {
    isAccountLocked: async () => false,
    getLockoutRemaining: async () => 0,
    logLoginAttempt: async () => {},
    recordFailedAttempt: async () => ({ locked: false }),
    resetFailedAttempts: async () => {},
  } };
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
    authenticate: (req, _res, next) => { req.user = { id: 5, username: 'staff5', role: 'staff' }; next(); },
    authorizeRoles: () => (_req, _res, next) => next(),
  } };
  delete require.cache[routePath];
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  return app;
}

describe('Pasig password reset notice', () => {
  it('stops appearing after the user changes their password', async () => {
    const res = await request(loginApp(false)).post('/api/auth/login')
      .send({ email: 'staff5', password: 'Staffpass1' });
    assert.equal(res.status, 200);
    assert.equal(res.body.passwordRecentlyChanged, false);
    assert.equal(res.body.mustChangePassword, false);
  });

  it('remains available while a temporary password is still in use', async () => {
    const res = await request(loginApp(true)).post('/api/auth/login')
      .send({ email: 'staff5', password: 'Staffpass1' });
    assert.equal(res.status, 200);
    assert.equal(res.body.passwordRecentlyChanged, true);
    assert.equal(res.body.mustChangePassword, true);
  });

  it('does not repeat after the first-login password is changed', async () => {
    const app = loginApp(true);
    const first = await request(app).post('/api/auth/login')
      .send({ email: 'staff5', password: 'Staffpass1' });
    assert.equal(first.body.mustChangePassword, true);
    const changed = await request(app).put('/api/auth/password')
      .send({ currentPassword: 'Staffpass1', newPassword: 'Changedpass2' });
    assert.equal(changed.status, 200);
    const next = await request(app).post('/api/auth/login')
      .send({ email: 'staff5', password: 'Changedpass2' });
    assert.equal(next.status, 200);
    assert.equal(next.body.mustChangePassword, false);
    assert.equal(next.body.passwordRecentlyChanged, false);
  });
});
