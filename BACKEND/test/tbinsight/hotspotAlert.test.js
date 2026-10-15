/**
 * "High priority" hotspot alert: the rate it prints must be the same 12-month rate as the
 * High risk alert (rolling_12m_incidence), not the legacy latest-month x 12 figure.
 * Mock pool only — the real db module is stubbed.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const dbModule = require.resolve('../../db');
require.cache[dbModule] = { id: dbModule, filename: dbModule, loaded: true, exports: {} };
const { evaluateHotspotAlerts } = require('../../tbinsight/alertEngine');

function poolWith(rows) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      const s = String(sql).replace(/\s+/g, ' ');
      calls.push({ sql: s, params });
      if (s.includes("risk_class = 'High'")) return { rows };
      if (s.includes('INSERT INTO alerts')) return { rows: [{ id: 9 }] };
      return { rows: [] };
    },
  };
}
const message = (pool) => pool.calls.find((c) => c.sql.includes('INSERT INTO alerts')).params[3];

test('prints the 12-month rate, not the legacy single-month figure', async () => {
  // Live case: Santa Rosa read 2301.1 (legacy) here but 1150.5 in the High risk alert.
  const pool = poolWith([
    { barangay_name: 'Santa Rosa', risk_score: 52.6, incidence_per_100k: 2301.1, rate_12m: '1150.5' },
  ]);
  await evaluateHotspotAlerts(pool, '2026-10-01');
  const m = message(pool);
  assert.match(m, /Santa Rosa \(score: 52\.6, 1150\.5\/100k\)/);
  assert.ok(!m.includes('2301.1'), m);
  assert.match(m, /Rates are cases per 100,000 over the past 12 months\./);
});

test('reads the 12-month rate from the stored features', async () => {
  const pool = poolWith([{ barangay_name: 'A', risk_score: 50, rate_12m: '900' }]);
  await evaluateHotspotAlerts(pool, '2026-10-01');
  assert.match(pool.calls[1].sql, /rolling_12m_incidence/);
  assert.ok(!/::(DOUBLE PRECISION|float|numeric)/i.test(pool.calls[1].sql), 'converted in JS, so one bad value cannot fail the query');
});

test('a missing or malformed rate shows the score only', async () => {
  const pool = poolWith([
    { barangay_name: 'A', risk_score: 60, rate_12m: null },
    { barangay_name: 'B', risk_score: 50, rate_12m: 'NaN' },
  ]);
  await evaluateHotspotAlerts(pool, '2026-10-01');
  const m = message(pool);
  assert.match(m, /A \(score: 60\.0\); B \(score: 50\.0\)/);
  assert.ok(!m.includes('Rates are cases'), m);
});
