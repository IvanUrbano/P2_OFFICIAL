/**
 * Validation role-based permissions.
 *
 *   - Staff SEE the results of their imports (visibility union: own uploads OR own
 *     barangay), but the upload never grants edit rights — uploaded_by is not part of
 *     any permission decision. Edits are decided by the record's barangay id, or by
 *     admin for unassigned (barangay_id NULL) rows and master-data assignments.
 *   - Data issues: fix/exclude only in the own barangay; other barangay -> 403 naming
 *     that barangay; unassigned -> 403 pointing at the administrator.
 *   - Needs Assignment (location/facility mapping) is admin-only at every endpoint.
 *   - Running validation on a batch writes batch metadata: uploader or admin only.
 *   - Match resolution goes through assertCaseAction: another barangay's case -> 403.
 * Run: node --test test/validationPermissions.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-validation-perms-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

// Every SQL statement the fake pool sees, for assertions on scoping.
const poolQueries = [];
const authQueries = [];

/**
 * Staff scopes by user id: 1 -> Rosario (17), 2 -> Maybunga (12), 3 -> none.
 * uploaded_by in this suite: 1 (Rosario staff) uploaded the mixed file "b-own".
 */
const SCOPES = { 1: { barangay_id: 17, barangay_name: 'Rosario' }, 2: { barangay_id: 12, barangay_name: 'Maybunga' } };

const ISSUES = [
  { // another barangay's row — visible only because staff 1 uploaded it
    id: 11, batch_id: 'b-own', row_number: 5, source_type: 'DSTB',
    record: { last_name: 'Dela Cruz', first_name: 'Ana', age: null, barangay_name: 'Maybunga' },
    errors: ['Age is required'], warnings: [],
    barangay_id: 12, barangay_name: 'Maybunga', status: 'open', filename: 'Mixed_Pasig.xlsx',
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  },
  { // unassigned row (barangay never matched) — admin only
    id: 12, batch_id: 'b-own', row_number: 9, source_type: 'DSTB',
    record: { last_name: 'Santos', first_name: 'Juan', age: null, barangay_name: 'Rosrio' },
    errors: ['Age is required'], warnings: [],
    barangay_id: null, barangay_name: 'Rosrio', status: 'open', filename: 'Mixed_Pasig.xlsx',
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  },
  { // own barangay — staff may fix
    id: 13, batch_id: 'b-own', row_number: 12, source_type: 'DSTB',
    record: { last_name: 'Reyes', first_name: 'Liza', age: null, barangay_name: 'Rosario' },
    errors: ['Age is required'], warnings: [],
    barangay_id: 17, barangay_name: 'Rosario', status: 'open', filename: 'Mixed_Pasig.xlsx',
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  },
];

const CASE_ROSARIO = {
  id: 900, case_no: 'TB-2026-0001', barangay_id: 17, barangay_name: 'Rosario',
  responsible_barangay_id: null, match_status: 'pending', match_candidate_case_no: null,
  match_suggestion: 'same_case', is_archived: false, merged_into_case_no: null,
};

const validateCalls = [];

function dispatch(sql, params) {
  const q = String(sql).replace(/\s+/g, ' ').trim();
  poolQueries.push({ q, params });
  if (q.startsWith('SELECT * FROM validation_issues WHERE id')) {
    return { rows: ISSUES.filter(i => i.id === Number(params[0])) };
  }
  if (q.startsWith('SELECT COUNT(*)::int AS n FROM validation_issues')) {
    return { rows: [{ n: ISSUES.length }] };
  }
  if (q.startsWith('SELECT i.batch_id, COUNT(*)::int AS n')) return { rows: [] };
  if (q.includes('FROM validation_issues i LEFT JOIN import_batches')) {
    return { rows: ISSUES.map(r => ({ ...r })) };
  }
  if (q.includes('COUNT(DISTINCT norm_facility(f.name))') && !q.includes('GROUP BY v.batch_id')) return { rows: [{ names: 4 }] };
  if (q.includes('COUNT(*) FILTER') && !q.includes('GROUP BY v.batch_id')) {
    return { rows: [{ ready: 3, matches: 1, location: 2, facility: 1, assignment: 3 }] };
  }
  if (q.includes('GROUP BY v.batch_id')) return { rows: [] };
  if (q.includes('SELECT id, uploaded_by FROM import_batches WHERE id')) {
    const id = params[0];
    if (id === 'nope') return { rows: [] };
    return { rows: [{ id, uploaded_by: id === 'b-own' ? 1 : 999 }] };
  }
  if (q.includes('FROM import_batches')) {
    return {
      rows: [{ id: 'b-own', filename: 'Mixed_Pasig.xlsx', created_at: '2026-10-01T00:00:00Z', status: 'uploaded', sync_status: null, total_rows: 10, uploaded_by: 1 }],
    };
  }
  if (q.includes('FROM facility_ref')) {
    return { rows: [{ id: 1, name: 'Rosario HC', barangay_name: 'Rosario', ownership: 'public', facility_category: 'health_center', is_external: false, is_reference: true }] };
  }
  if (q.includes('FROM validated_tb_cases WHERE id = $1') || q.includes('FROM validated_tb_cases v WHERE id = $1')) {
    return { rows: [CASE_ROSARIO] };
  }
  if (q.includes('FROM validated_tb_cases')) return { rows: [] };
  return { rows: [] };
}

stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {} });
stub('../db/pasigSchema', {
  pool: {
    query: async (sql, params) => dispatch(sql, params),
    connect: async () => ({
      query: async (sql, params) => dispatch(sql, params),
      release() {},
    }),
  },
  authPool: {
    query: async (sql, params) => {
      authQueries.push(String(sql).replace(/\s+/g, ' '));
      const userId = Array.isArray(params) ? params[0] : null;
      return { rows: SCOPES[userId] ? [SCOPES[userId]] : [] };
    },
  },
});
stub('../utils/auditLogger', { logAuditEvent: async () => {} });

// Real validator, with validateBatch replaced by a fake (it would need a live database).
const validatorPath = require.resolve('../services/validator');
require(validatorPath);
const realValidator = require.cache[validatorPath].exports;
stub('../services/validator', {
  ...realValidator,
  validateBatch: async (id) => {
    validateCalls.push(id);
    return {
      total: 10, valid: 8, invalid: 2, warnings: [], cleaned: 8, nonPasig: 0,
      skippedBlank: 0, possibleMatches: 0, errors: [], validatedRecords: [],
    };
  },
});

const validationQueueRouter = require('../routes/validationQueue');
const validationRouter = require('../routes/validation');
const csvImportRouter = require('../routes/csvImport');

