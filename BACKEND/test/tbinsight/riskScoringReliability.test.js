/**
 * TBInsight — Risk Scoring Reliability Tests
 *
 * Covers the three scoring defects found in the GIS/risk audit:
 *
 *   A. Threshold calibration had no scale guard. When a year has no population
 *      reference of its own, every current incidence is null, the tertile
 *      service has nothing to calibrate from, and the run silently fell back to
 *      DEFAULT_THRESHOLDS (150/350). Those constants were then compared against
 *      an annualized-monthly incidence running in the hundreds to thousands, so
 *      almost every barangay cleared med_max. That is how the stored 2023
 *      snapshot came to classify 26 of 30 barangays High.
 *
 *   B. The rule-based fallback fell back to lag_1m — a raw monthly case count —
 *      when incidence was missing, comparing it against per-100k cut points.
 *
 *   C. Seasonality was detected by counting matching signs of consecutive
 *      month-to-month changes across two halves of the series, which flags any
 *      steadily rising series as seasonal. seasonality_flag is one of the eight
 *      RF inputs, so the false positives reached the classifier.
 *
 * No database and no ML service: _resolveThresholds takes an injectable
 * threshold caller, and the rest are pure functions.
 *
 * Run: node --test BACKEND/test/tbinsight/riskScoringReliability.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  DEFAULT_THRESHOLDS,
  _resolveThresholds,
  _ruleBasedClassify,
  _detectSeasonality,
} = require('../../tbinsight/pipeline');
const { LOW_PERCENTILE, MED_PERCENTILE } = require('../../tbinsight/scoring');

/** Feature rows carrying only what the functions under test read. */
const rows = (incidenceValues) =>
  incidenceValues.map((v, i) => ({
    barangay_name: `B${i}`,
    features: { rolling_12m_incidence: v, lag_1m: 9, lag_2m: 8, lag_3m: 7 },
  }));

const incidences = (values) => values.map((v, i) => ({ name: `B${i}`, incidence_per_100k: v }));

/** A monthly series of the given counts, starting 2023-01. */
function series(counts) {
  return counts.map((case_count, i) => {
    const y = 2023 + Math.floor(i / 12);
    const m = String((i % 12) + 1).padStart(2, '0');
    return { month: `${y}-${m}-01`, case_count };
  });
}

const SEASONAL_CYCLE = [5, 8, 14, 22, 30, 34, 30, 22, 14, 8, 5, 4];

// ==================== A. THRESHOLD CALIBRATION ====================

