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
  const incidenceAvailable = incidence !== null && incidence !== undefined;
  const normIncidence = incidenceAvailable && maxIncidence > 0 ? Math.min(incidence / maxIncidence, 1) : 0;
  const normTrend = maxTrend > 0 ? Math.min(Math.abs(trend) / maxTrend, 1) : 0;
  const normError = maxError > 0 ? Math.min(forecastError / maxError, 1) : 0;

  let score;
  if (!incidenceAvailable) {
    // Redistribute incidence weight (0.45) proportionally to other components
    // Remaining weights: trend=0.25, neighbor=0.20, error=0.10, total=0.55
    score = (0.25 / 0.55) * normTrend + (0.20 / 0.55) * neighborRisk + (0.10 / 0.55) * normError;
  } else {
    score =
      0.45 * normIncidence +
      0.25 * normTrend +
      0.20 * neighborRisk +
      0.10 * normError;
  }

  const riskScore = Math.round(score * 100 * 100) / 100; // 2 decimal places

  // Classify using tertile logic (on the 0-100 scale)
  let riskClass;
  if (riskScore <= 33) riskClass = 'Low';
  else if (riskScore <= 66) riskClass = 'Medium';
  else riskClass = 'High';

  return { riskScore, riskClass, normIncidence, normTrend, normError, neighborRisk };
}

/**
 * Normalize a month value to a 'YYYY-MM-01' key.
 *
 * pg returns DATE columns as JS Dates at LOCAL midnight, so the local getters
 * give the right calendar month in any server timezone. (toISOString() shifts
 * back a day east of UTC — e.g. December 2025 became '2025-11-30' in Manila.)
 */
