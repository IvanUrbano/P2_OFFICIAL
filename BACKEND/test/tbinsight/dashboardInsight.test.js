/**
 * TBInsight — Dashboard Insight Unit Tests
 *
 * Covers the Dashboard's own metric builder and template NLG
 * (BACKEND/tbinsight/dashboardInsight.js), guarding the defects the Dashboard
 * audit confirmed:
 *
 *   - the insight response must expose a top-level `summary` (the Dashboard's
 *     headline panel reads it; the Analytics response has never had one, which
 *     is why the panel always fell back to placeholder copy);
 *   - the "N of M barangays" denominator is the ASSESSED count, never a
 *     hardcoded 30, and an unassessed barangay is never counted as Low Risk;
 *   - a missing metric stays unavailable (null / omitted section) and is never
 *     turned into 0;
 *   - year-over-year change is only computed between two adjacent years that
 *     both have usable month coverage, so an isolated single-record year is
 *     never used as a baseline and is never presented as a complete year;
 *   - a Baseline Forecast is never relabelled ARIMA, and an
 *     insufficient-history result produces no predictive wording;
 *   - one failing optional query does not fail the whole response.
 *
 * Mock pool only — no database required.
 * Run: node --test BACKEND/test/tbinsight/dashboardInsight.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  buildDashboardMetrics,
  generateDashboardInsight,
  MIN_MONTHS_FOR_COMPLETE_YEAR,
} = require('../../tbinsight/dashboardInsight');

// ==================== MOCK POOL ====================

/**
 * Routes each query to canned rows by matching a distinctive fragment of its
 * SQL. `fail` is a list of those same keys whose query should reject, used to
 * prove that an optional metric failing degrades instead of 500-ing.
 */
function createPool({
  monthly = [],
  yearly = [],
  risk = [],
  forecast = [],
  totals = { total_cases: 0, barangays_with_data: 0, months_covered: 0, earliest_date: null, latest_date: null },
  onTreatment = 0,
  tsr = { total_patients: 0, cured_count: 0, completed_count: 0 },
  cfr = { evaluated: 0, died: 0 },
  cfrTotal = 0,
  fail = [],
} = {}) {
  const calls = [];
  const maybeFail = (key) => {
    if (fail.includes(key)) throw new Error(`simulated ${key} failure`);
  };
  return {
    calls,
    query: async (sql, params) => {
      const s = String(sql);
      calls.push({ sql: s, params });

      // Markers are chosen to be mutually exclusive, and the most specific
      // are tested first: 'AS total_cases' also contains the substring
      // 'AS total', so the bare-total branch must use a word boundary and
      // must not be reached before the summary branch.
      if (s.includes('AS year') && s.includes('AS months_covered')) {
        maybeFail('yearly'); return { rows: yearly };
      }
      if (s.includes('barangay_risk_scores')) {
        maybeFail('risk'); return { rows: risk };
      }
      if (s.includes('model_predictions')) {
        maybeFail('forecast'); return { rows: forecast };
      }
      if (s.includes('AS on_treatment')) {
        maybeFail('onTreatment'); return { rows: [{ on_treatment: onTreatment }] };
      }
      if (s.includes('AS total_patients')) {
        maybeFail('tsr'); return { rows: [tsr] };
      }
      if (s.includes('AS evaluated')) {
        maybeFail('cfr'); return { rows: [cfr] };
      }
      if (s.includes('AS total_cases')) {
        maybeFail('totals'); return { rows: [totals] };
      }
      if (/AS total/.test(s)) {
        return { rows: [{ total: cfrTotal }] };
      }
      if (s.includes("DATE_TRUNC('month'")) {
        maybeFail('monthly'); return { rows: monthly };
      }
      return { rows: [] };
    },
  };
}

