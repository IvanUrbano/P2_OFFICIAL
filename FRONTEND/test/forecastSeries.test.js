import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastMonthKey, aggregateForecastHistory, calculateForecastGrowth } from '../src/utils/forecastSeries.js';

test('Pasig DATE serialization retains its calendar month across browser timezones', () => {
  assert.equal(forecastMonthKey('2025-12-31T16:00:00.000Z'), '2026-01');
  assert.equal(forecastMonthKey('2026-01-01'), '2026-01');
});

test('historical monthly counts sum across barangays and keep actual months', () => {
  const history = aggregateForecastHistory([
    { month: '2024-12-31T16:00:00.000Z', case_count: 4 },
    { month: '2025-01-01', case_count: 5 },
    { month: '2025-02-01', case_count: 6 },
  ]);
  assert.deepEqual(history.map(row => [row.month, row.cases]), [['2025-01', 9], ['2025-02', 6]]);
  assert.equal(history.reduce((sum, row) => sum + row.cases, 0), 15);
});

test('growth compares first persisted forecast month with the actual monthly baseline', () => {
  const history = aggregateForecastHistory([
    { month: '2025-01-01', case_count: 10 },
    { month: '2025-03-01', case_count: 20 },
  ]);
  const growth = calculateForecastGrowth(history, [{ period: '2025-04', forecasted: 20, hasForecast: true }]);
  assert.equal(growth.baseline, 10); // February is an observed zero-case gap.
  assert.equal(growth.rate, 100);
});

test('existing forecast with no pre-forecast baseline reports the actual reason', () => {
  const growth = calculateForecastGrowth([], [{ period: '2026-01', forecasted: 5, hasForecast: true }]);
  assert.equal(growth.rate, null);
  assert.match(growth.reason, /No historical data before forecast start/);
});