function monthKey(value) {
  if (typeof value === 'string') return value.slice(0, 7) + '-01';
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Assign Low/Medium/High to a set of risk scores by tertile: the bottom third of scores is Low,
 * the top third High. (Fixed cutoffs on the 0-100 scale do not work here: every component is
 * scaled by the current maximum, so scores bunch up and nearly everything lands in Medium.)
 *
 * Boundaries match the incidence thresholds: Low if score <= low_max, High if score > med_max,
 * with cut points at the 1/3 and 2/3 percentiles (linear interpolation).
 *
 * @param {number[]} scores
 * @returns {{ classes: string[], low_max: number|null, med_max: number|null }}
 */
function classifyByTertile(scores) {
  if (scores.length === 0) return { classes: [], low_max: null, med_max: null };
  const sorted = [...scores].sort((a, b) => a - b);
  const percentile = (p) => {
    const pos = (sorted.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  const low_max = percentile(1 / 3);
  const med_max = percentile(2 / 3);
  const classes = scores.map(s => (s <= low_max ? 'Low' : s > med_max ? 'High' : 'Medium'));
  return { classes, low_max, med_max };
}

/**
 * Compute neighbor risk for all barangays.
 * neighbor_risk for barangay X = average incidence of all OTHER barangays,
 * normalized to [0, 1] using min-max across all barangays. Barangays with
 * unavailable (null) incidence are excluded from the average — an unknown
 * incidence must never pull neighbors' scores toward "low risk" by being
 * counted as 0.
 *
 * @param {Array} barangays - [{name, incidence_per_100k}]
 * @returns {Object} { barangayName: normalizedNeighborRisk }
 */
function computeNeighborRisks(barangays) {
  const incidenceMap = {};
  for (const b of barangays) {
    incidenceMap[b.name] = b.incidence_per_100k;
  }

  const names = barangays.map(b => b.name);
  const result = {};

  for (const name of names) {
    const others = names.filter(n => n !== name && incidenceMap[n] != null);
    if (others.length === 0) {
      result[name] = 0;
      continue;
    }
    const avg = others.reduce((sum, n) => sum + incidenceMap[n], 0) / others.length;
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

  const escalated = [];
  const highRisk = [];

  for (const b of barangayList) {
    const name = b.name;
    const currentClass = classByName[name]?.risk_class;
    const prevClass = prevRiskClasses[name];

    if (!currentClass) continue;

    // Escalation: was Medium, now High
    if (currentClass === 'High' && prevClass && prevClass !== 'High') {
      escalated.push({ name, prevClass });
    }

    // Critical surge: currently High risk
    if (currentClass === 'High') {
      const classification = classByName[name];
      highRisk.push({ name, incidence: classification.incidence_per_100k });
    }
  }

  // Group escalation alerts into a single summary
  if (escalated.length > 0) {
    const topList = escalated.slice(0, 5).map(e => `${e.name} (was ${e.prevClass})`).join('; ');
    const suffix = escalated.length > 5 ? ` and ${escalated.length - 5} more` : '';
    alerts.push({
      barangay_name: null,
      period,
      alert_type: 'high_risk_escalation',
      severity: 'warning',
      message: `${escalated.length} barangay${escalated.length > 1 ? 's' : ''} escalated to High risk in ${period}: ${topList}${suffix}.`,
      recommendation: `Consider increasing resource allocation and surveillance in affected barangays. Review TB case management and contact tracing activities.`,
    });
  }

  // Group high-risk alerts into a single summary
  if (highRisk.length > 0) {
    const topList = highRisk.slice(0, 5).map(h =>
      `${h.name} (${h.incidence?.toFixed(1) || 'N/A'}/100k)`
    ).join('; ');
    const suffix = highRisk.length > 5 ? ` and ${highRisk.length - 5} more` : '';
    alerts.push({
      barangay_name: null,
      period,
      alert_type: 'high_risk_escalation',
      severity: 'danger',
      message: `${highRisk.length} barangay${highRisk.length > 1 ? 's' : ''} forecasted to remain in High risk band: ${topList}${suffix}.`,
      recommendation: `Immediate intervention recommended. Deploy additional DOTS workers, increase case finding frequency, and ensure drug supply adequacy.`,
    });
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
 * @param {Array} riskScores - [{barangay_name, risk_score, risk_class, model_type, model_version,
 *   classification_confidence, prob_low, prob_medium, prob_high, features, incidence_per_100k, trend_direction}]
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

  // Clear ALL previous results (each pipeline run replaces all prior forecasts)
  await client.query('DELETE FROM model_predictions WHERE period = ANY($1)', [periodList]);
  await client.query('DELETE FROM barangay_risk_scores WHERE period = $1', [period]);
  await client.query("DELETE FROM alerts WHERE alert_type = 'high_risk_escalation' AND status != 'resolved' AND period = $1", [period]);

  // Batch-fetch actual counts per barangay per period from monthly_case_summary
  let actualCountsByPeriod = {};
  try {
    const acResult = await client.query(
      `SELECT barangay_name, month, case_count
       FROM monthly_case_summary`
    );
    for (const row of acResult.rows) {
      const key = `${row.barangay_name}||${monthKey(row.month)}`;
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

    // Confidence intervals are only ever stored for a genuine 24+-month
    // seasonal ARIMA fit. A 10-23 month series can still successfully fit a
    // NON-seasonal ARIMA (method: 'arima_nonseasonal') with a real
    // statistical CI — but per the approved reporting rule this whole tier
    // surfaces as "Baseline Forecast", so its CI is dropped here rather
    // than downstream, making the database itself the single source of
    // truth for "CI only exists on real ARIMA rows".
    const hasRealCI = fc.method === 'arima';

    for (const pt of predPoints) {
      if (!pt.month) continue;
      // Look up actual count for this specific barangay + period
      const lookupKey = `${fc.barangay_name}||${pt.month}`;
      const actualCount = actualCountsByPeriod[lookupKey] ?? null;
      insertRows.push([
        fc.barangay_name,
        pt.month,
        pt.yhat,
        hasRealCI ? pt.yhat_lower : null,
        hasRealCI ? pt.yhat_upper : null,
        risk?.risk_class || null,
        risk?.incidence_per_100k ?? null,
        actualCount,
        modelVersion,
        fc.method || null,
      ]);
    }
  }

  // Batch INSERT using multi-row VALUES
  if (insertRows.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < insertRows.length; i += chunkSize) {
      const chunk = insertRows.slice(i, i + chunkSize);
      const placeholders = chunk.map((_, idx) => {
        const base = idx * 10;
        return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9}, $${base+10})`;
      }).join(', ');
      const flatParams = chunk.flat();
      await client.query(
        `INSERT INTO model_predictions
          (barangay_name, period, forecasted_count, confidence_lower, confidence_upper,
           risk_class, incidence_per_100k, actual_count, model_version, method)
         VALUES ${placeholders}`,
        flatParams
      );
    }
  }

  // Store risk scores
  for (const rs of riskScores) {
    await client.query(
      `INSERT INTO barangay_risk_scores
        (barangay_name, period, risk_score, risk_class, incidence_per_100k, trend_direction,
         norm_incidence, norm_trend, norm_neighbor_risk, norm_forecast_error, model_type,
         model_version, classification_confidence, prob_low, prob_medium, prob_high, features)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        rs.barangay_name,
        period,
        rs.risk_score,
        rs.risk_class,
        rs.incidence_per_100k,
        rs.trend_direction,
        rs.norm_incidence ?? null,
        rs.norm_trend ?? null,
        rs.norm_neighbor_risk ?? null,
        rs.norm_forecast_error ?? null,
        rs.model_type ?? null,
        rs.model_version ?? null,
        rs.classification_confidence ?? null,
        rs.prob_low ?? null,
        rs.prob_medium ?? null,
        rs.prob_high ?? null,
        rs.features ? JSON.stringify(rs.features) : null,
      ]
    );
  }

  // Store alerts
  for (const alert of alerts) {
    await client.query(
      `INSERT INTO alerts
        (type, title, status, alert_type, severity, message, recommendation,
         barangay_name, period, source_module)
       VALUES ('alert', $1, 'unread', $2, $3, $4, $5, $6, $7, 'analytics')`,
      [
        alert.alert_type === 'high_risk_escalation' ? 'High-Risk Escalation Detected' : 'TB Alert',
        alert.alert_type,
        alert.severity,
        alert.message,
        alert.recommendation,
        alert.barangay_name,
        alert.period,
      ]
    );
  }
}

module.exports = {
  monthKey,
  computeRiskScore,
  classifyByTertile,
  computeNeighborRisks,
  computeHistoricalBias,
  classifyTrend,
  generateAlerts,
  storeResults,
};
