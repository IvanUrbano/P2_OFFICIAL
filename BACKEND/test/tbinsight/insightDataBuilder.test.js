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

// ==================== FORECASTING METRICS ====================

describe('buildForecastingMetrics', () => {
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
    ]);

    const result = await buildForecastingMetrics(pool);
    // forecastAvg = (80+90+70+60)/4 = 75; historicalAvg = (65+55)/2 = 60
    // growthRate = (75-60)/60 * 100 = 25%
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
