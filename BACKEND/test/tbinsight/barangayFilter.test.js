/**
 * Barangay filter on the Dashboard KPI queries: one name behaves as it always did, a
 * list (the Dashboard's recommended filters) scopes to that group of barangays.
 * Uses a mock pool, so no database is touched.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { barangayList, barangayCondition } = require('../../tbinsight/barangayFilter');
const { computeTreatmentSuccessRate } = require('../../tbinsight/treatmentSuccessRate');
const { computeCaseFatalityRate } = require('../../tbinsight/caseFatalityRate');

function mockPool(rows) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => { calls.push({ sql: String(sql).replace(/\s+/g, ' '), params }); return { rows: rows(sql) }; },
  };
}

describe('barangayList', () => {
  it('accepts nothing, one name, or a list, and drops blanks', () => {
    assert.deepStrictEqual(barangayList(undefined), []);
    assert.deepStrictEqual(barangayList(''), []);
    assert.deepStrictEqual(barangayList(' Ugong '), ['Ugong']);
    assert.deepStrictEqual(barangayList(['Ugong', ' ', 'Rosario']), ['Ugong', 'Rosario']);
  });
});

describe('barangayCondition', () => {
  it('is null with no barangay', () => {
    assert.strictEqual(barangayCondition('barangay_name', '$1', undefined), null);
  });
  it('one name keeps the original equality condition and a plain string value', () => {
    const c = barangayCondition('barangay_name', '$3', 'Ugong');
    assert.strictEqual(c.sql, 'TRIM(barangay_name) = $3');
    assert.strictEqual(c.value, 'Ugong');
  });
  it('several names use ANY() with an array value', () => {
    const c = barangayCondition('barangay_name', '$3', ['Ugong', 'Rosario']);
    assert.strictEqual(c.sql, 'TRIM(barangay_name) = ANY($3::text[])');
    assert.deepStrictEqual(c.value, ['Ugong', 'Rosario']);
  });
});

describe('treatment success rate by barangay group', () => {
  const rows = () => [{ total_patients: 10, cured_count: 6, completed_count: 2 }];

  it('one barangay: unchanged equality filter', async () => {
    const pool = mockPool(rows);
    const r = await computeTreatmentSuccessRate(pool, { year: 2025, barangay: 'Ugong' });
    assert.match(pool.calls[0].sql, /TRIM\(barangay_name\) = \$2/);
    assert.deepStrictEqual(pool.calls[0].params, [2024, 'Ugong']);
    assert.strictEqual(r.successRate, 80);
  });

  it('a group of barangays: ANY() filter, cohort year unchanged', async () => {
    const pool = mockPool(rows);
    await computeTreatmentSuccessRate(pool, { year: 2025, barangay: ['Ugong', 'Rosario'] });
    assert.match(pool.calls[0].sql, /TRIM\(barangay_name\) = ANY\(\$2::text\[\]\)/);
    assert.deepStrictEqual(pool.calls[0].params, [2024, ['Ugong', 'Rosario']]);
  });

  it('no barangay: no barangay condition at all', async () => {
    const pool = mockPool(rows);
    await computeTreatmentSuccessRate(pool, { year: 2025 });
    assert.ok(!/barangay_name/.test(pool.calls[0].sql));
  });
});

describe('case fatality rate by barangay group', () => {
  const rows = (sql) => (/COUNT/i.test(sql) ? [{ died: 2, evaluated: 20, total: 30 }] : [{}]);

  it('a group of barangays reaches BOTH queries with consistent placeholders', async () => {
    const pool = mockPool(rows);
    await computeCaseFatalityRate(pool, { year: 2025, barangay: ['Ugong', 'Rosario'] });
    assert.ok(pool.calls.length >= 1);
    for (const c of pool.calls) {
      assert.match(c.sql, /TRIM\(barangay_name\) = ANY\(\$\d+::text\[\]\)/);
      const used = [...c.sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1]));
      assert.strictEqual(Math.max(...used), c.params.length, 'every placeholder has a value');
      assert.ok(c.params.some(p => Array.isArray(p) && p.join() === 'Ugong,Rosario' && !p.includes('CURED')));
    }
  });

  it('one barangay keeps the equality filter', async () => {
    const pool = mockPool(rows);
    await computeCaseFatalityRate(pool, { barangay: 'Ugong' });
    for (const c of pool.calls) assert.match(c.sql, /TRIM\(barangay_name\) = \$\d+/);
  });
});
