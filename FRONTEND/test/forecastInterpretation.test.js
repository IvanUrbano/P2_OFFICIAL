import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthByMonthForecastInsight } from '../src/utils/chartInsights.js';

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
  assert.match(text, /95% ranges show uncertainty/);
});

test('month-by-month interpretation does not turn missing forecasts into zero cases', () => {
  const rows = [
    { period: '2026-10', periodLabel: 'October 2026', forecasted: null, isInsufficient: true },
    { period: '2026-11', periodLabel: 'November 2026', forecasted: 8, ci_lower: null, ci_upper: null },
  ];
  const text = monthByMonthForecastInsight(rows);
  assert.match(text, /November 2026 is projected to have 8 cases/);
  assert.match(text, /No 95% range is available/);
  assert.match(text, /1 month has no estimate/);
  assert.doesNotMatch(text, /0 cases/);
  assert.match(monthByMonthForecastInsight(rows.slice(0, 1)), /No monthly case estimate is available/);
  assert.equal(monthByMonthForecastInsight([]), null);
});
