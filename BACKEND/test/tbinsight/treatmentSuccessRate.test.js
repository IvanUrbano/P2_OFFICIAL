/**
 * Cohort-based treatment success rate. Besides the success rate it returns the same cohort's
 * lost-to-follow-up / died / failed counts, so the Analytics KPI cards describe the same patients.
 * Uses a mock pool, so no database is touched.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { computeTreatmentSuccessRate } = require('../../tbinsight/treatmentSuccessRate');

const poolWith = (row) => {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql: String(sql).replace(/\s+/g, ' '), params }); return { rows: [row] }; } };
};

// Live 2025 cohort: 4,281 patients; 864 cured, 2,614 completed, 281 lost to follow-up, 62 died, 4 failed.
const live = { total_patients: 4281, cured_count: 864, completed_count: 2614, ltfu_count: 281, died_count: 62, failed_count: 4 };

describe('computeTreatmentSuccessRate — one cohort, several outcomes', () => {
  it('returns the success rate and the lost-to-follow-up rate of the SAME cohort', async () => {
    const r = await computeTreatmentSuccessRate(poolWith(live), { year: 2026 });
    assert.strictEqual(r.cohortYear, 2025);
    assert.strictEqual(r.cohortTotal, 4281);
    assert.strictEqual(r.successRate, 81.2);   // (864 + 2614) / 4281
    assert.strictEqual(r.cohortLtfu, 281);
    assert.strictEqual(r.ltfuRate, 6.6);       // 281 / 4281 — over the whole cohort, like the success rate
    assert.strictEqual(r.cohortDied, 62);
    assert.strictEqual(r.cohortFailed, 4);
  });

  it('asks the database for the extra outcome counts from the same cohort query', async () => {
    const pool = poolWith(live);
    await computeTreatmentSuccessRate(pool, { year: 2026 });
    assert.strictEqual(pool.calls.length, 1, 'a single query');
    assert.match(pool.calls[0].sql, /treatment_outcome = 'LOST TO FOLLOW-UP'/);
    assert.match(pool.calls[0].sql, /treatment_outcome = 'DIED'/);
    assert.match(pool.calls[0].sql, /EXTRACT\(YEAR FROM date_started_treatment\) = \$1/);
    assert.deepStrictEqual(pool.calls[0].params, [2025]);
  });

  it('an empty cohort gives null rates (never 0%) and zero counts', async () => {
    const r = await computeTreatmentSuccessRate(poolWith({ total_patients: 0 }), { year: 2026 });
    assert.strictEqual(r.successRate, null);
    assert.strictEqual(r.ltfuRate, null);
    assert.strictEqual(r.cohortLtfu, 0);
    assert.strictEqual(r.cohortDied, 0);
  });

  it('rows from an older query shape (no outcome columns) still work', async () => {
    const r = await computeTreatmentSuccessRate(poolWith({ total_patients: 10, cured_count: 6, completed_count: 2 }), { year: 2026 });
    assert.strictEqual(r.successRate, 80);
    assert.strictEqual(r.cohortLtfu, 0);
    assert.strictEqual(r.ltfuRate, 0);
  });
});
