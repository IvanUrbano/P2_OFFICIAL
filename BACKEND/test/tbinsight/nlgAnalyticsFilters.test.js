/**
 * TBInsight — Analytics NLG Filter Behavior Unit Tests
 *
 * Generator-level matrix for filter-aware analytics insights: suppressions,
 * single-barangay behaviors, Based-on metadata, unavailable-metric
 * degradation, per-section isolation, and prose hygiene (no icons, no
 * undefined/NaN/Infinity/null leakage, exact heading pool).
 *
 * Pure function tests — no database, no HTTP.
 * Run: node --test BACKEND/test/tbinsight/nlgAnalyticsFilters.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { generateAnalyticsInsight } = require('../../tbinsight/nlgEngine');

const CANONICAL_HEADINGS = [
  'Key Trend',
  'Highest / Lowest',
  'Significant Changes',
  'Risk Findings',
  'Demographics',
  'Treatment',
  'Overall Summary',
];

const NO_DATA_TEXT =
  'No analytical insight is available for the selected filters because no matching TB records were found.';

function fullMetrics(overrides = {}) {
  return {
    trend: { direction: 'increasing', changePercent: 18.4, recentCount: 320, priorCount: 270 },
    highestBarangay: { name: 'San Jose', total: 45 },
    lowestBarangay: { name: 'Oranbo', total: 3 },
    significantChanges: [
      { barangay: 'Manggahan', month: '2026-08-01', caseCount: 30, zScore: 2.1, historicalMean: 15 },
    ],
    riskCounts: { high: 4, medium: 8, low: 18 },
    highRiskBarangays: ['San Jose', 'Manggahan', 'Pinagbuhatan', 'Sta. Cruz'],
    riskByBarangay: {
      'San Jose': 'High',
      'Manggahan': 'High',
      'Pinagbuhatan': 'High',
      'Sta. Cruz': 'Medium',
      'Bagong Ilog': 'High',
      'Oranbo': 'Low',
    },
    demographics: {
      sexSplit: { male: 62, female: 38 },
      dominantAgeGroup: { group: '25-34', count: 120, percentage: 38 },
    },
    treatment: { successRate: 81.1, fatalityRate: 2.6, cohortYear: 2025, cohortTotal: 5203, outcomeBreakdown: { CURED: 200 } },
    summary: { totalCases: 500, barangaysWithData: 25, earliestDate: '2024-01-01', latestDate: '2026-08-31' },
    unavailable: [],
    ...overrides,
  };
}

function allText(result) {
  return result.sections.map((s) => `${s.title} ${s.text}`).join('\n');
}

function assertProseHygiene(result, label) {
  const text = allText(result);
  const bad = text.match(/\b(undefined|NaN|Infinity|null)\b/);
  assert.ok(!bad, `${label}: prose leaked "${bad && bad[0]}" — ...${text.slice(Math.max(0, (bad ? bad.index : 0) - 40), (bad ? bad.index : 0) + 40)}...`);
  const emoji = text.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
  assert.ok(!emoji, `${label}: prose contains an icon/emoji: ${emoji && emoji[0]}`);
  for (const s of result.sections) {
    assert.ok(!('icon' in s), `${label}: section ${s.id} carries an icon property`);
    assert.ok(s.id && s.title && s.text, `${label}: section missing required fields`);
  }
}

function assertHeadingPoolSubset(result, label) {
  const titles = result.sections.map((s) => s.title);
  let ci = 0;
  for (const t of titles) {
    const found = CANONICAL_HEADINGS.indexOf(t, ci);
    assert.ok(found >= 0, `${label}: heading "${t}" outside canonical pool/order (seen so far: ${JSON.stringify(titles)})`);
    ci = found + 1;
  }
}

// ==================== BASED-ON METADATA ====================

describe('analytics NLG — Based-on metadata', () => {
  it('defaults the year part to All Years when no year filter is set', () => {
    const r = generateAnalyticsInsight(fullMetrics(), {});
    assert.ok(r.meta.basedOn.startsWith('All Years'), `got "${r.meta.basedOn}"`);
  });

  it('uses the selected year instead of All Years', () => {
    const r = generateAnalyticsInsight(fullMetrics(), { year: 2025 });
    assert.ok(r.meta.basedOn.startsWith('2025'), `got "${r.meta.basedOn}"`);
    assert.ok(!r.meta.basedOn.includes('All Years'));
  });

  it('composes All Years • Bagong Ilog for the original repro filter', () => {
    const r = generateAnalyticsInsight(fullMetrics(), { barangay: 'Bagong Ilog' });
    assert.strictEqual(r.meta.basedOn, 'All Years • Bagong Ilog');
  });

  it('composes 2025 • Bagong Ilog • Female for a combined filter', () => {
    const r = generateAnalyticsInsight(fullMetrics(), { year: 2025, barangay: 'Bagong Ilog', sex: 'Female' });
    assert.strictEqual(r.meta.basedOn, '2025 • Bagong Ilog • Female');
  });

  it('includes every active filter dimension (month, facility, age, bacteriological, outcome)', () => {
    const r = generateAnalyticsInsight(fullMetrics(), {
      year: 2025,
      month: 8,
      facility: 'Rizal Health Center',
      ageGroup: '25-34',
      bacteriological: 'smear',
      outcome: 'CURED',
    });
    for (const part of ['2025', 'August', 'Rizal Health Center', 'Age 25-34', 'smear', 'CURED', 'All Barangays']) {
      assert.ok(r.meta.basedOn.includes(part), `basedOn missing "${part}": "${r.meta.basedOn}"`);
    }
  });

  it('defaults to All Years in the zero-records branch too', () => {
    const m = fullMetrics({ summary: { totalCases: 0, barangaysWithData: 0, earliestDate: null, latestDate: null } });
    const r = generateAnalyticsInsight(m, { barangay: 'Bagong Ilog' });
    assert.strictEqual(r.meta.basedOn, 'All Years • Bagong Ilog');
    assert.strictEqual(r.sections.length, 1);
    assert.strictEqual(r.sections[0].text, NO_DATA_TEXT);
  });
});

// ==================== ZERO RECORDS ====================

describe('analytics NLG — zero records', () => {
  it('returns exactly one no-data section with the exact required sentence', () => {
    const m = fullMetrics({ summary: { totalCases: 0, barangaysWithData: 0, earliestDate: null, latestDate: null } });
    const r = generateAnalyticsInsight(m, { year: 2020 });
    assert.strictEqual(r.sections.length, 1);
    assert.strictEqual(r.sections[0].id, 'overallSummary');
    assert.strictEqual(r.sections[0].title, 'Overall Summary');
    assert.strictEqual(r.sections[0].text, NO_DATA_TEXT);
    assertProseHygiene(r, 'zero-records');
  });

  it('never renders 0%/stable trend prose for an empty selection', () => {
    const m = fullMetrics({ summary: { totalCases: 0, barangaysWithData: 0, earliestDate: null, latestDate: null } });
    const r = generateAnalyticsInsight(m, { year: 2020, barangay: 'Bagong Ilog' });
    const text = allText(r);
    assert.ok(!text.includes('stable'));
    assert.ok(!text.includes('0%'));
  });
});

// ==================== FILTER SUPPRESSIONS ====================

describe('analytics NLG — filter suppressions', () => {
  it('omits Highest / Lowest when a single barangay is selected', () => {
    const r = generateAnalyticsInsight(fullMetrics(), { barangay: 'Bagong Ilog' });
    assert.ok(!r.sections.some((s) => s.id === 'highestLowest'));
    assertHeadingPoolSubset(r, 'single-barangay');
  });

  it('omits the sex sentence when a sex filter is active but keeps the age insight', () => {
    const r = generateAnalyticsInsight(fullMetrics(), { sex: 'Female' });
    const demo = r.sections.find((s) => s.id === 'demographics');
    assert.ok(demo, 'demographics section expected');
    assert.ok(!demo.text.includes('account for'), `sex tautology leaked: "${demo.text}"`);
    assert.ok(demo.text.includes('25-34'), 'age insight should remain');
  });

  it('omits the dominant-age sentence when an age filter is active but keeps the sex insight', () => {
    const r = generateAnalyticsInsight(fullMetrics(), { ageGroup: '25-34' });
    const demo = r.sections.find((s) => s.id === 'demographics');
    assert.ok(demo, 'demographics section expected');
    assert.ok(!demo.text.includes('age group represents'), `age tautology leaked: "${demo.text}"`);
    assert.ok(demo.text.includes('Males account for'), 'sex insight should remain');
  });

  it('omits Demographics entirely when both sex and age filters are active', () => {
    const r = generateAnalyticsInsight(fullMetrics(), { sex: 'Male', ageGroup: '0-14' });
    assert.ok(!r.sections.some((s) => s.id === 'demographics'));
    assertHeadingPoolSubset(r, 'sex+age');
  });

  it('keeps all seven sections for an unfiltered full-metrics payload', () => {
    const r = generateAnalyticsInsight(fullMetrics(), {});
    assert.strictEqual(r.sections.length, 7);
    assert.deepStrictEqual(r.sections.map((s) => s.title), CANONICAL_HEADINGS);
    assertProseHygiene(r, 'full metrics');
  });
});

// ==================== SINGLE-BARANGAY RISK FINDINGS ====================

describe('analytics NLG — single-barangay risk findings', () => {
  it('states the selected barangay’s own RF classification with the assessment-scope caveat', () => {
    const r = generateAnalyticsInsight(fullMetrics(), { barangay: 'Bagong Ilog' });
    const risk = r.sections.find((s) => s.id === 'riskFindings');
    assert.ok(risk, 'riskFindings expected');
    assert.ok(risk.text.includes('The Random Forest risk model classifies **Bagong Ilog** as **High Risk**.'),
      `got: "${risk.text}"`);
    assert.ok(risk.text.includes('latest barangay-level assessment rather than the current filter selection'),
      'assessment-scope caveat must be retained');
    assert.ok(!risk.text.includes('of 30 barangays'), 'aggregate distribution must not be shown for a single barangay');
  });

  it('uses the barangay’s actual class (Low) verbatim', () => {
    const r = generateAnalyticsInsight(fullMetrics(), { barangay: 'Oranbo' });
    const risk = r.sections.find((s) => s.id === 'riskFindings');
    assert.ok(risk.text.includes('**Oranbo** as **Low Risk**'), `got: "${risk.text}"`);
  });

  it('omits Risk Findings when the selected barangay has no classification', () => {
    const r = generateAnalyticsInsight(fullMetrics(), { barangay: 'Barangay Without Score' });
    assert.ok(!r.sections.some((s) => s.id === 'riskFindings'));
  });

  it('omits Risk Findings when the risk metric is entirely unavailable', () => {
    const m = fullMetrics({ riskCounts: null, riskByBarangay: null, highRiskBarangays: null, unavailable: ['risk'] });
    const r = generateAnalyticsInsight(m, { barangay: 'Bagong Ilog' });
    assert.ok(!r.sections.some((s) => s.id === 'riskFindings'));
    assert.ok(r.sections.some((s) => s.id === 'overallSummary'), 'other sections must still render');
  });

  it('falls back to the aggregate distribution when no riskByBarangay map exists', () => {
    const m = fullMetrics({ riskByBarangay: undefined });
    const r = generateAnalyticsInsight(m, { barangay: 'Bagong Ilog' });
    const risk = r.sections.find((s) => s.id === 'riskFindings');
    assert.ok(risk && risk.text.includes('of 30 barangays'));
  });
});

// ==================== UNAVAILABLE METRICS / DEGRADATION ====================

describe('analytics NLG — unavailable metrics degrade per section', () => {
  it('omits Key Trend when trend is null and keeps the rest', () => {
    const r = generateAnalyticsInsight(fullMetrics({ trend: null, unavailable: ['trend'] }), {});
    assert.ok(!r.sections.some((s) => s.id === 'keyTrend'));
    assert.ok(r.sections.some((s) => s.id === 'treatment'));
    assertHeadingPoolSubset(r, 'trend null');
    assertProseHygiene(r, 'trend null');
  });

  it('omits Highest / Lowest when flagged unavailable', () => {
    const r = generateAnalyticsInsight(fullMetrics({ highestBarangay: null, lowestBarangay: null, unavailable: ['highestLowest'] }), {});
    assert.ok(!r.sections.some((s) => s.id === 'highestLowest'));
  });

  it('omits Significant Changes when significance is null', () => {
    const r = generateAnalyticsInsight(fullMetrics({ significantChanges: null, unavailable: ['significance'] }), {});
    assert.ok(!r.sections.some((s) => s.id === 'significantChanges'));
  });

  it('omits Demographics when demographics is null', () => {
    const r = generateAnalyticsInsight(fullMetrics({ demographics: null, unavailable: ['demographics'] }), {});
    assert.ok(!r.sections.some((s) => s.id === 'demographics'));
    assertProseHygiene(r, 'demographics null');
  });

  it('keeps Treatment but explains null TSR/CFR instead of inventing numbers', () => {
    const m = fullMetrics({
      treatment: { successRate: null, fatalityRate: null, cohortYear: null, cohortTotal: null, outcomeBreakdown: {} },
      unavailable: ['treatment', 'fatality'],
    });
    const r = generateAnalyticsInsight(m, {});
    const t = r.sections.find((s) => s.id === 'treatment');
    assert.ok(t, 'Treatment section expected');
    assert.ok(t.text.includes('cannot be calculated'), `got: "${t.text}"`);
    assert.ok(t.text.includes('unavailable'), `got: "${t.text}"`);
    assert.ok(!/\d+%/.test(t.text), `no invented percentage allowed: "${t.text}"`);
  });

  it('renders a metrics-unavailable summary when every supporting metric is missing', () => {
    const m = fullMetrics({
      trend: null,
      highestBarangay: null,
      lowestBarangay: null,
      significantChanges: null,
      riskCounts: null,
      riskByBarangay: null,
      highRiskBarangays: null,
      demographics: null,
      treatment: null,
      unavailable: ['trend', 'highestLowest', 'significance', 'risk', 'demographics', 'treatment', 'fatality'],
    });
    const r = generateAnalyticsInsight(m, {});
    assert.strictEqual(r.sections.length, 1);
    assert.strictEqual(r.sections[0].id, 'overallSummary');
    assert.ok(r.sections[0].text.includes('no supporting metrics could be computed'),
      `got: "${r.sections[0].text}"`);
    assertProseHygiene(r, 'all metrics unavailable');
  });

  it('a throwing section builder is isolated — only that section is dropped', () => {
    // Crash vector only the Treatment builder touches (cohortTotal formatting);
    // the overall summary reads only successRate/fatalityRate and must survive.
    const m = fullMetrics({
      treatment: {
        successRate: 81.1,
        fatalityRate: 2.6,
        cohortYear: 2025,
        get cohortTotal() { throw new Error('simulated builder crash'); },
        outcomeBreakdown: {},
      },
    });
    const r = generateAnalyticsInsight(m, {});
    assert.ok(!r.sections.some((s) => s.id === 'treatment'), 'crashing section must be dropped');
    assert.ok(r.sections.some((s) => s.id === 'keyTrend'), 'other sections must survive');
    assert.ok(r.sections.some((s) => s.id === 'overallSummary'));
    assertHeadingPoolSubset(r, 'builder crash');
  });
});

// ==================== PROSE HYGIENE ACROSS THE MATRIX ====================

describe('analytics NLG — prose hygiene across the filter matrix', () => {
  const filterCombos = [
    ['no filters', {}],
    ['year', { year: 2025 }],
    ['month', { year: 2025, month: 8 }],
    ['barangay', { barangay: 'Bagong Ilog' }],
    ['sex', { sex: 'Female' }],
    ['ageGroup', { ageGroup: '25-34' }],
    ['facility', { facility: 'Rizal Health Center' }],
    ['bacteriological', { bacteriological: 'smear' }],
    ['outcome', { outcome: 'CURED' }],
    ['combined', { year: 2025, barangay: 'Bagong Ilog', sex: 'Female' }],
    ['combined + age', { ageGroup: '0-14', sex: 'Male' }],
    ['all dimensions', { year: 2025, month: 8, barangay: 'Bagong Ilog', sex: 'Female', ageGroup: '25-34', facility: 'F', bacteriological: 'smear', outcome: 'CURED' }],
  ];

  for (const [name, filters] of filterCombos) {
    it(`produces clean prose for ${name}`, () => {
      const r = generateAnalyticsInsight(fullMetrics(), filters);
      assertProseHygiene(r, name);
      assertHeadingPoolSubset(r, name);
      assert.ok(r.meta.basedOn && r.meta.basedOn.length > 0, `${name}: basedOn empty`);
      const last = r.sections[r.sections.length - 1];
      assert.strictEqual(last.id, 'overallSummary', `${name}: last section must be Overall Summary`);
    });
  }
});
