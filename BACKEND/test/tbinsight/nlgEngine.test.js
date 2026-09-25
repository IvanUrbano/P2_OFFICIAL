/**
 * TBInsight — NLG Engine Unit Tests
 *
 * Tests template-based text generation for analytics and forecasting insights.
 * Does NOT require a running database — pure function tests.
 * Run: node --test BACKEND/test/tbinsight/nlgEngine.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  generateAnalyticsInsight,
  generateForecastingInsight,
} = require('../../tbinsight/nlgEngine');

// ==================== ANALYTICS INSIGHT ====================

describe('generateAnalyticsInsight', () => {
  const baseMetrics = {
    trend: { direction: 'increasing', changePercent: 18.4, recentCount: 320, priorCount: 270 },
    highestBarangay: { name: 'San Jose', total: 45 },
    lowestBarangay: { name: 'Oranbo', total: 3 },
    significantChanges: [
      { barangay: 'Manggahan', month: '2026-08-01', caseCount: 30, zScore: 2.1, historicalMean: 15 },
    ],
    riskCounts: { high: 4, medium: 8, low: 18 },
    highRiskBarangays: ['San Jose', 'Manggahan', 'Pinagbuhatan', 'Sta. Cruz'],
    demographics: {
      sexSplit: { male: 62, female: 38 },
      dominantAgeGroup: { group: '25-34', count: 120, percentage: 38 },
    },
    treatment: { successRate: 82, outcomeBreakdown: { CURED: 200, 'TREATMENT COMPLETED': 100, 'ON TREATMENT': 50 } },
    summary: { totalCases: 500, barangaysWithData: 25, earliestDate: '2024-01-01', latestDate: '2026-08-31' },
  };

  it('returns correct type and meta structure', () => {
    const result = generateAnalyticsInsight(baseMetrics, { year: '2026', month: '8' });
    assert.strictEqual(result.type, 'analytics');
    assert.ok(result.meta.basedOn.includes('2026'));
    assert.ok(result.meta.basedOn.includes('August'));
    assert.ok(result.meta.generatedAt);
  });

  it('returns exactly 7 sections', () => {
    const result = generateAnalyticsInsight(baseMetrics);
    assert.strictEqual(result.sections.length, 7);
  });

  it('each section has required fields', () => {
    const result = generateAnalyticsInsight(baseMetrics);
    for (const section of result.sections) {
      assert.ok(section.id, `Section missing id`);
      assert.ok(section.title, `Section ${section.id} missing title`);
      assert.ok(section.text, `Section ${section.id} missing text`);
      assert.ok(section.icon, `Section ${section.id} missing icon`);
    }
  });

  it('last section is overallSummary', () => {
    const result = generateAnalyticsInsight(baseMetrics);
    assert.strictEqual(result.sections[6].id, 'overallSummary');
  });

  it('generates increasing trend text when changePercent > 5', () => {
    const result = generateAnalyticsInsight(baseMetrics);
    const keyTrend = result.sections[0];
    assert.strictEqual(keyTrend.id, 'keyTrend');
    assert.ok(keyTrend.text.includes('increasing trend'));
    assert.ok(keyTrend.text.includes('18.4%'));
  });

  it('generates decreasing trend text when changePercent < -5', () => {
    const metrics = { ...baseMetrics, trend: { ...baseMetrics.trend, direction: 'decreasing', changePercent: -12.5 } };
    const result = generateAnalyticsInsight(metrics);
    assert.ok(result.sections[0].text.includes('decreasing trend'));
    assert.ok(result.sections[0].text.includes('12.5%'));
  });

  it('generates stable trend text when changePercent between -5 and 5', () => {
    const metrics = { ...baseMetrics, trend: { ...baseMetrics.trend, direction: 'stable', changePercent: 2.1 } };
    const result = generateAnalyticsInsight(metrics);
    assert.ok(result.sections[0].text.includes('relatively stable'));
  });

  it('generates highest/lowest with different barangays', () => {
    const result = generateAnalyticsInsight(baseMetrics);
    const section = result.sections[1];
    assert.strictEqual(section.id, 'highestLowest');
    assert.ok(section.text.includes('San Jose'));
    assert.ok(section.text.includes('Oranbo'));
  });

  it('generates same-barangay text when highest equals lowest', () => {
    const metrics = {
      ...baseMetrics,
      highestBarangay: { name: 'Solo', total: 5 },
      lowestBarangay: { name: 'Solo', total: 5 },
    };
    const result = generateAnalyticsInsight(metrics);
    assert.ok(result.sections[1].text.includes('both the highest and lowest'));
  });

  it('generates no-data text when no barangay data', () => {
    const metrics = { ...baseMetrics, highestBarangay: null, lowestBarangay: null };
    const result = generateAnalyticsInsight(metrics);
    assert.ok(result.sections[1].text.includes('No barangay data'));
  });

  it('generates significant changes text', () => {
    const result = generateAnalyticsInsight(baseMetrics);
    const section = result.sections[2];
    assert.strictEqual(section.id, 'significantChanges');
    assert.ok(section.text.includes('Manggahan'));
    assert.ok(section.text.includes('increase'));
  });

  it('generates no-significant-changes text when empty', () => {
    const metrics = { ...baseMetrics, significantChanges: [] };
    const result = generateAnalyticsInsight(metrics);
    assert.ok(result.sections[2].text.includes('No barangay showed'));
  });

  it('generates risk findings with count and names', () => {
    const result = generateAnalyticsInsight(baseMetrics);
    const section = result.sections[3];
    assert.strictEqual(section.id, 'riskFindings');
    assert.ok(section.text.includes('4'));
    assert.ok(section.text.includes('high-risk'));
    assert.ok(section.text.includes('San Jose'));
  });

  it('generates no-risk text when highCount is 0', () => {
    const metrics = { ...baseMetrics, riskCounts: { high: 0, medium: 3, low: 27 }, highRiskBarangays: [] };
    const result = generateAnalyticsInsight(metrics);
    assert.ok(result.sections[3].text.includes('No barangays'));
    assert.ok(result.sections[3].text.includes('medium-risk'));
  });

  it('generates demographics with male majority', () => {
    const result = generateAnalyticsInsight(baseMetrics);
    const section = result.sections[4];
    assert.strictEqual(section.id, 'demographics');
    assert.ok(section.text.includes('Males account for'));
    assert.ok(section.text.includes('62%'));
  });

  it('generates demographics with female majority', () => {
    const metrics = {
      ...baseMetrics,
      demographics: { sexSplit: { male: 35, female: 65 }, dominantAgeGroup: baseMetrics.demographics.dominantAgeGroup },
    };
    const result = generateAnalyticsInsight(metrics);
    assert.ok(result.sections[4].text.includes('Females account for'));
  });

  it('generates demographics with balanced sex split', () => {
    const metrics = {
      ...baseMetrics,
      demographics: { sexSplit: { male: 49, female: 51 }, dominantAgeGroup: baseMetrics.demographics.dominantAgeGroup },
    };
    const result = generateAnalyticsInsight(metrics);
    assert.ok(result.sections[4].text.includes('relatively balanced'));
  });

  it('generates treatment text below target', () => {
    const result = generateAnalyticsInsight(baseMetrics);
    const section = result.sections[5];
    assert.strictEqual(section.id, 'treatment');
    assert.ok(section.text.includes('82%'));
    assert.ok(section.text.includes('below'));
  });

  it('generates treatment text above target', () => {
    const metrics = { ...baseMetrics, treatment: { ...baseMetrics.treatment, successRate: 90 } };
    const result = generateAnalyticsInsight(metrics);
    assert.ok(result.sections[5].text.includes('90%'));
    assert.ok(result.sections[5].text.includes('exceeding'));
  });

  it('builds basedOn string with barangay filter', () => {
    const result = generateAnalyticsInsight(baseMetrics, { barangay: 'San Jose' });
    assert.ok(result.meta.basedOn.includes('San Jose'));
  });

  it('builds basedOn string with All Barangays default', () => {
    const result = generateAnalyticsInsight(baseMetrics, {});
    assert.ok(result.meta.basedOn.includes('All Barangays'));
  });
});

// ==================== FORECASTING INSIGHT ====================

describe('generateForecastingInsight', () => {
  const baseMetrics = {
    direction: { trend: 'increasing', growthRate: 12.5 },
    predictedCases: { total: 228, monthlyAvg: 76, horizon: 3 },
    peakPeriod: { label: 'November 2026', count: 82 },
    highRiskForecastBarangays: ['San Jose', 'Manggahan', 'Pinagbuhatan', 'Sta. Cruz'],
    confidence: { avgRelativeCIWidth: 0.45, interpretation: 'moderate' },
    modelInfo: { method: 'ARIMA + RF', horizon: 3, barangaysProcessed: 30 },
  };

  it('returns correct type and meta structure', () => {
    const result = generateForecastingInsight(baseMetrics, { startYear: '2026', horizon: '3' });
    assert.strictEqual(result.type, 'forecasting');
    assert.ok(result.meta.basedOn.includes('3-Month Forecast'));
    assert.ok(result.meta.generatedAt);
  });

  it('returns exactly 7 sections', () => {
    const result = generateForecastingInsight(baseMetrics);
    assert.strictEqual(result.sections.length, 7);
  });

  it('each section has required fields', () => {
    const result = generateForecastingInsight(baseMetrics);
    for (const section of result.sections) {
      assert.ok(section.id, `Section missing id`);
      assert.ok(section.title, `Section ${section.id} missing title`);
      assert.ok(section.text, `Section ${section.id} missing text`);
      assert.ok(section.icon, `Section ${section.id} missing icon`);
    }
  });

  it('last section is overallSummary', () => {
    const result = generateForecastingInsight(baseMetrics);
    assert.strictEqual(result.sections[6].id, 'overallSummary');
  });

  it('generates increasing forecast direction', () => {
    const result = generateForecastingInsight(baseMetrics);
    const section = result.sections[0];
    assert.strictEqual(section.id, 'forecastDirection');
    assert.ok(section.text.includes('increase'));
    assert.ok(section.text.includes('3 months'));
  });

  it('generates decreasing forecast direction', () => {
    const metrics = { ...baseMetrics, direction: { trend: 'decreasing', growthRate: -10 } };
    const result = generateForecastingInsight(metrics);
    assert.ok(result.sections[0].text.includes('decrease'));
  });

  it('generates stable forecast direction', () => {
    const metrics = { ...baseMetrics, direction: { trend: 'stable', growthRate: 2 } };
    const result = generateForecastingInsight(metrics);
    assert.ok(result.sections[0].text.includes('relatively stable'));
  });

  it('generates predicted cases with total and monthly avg', () => {
    const result = generateForecastingInsight(baseMetrics);
    const section = result.sections[1];
    assert.strictEqual(section.id, 'predictedCases');
    assert.ok(section.text.includes('228'));
    assert.ok(section.text.includes('76'));
  });

  it('generates no-data predicted cases when total is 0', () => {
    const metrics = { ...baseMetrics, predictedCases: { total: 0, monthlyAvg: 0, horizon: 3 } };
    const result = generateForecastingInsight(metrics);
    assert.ok(result.sections[1].text.includes('No forecast data'));
  });

  it('generates peak period text', () => {
    const result = generateForecastingInsight(baseMetrics);
    const section = result.sections[2];
    assert.strictEqual(section.id, 'peakPeriod');
    assert.ok(section.text.includes('November 2026'));
    assert.ok(section.text.includes('82'));
  });

  it('generates no-peak text when null', () => {
    const metrics = { ...baseMetrics, peakPeriod: { label: null, count: 0 } };
    const result = generateForecastingInsight(metrics);
    assert.ok(result.sections[2].text.includes('Unable to determine'));
  });

  it('generates positive growth rate text', () => {
    const result = generateForecastingInsight(baseMetrics);
    const section = result.sections[3];
    assert.strictEqual(section.id, 'growthRate');
    assert.ok(section.text.includes('+12.5%'));
  });

  it('generates negative growth rate text', () => {
    const metrics = { ...baseMetrics, direction: { trend: 'decreasing', growthRate: -8.3 } };
    const result = generateForecastingInsight(metrics);
    assert.ok(result.sections[3].text.includes('-8.3%'));
    assert.ok(result.sections[3].text.includes('declining'));
  });

  it('generates zero growth rate text', () => {
    const metrics = { ...baseMetrics, direction: { trend: 'stable', growthRate: 0 } };
    const result = generateForecastingInsight(metrics);
    assert.ok(result.sections[3].text.includes('no significant change'));
  });

  it('generates high-risk areas text', () => {
    const result = generateForecastingInsight(baseMetrics);
    const section = result.sections[4];
    assert.strictEqual(section.id, 'highRiskAreas');
    assert.ok(section.text.includes('4'));
    assert.ok(section.text.includes('high-risk'));
  });

  it('generates no-high-risk text', () => {
    const metrics = { ...baseMetrics, highRiskForecastBarangays: [] };
    const result = generateForecastingInsight(metrics);
    assert.ok(result.sections[4].text.includes('No barangays'));
  });

  it('generates narrow confidence text', () => {
    const metrics = { ...baseMetrics, confidence: { avgRelativeCIWidth: 0.2, interpretation: 'narrow' } };
    const result = generateForecastingInsight(metrics);
    assert.ok(result.sections[5].text.includes('narrow'));
    assert.ok(result.sections[5].text.includes('high forecast certainty'));
  });

  it('generates wide confidence text', () => {
    const metrics = { ...baseMetrics, confidence: { avgRelativeCIWidth: 0.8, interpretation: 'wide' } };
    const result = generateForecastingInsight(metrics);
    assert.ok(result.sections[5].text.includes('wide'));
    assert.ok(result.sections[5].text.includes('significant forecast uncertainty'));
  });

  it('generates overall summary with elevated activity', () => {
    const result = generateForecastingInsight(baseMetrics);
    const section = result.sections[6];
    assert.strictEqual(section.id, 'overallSummary');
    assert.ok(section.text.includes('elevated'));
    assert.ok(section.text.includes('4 barangay(s)'));
  });

  it('builds basedOn with barangay filter', () => {
    const result = generateForecastingInsight(baseMetrics, { barangay: 'San Jose', horizon: '3' });
    assert.ok(result.meta.basedOn.includes('San Jose'));
    assert.ok(result.meta.basedOn.includes('3-Month Forecast'));
  });
});
