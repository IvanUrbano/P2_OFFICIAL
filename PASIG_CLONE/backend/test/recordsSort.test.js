/**
 * GET /records list views and sorting are server-side and use whitelisted SQL.
 * Run: node --test test/recordsSort.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-records-sort-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

const captured = { dataSql: null, restoreCalls: [] };

stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {} });
stub('../db/pasigSchema', {
  pool: {
    query: async (sql) => {
      const q = String(sql).replace(/\s+/g, ' ');
      if (q.includes('SELECT v.*, p.patient_no')) {
        captured.dataSql = q;
        return { rows: [] };
      }
      if (q.includes('COUNT(*)::int AS n')) return { rows: [{ n: 0 }] };
      if (q.includes('COUNT(*)::int AS total')) return { rows: [{ total: 0 }] };
      if (q.includes('SELECT id, is_archived FROM validated_tb_cases')) return { rows: [{ id: 9, is_archived: true }] };
      throw new Error(`Unexpected pool query: ${q.slice(0, 120)}`);
    },
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
  },
  restoreRecord: async (id) => {
    captured.restoreCalls.push(id);
    return { rows: [{ id: Number(id), is_archived: false }] };
  },
  authPool: {
    query: async (sql) => {
      if (String(sql).includes('JOIN barangays b')) return { rows: [{ barangay_id: 17, barangay_name: 'Rosario' }] };
      throw new Error(`Unexpected authPool query: ${String(sql).slice(0, 120)}`);
    },
  },
});
stub('../utils/auditLogger', { logAuditEvent: async () => {} });

const csvImportRouter = require('../routes/csvImport');

let server; let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/data', csvImportRouter);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/data`;
});
after(() => server.close());

const token = (role = 'admin', id = 1) => jwt.sign({ id, username: `${role}${id}`, role }, SECRET);
async function fetchOrder(query = '', role = 'admin') {
  captured.dataSql = null;
  const res = await fetch(`${base}/records${query}`, { headers: { authorization: 'Bearer ' + token(role) } });
  return { status: res.status, sql: captured.dataSql };
}

describe('GET /records list views and sorting', () => {
  it('defaults to newest first', async () => {
    const r = await fetchOrder();
    assert.strictEqual(r.status, 200);
    assert.ok(r.sql && r.sql.includes('ORDER BY v.id DESC LIMIT'), r.sql);
  });

  it('lists archived records separately from active records', async () => {
    const active = await fetchOrder('?view=all');
    assert.ok(active.sql.includes('v.is_archived = false'), active.sql);

    const archived = await fetchOrder('?view=archived');
    assert.strictEqual(archived.status, 200);
    assert.ok(archived.sql.includes('AND v.is_archived = true'), archived.sql);
    assert.ok(!archived.sql.includes('v.is_archived = false'), archived.sql);
  });

  it('lists previously treated patients (registered history or an earlier episode) in their own view', async () => {
    const r = await fetchOrder('?view=previously_treated');
    assert.strictEqual(r.status, 200);
    assert.ok(r.sql.includes('v.is_archived = false'), r.sql);
    assert.ok(r.sql.includes("LIKE '%RELAPSE%'"), r.sql);
    assert.ok(r.sql.includes('o.patient_id = v.patient_id'), r.sql);
  });

  it('reports the previously treated count with the other tab counts', async () => {
    const res = await fetch(`${base}/records`, { headers: { authorization: 'Bearer ' + token('admin') } });
    const body = await res.json();
    assert.ok('previously_treated' in body.counts, JSON.stringify(body.counts));
  });

  it('allows only admins to restore an archived record', async () => {
    const staffResponse = await fetch(`${base}/records/9/restore`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer ' + token('staff') },
    });
    assert.strictEqual(staffResponse.status, 403);
    assert.deepStrictEqual(captured.restoreCalls, []);

    const adminResponse = await fetch(`${base}/records/9/restore`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer ' + token('admin') },
    });
    assert.strictEqual(adminResponse.status, 200);
    assert.deepStrictEqual(captured.restoreCalls, ['9']);
  });

  it('whitelisted keys map to their column with the requested direction', async () => {
    const r = await fetchOrder('?sort=outcome&dir=asc');
    assert.strictEqual(r.status, 200);
    assert.ok(r.sql.includes('ORDER BY v.treatment_outcome ASC LIMIT'), r.sql);
    const status = await fetchOrder('?sort=status&dir=asc');
    assert.ok(status.sql.includes('ORDER BY v.case_status ASC LIMIT'), status.sql);
  });

  it('filters case status and treatment outcome independently', async () => {
    const status = await fetchOrder('?status=ON%20TREATMENT');
    assert.ok(status.sql.includes('AND v.case_status = $1'), status.sql);
    assert.ok(!status.sql.includes('v.treatment_outcome ='), status.sql);
    const outcome = await fetchOrder('?outcome=CURED');
    assert.ok(outcome.sql.includes('AND v.treatment_outcome = $1'), outcome.sql);
    assert.ok(!outcome.sql.includes('v.case_status ='), outcome.sql);
  });

  it('multi-column keys apply the direction to every column', async () => {
    const r = await fetchOrder('?sort=patient&dir=desc');
    assert.strictEqual(r.status, 200);
    assert.ok(r.sql.includes(`ORDER BY CASE WHEN v.identity_class = 'operational' THEN v.last_name END DESC, CASE WHEN v.identity_class = 'operational' THEN v.first_name END DESC, p.patient_no DESC LIMIT`), r.sql);
  });

  it('direction is case-insensitive', async () => {
    const r = await fetchOrder('?sort=barangay&dir=ASC');
    assert.strictEqual(r.status, 200);
    assert.ok(r.sql.includes('ORDER BY v.barangay_name ASC LIMIT'), r.sql);
  });

  it('unknown keys, junk directions and injection attempts fall back to the default', async () => {
    for (const q of ['?sort=evil%3BDROP+TABLE+users', '?sort=bogus&dir=sideways']) {
      const r = await fetchOrder(q);
      assert.strictEqual(r.status, 200, q);
      assert.ok(r.sql && r.sql.includes('ORDER BY v.id DESC LIMIT'), `${q} -> ${r.sql}`);
      assert.ok(!/DROP|TABLE/i.test(r.sql), `injection leaked into SQL for ${q}`);
    }
  });
});
