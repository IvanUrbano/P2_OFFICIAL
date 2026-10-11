import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvaluationView, errorStats, methodLabel, totalStats } from '../src/utils/modelEvaluationView.js';

// A saved evaluation: two barangays tested on Dec 2025 and Jan 2026 (so two calendar years).
const step = (month, actual, predicted, method = 'arima') => ({ month, actual, predicted, method });
const uguong = { barangay_name: 'Ugong', mae: 3, mape: 20, n_steps: 2, method_counts: { arima: 2 },
  steps: [step('2025-12-01', 10, 7), step('2026-01-01', 10, 13)] };                     // errors 3, 3 -> MAE 3, MAPE 30
const rosario = { barangay_name: 'Rosario', mae: 5, mape: 10, n_steps: 2, method_counts: { arima: 1, exponential_smoothing: 1 },
  steps: [step('2025-12-01', 50, 45), step('2026-01-01', 50, 55, 'exponential_smoothing')] }; // errors 5, 5 -> MAE 5, MAPE 10
const saved = {
  metrics: { arima: { mae: 4, mape: 20, n_steps: 2, method_counts: { arima: 3, exponential_smoothing: 1 }, per_barangay: [uguong, rosario],
    steps: uguong.steps, example_barangay: 'Ugong' } },
  config: { method: 'ARIMA + exponential smoothing', evaluation_start: '2025-12-01', evaluation_end: '2026-01-01' },
};
// An older record: overall figures plus ONE barangay's months.
const legacy = {
  metrics: { arima: { mae: 4.6, mape: 8.2, n_steps: 2, method_counts: { arima: 2 }, example_barangay: 'Ugong', steps: uguong.steps } },
  config: { method: 'ARIMA', evaluation_start: '2025-12-01', evaluation_end: '2026-01-01' },
};

test('no saved evaluation gives nothing to show', () => {
  assert.equal(buildEvaluationView(null).state, 'none');
  assert.equal(buildEvaluationView({ metrics: {} }).state, 'none');
});

// ---------- All barangays = the overall evaluation ----------
test('All barangays shows the SAVED overall MAE/MAPE, method and period, not one barangay', () => {
  const v = buildEvaluationView(saved, { startYear: '2023', endYear: '2026', barangay: '' });
  assert.equal(v.state, 'ready');
  assert.equal(v.scope, 'overall');
  assert.equal(v.scopeLabel, 'All barangays');
  assert.equal(v.mae, 4);                                  // the saved headline, as stored
  assert.equal(v.mape, 20);
  assert.equal(v.method, 'ARIMA + exponential smoothing');
  assert.equal(v.periodStart, '2025-12-01');
  assert.equal(v.periodEnd, '2026-01-01');
  assert.equal(v.barangaysEvaluated, 2);
});

test('the overall comparison is the city-wide total per month, not one barangay\'s rows', () => {
  const v = buildEvaluationView(saved, {});
  assert.equal(v.rowsLabel, 'City-wide total (all barangays)');
  assert.deepEqual(v.rows, [
    { month: '2025-12-01', actual: 60, predicted: 52, error: 8 },   // 10 + 50 actual, 7 + 45 predicted
    { month: '2026-01-01', actual: 60, predicted: 68, error: 8 },
  ]);
});

test('the city-wide total is scored as one forecast, with skill only when every month has a baseline', () => {
  const v = buildEvaluationView(saved, {});
  assert.equal(v.city.mae, 8);
  assert.equal(v.city.wape, (16 / 120) * 100);
  assert.equal(v.city.skill, null);                            // these steps carry no baseline

  const withBase = (b, base) => ({ ...b, steps: b.steps.map((s, i) => ({ ...s, baseline: base[i] })) });
  const based = { ...saved, metrics: { arima: { ...saved.metrics.arima,
    per_barangay: [withBase(uguong, [12, 12]), withBase(rosario, [40, 40])] } } };
  // City baseline 52 both months: off by 8 each, the same as the model -> skill 0
  assert.equal(buildEvaluationView(based, {}).city.skill, 0);
});

// ---------- Year / Period filter ----------
test('a year range narrows the overall evaluation and recomputes MAE/MAPE from the saved months', () => {
  const v = buildEvaluationView(saved, { startYear: '2026', endYear: '2026', barangay: '' });
  assert.equal(v.state, 'ready');
  assert.equal(v.rangeLabel, '2026');
  assert.equal(v.periodStart, '2026-01-01');
  assert.equal(v.periodEnd, '2026-01-01');
  assert.equal(v.rows.length, 1);
  // mean of each barangay's own MAE for Jan 2026: Ugong 3, Rosario 5 -> 4; MAPE: 30%, 10% -> 20%
  assert.equal(v.mae, 4);
  assert.equal(v.mape, 20);
  assert.equal(v.narrowed, true);
  assert.equal(v.method, 'ARIMA + exponential smoothing');
});

