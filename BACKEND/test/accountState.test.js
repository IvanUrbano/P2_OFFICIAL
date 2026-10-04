/**
 * Live account-state RBAC: authenticateToken uses the account's CURRENT role/status
 * from the users table, not the copy frozen into the JWT at login.
 * The DB module is stubbed; no database needed.
 * Run: node --test BACKEND/test/accountState.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.ACCOUNT_STATE_CHECK = 'on';
process.env.ACCOUNT_STATE_TTL_MS = '0'; // no caching between test cases
const TEST_SECRET = 'test-account-state-secret';

let accountRow = null;
let dbError = null;
const dbPath = require.resolve('../db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (sql, params) => {
      if (dbError) throw dbError;
      if (String(sql).includes('FROM users WHERE id = $1')) {
        return { rows: accountRow && Number(accountRow.id) === Number(params[0]) ? [accountRow] : [] };
      }
      return { rows: [] };
    },
  },
};

const { authenticateToken, authorizeRoles } = require('../middleware/auth');

function buildApp() {
  const app = express();
  app.get('/me', authenticateToken, (req, res) => res.json({ user: req.user }));
  app.get('/admin', authenticateToken, authorizeRoles('admin'), (req, res) => res.json({ ok: true }));
  return app;
}
const bearer = (payload) => `Bearer ${jwt.sign(payload, TEST_SECRET, { expiresIn: '1h' })}`;
const ADMIN_TOKEN_CLAIMS = { id: 7, username: 'formeradmin', role: 'admin' };

before(() => { process.env.JWT_SECRET = TEST_SECRET; });
after(() => { delete process.env.JWT_SECRET; delete process.env.ACCOUNT_STATE_CHECK; });
beforeEach(() => { accountRow = null; dbError = null; });

describe('authenticateToken — live account state', () => {
  it('uses the current role: an admin demoted to staff loses admin routes immediately', async () => {
    accountRow = { id: 7, role: 'staff', status: 'active', manually_locked: false, barangay_id: 3 };
    const res = await request(buildApp()).get('/admin').set('Authorization', bearer(ADMIN_TOKEN_CLAIMS));
    assert.strictEqual(res.status, 403);
  });

  it('passes the current role, facility and barangay on to the route', async () => {
    accountRow = { id: 7, role: 'staff', status: 'active', manually_locked: false, facility_id: null, barangay_id: 3 };
    const res = await request(buildApp()).get('/me').set('Authorization', bearer(ADMIN_TOKEN_CLAIMS));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.role, 'staff');
    assert.strictEqual(res.body.user.barangay_id, 3);
  });

  it('rejects a deactivated account even with an unexpired token', async () => {
    accountRow = { id: 7, role: 'admin', status: 'inactive', manually_locked: false };
    const res = await request(buildApp()).get('/me').set('Authorization', bearer(ADMIN_TOKEN_CLAIMS));
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error.includes('inactive'));
  });

  it('rejects an account locked by an administrator', async () => {
    accountRow = { id: 7, role: 'admin', status: 'active', manually_locked: true };
    const res = await request(buildApp()).get('/me').set('Authorization', bearer(ADMIN_TOKEN_CLAIMS));
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error.includes('locked'));
  });

  it('rejects a token for an account that no longer exists', async () => {
    accountRow = null;
    const res = await request(buildApp()).get('/me').set('Authorization', bearer(ADMIN_TOKEN_CLAIMS));
    assert.strictEqual(res.status, 401);
  });

  it('denies (503) instead of trusting token claims when the database is unreachable', async () => {
    dbError = new Error('connection refused');
    const res = await request(buildApp()).get('/admin').set('Authorization', bearer(ADMIN_TOKEN_CLAIMS));
    assert.strictEqual(res.status, 503);
  });

  it('lets an active admin through', async () => {
    accountRow = { id: 7, role: 'admin', status: 'active', manually_locked: false };
    const res = await request(buildApp()).get('/admin').set('Authorization', bearer(ADMIN_TOKEN_CLAIMS));
    assert.strictEqual(res.status, 200);
  });
});