describe('threshold resolution — scale matching', () => {
  it('uses the tertile service when real incidences exist', async () => {
    const { thresholds, source } = await _resolveThresholds({
      barangayIncidences: incidences([100, 200, 300, 400]),
      predictRows: rows([500, 600, 700, 800]),
      callThresholds: async () => ({ low_max: 180, med_max: 320 }),
    });
    assert.strictEqual(source, 'tertile_incidence');
    assert.deepStrictEqual(thresholds, { low_max: 180, med_max: 320 });
  });

  it('records the percentile basis behind data-derived cut points', async () => {
    // From the ML service: percentiles are echoed back for the UI.
    const fromService = await _resolveThresholds({
      barangayIncidences: incidences([100, 200, 300, 400]),
      predictRows: rows([500, 600, 700, 800]),
      callThresholds: async () => ({ low_max: 180, med_max: 320, low_pct: 100 / 3, med_pct: 60 }),
    });
    assert.deepStrictEqual(fromService.percentiles, { low_pct: 100 / 3, med_pct: 60 });

    // A response from an older ML service carries none — fall back to the
    // shared constants, which is what the service itself would have used.
    const stale = await _resolveThresholds({
      barangayIncidences: incidences([100, 200, 300, 400]),
      predictRows: rows([500, 600, 700, 800]),
      callThresholds: async () => ({ low_max: 180, med_max: 320 }),
    });
    assert.deepStrictEqual(stale.percentiles, { low_pct: LOW_PERCENTILE * 100, med_pct: MED_PERCENTILE * 100 });
    assert.strictEqual(MED_PERCENTILE, 0.60,
      'the Moderate|High cut must stay at the 60th percentile, matching thresholds.py');

    // A caller-supplied override is a fixed number with no percentile basis,
    // and neither is the last-resort default.
    const override = await _resolveThresholds({
      thresholdsOverride: { low_max: 10, med_max: 20 },
      barangayIncidences: incidences([100, 200]),
      predictRows: rows([500, 600]),
      callThresholds: async () => { throw new Error('must not be called'); },
    });
    assert.strictEqual(override.percentiles, null);

    const fallback = await _resolveThresholds({
      barangayIncidences: incidences([null, null]),
      predictRows: rows([null, null]),
      callThresholds: async () => { throw new Error('unavailable'); },
    });
    assert.strictEqual(fallback.source, 'default');
    assert.strictEqual(fallback.percentiles, null);
  });

  it('passes only non-null incidences to the tertile service', async () => {
    let received = null;
    await _resolveThresholds({
      barangayIncidences: incidences([100, null, 300, undefined, 500]),
      predictRows: rows([500, 600, 700]),
      callThresholds: async (values) => { received = values; return { low_max: 1, med_max: 2 }; },
    });
    assert.deepStrictEqual(received, [100, 300, 500],
      'nulls must not reach the calibrator, where they would corrupt the cut points');
  });

  it('calibrates from the classified feature when every incidence is null', async () => {
    // The 2023 case: no population reference for the year, so no current
    // incidence anywhere, while the RF features still carry real values.
    const featureValues = [364, 408, 430, 467, 484, 500, 568, 590, 673, 683,
      694, 773, 852, 923, 958, 1087, 1227, 1520, 1688, 3139];
    const { thresholds, source } = await _resolveThresholds({
      barangayIncidences: incidences(new Array(20).fill(null)),
      predictRows: rows(featureValues),
      callThresholds: async () => { throw new Error('nothing to calibrate'); },
    });

    assert.strictEqual(source, 'tertile_features');
    assert.notDeepStrictEqual(thresholds, DEFAULT_THRESHOLDS);

    // Cut points must sit inside the data they will be compared against.
    const min = Math.min(...featureValues);
    const max = Math.max(...featureValues);
    assert.ok(thresholds.low_max > min && thresholds.low_max < max,
      `low_max ${thresholds.low_max} must fall within the feature range ${min}..${max}`);
    assert.ok(thresholds.med_max > thresholds.low_max && thresholds.med_max < max,
      `med_max ${thresholds.med_max} must fall within the feature range`);
  });

  it('no longer classifies nearly every barangay High when incidence is unavailable', async () => {
    // The exact regression, using the feature values stored for the 2023 snapshot.
    const featureValues = [364.7, 408.9, 412.2, 415.0, 430.9, 467.3, 484.7, 500.4,
      518.3, 568.7, 590.3, 592.6, 673.4, 683.0, 694.1, 773.4,
      852.8, 923.8, 958.6, 1087.8, 1227.7, 1520.0, 1688.6,
      3139.0, 3464.5, 5019.3, 237.5, 283.4, 312.9, 319.0];
    const predictRows = rows(featureValues);

    const { thresholds } = await _resolveThresholds({
      barangayIncidences: incidences(new Array(30).fill(null)),
      predictRows,
      callThresholds: async () => { throw new Error('unavailable'); },
    });
    const classified = _ruleBasedClassify(predictRows, thresholds);
    const high = classified.filter(c => c.risk_class === 'High').length;

    assert.ok(high <= 12,
      `a tertile split must not put ${high} of 30 barangays in High; the stored snapshot had 26`);
    for (const band of ['Low', 'Medium', 'High']) {
      assert.ok(classified.some(c => c.risk_class === band), `${band} must not be empty`);
    }
  });

  it('falls back to the defaults only when nothing can be calibrated, and says so', async () => {
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
      const { thresholds, source } = await _resolveThresholds({
        barangayIncidences: [],
        predictRows: rows([null, null]),
        callThresholds: async () => { throw new Error('unavailable'); },
      });
      assert.strictEqual(source, 'default');
      assert.deepStrictEqual(thresholds, DEFAULT_THRESHOLDS);
    } finally {
      console.warn = realWarn;
    }
    assert.ok(warnings.some(w => /unreliable/i.test(w)),
      'an uncalibrated run must announce that its classifications are unreliable');
  });

  it('honours an explicit override without calibrating', async () => {
    let called = false;
    const { thresholds, source } = await _resolveThresholds({
      thresholdsOverride: { low_max: 10, med_max: 20 },
      barangayIncidences: incidences([100, 200]),
      predictRows: rows([300]),
      callThresholds: async () => { called = true; return { low_max: 1, med_max: 2 }; },
    });
    assert.strictEqual(source, 'override');
    assert.deepStrictEqual(thresholds, { low_max: 10, med_max: 20 });
    assert.strictEqual(called, false);
  });

  it('rejects a non-finite result from the tertile service', async () => {
    const { source } = await _resolveThresholds({
      barangayIncidences: incidences([100, 200, 300]),
      predictRows: rows([400, 500, 600]),
      callThresholds: async () => ({ low_max: NaN, med_max: null }),
    });
    assert.notStrictEqual(source, 'tertile_incidence', 'NaN cut points must not be accepted');
  });

  it('needs at least three feature values before splitting them into tertiles', async () => {
    const { source } = await _resolveThresholds({
      barangayIncidences: [],
      predictRows: rows([500, 600]),
      callThresholds: async () => { throw new Error('unavailable'); },
    });
    assert.strictEqual(source, 'default', 'two points cannot define three bands');
  });
});

