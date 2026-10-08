import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeForecast, topBarangayRanking } from '../src/utils/dashboardForecast.js';
import { outcomeInsight } from '../src/utils/chartInsights.js';

// Live shape: data through Sep 2026; forecast rows for Oct/Nov/Dec 2026 plus stale rows from an
// older run (Jan 2026). 28 ARIMA barangays and 2 sparse ones on exponential smoothing.
const monthly = [
  { barangay_name: 'Pinagbuhatan', month: '2026-08-01', case_count: 398 },
  { barangay_name: 'Pinagbuhatan', month: '2026-09-01', case_count: 377 },
];
const rowsFor = (period, arimaEach = 12.8) => [
  ...Array.from({ length: 28 }, (_, i) => ({ barangay_name: `B${i + 1}`, period, forecasted_count: arimaEach, method: 'arima', risk_class: 'Low' })),
  { barangay_name: 'Bagong Katipunan', period, forecasted_count: 0.13, method: 'exponential_smoothing', risk_class: 'Low' },
  { barangay_name: 'Santa Rosa', period, forecasted_count: 0.47, method: 'exponential_smoothing', risk_class: 'High' },
];
const forecasts = [
  ...rowsFor('2026-01-01', 99),      // stale, earlier than the data
  ...rowsFor('2026-10-01', 12.8),
  ...rowsFor('2026-11-01', 12.5),
  ...rowsFor('2026-12-01', 12.9),
];

test('the forecast month is the first one after the latest recorded month, not the farthest', () => {
  const f = summarizeForecast(forecasts, monthly, '2026-09-01');
  assert.equal(f.period, 'October 2026');
  assert.equal(f.total, Math.round(28 * 12.8 + 0.6));
  assert.equal(f.periodCount, 3);   // Oct, Nov, Dec — the stale January run is not counted
});

test('without an anchor, or with nothing ahead, it uses the newest period', () => {
  assert.equal(summarizeForecast(forecasts, monthly, '').period, 'December 2026');
  assert.equal(summarizeForecast(forecasts, monthly, '2027-06-01').period, 'December 2026');
});

test('28 ARIMA + 2 sparse barangays is an ARIMA Forecast that names the exceptions', () => {
  const f = summarizeForecast(forecasts, monthly, '2026-09-01');
  assert.equal(f.tier, 'mixed');
  assert.equal(f.tierLabel, 'ARIMA Forecast');
  assert.equal(f.arimaBarangays, 28);
  assert.deepEqual(f.fallbackBarangays, ['Bagong Katipunan', 'Santa Rosa']);
  assert.match(f.methodNote, /28 of 30 barangays use ARIMA/);
  assert.match(f.methodNote, /Bagong Katipunan, Santa Rosa/);
  assert.match(f.methodNote, /exponential smoothing/);
  assert.doesNotMatch(f.methodNote, /24/);
});

test('all ARIMA has no note; no ARIMA at all is a Baseline Forecast; nothing usable is insufficient', () => {
  const allArima = rowsFor('2026-10-01').filter((r) => r.method === 'arima');
  assert.equal(summarizeForecast(allArima, monthly, '2026-09-01').tier, 'arima');
  assert.equal(summarizeForecast(allArima, monthly, '2026-09-01').methodNote, '');

  const onlyFallback = rowsFor('2026-10-01').filter((r) => r.method !== 'arima');
  const b = summarizeForecast(onlyFallback, monthly, '2026-09-01');
  assert.equal(b.tier, 'baseline');
  assert.equal(b.tierLabel, 'Baseline Forecast');

  const none = [{ barangay_name: 'A', period: '2026-10-01', forecasted_count: 0, method: 'insufficient_data' }];
  assert.equal(summarizeForecast(none, monthly, '2026-09-01').tier, 'insufficient_data');
});

test('no forecast rows gives the empty summary', () => {
  const f = summarizeForecast([], monthly, '2026-09-01');
  assert.equal(f.period, '');
  assert.equal(f.tier, null);
});

// ---- Top barangays: risk level, then recorded cases ----
test('within a risk level barangays are ordered by cases, not by risk score', () => {
  const m = [
    { barangay_name: 'Pinagbuhatan', month: '2026-01-01', case_count: 4835 },
    { barangay_name: 'Santa Rosa', month: '2026-01-01', case_count: 21 },
    { barangay_name: 'Manggahan', month: '2026-01-01', case_count: 1968 },
    { barangay_name: 'Santa Lucia', month: '2026-01-01', case_count: 1065 },
    { barangay_name: 'Calm', month: '2026-01-01', case_count: 9000 },
  ];
  const risk = [
    { name: 'Pinagbuhatan', risk_class: 'High', risk_score: 74.6 },
    { name: 'Santa Rosa', risk_class: 'High', risk_score: 63.1 },   // higher score, far fewer cases
    { name: 'Manggahan', risk_class: 'High', risk_score: 40 },
    { name: 'Santa Lucia', risk_class: 'High', risk_score: 48.3 },
    { name: 'Calm', risk_class: 'Low', risk_score: 5 },
  ];
  const top = topBarangayRanking(m, risk, 5);
  assert.deepEqual(top.map((r) => r.name), ['Pinagbuhatan', 'Manggahan', 'Santa Lucia', 'Santa Rosa', 'Calm']);
  assert.deepEqual(top.map((r) => r.rank), [1, 2, 3, 4, 5]);
});

test('unassessed barangays sort last and are never shown as Low', () => {
  const top = topBarangayRanking(
    [{ barangay_name: 'A', month: '2026-01-01', case_count: 500 }, { barangay_name: 'B', month: '2026-01-01', case_count: 5 }],
    [{ name: 'A', risk_class: 'No Data' }, { name: 'B', risk_class: 'Low' }]
  );
  assert.deepEqual(top.map((r) => [r.name, r.risk]), [['B', 'Low'], ['A', null]]);
});

// ---- Outcome sentence: say what its percentage covers ----
test('the outcome sentence states its scope and can point out the success-rate difference', () => {
  const items = [
    { name: 'CURED', Cases: 2883 }, { name: 'TREATMENT COMPLETED', Cases: 8984 }, { name: 'LOST TO FOLLOW-UP', Cases: 1021 },
    { name: 'DIED', Cases: 255 }, { name: 'TREATMENT FAILED', Cases: 15 }, { name: 'NOT EVALUATED', Cases: 5 }, { name: 'EXCLUDED', Cases: 29 },
  ];
  const plain = outcomeInsight(items);
  assert.match(plain, /90% of recorded outcomes were cured or completed treatment; 7\.7% were lost to follow-up\./);

  const dash = outcomeInsight(items, { scope: 'recorded outcomes across all years', note: 'The Treatment Success Rate above covers a single treatment-start year, so the two figures differ.' });
  assert.match(dash, /90% of recorded outcomes across all years/);
  assert.match(dash, /Treatment Success Rate above covers a single treatment-start year/);
});
