import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthByMonthForecastInsight, accuracySummary, scopeLabel } from '../src/utils/chartInsights.js';

test('month-by-month interpretation uses chronological forecast rows regardless of table sorting', () => {
  const rows = [
    { period: '2026-12', periodLabel: 'December 2026', forecasted: 14, ci_lower: 10, ci_upper: 19 },
    { period: '2026-10', periodLabel: 'October 2026', forecasted: 10, ci_lower: 0, ci_upper: 16 },
    { period: '2026-11', periodLabel: 'November 2026', forecasted: 22, ci_lower: 14, ci_upper: 31 },
  ];
  const text = monthByMonthForecastInsight(rows);
  assert.match(text, /3 forecast months/);
  assert.match(text, /10 to 22 cases/);
  assert.match(text, /November 2026 has the highest estimate/);
  assert.match(text, /likely range/);
  assert.doesNotMatch(text, /95%/);
});

test('month-by-month interpretation does not turn missing forecasts into zero cases', () => {
  const rows = [
    { period: '2026-10', periodLabel: 'October 2026', forecasted: null, isInsufficient: true },
    { period: '2026-11', periodLabel: 'November 2026', forecasted: 8, ci_lower: null, ci_upper: null },
  ];
  const text = monthByMonthForecastInsight(rows);
  assert.match(text, /November 2026 is projected to have 8 cases/);
  assert.match(text, /No likely range is available/);
  assert.match(text, /1 month has no estimate/);
  assert.doesNotMatch(text, /0 cases/);
  assert.match(monthByMonthForecastInsight(rows.slice(0, 1)), /No monthly case estimate is available/);
  assert.equal(monthByMonthForecastInsight([]), null);
});

test('accuracy summary: accuracy is 100% minus total error over total actual cases', () => {
  const points = [
    { label: 'Jan 2025', Actual: 100, Predicted: 90 },
    { label: 'Feb 2025', Actual: 100, Predicted: 110 },
    { label: 'Mar 2025', Actual: 200, Predicted: 200 },
  ];
  const s = accuracySummary(points);
  assert.equal(s.accuracy, 95); // 20 cases off out of 400
  assert.equal(s.avgOff, 7);    // (10 + 10 + 0) / 3, rounded
  assert.equal(s.months, 3);
  assert.equal(s.first, 'Jan 2025');
  assert.equal(s.last, 'Mar 2025');
  assert.equal(accuracySummary([]), null);
  assert.equal(accuracySummary([{ label: 'Jan 2025', Actual: 0, Predicted: 0 }]), null);
});

test('scope label names the barangay or the whole city', () => {
  assert.equal(scopeLabel('Pinagbuhatan'), 'Barangay Pinagbuhatan');
  assert.equal(scopeLabel(''), 'Pasig City (all barangays)');
  assert.equal(scopeLabel(null), 'Pasig City (all barangays)');
});
