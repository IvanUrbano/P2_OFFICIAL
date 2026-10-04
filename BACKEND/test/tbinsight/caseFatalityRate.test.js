/**
 * TBInsight — Case Fatality Rate Unit Tests
 *
 * Guards the root-cause regression of the Analytics NLG failure: the
 * evaluated-outcomes query and the total-count query are built in lockstep
 * with independent $1-based placeholder series. Every SQL fragment sent to
 * pg MUST have max($N) === params.length (and contiguous placeholders),
 * otherwise Postgres rejects the bind with
 * "could not determine data type of parameter $1" and the caller 500s.
 *
 * Mock pool only — no database required.
 * Run: node --test BACKEND/test/tbinsight/caseFatalityRate.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  computeCaseFatalityRate,
  EVALUATED_TERMINAL_OUTCOMES,
} = require('../../tbinsight/caseFatalityRate');

// ==================== MOCK POOL ====================

/**
 * Captures every (sql, params) pair and returns canned rows:
 *   - evaluated-outcomes query → { evaluated, died }
 *   - total-count query        → { total }
 */
function createCapturingPool({ evaluated = 10, died = 1, total = 100 } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const s = String(sql);
      if (s.includes('AS evaluated')) return { rows: [{ evaluated, died }] };
      if (s.includes('AS total')) return { rows: [{ total }] };
      return { rows: [] };
    },
  };
}

function placeholdersOf(sql) {
  return (String(sql).match(/\$\d+/g) || []).map((p) => Number(p.slice(1)));
}

/**
 * The invariant broken by the original bug:
 * max($N) === params.length, placeholders contiguous from $1, and no
 * params supplied for SQL without placeholders.
 */
function assertParamConsistency(label, sql, params) {
  const ph = placeholdersOf(sql);
  const list = params || [];
  if (ph.length === 0) {
    assert.strictEqual(
      list.length,
      0,
      `${label}: SQL has no placeholders but ${list.length} param(s) were supplied`
    );
    return;
  }
  const max = Math.max(...ph);
  assert.strictEqual(
    max,
    list.length,
    `${label}: max placeholder $${max} !== params.length ${list.length}\nSQL: ${sql}`
  );
  const uniqueSorted = [...new Set(ph)].sort((a, b) => a - b);
  assert.deepStrictEqual(
    uniqueSorted,
    Array.from({ length: max }, (_, i) => i + 1),
    `${label}: placeholders are not the contiguous set 1..${max} — ${JSON.stringify(ph)}`
  );
}

function assertAllCallsConsistent(pool, label) {
  assert.ok(pool.calls.length >= 1, `${label}: expected at least one query`);
  pool.calls.forEach((call, i) => {
    assertParamConsistency(`${label} [query ${i}]`, call.sql, call.params);
  });
}

// ==================== PARAM CONSISTENCY MATRIX ====================

