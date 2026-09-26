/**
 * TBInsight — Pipeline feature-building tests (calendar, RF training rows)
 *
 * Pure logic only: the DB module is stubbed, so no database or ML service is needed.
 * Run: node --test BACKEND/test/tbinsight/pipelineFeatures.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const dbPath = require.resolve('../../db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { query: async () => ({ rows: [] }), connect: async () => ({}) },
};

const { buildDenseSeries, buildTrainingRows } = require('../../tbinsight/pipeline');
const { monthKey, classifyByTertile } = require('../../tbinsight/scoring');

// pg returns DATE columns as JS Dates at local midnight
const localDate = (y, m) => new Date(y, m - 1, 1);

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
    return buildTrainingRows(seriesByBarangay, pops);
  };

  it('yields rows from 12 months of history (window shrinks to 6)', () => {
    const rows = build({ A: twelve(10), B: twelve(5) }, { A: 100000, B: 100000 });
    // 12 months, window 6 -> 6 target months x 2 barangays
    assert.strictEqual(rows.length, 12);
  });

  it('returns no rows when history is too short', () => {
    assert.strictEqual(build({ A: [1, 2, 3], B: [1, 2, 3] }, { A: 1000, B: 1000 }).length, 0);
  });

  it('annualizes forecasted_incidence once, in the same units as the label', () => {
    const rows = build({ A: twelve(10), B: twelve(10) }, { A: 100000, B: 100000 });
    // 10 cases/month in 100k people -> 10 * 12 = 120 per 100k per year
    for (const r of rows) {
      assert.ok(Math.abs(r.features.forecasted_incidence - 120) < 1e-9);
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
    // First target month is index 6 (window 6): lag_1m is month 5 (=0), lag_2m month 4 (=8)
    const first = rows.find(r => r.features.lag_2m === 8);
    assert.ok(first, 'lag_2m should read the calendar month two back, zeros included');
    assert.strictEqual(first.features.lag_1m, 0);
  });

  it('emits rows month-major so walk-forward evaluation can group by month', () => {
    const rows = build({ A: twelve(10), B: twelve(20) }, { A: 100000, B: 100000 });
    // Pairs (A, B) per month: incidences alternate 120, 240
    assert.deepStrictEqual(rows.slice(0, 4).map(r => Math.round(r.incidence)), [120, 240, 120, 240]);
  });
});

describe('classifyByTertile', () => {
  it('splits 30 scores into 10 / 10 / 10 even when they bunch in a narrow band', () => {
    // Scores 30..45 like a real run: fixed 33/66 cutoffs would call almost all of these Medium
    const scores = Array.from({ length: 30 }, (_, i) => 30 + i * 0.5);
    const { classes } = classifyByTertile(scores);
    const count = (c) => classes.filter(x => x === c).length;
    assert.strictEqual(count('Low'), 10);
    assert.strictEqual(count('Medium'), 10);
    assert.strictEqual(count('High'), 10);
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