test('a year range with no evaluated months says what the evaluation covers', () => {
  const v = buildEvaluationView(saved, { startYear: '2023', endYear: '2024' });
  assert.equal(v.state, 'no_steps_in_range');
  assert.equal(v.evaluatedStart, '2025-12-01');
  assert.equal(v.evaluatedEnd, '2026-01-01');
});

// ---------- Barangay filter ----------
test('one barangay shows that barangay\'s own saved figures and months', () => {
  const v = buildEvaluationView(saved, { barangay: 'Rosario' });
  assert.equal(v.scope, 'barangay');
  assert.equal(v.mae, 5);
  assert.equal(v.mape, 10);
  assert.equal(v.method, 'ARIMA + exponential smoothing');
  assert.deepEqual(v.rows.map((r) => [r.month, r.actual, r.predicted, r.error]), [
    ['2025-12-01', 50, 45, 5], ['2026-01-01', 50, 55, 5],
  ]);
});

test('barangay and year filters combine', () => {
  const v = buildEvaluationView(saved, { startYear: '2025', endYear: '2025', barangay: 'ugong' });
  assert.equal(v.state, 'ready');
  assert.equal(v.rows.length, 1);
  assert.equal(v.mae, 3);          // |10 - 7|
  assert.equal(v.mape, 30);        // 3 / 10
  assert.equal(v.method, 'ARIMA');
});

test('a barangay that was not evaluated is reported, not replaced by another one', () => {
  const v = buildEvaluationView(saved, { barangay: 'Sagad' });
  assert.equal(v.state, 'barangay_unavailable');
  assert.equal(v.hasPerBarangay, true);
});

// ---------- Older saved records ----------
test('an older record still gives the overall figures for All barangays, without inventing a monthly comparison', () => {
  const v = buildEvaluationView(legacy, { startYear: '2023', endYear: '2026' });
  assert.equal(v.state, 'ready');
  assert.equal(v.legacyOverall, true);
  assert.equal(v.mae, 4.6);
  assert.equal(v.mape, 8.2);
  assert.equal(v.method, 'ARIMA');
  assert.deepEqual(v.rows, [], 'the example barangay is NOT shown as if it were the overall comparison');
  assert.equal(v.exampleBarangay, 'Ugong', 'but the view says which barangay WAS saved'); 
  assert.deepEqual(v.notes, []);
});

test('an older record cannot apply a narrower year range to its overall figures, and says so', () => {
  const v = buildEvaluationView(legacy, { startYear: '2026', endYear: '2026' });
  assert.deepEqual(v.notes, ['yearFilterNotApplied']);
  assert.equal(v.mae, 4.6);
});

test('an older record answers only for the one barangay it kept, and not for others', () => {
  const ok = buildEvaluationView(legacy, { barangay: 'Ugong' });
  assert.equal(ok.state, 'ready');
  assert.equal(ok.rows.length, 2);
  const other = buildEvaluationView(legacy, { barangay: 'Rosario' });
  assert.equal(other.state, 'barangay_unavailable');
  assert.equal(other.savedFor, 'Ugong');
  assert.equal(other.hasPerBarangay, false);
});

// ---------- helpers ----------
test('error stats skip zero-actual months for MAPE and handle nothing', () => {
  const s = errorStats([{ actual: 10, predicted: 8 }, { actual: 0, predicted: 2 }]);
  assert.equal(s.mae, 2);          // (2 + 2) / 2
  assert.equal(s.mape, 20);        // only the first month counts: 2 / 10
  assert.equal(s.wape, 40);        // zero month still counts: (2 + 2) / (10 + 0)
  assert.equal(s.skill, null);     // no baseline saved (older record)
  assert.deepEqual(errorStats([]), { mae: null, mape: null, wape: null, skill: null });
});

test('skill compares the error with the saved 12-month-average baseline', () => {
  const s = errorStats([
    { actual: 10, predicted: 9, baseline: 6 },   // model off by 1, baseline by 4
    { actual: 4, predicted: 5, baseline: 4 },    // model off by 1, baseline by 0
  ]);
  assert.equal(s.skill, 1 - 2 / 4);              // 50% less error than the baseline
});

test('method names are readable', () => {
  assert.equal(methodLabel({ arima: 3 }), 'ARIMA');
  assert.equal(methodLabel({ arima: 3, exponential_smoothing: 1 }), 'ARIMA + exponential smoothing');
  assert.equal(methodLabel({}), '—');
});

test('3-month totals are scored from the steps that carry them', () => {
  const t = totalStats([
    { actual: 4, predicted: 4, actual_3m: 12, predicted_3m: 10, baseline_3m: 15 },
    { actual: 5, predicted: 4, actual_3m: 18, predicted_3m: 19, baseline_3m: 15 },
    { actual: 3, predicted: 4 },                  // last months tested: no 3-month total
  ]);
  assert.equal(t.months, 2);
  assert.equal(t.mae, 1.5);                       // (2 + 1) / 2
  assert.equal(t.wape, 10);                       // 3 / 30
  assert.equal(t.skill, 1 - 3 / 6);               // baseline off by 3 + 3
  assert.equal(totalStats([{ actual: 1, predicted: 1 }]).wape, null);
});