/** A fully healthy dataset mirroring the live shape (2022 isolated record). */
function healthyOptions(overrides = {}) {
  const monthly = [];
  // 2025 and 2024: 12 months each. Newest first, as the query orders them.
  for (let m = 12; m >= 1; m -= 1) monthly.push({ month: `2025-${String(m).padStart(2, '0')}-01`, case_count: 100 });
  for (let m = 12; m >= 1; m -= 1) monthly.push({ month: `2024-${String(m).padStart(2, '0')}-01`, case_count: 90 });
  return {
    monthly,
    yearly: [
      { year: 2022, case_count: 1, months_covered: 1 },
      { year: 2024, case_count: 1080, months_covered: 12 },
      { year: 2025, case_count: 1200, months_covered: 12 },
    ],
    risk: [
      ...Array.from({ length: 12 }, (_, i) => ({ barangay_name: `High${i + 1}`, risk_class: 'High', model_type: 'random_forest', period_year: 2026 })),
      ...Array.from({ length: 17 }, (_, i) => ({ barangay_name: `Low${i + 1}`, risk_class: 'Low', model_type: 'random_forest', period_year: 2026 })),
      { barangay_name: 'Med1', risk_class: 'Medium', model_type: 'random_forest', period_year: 2026 },
    ],
    forecast: Array.from({ length: 30 }, (_, i) => ({
      barangay_name: `B${i + 1}`, forecasted_count: 14.31, method: 'arima', period_year: 2026, period_month: 3,
    })),
    totals: { total_cases: 15313, barangays_with_data: 30, months_covered: 37, earliest_date: '2022-11-20', latest_date: '2025-12-29' },
    onTreatment: 2870,
    tsr: { total_patients: 5463, cured_count: 1002, completed_count: 3051 },
    cfr: { evaluated: 11948, died: 268 },
    cfrTotal: 15313,
    ...overrides,
  };
}

// ==================== TOTALS & SCOPE ====================

describe('buildDashboardMetrics — totals', () => {
  it('reports the total case count from tb_cases', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions()));
    assert.strictEqual(m.summary.totalCases, 15313);
    assert.strictEqual(m.summary.monthsCovered, 37);
  });

  it('counts every record without a status/outcome exclusion', async () => {
    // The total is COUNT(*) over tb_cases: the outcome breakdown excludes
    // non-approved values for DISPLAY, but the headline total must not.
    const pool = createPool(healthyOptions());
    await buildDashboardMetrics(pool);
    const totalQuery = pool.calls.find((c) => c.sql.includes('AS total_cases'));
    assert.ok(totalQuery, 'total query was issued');
    assert.ok(!/outcome_status/.test(totalQuery.sql), 'total is not filtered by outcome_status');
  });
});

// ==================== ON TREATMENT ====================

describe('buildDashboardMetrics — ON TREATMENT', () => {
  it('counts the source-aligned ON TREATMENT status only', async () => {
    const pool = createPool(healthyOptions());
    const m = await buildDashboardMetrics(pool);
    assert.strictEqual(m.treatment.onTreatment, 2870);
    const q = pool.calls.find((c) => c.sql.includes('AS on_treatment'));
    assert.match(q.sql, /case_status\s*=\s*'ON TREATMENT'/);
    // DIAGNOSED and NOT EVALUATED must not be folded into ON TREATMENT.
    assert.ok(!/DIAGNOSED/.test(q.sql), 'DIAGNOSED is not counted as on treatment');
    assert.ok(!/NOT EVALUATED/.test(q.sql), 'NOT EVALUATED is not counted as on treatment');
  });
});

// ==================== TSR (COHORT) ====================

describe('buildDashboardMetrics — Treatment Success Rate', () => {
  it('uses the previous-year treatment-start cohort', async () => {
    const pool = createPool(healthyOptions());
    const m = await buildDashboardMetrics(pool);
    // (1002 + 3051) / 5463 = 74.2%
    assert.strictEqual(m.treatment.successRate, 74.2);
    assert.strictEqual(m.treatment.cohortTotal, 5463);
    assert.strictEqual(m.treatment.cohortYear, new Date().getFullYear() - 1);
    const q = pool.calls.find((c) => c.sql.includes('AS total_patients'));
    assert.match(q.sql, /date_started_treatment/, 'cohort is keyed on treatment start date');
  });

  it('returns null (never 0) when the cohort is empty', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions({
      tsr: { total_patients: 0, cured_count: 0, completed_count: 0 },
    })));
    assert.strictEqual(m.treatment.successRate, null);
  });
});

// ==================== CFR ====================

