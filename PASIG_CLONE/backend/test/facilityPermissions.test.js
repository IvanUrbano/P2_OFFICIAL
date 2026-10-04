/**
 * Facility directory permissions (policies/permissions.js → facilityPermissions):
 *   admin — browse, add, edit, activate/deactivate, manage aliases, resolve mappings
 *   staff — browse, search, view details only; every write stays with admin
 * Pure — the database module is stubbed, no routes involved. Run:
 *   node --test test/facilityPermissions.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const dbPath = require.resolve('../db/pasigSchema');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { authPool: { query: async () => ({ rows: [] }) } },
};

const { facilityPermissions, validationPermissions } = require('../policies/permissions');

const ALL_WRITE_KEYS = ['add', 'edit', 'activate', 'aliases', 'resolveMapping'];

describe('facilityPermissions (facility master data)', () => {
  it('admin may do everything the spec allows: view, search, details, all writes', () => {
    assert.deepStrictEqual(facilityPermissions({ id: 1, role: 'admin' }), {
      view: true, search: true, details: true,
      add: true, edit: true, activate: true, aliases: true, resolveMapping: true,
    });
  });

  it('staff may view, search and read details, but change nothing', () => {
    const p = facilityPermissions({ id: 12, role: 'staff', facility_id: 3 });
    assert.deepStrictEqual([p.view, p.search, p.details], [true, true, true]);
    assert.deepStrictEqual(ALL_WRITE_KEYS.map(k => p[k]), [false, false, false, false, false]);
  });

  it('an unknown or missing role fails closed on every write', () => {
    for (const user of [undefined, null, {}, { role: 'viewer' }, { role: 'SUPERADMIN' }]) {
      const p = facilityPermissions(user);
      assert.deepStrictEqual(ALL_WRITE_KEYS.map(k => p[k]), [false, false, false, false, false],
        `write leaked for ${JSON.stringify(user)}`);
      assert.strictEqual(p.view, true, 'browsing the directory stays open to any authenticated caller');
    }
  });

  it('the facility payload and the validation-queue facility mapping agree (admin only)', () => {
    const staff = { role: 'staff' };
    const admin = { role: 'admin' };
    assert.strictEqual(facilityPermissions(staff).resolveMapping, false);
    assert.strictEqual(validationPermissions(staff).mapFacility, false);
    assert.strictEqual(facilityPermissions(admin).resolveMapping, true);
    assert.strictEqual(validationPermissions(admin).mapFacility, true);
  });
});