let server; let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/data/validation-queue', validationQueueRouter);
  app.use('/api/data', validationRouter);
  app.use('/api/data', csvImportRouter);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/data`;
});
after(() => server.close());

const token = (role, id = 1) => jwt.sign({ id, username: `${role}${id}`, role }, SECRET);
async function call(role, method, path, body, id = 1) {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token(role, id)}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// The validate route prints a success line to stdout on success; raw writes interleave
// with the test runner's protocol stream, so silence it around those calls.
async function callQuiet(role, method, path, body, id = 1) {
  const original = console.log;
  console.log = () => {};
  try { return await call(role, method, path, body, id); } finally { console.log = original; }
}

describe('validation visibility (results of your imports)', () => {
  it('staff sees own-upload rows from other barangays and unassigned rows, with per-row permissions', async () => {
    const r = await call('staff', 'GET', '/validation-queue/issues', undefined, 1);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.isAdmin, false);
    const byId = Object.fromEntries(r.body.issues.map(i => [i.id, i]));
    // Maybunga row from staff 1's own upload: visible, NOT fixable, reason names the block.
    assert.deepStrictEqual(byId[11].permissions, { fix: false, exclude: false, reason: 'other_barangay' });
    // Unassigned row (barangay_id NULL): visible, admin-only.
    assert.deepStrictEqual(byId[12].permissions, { fix: false, exclude: false, reason: 'admin_required' });
    // Own barangay: fixable.
    assert.deepStrictEqual(byId[13].permissions, { fix: true, exclude: true, reason: null });
  });

  it('the issues list scope unions uploaded_by with the barangay id', async () => {
    const before = poolQueries.length;
    await call('staff', 'GET', '/validation-queue/issues', undefined, 1);
    const scoped = poolQueries.slice(before).filter(x => x.q.includes('FROM validation_issues'));
    assert.ok(scoped.length > 0, 'issues queries were issued');
    for (const s of scoped) {
      if (!s.q.includes('status = \'open\'')) continue;
      assert.ok(s.q.includes('uploaded_by'), `issues scope must include own uploads: ${s.q.slice(0, 120)}`);
      assert.ok(s.params.includes(1), 'the caller id must parameterise the upload clause');
    }
  });

  it('summary marks each batch validatable only for its uploader or an admin', async () => {
    const uploader = await call('staff', 'GET', '/validation-queue/summary', undefined, 1);
    assert.strictEqual(uploader.status, 200);
    assert.strictEqual(uploader.body.batches.find(b => b.id === 'b-own').can_validate, true);

    const other = await call('staff', 'GET', '/validation-queue/summary', undefined, 2);
    assert.strictEqual(other.body.batches.find(b => b.id === 'b-own').can_validate, false);

    const asAdmin = await call('admin', 'GET', '/validation-queue/summary');
    assert.strictEqual(asAdmin.body.batches.find(b => b.id === 'b-own').can_validate, true);
  });

  it('Needs Assignment badge counts location records; facility mapping is counted in names', async () => {
    const r = await call('admin', 'GET', '/validation-queue/summary');
    assert.strictEqual(r.body.counts.assignment, 2, 'location records only — not location OR facility');
    assert.strictEqual(r.body.counts.assignmentDetail.facilityNames, 4);
    assert.strictEqual(r.body.counts.assignmentDetail.facilityRecords, 1);
  });
});

describe('data issue fixes are barangay-scoped, never upload-scoped', () => {
  it('staff cannot fix another barangay\'s issue — 403 names the barangay', async () => {
    const r = await call('staff', 'PUT', '/validation-queue/issues/11', { changes: { age: 31 } }, 1);
    assert.strictEqual(r.status, 403);
    assert.match(r.body.error, /assigned to Maybunga/);
    assert.match(r.body.error, /only Maybunga staff or an administrator/);
  });

  it('staff cannot fix an unassigned issue — 403 points at the administrator', async () => {
    const r = await call('staff', 'PUT', '/validation-queue/issues/12', { changes: { age: 31 } }, 1);
    assert.strictEqual(r.status, 403);
    assert.match(r.body.error, /Barangay could not be matched/);
    assert.match(r.body.error, /administrator/);
  });

  it('exclusion follows the same rule', async () => {
    assert.strictEqual((await call('staff', 'POST', '/validation-queue/issues/11/exclude', { note: 'dup' }, 1)).status, 403);
    assert.strictEqual((await call('staff', 'POST', '/validation-queue/issues/12/exclude', { note: 'dup' }, 1)).status, 403);
  });
});

describe('needs assignment is admin-only', () => {
  it('staff are refused by the role gate on every assignment action', async () => {
    assert.strictEqual((await call('staff', 'POST', '/validation-queue/assignment/location', { action: 'assign', barangay: 'Rosario', barangay_text: 'Rosrio' }, 1)).status, 403);
    assert.strictEqual((await call('staff', 'POST', '/validation-queue/assignment/facility', { action: 'map', facility_text: 'ABC', facility_id: 1 }, 1)).status, 403);
    assert.strictEqual((await call('staff', 'POST', '/validation-queue/assignment/facility/accept-suggestions', {}, 1)).status, 403);
  });

  it('staff can view the assignment queue, flagged as non-actionable', async () => {
    const r = await call('staff', 'GET', '/validation-queue/assignment', undefined, 1);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.permissions, { assignLocation: false, mapFacility: false });
    const asAdmin = await call('admin', 'GET', '/validation-queue/assignment');
    assert.deepStrictEqual(asAdmin.body.permissions, { assignLocation: true, mapFacility: true });
  });
});

describe('batch validation is an uploader/admin action', () => {
  it('the uploader may run validation on their batch', async () => {
    const before = validateCalls.length;
    const r = await callQuiet('staff', 'POST', '/validate/b-own', undefined, 1);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(validateCalls.length, before + 1);
  });

  it('another staff member cannot run it — and the handler never executes', async () => {
    const before = validateCalls.length;
    const r = await callQuiet('staff', 'POST', '/validate/b-own', undefined, 2);
    assert.strictEqual(r.status, 403);
    assert.match(r.body.error, /Only the uploader or an administrator/);
    assert.strictEqual(validateCalls.length, before, 'validateBatch must not run');
  });

  it('an admin validates any batch; unknown batches 404', async () => {
    assert.strictEqual((await callQuiet('admin', 'POST', '/validate/b-other')).status, 200);
    assert.strictEqual((await callQuiet('admin', 'POST', '/validate/nope')).status, 404);
  });
});

describe('match resolution on another barangay\'s case', () => {
  it('is refused at the route with the not-assigned message', async () => {
    const before = poolQueries.filter(x => x.q === 'BEGIN').length;
    // Staff of Maybunga (id 2) against a Rosario case.
    const r = await call('staff', 'POST', '/records/900/resolve-match', { resolution: 'same_case' }, 2);
    assert.strictEqual(r.status, 403);
    assert.match(r.body.error, /not assigned to your barangay/);
    const begins = poolQueries.filter(x => x.q === 'BEGIN').length;
    assert.strictEqual(begins, before, 'no transaction may start after a refused resolution');
  });
});