describe('buildDashboardMetrics — Case Fatality Rate', () => {
  it('uses the shared evaluated-terminal-outcome denominator', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions()));
    // 268 / 11948 = 2.2%
    assert.strictEqual(m.treatment.fatalityRate, 2.2);
    assert.strictEqual(m.treatment.fatalityDied, 268);
    assert.strictEqual(m.treatment.fatalityEvaluated, 11948);
  });

  it('returns null (never 0%) when the denominator is empty', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions({
      cfr: { evaluated: 0, died: 0 },
    })));
    assert.strictEqual(m.treatment.fatalityRate, null);

    const insight = generateDashboardInsight(m);
    const treatment = insight.sections.find((s) => s.id === 'treatmentPerformance');
    assert.match(treatment.text, /Case Fatality Rate is unavailable/);
    assert.ok(!/Case Fatality Rate.*\b0%/.test(treatment.text), 'never states a 0% CFR');
  });
});

// ==================== RISK CLASSIFICATION ====================

describe('buildDashboardMetrics — Random Forest risk', () => {
  it('counts High Risk from the persisted classification', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions()));
    assert.strictEqual(m.riskCounts.high, 12);
    assert.strictEqual(m.riskCounts.assessed, 30);
    assert.strictEqual(m.riskCounts.noData, 0);
  });

  it('reports the snapshot period year as the assessment year (same as the GIS pages)', async () => {
    // A snapshot stored at period 2026-10-01, trained on data through September 2026, is the
    // 2026 assessment. It used to be shown as "2025" (period year minus one).
    const m = await buildDashboardMetrics(createPool(healthyOptions()));
    assert.strictEqual(m.riskCounts.assessmentYear, 2026);
    const text = generateDashboardInsight(m).sections.find((s) => s.id === 'riskSituation').text;
    assert.match(text, /\(2026 assessment\)/);
    assert.ok(!/2025 assessment/.test(text));
  });

  it('excludes unassessed barangays from the denominator instead of calling them Low Risk', async () => {
    const opts = healthyOptions();
    const risk = [
      ...opts.risk.slice(0, 13),
      { barangay_name: 'Unassessed1', risk_class: null, model_type: null, period_year: 2026 },
      { barangay_name: 'Unassessed2', risk_class: 'No Data', model_type: null, period_year: 2026 },
    ];
    const m = await buildDashboardMetrics(createPool(healthyOptions({ risk })));
    assert.strictEqual(m.riskCounts.assessed, 13, 'only classified barangays count');
    assert.strictEqual(m.riskCounts.noData, 2);
    assert.strictEqual(m.riskCounts.low, 1, 'unassessed rows are not counted as Low');

    const text = generateDashboardInsight(m).sections.find((s) => s.id === 'riskSituation').text;
    assert.match(text, /of \*\*13\*\* assessed barangays/, 'denominator is the assessed count');
    assert.ok(!/of \*\*30\*\*/.test(text), 'never hardcodes 30');
    assert.match(text, /No Assessment/, 'unassessed barangays are named as such');
  });

  it('reports risk unavailable (not zero High Risk) when nothing is classified', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions({ risk: [] })));
    assert.strictEqual(m.riskCounts, null);
    assert.ok(m.unavailable.includes('risk'));

    const text = generateDashboardInsight(m).sections.find((s) => s.id === 'riskSituation').text;
    assert.match(text, /No Random Forest risk classification is available/);
    assert.ok(!/\b0\b.*High Risk/.test(text), 'does not claim zero High Risk barangays');
  });

  it('distinguishes a genuine zero-High-Risk result from a missing assessment', async () => {
    const risk = Array.from({ length: 30 }, (_, i) => ({
      barangay_name: `B${i + 1}`, risk_class: 'Low', model_type: 'random_forest', period_year: 2026,
    }));
    const m = await buildDashboardMetrics(createPool(healthyOptions({ risk })));
    assert.strictEqual(m.riskCounts.high, 0);
    assert.strictEqual(m.riskCounts.assessed, 30);
    const text = generateDashboardInsight(m).sections.find((s) => s.id === 'riskSituation').text;
    assert.match(text, /no barangays/i);
    assert.match(text, /30 assessed/);
  });
});

