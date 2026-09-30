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

const EVALUATED_TERMINAL_OUTCOMES = [
  'CURED',
  'TREATMENT COMPLETED',
  'DIED',
  'TREATMENT FAILED',
  'LOST TO FF-UP',
  'LOST TO FOLLOW-UP',
];

/**
 * @param {object} pool - pg Pool (or a mock exposing the same `query` shape)
 * @param {object} [opts]
 * @param {number|string} [opts.year] - Filter by EXTRACT(YEAR FROM date_of_diagnosis).
 * @param {string} [opts.barangay] - Optional barangay_name filter.
 * @returns {Promise<{rate: number|null, died: number, evaluated: number}>}
 */
async function computeCaseFatalityRate(pool, { year, barangay } = {}) {
  const conditions = [`UPPER(outcome_status) = ANY($1)`];
  const params = [EVALUATED_TERMINAL_OUTCOMES];

  if (year) {
    conditions.push(`EXTRACT(YEAR FROM date_of_diagnosis) = $${params.length + 1}`);
    params.push(Number(year));
  }
  if (barangay) {
    conditions.push(`TRIM(barangay_name) = $${params.length + 1}`);
    params.push(barangay);
  }

  const result = await pool.query(
    `SELECT
       COUNT(*)::INTEGER AS evaluated,
       SUM(CASE WHEN UPPER(outcome_status) = 'DIED' THEN 1 ELSE 0 END)::INTEGER AS died
     FROM tb_cases
     WHERE ${conditions.join(' AND ')}`,
    params
  );

  const row = result.rows[0] || {};
  const evaluated = row.evaluated || 0;
  const died = row.died || 0;
  const rate = evaluated > 0
    ? Math.round((died / evaluated) * 1000) / 10
    : null;

  return { rate, died, evaluated };
}

module.exports = { computeCaseFatalityRate, EVALUATED_TERMINAL_OUTCOMES };
