/**
 * Notifications — services/notifications.js and routes/notifications.js.
 * Uses an in-memory stand-in for the databases (no real database is touched).
 * Run: node --test test/notifications.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-notifications-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

// users in the auth DB
const USERS = [
  { id: 1, role: 'admin', barangay_id: null, status: 'active' },
  { id: 2, role: 'admin', barangay_id: null, status: 'active' },
  { id: 10, role: 'staff', barangay_id: 17, status: 'active' },   // Rosario
  { id: 11, role: 'staff', barangay_id: 17, status: 'inactive' }, // Rosario, deactivated
  { id: 12, role: 'staff', barangay_id: 12, status: 'active' },   // Maybunga
];
let rows; let nextId; let failInsert;

function pasigQuery(sql, params = []) {
  const q = String(sql).replace(/\s+/g, ' ').trim();
  if (q.startsWith('INSERT INTO notifications')) {
    if (failInsert) throw new Error('db down');
    for (const u of params[0]) {
      rows.push({ id: nextId++, user_id: u, type: params[1], severity: params[2], title: params[3], message: params[4],
        link: params[5], entity_type: params[6], entity_id: params[7], is_read: false, created_at: new Date() });
    }
    return { rowCount: params[0].length, rows: [] };
  }
  if (q.startsWith('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = false')) {
    return { rows: [{ n: rows.filter(r => r.user_id === params[0] && !r.is_read).length }] };
  }
  if (q.startsWith('UPDATE notifications SET is_read = true, read_at = NOW() WHERE user_id = $1')) {
    const mine = rows.filter(r => r.user_id === params[0] && !r.is_read);
    mine.forEach(r => { r.is_read = true; });
    return { rowCount: mine.length, rows: [] };
  }
  if (q.startsWith('UPDATE notifications SET is_read = $3')) {
    const r = rows.find(x => x.id === params[0] && x.user_id === params[1]);
    if (!r) return { rowCount: 0, rows: [] };
    r.is_read = params[2];
    return { rowCount: 1, rows: [{ id: r.id, is_read: r.is_read }] };
  }
  if (q.startsWith('UPDATE notifications SET is_read = true, read_at = NOW() WHERE entity_type')) {
    rows.filter(r => r.entity_type === params[0] && r.entity_id === params[1] && (!params[2] || params[2].includes(r.type)))
      .forEach(r => { r.is_read = true; });
    return { rowCount: 0, rows: [] };
  }
  if (q.startsWith('SELECT id, type, severity')) {
    let list = rows.filter(r => r.user_id === params[0]);
    if (q.includes('AND is_read = false')) list = list.filter(r => !r.is_read);
    return { rows: list.slice().reverse() };
  }
  if (q.startsWith('SELECT COUNT(*)::int AS total')) {
    let list = rows.filter(r => r.user_id === params[0]);
    if (q.includes('AND is_read = false')) list = list.filter(r => !r.is_read);
    return { rows: [{ total: list.length, unread: rows.filter(r => r.user_id === params[0] && !r.is_read).length }] };
  }
  return { rows: [] };
}
function authQuery(sql, params = []) {
  const q = String(sql).replace(/\s+/g, ' ');
  let list = USERS.filter(u => u.status === 'active');
  if (q.includes("role = 'staff' AND barangay_id = $1")) list = list.filter(u => u.role === 'staff' && u.barangay_id === params[0]);
  else if (q.includes("role = 'admin'")) list = list.filter(u => u.role === 'admin');
  return { rows: list.map(u => ({ id: u.id })) };
}

stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {} });
stub('../db/pasigSchema', {
  pool: { query: async (s, p) => pasigQuery(s, p) },
  authPool: { query: async (s, p) => authQuery(s, p) },
});

const notifications = require('../services/notifications');
const router = require('../routes/notifications');

let server; let url;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth/notifications', router);
  await new Promise(r => { server = app.listen(0, r); });
  url = `http://127.0.0.1:${server.address().port}/api/auth/notifications`;
});
after(() => server.close());
beforeEach(() => { rows = []; nextId = 1; failInsert = false; });

const call = async (userId, method, path = '', role = 'staff') => {
  const token = jwt.sign({ id: userId, username: `u${userId}`, role }, SECRET);
  const res = await fetch(`${url}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
};

describe('services/notifications', () => {
  it('notifies only active staff of the barangay, never the actor', async () => {
    await notifications.notifyBarangay(17, { type: 'referral_received', title: 'Incoming referral', actorId: 12 });
    assert.deepStrictEqual(rows.map(r => r.user_id), [10]); // 11 is inactive
    rows = [];
    await notifications.notify([10, 10, 12], { type: 'x', title: 't', actorId: 12 });
    assert.deepStrictEqual(rows.map(r => r.user_id), [10]); // de-duplicated, actor skipped
  });

  it('can notify the actor about an operational outcome', async () => {
    await notifications.notify([10, 10], {
      type: 'import_completed', title: 'Import completed', actorId: 10, includeActor: true,
    });
    assert.deepStrictEqual(rows.map(r => r.user_id), [10]);
    assert.strictEqual(rows[0].type, 'import_completed');
  });

  it('falls back to admins when the barangay has no active staff', async () => {
    await notifications.notifyBarangay(99, { type: 'referral_received', title: 'Incoming referral', actorId: 1 });
    assert.deepStrictEqual(rows.map(r => r.user_id), [2]);
  });

  it('never throws when the database fails', async () => {
    failInsert = true;
    assert.strictEqual(await notifications.notify([10], { type: 'x', title: 't' }), 0);
  });

  it('resolveEntity marks the pending inbox notification read for everyone', async () => {
    await notifications.notify([10, 1], { type: 'referral_received', title: 't', entityType: 'case_transfer', entityId: 5 });
    await notifications.resolveEntity('case_transfer', 5, ['referral_received']);
    assert.ok(rows.every(r => r.is_read));
  });
});

describe('routes/notifications', () => {
  beforeEach(async () => {
    await notifications.notify([10], { type: 'a', title: 'one' });
    await notifications.notify([10], { type: 'b', title: 'two' });
    await notifications.notify([12], { type: 'c', title: 'other user' });
  });

  it('counts and lists only the signed-in user\'s notifications', async () => {
    assert.strictEqual((await call(10, 'GET', '/unread-count')).body.count, 2);
    const list = await call(10, 'GET', '?status=unread&limit=5');
    assert.deepStrictEqual(list.body.notifications.map(n => n.title), ['two', 'one']);
    assert.strictEqual(list.body.unread, 2);
  });

  it('marks one read, and refuses someone else\'s notification', async () => {
    const own = rows.find(r => r.user_id === 10);
    assert.strictEqual((await call(10, 'PUT', `/${own.id}/read`)).status, 200);
    assert.strictEqual((await call(10, 'GET', '/unread-count')).body.count, 1);
    const theirs = rows.find(r => r.user_id === 12);
    assert.strictEqual((await call(10, 'PUT', `/${theirs.id}/read`)).status, 404);
    assert.strictEqual(theirs.is_read, false);
  });

  it('marks all read for the user only', async () => {
    assert.strictEqual((await call(10, 'PUT', '/read-all')).body.updated, 2);
    assert.strictEqual((await call(12, 'GET', '/unread-count')).body.count, 1);
  });

  it('requires sign-in', async () => {
    const res = await fetch(`${url}/unread-count`);
    assert.strictEqual(res.status, 401);
  });
});
