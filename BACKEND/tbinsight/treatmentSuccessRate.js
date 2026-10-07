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
 * Takes `pool` as an explicit parameter rather than requiring BACKEND/db.js internally, so
 * callers can inject a mock pool in tests instead of hitting the real
 * database.
 */

const { barangayCondition } = require('./barangayFilter');

/**
 * @param {object} pool - pg Pool (or a mock exposing the same `query` shape)
 * @param {object} [opts]
 * @param {number|string} [opts.year] - Reporting year Y; cohort is Y-1.
 *   Defaults to the current calendar year if omitted.
 * @param {string|string[]} [opts.barangay] - Optional barangay_name filter (one name or a list).
 * @param {string} [opts.sex] - Optional sex filter.
 * @param {string} [opts.ageGroup] - Optional age group filter.
 * @param {string} [opts.facility] - Optional treatment_facility filter.
 * @param {string} [opts.bacteriological] - Optional bacteriological_status filter.
 * @returns {Promise<{successRate: number|null, cohortYear: number,
 *   cohortTotal: number, cohortCured: number, cohortCompleted: number,
 *   cohortLtfu: number, cohortDied: number, cohortFailed: number, ltfuRate: number|null}>}
 *   The same cohort also yields its lost-to-follow-up / died / failed counts, so the success rate and
 *   the lost-to-follow-up rate always describe the same patients. `ltfuRate` is lost to follow-up
 *   over the WHOLE cohort (like the success rate), null when the cohort is empty.
 */
async function computeTreatmentSuccessRate(pool, { year, barangay, sex, ageGroup, facility, bacteriological } = {}) {
  const reportingYear = year ? Number(year) : new Date().getFullYear();
  const cohortYear = reportingYear - 1;

  const conditions = ['EXTRACT(YEAR FROM date_started_treatment) = $1'];
  const params = [cohortYear];
  let idx = 2;

  const brgy = barangayCondition('barangay_name', `$${idx}`, barangay);
  if (brgy) {
    conditions.push(brgy.sql);
    params.push(brgy.value);
    idx++;
  }
  if (sex) {
    conditions.push(`TRIM(sex) ILIKE $${idx}`);
    params.push(sex);
    idx++;
  }
  if (ageGroup) {
    const ag = ageGroup;
    if (ag === '0-14') conditions.push('age <= 14');
    else if (ag === '15-24') conditions.push('age BETWEEN 15 AND 24');
    else if (ag === '25-34') conditions.push('age BETWEEN 25 AND 34');
    else if (ag === '35-44') conditions.push('age BETWEEN 35 AND 44');
    else if (ag === '45-54') conditions.push('age BETWEEN 45 AND 54');
    else if (ag === '55-64') conditions.push('age BETWEEN 55 AND 64');
    else if (ag === '65+') conditions.push('age >= 65');
  }
  if (facility) {
    conditions.push(`TRIM(treatment_facility) = $${idx}`);
    params.push(facility);
    idx++;
  }
  if (bacteriological) {
    conditions.push(`TRIM(bacteriological_status) ILIKE $${idx}`);
    params.push(bacteriological);
    idx++;
  }

  const result = await pool.query(
    `SELECT
       COUNT(*)::INTEGER AS total_patients,
       SUM(CASE WHEN treatment_outcome = 'CURED' THEN 1 ELSE 0 END)::INTEGER AS cured_count,
       SUM(CASE WHEN treatment_outcome = 'TREATMENT COMPLETED' THEN 1 ELSE 0 END)::INTEGER AS completed_count,
       SUM(CASE WHEN treatment_outcome = 'LOST TO FOLLOW-UP' THEN 1 ELSE 0 END)::INTEGER AS ltfu_count,
       SUM(CASE WHEN treatment_outcome = 'DIED' THEN 1 ELSE 0 END)::INTEGER AS died_count,
       SUM(CASE WHEN treatment_outcome = 'TREATMENT FAILED' THEN 1 ELSE 0 END)::INTEGER AS failed_count
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

  const cohortLtfu = row.ltfu_count || 0;
  const ltfuRate = cohortTotal > 0 ? Math.round((cohortLtfu / cohortTotal) * 1000) / 10 : null;

  return {
    successRate, cohortYear, cohortTotal, cohortCured, cohortCompleted,
    cohortLtfu, cohortDied: row.died_count || 0, cohortFailed: row.failed_count || 0, ltfuRate,
  };
}

module.exports = { computeTreatmentSuccessRate };
