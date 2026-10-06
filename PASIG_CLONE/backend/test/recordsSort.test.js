/**
 * GET /records sorting — the list is server-paginated, so ordering is decided in SQL:
 *   - default            = newest first (v.id DESC), unchanged for existing callers
 *   - whitelisted keys   (sort=outcome&dir=asc) map to fixed columns, never user SQL
 *   - multi-column keys  (patient) apply the direction to every column
 *   - unknown key / dir / injection attempts fall back to the default order
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

const captured = { dataSql: null };

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
      throw new Error(`Unexpected pool query: ${q.slice(0, 120)}`);
    },
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
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
async function fetchOrder(query = '') {
  captured.dataSql = null;
  const res = await fetch(`${base}/records${query}`, { headers: { authorization: `Bearer ${token()}` } });
  return { status: res.status, sql: captured.dataSql };
}

describe('GET /records sorting', () => {
  it('defaults to newest first', async () => {
    const r = await fetchOrder();
    assert.strictEqual(r.status, 200);
    assert.ok(r.sql && r.sql.includes('ORDER BY v.id DESC LIMIT'), r.sql);
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
    // Names order only operational records; historical (de-identified) ones fall back to Patient #.
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
