/**
 * Low treatment success alert: judged on the same cohort Treatment Success Rate the
 * cards show (computeTreatmentSuccessRate), for the cohort before the period's year.
 * Mock pool only — the real db module is stubbed.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const dbModule = require.resolve('../../db');
require.cache[dbModule] = { id: dbModule, filename: dbModule, loaded: true, exports: {} };
const { evaluateTreatmentAlerts } = require('../../tbinsight/alertEngine');
const { TREATMENT_SUCCESS_TARGET } = require('../../tbinsight/targets');

function poolWith(cohort) {
  const calls = [];
  return {
    calls,
    inserts: () => calls.filter((c) => /INSERT INTO alerts/.test(c.sql)),
    query: async (sql, params) => {
      const s = String(sql).replace(/\s+/g, ' ');
      calls.push({ sql: s, params });
      if (s.includes('AS total_patients')) return { rows: [cohort] };
      if (s.includes('INSERT INTO alerts')) return { rows: [{ id: 7 }] };
      return { rows: [] };
    },
  };
}

// 2025 cohort as on the live Dashboard: (864 + 2614) / 4669 = 74.5%
const below = { total_patients: 4669, cured_count: 864, completed_count: 2614 };

test('a cohort below target raises the alert with the same rate the cards show', async () => {
  const pool = poolWith(below);
  const ids = await evaluateTreatmentAlerts(pool, '2026-10-01');
  assert.deepEqual(ids, [7]);
  const cohortYear = new Date().getFullYear() - 1;
  const cohortQuery = pool.calls.find((c) => c.sql.includes('AS total_patients'));
  assert.deepEqual(cohortQuery.params, [cohortYear], 'the same cohort as the cards: the previous calendar year');
  const [insert] = pool.inserts();
  assert.ok(insert.params[3].includes(`${cohortYear} treatment cohort is 74.5%`), insert.params[3]);
  assert.match(insert.params[3], new RegExp(`below the ${TREATMENT_SUCCESS_TARGET}% target`));
});

test('a cohort on target raises nothing', async () => {
  const pool = poolWith({ total_patients: 100, cured_count: 50, completed_count: TREATMENT_SUCCESS_TARGET - 50 });
  assert.deepEqual(await evaluateTreatmentAlerts(pool, '2026-10-01'), []);
  assert.equal(pool.inserts().length, 0);
});

test('an empty cohort raises nothing (no rate, not 0%)', async () => {
  const pool = poolWith({ total_patients: 0, cured_count: 0, completed_count: 0 });
  assert.deepEqual(await evaluateTreatmentAlerts(pool, '2026-10-01'), []);
});

test('the cohort does not follow the pipeline period (a January forecast month must not pick a cohort still on treatment)', async () => {
  const pool = poolWith(below);
  await evaluateTreatmentAlerts(pool, `${new Date().getFullYear() + 1}-01-01`);
  const cohortQuery = pool.calls.find((c) => c.sql.includes('AS total_patients'));
  assert.deepEqual(cohortQuery.params, [new Date().getFullYear() - 1]);
});

test('no longer reads one month of outcome_summary', async () => {
  const pool = poolWith(below);
  await evaluateTreatmentAlerts(pool, '2026-10-01');
  assert.ok(!pool.calls.some((c) => c.sql.includes('outcome_summary')));
});
