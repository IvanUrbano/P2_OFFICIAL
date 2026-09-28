/**
 * TBInsight — Treatment Success Rate (TSR)
 *
 * TSR(Y) = (Cured + Treatment Completed) / (patients whose treatment
 *          started in year Y-1) × 100
 *
 * Cohort membership uses date_started_treatment, NOT date_of_diagnosis and
 * NOT the date an outcome was recorded: treatment outcomes can be recorded
 * months after a patient starts treatment, so filtering by outcome-recorded
 * date would exclude patients whose outcome hasn't landed yet and
 * understate the rate. The numerator and denominator both come from the
 * SAME Y-1 treatment-start cohort — this is the one thing every caller of
 * this function gets for free and must not reimplement separately, since a
 * prior version of this system had four different frontend "Success Rate"
 * cards each computing a different, diagnosis-date-filtered metric under
 * the same label as this one.
 *
 * Returns `successRate: null` (never 0) when the cohort is empty.
 *
 * Takes `pool` as an explicit parameter (like computeTreatmentCascade in
 * treatmentCascade.js) rather than requiring BACKEND/db.js internally, so
 * callers can inject a mock pool in tests instead of hitting the real
 * database.
 */

/**
 * @param {object} pool - pg Pool (or a mock exposing the same `query` shape)
 * @param {object} [opts]
 * @param {number|string} [opts.year] - Reporting year Y; cohort is Y-1.
 *   Defaults to the current calendar year if omitted.
 * @param {string} [opts.barangay] - Optional barangay_name filter.
 * @returns {Promise<{successRate: number|null, cohortYear: number,
 *   cohortTotal: number, cohortCured: number, cohortCompleted: number}>}
 */
async function computeTreatmentSuccessRate(pool, { year, barangay } = {}) {
  const reportingYear = year ? Number(year) : new Date().getFullYear();
  const cohortYear = reportingYear - 1;

  const conditions = ['EXTRACT(YEAR FROM date_started_treatment) = $1'];
  const params = [cohortYear];
  if (barangay) {
    conditions.push(`TRIM(barangay_name) = $${params.length + 1}`);
    params.push(barangay);
  }

  const result = await pool.query(
    `SELECT
       COUNT(*)::INTEGER AS total_patients,
       SUM(CASE WHEN UPPER(outcome_status) = 'CURED' THEN 1 ELSE 0 END)::INTEGER AS cured_count,
       SUM(CASE WHEN UPPER(outcome_status) = 'TREATMENT COMPLETED' THEN 1 ELSE 0 END)::INTEGER AS completed_count
     FROM tb_cases
     WHERE ${conditions.join(' AND ')}`,
    params
  );

  const row = result.rows[0] || {};
  const cohortTotal = row.total_patients || 0;
  const cohortCured = row.cured_count || 0;
  const cohortCompleted = row.completed_count || 0;
  const successRate = cohortTotal > 0
    ? Math.round(((cohortCured + cohortCompleted) / cohortTotal) * 1000) / 10
    : null;

  return { successRate, cohortYear, cohortTotal, cohortCured, cohortCompleted };
}

module.exports = { computeTreatmentSuccessRate };
