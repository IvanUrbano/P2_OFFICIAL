/**
 * TBInsight — Case Fatality Rate (CFR)
 *
 * CFR = DIED / (CURED + TREATMENT COMPLETED + DIED + TREATMENT FAILED +
 *       LOST TO FOLLOW-UP) × 100
 *
 * The denominator is evaluated terminal outcomes only: ON TREATMENT is
 * excluded (that case hasn't reached a terminal outcome yet) and NOT
 * EVALUATED is excluded (no outcome was ever recorded). This single
 * definition is the one authoritative source for CFR across TBInsight —
 * Dashboard, Analytics, Reports, and NLG must all call this function rather
 * than computing their own version independently.
 *
 * Returns `rate: null` (never 0%) when the denominator is 0.
 *
 * Not sourced from or labeled as an official DOH formula — this is
 * TBInsight's own defined methodology unless a documented project source
 * establishes otherwise.
 *
 * Takes `pool` as an explicit parameter (like computeTreatmentSuccessRate in
 * treatmentSuccessRate.js) so callers can inject a mock pool in tests.
 */

const { EVALUATED_TERMINAL_OUTCOMES } = require('./outcomeNormalization');
const { barangayList } = require('./barangayFilter');

/**
 * @param {object} pool - pg Pool (or a mock exposing the same `query` shape)
 * @param {object} [opts]
 * @param {number|string} [opts.year] - Filter by EXTRACT(YEAR FROM date_of_diagnosis).
 * @param {number|string} [opts.month] - Filter by EXTRACT(MONTH FROM date_of_diagnosis).
 * @param {string|string[]} [opts.barangay] - Optional barangay_name filter (one name or a list).
 * @param {string} [opts.sex] - Optional sex filter.
 * @param {string} [opts.ageGroup] - Optional age group filter.
 * @param {string} [opts.facility] - Optional treatment_facility filter.
 * @param {string} [opts.bacteriological] - Optional bacteriological_status filter.
 * @returns {Promise<{rate: number|null, died: number, evaluated: number, total: number}>}
 */
async function computeCaseFatalityRate(pool, { year, month, barangay, sex, ageGroup, facility, bacteriological } = {}) {
  // Two queries are built in LOCKSTEP, each with its own $1-based
  // placeholder series and its own params array:
  //   - conditions/params     → evaluated-outcomes query ($1 = outcome array)
  //   - totalConditions/totalParams → total-count query (no outcome condition)
  // A prior version sliced both arrays from one shared pair, which left
  // $2..$n placeholders in the total query's SQL while supplying only
  // values[0].. — Postgres rejected that bind ("could not determine data
  // type of parameter $1") for ANY param-bearing filter, 500-ing the NLG
  // insight endpoint and the CFR KPI whenever a filter was active.
  const conditions = [`treatment_outcome = ANY($1)`];
  const params = [EVALUATED_TERMINAL_OUTCOMES];
  const totalConditions = [];
  const totalParams = [];
  let idx = 2;
  let tIdx = 1;
  const add = (conditionFmt, value) => {
    conditions.push(conditionFmt(`$${idx}`));
    params.push(value);
    idx++;
    totalConditions.push(conditionFmt(`$${tIdx}`));
    totalParams.push(value);
    tIdx++;
  };

  if (year) add((ph) => `EXTRACT(YEAR FROM date_of_diagnosis) = ${ph}`, Number(year));
  if (month) add((ph) => `EXTRACT(MONTH FROM date_of_diagnosis) = ${ph}`, Number(month));
  const brgys = barangayList(barangay);
  if (brgys.length === 1) add((ph) => `TRIM(barangay_name) = ${ph}`, brgys[0]);
  else if (brgys.length > 1) add((ph) => `TRIM(barangay_name) = ANY(${ph}::text[])`, brgys);
  if (sex) add((ph) => `TRIM(sex) ILIKE ${ph}`, sex);
  if (ageGroup) {
    const ag = ageGroup;
    let agCond = null;
    if (ag === '0-14') agCond = 'age <= 14';
    else if (ag === '15-24') agCond = 'age BETWEEN 15 AND 24';
    else if (ag === '25-34') agCond = 'age BETWEEN 25 AND 34';
    else if (ag === '35-44') agCond = 'age BETWEEN 35 AND 44';
    else if (ag === '45-54') agCond = 'age BETWEEN 45 AND 54';
    else if (ag === '55-64') agCond = 'age BETWEEN 55 AND 64';
    else if (ag === '65+') agCond = 'age >= 65';
    if (agCond) {
      conditions.push(agCond);
      totalConditions.push(agCond);
    }
  }
  if (facility) add((ph) => `TRIM(treatment_facility) = ${ph}`, facility);
  if (bacteriological) add((ph) => `TRIM(bacteriological_status) ILIKE ${ph}`, bacteriological);

  const [evalResult, totalResult] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::INTEGER AS evaluated,
         SUM(CASE WHEN treatment_outcome = 'DIED' THEN 1 ELSE 0 END)::INTEGER AS died
       FROM tb_cases
       WHERE ${conditions.join(' AND ')}`,
      params
    ),
    totalConditions.length > 0
      ? pool.query(
          `SELECT COUNT(*)::INTEGER AS total FROM tb_cases WHERE ${totalConditions.join(' AND ')}`,
          totalParams
        )
      : pool.query(`SELECT COUNT(*)::INTEGER AS total FROM tb_cases`),
  ]);

  const row = evalResult.rows[0] || {};
  const evaluated = row.evaluated || 0;
  const died = row.died || 0;
  const total = (totalResult.rows[0] || {}).total || 0;
  const rate = evaluated > 0
    ? Math.round((died / evaluated) * 1000) / 10
    : null;

  return { rate, died, evaluated, total };
}

module.exports = { computeCaseFatalityRate, EVALUATED_TERMINAL_OUTCOMES };
