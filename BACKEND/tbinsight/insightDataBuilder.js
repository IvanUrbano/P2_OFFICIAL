/**
 * Insight Data Builder
 *
 * Pure metric calculation module. Queries the database and computes
 * structured metrics for the NLG engine. Never generates text — only numbers.
 *
 * Exports:
 *   buildAnalyticsMetrics(pool, filters) -> metrics object
 *   buildForecastingMetrics(pool, filters) -> metrics object
 */

/**
 * Build WHERE clause fragments from filter params.
 * Mutates conditions/params arrays in place.
 */
function applyFilters(conditions, params, paramIdx, filters) {
  let idx = paramIdx;
  if (filters.year) {
    conditions.push(`EXTRACT(YEAR FROM date_of_diagnosis) = $${idx}`);
    params.push(Number(filters.year));
    idx++;
  }
  if (filters.month) {
    conditions.push(`EXTRACT(MONTH FROM date_of_diagnosis) = $${idx}`);
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
    if (ag === '0-14') { conditions.push(`c.age <= 14`); }
    else if (ag === '15-24') { conditions.push(`c.age BETWEEN 15 AND 24`); }
    else if (ag === '25-34') { conditions.push(`c.age BETWEEN 25 AND 34`); }
    else if (ag === '35-44') { conditions.push(`c.age BETWEEN 35 AND 44`); }
    else if (ag === '45-54') { conditions.push(`c.age BETWEEN 45 AND 54`); }
    else if (ag === '55-64') { conditions.push(`c.age BETWEEN 55 AND 64`); }
    else if (ag === '65+') { conditions.push(`c.age >= 65`); }
  }
  if (filters.bacteriological) {
    conditions.push(`TRIM(c.bacteriological_status) ILIKE $${idx}`);
    params.push(filters.bacteriological);
    idx++;
  }
  if (filters.outcome) {
    conditions.push(`UPPER(TRIM(c.outcome_status)) = UPPER($${idx})`);
    params.push(filters.outcome);
    idx++;
  }
  return idx;
}

/**
 * Compute z-score significance for a list of monthly counts.
 * Returns array of objects for months where z-score >= 2.0 and current > mean.
 */
function computeSignificance(monthlyCounts) {
  if (monthlyCounts.length < 3) return [];

  const values = monthlyCounts.map((m) => m.case_count);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);

  if (stddev === 0) return [];

  const significant = [];
  for (const m of monthlyCounts) {
    const zScore = (m.case_count - mean) / stddev;
    if (zScore >= 2.0 && m.case_count > mean) {
      significant.push({
        barangay: m.barangay_name,
        month: m.month,
        caseCount: m.case_count,
        zScore: Math.round(zScore * 100) / 100,
        historicalMean: Math.round(mean * 10) / 10,
      });
    }
  }
  return significant;
}

/**
 * Group rows by barangay, summing case counts.
 */
