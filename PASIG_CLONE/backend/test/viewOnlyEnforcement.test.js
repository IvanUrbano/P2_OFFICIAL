/**
 * View-only enforcement on the backend (not just hidden buttons).
 *  - assertCaseAction refuses edit-type actions on view-only cases with a clear reason
 *  - "same case" match resolution cannot write onto an existing case the user may only view
 * Database stubbed. Run: node --test test/viewOnlyEnforcement.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const dbPath = require.resolve('../db/pasigSchema');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { authPool: { query: async () => ({ rows: [] }) } } };

const { ACTIONS, assertCaseAction } = require('../policies/permissions');
const { resolveMatch } = require('../services/matchResolution');

const maria = { id: 12, role: 'staff' };
const rosario = { barangay_id: 17, barangay_name: 'Rosario' };
const base = { match_status: 'none', is_archived: false, merged_into_case_no: null };
const ownCase = { ...base, id: 1, barangay_id: 17, barangay_name: 'Rosario' };                       // PT-001
const referredOut = { ...base, id: 2, barangay_id: 17, barangay_name: 'Rosario', responsible_barangay_id: 12, responsible_barangay: 'Maybunga' }; // PT-002
const referredIn = { ...base, id: 3, barangay_id: 12, barangay_name: 'Maybunga', responsible_barangay_id: 17, responsible_barangay: 'Rosario' }; // PT-003
const otherCase = { ...base, id: 4, barangay_id: 30, barangay_name: 'Ugong' };

describe('assertCaseAction', () => {
  it('allows edit actions on editable cases (own and referred in)', () => {
    for (const c of [ownCase, referredIn]) {
      for (const a of [ACTIONS.CASE_EDIT, ACTIONS.CASE_ARCHIVE, ACTIONS.CASE_REFER]) {
        assert.doesNotThrow(() => assertCaseAction(maria, rosario, a, c));
      }
    }
  });

  it('refuses every edit action on a view-only case, saying who handles it', () => {
    for (const a of [ACTIONS.CASE_EDIT, ACTIONS.CASE_ARCHIVE, ACTIONS.CASE_REFER]) {
      assert.throws(() => assertCaseAction(maria, rosario, a, referredOut), (err) =>
        err.status === 403 && err.code === 'VIEW_ONLY' && /view-only/.test(err.message) && /Maybunga/.test(err.message));
    }
  });

  it('view-only cases can still be viewed', () => {
    assert.doesNotThrow(() => assertCaseAction(maria, rosario, ACTIONS.CASE_VIEW, referredOut));
  });

  it('cases of other barangays are refused as not assigned', () => {
    assert.throws(() => assertCaseAction(maria, rosario, ACTIONS.CASE_VIEW, otherCase),
      (err) => err.status === 403 && err.code === 'NOT_ASSIGNED');
  });

  it('a view-only pending match cannot be resolved', () => {
    assert.throws(() => assertCaseAction(maria, rosario, ACTIONS.MATCH_RESOLVE, { ...referredOut, match_status: 'pending' }),
      (err) => err.code === 'VIEW_ONLY');
  });
});

describe('resolveMatch "same case" protects the existing case', () => {
  function fakeClient(existing) {
    const writes = [];
    return {
      writes,
      query: async (sql, params) => {
        const q = String(sql).replace(/\s+/g, ' ');
        if (q.startsWith('SELECT * FROM validated_tb_cases WHERE case_no = $1')) return { rows: [existing] };
        writes.push({ q, params });
        return { rows: [] };
      },
    };
  }
  const incoming = { id: 50, match_status: 'pending', match_candidate_case_no: 'CS-2025-000002', outcome_status: 'CURED', batch_id: 'b' };
  const guard = (existing) => assertCaseAction(maria, rosario, ACTIONS.CASE_EDIT, existing);

  it('refuses to write onto a view-only existing case and changes nothing', async () => {
    const client = fakeClient({ ...referredOut, case_no: 'CS-2025-000002', patient_id: 9 });
    await assert.rejects(resolveMatch(client, incoming, 'same_case', 12, { authorizeExistingCase: guard }),
      (err) => err.status === 403 && err.code === 'VIEW_ONLY');
    assert.strictEqual(client.writes.length, 0);
  });

  it('refuses to write onto another barangay\'s case', async () => {
    const client = fakeClient({ ...otherCase, case_no: 'CS-2025-000002', patient_id: 9 });
    await assert.rejects(resolveMatch(client, incoming, 'same_case', 12, { authorizeExistingCase: guard }),
      (err) => err.code === 'NOT_ASSIGNED');
    assert.strictEqual(client.writes.length, 0);
  });

  it('updates an editable existing case', async () => {
    const client = fakeClient({ ...ownCase, case_no: 'CS-2025-000002', patient_id: 9 });
    const r = await resolveMatch(client, incoming, 'same_case', 12, { authorizeExistingCase: guard });
    assert.strictEqual(r.caseNo, 'CS-2025-000002');
    assert.ok(client.writes.length >= 2);
  });

  it('cannot be called for "same case" without an authorization check', async () => {
    const client = fakeClient({ ...ownCase, case_no: 'CS-2025-000002', patient_id: 9 });
    await assert.rejects(resolveMatch(client, incoming, 'same_case', 12), /authorizeExistingCase is required/);
  });
});
