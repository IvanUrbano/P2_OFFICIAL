/**
 * TBInsight — Treatment Cascade Unit Tests
 *
 * Tests the shared cascade calculation used by BOTH the Dashboard and
 * Analytics pages (GET /api/tb/treatment-cascade).
 * Does NOT require a running database — mocked pool / pure functions.
 * Run: node --test BACKEND/test/tbinsight/treatmentCascade.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  computeTreatmentCascade,
  applyCascadeFilters,
  EVALUATED_OUTCOMES,
  SUCCESS_OUTCOMES,
  pct,
} = require('../../tbinsight/treatmentCascade');

// ==================== HELPERS ====================

function createMockPool(row) {
  const captured = { sql: null, params: null };
  return {
    captured,
    query: async (sql, params) => {
      captured.sql = sql;
      captured.params = params;
      return { rows: [row] };
    },
  };
}

const FULL_ROW = {
  diagnosed: 200,
  started_treatment: 160,
  evaluated: 150,
  successful_outcome: 120,
  bacteriologically_confirmed: 140,
  clinically_diagnosed: 60,
  on_treatment: 40,
  cured: 70,
  completed: 50,
  failed: 10,
  died: 15,
  lost_to_follow_up: 10,
  excluded: 5,
  not_evaluated: 10,
  total_records: 210,
};

// ==================== pct ====================

describe('pct', () => {
  it('computes a whole-number percentage', () => {
    assert.strictEqual(pct(80, 200), 40);
  });

  it('rounds to one decimal place', () => {
    assert.strictEqual(pct(1, 3), 33.3);
    assert.strictEqual(pct(2, 3), 66.7);
  });

  it('returns null (not 0) when denominator is 0', () => {
    assert.strictEqual(pct(5, 0), null);
  });

  it('returns null when denominator is missing', () => {
    assert.strictEqual(pct(5), null);
    assert.strictEqual(pct(5, null), null);
    assert.strictEqual(pct(5, undefined), null);
  });
});

// ==================== Outcome sets ====================

describe('outcome sets', () => {
  it('EVALUATED_OUTCOMES uses actual DB values', () => {
    for (const v of ['CURED', 'TREATMENT COMPLETED', 'TREATMENT FAILED', 'DIED', 'LOST TO FF-UP', 'EXCLUDED']) {
      assert.ok(EVALUATED_OUTCOMES.includes(v), `missing ${v}`);
    }
  });

  it('includes tolerant variant spellings', () => {
    assert.ok(EVALUATED_OUTCOMES.includes('FAILED'));
    assert.ok(EVALUATED_OUTCOMES.includes('LOST TO FOLLOW-UP'));
  });

  it('SUCCESS_OUTCOMES is CURED + TREATMENT COMPLETED only', () => {
    assert.deepStrictEqual([...SUCCESS_OUTCOMES].sort(), ['CURED', 'TREATMENT COMPLETED']);
  });

  it('NOT EVALUATED and ON TREATMENT are not evaluated outcomes', () => {
    assert.ok(!EVALUATED_OUTCOMES.includes('NOT EVALUATED'));
    assert.ok(!EVALUATED_OUTCOMES.includes('ON TREATMENT'));
    assert.ok(!EVALUATED_OUTCOMES.includes('SCREENED'));
    assert.ok(!EVALUATED_OUTCOMES.includes('DIAGNOSED'));
  });
});

// ==================== applyCascadeFilters ====================

describe('applyCascadeFilters', () => {
  it('adds no conditions when filters are empty', () => {
    const conditions = [];
    const params = [];
    const idx = applyCascadeFilters(conditions, params, 1, {});
    assert.strictEqual(idx, 1);
    assert.strictEqual(conditions.length, 0);
    assert.strictEqual(params.length, 0);
  });

  it('maps all supported filters in order', () => {
    const conditions = [];
    const params = [];
    const idx = applyCascadeFilters(conditions, params, 1, {
      year: '2026',
      month: '8',
      barangay: 'San Jose',
      sex: 'Male',
      ageGroup: '25-34',
      bacteriological: 'Bacteriologically-confirmed TB',
      outcome: 'CURED',
    });
    assert.strictEqual(idx, 7);
    assert.deepStrictEqual(params, ['2026', '8', 'San Jose', 'Male', 'Bacteriologically-confirmed TB', 'CURED'].map((p, i) => (i < 2 ? Number(p) : p)));
    assert.strictEqual(conditions.length, 7);
    assert.ok(conditions[0].includes('EXTRACT(YEAR FROM c.date_of_diagnosis) = $1'));
    assert.ok(conditions[1].includes('EXTRACT(MONTH FROM c.date_of_diagnosis) = $2'));
    assert.ok(conditions[2].includes('TRIM(c.barangay_name) = $3'));
    assert.ok(conditions[3].includes('TRIM(c.sex) ILIKE $4'));
    assert.ok(conditions[4].includes('c.age BETWEEN 25 AND 34'));
    assert.ok(conditions[5].includes('TRIM(c.bacteriological_status) ILIKE $5'));
    assert.ok(conditions[6].includes('UPPER(TRIM(c.outcome_status)) = UPPER($6)'));
  });

  it('supports age group bands', () => {
    const cases = [
      ['0-14', 'c.age <= 14'],
      ['15-24', 'c.age BETWEEN 15 AND 24'],
      ['35-44', 'c.age BETWEEN 35 AND 44'],
      ['65+', 'c.age >= 65'],
    ];
    for (const [group, expected] of cases) {
      const conditions = [];
      applyCascadeFilters(conditions, [], 1, { ageGroup: group });
      assert.strictEqual(conditions[0], expected, `ageGroup ${group}`);
    }
  });

  it('age group filter does not consume a param slot', () => {
    const conditions = [];
    const params = [];
    const idx = applyCascadeFilters(conditions, params, 1, { ageGroup: '0-14', barangay: 'San Jose' });
    assert.strictEqual(idx, 2);
    assert.deepStrictEqual(params, ['San Jose']);
  });
});

// ==================== computeTreatmentCascade ====================

describe('computeTreatmentCascade', () => {
  it('returns cascade counts and correct rates', async () => {
    const pool = createMockPool(FULL_ROW);
    const result = await computeTreatmentCascade(pool, {});

    assert.deepStrictEqual(result.cascade, {
      diagnosed: 200,
      started_treatment: 160,
      evaluated: 150,
      successful_outcome: 120,
    });
    assert.strictEqual(result.rates.started_pct, 80);
    assert.strictEqual(result.rates.evaluated_pct, 75);
    assert.strictEqual(result.rates.successful_outcome_pct_of_evaluated, 80);
    assert.strictEqual(result.rates.successful_outcome_pct_of_diagnosed, 60);
  });

  it('returns breakdown counts', async () => {
    const pool = createMockPool(FULL_ROW);
    const result = await computeTreatmentCascade(pool, {});
    assert.strictEqual(result.breakdown.bacteriologically_confirmed, 140);
    assert.strictEqual(result.breakdown.clinically_diagnosed, 60);
    assert.strictEqual(result.breakdown.cured, 70);
    assert.strictEqual(result.breakdown.completed, 50);
    assert.strictEqual(result.breakdown.total_records, 210);
  });

  it('returns null rates (not 0) when diagnosed is 0', async () => {
    const pool = createMockPool({
      diagnosed: 0,
      started_treatment: 0,
      evaluated: 0,
      successful_outcome: 0,
      bacteriologically_confirmed: 0,
      clinically_diagnosed: 0,
      on_treatment: 0,
      cured: 0,
      completed: 0,
      failed: 0,
      died: 0,
      lost_to_follow_up: 0,
      excluded: 0,
      not_evaluated: 0,
      total_records: 0,
    });
    const result = await computeTreatmentCascade(pool, {});
    assert.strictEqual(result.rates.started_pct, null);
    assert.strictEqual(result.rates.evaluated_pct, null);
    assert.strictEqual(result.rates.successful_outcome_pct_of_evaluated, null);
    assert.strictEqual(result.rates.successful_outcome_pct_of_diagnosed, null);
    assert.strictEqual(result.cascade.diagnosed, 0);
  });

  it('returns 0 evaluated rate but null success rate when nothing was evaluated', async () => {
    const pool = createMockPool({ ...FULL_ROW, evaluated: 0, successful_outcome: 0 });
    const result = await computeTreatmentCascade(pool, {});
    assert.strictEqual(result.rates.evaluated_pct, 0);
    assert.strictEqual(result.rates.successful_outcome_pct_of_evaluated, null);
  });

  it('builds SQL containing actual DB outcome values', async () => {
    const pool = createMockPool(FULL_ROW);
    await computeTreatmentCascade(pool, {});
    assert.ok(pool.captured.sql.includes("'LOST TO FF-UP'"), 'must match actual LOST TO FF-UP value');
    assert.ok(pool.captured.sql.includes("'TREATMENT FAILED'"));
    assert.ok(pool.captured.sql.includes("'TREATMENT COMPLETED'"));
    assert.ok(pool.captured.sql.includes("'CURED'"));
    assert.ok(pool.captured.sql.includes('date_of_diagnosis IS NOT NULL'));
    assert.ok(pool.captured.sql.includes('date_started_treatment IS NOT NULL'));
  });

  it('applies filters as query params', async () => {
    const pool = createMockPool(FULL_ROW);
    await computeTreatmentCascade(pool, { year: '2026', barangay: 'San Jose', outcome: 'CURED' });
    assert.deepStrictEqual(pool.captured.params, [2026, 'San Jose', 'CURED']);
    assert.ok(pool.captured.sql.includes('WHERE'));
  });

  it('sends no params for empty filters', async () => {
    const pool = createMockPool(FULL_ROW);
    await computeTreatmentCascade(pool, {});
    assert.deepStrictEqual(pool.captured.params, []);
    // No top-level WHERE clause after FROM (FILTER (WHERE ...) always exists)
    assert.ok(!pool.captured.sql.includes('FROM tb_cases c\n    WHERE'));
  });

  it('echoes filters in meta', async () => {
    const pool = createMockPool(FULL_ROW);
    const result = await computeTreatmentCascade(pool, { year: '2026', sex: 'Male' });
    assert.strictEqual(result.meta.filters.year, '2026');
    assert.strictEqual(result.meta.filters.sex, 'Male');
    assert.strictEqual(result.meta.filters.barangay, null);
    assert.ok(result.meta.generatedAt);
  });

  it('handles missing row (no data) gracefully', async () => {
    const pool = { query: async () => ({ rows: [] }) };
    const result = await computeTreatmentCascade(pool, {});
    assert.strictEqual(result.cascade.diagnosed, 0);
    assert.strictEqual(result.rates.started_pct, null);
  });
});
