/**
 * TBInsight — "best achievable" evaluation references (achievable.js). Pure, no DB.
 * Run: node --test BACKEND/test/tbinsight/achievable.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  poissonMeanAbsDeviation, trueRates, forecastErrorFloor, riskBandCeiling, lowHighConfusion, bandsByRank, priorityAccuracy,
} = require('../../tbinsight/achievable');

const months = n => Array.from({ length: n }, (_, i) =>
  `${2023 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`);
const series = (name, counts) => counts.map((c, i) => ({ barangay_name: name, month: months(counts.length)[i], case_count: c }));

describe('poissonMeanAbsDeviation', () => {
  it('matches the exact Poisson mean absolute deviation', () => {
    // λ = 1: E|Y-1| = P(0)·1 + Σ_{k≥2}(k-1)P(k) = 2/e
    assert.ok(Math.abs(poissonMeanAbsDeviation(1) - 2 / Math.E) < 1e-12);
    assert.strictEqual(poissonMeanAbsDeviation(0), 0);
    // large λ approaches the normal value sqrt(2λ/π)
    assert.ok(Math.abs(poissonMeanAbsDeviation(400) - Math.sqrt(800 / Math.PI)) < 0.1);
  });
});

describe('trueRates', () => {
  it('is each barangay mean scaled by the city seasonal factor', () => {
    const counts = Array.from({ length: 24 }, (_, i) => (i % 12 === 6 ? 20 : 10));
    const rates = trueRates({ A: series('A', counts) });
    assert.ok(Math.abs(rates.A['2023-07-01'] - 20) < 1e-9);
    assert.ok(Math.abs(rates.A['2023-01-01'] - 10) < 1e-9);
  });
});

describe('forecastErrorFloor', () => {
  it('averages the chance error of the true rate over the evaluated months only', () => {
    const s = { A: series('A', Array(24).fill(4)) };
    const floor = forecastErrorFloor([{ barangay_name: 'A', steps: [{ month: '2024-01-01' }, { month: '2024-02-01' }] }], s);
    assert.ok(Math.abs(floor - poissonMeanAbsDeviation(4)) < 1e-9);
    assert.strictEqual(forecastErrorFloor([], s), null);
  });
});

describe('riskBandCeiling', () => {
  const pop = name => ({ population: 10_000, available: true, name });
  const popMap = { 2023: {}, 2024: {} };
  const names = ['A', 'B', 'C', 'D', 'E', 'F'];
  names.forEach(n => { popMap[2023][n] = pop(n); popMap[2024][n] = pop(n); });

  it('is near 100% when rates are far apart, and lower when they are close', () => {
    const far = Object.fromEntries(names.map((n, i) => [n, series(n, Array(24).fill(5 + i * 200))]));
    const close = Object.fromEntries(names.map((n, i) => [n, series(n, Array(24).fill(5 + i))]));
    const labelMonths = ['2024-01-01', '2024-02-01'];
    const high = riskBandCeiling(far, popMap, labelMonths, 3, { draws: 50 });
    const low = riskBandCeiling(close, popMap, labelMonths, 3, { draws: 50 });
    assert.ok(high > 0.99, `far apart: ${high}`);
    assert.ok(low < high, `close: ${low}`);
  });

  it('gives the same figure for the same data (seeded)', () => {
    const s = Object.fromEntries(names.map((n, i) => [n, series(n, Array(24).fill(3 + i))]));
    const a = riskBandCeiling(s, popMap, ['2024-03-01'], 3, { draws: 20 });
    assert.strictEqual(a, riskBandCeiling(s, popMap, ['2024-03-01'], 3, { draws: 20 }));
  });
});

describe('bandsByRank and lowHighConfusion', () => {
  it('bands 30 barangays 10 / 8 / 12 like the RF labels', () => {
    const b = bandsByRank(Array.from({ length: 30 }, (_, i) => i));
    assert.deepStrictEqual([0, 1, 2].map(k => b.filter(x => x === k).length), [10, 8, 12]);
  });

  it('counts only Low<->High mix-ups', () => {
    const cm = { Low: { Low: 8, Medium: 1, High: 1 }, Medium: { Low: 1, Medium: 6, High: 1 }, High: { Low: 1, Medium: 1, High: 10 } };
    assert.strictEqual(lowHighConfusion(cm), 2 / 30);
    assert.strictEqual(lowHighConfusion(null), null);
  });

  it('priority accuracy counts High vs not High only (a Low/Medium mix-up is right)', () => {
    const cm = { Low: { Low: 8, Medium: 1, High: 1 }, Medium: { Low: 1, Medium: 6, High: 1 }, High: { Low: 1, Medium: 1, High: 10 } };
    // Right: 8 + 1 + 1 + 6 (both not High) + 10 (both High) = 26 of 30
    assert.strictEqual(priorityAccuracy(cm), 26 / 30);
    assert.strictEqual(priorityAccuracy(null), null);
  });
});
