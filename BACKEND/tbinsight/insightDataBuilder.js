/**
 * Insight Data Builder
 *
 * Pure metric calculation module. Queries the database and computes
 * structured metrics for the NLG engine. Never generates text — only numbers.
 *
 * Exports:
 *   buildAnalyticsMetrics(pool, filters) -> metrics object
 *   buildForecastingMetrics(pool, filters) -> metrics object
 *   buildGisMetrics(pool, filters) -> metrics object
 */

const { getAvailablePopulationYears, computeYearIncidence, GEOJSON_REFERENCE_YEAR } = require('./populationService');
const { computeTreatmentSuccessRate } = require('./treatmentSuccessRate');
const { computeCaseFatalityRate } = require('./caseFatalityRate');
const { getOutcomeFilterValues, normalizeDisplayOutcome } = require('./outcomeNormalization');
const { pasigResidentOnly, countedCases } = require('./locationScope');
const { gisSnapshotPeriodSql } = require('./gisSnapshot');
const { monthKey } = require('./scoring');

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
    conditions.push(`c.treatment_outcome = ANY($${idx})`);
    params.push(getOutcomeFilterValues(filters.outcome));
    idx++;
  }
  if (filters.status) {
    conditions.push(`c.case_status = $${idx}`);
    params.push(String(filters.status).trim().toUpperCase());
    idx++;
  }
  if (filters.facility) {
    conditions.push(`(TRIM(c.screening_facility) = $${idx} OR TRIM(c.treatment_facility) = $${idx})`);
    params.push(filters.facility);
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
  // City-wide scope for trend/sex/age/outcome/total; the two per-barangay
  // queries below additionally require a Pasig residence, because a Non-Pasig
  // resident has no Pasig barangay and would otherwise appear as one NULL row.
  conditions.push(countedCases('c'));
  const where = `WHERE ${conditions.join(' AND ')}`;
  const whereByBarangay = `WHERE ${conditions.join(' AND ')} AND ${pasigResidentOnly('c')}`;

  // Optional metric queries degrade to `null` instead of rejecting: one
  // optional metric failing must NOT 500 the entire NLG response — the
  // affected section is omitted instead. Only the summary/total query (last)
  // is required; its failure is a genuine database error.
  const safe = (promise, label) => promise.catch((err) => {
    console.error(`NLG optional metric failed (${label}):`, err.message);
    return null;
  });

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
    safe(pool.query(`
      SELECT
        DATE_TRUNC('month', c.date_of_diagnosis)::DATE AS month,
        COUNT(*)::INTEGER AS case_count
      FROM tb_cases c
      ${where}
      GROUP BY DATE_TRUNC('month', c.date_of_diagnosis)
      ORDER BY month DESC
      LIMIT 12
    `, params), 'monthlyTrend'),

    // 2. Per-barangay case counts
    safe(pool.query(`
      SELECT c.barangay_name, COUNT(*)::INTEGER AS total
      FROM tb_cases c
      ${whereByBarangay}
      GROUP BY c.barangay_name
      ORDER BY total DESC
    `, params), 'barangayCounts'),

    // 3. Per-barangay monthly counts for significance (last 12 months)
    safe(pool.query(`
      SELECT
        c.barangay_name,
        DATE_TRUNC('month', c.date_of_diagnosis)::DATE AS month,
        COUNT(*)::INTEGER AS case_count
      FROM tb_cases c
      ${whereByBarangay}
      GROUP BY c.barangay_name, DATE_TRUNC('month', c.date_of_diagnosis)
      ORDER BY c.barangay_name, month
    `, params), 'significance'),

    // 4. Risk data from barangay_risk_scores (latest period).
    // `period` is carried through so the assessment year can be reported
    // instead of implied: a snapshot stored at period YYYY-01-01 IS the
    // assessment made through the end of YYYY-1 (same contract as
    // /gis/choropleth).
    safe(pool.query(`
      SELECT barangay_name, risk_class, risk_score, incidence_per_100k,
             EXTRACT(YEAR FROM period)::INTEGER AS period_year
      FROM barangay_risk_scores
      WHERE period = (SELECT MAX(period) FROM barangay_risk_scores)
    `), 'risk'),

    // 5. Sex distribution
    safe(pool.query(`
      SELECT TRIM(c.sex) AS sex, COUNT(*)::INTEGER AS total
      FROM tb_cases c
      ${where}
      GROUP BY TRIM(c.sex)
    `, params), 'sexDistribution'),

    // 6. Age group distribution
    safe(pool.query(`
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
    `, params), 'ageDistribution'),

    // 7. Outcome distribution
    safe(pool.query(`
      SELECT
        COALESCE(c.treatment_outcome, 'UNKNOWN') AS outcome_status,
        COUNT(*)::INTEGER AS total
      FROM tb_cases c
      ${where} AND c.treatment_outcome IS NOT NULL
      GROUP BY COALESCE(c.treatment_outcome, 'UNKNOWN')
    `, params), 'outcomes'),

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
  const unavailable = [];
  let trend = null;
  if (monthlyTrendRes) {
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
    trend = { direction, changePercent, recentCount, priorCount };
  } else {
    unavailable.push('trend');
  }

  // --- Barangay highest / lowest ---
  let highestBarangay = null;
  let lowestBarangay = null;
  if (barangayCountsRes) {
    const grouped = groupByBarangay(barangayCountsRes.rows);
    highestBarangay = grouped.length > 0 ? grouped[0] : null;
    lowestBarangay = grouped.length > 0 ? grouped[grouped.length - 1] : null;
  } else {
    unavailable.push('highestLowest');
  }

  // --- Significant changes ---
  let significantChanges = null;
  if (significantRes) {
    significantChanges = computeSignificance(significantRes.rows);
  } else {
    unavailable.push('significance');
  }

  // --- Risk counts ---
  let riskCounts = null;
  let highRiskBarangays = null;
  let riskByBarangay = null;
  if (riskRes) {
    // `assessed` is the number of barangays that actually have a persisted
    // classification in this snapshot — the real denominator for "N of M
    // barangays". It is counted here rather than assumed to be 30, so a
    // snapshot that skipped a barangay can never be reported as though
    // every barangay had been assessed.
    riskCounts = { high: 0, medium: 0, low: 0, noData: 0, assessed: 0 };
    highRiskBarangays = [];
    riskByBarangay = {};
    for (const r of riskRes.rows) {
      riskByBarangay[r.barangay_name] = r.risk_class;
      const cls = (r.risk_class || '').toLowerCase();
      if (cls === 'high') {
        riskCounts.high++;
        riskCounts.assessed++;
        highRiskBarangays.push(r.barangay_name);
      } else if (cls === 'medium') {
        riskCounts.medium++;
        riskCounts.assessed++;
      } else if (cls === 'low') {
        riskCounts.low++;
        riskCounts.assessed++;
      } else {
        riskCounts.noData++;
      }
    }
    const periodYear = riskRes.rows[0]?.period_year;
    riskCounts.assessmentYear = periodYear ? Number(periodYear) - 1 : null;
  } else {
    unavailable.push('risk');
  }

  // --- Demographics ---
  let demographics = null;
  if (sexRes) {
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

    const ageRows = ageRes ? ageRes.rows : [];
    const totalAge = ageRows.reduce((s, r) => s + r.total, 0);
    const dominantAgeGroup = ageRows.length > 0 ? {
      group: ageRows[0].age_group,
      count: ageRows[0].total,
      percentage: totalAge > 0 ? Math.round((ageRows[0].total / totalAge) * 1000) / 10 : 0,
    } : null;

    demographics = {
      sexSplit: { male: malePct, female: femalePct },
      dominantAgeGroup,
    };
  } else {
    unavailable.push('demographics');
  }

  // --- Treatment outcomes ---
  const outcomeBreakdown = {};
  if (outcomeRes) {
    for (const r of outcomeRes.rows) {
      const displayKey = normalizeDisplayOutcome(r.outcome_status);
      if (displayKey) {
        outcomeBreakdown[displayKey] = (outcomeBreakdown[displayKey] || 0) + r.total;
      }
    }
  }

  // TSR: single shared calculation (see treatmentSuccessRate.js) — do not
  // reimplement the cohort query here; every caller must agree on the same
  // Y-1 treatment-start cohort for numerator and denominator.
  // Forward supported sub-filters so NLG TSR matches the KPI when
  // demographic filters are active. Month and Outcome are excluded from TSR.
  // Optional metric: degrade to null instead of failing the whole response.
  let successRate = null;
  let cohortYear = null;
  let cohortTotal = null;
  try {
    ({ successRate, cohortYear, cohortTotal } = await computeTreatmentSuccessRate(pool, {
      year: filters.year,
      barangay: filters.barangay,
      sex: filters.sex,
      ageGroup: filters.ageGroup,
      facility: filters.facility,
      bacteriological: filters.bacteriological,
    }));
  } catch (err) {
    console.error('NLG optional metric failed (tsr):', err.message);
    unavailable.push('treatment');
  }

  // CFR: single shared calculation (see caseFatalityRate.js) — do not
  // reimplement the evaluated-outcomes denominator here.
  // Forward supported sub-filters. Month is supported for CFR.
  // Outcome is intentionally excluded.
  // Optional metric: degrade to null instead of failing the whole response.
  let fatalityRate = null;
  try {
    ({ rate: fatalityRate } = await computeCaseFatalityRate(pool, {
      year: filters.year,
      month: filters.month,
      barangay: filters.barangay,
      sex: filters.sex,
      ageGroup: filters.ageGroup,
      facility: filters.facility,
      bacteriological: filters.bacteriological,
    }));
  } catch (err) {
    console.error('NLG optional metric failed (cfr):', err.message);
    unavailable.push('fatality');
  }

  // --- Summary ---
  const summary = {
    totalCases: totalRes.rows[0]?.total_cases || 0,
    barangaysWithData: totalRes.rows[0]?.barangays_with_data || 0,
    earliestDate: totalRes.rows[0]?.earliest_date || null,
    latestDate: totalRes.rows[0]?.latest_date || null,
  };

  return {
    trend,
    highestBarangay,
    lowestBarangay,
    significantChanges,
    riskCounts,
    highRiskBarangays,
    riskByBarangay,
    demographics,
    treatment: { successRate, fatalityRate, cohortYear, cohortTotal, outcomeBreakdown },
    summary,
    unavailable,
  };
}

