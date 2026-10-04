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
  generateGisInsight,
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

  it('each section has required fields and no icon', () => {
    const result = generateAnalyticsInsight(baseMetrics);
    for (const section of result.sections) {
      assert.ok(section.id, `Section missing id`);
      assert.ok(section.title, `Section ${section.id} missing title`);
      assert.ok(section.text, `Section ${section.id} missing text`);
      assert.ok(!('icon' in section), `Section ${section.id} must not carry an icon`);
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
    assert.ok(keyTrend.text.includes('increased'));
    assert.ok(keyTrend.text.includes('18.4%'));
  });

  it('generates decreasing trend text when changePercent < -5', () => {
    const metrics = { ...baseMetrics, trend: { ...baseMetrics.trend, direction: 'decreasing', changePercent: -12.5 } };
    const result = generateAnalyticsInsight(metrics);
    assert.ok(result.sections[0].text.includes('decreased'));
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
    assert.ok(section.text.includes('High Risk'));
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

  it('generates treatment text with rate value', () => {
    const result = generateAnalyticsInsight(baseMetrics);
    const section = result.sections[5];
    assert.strictEqual(section.id, 'treatment');
    assert.ok(section.text.includes('82%'));
  });

  it('generates treatment text for null rate', () => {
    const metrics = { ...baseMetrics, treatment: { ...baseMetrics.treatment, successRate: null } };
    const result = generateAnalyticsInsight(metrics);
    assert.ok(result.sections[5].text.includes('unavailable'));
  });

  it('builds basedOn string with barangay filter', () => {
    const result = generateAnalyticsInsight(baseMetrics, { barangay: 'San Jose' });
    assert.ok(result.meta.basedOn.includes('San Jose'));
  });

  it('builds basedOn string with All Barangays default', () => {
    const result = generateAnalyticsInsight(baseMetrics, {});
    assert.ok(result.meta.basedOn.includes('All Barangays'));
  });

  it('risk findings attributes classification to the Random Forest model', () => {
    const result = generateAnalyticsInsight(baseMetrics);
    const section = result.sections.find((s) => s.id === 'riskFindings');
    assert.ok(section.text.includes('Random Forest risk model classified'));
    assert.ok(section.text.includes('latest barangay-level'));
  });

  it('treatment includes cohort year and patient count when provided', () => {
    const metrics = {
      ...baseMetrics,
      treatment: { ...baseMetrics.treatment, cohortYear: 2025, cohortTotal: 5203 },
    };
    const result = generateAnalyticsInsight(metrics);
    const section = result.sections.find((s) => s.id === 'treatment');
    assert.ok(section.text.includes('2025 treatment cohort'));
    assert.ok(section.text.includes('5,203 patients'));
    assert.ok(section.text.includes('82%'));
  });

  it('suppresses highest/lowest when a single barangay is selected', () => {
    const result = generateAnalyticsInsight(baseMetrics, { barangay: 'San Jose' });
    assert.strictEqual(result.sections.length, 6);
    assert.ok(!result.sections.some((s) => s.id === 'highestLowest'));
    assert.ok(result.meta.basedOn.includes('San Jose'));
  });

  it('suppresses redundant sex split when a sex filter is active', () => {
    const result = generateAnalyticsInsight(baseMetrics, { sex: 'Female' });
    const section = result.sections.find((s) => s.id === 'demographics');
    assert.ok(section);
    assert.ok(!section.text.includes('account for'));
    assert.ok(section.text.includes('25-34'));
    assert.ok(result.meta.basedOn.includes('Female'));
  });

  it('omits demographics clause from overall summary when a sex filter is active', () => {
    const result = generateAnalyticsInsight(baseMetrics, { sex: 'Male' });
    const summary = result.sections.find((s) => s.id === 'overallSummary');
    assert.ok(!summary.text.includes('majority of reported cases'));
  });

  it('returns a single no-data section when zero records match', () => {
    const metrics = {
      ...baseMetrics,
      summary: { ...baseMetrics.summary, totalCases: 0 },
    };
    const result = generateAnalyticsInsight(metrics, { year: '2022', barangay: 'San Jose' });
    assert.strictEqual(result.sections.length, 1);
    assert.strictEqual(result.sections[0].id, 'overallSummary');
    assert.ok(result.sections[0].text.includes('No analytical insight is available'));
    assert.ok(result.meta.basedOn.includes('2022'));
    assert.ok(result.meta.basedOn.includes('San Jose'));
  });

  it('does not state a 0% or stable trend when there are no records', () => {
    const metrics = {
      ...baseMetrics,
      summary: { ...baseMetrics.summary, totalCases: 0 },
    };
    const result = generateAnalyticsInsight(metrics);
    assert.strictEqual(result.sections.length, 1);
    assert.ok(!result.sections[0].text.includes('stable'));
    assert.ok(!result.sections[0].text.includes('0%'));
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

  it('each section has required fields and no icon', () => {
    const result = generateForecastingInsight(baseMetrics);
    for (const section of result.sections) {
      assert.ok(section.id, `Section missing id`);
      assert.ok(section.title, `Section ${section.id} missing title`);
      assert.ok(section.text, `Section ${section.id} missing text`);
      assert.ok(!('icon' in section), `Section ${section.id} must not carry an icon`);
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

// ==================== GIS INSIGHT ====================

describe('generateGisInsight', () => {
  const baseMetrics = {
    riskCounts: { High: 4, Medium: 10, Low: 14, 'No Data': 2 },
    topHotspots: [
      { name: 'San Jose', risk_class: 'High', risk_score: 82.5, incidence_per_100k: 120.4 },
      { name: 'Manggahan', risk_class: 'High', risk_score: 77.1, incidence_per_100k: 98.2 },
    ],
    concentration: {
      totalCases: 500,
      top5CaseSharePct: 62,
      top5: [
        { name: 'San Jose', total_cases: 60 },
        { name: 'Manggahan', total_cases: 55 },
        { name: 'Pinagbuhatan', total_cases: 50 },
        { name: 'Sta. Cruz', total_cases: 45 },
        { name: 'Dela Paz', total_cases: 40 },
      ],
    },
    casesVsRiskPatterns: {
      highRiskLowerCaseCount: 2,
      highCaseCountLowerRisk: 1,
      highRiskLowerCase: [{ name: 'Oranbo' }, { name: 'Dulo' }],
    },
    trendCounts: { Increasing: 12, Decreasing: 9, Stable: 9 },
    coverage: { scoredBarangays: 30, totalBarangays: 30, periodYear: 2025 },
    incidence: { available: true, periodYear: 2025, periodYearHasPopulation: true, barangaysWithIncidence: 30 },
    focus: { name: 'San Jose', risk_class: 'High', risk_score: 82.5, rank: 1, total_scored: 30 },
  };

  const sectionId = (result, id) => result.sections.find((s) => s.id === id);

  it('returns correct type and meta structure', () => {
    const result = generateGisInsight(baseMetrics, { barangay: 'San Jose' });
    assert.strictEqual(result.type, 'gis');
    assert.ok(result.meta.basedOn.includes('San Jose'));
    assert.ok(result.meta.basedOn.includes('Risk Period 2025'));
    assert.ok(result.meta.generatedAt);
  });

  it('builds basedOn with All Barangays default', () => {
    const result = generateGisInsight(baseMetrics);
    assert.ok(result.meta.basedOn.includes('All Barangays'));
  });

  it('returns exactly 6 sections with the expected ids in order', () => {
    const result = generateGisInsight(baseMetrics);
    assert.strictEqual(result.sections.length, 6);
    assert.deepStrictEqual(
      result.sections.map((s) => s.id),
      ['riskOverview', 'topHotspots', 'caseConcentration', 'casesVsRiskPatterns', 'trendDistribution', 'overallSummary']
    );
  });

  it('each section has required fields and no icon', () => {
    const result = generateGisInsight(baseMetrics);
    for (const section of result.sections) {
      assert.ok(section.id, 'Section missing id');
      assert.ok(section.title, `Section ${section.id} missing title`);
      assert.ok(section.text, `Section ${section.id} missing text`);
      assert.ok(!('icon' in section), `Section ${section.id} must not carry an icon`);
    }
  });

  it('last section is overallSummary', () => {
    const result = generateGisInsight(baseMetrics);
    assert.strictEqual(result.sections[5].id, 'overallSummary');
  });

  it('risk overview uses actual High/Medium/Low/No Data labels and period year', () => {
    const result = generateGisInsight(baseMetrics);
    const text = sectionId(result, 'riskOverview').text;
    assert.ok(text.includes('**High**'));
    assert.ok(text.includes('**Medium**'));
    assert.ok(text.includes('**Low**'));
    assert.ok(text.includes('**No Data**'));
    assert.ok(text.includes('2025'));
    assert.ok(text.includes('**San Jose** is classified **High**'));
  });

  it('top hotspots includes incidence per 100k when incidence is available', () => {
    const result = generateGisInsight(baseMetrics);
    const text = sectionId(result, 'topHotspots').text;
    assert.ok(text.includes('**San Jose**'));
    assert.ok(text.includes('per 100,000 population'));
  });

  it('case concentration reports top 5 share', () => {
    const result = generateGisInsight(baseMetrics);
    const text = sectionId(result, 'caseConcentration').text;
    assert.ok(text.includes('**62%**'));
    assert.ok(text.includes('5 barangays'));
    assert.ok(text.includes('San Jose'));
  });

  it('cases vs risk patterns reports mismatch counts with methodology wording when incidence available', () => {
    const result = generateGisInsight(baseMetrics);
    const text = sectionId(result, 'casesVsRiskPatterns').text;
    assert.ok(text.includes('**2**'));
    assert.ok(text.includes('**1**'));
    assert.ok(text.includes('population-adjusted incidence, trend, recent monthly cases and the risk in bordering barangays'));
    assert.ok(text.includes('Oranbo'));
  });

  it('cases vs risk patterns uses cautious wording when incidence is unavailable', () => {
    const metrics = { ...baseMetrics, incidence: { available: false, periodYear: 2025 } };
    const result = generateGisInsight(metrics);
    const text = sectionId(result, 'casesVsRiskPatterns').text;
    assert.ok(text.includes('draws on indicators beyond raw case volume'));
    assert.ok(!text.includes('population-adjusted incidence'));
  });

  it('cases vs risk patterns reports alignment when there are no mismatches', () => {
    const metrics = {
      ...baseMetrics,
      casesVsRiskPatterns: { highRiskLowerCaseCount: 0, highCaseCountLowerRisk: 0 },
    };
    const result = generateGisInsight(metrics);
    assert.ok(sectionId(result, 'casesVsRiskPatterns').text.includes('closely aligned'));
  });

  it('trend distribution reports counts per trend direction', () => {
    const result = generateGisInsight(baseMetrics);
    const text = sectionId(result, 'trendDistribution').text;
    assert.ok(text.includes('**30** classified barangays'));
    assert.ok(text.includes('**12**'));
    assert.ok(text.includes('**Increasing**'));
    assert.ok(text.includes('**Decreasing**'));
    assert.ok(text.includes('**Stable**'));
  });

  it('includes incidence-unavailable guard with the matching year everywhere relevant', () => {
    const metrics = { ...baseMetrics, incidence: { available: false, periodYear: 2025 } };
    const result = generateGisInsight(metrics);
    const guard = 'Incidence interpretation is unavailable for 2025 because matching-year population reference data is not configured.';
    assert.ok(sectionId(result, 'riskOverview').text.includes(guard));
    assert.ok(sectionId(result, 'overallSummary').text.includes(guard));
    assert.ok(!sectionId(result, 'topHotspots').text.includes('per 100,000'));
  });

  it('omits incidence claims entirely when population is unavailable', () => {
    const metrics = { ...baseMetrics, incidence: { available: false, periodYear: 2025 } };
    const result = generateGisInsight(metrics);
    for (const section of result.sections) {
      assert.ok(!section.text.includes('per 100,000'), `${section.id} must not cite incidence`);
    }
  });

  it('generates no-data texts when metrics are empty', () => {
    const result = generateGisInsight({});
    assert.ok(sectionId(result, 'riskOverview').text.includes('No risk classifications'));
    assert.ok(sectionId(result, 'topHotspots').text.includes('No barangays'));
    assert.ok(sectionId(result, 'caseConcentration').text.includes('No reported case data'));
    assert.ok(sectionId(result, 'trendDistribution').text.includes('No classified barangays'));
    assert.ok(sectionId(result, 'overallSummary').text.includes('No risk classifications'));
  });

  it('does not show incidence guard when no classifications exist', () => {
    const result = generateGisInsight({ incidence: { available: false, periodYear: 2025 } });
    assert.ok(!sectionId(result, 'overallSummary').text.includes('Incidence interpretation is unavailable'));
  });

  it('overall summary reflects increasing majority', () => {
    const result = generateGisInsight(baseMetrics);
    assert.ok(sectionId(result, 'overallSummary').text.includes('increasing than a decreasing'));
    assert.ok(sectionId(result, 'overallSummary').text.includes('4 barangay(s)'));
    assert.ok(sectionId(result, 'overallSummary').text.includes('62%'));
  });
});
