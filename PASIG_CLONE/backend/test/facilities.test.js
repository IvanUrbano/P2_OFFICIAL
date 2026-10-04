/**
 * Health facilities management (routes/facilities.js):
 *   - GET  ?status=active (default keeps existing consumers) | inactive | all
 *   - GET  rows expose is_active, city + detail fields for the View panel
 *   - POST admin-only: validation, classification (pasig | external), status,
 *     barangay lookup, facility_ref mirror sync, duplicate → 409, audit event
 *   - PUT  admin-only edit: validation, classification switch, rename parks the
 *     old name in facility_aliases (historical raw text keeps resolving), audit
 *   - Aliases: GET (any role) / POST / DELETE (admin; staff 403)
 *   - Tag stripping: "- IDOTS" / "- MTBN" tails never become part of the alias key
 *   - Alias changes re-resolve case facility ids immediately (refreshFacilityIds)
 *   - GET /:id/alias-suggestions: admin-only (staff 403); unresolved imported names
 *     suggesting this facility
 *   - GET / carries the caller's facility permissions (staff = view-only payload)
 *   - Staff and anonymous have no create path (view-only module)
 * Run: node --test test/facilities.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-facilities-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

const captured = {
  facilitiesSql: null, insertSql: null, insertParams: null,
  updateSql: null, updateParams: null, aliasInsertParams: null, aliasDeleteParams: null,
  aliasUpdateParams: null, suggestionsSql: null, registrySql: null,
};
const auditCalls = [];
const syncCalls = [];
const refreshCalls = [];
const poolState = { aliases: [] };
// Rows the alias-suggestions query "returns"; registry rows it matches them against.
const suggestionsState = { rows: [], registry: [] };
let barangayLookups = 0;
let facilityRows = [];
let dupRows = [];          // rows the norm-based duplicate pre-check scans
let otherFacilityRows = []; // other facilities (alias vs canonical-name clash check)
let insertImpl = null;
let updateImpl = null;
let currentRow = null;      // PUT: the pre-edit facility row
let facilityById = { id: 12, name: 'Bagong Ilog HC' }; // POST-alias existence check
let barangayLookup = [{ id: 5, name: 'Bagong Ilog' }];

const CURRENT_DEFAULT = {
  id: 12, name: 'Bagong Ilog HC', barangay_name: 'Bagong Ilog', facility_type: 'HC',
  address: null, is_active: true, is_external: false, ownership: 'public',
  contact_number: null, notes: null, city: 'Pasig City',
};

// Row shape returned by the PUT UPDATE ... RETURNING *.
function rowFromUpdateParams(p) {
  return {
    id: p[0], name: p[1], facility_type: p[2], barangay_name: p[3], barangay_id: p[4],
    address: p[5], is_active: p[6], is_external: p[7], is_reference: p[7], city: p[8],
    ownership: p[9], contact_number: p[11] ?? null, notes: p[10],
    created_at: '2026-10-03T10:06:00.000Z', updated_at: '2026-10-04T09:00:00.000Z',
  };
}

stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {} });
stub('../db/pasigSchema', {
  pool: {
    query: async (sql, params) => {
      const q = String(sql).replace(/\s+/g, ' ');
      if (q.includes('FROM facility_aliases WHERE facility_id')) {
        return {
          rows: poolState.aliases
            .filter(a => a.facility_id === (params || [])[0])
            .map(a => ({ alias_norm: a.alias_norm, alias_text: a.alias_text, created_at: '2026-10-04T09:00:00.000Z' })),
        };
      }
      if (q.includes('INSERT INTO facility_aliases')) {
        captured.aliasInsertParams = params || [];
        const [norm, , fid] = params || [];
        if (poolState.aliases.some(a => a.alias_norm === norm)) {
          throw Object.assign(new Error('duplicate key value'), { code: '23505' });
        }
        poolState.aliases.push({ alias_norm: norm, alias_text: params[1], facility_id: fid });
        return { rows: [], rowCount: 1 };
      }
      if (q.includes('UPDATE facility_aliases')) {
        captured.aliasUpdateParams = params || [];
        const [text, newNorm, oldNorm, fid] = params || [];
        const idx = poolState.aliases.findIndex(a => a.alias_norm === oldNorm && a.facility_id === fid);
        if (idx === -1) return { rows: [], rowCount: 0 };
        if (poolState.aliases.some((a, i) => i !== idx && a.alias_norm === newNorm)) {
          throw Object.assign(new Error('duplicate key value'), { code: '23505' });
        }
        poolState.aliases[idx] = { alias_norm: newNorm, alias_text: text, facility_id: fid };
        return { rows: [], rowCount: 1 };
      }
      if (q.includes('DELETE FROM facility_aliases')) {
        captured.aliasDeleteParams = params || [];
        const [norm, fid] = params || [];
        const before = poolState.aliases.length;
        poolState.aliases = poolState.aliases.filter(a => !(a.alias_norm === norm && a.facility_id === fid));
        return { rows: [], rowCount: before - poolState.aliases.length };
      }
      if (q.includes('GROUP BY norm_facility(t)')) {
        captured.suggestionsSql = q;
        return { rows: suggestionsState.rows };
      }
      if (q.includes('FROM facility_ref')) {
        captured.registrySql = q;
        return { rows: suggestionsState.registry };
      }
      return { rows: [], rowCount: 1 };
    },
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
  },
  authPool: {
    query: async (sql, params) => {
      const q = String(sql).replace(/\s+/g, ' ');
      if (q.includes('INSERT INTO health_facilities')) {
        captured.insertSql = q;
        captured.insertParams = params || [];
        if (insertImpl) return insertImpl(q, params);
        return {
          rows: [{
            id: 99,
            name: params[0],
            facility_type: params[1],
            barangay_name: params[2],
            barangay_id: params[3],
            address: params[4],
            is_active: params[5],
            is_external: params[6],
            is_reference: params[6],
            city: params[7],
            notes: params[8],
            ownership: params[9],
            contact_number: params[10],
            created_at: '2026-10-04T08:00:00.000Z',
          }],
        };
      }
      if (q.includes('UPDATE health_facilities')) {
        captured.updateSql = q;
        captured.updateParams = params || [];
        if (updateImpl) return updateImpl(q, params);
        return { rows: [rowFromUpdateParams(params)] };
      }
      if (q.includes('SELECT id, name FROM barangays WHERE name')) {
        barangayLookups += 1;
        return { rows: barangayLookup };
      }
      if (q.includes('FROM health_facilities WHERE id <> $1')) {
        return { rows: otherFacilityRows };
      }
      if (q.includes('SELECT id, name, barangay_name FROM health_facilities')) {
        return { rows: dupRows };
      }
      if (q.includes('SELECT id, name FROM health_facilities WHERE id')) {
        return { rows: facilityById ? [facilityById] : [] };
      }
      if (q.includes('FROM health_facilities WHERE id = $1')) {
        return { rows: currentRow ? [currentRow] : [] };
      }
      if (q.includes('FROM health_facilities h')) {
        captured.facilitiesSql = q;
        return { rows: facilityRows };
      }
      if (q.includes('FROM barangays b')) return { rows: [{ id: 5, name: 'Bagong Ilog', population: 100 }] };
      throw new Error(`Unexpected authPool query: ${q.slice(0, 100)}`);
    },
  },
});
stub('../utils/auditLogger', {
  logAuditEvent: async (params) => { auditCalls.push(JSON.parse(JSON.stringify(params))); },
});
stub('../services/barangayRegistry', {
  syncFacilityRef: async (authPoolArg, poolArg) => { syncCalls.push({ authPool: authPoolArg, pool: poolArg }); },
  refreshFacilityIds: async (poolArg) => { refreshCalls.push(poolArg); },
});

const facilitiesRouter = require('../routes/facilities');

let server; let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/facilities', facilitiesRouter);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/facilities`;
});
after(() => server.close());

const token = (role, id = 1) => jwt.sign({ id, username: `${role}${id}`, role }, SECRET);
async function call(method, { role, query = '', body } = {}) {
  const res = await fetch(base + query, {
    method,
    headers: {
      ...(role ? { authorization: `Bearer ${token(role)}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const VALID = { name: 'Test Health Center', facility_type: 'HC', barangay_name: 'Bagong Ilog', address: '123 Main St' };

describe('GET /facilities status filter', () => {
  it('defaults to active-only rows so existing consumers stay unchanged', async () => {
    const r = await call('GET', { role: 'admin' });
    assert.strictEqual(r.status, 200);
    const q = captured.facilitiesSql;
    assert.ok(q.includes("WHERE COALESCE((to_jsonb(h)->>'is_active')::boolean, TRUE)"), `active WHERE missing: ${q}`);
    assert.ok(!q.includes('WHERE NOT COALESCE'), 'default must not invert the predicate');
  });

  it('status=all removes the is_active predicate entirely', async () => {
    const r = await call('GET', { role: 'admin', query: '?status=all' });
    assert.strictEqual(r.status, 200);
    assert.ok(!captured.facilitiesSql.includes('WHERE COALESCE'), `unexpected WHERE clause: ${captured.facilitiesSql}`);
    assert.ok(!captured.facilitiesSql.includes('WHERE NOT'), 'all must not filter by status');
  });

  it('status=inactive inverts the predicate', async () => {
    const r = await call('GET', { role: 'admin', query: '?status=inactive' });
    assert.strictEqual(r.status, 200);
    assert.ok(captured.facilitiesSql.includes("WHERE NOT COALESCE((to_jsonb(h)->>'is_active')::boolean, TRUE)"), `inactive WHERE missing: ${captured.facilitiesSql}`);
  });

  it('unknown status value → 400', async () => {
    const r = await call('GET', { role: 'admin', query: '?status=garbage' });
    assert.strictEqual(r.status, 400);
  });

  it('anonymous → 401', async () => {
    const r = await call('GET', {});
    assert.strictEqual(r.status, 401);
  });

  it('rows expose is_active, city and View-panel detail fields', async () => {
    facilityRows = [{
      id: 7, name: 'Old Station', barangay_name: 'Dela Paz', facility_type: 'PC',
      address: null, barangay_id: 9, ownership: 'public', facility_category: 'health_center',
      is_external: false, is_reference: false, is_active: false, city: 'Pasig City',
      contact_number: '02-1234', facility_code: 'PC-01', notes: 'legacy row',
      created_at: '2025-01-15T08:00:00.000Z', updated_at: null,
    }];
    const r = await call('GET', { role: 'admin', query: '?status=all' });
    facilityRows = [];
    assert.strictEqual(r.status, 200);
    const f = r.body.facilities[0];
    assert.strictEqual(f.is_active, false);
    assert.strictEqual(f.city, 'Pasig City');
    assert.strictEqual(f.contact_number, '02-1234');
    assert.strictEqual(f.facility_code, 'PC-01');
    assert.strictEqual(r.body.by_barangay['Dela Paz'][0].city, 'Pasig City');
    assert.strictEqual(typeof r.body.barangay_count, 'number');
    assert.ok(Array.isArray(r.body.barangays));
  });

  it('staff may read the directory (200) — browse is not admin-only', async () => {
    const r = await call('GET', { role: 'staff', query: '?status=all' });
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.facilities));
  });

  it('admin gets a permissions payload enabling every write control', async () => {
    const r = await call('GET', { role: 'admin', query: '?status=all' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.permissions, {
      view: true, search: true, details: true,
      add: true, edit: true, activate: true, aliases: true, resolveMapping: true,
    });
  });

  it('staff gets the same payload minus every write control (view-only directory)', async () => {
    const r = await call('GET', { role: 'staff', query: '?status=all' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.permissions, {
      view: true, search: true, details: true,
      add: false, edit: false, activate: false, aliases: false, resolveMapping: false,
    });
  });
});

describe('POST /facilities (admin only)', () => {
  it('staff → 403: the module stays view-only for staff', async () => {
    const r = await call('POST', { role: 'staff', body: VALID });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(captured.insertSql, null, 'staff must never reach the insert');
  });

  it('anonymous → 401', async () => {
    const r = await call('POST', { body: VALID });
    assert.strictEqual(r.status, 401);
  });

  it('admin with a valid body inserts and records an audit event', async () => {
    auditCalls.length = 0;
    captured.insertSql = null;
    const r = await call('POST', { role: 'admin', body: VALID });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.facility.id, 99);
    assert.strictEqual(r.body.facility.is_active, true);
    assert.ok(captured.insertSql.includes('INSERT INTO health_facilities'));
    assert.strictEqual(captured.insertParams[0], 'Test Health Center');
    assert.strictEqual(captured.insertParams[1], 'HC');
    assert.strictEqual(captured.insertParams[2], 'Bagong Ilog');
    assert.strictEqual(captured.insertParams[3], 5);
    assert.strictEqual(captured.insertParams[4], '123 Main St');
    assert.strictEqual(captured.insertParams[9], null, 'ownership default null');
    assert.strictEqual(auditCalls.length, 1);
    assert.strictEqual(auditCalls[0].action, 'FACILITY_CREATE');
    assert.strictEqual(auditCalls[0].resourceType, 'facility');
    assert.strictEqual(auditCalls[0].resourceId, 99);
  });

  it('missing name → 400', async () => {
    const r = await call('POST', { role: 'admin', body: { ...VALID, name: '   ' } });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /name/i);
  });

  it('invalid facility type → 400', async () => {
    const r = await call('POST', { role: 'admin', body: { ...VALID, facility_type: 'HOSP' } });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /type/i);
  });

  it('missing barangay → 400', async () => {
    const r = await call('POST', { role: 'admin', body: { ...VALID, barangay_name: '' } });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /barangay/i);
  });

  it('unknown barangay → 400', async () => {
    const saved = barangayLookup;
    barangayLookup = [];
    const r = await call('POST', { role: 'admin', body: VALID });
    barangayLookup = saved;
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /unknown barangay/i);
  });

  it('duplicate (name, barangay) → 409', async () => {
    insertImpl = () => { throw Object.assign(new Error('duplicate key value'), { code: '23505' }); };
    const r = await call('POST', { role: 'admin', body: VALID });
    insertImpl = null;
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /already exists/i);
  });

  it('valid create mirrors the row into facility_ref immediately', async () => {
    syncCalls.length = 0;
    const r = await call('POST', { role: 'admin', body: VALID });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(syncCalls.length, 1);
    assert.ok(syncCalls[0].authPool, 'sync receives the auth pool');
    assert.ok(syncCalls[0].pool, 'sync receives the validation pool');
  });

  it('defaults to classification=pasig + status=active when omitted', async () => {
    const r = await call('POST', { role: 'admin', body: VALID });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(captured.insertParams[5], true, 'is_active default');
    assert.strictEqual(captured.insertParams[6], false, 'is_external default');
    assert.strictEqual(captured.insertParams[7], 'Pasig City', 'pasig keeps the Pasig city');
    assert.ok(r.body.facility.is_external === false && r.body.facility.is_active === true);
  });

  it('invalid classification → 400', async () => {
    const r = await call('POST', { role: 'admin', body: { ...VALID, classification: 'alien' } });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /classification/i);
  });

  it('invalid status → 400', async () => {
    const r = await call('POST', { role: 'admin', body: { ...VALID, status: 'zombie' } });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /status/i);
  });

  it('status=inactive inserts is_active=false', async () => {
    const r = await call('POST', { role: 'admin', body: { ...VALID, status: 'inactive' } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(captured.insertParams[5], false);
    assert.strictEqual(r.body.facility.is_active, false);
  });

  it('external facility: no barangay required, barangay stays NULL, city stored', async () => {
    barangayLookups = 0;
    const r = await call('POST', {
      role: 'admin',
      body: { name: 'Outside Clinic', facility_type: 'HC', classification: 'external', city: 'Marikina City' },
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(captured.insertParams[2], null, 'barangay_name must be NULL');
    assert.strictEqual(captured.insertParams[3], null, 'barangay_id must be NULL');
    assert.strictEqual(captured.insertParams[6], true, 'is_external');
    assert.strictEqual(captured.insertParams[7], 'Marikina City');
    assert.strictEqual(barangayLookups, 0, 'external must skip the barangay lookup');
    assert.strictEqual(r.body.facility.city, 'Marikina City');
  });

  it('external facility without a city → 400 (city required on create)', async () => {
    captured.insertSql = null;
    const r = await call('POST', {
      role: 'admin',
      body: { name: 'Unknown Location HC', facility_type: 'HC', classification: 'external' },
    });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /city/i);
    assert.strictEqual(captured.insertSql, null, 'must not insert');
  });

  it('pasig classification still requires a barangay', async () => {
    const r = await call('POST', {
      role: 'admin',
      body: { ...VALID, classification: 'pasig', barangay_name: '' },
    });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /barangay/i);
  });

  it('create persists notes (trimmed)', async () => {
    const r = await call('POST', { role: 'admin', body: { ...VALID, notes: '  has notes  ' } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(captured.insertParams[8], 'has notes');
    assert.strictEqual(r.body.facility.notes, 'has notes');
  });

  it('create persists ownership', async () => {
    const r = await call('POST', { role: 'admin', body: { ...VALID, ownership: 'public' } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(captured.insertParams[9], 'public');
    assert.strictEqual(r.body.facility.ownership, 'public');
  });

  it('invalid ownership → 400', async () => {
    const r = await call('POST', { role: 'admin', body: { ...VALID, ownership: 'government' } });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /ownership/i);
  });

  it('create persists contact_number (trimmed)', async () => {
    const r = await call('POST', { role: 'admin', body: { ...VALID, contact_number: '  0917 123 4567  ' } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(captured.insertParams[10], '0917 123 4567');
    assert.strictEqual(r.body.facility.contact_number, '0917 123 4567');
  });

  it('empty contact_number stores NULL', async () => {
    const r = await call('POST', { role: 'admin', body: { ...VALID, contact_number: '   ' } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(captured.insertParams[10], null);
  });

  it('duplicate caught by the norm pre-check before any insert (case / tag variant)', async () => {
    captured.insertSql = null;
    dupRows = [{ id: 44, name: 'Test Health Center - IDOTS', barangay_name: 'Bagong Ilog' }];
    const r = await call('POST', { role: 'admin', body: VALID });
    dupRows = [];
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /already exists/i);
    assert.strictEqual(captured.insertSql, null, 'the pre-check must reject before the insert');
  });

  it('the same name in a DIFFERENT barangay is not a duplicate', async () => {
    captured.insertSql = null;
    dupRows = [{ id: 44, name: 'Test Health Center', barangay_name: 'Rosario' }];
    const r = await call('POST', { role: 'admin', body: VALID });
    dupRows = [];
    assert.strictEqual(r.status, 201);
    assert.ok(captured.insertSql, 'distinct barangay → insert proceeds');
  });
});

describe('PUT /facilities/:id (admin only)', () => {
  beforeEach(() => {
    currentRow = { ...CURRENT_DEFAULT };
    captured.updateSql = null;
    captured.updateParams = null;
    poolState.aliases = [];
    updateImpl = null;
    dupRows = [];
    otherFacilityRows = [];
    auditCalls.length = 0;
    syncCalls.length = 0;
    barangayLookups = 0;
  });

  const EDIT = {
    name: 'Bagong Ilog Health Center', facility_type: 'PC', classification: 'pasig',
    status: 'inactive', barangay_name: 'Bagong Ilog', address: '12 Main St',
    ownership: 'private', notes: 'edited',
  };

  it('staff → 403: no edit path for staff', async () => {
    const r = await call('PUT', { role: 'staff', query: '/12', body: EDIT });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(captured.updateSql, null, 'staff must never reach the update');
  });

  it('invalid id → 400', async () => {
    const r = await call('PUT', { role: 'admin', query: '/abc', body: EDIT });
    assert.strictEqual(r.status, 400);
  });

  it('unknown id → 404', async () => {
    currentRow = null;
    const r = await call('PUT', { role: 'admin', query: '/404', body: EDIT });
    assert.strictEqual(r.status, 404);
  });

  it('admin edit updates the record and audits FACILITY_UPDATE with the diff', async () => {
    const r = await call('PUT', { role: 'admin', query: '/12', body: EDIT });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.facility.name, 'Bagong Ilog Health Center');
    assert.strictEqual(r.body.facility.is_active, false);
    // [id, name, type, barangay, barangayId, address, isActive, isExternal, city, ownership, notes, contact]
    assert.deepStrictEqual(captured.updateParams.slice(1), [
      'Bagong Ilog Health Center', 'PC', 'Bagong Ilog', 5, '12 Main St',
      false, false, 'Pasig City', 'private', 'edited', null,
    ]);
    const upd = auditCalls.find(a => a.action === 'FACILITY_UPDATE');
    assert.ok(upd, 'FACILITY_UPDATE audit missing');
    assert.strictEqual(upd.details.changed.name.old, 'Bagong Ilog HC');
    assert.strictEqual(upd.details.changed.name.new, 'Bagong Ilog Health Center');
    assert.strictEqual(upd.details.changed.status.new, 'inactive');
  });

  it('invalid classification → 400', async () => {
    const r = await call('PUT', { role: 'admin', query: '/12', body: { ...EDIT, classification: 'alien' } });
    assert.strictEqual(r.status, 400);
  });

  it('invalid status → 400', async () => {
    const r = await call('PUT', { role: 'admin', query: '/12', body: { ...EDIT, status: 'zombie' } });
    assert.strictEqual(r.status, 400);
  });

  it('pasig without a barangay → 400', async () => {
    const r = await call('PUT', { role: 'admin', query: '/12', body: { ...EDIT, barangay_name: '' } });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /barangay/i);
  });

  it('pasig → external clears barangay, sets flags, stores city', async () => {
    const r = await call('PUT', {
      role: 'admin', query: '/12',
      body: { ...EDIT, classification: 'external', barangay_name: '', city: 'Marikina City' },
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(captured.updateParams[3], null, 'barangay_name must clear');
    assert.strictEqual(captured.updateParams[4], null, 'barangay_id must clear');
    assert.strictEqual(captured.updateParams[7], true, 'is_external');
    assert.strictEqual(captured.updateParams[8], 'Marikina City');
    assert.strictEqual(barangayLookups, 0, 'external must skip the barangay lookup');
  });

  it('external → pasig requires a barangay', async () => {
    currentRow = { ...CURRENT_DEFAULT, is_external: true, barangay_name: null, city: null };
    const r = await call('PUT', { role: 'admin', query: '/12', body: { ...EDIT, barangay_name: '' } });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /barangay/i);
  });

  it('rename parks the old name as an alias and re-syncs facility_ref', async () => {
    const r = await call('PUT', { role: 'admin', query: '/12', body: EDIT });
    assert.strictEqual(r.status, 200);
    const parked = poolState.aliases.find(a => a.facility_id === 12);
    assert.ok(parked, 'old name must be preserved as an alias');
    assert.strictEqual(parked.alias_text, 'Bagong Ilog HC');
    assert.strictEqual(parked.alias_norm, 'bagongiloghc');
    assert.strictEqual(syncCalls.length, 1, 'facility_ref mirror must refresh');
  });

  it('rename without a name change parks nothing', async () => {
    const r = await call('PUT', {
      role: 'admin', query: '/12',
      body: { ...EDIT, name: CURRENT_DEFAULT.name },
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(poolState.aliases.length, 0);
  });

  it('duplicate (name, barangay) → 409', async () => {
    updateImpl = () => { throw Object.assign(new Error('duplicate key value'), { code: '23505' }); };
    const r = await call('PUT', { role: 'admin', query: '/12', body: EDIT });
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /already exists/i);
  });

  it('a partial body never nulls omitted columns (merge with the current row)', async () => {
    const r = await call('PUT', {
      role: 'admin', query: '/12',
      body: { name: 'Bagong Ilog Health Center', facility_type: 'PC', barangay_name: 'Bagong Ilog' },
    });
    assert.strictEqual(r.status, 200);
    // omitted → current values: address, active, pasig classification, city, ownership, notes, contact
    assert.deepStrictEqual(captured.updateParams.slice(1), [
      'Bagong Ilog Health Center', 'PC', 'Bagong Ilog', 5, null,
      true, false, 'Pasig City', 'public', null, null,
    ]);
  });

  it('external classification without a city → 400 (city required on edit too)', async () => {
    captured.updateSql = null;
    const r = await call('PUT', {
      role: 'admin', query: '/12',
      body: { ...EDIT, classification: 'external', barangay_name: '', city: '' },
    });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /city/i);
    assert.strictEqual(captured.updateSql, null, 'must not update');
  });

  it('edit persists contact_number', async () => {
    const r = await call('PUT', { role: 'admin', query: '/12', body: { ...EDIT, contact_number: '(02) 8654-3210' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(captured.updateParams[11], '(02) 8654-3210');
    assert.strictEqual(r.body.facility.contact_number, '(02) 8654-3210');
  });

  it('duplicate caught by the norm pre-check before any update', async () => {
    captured.updateSql = null;
    dupRows = [{ id: 44, name: 'BAGONG ILOG HEALTH CENTER - MTBN', barangay_name: 'Bagong Ilog' }];
    const r = await call('PUT', { role: 'admin', query: '/12', body: EDIT });
    dupRows = [];
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /already exists/i);
    assert.strictEqual(captured.updateSql, null, 'the pre-check must reject before the update');
  });
});

describe('facility aliases (GET any role; POST/DELETE admin)', () => {
  beforeEach(() => {
    poolState.aliases = [];
    facilityById = { id: 12, name: 'Bagong Ilog HC' };
    otherFacilityRows = [];
    auditCalls.length = 0;
    refreshCalls.length = 0;
    suggestionsState.rows = [];
    suggestionsState.registry = [];
    captured.aliasInsertParams = null;
    captured.aliasDeleteParams = null;
  });

  it('GET returns the facility’s aliases for any authenticated role', async () => {
    poolState.aliases.push({ alias_norm: 'bagongiloghealthcenter', alias_text: 'Bagong Ilog Health Center', facility_id: 12 });
    poolState.aliases.push({ alias_norm: 'other', alias_text: 'Other', facility_id: 99 });
    const r = await call('GET', { role: 'staff', query: '/12/aliases' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.aliases.length, 1, 'must only return this facility’s aliases');
    assert.strictEqual(r.body.aliases[0].alias_text, 'Bagong Ilog Health Center');
  });

  it('GET anonymous → 401', async () => {
    const r = await call('GET', { query: '/12/aliases' });
    assert.strictEqual(r.status, 401);
  });

  it('admin adds an alias mapped to the same facility id', async () => {
    const r = await call('POST', { role: 'admin', query: '/12/aliases', body: { alias_text: 'Bagong Ilog Health Center' } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.aliases.length, 1);
    assert.deepStrictEqual(captured.aliasInsertParams.slice(0, 3), ['bagongiloghealthcenter', 'Bagong Ilog Health Center', 12]);
    const a = auditCalls.find(x => x.action === 'FACILITY_ALIAS_ADD');
    assert.ok(a, 'FACILITY_ALIAS_ADD audit missing');
    assert.strictEqual(a.resourceId, 12);
  });

  it('empty alias → 400', async () => {
    const r = await call('POST', { role: 'admin', query: '/12/aliases', body: { alias_text: '   ' } });
    assert.strictEqual(r.status, 400);
  });

  it('alias without letters/numbers → 400', async () => {
    const r = await call('POST', { role: 'admin', query: '/12/aliases', body: { alias_text: '!!!' } });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /letters or numbers/i);
  });

  it('alias equal to the facility’s current name → 400', async () => {
    const r = await call('POST', { role: 'admin', query: '/12/aliases', body: { alias_text: 'Bagong Ilog HC' } });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /already the facility/i);
  });

  it('unknown facility → 404', async () => {
    facilityById = null;
    const r = await call('POST', { role: 'admin', query: '/77/aliases', body: { alias_text: 'Some Alias' } });
    assert.strictEqual(r.status, 404);
  });

  it('duplicate alias (already mapped) → 409', async () => {
    poolState.aliases.push({ alias_norm: 'rosariohc', alias_text: 'Rosario HC', facility_id: 55 });
    const r = await call('POST', { role: 'admin', query: '/12/aliases', body: { alias_text: 'ROSARIO HC' } });
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /already mapped/i);
  });

  it('alias equal to ANOTHER facility’s canonical name → 409 (never shadow a facility)', async () => {
    otherFacilityRows = [{ id: 55, name: 'Rosario Health Center' }];
    const r = await call('POST', { role: 'admin', query: '/12/aliases', body: { alias_text: 'rosario health center' } });
    otherFacilityRows = [];
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /another facility/i);
    assert.strictEqual(poolState.aliases.length, 0, 'nothing written on a clash');
  });

  it('alias edit colliding with another facility’s canonical name → 409', async () => {
    poolState.aliases.push({ alias_norm: 'rosariohc', alias_text: 'Rosario HC', facility_id: 12 });
    otherFacilityRows = [{ id: 55, name: 'Rosario Health Center' }];
    const r = await call('PUT', { role: 'admin', query: '/12/aliases/rosariohc', body: { alias_text: 'Rosario Health Center' } });
    otherFacilityRows = [];
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /another facility/i);
    assert.strictEqual(poolState.aliases[0].alias_text, 'Rosario HC', 'the stored alias must not change');
  });

  it('staff → 403 on add', async () => {
    const r = await call('POST', { role: 'staff', query: '/12/aliases', body: { alias_text: 'Some Alias' } });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(captured.aliasInsertParams, null);
  });

  it('admin removes an alias and audits it', async () => {
    poolState.aliases.push({ alias_norm: 'bagongiloghc', alias_text: 'Bagong Ilog HC', facility_id: 12 });
    const r = await call('DELETE', { role: 'admin', query: '/12/aliases/bagongiloghc' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.aliases.length, 0);
    assert.deepStrictEqual(captured.aliasDeleteParams, ['bagongiloghc', 12]);
    const a = auditCalls.find(x => x.action === 'FACILITY_ALIAS_REMOVE');
    assert.ok(a, 'FACILITY_ALIAS_REMOVE audit missing');
  });

  it('removing a missing alias → 404', async () => {
    const r = await call('DELETE', { role: 'admin', query: '/12/aliases/nothere' });
    assert.strictEqual(r.status, 404);
  });

  it('staff → 403 on delete', async () => {
    poolState.aliases.push({ alias_norm: 'bagongiloghc', alias_text: 'Bagong Ilog HC', facility_id: 12 });
    const r = await call('DELETE', { role: 'staff', query: '/12/aliases/bagongiloghc' });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(poolState.aliases.length, 1, 'staff must not remove aliases');
  });

  it('admin edits a wrong alias: text and normalized key update, same facility id', async () => {
    poolState.aliases.push({ alias_norm: 'rosariohc', alias_text: 'Rosario HC', facility_id: 12 });
    const r = await call('PUT', { role: 'admin', query: '/12/aliases/rosariohc', body: { alias_text: 'Rosario Health Center' } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(captured.aliasUpdateParams.slice(0, 2), ['Rosario Health Center', 'rosariohealthcenter']);
    assert.strictEqual(captured.aliasUpdateParams[3], 12, 'facility_id must stay the same');
    assert.strictEqual(r.body.aliases[0].alias_text, 'Rosario Health Center');
    assert.strictEqual(r.body.aliases[0].alias_norm, 'rosariohealthcenter');
    const a = auditCalls.find(x => x.action === 'FACILITY_ALIAS_UPDATE');
    assert.ok(a, 'FACILITY_ALIAS_UPDATE audit missing');
  });

  it('alias edit colliding with another mapping → 409', async () => {
    poolState.aliases.push({ alias_norm: 'rosariohc', alias_text: 'Rosario HC', facility_id: 12 });
    poolState.aliases.push({ alias_norm: 'takenalias', alias_text: 'Taken Alias', facility_id: 55 });
    const r = await call('PUT', { role: 'admin', query: '/12/aliases/rosariohc', body: { alias_text: 'taken alias' } });
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /already mapped/i);
  });

  it('alias edit equal to the facility’s name → 400', async () => {
    poolState.aliases.push({ alias_norm: 'rosariohc', alias_text: 'Rosario HC', facility_id: 12 });
    const r = await call('PUT', { role: 'admin', query: '/12/aliases/rosariohc', body: { alias_text: 'Bagong Ilog HC' } });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /already the facility/i);
  });

  it('alias edit on a missing alias → 404', async () => {
    const r = await call('PUT', { role: 'admin', query: '/12/aliases/nothere', body: { alias_text: 'Anything' } });
    assert.strictEqual(r.status, 404);
  });

  it('staff → 403 on alias edit', async () => {
    poolState.aliases.push({ alias_norm: 'rosariohc', alias_text: 'Rosario HC', facility_id: 12 });
    const r = await call('PUT', { role: 'staff', query: '/12/aliases/rosariohc', body: { alias_text: 'Staff Edit' } });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(poolState.aliases[0].alias_text, 'Rosario HC', 'staff must not change aliases');
  });

  it('a trailing program tag is stripped from the key but the raw text is kept', async () => {
    const r = await call('POST', { role: 'admin', query: '/12/aliases', body: { alias_text: 'Rosario Health Center - IDOTS' } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(captured.aliasInsertParams[0], 'rosariohealthcenter', 'tag must not be part of the key');
    assert.strictEqual(captured.aliasInsertParams[1], 'Rosario Health Center - IDOTS', 'alias_text must stay exactly as entered');
    assert.strictEqual(poolState.aliases[0].alias_norm, 'rosariohealthcenter');
  });

  it('tag variants collapse with plain case variants onto one key', async () => {
    const first = await call('POST', { role: 'admin', query: '/12/aliases', body: { alias_text: 'ROSARIO HEALTH CENTER - IDOTS' } });
    assert.strictEqual(first.status, 201);
    const second = await call('POST', { role: 'admin', query: '/12/aliases', body: { alias_text: 'Rosario Health Center' } });
    assert.strictEqual(second.status, 409, 'same normalized key must collide');
    assert.strictEqual(poolState.aliases.length, 1);
  });

  it('alias carrying a tag on the facility’s own name → 400 already the name', async () => {
    facilityById = { id: 12, name: 'Bagong Ilog Health Center - MTBN' };
    const r = await call('POST', { role: 'admin', query: '/12/aliases', body: { alias_text: 'Bagong Ilog Health Center - IDOTS' } });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /already the facility/i);
  });

  it('a successful add re-resolves case facility ids immediately', async () => {
    const r = await call('POST', { role: 'admin', query: '/12/aliases', body: { alias_text: 'Bagong Ilog Health Center' } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(refreshCalls.length, 1, 'refreshFacilityIds must run right after the alias is saved');
    assert.strictEqual(typeof refreshCalls[0].query, 'function', 'must be handed the validation pool');
  });

  it('a successful edit and remove each re-resolve case facility ids', async () => {
    poolState.aliases.push({ alias_norm: 'rosariohc', alias_text: 'Rosario HC', facility_id: 12 });
    const put = await call('PUT', { role: 'admin', query: '/12/aliases/rosariohc', body: { alias_text: 'Rosario Health Center' } });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(refreshCalls.length, 1, 'edit must re-resolve');
    const del = await call('DELETE', { role: 'admin', query: '/12/aliases/rosariohealthcenter' });
    assert.strictEqual(del.status, 200);
    assert.strictEqual(refreshCalls.length, 2, 'remove must re-resolve');
  });

  it('rejected adds (400/403/404/409) never trigger a re-resolve', async () => {
    poolState.aliases.push({ alias_norm: 'rosariohc', alias_text: 'Rosario HC', facility_id: 55 });
    await call('POST', { role: 'admin', query: '/12/aliases', body: { alias_text: '   ' } });
    await call('POST', { role: 'staff', query: '/12/aliases', body: { alias_text: 'Some Alias' } });
    facilityById = null;
    await call('POST', { role: 'admin', query: '/77/aliases', body: { alias_text: 'Some Alias' } });
    facilityById = { id: 12, name: 'Bagong Ilog HC' };
    await call('POST', { role: 'admin', query: '/12/aliases', body: { alias_text: 'ROSARIO HC' } });
    assert.strictEqual(refreshCalls.length, 0, 'no failed alias change may re-resolve cases');
  });

  it('a rejected remove (404) never triggers a re-resolve', async () => {
    const r = await call('DELETE', { role: 'admin', query: '/12/aliases/nothere' });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(refreshCalls.length, 0);
  });
});

describe('GET /facilities/:id/alias-suggestions', () => {
  beforeEach(() => {
    poolState.aliases = [];
    facilityById = { id: 12, name: 'Bagong Ilog HC' };
    auditCalls.length = 0;
    refreshCalls.length = 0;
    suggestionsState.rows = [];
    suggestionsState.registry = [];
  });

  it('anonymous → 401', async () => {
    const r = await call('GET', { query: '/12/alias-suggestions' });
    assert.strictEqual(r.status, 401);
  });

  it('unknown facility → 404', async () => {
    facilityById = null;
    const r = await call('GET', { role: 'admin', query: '/77/alias-suggestions' });
    assert.strictEqual(r.status, 404);
  });

  it('invalid id → 400', async () => {
    const r = await call('GET', { role: 'admin', query: '/abc/alias-suggestions' });
    assert.strictEqual(r.status, 400);
  });

  it('staff → 403: suggestions belong with alias management (admin only)', async () => {
    const r = await call('GET', { role: 'staff', query: '/12/alias-suggestions' });
    assert.strictEqual(r.status, 403);
  });

  it('admin may read suggestions (read-only endpoint)', async () => {
    const r = await call('GET', { role: 'admin', query: '/12/alias-suggestions' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.suggestions, []);
  });

  it('only unresolved-name groups whose token match is THIS facility come back, with counts', async () => {
    suggestionsState.registry = [
      { id: 12, name: 'Bagong Ilog HC' },
      { id: 63, name: 'Rosario HC' },
    ];
    suggestionsState.rows = [
      { alias_text: 'BAGONG ILOG HEALTH CENTER - IDOTS', records: 400 },
      { alias_text: 'ROSARIO HEALTH CENTER - IDOTS', records: 1054 },
      { alias_text: 'THE MEDICAL CITY-PASIG - MTBN', records: 12 },
    ];
    const r = await call('GET', { role: 'admin', query: '/12/alias-suggestions' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.suggestions.length, 1, 'must keep only the group matching this facility');
    assert.deepStrictEqual(r.body.suggestions[0], { alias_text: 'BAGONG ILOG HEALTH CENTER - IDOTS', records: 400 });
    assert.ok(captured.suggestionsSql.includes('treatment_facility_id IS NULL'), 'must only read unresolved rows');
    assert.ok(captured.suggestionsSql.includes('screening_facility_id IS NULL'), 'must only read unresolved rows');
  });

  it('the underlying query is grouped by norm_facility and ordered by volume', async () => {
    await call('GET', { role: 'admin', query: '/12/alias-suggestions' });
    assert.ok(captured.suggestionsSql.includes('GROUP BY norm_facility(t)'), captured.suggestionsSql);
    assert.ok(captured.suggestionsSql.includes('ORDER BY "records" DESC'), captured.suggestionsSql);
    assert.ok(captured.suggestionsSql.includes('is_archived = false'), 'must use the LIVE fragment');
    assert.strictEqual(captured.registrySql, 'SELECT id, name FROM facility_ref');
  });
});