// ==================== YEAR COVERAGE & YoY ====================

describe('buildDashboardMetrics — annual coverage and YoY', () => {
  it('computes YoY between the two latest adjacent complete years', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions()));
    assert.strictEqual(m.annual.latestCompleteYear, 2025);
    assert.strictEqual(m.annual.previousYear, 2024);
    // (1200 - 1080) / 1080 = 11.1%
    assert.strictEqual(m.annual.yoyChangePercent, 11.1);
  });

  it('flags a single-record year as incomplete without dropping its cases', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions()));
    assert.deepStrictEqual(m.annual.incompleteYears, [2022]);
    // The isolated record is still present in the year list and in the total.
    assert.ok(m.annual.years.some((y) => y.year === 2022 && y.cases === 1));
    assert.strictEqual(m.summary.totalCases, 15313);
    // ...and 2022 is never treated as a usable reporting year.
    assert.strictEqual(m.annual.years.find((y) => y.year === 2022).complete, false);
  });

  it('reports YoY unavailable rather than comparing against an incomplete year', async () => {
    // Only 2022 (isolated) and 2023 exist: 2023 has no usable baseline.
    const m = await buildDashboardMetrics(createPool(healthyOptions({
      yearly: [
        { year: 2022, case_count: 1, months_covered: 1 },
        { year: 2023, case_count: 4494, months_covered: 12 },
      ],
    })));
    assert.strictEqual(m.annual.latestCompleteYear, 2023);
    assert.strictEqual(m.annual.yoyChangePercent, null, 'no YoY against an isolated record');
    assert.match(m.annual.yoyUnavailableReason, /baseline/);

    const text = generateDashboardInsight(m).sections.find((s) => s.id === 'caseActivity').text;
    assert.match(text, /year-over-year comparison is not available/i);
  });

  it('does not compare two non-adjacent complete years as a year-over-year change', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions({
      yearly: [
        { year: 2023, case_count: 4494, months_covered: 12 },
        { year: 2024, case_count: 10, months_covered: 1 },
        { year: 2025, case_count: 5440, months_covered: 12 },
      ],
    })));
    assert.strictEqual(m.annual.latestCompleteYear, 2025);
    assert.strictEqual(m.annual.yoyChangePercent, null);
    assert.match(m.annual.yoyUnavailableReason, /2024/);
  });

  it('compares a year still in progress with the SAME months of the year before, never its full total', async () => {
    // Live shape: 2026 has data through September (3,264 cases); Jan–Sep 2025 was 3,284 of 4,326.
    const m = await buildDashboardMetrics(createPool(healthyOptions({
      yearly: [
        { year: 2024, case_count: 4284, months_covered: 12, last_month: 12, ytd_cases: 3273 },
        { year: 2025, case_count: 4326, months_covered: 12, last_month: 12, ytd_cases: 3284 },
        { year: 2026, case_count: 3264, months_covered: 9, last_month: 9, ytd_cases: 3264 },
      ],
    })));
    assert.strictEqual(m.annual.inProgressYear, 2026);
    assert.deepStrictEqual(m.annual.yearToDate, {
      year: 2026, throughMonth: 9, cases: 3264, priorYear: 2025, priorCases: 3284, changePercent: -0.6,
    });
    // The full-year comparison now runs between the two years that actually ran to December.
    assert.strictEqual(m.annual.latestCompleteYear, 2025);
    assert.strictEqual(m.annual.previousYear, 2024);
    assert.strictEqual(m.annual.yoyChangePercent, 1);

    const insight = generateDashboardInsight(m);
    const text = insight.sections.find((s) => s.id === 'caseActivity').text;
    assert.match(text, /Year to date \(January–September\), \*\*2026\*\* recorded \*\*3,264\*\* cases/);
    assert.match(text, /about the same as\*\* the same months of 2025 \(3,284 cases\)/);   // -0.6%: under 1%
    assert.ok(!/24\.5%/.test(text), 'the false "24.5% lower" is gone');
    assert.match(insight.meta.basedOn, /2026 is year to date \(through September\)/);
  });

  it('says "about the same" when the year-to-date change is under 1%', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions({
      yearly: [
        { year: 2025, case_count: 4326, months_covered: 12, last_month: 12, ytd_cases: 3284 },
        { year: 2026, case_count: 3270, months_covered: 9, last_month: 9, ytd_cases: 3270 },
      ],
    })));
    const text = generateDashboardInsight(m).sections.find((s) => s.id === 'caseActivity').text;
    assert.match(text, /\*\*about the same as\*\* the same months of 2025/);
  });

  it('states when the same months of the previous year are not available', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions({
      yearly: [{ year: 2026, case_count: 900, months_covered: 8, last_month: 8, ytd_cases: 900 }],
    })));
    assert.strictEqual(m.annual.yearToDate.changePercent, undefined);
    const text = generateDashboardInsight(m).sections.find((s) => s.id === 'caseActivity').text;
    assert.match(text, /not available for comparison/);
    assert.ok(!/% (higher|lower) than/.test(text.split('**2026**')[1] || ''));
  });

  it('a year that runs to December is still compared year over year', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions()));
    assert.strictEqual(m.annual.yearToDate, null);
    assert.strictEqual(m.annual.inProgressYear, null);
  });

  it('treats the completeness threshold as a month-coverage rule', () => {
    assert.strictEqual(typeof MIN_MONTHS_FOR_COMPLETE_YEAR, 'number');
    assert.ok(MIN_MONTHS_FOR_COMPLETE_YEAR > 1, 'a single month is never a complete year');
  });
});

