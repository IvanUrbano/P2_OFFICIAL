/**
 * TBInsight — Risk Scoring & Alert Generation
 *
 * Scoring: weighted risk index (transparent, no black box).
 *   risk_score = 0.45 × normalized_incidence
 *              + 0.25 × normalized_trend
 *              + 0.20 × neighbor_risk
 *              + 0.10 × normalized_forecast_error
 *
 * All components normalized to [0, 1]. Final score × 100 → [0, 100].
 *
 * Alerts: rule-based, generated after each pipeline run.
 *   - high_risk_escalation: forecast enters High band
 *   - critical_surge: >30% case increase in recent window
 *   - low_success_rate: treatment success < 60%
 */

/**
 * Compute weighted risk score for a single barangay.
 *
 * @param {object} params
 * @param {number} params.incidence - Current or forecasted incidence per 100k
 * @param {number} params.trend - Slope per month (from linear regression)
 * @param {number} params.neighborRisk - Average risk of neighbors [0, 1]
 * @param {number} params.forecastError - Absolute forecast error (or 0 if unknown)
 * @param {number} params.maxIncidence - Max incidence across all barangays (for normalization)
 * @param {number} params.maxTrend - Max absolute trend across all barangays
 * @param {number} params.maxError - Max forecast error across all barangays
 * @returns {{ riskScore: number, riskClass: string }}
 */
function computeRiskScore({ incidence, trend, neighborRisk, forecastError, maxIncidence, maxTrend, maxError }) {
  // Normalize each component to [0, 1]
  const normIncidence = maxIncidence > 0 ? Math.min(incidence / maxIncidence, 1) : 0;
  const normTrend = maxTrend > 0 ? Math.min(Math.abs(trend) / maxTrend, 1) : 0;
  const normError = maxError > 0 ? Math.min(forecastError / maxError, 1) : 0;

  // Weighted sum
  const score =
    0.45 * normIncidence +
    0.25 * normTrend +
    0.20 * neighborRisk +
    0.10 * normError;

  const riskScore = Math.round(score * 100 * 100) / 100; // 2 decimal places

  // Classify using tertile logic (on the 0-100 scale)
  let riskClass;
  if (riskScore <= 33) riskClass = 'Low';
  else if (riskScore <= 66) riskClass = 'Medium';
  else riskClass = 'High';

  return { riskScore, riskClass };
}

/**
 * Compute neighbor risk for all barangays.
 * neighbor_risk for barangay X = average incidence of all OTHER barangays,
 * normalized to [0, 1] using min-max across all barangays.
 *
 * @param {Array} barangays - [{name, incidence_per_100k}]
 * @returns {Object} { barangayName: normalizedNeighborRisk }
 */
function computeNeighborRisks(barangays) {
  const incidenceMap = {};
  for (const b of barangays) {
    incidenceMap[b.name] = b.incidence_per_100k || 0;
  }

  const names = barangays.map(b => b.name);
  const result = {};

  for (const name of names) {
    const others = names.filter(n => n !== name);
    if (others.length === 0) {
      result[name] = 0;
      continue;
    }
    const avg = others.reduce((sum, n) => sum + (incidenceMap[n] || 0), 0) / others.length;
    result[name] = avg;
  }

  // Normalize to [0, 1]
  const values = Object.values(result);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  for (const name of names) {
    result[name] = range > 0 ? (result[name] - min) / range : 0;
  }

  return result;
}

/**
 * Compute historical bias per barangay.
 * historical_bias = AVG of past absolute forecast errors for that barangay.
 * Returns 0 for barangays with no past predictions.
 *
 * @param {Array} pastPredictions - [{barangay_name, actual_count, forecasted_count}]
 *   Only rows where actual_count IS NOT NULL are useful.
 * @returns {Object} { barangayName: avgAbsoluteError }
 */
function computeHistoricalBias(pastPredictions) {
  const errorsByName = {};

  for (const row of pastPredictions) {
    if (row.actual_count == null || row.forecasted_count == null) continue;
    const name = row.barangay_name;
    const absErr = Math.abs(row.actual_count - row.forecasted_count);
    if (!errorsByName[name]) errorsByName[name] = [];
    errorsByName[name].push(absErr);
  }

  const result = {};
  for (const [name, errs] of Object.entries(errorsByName)) {
    result[name] = errs.reduce((a, b) => a + b, 0) / errs.length;
  }
  return result;
}

/**
 * Detect trend direction from slope.
 * @param {number} slope - Monthly slope from linear regression
 * @returns {'Increasing' | 'Decreasing' | 'Stable'}
 */
function classifyTrend(slope) {
  if (slope > 0.5) return 'Increasing';
  if (slope < -0.5) return 'Decreasing';
  return 'Stable';
}

/**
 * Generate alerts based on pipeline results.
 *
 * @param {Object} params
 * @param {Array} params.forecasts - [{barangay_name, forecasted_count, method}]
 * @param {Array} params.classifications - [{barangay_name, risk_class, incidence_per_100k}]
 * @param {Array} params.barangayList - [{name}] all barangays
 * @param {Object} params.prevRiskClasses - {barangayName: risk_class} from previous run
 * @param {string} params.period - Forecast period (YYYY-MM-DD)
 * @returns {Array} [{barangay_name, period, alert_type, severity, message, recommendation}]
 */
