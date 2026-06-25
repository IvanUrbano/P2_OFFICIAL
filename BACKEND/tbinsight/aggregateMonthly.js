const pool = require('../db');

/**
 * Age group mapping: maps age to age bracket
 */
function getAgeGroup(age) {
  if (age === null || age === undefined) return 'Unknown';
  if (age <= 14) return '0-14';
  if (age <= 24) return '15-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  if (age <= 54) return '45-54';
  if (age <= 64) return '55-64';
  return '65+';
}

/**
 * Rebuild all Layer 3 aggregated tables from tb_cases
 * Pure SQL GROUP BY operations
 *
 * @param {Object} client - Database client (for transaction)
 * @returns {Object} Counts for each aggregated table
 */
async function rebuildAllAggregations(client) {
  const counts = {};

  // 1. Monthly case summary
  await client.query('DELETE FROM monthly_case_summary');
  const monthlyResult = await client.query(`
    INSERT INTO monthly_case_summary (barangay_name, month, case_count)
    SELECT
      barangay_name,
      DATE_TRUNC('month', date_of_diagnosis)::DATE AS month,
      COUNT(*) AS case_count
    FROM tb_cases
    GROUP BY barangay_name, DATE_TRUNC('month', date_of_diagnosis)
  `);
  counts.monthly = monthlyResult.rowCount;

  // 2. Demographic summary
  await client.query('DELETE FROM demographic_summary');
  const demoResult = await client.query(`
    INSERT INTO demographic_summary (barangay_name, month, sex, age_group, case_count)
    SELECT
      barangay_name,
      DATE_TRUNC('month', date_of_diagnosis)::DATE AS month,
      sex,
      CASE
        WHEN age IS NULL THEN 'Unknown'
        WHEN age <= 14 THEN '0-14'
        WHEN age <= 24 THEN '15-24'
        WHEN age <= 34 THEN '25-34'
        WHEN age <= 44 THEN '35-44'
        WHEN age <= 54 THEN '45-54'
        WHEN age <= 64 THEN '55-64'
        ELSE '65+'
      END AS age_group,
      COUNT(*) AS case_count
    FROM tb_cases
    GROUP BY barangay_name, DATE_TRUNC('month', date_of_diagnosis), sex,
      CASE
        WHEN age IS NULL THEN 'Unknown'
        WHEN age <= 14 THEN '0-14'
        WHEN age <= 24 THEN '15-24'
        WHEN age <= 34 THEN '25-34'
        WHEN age <= 44 THEN '35-44'
        WHEN age <= 54 THEN '45-54'
        WHEN age <= 64 THEN '55-64'
        ELSE '65+'
      END
  `);
  counts.demographics = demoResult.rowCount;

  // 3. Outcome summary
  await client.query('DELETE FROM outcome_summary');
  const outcomeResult = await client.query(`
    INSERT INTO outcome_summary (barangay_name, month, outcome_status, case_count)
    SELECT
      barangay_name,
      DATE_TRUNC('month', date_of_diagnosis)::DATE AS month,
      COALESCE(outcome_status, 'Unknown') AS outcome_status,
      COUNT(*) AS case_count
    FROM tb_cases
    GROUP BY barangay_name, DATE_TRUNC('month', date_of_diagnosis), COALESCE(outcome_status, 'Unknown')
  `);
  counts.outcomes = outcomeResult.rowCount;

  // 4. Facility summary
  await client.query('DELETE FROM facility_summary');
  const facilityResult = await client.query(`
    INSERT INTO facility_summary (facility_name, barangay_name, month, case_count)
    SELECT
      COALESCE(screening_facility, 'Unknown') AS facility_name,
      barangay_name,
      DATE_TRUNC('month', date_of_diagnosis)::DATE AS month,
      COUNT(*) AS case_count
    FROM tb_cases
    WHERE screening_facility IS NOT NULL AND screening_facility != ''
    GROUP BY barangay_name, DATE_TRUNC('month', date_of_diagnosis), screening_facility
  `);
  counts.facilities = facilityResult.rowCount;

  // 5. Bacteriological summary
  await client.query('DELETE FROM bacteriological_summary');
  const bacterioResult = await client.query(`
    INSERT INTO bacteriological_summary (barangay_name, month, bacteriological_status, case_count)
    SELECT
      barangay_name,
      DATE_TRUNC('month', date_of_diagnosis)::DATE AS month,
      COALESCE(bacteriological_status, 'Unknown') AS bacteriological_status,
      COUNT(*) AS case_count
    FROM tb_cases
    GROUP BY barangay_name, DATE_TRUNC('month', date_of_diagnosis), COALESCE(bacteriological_status, 'Unknown')
  `);
  counts.bacteriological = bacterioResult.rowCount;

  return counts;
}

/**
 * Rebuild all aggregations (standalone, not in a transaction)
 * Called after import
 */
async function rebuildAggregations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const counts = await rebuildAllAggregations(client);
    await client.query('COMMIT');
    console.log('✅ Aggregations rebuilt:', counts);
    return counts;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Aggregation rebuild failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  rebuildAggregations,
  rebuildAllAggregations,
  getAgeGroup,
};
