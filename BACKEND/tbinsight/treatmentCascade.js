/**
 * TBInsight — Treatment Cascade (shared calculation)
 *
 * Single source of truth for cascade stage definitions used by BOTH the
 * Dashboard and Analytics pages (via GET /api/tb/treatment-cascade).
 *
 * Core cascade stages (sequential):
 *   1. Diagnosed         — records with a valid date_of_diagnosis
 *   2. Started Treatment — date_started_treatment IS NOT NULL
 *   3. Evaluated         — terminal outcome recorded (see EVALUATED_OUTCOMES)
 *   4. Successful Outcome— CURED or TREATMENT COMPLETED
 *
 * Stage percentages (rates) are cascade progression metrics. They are NOT
 * the client-defined Treatment Success Rate (TSR), which is a separate
 * previous-year treatment-start cohort calculation handled in
 * insightDataBuilder.js. Do not label these rates as TSR.
 *
 * Outcome values are matched against the ACTUAL normalized values stored in
 * tb_cases (verified: 'TREATMENT COMPLETED', 'CURED', 'TREATMENT FAILED',
 * 'LOST TO FF-UP', 'DIED', 'EXCLUDED', ...). Tolerant variants are included
 * so future imports with alternate spellings still classify correctly.
 */

const { getOutcomeFilterValues } = require('./outcomeNormalization');

const EVALUATED_OUTCOMES = [
  'CURED',
  'TREATMENT COMPLETED',
  'TREATMENT FAILED',
  'FAILED', // tolerant variant
  'DIED',
  'LOST TO FF-UP', // actual DB value
  'LOST TO FOLLOW-UP', // tolerant variant
  'EXCLUDED',
];

const SUCCESS_OUTCOMES = ['CURED', 'TREATMENT COMPLETED'];

const IN_LIST = (arr) => arr.map((v) => `'${v}'`).join(',');

/** Safe percentage: returns null (not 0) when denominator is 0/missing. */
function pct(numerator, denominator) {
  if (!denominator || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100 * 10) / 10;
}

/**
 * Apply the same filter semantics as insightDataBuilder.applyFilters so the
 * cascade reflects exactly the same record set as other Analytics queries.
 *
 * @param {string[]} conditions
 * @param {any[]} params
 * @param {number} paramIdx
 * @param {object} filters - { year, month, barangay, sex, ageGroup, bacteriological, outcome }
 * @returns {number} next param index
 */
function applyCascadeFilters(conditions, params, paramIdx, filters) {
  let idx = paramIdx;
  if (filters.year) {
    conditions.push(`EXTRACT(YEAR FROM c.date_of_diagnosis) = $${idx}`);
    params.push(Number(filters.year));
    idx++;
  }
  if (filters.month) {
    conditions.push(`EXTRACT(MONTH FROM c.date_of_diagnosis) = $${idx}`);
    params.push(Number(filters.month));
    idx++;
  }
  if (filters.barangay) {
    conditions.push(`TRIM(c.barangay_name) = $${idx}`);
    params.push(filters.barangay);
    idx++;
  }
  if (filters.sex) {
    conditions.push(`TRIM(c.sex) ILIKE $${idx}`);
    params.push(filters.sex);
    idx++;
  }
  if (filters.ageGroup) {
    const ag = filters.ageGroup;
    if (ag === '0-14') conditions.push(`c.age <= 14`);
    else if (ag === '15-24') conditions.push(`c.age BETWEEN 15 AND 24`);
    else if (ag === '25-34') conditions.push(`c.age BETWEEN 25 AND 34`);
    else if (ag === '35-44') conditions.push(`c.age BETWEEN 35 AND 44`);
    else if (ag === '45-54') conditions.push(`c.age BETWEEN 45 AND 54`);
    else if (ag === '55-64') conditions.push(`c.age BETWEEN 55 AND 64`);
    else if (ag === '65+') conditions.push(`c.age >= 65`);
  }
  if (filters.bacteriological) {
    conditions.push(`TRIM(c.bacteriological_status) ILIKE $${idx}`);
    params.push(filters.bacteriological);
    idx++;
  }
  if (filters.outcome) {
    conditions.push(`UPPER(TRIM(c.outcome_status)) = ANY($${idx})`);
    params.push(getOutcomeFilterValues(filters.outcome));
    idx++;
  }
  return idx;
}

/**
 * Compute the treatment cascade for the given filters.
 *
 * @param {object} pool - pg Pool (or client) with .query()
 * @param {object} filters - see applyCascadeFilters
 * @returns {Promise<object>} { cascade, rates, breakdown, meta }
 */
