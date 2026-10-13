const { test } = require('node:test');
const assert = require('node:assert/strict');
const dbModule = require.resolve('../../db');
require.cache[dbModule] = { id: dbModule, filename: dbModule, loaded: true, exports: {} };
const {
  CASE_INCREASE, isCaseIncrease, riseProbabilityByChance, evaluateCaseIncreaseAlerts,
} = require('../../tbinsight/alertEngine');

// Seeded random numbers so the simulations give the same result every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(mean, rand) {
  // Knuth for small means, normal approximation for large ones.
  if (mean > 60) return Math.max(0, Math.round(mean + Math.sqrt(mean) * gaussian(rand)));
  const limit = Math.exp(-mean);
  let k = 0;
  let p = rand();
  while (p > limit) { k++; p *= rand(); }
  return k;
}

function gaussian(rand) {
  return Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
}

test('chance probability: equal counts are likely, a doubling of 20 cases is not', () => {
  assert.ok(riseProbabilityByChance(20, 20) > 0.5);
  assert.ok(riseProbabilityByChance(40, 20) < 0.01);
  assert.equal(riseProbabilityByChance(0, 0), 1);
  // Large counts must not underflow to NaN.
  const p = riseProbabilityByChance(1300, 1200);
  assert.ok(Number.isFinite(p) && p > 0 && p < 0.05);
});

test('a small rise is not a surge even when the percentage is large', () => {
  assert.equal(isCaseIncrease(6, 5), false);   // +20%, 1 case
  assert.equal(isCaseIncrease(3, 1), false);   // +200%, 2 cases
  assert.equal(isCaseIncrease(4, 1), false);   // +3 cases but easily chance
});

test('a rise that is large and unlikely by chance is a surge', () => {
  assert.equal(isCaseIncrease(70, 45), true);
  assert.equal(isCaseIncrease(12, 2), true);
});

test('a rise under 20% is not a surge even when it is unlikely by chance', () => {
  assert.equal(isCaseIncrease(1150, 1000), false); // +15%
});

test('ordinary month-to-month chance rarely raises an alert', () => {
  // 30 barangays at a steady rate (2-25 cases a month), 3-month totals compared with
  // the same 3 months a year earlier. The old rule fired for ~31% of barangay-months.
  const rand = rng(42);
  let fired = 0;
  let checks = 0;
  for (let trial = 0; trial < 400; trial++) {
    for (let b = 0; b < 30; b++) {
      const monthly = 2 + (b * 23) / 29;
      const prior = poisson(monthly * 3, rand);
      const recent = poisson(monthly * 3, rand);
      checks++;
      if (isCaseIncrease(recent, prior)) fired++;
    }
  }
  const rate = fired / checks;
  assert.ok(rate < 0.05, `false alarm rate ${(rate * 100).toFixed(1)}%`);
});

test('a real outbreak (+60% for 3 months) is caught in about 7 of 10 barangays', () => {
  const rand = rng(7);
  let caught = 0;
  let checks = 0;
  for (let trial = 0; trial < 400; trial++) {
    for (let b = 0; b < 30; b++) {
      const monthly = 5 + (b * 20) / 29; // 5-25 cases a month
      const prior = poisson(monthly * 3, rand);
      const recent = poisson(monthly * 3 * 1.6, rand);
      checks++;
      if (isCaseIncrease(recent, prior)) caught++;
    }
  }
  const rate = caught / checks;
  assert.ok(rate > 0.65, `caught ${(rate * 100).toFixed(1)}%`);
});

function stubDb(rows) {
  const calls = { inserts: [], selects: [] };
  return {
    calls,
    async query(sql, params) {
      if (sql.startsWith('DELETE FROM alerts')) return { rowCount: 0 };
      if (sql.includes('FROM monthly_case_summary')) {
        calls.selects.push(params);
        return { rows };
      }
      if (sql.startsWith('SELECT id FROM alerts')) return { rows: [] };
      if (sql.startsWith('INSERT INTO alerts')) {
        calls.inserts.push(params);
        return { rows: [{ id: 9 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('evaluate: lists only barangays with a real surge, compares with the same months last year', async () => {
  const db = stubDb([
    { barangay_name: 'Pinagbuhatan', end_month: '2026-08-01', recent_count: 70, prior_count: 45, prior_rows: 3 },
    { barangay_name: 'Santolan', end_month: '2026-08-01', recent_count: 22, prior_count: 18, prior_rows: 3 },
    { barangay_name: 'Kapitolyo', end_month: '2026-08-01', recent_count: 3, prior_count: 1, prior_rows: 3 },
  ]);

  // The pipeline passes the forecast month, which has no cases yet.
  const ids = await evaluateCaseIncreaseAlerts(db, '2026-09-01');
  assert.deepEqual(ids, [9]);
  assert.equal(db.calls.selects[0][0], '2026-09-01');

  const [title, , , message, , , period, , metadata] = db.calls.inserts[0];
  assert.match(title, /Rapid Increase/);
  assert.match(message, /Pinagbuhatan/);
  assert.doesNotMatch(message, /Santolan|Kapitolyo/);
  assert.match(message, /Jun–Aug 2026/);
  assert.match(message, /same months in 2025/);
  assert.equal(period, '2026-09-01');
  const meta = JSON.parse(metadata);
  assert.deepEqual(meta.affected_barangays, ['Pinagbuhatan']);
  assert.equal(meta.window_end, '2026-08-01');
  assert.equal(meta.window_months, CASE_INCREASE.WINDOW_MONTHS);
});

test('evaluate: no alert when there is no data for the same months last year', async () => {
  const db = stubDb([
    { barangay_name: 'Pinagbuhatan', end_month: '2023-03-01', recent_count: 70, prior_count: 0, prior_rows: 0 },
    { barangay_name: 'Santolan', end_month: '2023-03-01', recent_count: 40, prior_count: 0, prior_rows: 0 },
  ]);
  const ids = await evaluateCaseIncreaseAlerts(db, '2023-04-01');
  assert.deepEqual(ids, []);
  assert.equal(db.calls.inserts.length, 0);
});

test('evaluate: no alert when no barangay rose', async () => {
  const db = stubDb([
    { barangay_name: 'Santolan', end_month: '2026-08-01', recent_count: 20, prior_count: 21, prior_rows: 3 },
  ]);
  assert.deepEqual(await evaluateCaseIncreaseAlerts(db, '2026-09-01'), []);
});
