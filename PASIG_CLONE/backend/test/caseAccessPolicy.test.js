/**
 * Case access policy — hybrid barangay-based access.
 *   PRIMARY      patient lives in my barangay, still responsible   → view + edit
 *   REFERRED_IN  accepted referral made my barangay responsible    → view + edit
 *   REFERRED_OUT patient lives in my barangay, referred elsewhere   → view only
 * The database module is stubbed: these tests need no database.
 * Run: node --test test/caseAccessPolicy.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

let scopeRow = null;
const dbPath = require.resolve('../db/pasigSchema');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { authPool: { query: async () => ({ rows: scopeRow ? [scopeRow] : [] }) } },
};

const {
  ACCESS, isNonPasig, resolveUserScope, getCaseAccess, canViewCase, canEditCase, getCaseListScope,
  isReferralReceiver, isReferralSender, responsibleBarangay,
} = require('../policies/caseAccessPolicy');

const maria = { id: 12, role: 'staff' };          // Rosario staff
const admin = { id: 1, role: 'admin' };
const rosario = { barangay_id: 17, barangay_name: 'Rosario' };

describe('resolveUserScope', () => {
  it('admins have no barangay scope (city-wide)', async () => {
    scopeRow = { barangay_name: 'Rosario' };
    assert.strictEqual(await resolveUserScope(admin), null);
  });
  it('staff get their assigned barangay (id + name)', async () => {
    scopeRow = { barangay_id: 17, barangay_name: 'Rosario' };
    assert.deepStrictEqual(await resolveUserScope(maria), { barangay_id: 17, barangay_name: 'Rosario' });
  });
  it('staff without a barangay get no scope', async () => {
    scopeRow = null;
    assert.strictEqual(await resolveUserScope(maria), null);
  });
});

describe('getCaseAccess (Maria, Rosario staff)', () => {
  it('Rosario patient, not referred → view + edit (primary)', () => {
    assert.deepStrictEqual(getCaseAccess(maria, rosario, { barangay_id: 17, barangay_name: 'Rosario' }),
      { canView: true, canEdit: true, basis: ACCESS.PRIMARY });
  });

  it('Maybunga patient with an accepted referral to Rosario → view + edit (referred in)', () => {
    assert.deepStrictEqual(getCaseAccess(maria, rosario, { barangay_id: 11, barangay_name: 'Maybunga', responsible_barangay_id: 17, responsible_barangay: 'Rosario' }),
      { canView: true, canEdit: true, basis: ACCESS.REFERRED_IN });
  });

  it('Rosario patient referred to Maybunga → view only (referred out, option A)', () => {
    assert.deepStrictEqual(getCaseAccess(maria, rosario, { barangay_id: 17, barangay_name: 'Rosario', responsible_barangay_id: 11, responsible_barangay: 'Maybunga' }),
      { canView: true, canEdit: false, basis: ACCESS.REFERRED_OUT });
  });

  it('unrelated Maybunga case → no access', () => {
    assert.deepStrictEqual(getCaseAccess(maria, rosario, { barangay_id: 11, barangay_name: 'Maybunga' }),
      { canView: false, canEdit: false, basis: null });
  });

  it('treatment facility does NOT grant access', () => {
    assert.strictEqual(canViewCase(maria, rosario, { barangay_id: 11, barangay_name: 'Maybunga', treatment_facility: 'Rosario HC' }), false);
  });

  it('names alone never grant access when the relationship ID is missing', () => {
    assert.strictEqual(canEditCase(maria, rosario, { barangay_name: 'Rosario' }), false);
  });

  it('admin: view + edit everything; staff with no barangay: nothing', () => {
    assert.ok(canEditCase(admin, null, { barangay_name: 'Pineda' }));
    assert.strictEqual(canViewCase(maria, null, { barangay_name: 'Rosario' }), false);
  });
});

describe('getCaseListScope', () => {
  it('matches patient barangay id OR responsible barangay id, with one parameter', () => {
    const s = getCaseListScope(maria, rosario, 'v', 4);
    assert.deepStrictEqual(s.params, [17]);
    assert.ok(s.where.includes('v.barangay_id') && s.where.includes('v.responsible_barangay_id') && s.where.includes('$4'));
    assert.ok(!s.where.includes('treatment_facility'));
    // Facility data is not part of the scope in any form: no facility column in the
    // fragment, no facility key in the returned scope object (see facilityAccess.test.js).
    assert.ok(!s.where.includes('facility_id'), `facility id leaked into scope: ${s.where}`);
    assert.deepStrictEqual(Object.keys(s).sort(), ['params', 'where']);
  });

  it('compares by id when the record has ids (names may differ in spelling)', () => {
    assert.ok(canEditCase(maria, rosario, { barangay_id: 17, barangay_name: 'ROSARIO (POB.)' }));
    assert.ok(!canViewCase(maria, rosario, { barangay_id: 11, barangay_name: 'Rosario' }), 'id wins over name');
    assert.deepStrictEqual(getCaseAccess(maria, rosario, { barangay_id: 17, barangay_name: 'Rosario', responsible_barangay_id: 11, responsible_barangay: 'Maybunga' }),
      { canView: true, canEdit: false, basis: ACCESS.REFERRED_OUT });
  });
  it('admin unrestricted; staff with no scope see nothing', () => {
    assert.strictEqual(getCaseListScope(admin, null).where, '1=1');
    assert.strictEqual(getCaseListScope(maria, null).where, '1=0');
  });
});

describe('referral roles', () => {
  it('only the receiving barangay (or admin) receives', () => {
    assert.ok(isReferralReceiver(maria, rosario, 'not used', 17));
    assert.ok(!isReferralReceiver(maria, rosario, 'Rosario', 11));
    assert.ok(!isReferralReceiver(maria, rosario, 'Rosario'));
    assert.ok(isReferralReceiver(admin, null, 'Maybunga'));
  });
  it('only the sending barangay (or admin) sends', () => {
    assert.ok(isReferralSender(maria, rosario, 'not used', 17));
    assert.ok(!isReferralSender(maria, rosario, 'Rosario', 15));
    assert.ok(!isReferralSender(maria, rosario, 'Rosario'));
  });
  it('responsible barangay defaults to the patient barangay', () => {
    assert.strictEqual(responsibleBarangay({ barangay_name: 'Pineda' }), 'Pineda');
    assert.strictEqual(responsibleBarangay({ barangay_name: 'Pineda', responsible_barangay: 'Rosario' }), 'Rosario');
  });
});

describe('Non-Pasig records are admin-only', () => {
  const confirmed = { barangay_id: 17, barangay_name: 'Rosario', location_resolution: 'outside_pasig' };
  const otherCity = { barangay_id: 17, barangay_name: 'Rosario', city: 'Quezon City' };
  it('staff cannot view them even when the barangay name matches theirs', () => {
    assert.strictEqual(canViewCase(maria, rosario, confirmed), false);
    assert.strictEqual(canViewCase(maria, rosario, otherCity), false);
    assert.ok(canViewCase(maria, rosario, { barangay_id: 17, city: 'Pasig City' }));
  });
  it('admin still sees them', () => {
    assert.ok(canViewCase(admin, null, confirmed));
    assert.ok(canViewCase(admin, null, otherCity));
  });
  it('isNonPasig treats a missing city as Pasig', () => {
    assert.strictEqual(isNonPasig({}), false);
    assert.strictEqual(isNonPasig({ city: ' pasig ' }), false);
  });
  it('the list scope excludes them in SQL', () => {
    const s = getCaseListScope(maria, rosario, 'v', 1);
    assert.ok(s.where.includes("location_resolution IS DISTINCT FROM 'outside_pasig'") && s.where.includes('v.city'));
  });
});