async function computeTreatmentCascade(pool, filters = {}) {
  const conditions = [];
  const params = [];
  applyCascadeFilters(conditions, params, 1, filters);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `
    SELECT
      COUNT(*) FILTER (WHERE c.date_of_diagnosis IS NOT NULL)::INTEGER AS diagnosed,
      COUNT(*) FILTER (WHERE c.date_started_treatment IS NOT NULL)::INTEGER AS started_treatment,
      COUNT(*) FILTER (WHERE UPPER(TRIM(c.outcome_status)) IN (${IN_LIST(EVALUATED_OUTCOMES)}))::INTEGER AS evaluated,
      COUNT(*) FILTER (WHERE UPPER(TRIM(c.outcome_status)) IN (${IN_LIST(SUCCESS_OUTCOMES)}))::INTEGER AS successful_outcome,
      COUNT(*) FILTER (WHERE UPPER(TRIM(c.bacteriological_status)) = 'BACTERIOLOGICALLY-CONFIRMED TB')::INTEGER AS bacteriologically_confirmed,
      COUNT(*) FILTER (WHERE UPPER(TRIM(c.bacteriological_status)) = 'CLINICALLY-DIAGNOSED TB')::INTEGER AS clinically_diagnosed,
      COUNT(*) FILTER (WHERE UPPER(TRIM(c.outcome_status)) = 'ON TREATMENT')::INTEGER AS on_treatment,
      COUNT(*) FILTER (WHERE UPPER(TRIM(c.outcome_status)) = 'CURED')::INTEGER AS cured,
      COUNT(*) FILTER (WHERE UPPER(TRIM(c.outcome_status)) = 'TREATMENT COMPLETED')::INTEGER AS completed,
      COUNT(*) FILTER (WHERE UPPER(TRIM(c.outcome_status)) IN ('TREATMENT FAILED','FAILED'))::INTEGER AS failed,
      COUNT(*) FILTER (WHERE UPPER(TRIM(c.outcome_status)) = 'DIED')::INTEGER AS died,
      COUNT(*) FILTER (WHERE UPPER(TRIM(c.outcome_status)) IN ('LOST TO FF-UP','LOST TO FOLLOW-UP'))::INTEGER AS lost_to_follow_up,
      COUNT(*) FILTER (WHERE UPPER(TRIM(c.outcome_status)) = 'EXCLUDED')::INTEGER AS excluded,
      COUNT(*) FILTER (WHERE UPPER(TRIM(c.outcome_status)) = 'NOT EVALUATED')::INTEGER AS not_evaluated,
      COUNT(*)::INTEGER AS total_records
    FROM tb_cases c
    ${where}
  `;

  const result = await pool.query(query, params);
  const row = result.rows[0] || {};

  const diagnosed = row.diagnosed || 0;
  const started = row.started_treatment || 0;
  const evaluated = row.evaluated || 0;
  const successful = row.successful_outcome || 0;

  return {
    cascade: {
      diagnosed,
      started_treatment: started,
      evaluated,
      successful_outcome: successful,
    },
    rates: {
      // Percent of Diagnosed (base stage)
      started_pct: pct(started, diagnosed),
      evaluated_pct: pct(evaluated, diagnosed),
      successful_outcome_pct_of_evaluated: pct(successful, evaluated),
      successful_outcome_pct_of_diagnosed: pct(successful, diagnosed),
    },
    breakdown: {
      bacteriologically_confirmed: row.bacteriologically_confirmed || 0,
      clinically_diagnosed: row.clinically_diagnosed || 0,
      on_treatment: row.on_treatment || 0,
      cured: row.cured || 0,
      completed: row.completed || 0,
      failed: row.failed || 0,
      died: row.died || 0,
      lost_to_follow_up: row.lost_to_follow_up || 0,
      excluded: row.excluded || 0,
      not_evaluated: row.not_evaluated || 0,
      total_records: row.total_records || 0,
    },
    meta: {
      filters: {
        year: filters.year || null,
        month: filters.month || null,
        barangay: filters.barangay || null,
        sex: filters.sex || null,
        ageGroup: filters.ageGroup || null,
        bacteriological: filters.bacteriological || null,
        outcome: filters.outcome || null,
      },
      generatedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  computeTreatmentCascade,
  applyCascadeFilters,
  EVALUATED_OUTCOMES,
  SUCCESS_OUTCOMES,
  pct,
};
