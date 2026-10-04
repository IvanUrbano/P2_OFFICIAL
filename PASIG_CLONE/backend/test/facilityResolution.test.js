/**
 * Facility resolution — the three options behind Resolve in Needs Assignment.
 *
 *   - Match Existing Facility (action map): revalidates every record carrying that name
 *     now AND always records the spelling as an alias — refreshFacilityIds recomputes
 *     every case id from raw text + facility_aliases, so an id written without an alias
 *     would silently revert on the next refresh (save_alias:false is therefore ignored).
 *     An alias another facility owns is never stolen (409), the text may not already
 *     be another facility's canonical name (409), and an inactive target is refused
 *     (409 reactivate).
 *   - Add Reference Facility (action register): creates the facility WITH a facility
 *     type (default HC), mirrors it into facility_ref, saves the alias and revalidates
 *     (reviews logged + already-synced cases resynced). A facility outside Pasig is
 *     registered with its real city and never with a Pasig barangay; Status Active /
 *     Inactive lands in is_active. Case/tag variants of an existing name → 409.
 *   - Keep Pending: no endpoint at all — the UI simply closes, the name stays queued.
 * Run: node --test test/facilityResolution.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-facility-resolution-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

const poolQueries = [];   // { q, params } — shared-pool statements (facility_ref / aliases / cases)
const authQueries = [];   // { q, params } — auth-pool statements (health_facilities)
const audits = [];        // audit events written by the route

const REGISTRY = [
  { id: 1, name: 'Rosario Health Center', is_active: true },
  { id: 9, name: 'St. Camillus Medical Center', is_active: true },
  { id: 5, name: 'Bagong Ilog Old Clinic', is_active: false },
];
let duplicateOnInsert = false;
let aliasConflictOn = false;  // alias INSERT throws 23505 (already owned)
let aliasOwnerRows = [];      // rows the alias-owner lookup returns
let registerDupRows = [];     // rows the register duplicate pre-check scans
let queueNames = [];          // unresolved names (accept-suggestions plan input)
let queueOptions = [];        // registry options (accept-suggestions / clash input)

function dispatch(sql, params) {
  const q = String(sql).replace(/\s+/g, ' ').trim();
  poolQueries.push({ q, params });
  if (q.startsWith('SELECT id, name, is_active FROM facility_ref WHERE id') ||
      q.startsWith('SELECT id, name FROM facility_ref WHERE id')) {
    const f = REGISTRY.find(x => x.id === Number(params[0]));
    return { rows: f ? [f] : [] };
  }
  if (q.startsWith('SELECT id, name FROM facility_ref')) return { rows: queueOptions };
  if (q.startsWith('SELECT facility_id FROM facility_aliases')) return { rows: aliasOwnerRows };
  if (q.includes('SELECT norm_facility(t) AS alias_norm')) return { rows: queueNames };
  if (q.startsWith('INSERT INTO facility_aliases')) {
    if (aliasConflictOn) { const e = new Error('duplicate key value violates unique constraint'); e.code = '23505'; throw e; }
    return { rows: [], rowCount: 1 };
  }
  if (q.startsWith('INSERT INTO facility_ref')) return { rows: [], rowCount: 1 };
  if (q.startsWith('UPDATE validated_tb_cases SET treatment_facility_id')) return { rows: [], rowCount: 7 };
  if (q.startsWith('UPDATE validated_tb_cases SET screening_facility_id')) return { rows: [], rowCount: 5 };
  return { rows: [], rowCount: 0 };
}

stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {} });
stub('../db/pasigSchema', {
  pool: { query: async (sql, params) => dispatch(sql, params) },
  authPool: {
    query: async (sql, params) => {
      const q = String(sql).replace(/\s+/g, ' ').trim();
      authQueries.push({ q, params });
      if (q.startsWith('INSERT INTO health_facilities')) {
        if (duplicateOnInsert) { const err = new Error('duplicate key value violates unique constraint'); err.code = '23505'; throw err; }
        const [name, brgy, ownership, category, isExternal, isReference, city, isActive, facilityType] = params;
        return {
          rows: [{
            id: 77, name, facility_type: facilityType, barangay_name: brgy, ownership, facility_category: category,
            is_external: isExternal, is_reference: isReference, city, is_active: isActive,
          }],
        };
      }
      // Register duplicate pre-checks (external: NULL barangay; pasig: same barangay).
      if (q.includes('WHERE barangay_name IS NULL')) return { rows: registerDupRows };
      if (q.includes('lower(barangay_name) = lower($1)')) return { rows: registerDupRows };
      return { rows: [] };
    },
  },
});
stub('../utils/auditLogger', { logAuditEvent: async (event) => { audits.push(event); } });

const validationQueueRouter = require('../routes/validationQueue');

let server; let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/data/validation-queue', validationQueueRouter);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/data/validation-queue`;
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

const aliasInserts = () => poolQueries.filter(x => x.q.startsWith('INSERT INTO facility_aliases'));
const caseUpdates = () => poolQueries.filter(x => x.q.startsWith('UPDATE validated_tb_cases'));
const healthInserts = () => authQueries.filter(x => x.q.startsWith('INSERT INTO health_facilities'));

const reset = () => {
  poolQueries.length = 0; authQueries.length = 0; audits.length = 0;
  duplicateOnInsert = false; aliasConflictOn = false; aliasOwnerRows = [];
  registerDupRows = []; queueNames = []; queueOptions = [];
};

describe('Match Existing Facility (action map)', () => {
  beforeEach(reset);

  it('saves the alias by default and revalidates both facility fields', async () => {
    const r = await call('admin', 'POST', '/assignment/facility', { facility_text: 'ROSARIO HC - IDOTS', action: 'map', facility_id: 1 });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.alias_saved, true);
    assert.strictEqual(r.body.records, 12); // 7 treatment + 5 screening fields

    assert.strictEqual(aliasInserts().length, 1, 'the spelling is recorded as an alias');
    const updates = caseUpdates();
    assert.strictEqual(updates.length, 2, 'both treatment and screening fields are revalidated');
    for (const u of updates) {
      assert.match(u.q, /WHERE norm_facility\((treatment|screening)_facility\) = norm_facility\(\$1\)/);
      assert.deepStrictEqual(u.params, ['ROSARIO HC - IDOTS', 1]);
    }
    assert.match(r.body.message, /Saved as an alias/);
  });

  it('the alias is always saved — save_alias:false is ignored so the mapping survives the id refresh', async () => {
    const r = await call('admin', 'POST', '/assignment/facility', {
      facility_text: 'ROSMARIE HC', action: 'map', facility_id: 1, save_alias: false,
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.alias_saved, true, 'a mapping without an alias would revert on refresh');
    assert.strictEqual(r.body.records, 12, 'the existing records are still linked');
    assert.strictEqual(aliasInserts().length, 1, 'the spelling must be recorded as an alias');
    assert.match(r.body.message, /Saved as an alias/);
  });

  it('audit records what was mapped, how many records, the alias and the sync outcome', async () => {
    await call('admin', 'POST', '/assignment/facility', { facility_text: 'ROSMARIE HC', action: 'map', facility_id: 1, save_alias: false });
    const event = audits.find(a => a.action === 'MAP_FACILITY');
    assert.ok(event, 'MAP_FACILITY audit event written');
    assert.strictEqual(event.details.facility_text, 'ROSMARIE HC');
    assert.strictEqual(event.details.facility, 'Rosario Health Center');
    assert.strictEqual(event.details.records, 12);
    assert.strictEqual(event.details.alias_saved, true);
    assert.strictEqual(event.details.sync, 'none');
  });

  it('an alias already owned by ANOTHER facility is never stolen → 409', async () => {
    aliasConflictOn = true;
    aliasOwnerRows = [{ facility_id: 9 }];
    const r = await call('admin', 'POST', '/assignment/facility', { facility_text: 'Rosario HC', action: 'map', facility_id: 1 });
    aliasConflictOn = false;
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /St\. Camillus/, 'the error names the current owner');
    assert.strictEqual(caseUpdates().length, 0, 'records must not be relinked on a conflict');
    assert.strictEqual(audits.length, 0, 'nothing to audit');
  });

  it('an alias already pointing at the SAME facility is idempotent — records still update', async () => {
    aliasConflictOn = true;
    aliasOwnerRows = [{ facility_id: 1 }];
    const r = await call('admin', 'POST', '/assignment/facility', { facility_text: 'Rosario HC', action: 'map', facility_id: 1 });
    aliasConflictOn = false;
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.alias_saved, true);
    assert.strictEqual(r.body.records, 12);
  });

  it('the source text may not already be ANOTHER facility’s canonical name → 409', async () => {
    queueOptions = [{ id: 1, name: 'Rosario Health Center' }, { id: 9, name: 'St. Camillus Medical Center' }];
    const r = await call('admin', 'POST', '/assignment/facility', {
      facility_text: 'St Camillus Medical Center', action: 'map', facility_id: 1,
    });
    queueOptions = [];
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /map to it instead/i);
    assert.strictEqual(aliasInserts().length, 0, 'nothing written');
    assert.strictEqual(caseUpdates().length, 0);
  });

  it('an id that is not in the registry is refused before anything is written', async () => {
    const r = await call('admin', 'POST', '/assignment/facility', { facility_text: 'Ghost Clinic', action: 'map', facility_id: 4242 });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /registered facility/);
    assert.strictEqual(aliasInserts().length, 0);
    assert.strictEqual(caseUpdates().length, 0);
    assert.strictEqual(audits.length, 0);
  });

  it('an INACTIVE facility is refused as a mapping target → 409 reactivate', async () => {
    const r = await call('admin', 'POST', '/assignment/facility', {
      facility_text: 'Old Clinic Wing', action: 'map', facility_id: 5,
    });
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /is inactive — reactivate it/);
    assert.strictEqual(aliasInserts().length, 0, 'no alias for a refused target');
    assert.strictEqual(caseUpdates().length, 0, 'records must not be relinked');
    assert.strictEqual(audits.length, 0);
  });

  it('a blank source value and an unknown action are both 400', async () => {
    assert.strictEqual((await call('admin', 'POST', '/assignment/facility', { facility_text: '   ', action: 'map', facility_id: 1 })).status, 400);
    const bad = await call('admin', 'POST', '/assignment/facility', { facility_text: 'Rosario HC', action: 'reassign' });
    assert.strictEqual(bad.status, 400);
    assert.match(bad.body.error, /"map" or "register"/);
    assert.strictEqual(aliasInserts().length, 0);
  });

  it('staff cannot resolve a facility', async () => {
    const r = await call('staff', 'POST', '/assignment/facility', { facility_text: 'Rosario HC', action: 'map', facility_id: 1 }, 1);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(aliasInserts().length, 0);
  });
});

describe('Add Reference Facility (action register)', () => {
  beforeEach(reset);

  it('an external facility gets its real city, no Pasig barangay, and status Active', async () => {
    const r = await call('admin', 'POST', '/assignment/facility', {
      facility_text: 'TAYTAY Rural Health Unit',
      action: 'register',
      facility: { name: 'Taytay RHU', ownership: 'public', facility_category: 'health_center', is_external: true, is_reference: true, city: 'Taytay, Rizal', barangay_name: 'Rosario', is_active: true },
    });
    assert.strictEqual(r.status, 200);
    const ins = healthInserts()[0];
    assert.ok(ins, 'health_facilities row created');
    const p = ins.params;
    assert.strictEqual(p[1], null, 'an external facility never carries a Pasig barangay');
    assert.strictEqual(p[4], true, 'is_external');
    assert.strictEqual(p[5], true, 'is_reference');
    assert.strictEqual(p[6], 'Taytay, Rizal', 'city of the facility');
    assert.strictEqual(p[7], true, 'is_active');

    assert.strictEqual(poolQueries.filter(x => x.q.startsWith('INSERT INTO facility_ref')).length, 1, 'mirrored into facility_ref');
    assert.strictEqual(aliasInserts().length, 1, 'the source spelling becomes an alias');
    assert.match(r.body.message, /newly registered/);
    const event = audits.find(a => a.action === 'REGISTER_FACILITY');
    assert.strictEqual(event.details.is_active, true);
  });

  it('an external facility without a city is refused', async () => {
    const r = await call('admin', 'POST', '/assignment/facility', {
      facility_text: 'Outside Clinic',
      action: 'register',
      facility: { name: 'Outside Clinic', is_external: true, city: '   ' },
    });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /city or municipality/);
    assert.strictEqual(healthInserts().length, 0, 'nothing is created');
  });

  it('a Pasig facility without a barangay is refused', async () => {
    const r = await call('admin', 'POST', '/assignment/facility', {
      facility_text: 'Unknown Clinic',
      action: 'register',
      facility: { name: 'Unknown Clinic', is_external: false, barangay_name: '' },
    });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /Pasig barangay/);
    assert.strictEqual(healthInserts().length, 0);
  });

  it('a Pasig facility is registered with its barangay and Pasig City', async () => {
    const r = await call('admin', 'POST', '/assignment/facility', {
      facility_text: 'St. Camillus Clinic',
      action: 'register',
      facility: { name: 'St. Camillus Clinic', ownership: 'private', facility_category: 'clinic', is_external: false, barangay_name: 'Rosario' },
    });
    assert.strictEqual(r.status, 200);
    const p = healthInserts()[0].params;
    assert.strictEqual(p[1], 'Rosario');
    assert.strictEqual(p[6], 'Pasig City');
    assert.strictEqual(p[7], true, 'defaults to Active');
    assert.strictEqual(r.body.facility.id, 77);
    assert.strictEqual(r.body.records, 12);
  });

  it('Status Inactive is stored on the new facility', async () => {
    const r = await call('admin', 'POST', '/assignment/facility', {
      facility_text: 'Closed Clinic',
      action: 'register',
      facility: { name: 'Closed Clinic', is_external: true, city: 'Antipolo', is_active: false },
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(healthInserts()[0].params[7], false, 'is_active = false');
    assert.strictEqual(audits.find(a => a.action === 'REGISTER_FACILITY').details.is_active, false);
    assert.strictEqual(r.body.facility.is_active, false);
  });

  it('a name that already exists points the admin at mapping instead', async () => {
    duplicateOnInsert = true;
    const r = await call('admin', 'POST', '/assignment/facility', {
      facility_text: 'Rosario Health Center',
      action: 'register',
      facility: { name: 'Rosario Health Center', is_external: false, barangay_name: 'Rosario' },
    });
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /Map to it instead/);
    assert.strictEqual(aliasInserts().length, 0, 'no alias for a facility that was not created');
    assert.strictEqual(audits.length, 0);
  });

  it('the facility type is stored — default Health Center when the caller omits it', async () => {
    const r = await call('admin', 'POST', '/assignment/facility', {
      facility_text: 'New External Clinic',
      action: 'register',
      facility: { name: 'New External Clinic', is_external: true, city: 'Antipolo' },
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(healthInserts()[0].params[8], 'HC', 'facility_type defaults to HC — never NULL');
    assert.strictEqual(r.body.facility.facility_type, 'HC');
  });

  it('an explicit facility type is honoured; an unknown one → 400 before anything is written', async () => {
    const ok = await call('admin', 'POST', '/assignment/facility', {
      facility_text: 'New External Clinic',
      action: 'register',
      facility: { name: 'New External Clinic', is_external: true, city: 'Antipolo', facility_type: 'PC' },
    });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(healthInserts()[0].params[8], 'PC');

    const bad = await call('admin', 'POST', '/assignment/facility', {
      facility_text: 'New External Clinic',
      action: 'register',
      facility: { name: 'New External Clinic', is_external: true, city: 'Antipolo', facility_type: 'HOSP' },
    });
    assert.strictEqual(bad.status, 400);
    assert.match(bad.body.error, /facility type/i);
    assert.strictEqual(healthInserts().length, 1, 'the invalid attempt must not insert');
  });

  it('a case/tag variant of an existing name is refused by the norm pre-check', async () => {
    registerDupRows = [{ id: 3, name: 'TAYTAY RHU - IDOTS' }];
    const r = await call('admin', 'POST', '/assignment/facility', {
      facility_text: 'TAYTAY Rural Health Unit',
      action: 'register',
      facility: { name: 'Taytay RHU', is_external: true, city: 'Taytay, Rizal' },
    });
    registerDupRows = [];
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /Map to it instead/);
    assert.strictEqual(healthInserts().length, 0, 'rejected before the insert');
    assert.strictEqual(aliasInserts().length, 0);
  });
});

describe('Accept every suggestion (bulk)', () => {
  beforeEach(reset);

  it('fills only THIS plan’s normalized names and logs the reviews', async () => {
    queueNames = [{ alias_norm: 'rosariohc', facility_text: 'ROSARIO HC' }];
    queueOptions = [{ id: 1, name: 'Rosario Health Center' }];
    const r = await call('admin', 'POST', '/assignment/facility/accept-suggestions');
    queueNames = [];
    queueOptions = [];
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.mapped, 1);
    assert.strictEqual(aliasInserts().length, 1, 'each accepted name becomes an alias');

    const fills = caseUpdates().filter(u => u.q.includes('_facility_id = a.facility_id'));
    assert.strictEqual(fills.length, 2, 'both treatment and screening fields refilled');
    for (const u of fills) {
      assert.match(u.q, /alias_norm = ANY\(\$1::text\[\]\)/, 'the fill must be scoped to the plan');
      assert.deepStrictEqual(u.params, [['rosariohc']], 'only this plan’s norms are passed');
    }
    const event = audits.find(a => a.action === 'MAP_FACILITY_BULK');
    assert.ok(event, 'MAP_FACILITY_BULK audit written');
    assert.strictEqual(event.details.sync, 'none');
    assert.deepStrictEqual(event.details.mappings, ['ROSARIO HC -> Rosario Health Center']);
  });

  it('nothing to accept → short-circuits with no writes', async () => {
    const r = await call('admin', 'POST', '/assignment/facility/accept-suggestions');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.mapped, 0);
    assert.strictEqual(aliasInserts().length, 0);
    assert.strictEqual(caseUpdates().length, 0);
    assert.strictEqual(audits.length, 0);
  });

  it('staff cannot accept suggestions', async () => {
    const r = await call('staff', 'POST', '/assignment/facility/accept-suggestions', {}, 1);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(aliasInserts().length, 0);
  });
});