// ==================== TREND ====================

describe('buildDashboardMetrics — trend', () => {
  it('compares the most recent 3 months against the preceding 3', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions()));
    assert.strictEqual(m.trend.recentCount, 300);
    assert.strictEqual(m.trend.priorCount, 300);
    assert.strictEqual(m.trend.direction, 'stable');
  });

  it('returns no trend (not a 0% change) when there is no prior window', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions({
      monthly: [{ month: '2025-12-01', case_count: 10 }],
    })));
    assert.strictEqual(m.trend, null);
  });
});

// ==================== FORECAST TIERS ====================

describe('buildDashboardMetrics — forecast tiers', () => {
  it('labels an all-ARIMA period as an ARIMA Forecast', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions()));
    assert.strictEqual(m.forecast.tier, 'arima');
    assert.strictEqual(m.forecast.tierLabel, 'ARIMA Forecast');
    // 30 × 14.31 = 429.3, summed raw then rounded once.
    assert.strictEqual(m.forecast.total, 429);
  });

  it('never relabels a fallback method as ARIMA: a forecast with no ARIMA barangay is a Baseline Forecast', async () => {
    const forecast = [
      { barangay_name: 'A', forecasted_count: 10, method: 'seasonal-naive-fallback', period_year: 2026, period_month: 3 },
      { barangay_name: 'B', forecasted_count: 5, method: 'seasonal-naive-fallback', period_year: 2026, period_month: 3 },
    ];
    const m = await buildDashboardMetrics(createPool(healthyOptions({ forecast })));
    assert.strictEqual(m.forecast.tier, 'baseline');
    assert.strictEqual(m.forecast.tierLabel, 'Baseline Forecast');

    const text = generateDashboardInsight(m).sections.find((s) => s.id === 'forecastSignal').text;
    assert.match(text, /Baseline Forecast/);
    assert.match(text, /not ARIMA/);
    assert.ok(!/fewer than 24/.test(text), 'the 24-observation claim is gone');
  });

  it('one sparse barangay does not relabel the whole forecast: ARIMA for most, named exceptions', async () => {
    // Live shape: 28 ARIMA barangays (359 cases) and 2 sparse ones on exponential smoothing (0.6).
    const forecast = [
      ...Array.from({ length: 28 }, (_, i) => ({ barangay_name: `B${i + 1}`, forecasted_count: 359 / 28, method: 'arima', period_year: 2026, period_month: 10 })),
      { barangay_name: 'Bagong Katipunan', forecasted_count: 0.13, method: 'exponential_smoothing', period_year: 2026, period_month: 10 },
      { barangay_name: 'Santa Rosa', forecasted_count: 0.47, method: 'exponential_smoothing', period_year: 2026, period_month: 10 },
    ];
    const m = await buildDashboardMetrics(createPool(healthyOptions({ forecast })));
    assert.strictEqual(m.forecast.tier, 'mixed');
    assert.strictEqual(m.forecast.tierLabel, 'ARIMA Forecast');
    assert.strictEqual(m.forecast.arimaBarangays, 28);
    assert.deepStrictEqual(m.forecast.fallbackBarangays, ['Bagong Katipunan', 'Santa Rosa']);
    assert.strictEqual(m.forecast.fallbackTotal, 0.6);

    const text = generateDashboardInsight(m).sections.find((s) => s.id === 'forecastSignal').text;
    assert.match(text, /\*\*ARIMA Forecast\*\*/);
    assert.match(text, /28 barangay\(s\) use ARIMA/);
    assert.match(text, /Bagong Katipunan, Santa Rosa/);
    assert.match(text, /too sparse for ARIMA/);
    assert.ok(!/Baseline Forecast/.test(text));
    assert.ok(!/fewer than 24/.test(text));
  });

  it('reads ONE forecast month: the first one after the latest recorded case', async () => {
    const pool = createPool(healthyOptions());
    await buildDashboardMetrics(pool);
    const q = pool.calls.find((c) => c.sql.includes('model_predictions'));
    assert.match(q.sql, /SELECT MIN\(period\) FROM model_predictions/);
    assert.match(q.sql, /period > \(SELECT MAX\(date_of_diagnosis\)/);
    assert.match(q.sql, /SELECT MAX\(period\) FROM model_predictions/, 'falls back to the newest period');
  });

  it('produces no predictive wording when history is insufficient', async () => {
    const forecast = [
      { barangay_name: 'A', forecasted_count: 0, method: 'insufficient_data', period_year: 2026, period_month: 3 },
    ];
    const m = await buildDashboardMetrics(createPool(healthyOptions({ forecast })));
    assert.strictEqual(m.forecast.tier, 'insufficient_data');
    assert.strictEqual(m.forecast.total, null, 'no fabricated forecast total');

    const text = generateDashboardInsight(m).sections.find((s) => s.id === 'forecastSignal').text;
    assert.match(text, /Insufficient Historical Data/);
    assert.ok(!/projects/.test(text), 'no projection is stated');
  });

  it('omits the forecast section entirely when no forecast rows exist', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions({ forecast: [] })));
    assert.strictEqual(m.forecast, null);
    const insight = generateDashboardInsight(m);
    assert.ok(!insight.sections.some((s) => s.id === 'forecastSignal'));
    // The other findings survive.
    assert.ok(insight.sections.some((s) => s.id === 'riskSituation'));
    assert.ok(insight.summary);
  });
});

