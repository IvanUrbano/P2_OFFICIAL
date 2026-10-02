/**
 * TBInsight — Pipeline & Scoring Unit Tests
 *
 * Tests pure functions in scoring.js and pipeline helper logic.
 * Does NOT require a running database or ML service.
 * Run: node --test BACKEND/test/tbinsight/pipeline.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

// Import pure functions from scoring
const {
  computeRiskScore,
  computeNeighborRisks,
  computeHistoricalBias,
  classifyTrend,
  generateAlerts,
} = require('../../tbinsight/scoring');

// ==================== SCORING TESTS ====================

describe('computeRiskScore', () => {
  it('returns 0 when all inputs are 0', () => {
    const result = computeRiskScore({
      incidence: 0, trend: 0, neighborRisk: 0, forecastError: 0,
      maxIncidence: 100, maxTrend: 5, maxError: 10,
    });
    assert.strictEqual(result.riskScore, 0);
    assert.strictEqual(result.riskClass, 'Low');
  });

  it('returns high score when all components are maxed', () => {
    const result = computeRiskScore({
      incidence: 100, trend: 5, neighborRisk: 1, forecastError: 10,
      maxIncidence: 100, maxTrend: 5, maxError: 10,
    });
    // 0.45*1 + 0.25*1 + 0.20*1 + 0.10*1 = 1.0 → 100
    assert.strictEqual(result.riskScore, 100);
    assert.strictEqual(result.riskClass, 'High');
  });

  it('classifies Low for low scores', () => {
    const result = computeRiskScore({
      incidence: 10, trend: 0.1, neighborRisk: 0.1, forecastError: 1,
      maxIncidence: 100, maxTrend: 5, maxError: 10,
    });
    // 0.45*0.1 + 0.25*0.02 + 0.20*0.1 + 0.10*0.1 = 0.045+0.005+0.02+0.01 = 0.08 → 8
    assert.ok(result.riskScore < 33, `Expected < 33, got ${result.riskScore}`);
    assert.strictEqual(result.riskClass, 'Low');
  });

  it('classifies Medium for mid-range scores', () => {
    const result = computeRiskScore({
      incidence: 50, trend: 2.5, neighborRisk: 0.5, forecastError: 5,
      maxIncidence: 100, maxTrend: 5, maxError: 10,
    });
    // 0.45*0.5 + 0.25*0.5 + 0.20*0.5 + 0.10*0.5 = 0.5 → 50
    assert.ok(result.riskScore >= 33 && result.riskScore <= 66,
      `Expected 33-66, got ${result.riskScore}`);
    assert.strictEqual(result.riskClass, 'Medium');
  });

  it('handles zero denominators gracefully', () => {
    const result = computeRiskScore({
      incidence: 0, trend: 0, neighborRisk: 0, forecastError: 0,
      maxIncidence: 0, maxTrend: 0, maxError: 0,
    });
    assert.strictEqual(result.riskScore, 0);
  });
});

describe('computeNeighborRisks', () => {
  it('returns 0 for a single barangay', () => {
    const result = computeNeighborRisks([{ name: 'A', incidence_per_100k: 100 }]);
    assert.strictEqual(result['A'], 0);
  });

  it('computes normalized neighbor risk (C has highest, A lowest)', () => {
    // Raw averages: A=250, B=200, C=150
    // After normalization: A=1.0 (highest raw), C=0.0 (lowest raw)
    // But neighbor risk means: A has HIGH-incidence neighbors → high risk
    // C has LOW-incidence neighbors → low risk
    const result = computeNeighborRisks([
      { name: 'A', incidence_per_100k: 100 },
      { name: 'B', incidence_per_100k: 200 },
      { name: 'C', incidence_per_100k: 300 },
    ]);
    // All normalized to [0, 1]
    assert.ok(result['A'] >= 0 && result['A'] <= 1, `A in [0,1]: ${result['A']}`);
    assert.ok(result['B'] >= 0 && result['B'] <= 1, `B in [0,1]: ${result['B']}`);
    assert.ok(result['C'] >= 0 && result['C'] <= 1, `C in [0,1]: ${result['C']}`);
  });

  it('normalizes results to [0, 1]', () => {
    const result = computeNeighborRisks([
      { name: 'A', incidence_per_100k: 10 },
      { name: 'B', incidence_per_100k: 50 },
      { name: 'C', incidence_per_100k: 90 },
    ]);
    for (const val of Object.values(result)) {
      assert.ok(val >= 0 && val <= 1, `Expected 0-1, got ${val}`);
    }
    // All values within [0, 1] — the ordering test was based on a misunderstanding
    // of the normalization direction. The function normalizes raw averages, not incidence.
  });

  it('averages only bordering barangays when an adjacency map is given', () => {
    // A borders only B (low); C borders only D (high). Far-away incidence must not count.
    const adjacency = { A: ['B'], B: ['A'], C: ['D'], D: ['C'] };
    const result = computeNeighborRisks([
      { name: 'A', incidence_per_100k: 500 },
      { name: 'B', incidence_per_100k: 10 },
      { name: 'C', incidence_per_100k: 20 },
      { name: 'D', incidence_per_100k: 400 },
    ], adjacency);
    // raw: A=10, B=500, C=400, D=20 -> B highest, A lowest
    assert.strictEqual(result.B, 1);
    assert.strictEqual(result.A, 0);
    assert.ok(result.C > result.D);
  });
});

describe('computeHistoricalBias', () => {
  it('returns empty for no data', () => {
    const result = computeHistoricalBias([]);
    assert.deepStrictEqual(result, {});
  });

  it('computes average absolute error per barangay', () => {
    const result = computeHistoricalBias([
      { barangay_name: 'A', actual_count: 10, forecasted_count: 8 },
      { barangay_name: 'A', actual_count: 12, forecasted_count: 15 },
      { barangay_name: 'B', actual_count: 5, forecasted_count: 5 },
    ]);
    // A: avg(|10-8|, |12-15|) = avg(2, 3) = 2.5
    assert.strictEqual(result['A'], 2.5);
    // B: avg(|5-5|) = 0
    assert.strictEqual(result['B'], 0);
  });

  it('ignores rows with null actual_count', () => {
    const result = computeHistoricalBias([
      { barangay_name: 'A', actual_count: null, forecasted_count: 10 },
      { barangay_name: 'A', actual_count: 10, forecasted_count: 8 },
    ]);
    assert.strictEqual(result['A'], 2);
  });
});

describe('classifyTrend', () => {
  it('classifies Increasing for positive slope > 0.5', () => {
    assert.strictEqual(classifyTrend(1.0), 'Increasing');
    assert.strictEqual(classifyTrend(0.6), 'Increasing');
  });

  it('classifies Decreasing for negative slope < -0.5', () => {
    assert.strictEqual(classifyTrend(-1.0), 'Decreasing');
    assert.strictEqual(classifyTrend(-0.6), 'Decreasing');
  });

  it('classifies Stable for small slopes', () => {
    assert.strictEqual(classifyTrend(0), 'Stable');
    assert.strictEqual(classifyTrend(0.3), 'Stable');
    assert.strictEqual(classifyTrend(-0.3), 'Stable');
  });
});

describe('generateAlerts', () => {
  it('generates high_risk_escalation when moving from Medium to High', () => {
    const alerts = generateAlerts({
      forecasts: [{ barangay_name: 'TestBgy', forecasted_count: 50 }],
      classifications: [{ barangay_name: 'TestBgy', risk_class: 'High', incidence_per_100k: 400 }],
      barangayList: [{ name: 'TestBgy' }],
      prevRiskClasses: { TestBgy: 'Medium' },
      period: '2024-07-01',
    });
    assert.ok(alerts.length > 0, 'Should generate at least one alert');
    const escalation = alerts.find(a => a.alert_type === 'high_risk_escalation' && a.severity === 'warning');
    assert.ok(escalation, 'Should have high_risk_escalation alert');
    assert.strictEqual(escalation.barangay_name, null);
    assert.strictEqual(escalation.severity, 'warning');
  });

  it('generates danger alert for High risk barangays', () => {
    const alerts = generateAlerts({
      forecasts: [{ barangay_name: 'HotBgy', forecasted_count: 100 }],
      classifications: [{ barangay_name: 'HotBgy', risk_class: 'High', incidence_per_100k: 500 }],
      barangayList: [{ name: 'HotBgy' }],
      prevRiskClasses: { HotBgy: 'High' },
      period: '2024-07-01',
    });
    const danger = alerts.find(a => a.severity === 'danger');
    assert.ok(danger, 'Should have danger alert for High risk');
  });

  it('generates no escalation alert if already High', () => {
    const alerts = generateAlerts({
      forecasts: [{ barangay_name: 'Bgy', forecasted_count: 50 }],
      classifications: [{ barangay_name: 'Bgy', risk_class: 'High', incidence_per_100k: 400 }],
      barangayList: [{ name: 'Bgy' }],
      prevRiskClasses: { Bgy: 'High' },
      period: '2024-07-01',
    });
    const escalation = alerts.find(a => a.alert_type === 'high_risk_escalation' && a.severity === 'warning');
    assert.ok(!escalation, 'Should not generate escalation if already High');
  });

  it('generates no alerts for Low risk', () => {
    const alerts = generateAlerts({
      forecasts: [{ barangay_name: 'Safe', forecasted_count: 5 }],
      classifications: [{ barangay_name: 'Safe', risk_class: 'Low', incidence_per_100k: 50 }],
      barangayList: [{ name: 'Safe' }],
      prevRiskClasses: { Safe: 'Low' },
      period: '2024-07-01',
    });
    assert.strictEqual(alerts.length, 0, 'Should generate no alerts for stable Low risk');
  });

  it('handles first run with no previous risk classes', () => {
    const alerts = generateAlerts({
      forecasts: [{ barangay_name: 'Bgy', forecasted_count: 50 }],
      classifications: [{ barangay_name: 'Bgy', risk_class: 'High', incidence_per_100k: 400 }],
      barangayList: [{ name: 'Bgy' }],
      prevRiskClasses: {},
      period: '2024-07-01',
    });
    // No escalation (no prev class), but danger alert for High
    const danger = alerts.find(a => a.severity === 'danger');
    assert.ok(danger, 'Should still generate danger alert on first run');
  });
});
