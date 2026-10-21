/**
 * "High priority" hotspot alert: lists the High barangays with the same 12-month rate as the
 * High risk alert (rolling_12m_incidence), highest first. It never shows the legacy weighted
 * risk_score, which does not decide the risk level and disagrees with it.
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
const insert = (pool) => pool.calls.find((c) => c.sql.includes('INSERT INTO alerts')).params;

test('prints the 12-month rate, not the legacy single-month figure', async () => {
  // Live case: Santa Rosa read 2301.1 (legacy) here but 1150.5 in the High risk alert.
  const pool = poolWith([{ barangay_name: 'Santa Rosa', risk_score: 52.6, incidence_per_100k: 2301.1, rate_12m: '1150.5' }]);
  await evaluateHotspotAlerts(pool, '2026-10-01');
  const m = insert(pool)[3];
  assert.match(m, /Santa Rosa \(1150\.5\/100k\)/);
  assert.ok(!m.includes('2301.1'), m);
  assert.match(m, /Rates are cases per 100,000 over the past 12 months\./);
});

test('never shows the legacy weighted score, and does not read it', async () => {
  const pool = poolWith([{ barangay_name: 'Manggahan', risk_score: 55.0, rate_12m: '767.6' }]);
  await evaluateHotspotAlerts(pool, '2026-10-01');
  assert.ok(!/score/i.test(insert(pool)[3]), insert(pool)[3]);
  const select = pool.calls.find((c) => c.sql.includes("risk_class = 'High'")).sql;
  assert.ok(!/\brisk_score\b/.test(select), select);
});

test('lists barangays by 12-month rate, highest first (same order as the High risk alert)', async () => {
  const pool = poolWith([
    { barangay_name: 'Manggahan', rate_12m: '767.6' },
    { barangay_name: 'Kapasigan', rate_12m: '1405.1' },
    { barangay_name: 'Santa Rosa', rate_12m: '1150.5' },
  ]);
  await evaluateHotspotAlerts(pool, '2026-10-01');
  assert.match(insert(pool)[3], /Kapasigan \(1405\.1\/100k\); Santa Rosa \(1150\.5\/100k\); Manggahan \(767\.6\/100k\)/);
});

test('reads the 12-month rate as text and converts it in JS', async () => {
  const pool = poolWith([{ barangay_name: 'A', rate_12m: '900' }]);
  await evaluateHotspotAlerts(pool, '2026-10-01');
  const select = pool.calls.find((c) => c.sql.includes("risk_class = 'High'")).sql;
  assert.match(select, /rolling_12m_incidence/);
  assert.ok(!/::(DOUBLE PRECISION|float|numeric)/i.test(select), 'one bad value cannot fail the query');
});

test('a missing or malformed rate shows the name only, listed last', async () => {
  const pool = poolWith([
    { barangay_name: 'A', rate_12m: null },
    { barangay_name: 'B', rate_12m: 'NaN' },
    { barangay_name: 'C', rate_12m: '500' },
  ]);
  await evaluateHotspotAlerts(pool, '2026-10-01');
  assert.match(insert(pool)[3], /C \(500\.0\/100k\); A; B\./);
});

test('severity is "high" (no longer set by the legacy score)', async () => {
  const pool = poolWith([{ barangay_name: 'A', risk_score: 95, rate_12m: '900' }]);
  await evaluateHotspotAlerts(pool, '2026-10-01');
  assert.equal(insert(pool)[2], 'high');
});
