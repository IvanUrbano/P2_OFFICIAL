/**
 * TBInsight — Insight Data Builder Unit Tests
 *
 * Tests metric calculation functions with mocked database pool.
 * Does NOT require a running database.
 * Run: node --test BACKEND/test/tbinsight/insightDataBuilder.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

// Load BACKEND/.env by absolute path before requiring anything that touches the
// DB: db.js calls dotenv.config() with no path, which resolves .env from the
// process working directory — without this, running the suite from the repo
// root (instead of BACKEND/) connects with zero env vars and dies with a
// pg FATAL.
require('dotenv').config({
  path: require('path').join(__dirname, '..', '..', '.env'),
});

const {
  buildAnalyticsMetrics,
  buildForecastingMetrics,
} = require('../../tbinsight/insightDataBuilder');

// ==================== MOCK POOL HELPER ====================

/**
 * Creates a mock pool where query() returns responses in order.
 * @param {Array} responses - Array of { rows } objects, consumed in order
 */
function createMockPool(responses) {
  let callIndex = 0;
  return {
    query: async () => {
      if (callIndex < responses.length) {
        return responses[callIndex++];
      }
      return { rows: [] };
    },
  };
}

// ==================== ANALYTICS METRICS ====================

describe('buildAnalyticsMetrics', () => {
  it('computes increasing trend when recent > prior by more than 5%', async () => {
    const pool = createMockPool([
      // monthlyTrendRes: 6 months of data
      { rows: [
        { month: '2026-08-01', case_count: 120 },
        { month: '2026-07-01', case_count: 110 },
        { month: '2026-06-01', case_count: 90 },
        { month: '2026-05-01', case_count: 80 },
        { month: '2026-04-01', case_count: 70 },
        { month: '2026-03-01', case_count: 60 },
      ]},
      // barangayCountsRes
      { rows: [
        { barangay_name: 'San Jose', total: 50 },
        { barangay_name: 'Oranbo', total: 10 },
      ]},
      // significantRes
      { rows: [] },
      // riskRes
      { rows: [] },
      // sexRes
      { rows: [{ sex: 'Male', total: 60 }, { sex: 'Female', total: 40 }] },
      // ageRes
      { rows: [{ age_group: '25-34', total: 35 }, { age_group: '0-14', total: 25 }] },
      // outcomeRes
      { rows: [{ outcome_status: 'CURED', total: 40 }, { outcome_status: 'TREATMENT COMPLETED', total: 20 }, { outcome_status: 'ON TREATMENT', total: 10 }] },
      // totalRes
      { rows: [{ total_cases: 100, barangays_with_data: 15, earliest_date: '2024-01-01', latest_date: '2026-08-31' }] },
    ]);

    const result = await buildAnalyticsMetrics(pool);

    // Recent 3 months: 120+110+90 = 320; Prior 3 months: 80+70+60 = 210
    // Change: (320-210)/210 * 100 = 52.4%
    assert.strictEqual(result.trend.direction, 'increasing');
    assert.ok(result.trend.changePercent > 5, `Expected > 5, got ${result.trend.changePercent}`);
    assert.strictEqual(result.trend.recentCount, 320);
    assert.strictEqual(result.trend.priorCount, 210);
  });

  it('computes decreasing trend when recent < prior by more than 5%', async () => {
    const pool = createMockPool([
      { rows: [
        { month: '2026-08-01', case_count: 50 },
        { month: '2026-07-01', case_count: 40 },
        { month: '2026-06-01', case_count: 30 },
        { month: '2026-05-01', case_count: 80 },
        { month: '2026-04-01', case_count: 90 },
        { month: '2026-03-01', case_count: 100 },
      ]},
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ total_cases: 100, barangays_with_data: 5, earliest_date: null, latest_date: null }] },
    ]);

    const result = await buildAnalyticsMetrics(pool);
    // Recent: 50+40+30=120; Prior: 80+90+100=270; Change: (120-270)/270*100 = -55.6%
    assert.strictEqual(result.trend.direction, 'decreasing');
    assert.ok(result.trend.changePercent < -5);
  });

  it('computes stable trend when change is within +/-5%', async () => {
    const pool = createMockPool([
      { rows: [
        { month: '2026-08-01', case_count: 100 },
        { month: '2026-07-01', case_count: 100 },
        { month: '2026-06-01', case_count: 100 },
        { month: '2026-05-01', case_count: 98 },
        { month: '2026-04-01', case_count: 102 },
        { month: '2026-03-01', case_count: 100 },
      ]},
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ total_cases: 100, barangays_with_data: 5, earliest_date: null, latest_date: null }] },
    ]);

    const result = await buildAnalyticsMetrics(pool);
    assert.strictEqual(result.trend.direction, 'stable');
    assert.ok(Math.abs(result.trend.changePercent) <= 5);
  });

  it('identifies highest and lowest barangays', async () => {
    const pool = createMockPool([
      { rows: [] },
      { rows: [
        { barangay_name: 'San Jose', total: 50 },
        { barangay_name: 'Pinagbuhatan', total: 30 },
        { barangay_name: 'Oranbo', total: 5 },
      ]},
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ total_cases: 85, barangays_with_data: 3, earliest_date: null, latest_date: null }] },
    ]);

    const result = await buildAnalyticsMetrics(pool);
    assert.strictEqual(result.highestBarangay.name, 'San Jose');
    assert.strictEqual(result.highestBarangay.total, 50);
    assert.strictEqual(result.lowestBarangay.name, 'Oranbo');
    assert.strictEqual(result.lowestBarangay.total, 5);
  });

  it('returns null highest/lowest when no barangay data', async () => {
    const pool = createMockPool([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ total_cases: 0, barangays_with_data: 0, earliest_date: null, latest_date: null }] },
    ]);

    const result = await buildAnalyticsMetrics(pool);
    assert.strictEqual(result.highestBarangay, null);
    assert.strictEqual(result.lowestBarangay, null);
  });

  it('detects significant changes with z-score >= 2.0', async () => {
    const pool = createMockPool([
      { rows: [] },
      { rows: [] },
      // significantRes: barangay with clear spike
      { rows: [
        { barangay_name: 'Manggahan', month: '2026-01-01', case_count: 5 },
        { barangay_name: 'Manggahan', month: '2026-02-01', case_count: 4 },
        { barangay_name: 'Manggahan', month: '2026-03-01', case_count: 6 },
        { barangay_name: 'Manggahan', month: '2026-04-01', case_count: 5 },
        { barangay_name: 'Manggahan', month: '2026-05-01', case_count: 4 },
        { barangay_name: 'Manggahan', month: '2026-06-01', case_count: 5 },
        { barangay_name: 'Manggahan', month: '2026-07-01', case_count: 20 }, // spike
      ]},
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ total_cases: 49, barangays_with_data: 1, earliest_date: null, latest_date: null }] },
    ]);

    const result = await buildAnalyticsMetrics(pool);
    assert.ok(result.significantChanges.length > 0, 'Should detect significant change');
    assert.strictEqual(result.significantChanges[0].barangay, 'Manggahan');
    assert.ok(result.significantChanges[0].zScore >= 2.0);
  });

  it('counts risk classes correctly', async () => {
    const pool = createMockPool([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      // riskRes
      { rows: [
        { barangay_name: 'A', risk_class: 'High', risk_score: 80 },
        { barangay_name: 'B', risk_class: 'High', risk_score: 75 },
        { barangay_name: 'C', risk_class: 'Medium', risk_score: 50 },
        { barangay_name: 'D', risk_class: 'Low', risk_score: 20 },
      ]},
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ total_cases: 100, barangays_with_data: 4, earliest_date: null, latest_date: null }] },
    ]);

    const result = await buildAnalyticsMetrics(pool);
    assert.strictEqual(result.riskCounts.high, 2);
    assert.strictEqual(result.riskCounts.medium, 1);
    assert.strictEqual(result.riskCounts.low, 1);
    assert.deepStrictEqual(result.highRiskBarangays, ['A', 'B']);
  });

  it('computes sex split percentages', async () => {
    const pool = createMockPool([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      // sexRes
      { rows: [{ sex: 'Male', total: 62 }, { sex: 'Female', total: 38 }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ total_cases: 100, barangays_with_data: 1, earliest_date: null, latest_date: null }] },
    ]);

    const result = await buildAnalyticsMetrics(pool);
    assert.strictEqual(result.demographics.sexSplit.male, 62);
    assert.strictEqual(result.demographics.sexSplit.female, 38);
  });

  it('identifies dominant age group', async () => {
    const pool = createMockPool([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      // ageRes
      { rows: [
        { age_group: '25-34', total: 35 },
        { age_group: '0-14', total: 25 },
        { age_group: '65+', total: 10 },
      ]},
      { rows: [] },
      { rows: [{ total_cases: 70, barangays_with_data: 1, earliest_date: null, latest_date: null }] },
    ]);

    const result = await buildAnalyticsMetrics(pool);
    assert.strictEqual(result.demographics.dominantAgeGroup.group, '25-34');
    assert.strictEqual(result.demographics.dominantAgeGroup.count, 35);
  });

  it('computes treatment success rate', async () => {
    const pool = createMockPool([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      // outcomeRes (for outcomeBreakdown)
      { rows: [
        { outcome_status: 'CURED', total: 50 },
        { outcome_status: 'TREATMENT COMPLETED', total: 30 },
        { outcome_status: 'ON TREATMENT', total: 10 },
        { outcome_status: 'DIED', total: 5 },
        { outcome_status: 'NOT EVALUATED', total: 5 },
      ]},
      { rows: [{ total_cases: 100, barangays_with_data: 1, earliest_date: null, latest_date: null }] },
      // cohortResult (for TSR from previous year treatment-start cohort)
      { rows: [{ total_patients: 95, cured_count: 50, completed_count: 30 }] },
    ]);

    const result = await buildAnalyticsMetrics(pool, { year: 2025 });
    // TSR = (50+30) / 95 = 84.2%
    assert.ok(result.treatment.successRate > 80, `Expected > 80, got ${result.treatment.successRate}`);
    assert.ok(result.treatment.successRate < 90, `Expected < 90, got ${result.treatment.successRate}`);
    assert.strictEqual(result.treatment.outcomeBreakdown['CURED'], 50);
  });

  it('computes summary correctly', async () => {
    const pool = createMockPool([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ total_cases: 500, barangays_with_data: 25, earliest_date: '2024-01-01', latest_date: '2026-08-31' }] },
    ]);

    const result = await buildAnalyticsMetrics(pool);
    assert.strictEqual(result.summary.totalCases, 500);
    assert.strictEqual(result.summary.barangaysWithData, 25);
  });
});