// ==================== B. RULE-BASED FALLBACK ====================

describe('rule-based fallback — unit safety', () => {
  const thresholds = { low_max: 150, med_max: 350 };

  it('classifies on incidence when it is available', () => {
    const out = _ruleBasedClassify(rows([100, 250, 900]), thresholds);
    assert.deepStrictEqual(out.map(o => o.risk_class), ['Low', 'Medium', 'High']);
  });

  it('never compares a raw case count against a per-100k threshold', () => {
    // lag_1m is 9 cases. Read as an incidence that is 9 <= 150 -> Low.
    const out = _ruleBasedClassify(rows([null]), thresholds);
    assert.notStrictEqual(out[0].risk_class, 'Low',
      'a barangay with unknown incidence must not be asserted Low from its case count');
    assert.strictEqual(out[0].risk_class, 'Medium');
  });

  it('treats a missing features object as unknown rather than zero', () => {
    const out = _ruleBasedClassify([{ barangay_name: 'X' }], thresholds);
    assert.strictEqual(out[0].risk_class, 'Medium');
  });

  it('keeps a genuine zero incidence as Low', () => {
    // 0 is a real lowest value, distinct from null.
    const out = _ruleBasedClassify(rows([0]), thresholds);
    assert.strictEqual(out[0].risk_class, 'Low');
  });

  it('still reports a proba shape, so downstream code is unchanged', () => {
    const out = _ruleBasedClassify(rows([900]), thresholds);
    assert.deepStrictEqual(out[0].proba, { Low: 0, Medium: 0, High: 1 });
  });
});

// ==================== C. SEASONALITY ====================

describe('seasonality detection', () => {
  it('does not flag a steadily rising series as seasonal', () => {
    // The false positive: every month-to-month change is positive, so the old
    // sign-matching heuristic scored 100%.
    const rising = series(Array.from({ length: 36 }, (_, i) => 10 + i * 2));
    assert.strictEqual(_detectSeasonality(rising), false);
  });

  it('does not flag a steadily falling series as seasonal', () => {
    const falling = series(Array.from({ length: 36 }, (_, i) => 100 - i * 2));
    assert.strictEqual(_detectSeasonality(falling), false);
  });

  it('flags a genuine repeating annual cycle', () => {
    const counts = [...SEASONAL_CYCLE, ...SEASONAL_CYCLE, ...SEASONAL_CYCLE];
    assert.strictEqual(_detectSeasonality(series(counts)), true);
  });

  it('flags a seasonal cycle that also trends upward', () => {
    const counts = [];
    for (let year = 0; year < 3; year++) {
      for (const v of SEASONAL_CYCLE) counts.push(v + year * 10);
    }
    assert.strictEqual(_detectSeasonality(series(counts)), true);
  });

  it('does not flag a flat series', () => {
    assert.strictEqual(_detectSeasonality(series(new Array(36).fill(7))), false);
  });

  it('requires at least 24 months before claiming a pattern', () => {
    const counts = [...SEASONAL_CYCLE, ...SEASONAL_CYCLE.slice(0, 11)];
    assert.strictEqual(_detectSeasonality(series(counts)), false);
  });

  it('is unaffected by the order rows arrive in', () => {
    const ordered = series([...SEASONAL_CYCLE, ...SEASONAL_CYCLE, ...SEASONAL_CYCLE]);
    const shuffled = [...ordered].reverse();
    assert.strictEqual(_detectSeasonality(shuffled), _detectSeasonality(ordered));
  });

  it('does not mutate the array it was given', () => {
    const input = series([3, 1, 2, 9, 4, 5, 6, 7, 8, 10, 11, 12,
      3, 1, 2, 9, 4, 5, 6, 7, 8, 10, 11, 12]);
    const before = input.map(r => r.month);
    _detectSeasonality(input);
    assert.deepStrictEqual(input.map(r => r.month), before);
  });
});
