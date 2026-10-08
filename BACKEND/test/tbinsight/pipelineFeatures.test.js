/**
 * TBInsight — Pipeline feature-building tests (calendar, RF training rows)
 *
 * Pure logic only: the DB module is stubbed, so no database or ML service is needed.
 * Run: node --test BACKEND/test/tbinsight/pipelineFeatures.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
let mockQueryFn = async () => ({ rows: [] });

const dbPath = require.resolve('../../db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { query: (...args) => mockQueryFn(...args), connect: async () => ({}) },
};

const {
  buildDenseSeries, buildTrainingRows, buildFeatureRow, addCrossSectionFeatures, dropUnfinishedMonth,
  _featureWindow, _neighborRisksAt,
  _uniformPopMapByYear, _popFor, _popForFeature, _resolveClassification, _ruleBasedClassify,
  _mergeClassifications,
  runHistoricalSnapshots,
} = require('../../tbinsight/pipeline');
const { monthKey, classifyByTertile } = require('../../tbinsight/scoring');

// pg returns DATE columns as JS Dates at local midnight
const localDate = (y, m) => new Date(y, m - 1, 1);

describe('historical RF backfill', () => {
  it('does not duplicate the current 2026 assessment built from 2025 data', async () => {
    const calls = [];
    mockQueryFn = async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM monthly_case_summary')) return { rows: Array.from({ length: 12 }, (_, i) => ({
        barangay_name: 'A', month: localDate(2025, i + 1), case_count: 1,
      })) };
      if (sql.includes('FROM model_metadata')) return { rows: [{ assessment_period: '2026-01-01', data_end: '2025-12-01' }] };
      if (sql.includes('FROM barangay_risk_scores')) return { rows: [{ present: true }] };
      throw new Error(`Unexpected query: ${sql}`);
    };
    try {
      const result = await runHistoricalSnapshots();
      assert.strictEqual(result.length, 1);
      assert.deepStrictEqual({
        data_year: result[0].data_year,
        assessment_year: result[0].assessment_year,
        assessment_period: result[0].assessment_period,
        prediction_period: result[0].prediction_period,
        status: result[0].status,
      }, { data_year: 2025, assessment_year: 2026, assessment_period: '2026-01-01',
        prediction_period: '2026-01-01', status: 'skipped' });
      assert.strictEqual(calls.length, 3);
    } finally {
      mockQueryFn = async () => ({ rows: [] });
    }
  });
});

describe('_mergeClassifications', () => {
  it('keeps valid RF predictions and uses rules only for missing barangays', () => {
    const rows = [
      { barangay_name: 'A', features: { rolling_12m_incidence: 10 } },
      { barangay_name: 'B', features: { rolling_12m_incidence: 100 } },
    ];
    const rf = [{ barangay_name: 'A', risk_class: 'High', proba: { Low: 0.1, Medium: 0.1, High: 0.8 } }];
    const result = _mergeClassifications(rows, rf, 'random_forest', { low_max: 30, med_max: 60 });
    assert.strictEqual(result.method, 'mixed');
    assert.strictEqual(result.fallbackCount, 1);
    assert.strictEqual(result.byName.A.model_type, 'random_forest');
    assert.strictEqual(result.byName.A.risk_class, 'High');
    assert.strictEqual(result.byName.B.model_type, 'rule_based');
    assert.strictEqual(_resolveClassification(result.byName.B, result.byName.B.model_type).classification_confidence, null);
  });
  it('keeps an all-RF snapshot model-classified', () => {
    const rows = [{ barangay_name: 'A', features: { rolling_12m_incidence: 10 } }];
    const rf = [{ barangay_name: 'A', risk_class: 'High', proba: { Low: 0.1, Medium: 0.1, High: 0.8 } }];
    const result = _mergeClassifications(rows, rf, 'random_forest', { low_max: 30, med_max: 60 });
    assert.strictEqual(result.method, 'random_forest');
    assert.strictEqual(result.byName.A.model_type, 'random_forest');
    assert.strictEqual(_resolveClassification(result.byName.A, result.byName.A.model_type).classification_confidence, 0.8);
  });
});

function rowsFor(counts) {
  // counts: {name: [c1, c2, ...]} starting Jan 2025; 0 entries are omitted (as in monthly_case_summary)
  const rows = [];
  for (const [name, list] of Object.entries(counts)) {
    list.forEach((c, i) => {
      if (c > 0) rows.push({ barangay_name: name, month: localDate(2025, i + 1), case_count: c });
    });
  }
  return rows;
}

describe('monthKey', () => {
  it('uses the local calendar month regardless of timezone offset', () => {
    assert.strictEqual(monthKey(localDate(2025, 12)), '2025-12-01');
    assert.strictEqual(monthKey(localDate(2026, 1)), '2026-01-01');
  });

  it('normalizes date strings to the first of the month', () => {
    assert.strictEqual(monthKey('2025-11-30'), '2025-11-01');
  });
});

describe('buildDenseSeries', () => {
  it('zero-fills months with no cases on a shared calendar', () => {
    const rows = rowsFor({ A: [5, 0, 7, 6, 5, 4, 6, 7, 5, 6, 4, 5], B: [3, 3, 0, 0, 2, 3, 3, 2, 3, 3, 2, 3] });
    const { calendar, seriesByBarangay } = buildDenseSeries(rows, ['A', 'B', 'C']);
    assert.strictEqual(calendar.length, 12);
    assert.strictEqual(calendar[0], '2025-01-01');
    assert.strictEqual(calendar[11], '2025-12-01');
    assert.deepStrictEqual(seriesByBarangay.A.map(p => p.case_count).slice(0, 3), [5, 0, 7]);
    assert.strictEqual(seriesByBarangay.B[2].case_count, 0);
    // Barangay with no data still gets an all-zero series
    assert.ok(seriesByBarangay.C.every(p => p.case_count === 0));
    assert.strictEqual(seriesByBarangay.C.length, 12);
  });

  it('drops stray leading months from old imports', () => {
    const rows = rowsFor({ A: Array(12).fill(30) });
    rows.push({ barangay_name: 'A', month: new Date(2022, 10, 1), case_count: 1 });
    rows.push({ barangay_name: 'A', month: new Date(2024, 2, 1), case_count: 1 });
    const { calendar } = buildDenseSeries(rows, ['A']);
    assert.strictEqual(calendar[0], '2025-01-01');
    assert.strictEqual(calendar.length, 12);
  });

  it('returns nothing for empty input', () => {
    const { calendar, seriesByBarangay } = buildDenseSeries([], ['A']);
    assert.deepStrictEqual(calendar, []);
    assert.deepStrictEqual(seriesByBarangay, {});
  });
});

describe('buildTrainingRows', () => {
  const twelve = (level) => Array(12).fill(level);
  const build = (counts, pops) => {
    const { seriesByBarangay } = buildDenseSeries(rowsFor(counts), Object.keys(counts));
    // Convert flat {name: number} to {name: {population, available}} format
    const popMap = {};
    for (const [name, pop] of Object.entries(pops)) {
      popMap[name] = { population: pop, available: true };
    }
    // Uniform across years: these tests exercise window/lag/neighbor/seasonality
    // mechanics, not year-matching, so the same population applies regardless
    // of which calendar year a synthetic series lands on.
    return buildTrainingRows(seriesByBarangay, _uniformPopMapByYear(popMap));
  };

  it('yields rows from 12 months of history (window shrinks to 6)', () => {
    const rows = build({ A: twelve(10), B: twelve(5) }, { A: 100000, B: 100000 });
    // 12 months, window 6 -> 6 target months, minus the last 2 that lack a full
    // 3-month forward label window (LABEL_HORIZON_MONTHS) -> 4 x 2 barangays
    assert.strictEqual(rows.length, 8);
  });

  it('returns no rows when history is too short', () => {
    assert.strictEqual(build({ A: [1, 2, 3], B: [1, 2, 3] }, { A: 1000, B: 1000 }).length, 0);
  });

  it('annualizes rolling_12m_incidence once, in the same units as the label', () => {
    const rows = build({ A: twelve(10), B: twelve(10) }, { A: 100000, B: 100000 });
    // 10 cases/month in 100k people -> 10 * 12 = 120 per 100k per year
    for (const r of rows) {
      assert.ok(Math.abs(r.features.rolling_12m_incidence - 120) < 1e-9);
      assert.ok(Math.abs(r.incidence - 120) < 1e-9);
    }
  });

  it('normalizes neighbor_risk to [0, 1] within each month', () => {
    const rows = build(
      { A: twelve(40), B: twelve(10), C: twelve(5) },
      { A: 100000, B: 100000, C: 100000 }
    );
    for (const r of rows) {
      assert.ok(r.features.neighbor_risk >= 0 && r.features.neighbor_risk <= 1);
    }
    // In every month the barangay with the LOWEST own incidence has the highest neighbor risk
    const lowest = rows.filter(r => r.incidence === 5 * 12 / 100000 * 100000);
    assert.ok(lowest.length > 0 && lowest.every(r => r.features.neighbor_risk === 1));
  });

  it('uses consecutive calendar months for lag features despite gaps', () => {
    const counts = {
      A: [4, 0, 6, 0, 8, 0, 10, 0, 12, 0, 14, 0],
      B: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    };
    const rows = build(counts, { A: 1000, B: 1000 });
    // First target month is index 6 (window 6): lag_1m is month 5 (=0), lag_2m month 4 (=8).
    // Lags are annualized incidence: 8 cases / 1,000 people -> 8 * 12 / 1000 * 100k = 96,000.
    const asIncidence = cases => (cases * 12 / 1000) * 100000;
    const first = rows.find(r => r.barangay_name === 'A' && r.features.lag_2m === asIncidence(8));
    assert.ok(first, 'lag_2m should read the calendar month two back, zeros included');
    assert.strictEqual(first.features.lag_1m, 0);
    assert.strictEqual(first.features.lag_3m, 0);
  });

  it('expresses lags as incidence, so equal counts in unequal populations differ', () => {
    const rows = build({ A: twelve(5), B: twelve(5) }, { A: 1000, B: 100000 });
    const a = rows.find(r => r.barangay_name === 'A');
    const b = rows.find(r => r.barangay_name === 'B' && r.month === a.month);
    assert.ok(Math.abs(a.features.lag_1m - 100 * b.features.lag_1m) < 1e-6);
    assert.strictEqual(a.features.incidence_3m, a.features.lag_1m);
  });

  it('ranks barangays against each other within the month', () => {
    const rows = build({ A: twelve(40), B: twelve(10), C: twelve(5) }, { A: 100000, B: 100000, C: 100000 });
    const month = rows[0].month;
    const at = name => rows.find(r => r.barangay_name === name && r.month === month).features;
    assert.deepStrictEqual([at('C').incidence_rank, at('B').incidence_rank, at('A').incidence_rank], [0, 0.5, 1]);
    assert.deepStrictEqual([at('C').prev_category, at('B').prev_category, at('A').prev_category], [0, 1, 2]);
  });

  it('emits rows month-major so walk-forward evaluation can group by month', () => {
    const rows = build({ A: twelve(10), B: twelve(20) }, { A: 100000, B: 100000 });
    // Pairs (A, B) per month: incidences alternate 120, 240
    assert.deepStrictEqual(rows.slice(0, 4).map(r => Math.round(r.incidence)), [120, 240, 120, 240]);
  });
});

describe('feature parity & leakage (train vs predict)', () => {
  // Repeating 12-month seasonal pattern so seasonality_flag is meaningful (1)
  const pattern = [0, 2, 4, 6, 8, 10, 12, 14, 10, 6, 2, 0];
  const seasonal = (base) => Array.from({ length: 30 }, (_, i) => base + pattern[i % 12]);
  const popMapFor = (pops) =>
    _uniformPopMapByYear(Object.fromEntries(Object.entries(pops).map(([n, p]) => [n, { population: p, available: true }])));

  function dense(counts) {
    return buildDenseSeries(rowsFor(counts), Object.keys(counts));
  }

  it('train row at month T has identical features to a predict row built from data before T', () => {
    const counts = { A: seasonal(10), B: seasonal(6), C: seasonal(8) };
    const popMap = popMapFor({ A: 100000, B: 50000, C: 75000 });
    const { seriesByBarangay } = dense(counts);

    const T = 24; // 30 months >= 18 → window 12 on both sides
    const trainRows = buildTrainingRows(seriesByBarangay, popMap);
    const trainRow = trainRows.find(r => r.barangay_name === 'A' && r.month === seriesByBarangay.A[T].month);
    assert.ok(trainRow, `expected a training row at month index ${T}`);

    // Prediction "as of" month T-1: only pre-target data is visible.
    const truncated = {};
    for (const [n, s] of Object.entries(seriesByBarangay)) truncated[n] = s.slice(0, T);
    const window = _featureWindow(T);
    const neighborRisks = _neighborRisksAt(truncated, popMap, T - 1);
    const predictRows = addCrossSectionFeatures(Object.keys(truncated).map(name => buildFeatureRow({
      name, t: T, seriesByBarangay: truncated, popMapByYear: popMap, window, neighborRisks,
    })));
    const predictRow = predictRows.find(r => r.barangay_name === 'A');

    assert.deepStrictEqual(predictRow.features, trainRow.features);
    assert.strictEqual(predictRow.features.seasonality_flag, 1, 'seasonal series should flag seasonality');
  });

  it('no predictor reads the target month: perturbing it changes only the label', () => {
    const counts = { A: seasonal(10), B: seasonal(6), C: seasonal(8) };
    const popMap = popMapFor({ A: 100000, B: 100000, C: 100000 });
    const T = 24;

    const before = buildTrainingRows(dense(counts).seriesByBarangay, popMap);
    const rowBefore = before.find(r => r.barangay_name === 'A' && r.month === seriesMonth(T));
    assert.ok(rowBefore);

    function seriesMonth(idx) {
      return dense(counts).seriesByBarangay.A[idx].month;
    }

    // Blast the target month for every barangay
    counts.A[T] += 500;
    counts.B[T] += 500;
    counts.C[T] += 500;

    const after = buildTrainingRows(dense(counts).seriesByBarangay, popMap);
    const rowAfter = after.find(r => r.barangay_name === 'A' && r.month === seriesMonth(T));

    assert.deepStrictEqual(rowAfter.features, rowBefore.features,
      'features must be built only from data before the target month');
    assert.ok(rowAfter.incidence > rowBefore.incidence, 'the label (incidence) must reflect the target month');
  });

  it('neighbor_risk uses the month before the target (lag-1), never the target month', () => {
    const popMap = popMapFor({ A: 100000, B: 100000, C: 100000 });
    const base = { A: Array(12).fill(40), B: Array(12).fill(10), C: Array(12).fill(5) };

    const rows = buildTrainingRows(dense(base).seriesByBarangay, popMap);
    const targetMonth = dense(base).seriesByBarangay.A[6].month;
    const bBaseline = rows.find(r => r.barangay_name === 'B' && r.month === targetMonth);
    assert.ok(bBaseline);

    // 1) Change A only in the TARGET month → B's neighbor_risk must not move
    const targetHit = { A: [...base.A], B: [...base.B], C: [...base.C] };
    targetHit.A[6] = 500;
    const afterTargetHit = buildTrainingRows(dense(targetHit).seriesByBarangay, popMap);
    const bAfterTargetHit = afterTargetHit.find(r => r.barangay_name === 'B' && r.month === targetMonth);
    assert.strictEqual(bAfterTargetHit.features.neighbor_risk, bBaseline.features.neighbor_risk,
      'neighbor_risk must not read the target month');

    // 2) Change A in month T-1 → B's neighbor_risk must move
    const lagHit = { A: [...base.A], B: [...base.B], C: [...base.C] };
    lagHit.A[5] = 500;
    const afterLagHit = buildTrainingRows(dense(lagHit).seriesByBarangay, popMap);
    const bAfterLagHit = afterLagHit.find(r => r.barangay_name === 'B' && r.month === targetMonth);
    assert.notStrictEqual(bAfterLagHit.features.neighbor_risk, bBaseline.features.neighbor_risk,
      'neighbor_risk must reflect the month before the target');
  });

  it('window rule is identical for train and predict (12 when history ≥ 18)', () => {
    assert.strictEqual(_featureWindow(30), 12);
    assert.strictEqual(_featureWindow(18), 12);
    assert.strictEqual(_featureWindow(12), 6);
    assert.strictEqual(_featureWindow(3), 3);
  });

  it('train rows carry month and barangay_name metadata for walk-forward grouping', () => {
    const rows = buildTrainingRows(dense({ A: seasonal(10), B: seasonal(6) }).seriesByBarangay,
      popMapFor({ A: 100000, B: 100000 }));
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.ok(typeof r.month === 'string' && r.month.endsWith('-01'));
      assert.ok(r.barangay_name === 'A' || r.barangay_name === 'B');
      assert.ok(Number.isFinite(r.incidence));
    }
  });
});

describe('per-year population matching (never fabricate incidence)', () => {
  const popMap2026 = { A: { population: 100000, available: true }, B: { population: 100000, available: true } };
  const popMapByYear = { 2026: popMap2026 }; // 2025 and 2027 deliberately have no reference

  it('_popFor is strict: no fallback across years', () => {
    assert.strictEqual(_popFor(popMapByYear, 'A', 2026), 100000);
    assert.strictEqual(_popFor(popMapByYear, 'A', 2025), null, 'a year with no reference must resolve to null, not another year\'s population');
  });

  it('_popForFeature falls back to the nearest available year for RF feature construction', () => {
    assert.strictEqual(_popForFeature(popMapByYear, 'A', 2026), 100000);
    assert.strictEqual(_popForFeature(popMapByYear, 'A', 2027), 100000, 'feature construction may reuse the nearest known year');
    assert.strictEqual(_popForFeature(popMapByYear, 'Unknown', 2026), null, 'no reference for this barangay in any year → still null, never fabricated');
  });

  it('training rows targeting a year with no population reference are skipped, not labeled zero', () => {
    // 36 months: Jan 2025 - Dec 2027. Window is 12 (>=18 months of history), so
    // targets run Jan 2026 .. Dec 2027 — spanning a year WITH population (2026)
    // and one WITHOUT (2027). Population only exists for 2026.
    const counts = { A: Array(36).fill(10), B: Array(36).fill(10) };
    const { seriesByBarangay } = buildDenseSeries(rowsFor(counts), Object.keys(counts));
    const rows = buildTrainingRows(seriesByBarangay, popMapByYear);

    assert.ok(rows.length > 0, 'rows targeting 2026 months should still be produced');
    for (const r of rows) {
      assert.ok(r.month.startsWith('2026'), `no training row should target a year without population, got ${r.month}`);
    }
    // Exactly the 12 months of 2026, for both barangays — none of 2027.
    assert.strictEqual(rows.length, 24);
  });

  it('a 2026-targeted label uses 2026 population, never substituted from another year', () => {
    const counts = { A: Array(36).fill(10), B: Array(36).fill(10) };
    const { seriesByBarangay } = buildDenseSeries(rowsFor(counts), Object.keys(counts));
    const rows = buildTrainingRows(seriesByBarangay, popMapByYear);
    const row = rows.find(r => r.barangay_name === 'A');
    assert.ok(row);
    // 10 cases/month over 100000 population, annualized: 10*12/100000*100000 = 120
    assert.ok(Math.abs(row.incidence - 120) < 1e-9);
  });

  it('a prediction row in a year without population still gets a real (non-null) rolling_12m_incidence feature', () => {
    const counts = { A: Array(36).fill(10), B: Array(36).fill(10) };
    const { seriesByBarangay } = buildDenseSeries(rowsFor(counts), Object.keys(counts));
    const t = seriesByBarangay.A.length; // predicting the month right after all 36 (falls in 2028)
    const window = _featureWindow(t);
    const neighborRisks = _neighborRisksAt(seriesByBarangay, popMapByYear, t - 1);
    const predictRow = buildFeatureRow({ name: 'A', t, seriesByBarangay, popMapByYear, window, neighborRisks });
    assert.ok(predictRow.features.rolling_12m_incidence != null,
      'RF must still receive a real feature value by falling back to the nearest known population year');
  });
});

describe('_resolveClassification (RF is authoritative, independent of the weighted score)', () => {
  it('TEST A — RF says High: risk_class is High regardless of what a low legacy score would imply', () => {
    // A legacy risk_score of e.g. 28 would fall in the <=33 "Low" band, but
    // that band is irrelevant here — _resolveClassification never receives
    // or consults risk_score/riskClass at all.
    const classified = { risk_class: 'High', proba: { Low: 0.2, Medium: 0.3, High: 0.5 } };
    const result = _resolveClassification(classified, 'random_forest');
    assert.strictEqual(result.risk_class, 'High');
    assert.strictEqual(result.model_type, 'random_forest');
    assert.strictEqual(result.classification_confidence, 0.5);
  });

  it('TEST B — RF says Low: risk_class is Low regardless of what a mid-range legacy score would imply', () => {
    const classified = { risk_class: 'Low', proba: { Low: 0.6, Medium: 0.3, High: 0.1 } };
    const result = _resolveClassification(classified, 'random_forest');
    assert.strictEqual(result.risk_class, 'Low');
    assert.strictEqual(result.classification_confidence, 0.6);
  });

  it('TEST C — a rule-based fallback result is labeled as such, never presented as random_forest', () => {
    const classified = { risk_class: 'Medium', proba: { Low: 0, Medium: 1, High: 0 } };
    const result = _resolveClassification(classified, 'rule_based');
    assert.strictEqual(result.risk_class, 'Medium');
    assert.strictEqual(result.model_type, 'rule_based');
    // The fallback's 100%/0%/0% proba is manufactured, not a real confidence
    // — must not be persisted as if it were one.
    assert.strictEqual(result.classification_confidence, null);
    assert.strictEqual(result.prob_low, null);
  });

  it('TEST D — no classification at all: risk_class is null/No Data, never a fabricated class', () => {
    const result = _resolveClassification(undefined, undefined);
    assert.strictEqual(result.risk_class, null);
    assert.strictEqual(result.model_type, null);
    assert.strictEqual(result.classification_confidence, null);
  });
});

describe('_ruleBasedClassify (rename check)', () => {
  it('reads the renamed rolling_12m_incidence feature, not the old forecasted_incidence key', () => {
    const rows = [{ barangay_name: 'A', features: { rolling_12m_incidence: 500, lag_1m: 10 } }];
    const [result] = _ruleBasedClassify(rows, { low_max: 150, med_max: 350 });
    assert.strictEqual(result.risk_class, 'High');
  });
});

describe('classifyByTertile', () => {
  it('splits 30 scores into 10 Low / 8 Medium / 12 High (33.3 / 60 percentile)', () => {
    // Scores 30..45 like a real run: fixed 33/66 cutoffs would call almost all of these Medium.
    // The Moderate|High cut sits at the 60th percentile, so the top 40% is High.
    const scores = Array.from({ length: 30 }, (_, i) => 30 + i * 0.5);
    const { classes } = classifyByTertile(scores);
    const count = (c) => classes.filter(x => x === c).length;
    assert.strictEqual(count('Low'), 10);
    assert.strictEqual(count('Medium'), 8);
    assert.strictEqual(count('High'), 12);
  });

  it('keeps input order and ranks the highest score High, the lowest Low', () => {
    const { classes } = classifyByTertile([50, 10, 30, 20, 40, 60]);
    assert.strictEqual(classes[0], 'High');
    assert.strictEqual(classes[5], 'High');
    assert.strictEqual(classes[1], 'Low');
    assert.strictEqual(classes[3], 'Low');
    assert.strictEqual(classes[2], 'Medium');
  });

  it('uses Low <= low_max and High > med_max', () => {
    const { classes, low_max, med_max } = classifyByTertile([1, 2, 3, 4, 5, 6, 7]);
    assert.ok(classes[[1, 2, 3, 4, 5, 6, 7].indexOf(Math.round(low_max))] !== 'High');
    assert.ok(low_max < med_max);
    assert.strictEqual(classes[classes.length - 1], 'High');
  });

  it('puts identical scores in one class instead of splitting arbitrarily', () => {
    const { classes } = classifyByTertile(Array(9).fill(25));
    assert.ok(classes.every(c => c === 'Low'));
  });

  it('handles empty input', () => {
    assert.deepStrictEqual(classifyByTertile([]), { classes: [], low_max: null, med_max: null });
  });
});

describe('neighbor_risk with real (bordering) neighbours', () => {
  const popMapByYear = _uniformPopMapByYear({
    A: { population: 100000, available: true },
    B: { population: 100000, available: true },
    C: { population: 100000, available: true },
  });
  const mk = (name, counts) => counts.map((c, i) => ({
    barangay_name: name, month: `2025-${String(i + 1).padStart(2, '0')}-01`, case_count: c,
  }));

  it('ignores a barangay that does not share a border', () => {
    // A borders B only; C is far away. A surge in C must not move A's neighbor_risk.
    const adjacency = { A: ['B'], B: ['A', 'C'], C: ['B'] };
    const base = { A: mk('A', [5, 5, 5]), B: mk('B', [5, 5, 5]), C: mk('C', [5, 5, 5]) };
    const surge = { ...base, C: mk('C', [5, 90, 5]) };
    const before = _neighborRisksAt(base, popMapByYear, 1, adjacency);
    const after = _neighborRisksAt(surge, popMapByYear, 1, adjacency);
    // B borders C, so B's raw neighbour average rises; A's raw average (B only) is unchanged.
    assert.strictEqual(after.B, 1);
    assert.ok(after.A <= before.A + 1e-12);
  });

  it('falls back to all other barangays without an adjacency map', () => {
    const series = { A: mk('A', [5, 5]), B: mk('B', [5, 5]), C: mk('C', [5, 90]) };
    const risks = _neighborRisksAt(series, popMapByYear, 1, null);
    // C's own surge is excluded from C's average, so C has the lowest neighbour risk.
    assert.strictEqual(risks.C, 0);
  });

  it('feature rows no longer carry historical_bias', () => {
    const series = { A: mk('A', [1, 2, 3, 4, 5, 6, 7, 8]), B: mk('B', [8, 7, 6, 5, 4, 3, 2, 1]) };
    const rows = buildTrainingRows(series, popMapByYear, null);
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.deepStrictEqual(Object.keys(r.features).sort(), [
        'incidence_3m', 'incidence_rank', 'lag_1m', 'lag_2m', 'lag_3m', 'neighbor_risk', 'prev_category',
        'recent_trend', 'rolling_12m_incidence', 'seasonality_flag',
      ]);
    }
  });
});

describe('dropUnfinishedMonth', () => {
  const rows = [{ month: '2026-08-01' }, { month: '2026-09-01' }, { month: '2026-10-01' }];

  it('drops the month still in progress and keeps finished ones', () => {
    const kept = dropUnfinishedMonth(rows, new Date('2026-10-08T03:00:00Z'));
    assert.deepStrictEqual(kept.map(r => r.month), ['2026-08-01', '2026-09-01']);
  });

  it('uses Philippine time at the month boundary', () => {
    // 2026-09-30 17:00 UTC is already 1 October 01:00 in Manila: September has finished.
    const kept = dropUnfinishedMonth(rows, new Date('2026-09-30T17:00:00Z'));
    assert.deepStrictEqual(kept.map(r => r.month), ['2026-08-01', '2026-09-01']);
  });
});
