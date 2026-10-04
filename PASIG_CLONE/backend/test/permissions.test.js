/**
 * Centralized view/edit permissions (policies/permissions.js). Pure — the database
 * module is stubbed. Run: node --test test/permissions.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const dbPath = require.resolve('../db/pasigSchema');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { authPool: { query: async () => ({ rows: [] }) } } };

const {
  ACTIONS, can, casePermissions, referralPermissions, issuePermissions, validationPermissions,
} = require('../policies/permissions');

const admin = { id: 1, role: 'admin' };
const maria = { id: 12, role: 'staff' };
const rosario = { barangay_id: 17, barangay_name: 'Rosario' };
const caseRosario = { id: 5, barangay_id: 17, barangay_name: 'Rosario', match_status: 'none', is_archived: false, merged_into_case_no: null };

describe('casePermissions', () => {
  it('own barangay case: view, edit, refer, archive — no match to resolve', () => {
    assert.deepStrictEqual(casePermissions(maria, rosario, caseRosario),
      { view: true, edit: true, refer: true, archive: true, resolveMatch: false, basis: 'primary' });
  });

  it('pending match: resolvable, but not referable until decided', () => {
    const p = casePermissions(maria, rosario, { ...caseRosario, match_status: 'pending' });
    assert.strictEqual(p.resolveMatch, true);
    assert.strictEqual(p.refer, false);
  });

  it('referred out (home barangay): view only', () => {
    const p = casePermissions(maria, rosario, { ...caseRosario, responsible_barangay_id: 11, responsible_barangay: 'Maybunga' });
    assert.deepStrictEqual(p, { view: true, edit: false, refer: false, archive: false, resolveMatch: false, basis: 'referred_out' });
  });

  it('referred in: full edit rights', () => {
    const p = casePermissions(maria, rosario, { ...caseRosario, barangay_id: 11, barangay_name: 'Maybunga', responsible_barangay_id: 17, responsible_barangay: 'Rosario' });
    assert.strictEqual(p.edit, true);
    assert.strictEqual(p.basis, 'referred_in');
  });

  it('archived or merged records cannot be referred or archived again', () => {
    assert.strictEqual(casePermissions(admin, null, { ...caseRosario, is_archived: true }).refer, false);
    assert.strictEqual(casePermissions(admin, null, { ...caseRosario, merged_into_case_no: 'CS-1' }).archive, false);
  });

  it('other barangay: nothing', () => {
    const p = casePermissions(maria, rosario, { ...caseRosario, barangay_id: 15, barangay_name: 'Pineda' });
    assert.strictEqual(p.view || p.edit || p.refer || p.archive || p.resolveMatch, false);
  });
});

describe('referralPermissions', () => {
  const pending = {
    status: 'pending', from_barangay: 'Maybunga', from_barangay_id: 11, to_barangay: 'Rosario', to_barangay_id: 17,
    initiated_by_user_id: 21, barangay_id: 11, barangay_name: 'Maybunga',
  };
  it('receiver may accept or reject, not cancel; the case stays closed until accepted', () => {
    assert.deepStrictEqual(referralPermissions(maria, rosario, pending),
      { view: true, viewCase: false, accept: true, reject: true, cancel: false, direction: 'incoming' });
  });
  it('sender may only cancel', () => {
    const p = referralPermissions({ id: 21, role: 'staff' }, { barangay_id: 11, barangay_name: 'Maybunga' }, pending);
    assert.deepStrictEqual([p.accept, p.reject, p.cancel, p.direction], [false, false, true, 'outgoing']);
  });
  it('decided referrals allow no further action', () => {
    const p = referralPermissions(maria, rosario, { ...pending, status: 'accepted' });
    assert.deepStrictEqual([p.accept, p.reject, p.cancel], [false, false, false]);
  });
  it('admin may act as either side', () => {
    const p = referralPermissions(admin, null, pending);
    assert.deepStrictEqual([p.accept, p.reject, p.cancel], [true, true, true]);
  });
});

describe('issue and queue permissions', () => {
  it('staff fix/exclude only issues in their barangay, compared by id', () => {
    assert.deepStrictEqual(issuePermissions(maria, rosario, { barangay_id: 17, status: 'open' }),
      { fix: true, exclude: true, reason: null });
    assert.deepStrictEqual(issuePermissions(maria, rosario, { barangay_id: 11, status: 'open' }),
      { fix: false, exclude: false, reason: 'other_barangay' });
    assert.deepStrictEqual(issuePermissions(maria, rosario, { barangay_id: null, status: 'open' }),
      { fix: false, exclude: false, reason: 'admin_required' }, 'an unassigned row is admin-only');
    assert.deepStrictEqual(issuePermissions(maria, rosario, { barangay_name: 'Rosario', status: 'open' }),
      { fix: false, exclude: false, reason: 'admin_required' }, 'a name alone grants nothing');
    assert.deepStrictEqual(issuePermissions(admin, null, { barangay_id: null, status: 'open' }),
      { fix: true, exclude: true, reason: null }, 'admin resolves unassigned rows');
    assert.deepStrictEqual(issuePermissions(maria, rosario, { barangay_id: 17, status: 'resolved' }),
      { fix: false, exclude: false, reason: null });
    assert.deepStrictEqual(issuePermissions(admin, null, { barangay_id: null, status: 'resolved' }),
      { fix: false, exclude: false, reason: null });
  });
  it('the batch uploader is never part of the decision', () => {
    // Rosario staff uploaded a mixed file: the Maybunga row and the unassigned row in it
    // are still not theirs to fix.
    assert.deepStrictEqual(issuePermissions(maria, rosario, { barangay_id: 12, status: 'open', uploaded_by: maria.id }),
      { fix: false, exclude: false, reason: 'other_barangay' });
    assert.deepStrictEqual(issuePermissions(maria, rosario, { barangay_id: null, status: 'open', uploaded_by: maria.id }),
      { fix: false, exclude: false, reason: 'admin_required' });
  });
  it('location and facility decisions are admin-only', () => {
    assert.deepStrictEqual(validationPermissions(admin), { assignLocation: true, mapFacility: true });
    assert.deepStrictEqual(validationPermissions(maria), { assignLocation: false, mapFacility: false });
  });
});

describe('can()', () => {
  it('routes every action to the matching permission', () => {
    assert.strictEqual(can(maria, rosario, ACTIONS.CASE_EDIT, caseRosario), true);
    assert.strictEqual(can(maria, rosario, ACTIONS.MATCH_RESOLVE, caseRosario), false);
    assert.strictEqual(can(maria, rosario, ACTIONS.LOCATION_ASSIGN), false);
    assert.strictEqual(can(admin, null, ACTIONS.FACILITY_MAP), true);
  });
  it('rejects unknown actions loudly', () => {
    assert.throws(() => can(admin, null, 'case:delete', caseRosario), /Unknown permission action/);
  });
});