// ==================== NLG SHAPE & PARTIAL AVAILABILITY ====================

describe('generateDashboardInsight — response shape', () => {
  it('exposes a top-level summary string', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions()));
    const insight = generateDashboardInsight(m);
    assert.strictEqual(insight.type, 'dashboard');
    assert.strictEqual(typeof insight.summary, 'string');
    assert.ok(insight.summary.length > 0, 'summary is not empty');
  });

  it('is concise — not the seven-section Analytics narrative', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions()));
    const insight = generateDashboardInsight(m);
    assert.ok(insight.sections.length <= 5, `expected at most 5 sections, got ${insight.sections.length}`);
    const ids = insight.sections.map((s) => s.id);
    // None of the Analytics-only section ids leak in.
    for (const analyticsOnly of ['highestLowest', 'significantChanges', 'demographics', 'overallSummary']) {
      assert.ok(!ids.includes(analyticsOnly), `${analyticsOnly} belongs to Analytics, not the Dashboard`);
    }
  });

  it('declares itself template-based NLG', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions()));
    assert.strictEqual(generateDashboardInsight(m).meta.method, 'template-nlg');
  });

  it('still reports valid findings when one metric is unavailable', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions({ fail: ['risk'] })));
    assert.ok(m.unavailable.includes('risk'));
    const insight = generateDashboardInsight(m);
    // Treatment and trend findings survive a risk failure.
    assert.ok(insight.sections.some((s) => s.id === 'treatmentPerformance'));
    assert.ok(insight.sections.some((s) => s.id === 'caseActivity'));
    assert.ok(insight.summary);
  });

  it('survives several simultaneous optional failures', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions({
      fail: ['risk', 'forecast', 'yearly'],
    })));
    const insight = generateDashboardInsight(m);
    assert.ok(insight.sections.length > 0, 'some finding is still produced');
    assert.ok(insight.summary);
    for (const key of ['risk', 'forecast', 'annual']) {
      assert.ok(insight.meta.unavailable.includes(key), `${key} is reported unavailable`);
    }
  });

  it('reports no-data cleanly when there are no records at all', async () => {
    const m = await buildDashboardMetrics(createPool({
      totals: { total_cases: 0, barangays_with_data: 0, months_covered: 0, earliest_date: null, latest_date: null },
    }));
    const insight = generateDashboardInsight(m);
    assert.strictEqual(insight.sections.length, 0);
    assert.match(insight.summary, /No TB records are available/);
  });

  it('never prints a metric as 0 when it is unavailable', async () => {
    const m = await buildDashboardMetrics(createPool(healthyOptions({
      tsr: { total_patients: 0, cured_count: 0, completed_count: 0 },
      cfr: { evaluated: 0, died: 0 },
      risk: [],
      forecast: [],
    })));
    const insight = generateDashboardInsight(m);
    const all = [insight.summary, ...insight.sections.map((s) => s.text)].join(' ');
    assert.ok(!/Treatment Success Rate is \*\*0/.test(all));
    assert.ok(!/Case Fatality Rate.*is \*\*0/.test(all));
    assert.match(all, /cannot be calculated|unavailable/i);
  });
});