function groupByBarangay(rows) {
  const map = {};
  for (const r of rows) {
    const name = r.barangay_name;
    if (!map[name]) map[name] = 0;
    map[name] += Number(r.total) || 0;
  }
  return Object.entries(map)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Build analytics metrics from tb_cases and risk tables.
 */
async function buildAnalyticsMetrics(pool, filters = {}) {
  const conditions = ['c.date_of_diagnosis IS NOT NULL'];
  const params = [];
  let idx = 1;
  idx = applyFilters(conditions, params, idx, filters);
  const where = `WHERE ${conditions.join(' AND ')}`;

  // Run all queries in parallel
  const [
    monthlyTrendRes,
    barangayCountsRes,
    significantRes,
    riskRes,
    sexRes,
    ageRes,
    outcomeRes,
    totalRes,
  ] = await Promise.all([
    // 1. Monthly trend: last 12 months of aggregated case counts
    pool.query(`
      SELECT
        DATE_TRUNC('month', c.date_of_diagnosis)::DATE AS month,
        COUNT(*)::INTEGER AS case_count
      FROM tb_cases c
      ${where}
      GROUP BY DATE_TRUNC('month', c.date_of_diagnosis)
      ORDER BY month DESC
      LIMIT 12
    `, params),

    // 2. Per-barangay case counts
    pool.query(`
      SELECT c.barangay_name, COUNT(*)::INTEGER AS total
      FROM tb_cases c
      ${where}
      GROUP BY c.barangay_name
      ORDER BY total DESC
    `, params),

    // 3. Per-barangay monthly counts for significance (last 12 months)
    pool.query(`
      SELECT
        c.barangay_name,
        DATE_TRUNC('month', c.date_of_diagnosis)::DATE AS month,
        COUNT(*)::INTEGER AS case_count
      FROM tb_cases c
      ${where}
      GROUP BY c.barangay_name, DATE_TRUNC('month', c.date_of_diagnosis)
      ORDER BY c.barangay_name, month
    `, params),

    // 4. Risk data from barangay_risk_scores (latest period)
    pool.query(`
      SELECT barangay_name, risk_class, risk_score, incidence_per_100k
      FROM barangay_risk_scores
      WHERE period = (SELECT MAX(period) FROM barangay_risk_scores)
    `),

    // 5. Sex distribution
    pool.query(`
      SELECT TRIM(c.sex) AS sex, COUNT(*)::INTEGER AS total
      FROM tb_cases c
      ${where}
      GROUP BY TRIM(c.sex)
    `, params),

    // 6. Age group distribution
    pool.query(`
      SELECT
        CASE
          WHEN c.age IS NULL THEN 'Unknown'
          WHEN c.age <= 14 THEN '0-14'
          WHEN c.age <= 24 THEN '15-24'
          WHEN c.age <= 34 THEN '25-34'
          WHEN c.age <= 44 THEN '35-44'
          WHEN c.age <= 54 THEN '45-54'
          WHEN c.age <= 64 THEN '55-64'
          ELSE '65+'
        END AS age_group,
        COUNT(*)::INTEGER AS total
      FROM tb_cases c
      ${where}
      GROUP BY age_group
      ORDER BY total DESC
    `, params),

    // 7. Outcome distribution
    pool.query(`
      SELECT
        COALESCE(TRIM(c.outcome_status), 'Unknown') AS outcome_status,
        COUNT(*)::INTEGER AS total
      FROM tb_cases c
      ${where}
      GROUP BY COALESCE(TRIM(c.outcome_status), 'Unknown')
    `, params),

    // 8. Total count and date range
    pool.query(`
      SELECT
        COUNT(*)::INTEGER AS total_cases,
        COUNT(DISTINCT c.barangay_name)::INTEGER AS barangays_with_data,
        MIN(c.date_of_diagnosis) AS earliest_date,
        MAX(c.date_of_diagnosis) AS latest_date
      FROM tb_cases c
      ${where}
    `, params),
  ]);

  // --- Trend calculation ---
  const monthlyRows = monthlyTrendRes.rows;
  // Rows are DESC ordered; first 3 = recent, next 3 = prior
  const recent3 = monthlyRows.slice(0, 3);
  const prior3 = monthlyRows.slice(3, 6);

  const recentCount = recent3.reduce((s, r) => s + r.case_count, 0);
  const priorCount = prior3.reduce((s, r) => s + r.case_count, 0);
  const changePercent = priorCount > 0
    ? Math.round(((recentCount - priorCount) / priorCount) * 1000) / 10
    : 0;
  const direction = changePercent > 5 ? 'increasing'
    : changePercent < -5 ? 'decreasing'
    : 'stable';

  // --- Barangay highest / lowest ---
  const grouped = groupByBarangay(barangayCountsRes.rows);
  const highestBarangay = grouped.length > 0 ? grouped[0] : null;
  const lowestBarangay = grouped.length > 0 ? grouped[grouped.length - 1] : null;

  // --- Significant changes ---
  const significantChanges = computeSignificance(significantRes.rows);

  // --- Risk counts ---
  const riskRows = riskRes.rows;
  const riskCounts = { high: 0, medium: 0, low: 0 };
  const highRiskBarangays = [];
  for (const r of riskRows) {
    const cls = (r.risk_class || '').toLowerCase();
    if (cls === 'high') {
      riskCounts.high++;
      highRiskBarangays.push(r.barangay_name);
    } else if (cls === 'medium') {
      riskCounts.medium++;
    } else if (cls === 'low') {
      riskCounts.low++;
    }
  }

  // --- Demographics ---
  const sexRows = sexRes.rows;
  const totalSex = sexRows.reduce((s, r) => s + r.total, 0);
  let maleCount = 0;
  let femaleCount = 0;
  for (const r of sexRows) {
    const s = (r.sex || '').toUpperCase();
    if (s === 'M' || s === 'MALE') maleCount += r.total;
    else if (s === 'F' || s === 'FEMALE') femaleCount += r.total;
  }
  const malePct = totalSex > 0 ? Math.round((maleCount / totalSex) * 1000) / 10 : 0;
  const femalePct = totalSex > 0 ? Math.round((femaleCount / totalSex) * 1000) / 10 : 0;

  const ageRows = ageRes.rows;
  const totalAge = ageRows.reduce((s, r) => s + r.total, 0);
  const dominantAgeGroup = ageRows.length > 0 ? {
    group: ageRows[0].age_group,
    count: ageRows[0].total,
    percentage: totalAge > 0 ? Math.round((ageRows[0].total / totalAge) * 1000) / 10 : 0,
  } : null;

  // --- Treatment outcomes ---
  const outcomeRows = outcomeRes.rows;
  const outcomeBreakdown = {};
  let curedCount = 0;
  let completedCount = 0;
  let evaluatedCount = 0;
  for (const r of outcomeRows) {
    outcomeBreakdown[r.outcome_status] = r.total;
    const up = (r.outcome_status || '').toUpperCase();
    if (up === 'CURED') curedCount = r.total;
    if (up === 'TREATMENT COMPLETED') completedCount = r.total;
    if (up !== 'NOT EVALUATED' && up !== 'UNKNOWN' && r.outcome_status) {
      evaluatedCount += r.total;
    }
  }
  const successRate = evaluatedCount > 0
    ? Math.round(((curedCount + completedCount) / evaluatedCount) * 1000) / 10
    : 0;

  // --- Summary ---
  const summary = {
    totalCases: totalRes.rows[0]?.total_cases || 0,
    barangaysWithData: totalRes.rows[0]?.barangays_with_data || 0,
    earliestDate: totalRes.rows[0]?.earliest_date || null,
    latestDate: totalRes.rows[0]?.latest_date || null,
  };

  return {
    trend: { direction, changePercent, recentCount, priorCount },
    highestBarangay,
    lowestBarangay,
    significantChanges,
    riskCounts,
    highRiskBarangays,
    demographics: {
      sexSplit: { male: malePct, female: femalePct },
      dominantAgeGroup,
    },
    treatment: { successRate, outcomeBreakdown },
    summary,
  };
}

/**
 * Build forecasting metrics from model_predictions and risk tables.
 */
async function buildForecastingMetrics(pool, filters = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (filters.startYear) {
    conditions.push(`EXTRACT(YEAR FROM mp.period) >= $${idx}`);
    params.push(Number(filters.startYear));
    idx++;
  }
  if (filters.endYear) {
    conditions.push(`EXTRACT(YEAR FROM mp.period) <= $${idx}`);
    params.push(Number(filters.endYear));
    idx++;
  }
  if (filters.barangay) {
    conditions.push(`TRIM(mp.barangay_name) = $${idx}`);
    params.push(filters.barangay);
    idx++;
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [
    forecastRes,
    riskRes,
    metaRes,
  ] = await Promise.all([
    // 1. Forecast data
    pool.query(`
      SELECT
        mp.barangay_name,
        mp.period,
        mp.forecasted_count,
        mp.confidence_lower,
        mp.confidence_upper,
        mp.risk_class,
        mp.incidence_per_100k,
        mp.actual_count
      FROM model_predictions mp
      ${where}
      ORDER BY mp.period ASC, mp.barangay_name
    `, params),

    // 2. Risk classifications
    pool.query(`
      SELECT
        brs.barangay_name,
        brs.risk_class,
        brs.risk_score
      FROM barangay_risk_scores brs
      WHERE brs.risk_class IS NOT NULL
        ${filters.barangay ? `AND TRIM(brs.barangay_name) = $1` : ''}
      ORDER BY brs.risk_score DESC
    `, filters.barangay ? [filters.barangay] : []),

    // 3. Latest model metadata
    pool.query(`
      SELECT run_type, model_version, trained_at, config
      FROM model_metadata
      ORDER BY trained_at DESC
      LIMIT 1
    `),
  ]);

  const forecastRows = forecastRes.rows;

  // --- Direction ---
  // Compare forecast average vs historical actual average
  const forecastedValues = forecastRows.map((r) => Number(r.forecasted_count) || 0);
  const actualValues = forecastRows
    .filter((r) => r.actual_count != null)
    .map((r) => Number(r.actual_count));

  const forecastAvg = forecastedValues.length > 0
    ? forecastedValues.reduce((s, v) => s + v, 0) / forecastedValues.length
    : 0;
  const historicalAvg = actualValues.length > 0
    ? actualValues.reduce((s, v) => s + v, 0) / actualValues.length
    : 0;

  const growthRate = historicalAvg > 0
    ? Math.round(((forecastAvg - historicalAvg) / historicalAvg) * 1000) / 10
    : 0;
  const trendDirection = growthRate > 5 ? 'increasing'
    : growthRate < -5 ? 'decreasing'
    : 'stable';

  // --- Predicted cases ---
  const totalPredicted = Math.round(forecastedValues.reduce((s, v) => s + v, 0));
  // Only count future periods (where actual_count is null)
  const futureForecasts = forecastRows.filter((r) => r.actual_count == null);
  const futureTotal = Math.round(futureForecasts.reduce((s, r) => s + (Number(r.forecasted_count) || 0), 0));
  const horizon = futureForecasts.length;
  const monthlyAvg = horizon > 0 ? Math.round(futureTotal / horizon) : 0;

  // --- Peak period ---
  // Find the month with highest forecasted count
  const periodAgg = {};
  for (const r of forecastRows) {
    const p = r.period;
    if (!periodAgg[p]) periodAgg[p] = 0;
    periodAgg[p] += Number(r.forecasted_count) || 0;
  }
  let peakPeriod = null;
  let peakCount = 0;
  for (const [period, count] of Object.entries(periodAgg)) {
    if (count > peakCount) {
      peakCount = Math.round(count);
      peakPeriod = period;
    }
  }
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  let peakPeriodLabel = null;
  if (peakPeriod) {
    const d = new Date(peakPeriod);
    peakPeriodLabel = `${monthNames[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  // --- High-risk barangays ---
  const riskRows = riskRes.rows;
  const highRiskForecastBarangays = riskRows
    .filter((r) => (r.risk_class || '').toLowerCase() === 'high')
    .map((r) => r.barangay_name);

  // --- Confidence ---
  const ciWidths = forecastRows
    .filter((r) => r.forecasted_count > 0 && r.confidence_lower != null && r.confidence_upper != null)
    .map((r) => (r.confidence_upper - r.confidence_lower) / r.forecasted_count);
  const avgRelativeCIWidth = ciWidths.length > 0
    ? Math.round((ciWidths.reduce((s, v) => s + v, 0) / ciWidths.length) * 100) / 100
    : 0;
  const ciInterpretation = avgRelativeCIWidth < 0.3 ? 'narrow'
    : avgRelativeCIWidth <= 0.6 ? 'moderate'
    : 'wide';

  // --- Model info ---
  const meta = metaRes.rows[0] || null;
  const barangaysProcessed = new Set(forecastRows.map((r) => r.barangay_name)).size;

  return {
    direction: { trend: trendDirection, growthRate },
    predictedCases: {
      total: futureTotal,
      monthlyAvg,
      horizon,
    },
    peakPeriod: { label: peakPeriodLabel, count: peakCount },
    highRiskForecastBarangays,
    confidence: { avgRelativeCIWidth, interpretation: ciInterpretation },
    modelInfo: {
      method: meta?.config?.method || meta?.model_version || 'ARIMA + RF',
      horizon: filters.horizon || horizon,
      barangaysProcessed,
    },
  };
}

module.exports = { buildAnalyticsMetrics, buildForecastingMetrics };