describe('computeCaseFatalityRate — placeholder/param consistency', () => {
  const combos = [
    ['control (no filters)', {}],
    ['year', { year: 2025 }],
    ['year as string', { year: '2025' }],
    ['month', { month: 8 }],
    ['barangay (original repro)', { barangay: 'Bagong Ilog' }],
    ['sex', { sex: 'Female' }],
    ['ageGroup 25-34', { ageGroup: '25-34' }],
    ['ageGroup 65+ (raw condition, no bind)', { ageGroup: '65+' }],
    ['facility', { facility: 'Rizal Health Center' }],
    ['bacteriological', { bacteriological: 'smear' }],
    ['year + barangay', { year: 2025, barangay: 'Bagong Ilog' }],
    ['year + month + barangay', { year: 2025, month: 8, barangay: 'Bagong Ilog' }],
    ['sex + ageGroup', { sex: 'Male', ageGroup: '0-14' }],
    [
      'all filters combined',
      {
        year: 2025,
        month: 8,
        barangay: 'Bagong Ilog',
        sex: 'Female',
        ageGroup: '25-34',
        facility: 'Rizal Health Center',
        bacteriological: 'smear',
      },
    ],
  ];

  for (const [name, opts] of combos) {
    it(`builds consistent SQL/params for ${name}`, async () => {
      const pool = createCapturingPool();
      const result = await computeCaseFatalityRate(pool, opts);
      assertAllCallsConsistent(pool, name);
      // Two queries always: evaluated-outcomes + total-count.
      assert.strictEqual(pool.calls.length, 2, `${name}: expected exactly 2 queries`);
      assert.ok(Number.isFinite(result.rate) || result.rate === null,
        `${name}: rate must be finite or null, got ${result.rate}`);
    });
  }

  it('total-count query with only a barangay filter uses exactly $1 (regression)', async () => {
    const pool = createCapturingPool();
    await computeCaseFatalityRate(pool, { barangay: 'Bagong Ilog' });
    const totalCall = pool.calls[1];
    assert.deepStrictEqual(placeholdersOf(totalCall.sql), [1],
      `total query placeholders must be [1], got ${JSON.stringify(placeholdersOf(totalCall.sql))}\nSQL: ${totalCall.sql}`);
    assert.deepStrictEqual(totalCall.params, ['Bagong Ilog']);
  });

  it('evaluated query always binds the outcomes array as $1', async () => {
    const pool = createCapturingPool();
    await computeCaseFatalityRate(pool, { year: 2025, barangay: 'Bagong Ilog' });
    const evalCall = pool.calls[0];
    assert.ok(placeholdersOf(evalCall.sql).includes(1));
    assert.ok(Array.isArray(evalCall.params[0]),
      'params[0] must be the evaluated-outcomes array');
    assert.deepStrictEqual(evalCall.params[0], EVALUATED_TERMINAL_OUTCOMES);
    // filter values come after the outcomes array, in order
    assert.strictEqual(evalCall.params[1], 2025);
    assert.strictEqual(evalCall.params[2], 'Bagong Ilog');
  });

  it('control (no filters) sends an unparameterized total query with no params', async () => {
    const pool = createCapturingPool();
    await computeCaseFatalityRate(pool, {});
    const totalCall = pool.calls[1];
    assert.deepStrictEqual(placeholdersOf(totalCall.sql), []);
    assert.ok(
      totalCall.params === undefined || totalCall.params.length === 0,
      'control total query must not supply params'
    );
  });

  it('numeric filters are coerced to numbers (no NaN binds)', async () => {
    const pool = createCapturingPool();
    await computeCaseFatalityRate(pool, { year: '2025', month: '8' });
    for (const call of pool.calls) {
      for (const p of call.params || []) {
        if (typeof p === 'number') assert.ok(Number.isFinite(p), 'param must be finite');
      }
      if (Array.isArray(call.params)) continue;
    }
    const evalParams = pool.calls[0].params;
    assert.strictEqual(typeof evalParams[1], 'number'); // year
    assert.strictEqual(typeof evalParams[2], 'number'); // month
    assert.ok(Number.isFinite(evalParams[1]) && Number.isFinite(evalParams[2]));
  });

  it('ageGroup contributes a raw condition without breaking the param series', async () => {
    const pool = createCapturingPool();
    await computeCaseFatalityRate(pool, { year: 2025, ageGroup: '25-34', facility: 'X' });
    assertAllCallsConsistent(pool, 'year + ageGroup + facility');
    const evalCall = pool.calls[0];
    assert.ok(evalCall.sql.includes('age BETWEEN 25 AND 34'), 'raw age condition present');
    // year and facility bind; age does not → params: [outcomes, 2025, 'X']
    assert.strictEqual(evalCall.params.length, 3);
    assert.strictEqual(evalCall.params[1], 2025);
    assert.strictEqual(evalCall.params[2], 'X');
  });
});

// ==================== RESULT SEMANTICS ====================

describe('computeCaseFatalityRate — result', () => {
  it('computes rate from canned rows', async () => {
    const pool = createCapturingPool({ evaluated: 100, died: 3, total: 1000 });
    const r = await computeCaseFatalityRate(pool, { barangay: 'Bagong Ilog' });
    assert.strictEqual(r.rate, 3);
    assert.strictEqual(r.died, 3);
    assert.strictEqual(r.evaluated, 100);
    assert.strictEqual(r.total, 1000);
  });

  it('returns null rate (never 0%) when evaluated denominator is 0', async () => {
    const pool = createCapturingPool({ evaluated: 0, died: 0, total: 50 });
    const r = await computeCaseFatalityRate(pool, { year: 2025 });
    assert.strictEqual(r.rate, null);
    assert.strictEqual(r.evaluated, 0);
  });

  it('outcome filter is not accepted (CFR scope is fixed to evaluated terminal outcomes)', async () => {
    const pool = createCapturingPool();
    await computeCaseFatalityRate(pool, { outcome: 'CURED' });
    // Passing an unsupported key must not alter the queries: control shape.
    assert.strictEqual(pool.calls.length, 2);
    const evalCall = pool.calls[0];
    assert.strictEqual(placeholdersOf(evalCall.sql).length, 1,
      'unsupported outcome key must not add a bind');
  });
});
