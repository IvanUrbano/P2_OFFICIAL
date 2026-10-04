/**
 * Facility relationships never grant access to TB Records.
 *
 * The ONLY access path for staff is:
 *   Staff Assigned Barangay → Patient Barangay / Responsible Barangay → View/Edit
 * Never: Staff Facility → Treatment Facility. This file locks that rule in from every
 * angle the pipeline can be probed: sharing the treatment facility (id or name), the
 * case permissions layer, the list WHERE fragment, the scope query and the route guard.
 *
 * The database module is stubbed — no live database needed.
 * Run: node --test test/facilityAccess.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

let scopeRow = null;
let scopeSql = '';
const dbPath = require.resolve('../db/pasigSchema');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    authPool: {
      query: async (sql) => { scopeSql = String(sql); return { rows: scopeRow ? [scopeRow] : [] }; },
    },
  },
};

const {
  resolveUserScope, getCaseAccess, canViewCase, canEditCase, getCaseListScope,
} = require('../policies/caseAccessPolicy');
const {
  can, casePermissions, assertCaseAction, ACTIONS, facilityPermissions,
} = require('../policies/permissions');

const admin = { id: 1, role: 'admin' };
// Rosario staff (barangay 17) whose legacy users.facility_id points at facility 3.
const staff = { id: 12, role: 'staff', facility_id: 3 };
const rosario = { barangay_id: 17, barangay_name: 'Rosario' };

const foreignCase = {
  id: 91, barangay_id: 11, barangay_name: 'Maybunga',
  treatment_facility_id: 3, treatment_facility: 'Rosario HC',
  screening_facility_id: 3, screening_facility: 'Rosario HC',
  responsible_barangay_id: null,
  match_status: 'none', is_archived: false, merged_into_case_no: null,
};
const ownBarangayCase = {
  id: 92, barangay_id: 17, barangay_name: 'Rosario',
  treatment_facility_id: 99, treatment_facility: 'Some Other City HC',
  responsible_barangay_id: null,
  match_status: 'none', is_archived: false, merged_into_case_no: null,
};

beforeEach(() => { scopeRow = { barangay_id: 17, barangay_name: 'Rosario' }; scopeSql = ''; });
afterEach(() => { scopeRow = null; });

describe('sharing a treatment facility grants no access', () => {
  it("same treatment_facility_id as the staff user's facility_id → no view, no edit", () => {
    const a = getCaseAccess(staff, rosario, foreignCase);
    assert.deepStrictEqual(a, { canView: false, canEdit: false, basis: null });
    assert.strictEqual(canViewCase(staff, rosario, foreignCase), false);
    assert.strictEqual(canEditCase(staff, rosario, foreignCase), false);
  });

  it('the free-text facility name alone grants nothing either', () => {
    const byName = { barangay_id: 11, barangay_name: 'Maybunga', treatment_facility: 'Rosario HC' };
    assert.strictEqual(canViewCase(staff, rosario, byName), false);
    assert.strictEqual(canEditCase(staff, rosario, byName), false);
  });

  it('the casePermissions / can() layer reports the same denial', () => {
    const p = casePermissions(staff, rosario, foreignCase);
    assert.strictEqual(p.view || p.edit || p.refer || p.archive || p.resolveMatch, false);
    assert.strictEqual(can(staff, rosario, ACTIONS.CASE_VIEW, foreignCase), false);
    assert.strictEqual(can(staff, rosario, ACTIONS.CASE_EDIT, foreignCase), false);
    assert.strictEqual(can(staff, rosario, ACTIONS.CASE_REFER, foreignCase), false);
  });

  it('assertCaseAction rejects with 403 NOT_ASSIGNED — never a facility-based grant', () => {
    assert.throws(
      () => assertCaseAction(staff, rosario, ACTIONS.CASE_EDIT, foreignCase),
      (err) => {
        assert.strictEqual(err.status, 403);
        assert.strictEqual(err.code, 'NOT_ASSIGNED');
        return true;
      },
    );
    assert.throws(
      () => assertCaseAction(staff, rosario, ACTIONS.CASE_VIEW, foreignCase),
      (err) => err.status === 403,
    );
  });

  it('a DIFFERENT treatment facility on my own barangay case changes nothing: view + edit stay', () => {
    const a = getCaseAccess(staff, rosario, ownBarangayCase);
    assert.deepStrictEqual(a, { canView: true, canEdit: true, basis: 'primary' });
    assert.strictEqual(casePermissions(staff, rosario, ownBarangayCase).edit, true);
  });

  it('admin sees everything by role — not because of any facility link', () => {
    assert.strictEqual(canViewCase(admin, null, foreignCase), true);
    assert.strictEqual(canEditCase(admin, null, foreignCase), true);
    assert.strictEqual(getCaseAccess(admin, null, foreignCase).basis, 'admin');
  });
});

describe('the list scope never mentions a facility', () => {
  it('the WHERE fragment compares barangay ids only', () => {
    const s = getCaseListScope(staff, rosario, 'v', 4);
    assert.ok(!s.where.includes('facility'), `facility leaked into scope: ${s.where}`);
    assert.ok(!s.where.includes('treatment'), `treatment facility leaked into scope: ${s.where}`);
    assert.ok(!s.where.includes('screening'), `screening facility leaked into scope: ${s.where}`);
    assert.deepStrictEqual(s.params, [17]);
    assert.deepStrictEqual(Object.keys(s).sort(), ['params', 'where']);
  });

  it('the scope query itself selects only the assigned barangay', async () => {
    const scope = await resolveUserScope(staff);
    assert.ok(!scopeSql.includes('facility'), `facility selected into scope: ${scopeSql}`);
    assert.deepStrictEqual(scope, { barangay_id: 17, barangay_name: 'Rosario' });
    assert.deepStrictEqual(Object.keys(scope).sort(), ['barangay_id', 'barangay_name']);
  });

  it('a staff user with a facility but no barangay scope still sees nothing', async () => {
    scopeRow = null;
    assert.strictEqual(await resolveUserScope(staff), null);
    assert.strictEqual(getCaseListScope(staff, null).where, '1=0');
    assert.strictEqual(canViewCase(staff, null, ownBarangayCase), false);
  });
});

describe('facility permissions are a separate, master-data-only surface', () => {
  it('staff may read the facility directory while having zero TB Records access to a foreign case', () => {
    const fp = facilityPermissions(staff);
    assert.strictEqual(fp.view, true, 'directory browsing stays open');
    assert.strictEqual(canViewCase(staff, rosario, foreignCase), false, 'records stay closed');
  });

  it('even a staff member "owning" the treatment facility cannot map records in the queue', () => {
    assert.strictEqual(facilityPermissions(staff).resolveMapping, false);
    assert.strictEqual(can(staff, rosario, ACTIONS.FACILITY_MAP), false);
    assert.strictEqual(can(staff, rosario, ACTIONS.LOCATION_ASSIGN), false);
  });
});