// ==================== READ-ONLY GUARANTEE ====================

describe('buildDashboardMetrics — read-only', () => {
  it('issues only read queries (no model rerun or write on a Dashboard load)', async () => {
    const pool = createPool(healthyOptions());
    await buildDashboardMetrics(pool);
    assert.ok(pool.calls.length > 0);
    for (const { sql } of pool.calls) {
      assert.ok(
        /^\s*(WITH|SELECT)/i.test(sql.trim()),
        `expected a read-only query, got: ${sql.trim().slice(0, 60)}`
      );
      assert.ok(
        !/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP)\b/i.test(sql),
        'no write statement is issued'
      );
    }
  });

  it('reads persisted model output rather than invoking a model', async () => {
    const pool = createPool(healthyOptions());
    await buildDashboardMetrics(pool);
    assert.ok(pool.calls.some((c) => c.sql.includes('barangay_risk_scores')), 'RF class read from its table');
    assert.ok(pool.calls.some((c) => c.sql.includes('model_predictions')), 'forecast read from its table');
  });
});

describe('generateDashboardInsight — map interpretation', () => {
  const base = (over) => ({
    summary: { totalCases: 100 },
    riskCounts: { high: 4, medium: 3, low: 2, noData: 0, assessed: 9, assessmentYear: 2026 },
    highRiskBarangays: ['A', 'B', 'C', 'D'],
    mapPattern: { clusters: [['A', 'B', 'C']], isolated: ['D'] },
    unavailable: [],
    ...over,
  });
  const text = (m) => generateDashboardInsight(m).sections.find((s) => s.id === 'mapInterpretation')?.text;

  it('describes the connected High Risk group and isolated barangays', () => {
    const t = text(base());
    assert.match(t, /\*\*3\*\* of the \*\*4\*\* High Risk barangays are connected/);
    assert.match(t, /A, B, C/);
    assert.match(t, /High Risk without a High Risk neighbour: D/);
  });

  it('says scattered when no High Risk barangays touch', () => {
    const t = text(base({ mapPattern: { clusters: [], isolated: ['A', 'B', 'C', 'D'] } }));
    assert.match(t, /scattered/);
  });

  it('makes no spatial claim when border data is unavailable', () => {
    assert.strictEqual(text(base({ mapPattern: null })), undefined);
  });

  it('reports no High Risk area when none exist', () => {
    const t = text(base({ riskCounts: { high: 0, medium: 3, low: 6, noData: 0, assessed: 9, assessmentYear: 2026 }, highRiskBarangays: [] }));
    assert.match(t, /No barangay is classified High Risk/);
  });
});
