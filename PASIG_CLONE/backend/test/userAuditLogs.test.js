/**
 * User management audit logs.
 *
 * Every administrative account action writes exactly one audit event per concern:
 *
 *   POST   /register                -> USER_CREATED
 *   PUT    /users/:id               -> USER_UPDATED (name/email) and/or ROLE_CHANGED
 *                                       and/or BARANGAY_ASSIGNMENT_CHANGED and/or
 *                                       ACCOUNT_ACTIVATED/DEACTIVATED — each only
 *                                       when that field actually changed
 *   PATCH  /users/:id/status        -> ACCOUNT_ACTIVATED / ACCOUNT_DEACTIVATED
 *   POST   /users/:id/lock          -> ACCOUNT_LOCKED
 *   POST   /users/:id/unlock        -> ACCOUNT_UNLOCKED
 *   PUT    /users/:id/password      -> PASSWORD_RESET
 *
 * Role/barangay/status events carry { old, new } (barangay values are NAMES, not ids);
 * every event snapshots the actor's role (actorRole) and never contains a password.
 * GET /audit-logs joins users so entries display full names and roles.
 *
 * Run: node --test test/userAuditLogs.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-user-audit-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

const BARANGAY_NAMES = { 12: 'Maybunga', 17: 'Rosario', 30: 'Ugong' };

const USERS_SEED = () => ({
  2: { id: 2, username: 'maria.santos', full_name: 'Maria Santos', email: 'maria@pasig.gov.ph', role: 'staff', barangay_id: 17, status: 'active', created_at: '2026-01-01T00:00:00Z' },
  3: { id: 3, username: 'juan.reyes', full_name: 'Juan Reyes', email: null, role: 'admin', barangay_id: null, status: 'active', created_at: '2026-01-01T00:00:00Z' },
});

let users = USERS_SEED();
const authQueries = [];
const auditCalls = [];

const AUDIT_ROWS = [{
  id: 1, user_id: 3, username: 'juan.reyes', action: 'BARANGAY_ASSIGNMENT_CHANGED',
  target_user_id: 2, target_username: 'maria.santos', result: 'SUCCESS',
  ip_address: '127.0.0.1', details: { old: 'Rosario', new: 'Maybunga', oldId: 17, newId: 12, actorRole: 'admin' },
  created_at: '2026-10-03T13:15:00Z',
  actor_full_name: 'Juan Reyes', actor_role: 'admin',
  target_full_name: 'Maria Santos', target_role: 'staff',
}];

function returningUserRow(u) {
  return {
    id: u.id, full_name: u.full_name, username: u.username, email: u.email,
    role: u.role, barangay_id: u.barangay_id, status: u.status,
    created_at: u.created_at, created_by_user_id: u.created_by_user_id ?? null,
    must_change_password: u.must_change_password ?? false,
  };
}

function dispatch(sql, params) {
  const q = String(sql).replace(/\s+/g, ' ').trim();
  authQueries.push({ q, params });

  if (q.startsWith('SELECT a.*')) return { rows: AUDIT_ROWS.map(r => ({ ...r })) };
  if (q.startsWith('SELECT id, username, full_name, email, role, barangay_id, status FROM users WHERE id')) {
    const u = users[Number(params[0])];
    return { rows: u ? [returningUserRow(u)] : [] };
  }
  if (q.startsWith('SELECT status FROM users WHERE id')) {
    const u = users[Number(params[0])];
    return { rows: u ? [{ status: u.status }] : [] };
  }
  if (q.startsWith('SELECT id, username FROM users WHERE id')) {
    const u = users[Number(params[0])];
    return { rows: u ? [{ id: u.id, username: u.username }] : [] };
  }
  if (q.startsWith('SELECT id FROM users WHERE LOWER(username)')) return { rows: [] };
  if (q.startsWith('SELECT 1 FROM users WHERE LOWER(email)')) return { rows: [] };
  if (q.startsWith('SELECT 1 FROM barangays WHERE id')) {
    return { rows: BARANGAY_NAMES[Number(params[0])] ? [{ ok: 1 }] : [] };
  }
  if (q.includes('FROM barangays WHERE id = ANY')) {
    return {
      rows: (params[0] || []).map(id => ({ id, name: BARANGAY_NAMES[id] })).filter(r => r.name),
    };
  }
  if (q.startsWith('INSERT INTO users')) {
    const u = {
      id: 50, full_name: params[0], username: params[1], email: params[2],
      role: params[4], barangay_id: params[5], status: 'active',
      must_change_password: true, created_at: '2026-10-04T00:00:00Z', created_by_user_id: params[6],
    };
    users[50] = u;
    return { rows: [returningUserRow(u)] };
  }
  if (q.startsWith('UPDATE users SET full_name')) {
    const u = users[Number(params[5])];
    Object.assign(u, {
      full_name: params[0], email: params[1], role: params[2],
      barangay_id: params[3], status: params[4],
    });
    return { rows: [returningUserRow(u)] };
  }
  if (q.startsWith('UPDATE users SET status')) {
    const u = users[Number(params[1])];
    u.status = params[0];
    return { rows: [{ id: u.id, username: u.username, status: u.status }] };
  }
  if (q.includes('SET manually_locked = TRUE')) {
    const u = users[Number(params[0])];
    u.manually_locked = true;
    return { rows: [{ id: u.id, username: u.username }] };
  }
  if (q.includes('password_hash = $1')) {
    const u = users[Number(params[1])];
    if (u) u.must_change_password = true;
    return { rows: [] };
  }
  if (q.includes('SET failed_attempts = 0')) {
    const u = users[Number(params[0])];
    if (u) Object.assign(u, { failed_attempts: 0, manually_locked: false });
    return { rows: u ? [{ id: u.id, username: u.username }] : [] };
  }
  return { rows: [] };
}

stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {} });
stub('../db/pasigSchema', {
  pool: { query: async (sql, params) => dispatch(sql, params) },
  authPool: { query: async (sql, params) => dispatch(sql, params) },
});
stub('../utils/auditLogger', {
  logAuditEvent: async (params) => { auditCalls.push(JSON.parse(JSON.stringify(params))); },
});

const authRouter = require('../routes/auth');

let server; let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/auth`;
});
after(() => server.close());

beforeEach(() => {
  users = USERS_SEED();
  auditCalls.length = 0;
});

const adminToken = jwt.sign({ id: 3, username: 'juan.reyes', role: 'admin' }, SECRET);
const staffToken = jwt.sign({ id: 2, username: 'maria.santos', role: 'staff' }, SECRET);

async function call(token, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const actions = () => auditCalls.map(c => c.action);
const last = () => auditCalls[auditCalls.length - 1];

describe('register writes USER_CREATED with the barangay name', () => {
  it('records target, role, barangay name, actor role — and never the password', async () => {
    const r = await call(adminToken, 'POST', '/register', {
      full_name: 'Ana Cruz', username: 'ana.cruz', role: 'staff', barangay_id: 17,
    });
    assert.strictEqual(r.status, 201);

    assert.deepStrictEqual(actions(), ['USER_CREATED']);
    const e = last();
    assert.strictEqual(e.targetUserId, 50);
    assert.strictEqual(e.targetUsername, 'ana.cruz');
    assert.strictEqual(e.actorRole, 'admin');
    assert.deepStrictEqual(
      { role: e.details.role, barangayId: e.details.barangayId, barangayName: e.details.barangayName, access: e.details.access },
      { role: 'staff', barangayId: 17, barangayName: 'Rosario', access: 'barangay' },
    );
    assert.ok(!JSON.stringify(auditCalls).includes(r.body.tempPassword), 'temp password must never be logged');
  });
});

describe('PUT /users/:id emits one event per concern that changed', () => {
  it('name-only edit -> USER_UPDATED with old/new, nothing else', async () => {
    const r = await call(adminToken, 'PUT', '/users/2', { full_name: 'Maria B. Santos' });
    assert.strictEqual(r.status, 200);

    assert.deepStrictEqual(actions(), ['USER_UPDATED']);
    assert.deepStrictEqual(last().details, {
      old: { full_name: 'Maria Santos', email: 'maria@pasig.gov.ph' },
      new: { full_name: 'Maria B. Santos', email: 'maria@pasig.gov.ph' },
    });
  });

  it('role change -> ROLE_CHANGED plus the barangay loss it forces (admin is city-wide)', async () => {
    const r = await call(adminToken, 'PUT', '/users/2', { role: 'admin' });
    assert.strictEqual(r.status, 200);

    assert.deepStrictEqual(actions(), ['ROLE_CHANGED', 'BARANGAY_ASSIGNMENT_CHANGED']);
    assert.deepStrictEqual(auditCalls[0].details, { old: 'staff', new: 'admin' });
    assert.deepStrictEqual(auditCalls[1].details, { old: 'Rosario', new: null, oldId: 17, newId: null });
    assert.strictEqual(auditCalls[0].targetUserId, 2);
    assert.strictEqual(auditCalls[0].actorRole, 'admin');
  });

  it('barangay reassignment -> BARANGAY_ASSIGNMENT_CHANGED with names, not ids', async () => {
    const r = await call(adminToken, 'PUT', '/users/2', { barangay_id: 12 });
    assert.strictEqual(r.status, 200);

    assert.deepStrictEqual(actions(), ['BARANGAY_ASSIGNMENT_CHANGED']);
    assert.deepStrictEqual(last().details, { old: 'Rosario', new: 'Maybunga', oldId: 17, newId: 12 });
  });

  it('a no-change edit writes no audit rows', async () => {
    const r = await call(adminToken, 'PUT', '/users/2', {});
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(actions(), []);
  });
});

describe('status, lock, unlock, and password reset actions', () => {
  it('deactivate/activate log ACCOUNT_* with old/new status each way', async () => {
    const off = await call(adminToken, 'PATCH', '/users/2/status', { status: 'inactive' });
    assert.strictEqual(off.status, 200);
    assert.deepStrictEqual(actions(), ['ACCOUNT_DEACTIVATED']);
    assert.deepStrictEqual(last().details, { old: 'active', new: 'inactive' });
    assert.strictEqual(last().targetUsername, 'maria.santos');

    auditCalls.length = 0;
    const on = await call(adminToken, 'PATCH', '/users/2/status', { status: 'active' });
    assert.strictEqual(on.status, 200);
    assert.deepStrictEqual(actions(), ['ACCOUNT_ACTIVATED']);
    assert.deepStrictEqual(last().details, { old: 'inactive', new: 'active' });

    // Repeating the current status is a no-op for the audit trail.
    auditCalls.length = 0;
    const again = await call(adminToken, 'PATCH', '/users/2/status', { status: 'active' });
    assert.strictEqual(again.status, 200);
    assert.deepStrictEqual(actions(), []);
  });

  it('lock and unlock log ACCOUNT_LOCKED / ACCOUNT_UNLOCKED', async () => {
    const locked = await call(adminToken, 'POST', '/users/2/lock');
    assert.strictEqual(locked.status, 200);
    assert.deepStrictEqual(actions(), ['ACCOUNT_LOCKED']);
    assert.strictEqual(last().targetUserId, 2);

    auditCalls.length = 0;
    const unlocked = await call(adminToken, 'POST', '/users/2/unlock');
    assert.strictEqual(unlocked.status, 200);
    assert.deepStrictEqual(actions(), ['ACCOUNT_UNLOCKED']);
    assert.strictEqual(last().actorRole, 'admin');
  });

  it('admin password reset logs PASSWORD_RESET without the temporary password', async () => {
    const r = await call(adminToken, 'PUT', '/users/2/password');
    assert.strictEqual(r.status, 200);

    assert.deepStrictEqual(actions(), ['PASSWORD_RESET']);
    assert.strictEqual(last().targetUsername, 'maria.santos');
    assert.ok(!JSON.stringify(auditCalls).includes(r.body.tempPassword), 'temp password must never be logged');
  });
});

describe('GET /audit-logs resolves display names through users joins', () => {
  it('returns rows with actor/target full names and the actor role snapshot', async () => {
    const r = await call(adminToken, 'GET', '/audit-logs');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.logs.length, 1);
    const row = r.body.logs[0];
    assert.strictEqual(row.actor_full_name, 'Juan Reyes');
    assert.strictEqual(row.actor_role, 'admin');
    assert.strictEqual(row.target_full_name, 'Maria Santos');
    assert.strictEqual(row.details.actorRole, 'admin');

    const read = authQueries.find(x => x.q.startsWith('SELECT a.*'));
    assert.ok(read, 'the audit-log read query must run');
    assert.ok(read.q.includes('LEFT JOIN users au'), 'actor name/role join missing');
    assert.ok(read.q.includes('LEFT JOIN users tu'), 'target name join missing');
    assert.ok(read.q.includes('ORDER BY a.created_at DESC'));
  });

  it('is admin-only', async () => {
    const r = await call(staffToken, 'GET', '/audit-logs');
    assert.strictEqual(r.status, 403);
  });
});