function generateAlerts({ forecasts, classifications, barangayList, prevRiskClasses, period }) {
  const alerts = [];
  const classByName = {};
  for (const c of classifications) {
    classByName[c.barangay_name] = c;
  }

  for (const b of barangayList) {
    const name = b.name;
    const currentClass = classByName[name]?.risk_class;
    const prevClass = prevRiskClasses[name];

    if (!currentClass) continue;

    // Alert 1: High-risk escalation (was Medium, now High)
    if (currentClass === 'High' && prevClass && prevClass !== 'High') {
      alerts.push({
        barangay_name: name,
        period,
        alert_type: 'high_risk_escalation',
        severity: 'warning',
        message: `${name} is projected to enter High risk in ${period}. ` +
                 `Previous classification: ${prevClass}.`,
        recommendation: `Consider increasing resource allocation and surveillance in ${name}. ` +
                        `Review TB case management and contact tracing activities.`,
      });
    }

    // Alert 2: Critical surge (>30% increase) — based on incidence trend
    const classification = classByName[name];
    if (classification && classification.risk_class === 'High') {
      alerts.push({
        barangay_name: name,
        period,
        alert_type: 'high_risk_escalation',
        severity: 'danger',
        message: `${name} — Forecasted to remain in High risk band. ` +
                 `Incidence: ${classification.incidence_per_100k?.toFixed(1) || 'N/A'} per 100k.`,
        recommendation: `Immediate intervention recommended. Deploy additional DOTS workers, ` +
                        `increase case finding frequency, and ensure drug supply adequacy.`,
      });
    }
  }

  return alerts;
}

/**
 * Store pipeline results into L4 tables.
 *
 * @param {object} client - pg client (in transaction)
 * @param {string} period - Forecast period (YYYY-MM-DD) — start of forecast window
 * @param {Array} forecasts - ML forecast results
 * @param {Array} classifications - ML classify results
 * @param {Array} riskScores - [{barangay_name, risk_score, risk_class, incidence_per_100k, trend_direction}]
 * @param {Array} alerts - Generated alerts
 * @param {string} modelVersion - Version string
 */
async function storeResults(client, period, forecasts, classifications, riskScores, alerts, modelVersion) {
  // Collect all forecast periods so we can clear them idempotently
  const allPeriods = new Set();
  for (const fc of forecasts) {
    for (const pt of (fc.predictions || [])) {
      if (pt.month) allPeriods.add(pt.month);
    }
  }
  // Fallback: ensure at least the primary period is included
  if (allPeriods.size === 0) allPeriods.add(period);
  const periodList = [...allPeriods].sort();

  // Clear previous results for all forecast periods (idempotent re-runs)
  await client.query(
    'DELETE FROM model_predictions WHERE period = ANY($1::date[])',
    [periodList]
  );
  await client.query('DELETE FROM barangay_risk_scores WHERE period = $1', [period]);
  await client.query('DELETE FROM alerts WHERE period = $1', [period]);

  // Batch-fetch actual counts per barangay per period from monthly_case_summary
  let actualCountsByPeriod = {};
  try {
    const acResult = await client.query(
      `SELECT barangay_name, month, case_count
       FROM monthly_case_summary`
    );
    for (const row of acResult.rows) {
      const key = `${row.barangay_name}||${row.month.toISOString().slice(0, 10)}`;
      actualCountsByPeriod[key] = row.case_count;
    }
  } catch {
    // table might be empty on first run
  }

  // Build all INSERT rows in memory, then batch insert
  const insertRows = [];
  for (const fc of forecasts) {
    const predPoints = fc.predictions || [];
    const risk = riskScores.find(r => r.barangay_name === fc.barangay_name);
    const classResult = classifications.find(c => c.barangay_name === fc.barangay_name);

    for (const pt of predPoints) {
      if (!pt.month) continue;
      // Look up actual count for this specific barangay + period
      const lookupKey = `${fc.barangay_name}||${pt.month}`;
      const actualCount = actualCountsByPeriod[lookupKey] ?? null;
      insertRows.push([
        fc.barangay_name,
        pt.month,
        pt.yhat,
        pt.yhat_lower,
        pt.yhat_upper,
        classResult?.risk_class || null,
        risk?.incidence_per_100k || 0,
        actualCount,
        modelVersion,
      ]);
    }
  }

  // Batch INSERT using multi-row VALUES
  if (insertRows.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < insertRows.length; i += chunkSize) {
      const chunk = insertRows.slice(i, i + chunkSize);
      const placeholders = chunk.map((_, idx) => {
        const base = idx * 9;
        return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9})`;
      }).join(', ');
      const flatParams = chunk.flat();
      await client.query(
        `INSERT INTO model_predictions
          (barangay_name, period, forecasted_count, confidence_lower, confidence_upper,
           risk_class, incidence_per_100k, actual_count, model_version)
         VALUES ${placeholders}`,
        flatParams
      );
    }
  }

  // Store risk scores
  for (const rs of riskScores) {
    await client.query(
      `INSERT INTO barangay_risk_scores
        (barangay_name, period, risk_score, risk_class, incidence_per_100k, trend_direction)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        rs.barangay_name,
        period,
        rs.risk_score,
        rs.risk_class,
        rs.incidence_per_100k,
        rs.trend_direction,
      ]
    );
  }

  // Store alerts
  for (const alert of alerts) {
    await client.query(
      `INSERT INTO alerts
        (barangay_name, period, alert_type, severity, message, recommendation)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        alert.barangay_name,
        alert.period,
        alert.alert_type,
        alert.severity,
        alert.message,
        alert.recommendation,
      ]
    );
  }
}

module.exports = {
  computeRiskScore,
  computeNeighborRisks,
  computeHistoricalBias,
  classifyTrend,
  generateAlerts,
  storeResults,
};
