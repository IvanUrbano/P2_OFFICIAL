/**
 * Live account-state RBAC: authenticate() uses the account's CURRENT role/status from
 * the shared users table, not the copy frozen into the JWT at login.
 * Database and config are stubbed; no database needed.
 * Run: node --test test/accountState.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.ACCOUNT_STATE_CHECK = 'on';
process.env.ACCOUNT_STATE_TTL_MS = '0';
const SECRET = 'test-pasig-account-state';

function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

let accountRow = null;
let dbError = null;
stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' } });
stub('../db/pasigSchema', {
  authPool: {
    query: async (sql, params) => {
      if (dbError) throw dbError;
      return { rows: accountRow && Number(accountRow.id) === Number(params[0]) ? [accountRow] : [] };
    },
  },
});

const { authenticate, authorizeRoles } = require('../middleware/auth');

/** Runs authenticate (+ optional role check) and reports the outcome. */
async function run(claims, roles) {
  const token = jwt.sign(claims, SECRET, { expiresIn: '1h' });
  const req = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
  const out = { status: 200, body: null, passed: false };
  const res = {
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; },
  };
  await authenticate(req, res, () => {
    if (!roles) { out.passed = true; return; }
    authorizeRoles(...roles)(req, res, () => { out.passed = true; });
  });
  return { ...out, user: req.user };
}

const CLAIMS = { id: 7, username: 'formeradmin', role: 'admin', facility_id: 40 };

beforeEach(() => { accountRow = null; dbError = null; });

describe('authenticate — live account state', () => {
  it('an admin demoted to staff loses admin routes on the next request', async () => {
    accountRow = { id: 7, role: 'staff', status: 'active', manually_locked: false, facility_id: null, barangay_id: 3 };
    const r = await run(CLAIMS, ['admin']);
    assert.strictEqual(r.passed, false);
    assert.strictEqual(r.status, 403);
  });

  it('replaces token role/facility with the current values', async () => {
    accountRow = { id: 7, role: 'staff', status: 'active', manually_locked: false, facility_id: null, barangay_id: 3 };
    const r = await run(CLAIMS);
    assert.strictEqual(r.passed, true);
    assert.strictEqual(r.user.role, 'staff');
    assert.strictEqual(r.user.facility_id, null, 'stale facility_id from the token is not trusted');
    assert.strictEqual(r.user.barangay_id, 3);
  });

  it('rejects a deactivated account', async () => {
    accountRow = { id: 7, role: 'admin', status: 'inactive', manually_locked: false };
    const r = await run(CLAIMS);
    assert.strictEqual(r.passed, false);
    assert.strictEqual(r.status, 401);
  });

  it('rejects an account locked by an administrator', async () => {
    accountRow = { id: 7, role: 'admin', status: 'active', manually_locked: true };
    const r = await run(CLAIMS);
    assert.strictEqual(r.passed, false);
    assert.strictEqual(r.status, 401);
  });

  it('denies with 503 when the account cannot be checked', async () => {
    dbError = new Error('connection refused');
    const r = await run(CLAIMS, ['admin']);
    assert.strictEqual(r.passed, false);
    assert.strictEqual(r.status, 503);
  });

  it('lets an active admin through', async () => {
    accountRow = { id: 7, role: 'admin', status: 'active', manually_locked: false };
    const r = await run(CLAIMS, ['admin']);
    assert.strictEqual(r.passed, true);
  });
});
