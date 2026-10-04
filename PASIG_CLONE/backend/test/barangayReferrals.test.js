/**
 * Barangay referral flow, end to end through the transfers routes, against a small
 * in-memory stand-in for the database (no real database is touched). The stand-in
 * mimics migration 008's triggers by retaining names from the relationship IDs.
 *
 * Lifecycle: PENDING -> ACCEPTED / REJECTED / CANCELLED.
 * Maybunga patient, handled by Maybunga staff, referred to Rosario:
 *   pending  → Rosario sees it in the inbox without the patient's name, cannot open it
 *   accepted → Rosario responsible (view + edit); Maybunga keeps view only
 * Run: node --test test/barangayReferrals.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-referrals-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

// ---------- in-memory data ----------
const BARANGAY_IDS = { maybunga: 11, rosario: 17, pineda: 15 };
const idOf = (name) => (name ? BARANGAY_IDS[String(name).trim().toLowerCase()] ?? null : null);
const nameOfId = (id) => {
  const entry = Object.entries(BARANGAY_IDS).find(([, v]) => v === Number(id));
  return entry ? entry[0][0].toUpperCase() + entry[0].slice(1) : null;
};
const STAFF = { 21: 'Maybunga', 22: 'Rosario', 23: 'Pineda' };

const cases = [{ id: 1, barangay_name: 'Maybunga', barangay_id: 11, responsible_barangay: null,
  responsible_barangay_id: null, is_archived: false, match_status: 'none', merged_into_case_no: null,
  case_no: 'CS-2026-000001', last_name: 'Dela Cruz', first_name: 'Juan', middle_name: null, suffix: null }];
const transfers = [];
const caseHistoryRows = [];   // routes/transfers.js INSERT INTO case_history (responsibility moved)
const caseReviewRows = [];    // services/caseFollowUp.logReviews (referral decisions)

function poolQuery(sql, params = []) {
  const q = String(sql).replace(/\s+/g, ' ').trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(q)) return { rows: [] };
  if (q.startsWith('SELECT id, name FROM barangay_ref WHERE id = $1')) {
    const match = Object.entries(BARANGAY_IDS).find(([, id]) => id === Number(params[0]));
    return { rows: match ? [{ id: match[1], name: match[0][0].toUpperCase() + match[0].slice(1) }] : [] };
  }
  if (q.startsWith('SELECT id, name FROM barangay_ref WHERE lower(trim(name))')) {
    const match = Object.entries(BARANGAY_IDS).find(([name]) => name === String(params[0]).toLowerCase());
    return { rows: match ? [{ id: match[1], name: match[0][0].toUpperCase() + match[0].slice(1) }] : [] };
  }
  if (q.includes('FROM validated_tb_cases WHERE id = $1 AND is_archived = false')) {
    return { rows: cases.filter(c => c.id === Number(params[0]) && !c.is_archived) };
  }
  if (q.startsWith("SELECT 1 FROM case_transfers WHERE validated_case_id = $1 AND status = 'pending'")) {
    return { rows: transfers.filter(t => t.validated_case_id === Number(params[0]) && t.status === 'pending') };
  }
  if (q.startsWith('INSERT INTO case_transfers')) {
    // routes/transfers.js writes the ids only — the database (migration 008 trigger)
    // derives the display names from them, so this stand-in does the same.
    const [validated_case_id, from_barangay_id, to_barangay_id, to_facility_id, transfer_type,
      initiated_by_user_id, reason] = params;
    const t = { id: transfers.length + 1, validated_case_id: Number(validated_case_id),
      from_barangay_id, to_barangay_id,
      from_barangay: nameOfId(from_barangay_id), to_barangay: nameOfId(to_barangay_id),
      to_facility_id, from_facility_id: null, transfer_type, status: 'pending',
      initiated_by_user_id, initiated_at: new Date().toISOString(),
      reason, notes: reason, created_at: new Date().toISOString() };
    transfers.push(t);
    return { rows: [t] };
  }
  if (q.startsWith('SELECT * FROM case_transfers WHERE id = $1')) {
    return { rows: transfers.filter(t => t.id === Number(params[0])) };
  }
  if (q.startsWith("UPDATE case_transfers SET status = 'accepted'")) {
    const t = transfers.find(x => x.id === Number(params[1]) && x.status === 'pending');
    if (!t) return { rows: [] };
    Object.assign(t, { status: 'accepted', reviewed_by_user_id: params[0], reviewed_at: 'now' });
    return { rows: [t] };
  }
  if (q.startsWith('UPDATE validated_tb_cases SET responsible_barangay_id')) {
    const c = cases.find(x => x.id === Number(params[1]));
    c.responsible_barangay_id = c.barangay_id === Number(params[0]) ? null : Number(params[0]);
    c.responsible_barangay = c.responsible_barangay_id == null
      ? null
      : Object.keys(BARANGAY_IDS).find(name => BARANGAY_IDS[name] === c.responsible_barangay_id);
    return { rows: [] };
  }
  if (q.startsWith("UPDATE case_transfers SET status = 'rejected'") || q.startsWith("UPDATE case_transfers SET status = 'cancelled'")) {
    const t = transfers.find(x => x.id === Number(params[1]) && x.status === 'pending');
    if (!t) return { rows: [] };
    // Either way the review columns record who closed it and when (migration 009).
    Object.assign(t, {
      status: q.includes("'rejected'") ? 'rejected' : 'cancelled',
      reviewed_by_user_id: params[0], reviewed_at: 'now',
    });
    return { rows: [t] };
  }
  if (q.startsWith('SELECT ct.*')) {
    const bid = params.length ? Number(params[0]) : null;
    const rows = transfers
      .filter(t => bid == null || t.from_barangay_id === bid || t.to_barangay_id === bid)
      .map(t => {
        const c = cases.find(x => x.id === t.validated_case_id);
        return { ...t, case_no: c.case_no, patient_no: null, last_name: c.last_name, first_name: c.first_name,
          middle_name: c.middle_name, suffix: c.suffix, barangay_name: c.barangay_name, barangay_id: c.barangay_id,
          responsible_barangay: c.responsible_barangay, responsible_barangay_id: c.responsible_barangay_id };
      });
    return { rows };
  }
  // --- history writes (routes/transfers.js + services/caseFollowUp.js) ---
  if (q.startsWith('SELECT case_no, barangay_id, responsible_barangay_id FROM validated_tb_cases WHERE id = $1')) {
    const c = cases.find(x => x.id === Number(params[0]));
    return { rows: c ? [{ case_no: c.case_no, barangay_id: c.barangay_id, responsible_barangay_id: c.responsible_barangay_id }] : [] };
  }
  if (q.startsWith('SELECT case_no FROM validated_tb_cases WHERE id = $1')) {
    const c = cases.find(x => x.id === Number(params[0]));
    return { rows: c ? [{ case_no: c.case_no }] : [] };
  }
  if (q.startsWith('INSERT INTO case_review_history')) {
    const entries = JSON.parse(params[0]);
    for (const e of entries) caseReviewRows.push({ ...e, reviewed_by_user_id: params[1], reviewed_at: 'now' });
    return { rows: [] };
  }
  if (q.startsWith('INSERT INTO case_history')) {
    caseHistoryRows.push({
      validated_case_id: Number(params[0]), case_no: params[1],
      change_type: 'transferred', changed_fields: JSON.parse(params[2]),
      source: 'transfer', changed_by_user_id: params[3], notes: params[4], changed_at: 'now',
    });
    return { rows: [] };
  }
  throw new Error(`Unexpected pool query: ${q.slice(0, 90)}`);
}

function authQuery(sql, params = []) {
  const q = String(sql).replace(/\s+/g, ' ');
  if (q.includes('FROM users u JOIN barangays b')) {
    const name = STAFF[Number(params[0])];
    return { rows: name ? [{ barangay_id: idOf(name), barangay_name: name }] : [] };
  }
  return { rows: [] }; // audit log, facility/user name lookups
}

stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' } });
stub('../db/pasigSchema', {
  pool: {
    query: async (sql, params) => poolQuery(sql, params),
    connect: async () => ({ query: async (sql, params) => poolQuery(sql, params), release() {} }),
  },
  authPool: { query: async (sql, params) => authQuery(sql, params) },
});
stub('../utils/auditLogger', { logAuditEvent: async () => {} });

const { getCaseAccess } = require('../policies/caseAccessPolicy');
const transfersRouter = require('../routes/transfers');

// ---------- tiny HTTP harness ----------
let server; let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/data/transfers', transfersRouter);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/data/transfers`;
});
after(() => server.close());

const token = (id) => jwt.sign({ id, username: `u${id}`, role: 'staff' }, SECRET);
async function call(userId, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token(userId)}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const MAYBUNGA = 21; const ROSARIO = 22; const PINEDA = 23;
const scopeOf = (name) => ({ barangay_id: idOf(name), barangay_name: name });

describe('barangay referral flow', () => {
  it('only the responsible barangay can refer the case', async () => {
    const r = await call(ROSARIO, 'POST', '/', { validated_case_id: 1, to_barangay: 'Rosario', transfer_type: 'referral' });
    assert.strictEqual(r.status, 403);
  });

  it('rejects an unknown receiving barangay', async () => {
    const r = await call(MAYBUNGA, 'POST', '/', { validated_case_id: 1, to_barangay_id: 999, transfer_type: 'referral' });
    assert.strictEqual(r.status, 400);
  });

  it('Maybunga refers the case to Rosario (pending) with a reason', async () => {
    const r = await call(MAYBUNGA, 'POST', '/', { validated_case_id: 1, to_barangay_id: 17, transfer_type: 'referral', reason: 'Closer to work' });
    assert.strictEqual(r.status, 201);
    const t = r.body.transfer;
    assert.strictEqual(t.from_barangay, 'Maybunga');
    assert.strictEqual(t.to_barangay, 'Rosario');
    assert.strictEqual(t.to_barangay_id, 17);
    assert.strictEqual(t.reason, 'Closer to work');
    assert.strictEqual(cases[0].responsible_barangay_id, null, 'pending grants nothing yet');

    const sent = caseReviewRows.filter(r => r.validated_case_id === 1 && r.decision === 'sent');
    assert.strictEqual(sent.length, 1, 'sending writes a review-history event');
    assert.strictEqual(sent[0].new_status, 'pending');
    assert.strictEqual(sent[0].notes, 'Closer to work');
    assert.strictEqual(caseHistoryRows.length, 0, 'sending does not move responsibility');
  });

  it('a second referral is refused while one is pending', async () => {
    const r = await call(MAYBUNGA, 'POST', '/', { validated_case_id: 1, to_barangay_id: 15, transfer_type: 'referral' });
    assert.strictEqual(r.status, 409);
  });

  it("Rosario's inbox shows the pending referral WITHOUT the patient's name", async () => {
    const t = (await call(ROSARIO, 'GET', '/')).body.transfers[0];
    assert.strictEqual(t.direction, 'incoming');
    assert.strictEqual(t.permissions.accept, true);
    assert.strictEqual(t.permissions.reject, true);
    assert.strictEqual(t.permissions.viewCase, false);
    assert.strictEqual(t.identity_hidden, true);
    assert.strictEqual(t.last_name, null);
  });

  it('an unrelated barangay sees nothing and cannot accept', async () => {
    assert.strictEqual((await call(PINEDA, 'GET', '/')).body.transfers.length, 0);
    assert.strictEqual((await call(PINEDA, 'PUT', '/1/accept')).status, 403);
  });

  it('the sender cannot accept its own referral', async () => {
    assert.strictEqual((await call(MAYBUNGA, 'PUT', '/1/accept')).status, 403);
  });

  it('Rosario accepts: Rosario responsible (by id); Maybunga keeps view only; reviewer recorded', async () => {
    const r = await call(ROSARIO, 'PUT', '/1/accept');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.transfer.reviewed_by_user_id, ROSARIO);
    assert.strictEqual(cases[0].responsible_barangay_id, 17);
    assert.strictEqual(cases[0].barangay_id, 11, "patient's barangay never changes");

    const staff = { role: 'staff' };
    assert.deepStrictEqual(getCaseAccess(staff, scopeOf('Rosario'), cases[0]),
      { canView: true, canEdit: true, basis: 'referred_in' });
    assert.deepStrictEqual(getCaseAccess(staff, scopeOf('Maybunga'), cases[0]),
      { canView: true, canEdit: false, basis: 'referred_out' });
    assert.strictEqual(getCaseAccess(staff, scopeOf('Pineda'), cases[0]).canView, false);

    const moved = caseHistoryRows.filter(h => h.validated_case_id === 1 && h.change_type === 'transferred');
    assert.strictEqual(moved.length, 1, 'accept writes a responsibility-change event');
    assert.strictEqual(moved[0].changed_fields.responsible_barangay.old, 'Maybunga');
    assert.strictEqual(moved[0].changed_fields.responsible_barangay.new, 'Rosario');
    assert.strictEqual(moved[0].changed_fields.responsible_barangay_id.old, null);
    assert.strictEqual(moved[0].changed_fields.responsible_barangay_id.new, 17);
    assert.strictEqual(moved[0].changed_by_user_id, ROSARIO, 'the accepting user is recorded');
    const acceptedReviews = caseReviewRows.filter(r => r.validated_case_id === 1 && r.decision === 'accepted');
    assert.strictEqual(acceptedReviews.length, 1);
    assert.strictEqual(acceptedReviews[0].previous_status, 'pending');
    assert.strictEqual(acceptedReviews[0].new_status, 'accepted');
  });

  it('accepted is final: no complete step exists', async () => {
    assert.strictEqual((await call(ROSARIO, 'PUT', '/1/complete')).status, 404);
    const t = (await call(ROSARIO, 'GET', '/')).body.transfers[0];
    assert.strictEqual(t.permissions.viewCase, true);
    assert.notStrictEqual(t.last_name, null);
    assert.strictEqual(t.permissions.accept, false);
  });

  it('the view-only home barangay cannot refer onward', async () => {
    const r = await call(MAYBUNGA, 'POST', '/', { validated_case_id: 1, to_barangay: 'Pineda', transfer_type: 'referral' });
    assert.strictEqual(r.status, 403);
  });

  it('Rosario refers back home; accepting clears the override', async () => {
    const sent = await call(ROSARIO, 'POST', '/', { validated_case_id: 1, to_barangay: 'Maybunga', transfer_type: 'transfer' });
    assert.strictEqual(sent.status, 201);
    assert.strictEqual((await call(MAYBUNGA, 'PUT', `/${sent.body.transfer.id}/accept`)).status, 200);
    assert.strictEqual(cases[0].responsible_barangay_id, null);
  });

  it('the receiver rejects a pending referral → REJECTED with reviewer', async () => {
    const movedBefore = caseHistoryRows.filter(h => h.change_type === 'transferred').length;
    const sent = await call(MAYBUNGA, 'POST', '/', { validated_case_id: 1, to_barangay: 'Pineda', transfer_type: 'referral' });
    const r = await call(PINEDA, 'PUT', `/${sent.body.transfer.id}/cancel?action=reject`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.transfer.status, 'rejected');
    assert.strictEqual(r.body.transfer.reviewed_by_user_id, PINEDA);
    assert.strictEqual(cases[0].responsible_barangay_id, null);
    assert.strictEqual(caseReviewRows.filter(x => x.decision === 'rejected').length, 1, 'the rejection is reviewed');
    assert.strictEqual(caseHistoryRows.filter(h => h.change_type === 'transferred').length, movedBefore,
      'rejection does not move responsibility');
  });

  it('the sender cancels a pending referral → CANCELLED', async () => {
    const movedBefore = caseHistoryRows.filter(h => h.change_type === 'transferred').length;
    const sent = await call(MAYBUNGA, 'POST', '/', { validated_case_id: 1, to_barangay: 'Rosario', transfer_type: 'referral' });
    const r = await call(MAYBUNGA, 'PUT', `/${sent.body.transfer.id}/cancel`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.transfer.status, 'cancelled');
    assert.strictEqual(r.body.transfer.reviewed_by_user_id, MAYBUNGA, 'the cancel records who closed it');
    assert.strictEqual(caseReviewRows.filter(x => x.decision === 'cancelled').length, 1, 'the cancel is reviewed');
    assert.strictEqual(caseHistoryRows.filter(h => h.change_type === 'transferred').length, movedBefore,
      'cancel does not move responsibility');
  });
});