/**
 * Build forecasting metrics from model_predictions and risk tables.
 */
async function buildForecastingMetrics(pool, filters = {}) {
  const conditions = [];
  const selectedHorizon = [1, 3].includes(Number(filters.horizon)) ? Number(filters.horizon) : 3;
  const params = [selectedHorizon];
  let idx = 2;
  if (filters.barangay) {
    conditions.push(`TRIM(mp.barangay_name) = $${idx}`);
    params.push(filters.barangay);
    idx++;
  }
  conditions.push(`mp.period >= (SELECT (config->>'period')::date FROM model_metadata WHERE run_type = 'pipeline' ORDER BY trained_at DESC LIMIT 1)`);
  conditions.push(`mp.period < (SELECT (config->>'period')::date FROM model_metadata WHERE run_type = 'pipeline' ORDER BY trained_at DESC LIMIT 1) + ($1::integer * INTERVAL '1 month')`);
  const where = `WHERE ${conditions.join(' AND ')}`;
  const historyConditions = [
    `c.date_of_diagnosis < (SELECT (config->>'period')::date FROM model_metadata WHERE run_type = 'pipeline' ORDER BY trained_at DESC LIMIT 1)`,
    `c.date_of_diagnosis IS NOT NULL`,
    pasigResidentOnly('c'),
  ];
  const historyParams = [];
  if (filters.startYear) {
    historyParams.push(Number(filters.startYear));
    historyConditions.push(`EXTRACT(YEAR FROM c.date_of_diagnosis) >= $${historyParams.length}`);
  }
  if (filters.endYear) {
    historyParams.push(Number(filters.endYear));
    historyConditions.push(`EXTRACT(YEAR FROM c.date_of_diagnosis) <= $${historyParams.length}`);
  }
  if (filters.barangay) {
    historyParams.push(filters.barangay);
    historyConditions.push(`TRIM(c.barangay_name) = $${historyParams.length}`);
  }

  const [
    forecastRes,
    riskRes,
    metaRes,
    historyRes,
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
        mp.actual_count,
        mp.method
      FROM model_predictions mp
      ${where}
      ORDER BY mp.period ASC, mp.barangay_name
    `, params),

    // 2. Distinct Pasig barangays in the current pipeline's RF assessment.
    // Historical snapshots are retained for GIS but must not be counted here.
    pool.query(`
      SELECT DISTINCT ON (TRIM(brs.barangay_name))
        TRIM(brs.barangay_name) AS barangay_name,
        brs.risk_class,
        brs.risk_score
      FROM barangay_risk_scores brs
      JOIN barangays b ON TRIM(b.name) = TRIM(brs.barangay_name)
      WHERE brs.risk_class IS NOT NULL
        AND brs.period = (SELECT (config->>'period')::date FROM model_metadata
                          WHERE run_type = 'pipeline' ORDER BY trained_at DESC LIMIT 1)
        ${filters.barangay ? `AND TRIM(brs.barangay_name) = $1` : ''}
      ORDER BY TRIM(brs.barangay_name), brs.risk_score DESC
    `, filters.barangay ? [filters.barangay] : []),

    // 3. Latest model metadata
    pool.query(`
      SELECT run_type, model_version, trained_at, config
      FROM model_metadata
      ORDER BY trained_at DESC
      LIMIT 1
    `),
    pool.query(`
      SELECT TO_CHAR(MIN(c.date_of_diagnosis), 'YYYY-MM') AS first_month,
             TO_CHAR(MAX(c.date_of_diagnosis), 'YYYY-MM') AS last_month,
             COUNT(*)::numeric AS total_cases
      FROM tb_cases c
      WHERE ${historyConditions.join(' AND ')}
    `, historyParams),
  ]);

  const forecastRows = forecastRes.rows;

  // --- Direction ---
  // Compare the first modeled month to the selected historical monthly
  // average. The calendar span includes months with zero recorded cases.
  const firstForecastPeriod = forecastRows.find(r => r.forecasted_count != null)?.period;
  const firstForecastTotal = firstForecastPeriod == null ? null : forecastRows
    .filter(r => String(r.period) === String(firstForecastPeriod) && r.forecasted_count != null)
    .reduce((sum, r) => sum + Number(r.forecasted_count), 0);
  const history = historyRes.rows[0] || {};
  const monthNumber = key => Number(String(key).slice(0, 4)) * 12 + Number(String(key).slice(5, 7)) - 1;
  const historyMonths = history.first_month && history.last_month
    ? monthNumber(history.last_month) - monthNumber(history.first_month) + 1 : 0;
  const historicalAvg = historyMonths > 0 ? Number(history.total_cases) / historyMonths : null;
  const growthRate = firstForecastTotal != null && historicalAvg > 0
    ? Math.round(((firstForecastTotal - historicalAvg) / historicalAvg) * 1000) / 10 : null;
  const trendDirection = growthRate == null ? 'unavailable'
    : growthRate > 5 ? 'increasing' : growthRate < -5 ? 'decreasing' : 'stable';

  // --- Predicted cases ---
  // A persisted run remains its forecast even when actuals later arrive.
  const futureForecasts = forecastRows.filter((r) => r.forecasted_count != null);
  const futureTotal = Math.round(
    futureForecasts.reduce((s, r) => s + (r.forecasted_count != null ? Number(r.forecasted_count) : 0), 0)
  );
  const horizon = new Set(futureForecasts.map((r) => String(r.period).slice(0, 7))).size;
  const monthlyAvg = horizon > 0 ? Math.round(futureTotal / horizon) : 0;

  // --- Forecast tier for this scope: majority `method` among future rows.
  // Drives whether the NLG can state a direction at all (see nlgEngine.js's
  // buildForecastDirection/buildForecastOverallSummary).
  let forecastTier = 'none';
  if (futureForecasts.length > 0) {
    const methodCounts = {};
    for (const r of futureForecasts) {
      const m = r.method || 'arima';
      methodCounts[m] = (methodCounts[m] || 0) + 1;
    }
    let maxCount = 0;
    let majority = 'arima';
    for (const [m, cnt] of Object.entries(methodCounts)) {
      if (cnt > maxCount) { maxCount = cnt; majority = m; }
    }
    forecastTier = majority === 'insufficient_data'
      ? 'insufficient_data'
      : majority === 'arima' ? 'arima' : 'baseline';
  }

  // --- Peak period ---
  // Find the month with highest forecasted count
  const periodAgg = {};
  for (const r of forecastRows) {
    if (r.forecasted_count == null) continue;
    const p = r.period;
    if (!periodAgg[p]) periodAgg[p] = 0;
    periodAgg[p] += Number(r.forecasted_count);
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
  const highRiskForecastBarangays = [...new Set(riskRows
    .filter((r) => (r.risk_class || '').toLowerCase() === 'high')
    .map((r) => String(r.barangay_name || '').trim()).filter(Boolean))];

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
      available: futureForecasts.length > 0,
    },
    peakPeriod: { label: peakPeriodLabel, count: peakCount },
    highRiskForecastBarangays,
    riskAssessmentAvailable: riskRows.length > 0,
    confidence: { avgRelativeCIWidth, interpretation: ciInterpretation },
    modelInfo: {
      method: meta?.config?.method || meta?.model_version || 'ARIMA + RF',
      horizon: selectedHorizon,
      barangaysProcessed,
      tier: forecastTier,
    },
  };
}

// ============================================================
//  GIS METRICS — choropleth/risk distribution for map insight
// ============================================================

/**
 * Compute GIS/map metrics from the latest barangay_risk_scores period.
 *
 * Uses the system's actual risk labels (High / Medium / Low / No Data)
 * and trend labels (Increasing / Decreasing / Stable) — never introduces
 * alternative labels.
 *
 * Incidence availability is checked explicitly: if the risk period's year
 * has no matching population reference (or incidence values are missing),
 * metrics.incidence.available = false so the NLG layer skips any
 * incidence-based interpretation.
 *
 * @param {object} pool
 * @param {object} filters - { barangay?: string } optional focus barangay
 */
async function buildGisMetrics(pool, filters = {}) {
  // --- Risk period selected by data year, or latest for All Years ---
  const selectedYear = Number.isInteger(Number(filters.year)) && Number(filters.year) >= 2000
    && Number(filters.year) <= 2099 ? Number(filters.year) : null;
  const latestRes = await pool.query(
    selectedYear
      ? `SELECT s.period,
           (SELECT COALESCE((mm.metrics->>'data_year')::integer,
                            EXTRACT(YEAR FROM (mm.metrics->>'dataEnd')::date)::integer)
            FROM model_metadata mm
            WHERE (mm.config->>'period')::date = s.period
            ORDER BY mm.trained_at DESC LIMIT 1) AS data_year
         FROM (SELECT ${gisSnapshotPeriodSql} AS period) s`
      : 'SELECT MAX(period) AS period FROM barangay_risk_scores',
    selectedYear ? [selectedYear] : []
  );
  const latestPeriod = latestRes.rows[0]?.period ? monthKey(latestRes.rows[0].period) : null;
  const periodYear = latestPeriod ? Number(monthKey(latestPeriod).slice(0, 4)) : null;
  const periodMonth = latestPeriod ? Number(monthKey(latestPeriod).slice(5, 7)) : null;
  const snapshotDataYear = latestRes.rows[0]?.data_year != null
    ? Number(latestRes.rows[0].data_year)
    : periodYear == null ? null : (periodMonth === 1 ? periodYear - 1 : periodYear);
  const caseYear = selectedYear || snapshotDataYear;

    // --- Barangay rows: selected risk period and matching case year ---
  const rowsRes = await pool.query(
    `SELECT
       b.name,
       b.population,
       brs.risk_score,
       brs.risk_class,
       brs.incidence_per_100k AS legacy_pipeline_incidence,
       brs.trend_direction,
       COALESCE(tc.total_cases, 0)::INTEGER AS total_cases,
       COALESCE(yc.year_cases, 0)::INTEGER AS year_cases
     FROM barangays b
     LEFT JOIN barangay_risk_scores brs
       ON brs.barangay_name = b.name AND brs.period = $1
      LEFT JOIN (
        SELECT barangay_name, COUNT(*)::INTEGER AS total_cases
        FROM tb_cases
        WHERE ${pasigResidentOnly()}
          ${selectedYear ? 'AND EXTRACT(YEAR FROM date_of_diagnosis) = $2' : ''}
        GROUP BY barangay_name
      ) tc ON tc.barangay_name = b.name
      LEFT JOIN (
        SELECT barangay_name, COUNT(*)::INTEGER AS year_cases
        FROM tb_cases
        WHERE date_of_diagnosis IS NOT NULL
          AND EXTRACT(YEAR FROM date_of_diagnosis) = $2
          AND ${pasigResidentOnly()}
        GROUP BY barangay_name
      ) yc ON yc.barangay_name = b.name
     ORDER BY b.name`,
    [latestPeriod, caseYear]
  );

  // STRICT year-matched population for the selected case year: the GeoJSON
  // reference population only applies to GEOJSON_REFERENCE_YEAR; any other
  // year needs an exact barangay_population row or incidence is null (N/A).
  // Never substitute another year's population.
  const popMap = {};
  if (caseYear === GEOJSON_REFERENCE_YEAR) {
    for (const r of rowsRes.rows) popMap[r.name] = r.population;
  } else if (caseYear != null) {
    try {
      const popRes = await pool.query(
        `SELECT barangay_name, population FROM barangay_population
         WHERE reference_year = $1 AND status = 'ACTIVE'`,
        [caseYear]
      );
      for (const r of popRes.rows) popMap[r.barangay_name] = r.population;
    } catch {
      // population lookup failure → all null below (incidence unavailable)
    }
  }

  // Year-specific incidence (authoritative, matches the GIS table/choropleth).
  // The pipeline-stored value is retained as legacy_pipeline_incidence only.
  const rows = rowsRes.rows.map((r) => ({
    ...r,
    incidence_per_100k: computeYearIncidence(r.year_cases, popMap[r.name]),
  }));

  // --- Risk distribution (actual system labels) ---
  const riskCounts = { High: 0, Medium: 0, Low: 0, 'No Data': 0 };
  for (const r of rows) {
    const label = r.risk_class || 'No Data';
    riskCounts[label] = (riskCounts[label] || 0) + 1;
  }
  const scored = rows.filter((r) => r.risk_class && r.risk_class !== 'No Data');
  const noDataBarangays = rows
    .filter((r) => !r.risk_class || r.risk_class === 'No Data')
    .map((r) => r.name);

  // --- Incidence availability guard ---
  // Population must exist for the selected case year, which can differ from
  // both the RF data year and the stored prediction period's year.
  const withIncidence = rows.filter(
    (r) => r.incidence_per_100k !== null && r.incidence_per_100k !== undefined
  ).length;
  let availableYears = [];
  try {
    availableYears = await getAvailablePopulationYears();
  } catch {
    availableYears = [];
  }
  const periodYearHasPopulation =
    caseYear === null ? false : availableYears.includes(caseYear);
  const incidenceAvailable =
    Boolean(latestPeriod) && withIncidence > 0 && periodYearHasPopulation;

  // --- Top hotspots (by risk score) ---
  const byRisk = [...scored].sort(
    (a, b) => (b.risk_score || 0) - (a.risk_score || 0)
  );
  const topHotspots = byRisk.slice(0, 5).map((r) => ({
    name: r.name,
    risk_score: r.risk_score,
    risk_class: r.risk_class,
    incidence_per_100k: r.incidence_per_100k, // raw — may be null
    trend_direction: r.trend_direction || 'Stable',
    total_cases: r.total_cases,
  }));

  // --- Case concentration (top 5 barangays by raw case count) ---
  const totalCases = rows.reduce((s, r) => s + (r.total_cases || 0), 0);
  const byCases = [...rows].sort((a, b) => (b.total_cases || 0) - (a.total_cases || 0));
  const top5Cases = byCases.slice(0, 5);
  const top5CaseCount = top5Cases.reduce((s, r) => s + (r.total_cases || 0), 0);
  const concentration = {
    totalCases,
    top5CaseSharePct:
      totalCases > 0
        ? Math.round((top5CaseCount / totalCases) * 100 * 10) / 10
        : null,
    top5: top5Cases.map((r) => ({ name: r.name, total_cases: r.total_cases })),
  };

  // --- Cases vs risk patterns (neutral — model-aware, not "mismatch") ---
  const sortedCounts = rows
    .map((r) => r.total_cases || 0)
    .sort((a, b) => a - b);
  const medianCases = sortedCounts.length
    ? sortedCounts[Math.floor(sortedCounts.length / 2)]
    : 0;
  const p75Cases = sortedCounts.length
    ? sortedCounts[Math.floor((sortedCounts.length - 1) * 0.75)]
    : 0;

  const highRiskLowerCase = scored
    .filter((r) => r.risk_class === 'High' && (r.total_cases || 0) < medianCases)
    .map((r) => ({
      name: r.name,
      risk_score: r.risk_score,
      total_cases: r.total_cases,
    }));
  const highCaseLowerRisk = scored
    .filter(
      (r) =>
        r.risk_class !== 'High' &&
        (r.total_cases || 0) >= p75Cases &&
        (r.total_cases || 0) > 0
    )
    .map((r) => ({
      name: r.name,
      risk_class: r.risk_class,
      risk_score: r.risk_score,
      total_cases: r.total_cases,
    }));

  const casesVsRiskPatterns = {
    medianCases,
    p75Cases,
    highRiskLowerCaseCount: highRiskLowerCase.length,
    highCaseCountLowerRisk: highCaseLowerRisk.length,
    highRiskLowerCase,
    highCaseLowerRisk,
  };

  // --- Trend distribution (actual labels) ---
  const trendCounts = { Increasing: 0, Decreasing: 0, Stable: 0 };
  for (const r of scored) {
    const d = r.trend_direction || 'Stable';
    trendCounts[d] = (trendCounts[d] || 0) + 1;
  }

  // --- Optional focus barangay ---
  let focus = null;
  if (filters.barangay) {
    const f = rows.find(
      (r) => r.name.toLowerCase() === String(filters.barangay).toLowerCase()
    );
    if (f) {
      focus = {
        name: f.name,
        risk_class: f.risk_class || 'No Data',
        risk_score: f.risk_score,
        incidence_per_100k: f.incidence_per_100k,
        trend_direction: f.trend_direction || 'Stable',
        total_cases: f.total_cases,
        population: f.population,
        rank: byRisk.findIndex((r) => r.name === f.name) + 1 || null,
        total_scored: byRisk.length,
      };
    }
  }

  return {
    riskCounts,
    topHotspots,
    concentration,
    casesVsRiskPatterns,
    trendCounts,
    coverage: {
      scoredBarangays: scored.length,
      totalBarangays: rows.length,
      noDataBarangays,
      period: latestPeriod,
      periodYear,
      dataYear: snapshotDataYear,
      caseYear,
    },
    incidence: {
      available: incidenceAvailable,
      // The year of the cases and population used for this incidence.
      periodYear: caseYear,
      periodYearHasPopulation,
      barangaysWithIncidence: withIncidence,
    },
    focus,
  };
}

module.exports = { buildAnalyticsMetrics, buildForecastingMetrics, buildGisMetrics };
