import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dataYears, barangayNames, scopeByBarangay, scopeMonthly, filterQuery, recommendFilters,
} from '../src/utils/dashboardFilters.js';

// 8 calendar months: 2025-05 .. 2025-12. "Last 3" = Oct-Dec, "the 3 before" = Jul-Sep.
const row = (barangay_name, month, case_count) => ({ barangay_name, month, case_count });
const monthly = [
  // Ugong: 1/month before, 3/month recently  -> +6, rising
  row('Ugong', '2025-07-01', 1), row('Ugong', '2025-08-01', 1), row('Ugong', '2025-09-01', 1),
  row('Ugong', '2025-10-01', 3), row('Ugong', '2025-11-01', 3), row('Ugong', '2025-12-01', 3),
  // Rosario: busiest overall but flat
  row('Rosario', '2024-01-01', 40), row('Rosario', '2025-07-01', 5), row('Rosario', '2025-08-01', 5),
  row('Rosario', '2025-09-01', 5), row('Rosario', '2025-10-01', 5), row('Rosario', '2025-11-01', 5), row('Rosario', '2025-12-01', 5),
  // Pinagbuhatan: only +1 -> below the noise floor
  row('Pinagbuhatan', '2025-09-01', 1), row('Pinagbuhatan', '2025-12-01', 2),
];
const risk = [
  { name: 'ugong', risk_class: 'High' },          // different casing from the case data
  { name: 'Rosario', risk_class: 'Medium' },
  { name: 'Pinagbuhatan', risk_class: 'No Data' },
];
const forecasts = [
  { barangay_name: 'Ugong', period: '2026-01-01', forecasted_count: 5, method: 'arima' },        // avg 3 -> +67%
  { barangay_name: 'Rosario', period: '2026-01-01', forecasted_count: 5, method: 'arima' },      // avg 5 -> flat
  { barangay_name: 'Pinagbuhatan', period: '2026-01-01', forecasted_count: 9, method: 'insufficient_data' }, // ignored
];
const byKey = (recs, key) => recs.find((r) => r.key === key);

test('years are listed newest first and barangay names are de-duplicated A-Z', () => {
  assert.deepEqual(dataYears(monthly), ['2025', '2024']);
  assert.deepEqual(barangayNames(monthly, risk), ['Pinagbuhatan', 'Rosario', 'Ugong']);
});

test('High-risk comes straight from the RF class and uses the case-data spelling', () => {
  const rec = byKey(recommendFilters({ monthly, risk, forecasts }), 'high_risk');
  assert.deepEqual(rec.barangays, ['Ugong']);
  assert.equal(rec.count, 1);
});

test('Rising cases needs a real increase (2+), not a single extra case', () => {
  const rec = byKey(recommendFilters({ monthly, risk, forecasts }), 'rising');
  assert.deepEqual(rec.barangays, ['Ugong']);
});

test('Expected to rise compares the next forecast with the recent average and skips insufficient data', () => {
  const rec = byKey(recommendFilters({ monthly, risk, forecasts }), 'forecast_up');
  assert.deepEqual(rec.barangays, ['Ugong']);
});

test('Highest burden ranks by total recorded cases', () => {
  const rec = byKey(recommendFilters({ monthly, risk, forecasts }), 'top_burden');
  assert.equal(rec.barangays[0], 'Rosario');
  assert.equal(rec.barangays.length, 3);
});

test('Latest year is a year filter', () => {
  const rec = byKey(recommendFilters({ monthly, risk, forecasts }), 'latest_year');
  assert.equal(rec.kind, 'year');
  assert.equal(rec.year, '2025');
});

test('with no data every recommendation reports nothing to apply', () => {
  const recs = recommendFilters({ monthly: [], risk: [], forecasts: [] });
  assert.ok(recs.every((r) => r.count === 0));
});

test('a recommendation is never offered with zero matches as if it had some', () => {
  const recs = recommendFilters({ monthly, risk: [{ name: 'Ugong', risk_class: 'Low' }], forecasts: [] });
  assert.equal(byKey(recs, 'high_risk').count, 0);
  assert.equal(byKey(recs, 'forecast_up').count, 0);
});

test('scoping by barangay ignores case and spacing, and no scope returns everything', () => {
  assert.equal(scopeByBarangay(monthly, ['  UGONG ']).length, 6);
  assert.equal(scopeByBarangay(monthly, null).length, monthly.length);
  assert.equal(scopeByBarangay(risk, ['Ugong'], 'name').length, 1);
});

test('scoping monthly rows by year and barangay together', () => {
  assert.equal(scopeMonthly(monthly, { year: '2024' }).length, 1);
  assert.equal(scopeMonthly(monthly, { year: '2025', barangays: ['Rosario'] }).length, 6);
  assert.equal(scopeMonthly(monthly, {}).length, monthly.length);
});

test('the query string repeats barangay for each name, and can leave barangays out', () => {
  assert.equal(filterQuery({}), '');
  assert.equal(filterQuery({ year: '2025', barangays: ['A', 'B C'] }), '?year=2025&barangay=A&barangay=B+C');
  assert.equal(filterQuery({ year: '2025', barangays: ['A'] }, { withBarangays: false }), '?year=2025');
});