// ==================== FILTER ISOLATION & RESILIENCE ====================

describe('buildAnalyticsMetrics — filter isolation & resilience', () => {
  /**
   * SQL-routed mock pool: canned rows by distinctive SQL markers, with
   * optional per-marker injected failures. Captures every call so tests can
   * assert placeholder/param consistency across the whole pipeline.
   */
  function createSqlPool({ fail = [] } = {}) {
    const calls = [];
    return {
      calls,
      query: async (sql, params) => {
        calls.push({ sql, params });
        const s = String(sql);
        for (const marker of fail) {
          if (s.includes(marker)) throw new Error(`injected failure: ${marker}`);
        }
        if (s.includes('date_started_treatment')) {
          return { rows: [{ total_patients: 100, cured_count: 70, completed_count: 20 }] };
        }
        if (s.includes('AS evaluated')) return { rows: [{ evaluated: 20, died: 1 }] };
        if (s.includes('AS total FROM tb_cases')) return { rows: [{ total: 500 }] };
        if (s.includes('AS total_cases')) {
          return { rows: [{ total_cases: 100, barangays_with_data: 5, earliest_date: '2024-01-01', latest_date: '2026-08-31' }] };
        }
        if (s.includes('LIMIT 12')) {
          return { rows: [
            { month: '2026-08-01', case_count: 12 },
            { month: '2026-07-01', case_count: 10 },
            { month: '2026-06-01', case_count: 9 },
            { month: '2026-05-01', case_count: 8 },
            { month: '2026-04-01', case_count: 7 },
            { month: '2026-03-01', case_count: 6 },
          ] };
        }
        if (s.includes('GROUP BY c.barangay_name, DATE_TRUNC')) {
          return { rows: [{ barangay_name: 'San Jose', month: '2026-08-01', case_count: 5 }] };
        }
        if (s.includes('SELECT c.barangay_name, COUNT(*)::INTEGER AS total')) {
          return { rows: [
            { barangay_name: 'San Jose', total: 50 },
            { barangay_name: 'Oranbo', total: 5 },
          ] };
        }
        if (s.includes('barangay_risk_scores')) {
          return { rows: [
            { barangay_name: 'A', risk_class: 'High', risk_score: 80, incidence_per_100k: 12 },
            { barangay_name: 'B', risk_class: 'Low', risk_score: 20, incidence_per_100k: 3 },
          ] };
        }
        if (s.includes('TRIM(c.sex) AS sex')) {
          return { rows: [{ sex: 'Male', total: 60 }, { sex: 'Female', total: 40 }] };
        }
        if (s.includes('AS age_group')) {
          return { rows: [{ age_group: '25-34', total: 40 }, { age_group: '0-14', total: 20 }] };
        }
        if (s.includes('AS outcome_status')) {
          return { rows: [{ outcome_status: 'CURED', total: 40 }] };
        }
        return { rows: [] };
      },
    };
  }

  function placeholdersOf(sql) {
    return (String(sql).match(/\$\d+/g) || []).map((p) => Number(p.slice(1)));
  }

  function assertPipelineParamConsistency(pool, label) {
    pool.calls.forEach((call, i) => {
      const ph = placeholdersOf(call.sql);
      const list = call.params || [];
      if (ph.length === 0) {
        assert.strictEqual(list.length, 0,
          `${label} [q${i}]: no placeholders but ${list.length} param(s)`);
        return;
      }
      const max = Math.max(...ph);
      assert.strictEqual(max, list.length,
        `${label} [q${i}]: max $${max} !== params.length ${list.length}\nSQL: ${call.sql}`);
      const unique = [...new Set(ph)].sort((a, b) => a - b);
      assert.deepStrictEqual(unique, Array.from({ length: max }, (_, k) => k + 1),
        `${label} [q${i}]: placeholders not contiguous from $1`);
    });
  }

  const combos = [
    ['no filters', {}],
    ['year', { year: 2025 }],
    ['barangay (original repro)', { barangay: 'Bagong Ilog' }],
    ['year + month + barangay + sex', { year: 2025, month: 8, barangay: 'Bagong Ilog', sex: 'Female' }],
    ['ageGroup', { ageGroup: '25-34' }],
    ['sex + ageGroup', { sex: 'Male', ageGroup: '0-14' }],
    ['facility', { facility: 'Rizal Health Center' }],
    ['bacteriological', { bacteriological: 'smear' }],
    ['outcome', { outcome: 'CURED' }],
    ['year + barangay', { year: 2025, barangay: 'Bagong Ilog' }],
  ];

  for (const [name, filters] of combos) {
    it(`runs the full pipeline for ${name} and stays param-consistent`, async () => {
      const pool = createSqlPool();
      const m = await buildAnalyticsMetrics(pool, filters);
      assert.strictEqual(m.summary.totalCases, 100);
      assert.deepStrictEqual(m.unavailable, [], 'all metrics available');
      assert.ok(m.trend && m.trend.direction, 'trend present');
      assert.ok(m.riskCounts, 'risk present');
      assert.ok(m.riskByBarangay && m.riskByBarangay.A === 'High', 'riskByBarangay map present');
      assert.ok(m.demographics && m.demographics.sexSplit, 'demographics present');
      assert.strictEqual(m.treatment.successRate, 90); // (70+20)/100
      assert.strictEqual(m.treatment.fatalityRate, 5);  // 1/20
      const flat = JSON.stringify(m);
      assert.ok(!/NaN|Infinity/.test(flat), `metrics contain NaN/Infinity: ${flat.slice(0, 200)}`);
      assertPipelineParamConsistency(pool, name);
    });
  }

  it('does not forward month to TSR but does forward it to CFR', async () => {
    const pool = createSqlPool();
    await buildAnalyticsMetrics(pool, { month: 8 });
    const tsrCall = pool.calls.find((c) => String(c.sql).includes('date_started_treatment'));
    assert.strictEqual(tsrCall.params.length, 1, 'TSR must only bind the cohort year');
    const cfrEval = pool.calls.find((c) => String(c.sql).includes('AS evaluated'));
    assert.strictEqual(cfrEval.params.length, 2, 'CFR binds outcomes array + month');
    assert.strictEqual(cfrEval.params[1], 8);
  });

  it('does not forward outcome to TSR or CFR', async () => {
    const pool = createSqlPool();
    await buildAnalyticsMetrics(pool, { outcome: 'CURED' });
    const tsrCall = pool.calls.find((c) => String(c.sql).includes('date_started_treatment'));
    assert.strictEqual(tsrCall.params.length, 1, 'TSR must only bind the cohort year');
    const cfrEval = pool.calls.find((c) => String(c.sql).includes('AS evaluated'));
    assert.strictEqual(cfrEval.params.length, 1, 'CFR must only bind the outcomes array');
  });

  it('cohort year is reporting-year minus 1 (year filter)', async () => {
    const pool = createSqlPool();
    const m = await buildAnalyticsMetrics(pool, { year: 2025 });
    assert.strictEqual(m.treatment.cohortYear, 2024);
  });

  it('degrades to null when the risk query fails (never throws)', async () => {
    const pool = createSqlPool({ fail: ['barangay_risk_scores'] });
    const m = await buildAnalyticsMetrics(pool, { barangay: 'Bagong Ilog' });
    assert.strictEqual(m.summary.totalCases, 100, 'core summary still resolves');
    assert.strictEqual(m.riskCounts, null);
    assert.strictEqual(m.riskByBarangay, null);
    assert.strictEqual(m.highRiskBarangays, null);
    assert.ok(m.unavailable.includes('risk'));
    assert.ok(m.trend, 'other metrics unaffected');
    assert.strictEqual(m.treatment.successRate, 90);
  });

  it('degrades to null when the trend query fails (never throws)', async () => {
    const pool = createSqlPool({ fail: ['LIMIT 12'] });
    const m = await buildAnalyticsMetrics(pool, { year: 2025 });
    assert.strictEqual(m.trend, null);
    assert.ok(m.unavailable.includes('trend'));
    assert.strictEqual(m.summary.totalCases, 100);
  });

  it('degrades to null when the significance query fails (never throws)', async () => {
    const pool = createSqlPool({ fail: ['GROUP BY c.barangay_name, DATE_TRUNC'] });
    const m = await buildAnalyticsMetrics(pool, {});
    assert.strictEqual(m.significantChanges, null);
    assert.ok(m.unavailable.includes('significance'));
    assert.strictEqual(m.summary.totalCases, 100);
  });

  it('degrades to null when the sex-distribution query fails (never throws)', async () => {
    const pool = createSqlPool({ fail: ['TRIM(c.sex) AS sex'] });
    const m = await buildAnalyticsMetrics(pool, {});
    assert.strictEqual(m.demographics, null);
    assert.ok(m.unavailable.includes('demographics'));
    assert.strictEqual(m.summary.totalCases, 100);
  });

  it('degrades TSR to null when the cohort query rejects (never throws)', async () => {
    const pool = createSqlPool({ fail: ['date_started_treatment'] });
    const m = await buildAnalyticsMetrics(pool, { barangay: 'Bagong Ilog' });
    assert.strictEqual(m.treatment.successRate, null);
    assert.strictEqual(m.treatment.cohortYear, null);
    assert.ok(m.unavailable.includes('treatment'));
    assert.strictEqual(m.treatment.fatalityRate, 5, 'CFR unaffected');
    assert.strictEqual(m.summary.totalCases, 100);
  });

  it('degrades CFR to null when the evaluated-outcomes query rejects (never throws)', async () => {
    const pool = createSqlPool({ fail: ['AS evaluated'] });
    const m = await buildAnalyticsMetrics(pool, { year: 2025 });
    assert.strictEqual(m.treatment.fatalityRate, null);
    assert.ok(m.unavailable.includes('fatality'));
    assert.strictEqual(m.treatment.successRate, 90, 'TSR unaffected');
    assert.strictEqual(m.summary.totalCases, 100);
  });

  it('degrades multiple optional metrics at once (never throws)', async () => {
    const pool = createSqlPool({
      fail: ['LIMIT 12', 'barangay_risk_scores', 'date_started_treatment', 'AS evaluated'],
    });
    const m = await buildAnalyticsMetrics(pool, { year: 2025 });
    assert.strictEqual(m.trend, null);
    assert.strictEqual(m.riskCounts, null);
    assert.strictEqual(m.treatment.successRate, null);
    assert.strictEqual(m.treatment.fatalityRate, null);
    for (const flag of ['trend', 'risk', 'treatment', 'fatality']) {
      assert.ok(m.unavailable.includes(flag), `unavailable should include ${flag}`);
    }
    assert.strictEqual(m.summary.totalCases, 100, 'core summary still resolves → HTTP 200');
  });

  it('still rejects (500-worthy) when the required summary query fails', async () => {
    const pool = createSqlPool({ fail: ['AS total_cases'] });
    await assert.rejects(
      () => buildAnalyticsMetrics(pool, { barangay: 'Bagong Ilog' }),
      /injected failure: AS total_cases/
    );
  });
});

// ==================== FORECASTING METRICS ====================

describe('buildForecastingMetrics', () => {
  it('queries the latest run period with the selected horizon and barangay', async () => {
    const calls = [];
    const pool = { query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    } };
    await buildForecastingMetrics(pool, { startYear: '2025', endYear: '2025', horizon: 1, barangay: 'A' });
    assert.match(calls[0].sql, /config->>'period'/);
    assert.match(calls[0].sql, /mp\.period < /);
    assert.deepStrictEqual(calls[0].params, [1, 'A']);
    assert.doesNotMatch(calls[0].sql, /EXTRACT\(YEAR FROM mp\.period\)/);
    assert.match(calls[3].sql, /FROM tb_cases/);
    assert.deepStrictEqual(calls[3].params, [2025, 2025, 'A']);
  });

  it('retains a persisted forecast after its actual count arrives', async () => {
    const pool = createMockPool([
      { rows: [{ barangay_name: 'A', period: '2026-01-01', forecasted_count: 7, actual_count: 6, method: 'arima' }] },
      { rows: [] }, { rows: [] },
    ]);
    const result = await buildForecastingMetrics(pool, { horizon: 1 });
    assert.deepStrictEqual(result.predictedCases, { total: 7, monthlyAvg: 7, horizon: 1, available: true });
  });
  it('leaves growth unavailable when a forecast exists but the selected baseline is missing', async () => {
    const pool = createMockPool([
      { rows: [{ barangay_name: 'A', period: '2026-01-01', forecasted_count: 7, method: 'arima' }] },
      { rows: [] }, { rows: [] },
      { rows: [{ first_month: null, last_month: null, total_cases: null }] },
    ]);
    const result = await buildForecastingMetrics(pool);
    assert.strictEqual(result.predictedCases.available, true);
    assert.strictEqual(result.direction.growthRate, null);
    assert.strictEqual(result.direction.trend, 'unavailable');
  });
  it('computes increasing growth rate', async () => {
    const pool = createMockPool([
      // forecastRes
      { rows: [
        { barangay_name: 'A', period: '2026-09-01', forecasted_count: 80, confidence_lower: 70, confidence_upper: 90, risk_class: 'Medium', incidence_per_100k: 100, actual_count: null },
        { barangay_name: 'A', period: '2026-10-01', forecasted_count: 90, confidence_lower: 80, confidence_upper: 100, risk_class: 'Medium', incidence_per_100k: 110, actual_count: null },
        { barangay_name: 'A', period: '2026-08-01', forecasted_count: 70, confidence_lower: 60, confidence_upper: 80, risk_class: 'Medium', incidence_per_100k: 90, actual_count: 65 },
        { barangay_name: 'A', period: '2026-07-01', forecasted_count: 60, confidence_lower: 50, confidence_upper: 70, risk_class: 'Low', incidence_per_100k: 75, actual_count: 55 },
      ]},
      // riskRes
      { rows: [{ barangay_name: 'A', risk_class: 'Medium', risk_score: 50 }] },
      // metaRes
      { rows: [{ run_type: 'full', model_version: 'v1.0', trained_at: '2026-09-01', config: { method: 'ARIMA' } }] },
      { rows: [{ first_month: '2025-01', last_month: '2025-12', total_cases: 600 }] },
    ]);

    const result = await buildForecastingMetrics(pool);
    // First forecast is 80; selected historical average is 600/12 = 50.
    assert.strictEqual(result.direction.trend, 'increasing');
    assert.ok(result.direction.growthRate > 5);
  });

  it('computes predicted cases totals', async () => {
    const pool = createMockPool([
      { rows: [
        { barangay_name: 'A', period: '2026-09-01', forecasted_count: 80, confidence_lower: 70, confidence_upper: 90, risk_class: null, incidence_per_100k: null, actual_count: null },
        { barangay_name: 'A', period: '2026-10-01', forecasted_count: 90, confidence_lower: 80, confidence_upper: 100, risk_class: null, incidence_per_100k: null, actual_count: null },
        { barangay_name: 'A', period: '2026-11-01', forecasted_count: 100, confidence_lower: 90, confidence_upper: 110, risk_class: null, incidence_per_100k: null, actual_count: null },
      ]},
      { rows: [] },
      { rows: [] },
    ]);

    const result = await buildForecastingMetrics(pool);
    assert.strictEqual(result.predictedCases.total, 270);
    assert.strictEqual(result.predictedCases.monthlyAvg, 90);
    assert.strictEqual(result.predictedCases.horizon, 3);
  });

  it('identifies peak period', async () => {
    const pool = createMockPool([
      { rows: [
        { barangay_name: 'A', period: '2026-09-01', forecasted_count: 50, confidence_lower: 40, confidence_upper: 60, risk_class: null, incidence_per_100k: null, actual_count: null },
        { barangay_name: 'A', period: '2026-10-01', forecasted_count: 80, confidence_lower: 70, confidence_upper: 90, risk_class: null, incidence_per_100k: null, actual_count: null },
        { barangay_name: 'B', period: '2026-10-01', forecasted_count: 70, confidence_lower: 60, confidence_upper: 80, risk_class: null, incidence_per_100k: null, actual_count: null },
      ]},
      { rows: [] },
      { rows: [] },
    ]);

    const result = await buildForecastingMetrics(pool);
    assert.strictEqual(result.peakPeriod.count, 150); // 80+70 in October
    assert.ok(result.peakPeriod.label.includes('October'));
  });

  it('identifies high-risk forecast barangays', async () => {
    const pool = createMockPool([
      { rows: [
        { barangay_name: 'A', period: '2026-09-01', forecasted_count: 50, confidence_lower: 40, confidence_upper: 60, risk_class: 'High', incidence_per_100k: 200, actual_count: null },
        { barangay_name: 'B', period: '2026-09-01', forecasted_count: 30, confidence_lower: 20, confidence_upper: 40, risk_class: 'Low', incidence_per_100k: 50, actual_count: null },
      ]},
      { rows: [{ barangay_name: 'A', risk_class: 'High', risk_score: 80 }] },
      { rows: [] },
    ]);

    const result = await buildForecastingMetrics(pool);
    assert.deepStrictEqual(result.highRiskForecastBarangays, ['A']);
  });

  it('counts distinct high-risk barangays only from the current pipeline period', async () => {
    const calls = [];
    const pool = { query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM barangay_risk_scores')) return { rows: [
        { barangay_name: 'A', risk_class: 'High' },
        { barangay_name: 'A', risk_class: 'High' },
        { barangay_name: 'B', risk_class: 'Medium' },
      ] };
      return { rows: [] };
    } };
    const result = await buildForecastingMetrics(pool, { barangay: 'A' });
    assert.deepStrictEqual(result.highRiskForecastBarangays, ['A']);
    assert.match(calls[1].sql, /DISTINCT ON/);
    assert.match(calls[1].sql, /JOIN barangays/);
    assert.match(calls[1].sql, /brs\.period =/);
    assert.match(calls[1].sql, /run_type = 'pipeline'/);
    assert.deepStrictEqual(calls[1].params, ['A']);
  });

  it('computes confidence interval interpretation', async () => {
    const pool = createMockPool([
      { rows: [
        // Narrow CI: (90-70)/80 = 0.25
        { barangay_name: 'A', period: '2026-09-01', forecasted_count: 80, confidence_lower: 70, confidence_upper: 90, risk_class: null, incidence_per_100k: null, actual_count: null },
      ]},
      { rows: [] },
      { rows: [] },
    ]);

    const result = await buildForecastingMetrics(pool);
    assert.strictEqual(result.confidence.interpretation, 'narrow');
    assert.ok(result.confidence.avgRelativeCIWidth < 0.3);
  });

  it('computes wide confidence intervals', async () => {
    const pool = createMockPool([
      { rows: [
        // Wide CI: (150-10)/80 = 1.75
        { barangay_name: 'A', period: '2026-09-01', forecasted_count: 80, confidence_lower: 10, confidence_upper: 150, risk_class: null, incidence_per_100k: null, actual_count: null },
      ]},
      { rows: [] },
      { rows: [] },
    ]);

    const result = await buildForecastingMetrics(pool);
    assert.strictEqual(result.confidence.interpretation, 'wide');
    assert.ok(result.confidence.avgRelativeCIWidth > 0.6);
  });

  it('returns model info from metadata', async () => {
    const pool = createMockPool([
      { rows: [
        { barangay_name: 'A', period: '2026-09-01', forecasted_count: 50, confidence_lower: 40, confidence_upper: 60, risk_class: null, incidence_per_100k: null, actual_count: null },
      ]},
      { rows: [] },
      { rows: [{ run_type: 'full', model_version: 'v2.1', trained_at: '2026-09-01', config: { method: 'ARIMA + RF' } }] },
    ]);

    const result = await buildForecastingMetrics(pool);
    assert.strictEqual(result.modelInfo.method, 'ARIMA + RF');
    assert.strictEqual(result.modelInfo.barangaysProcessed, 1);
  });

  it('handles empty forecast data', async () => {
    const pool = createMockPool([
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);

    const result = await buildForecastingMetrics(pool);
    assert.strictEqual(result.predictedCases.total, 0);
    assert.strictEqual(result.predictedCases.monthlyAvg, 0);
    assert.strictEqual(result.peakPeriod.label, null);
    assert.deepStrictEqual(result.highRiskForecastBarangays, []);
  });
});
