/**
 * alertEngine.js — Rule-based alert evaluation + notification creation
 *
 * Alerts:    Conditions requiring attention (hotspot, surge, forecast, treatment)
 * Notifications: Informational system events (import, forecast generated, report)
 */

const pool = require('../db');
const { TREATMENT_SUCCESS_TARGET } = require('./targets');
const { computeTreatmentSuccessRate } = require('./treatmentSuccessRate');

// ── Thresholds ──────────────────────────────────────────────────────────────
const THRESHOLDS = {
  CASE_INCREASE_PERCENT: 20,
  FORECAST_INCIDENCE: 4200,  // Annual incidence per 100k (was 350 monthly × 12)
  TREATMENT_SUCCESS_TARGET,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Delete all non-resolved alerts of a given type for a specific period.
 * This ensures stale alerts are cleaned up before re-evaluation.
 */
async function deleteStaleAlerts(poolOrClient, { alertType, period }) {
  const result = await poolOrClient.query(
    `DELETE FROM alerts
     WHERE alert_type = $1
       AND period = $2
       AND status != 'resolved'`,
    [alertType, period]
  );
  return result.rowCount;
}

/**
 * Check if an identical unresolved alert already exists.
 * Returns the existing alert id if found, null otherwise.
 */
async function deduplicateAlert(poolOrClient, { alertType, sourceModule, barangayName, period }) {
  const result = await poolOrClient.query(
    `SELECT id FROM alerts
     WHERE alert_type = $1
       AND source_module = $2
       AND (barangay_name = $3 OR (barangay_name IS NULL AND $3 IS NULL))
       AND period = $4
       AND status != 'resolved'
     LIMIT 1`,
    [alertType, sourceModule, barangayName || null, period]
  );
  return result.rows[0]?.id || null;
}

/**
 * Insert an alert row (type = 'alert').
 */
async function insertAlert(poolOrClient, { alertType, severity, message, recommendation, barangayName, period, sourceModule, title, metadata }) {
  const existing = await deduplicateAlert(poolOrClient, {
    alertType, sourceModule, barangayName, period,
  });
  if (existing) return existing;

  const result = await poolOrClient.query(
    `INSERT INTO alerts (type, title, alert_type, severity, message, recommendation,
       barangay_name, period, source_module, status, metadata)
     VALUES ('alert', $1, $2, $3, $4, $5, $6, $7, $8, 'unread', $9)
     RETURNING id`,
    [title || alertType, alertType, severity, message, recommendation || null,
     barangayName || null, period, sourceModule, metadata ? JSON.stringify(metadata) : null]
  );
  return result.rows[0].id;
}

/**
 * Create a notification row (type = 'notification').
 */
async function createNotification(poolOrClient, { title, message, sourceModule, relatedRecordId, relatedEntityType, metadata }) {
  const period = new Date().toISOString().slice(0, 7) + '-01'; // Current month as default
  const result = await poolOrClient.query(
    `INSERT INTO alerts (type, title, alert_type, severity, message,
       source_module, related_record_id, related_entity_type, status, period, metadata)
     VALUES ('notification', $1, 'system_notification', 'info', $2, $3, $4, $5, 'unread', $6, $7)
     RETURNING id`,
    [title, message, sourceModule || null, relatedRecordId || null,
     relatedEntityType || null, period, metadata ? JSON.stringify(metadata) : null]
  );
  return result.rows[0].id;
}

/**
 * Get count of unread alerts + notifications.
 */
async function getUnreadCount(poolOrClient) {
  const result = await poolOrClient.query(
    `SELECT COUNT(*)::int AS count FROM alerts WHERE status = 'unread'`
  );
  return result.rows[0].count;
}

// ── Alert Evaluations ───────────────────────────────────────────────────────

/**
 * High-Priority Barangays Detected (alert type high_risk_hotspot, kept for stored alerts)
 * Checks barangay_risk_scores for barangays classified as High.
 * Creates a single summary alert listing all high-risk barangays.
 */
async function evaluateHotspotAlerts(poolOrClient, period) {
  const created = [];
  await deleteStaleAlerts(poolOrClient, { alertType: 'high_risk_hotspot', period });

  const result = await poolOrClient.query(
    `SELECT barangay_name, risk_score, incidence_per_100k
     FROM barangay_risk_scores
     WHERE period = $1 AND risk_class = 'High'`,
    [period]
  );

  if (result.rows.length === 0) return created;

  const sorted = result.rows.sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0));
  const maxScore = Math.max(...sorted.map(r => r.risk_score || 0));
  const severity = maxScore >= 80 ? 'critical' : 'high';

  const topList = sorted.slice(0, 5).map(r =>
    `${r.barangay_name} (score: ${r.risk_score?.toFixed(1)}, incidence: ${r.incidence_per_100k?.toFixed(1)}/100k)`
  ).join('; ');
  const suffix = sorted.length > 5 ? ` and ${sorted.length - 5} more` : '';

  const id = await insertAlert(poolOrClient, {
    alertType: 'high_risk_hotspot',
    severity,
    title: sorted.length === 1 ? 'High-Priority Barangay Detected' : `${sorted.length} High-Priority Barangays Detected`,
    message: `${sorted.length} barangay${sorted.length > 1 ? 's' : ''} classified as High priority for TB: ${topList}${suffix}.`,
    recommendation: `Increase surveillance and resource allocation in affected barangays. Review TB case management and contact tracing activities.`,
    barangayName: null,
    metadata: { affected_barangays: sorted.map(row => row.barangay_name) },
    period,
    sourceModule: 'gis',
  });
  if (id) created.push(id);
  return created;
}

// Monthly barangay counts are mostly chance (see AGENTS.md "Data reality"): comparing one
// month with the month before flagged ~9 barangays a month. A rise only counts when it is
// big, at least a few cases, and unlikely to be chance. The comparison is with the same
// months a year earlier so the city-wide Jul-Sep peak does not read as a surge.
const CASE_INCREASE = {
  WINDOW_MONTHS: 3,
  MIN_EXTRA_CASES: 3,
  MAX_CHANCE: 0.05,
};

/**
 * Probability of a rise at least this large if the true rate did not change.
 * Under an unchanged rate, of the recent + prior cases each is equally likely to fall in
 * either window, so recent ~ Binomial(recent + prior, 0.5). One-sided upper tail.
 */
function riseProbabilityByChance(recent, prior) {
  const n = recent + prior;
  if (n === 0 || recent <= prior) return 1;
  // Sum in log space: 0.5^n underflows for large n.
  let logC = 0; // log C(n, 0)
  const logHalfN = n * Math.log(0.5);
  let tail = 0;
  for (let i = 0; i <= n; i++) {
    if (i > 0) logC += Math.log((n - i + 1) / i);
    if (i >= recent) tail += Math.exp(logC + logHalfN);
  }
  return Math.min(1, tail);
}

function isCaseIncrease(recent, prior) {
  if (recent - prior < CASE_INCREASE.MIN_EXTRA_CASES) return false;
  if (prior > 0 && ((recent - prior) / prior) * 100 < THRESHOLDS.CASE_INCREASE_PERCENT) return false;
  return riseProbabilityByChance(recent, prior) < CASE_INCREASE.MAX_CHANCE;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function windowLabel(endMonth) {
  const year = Number(endMonth.slice(0, 4));
  const end = Number(endMonth.slice(5, 7)) - 1;
  const start = (end - (CASE_INCREASE.WINDOW_MONTHS - 1) + 12) % 12;
  const startYear = start > end ? year - 1 : year;
  return {
    label: `${MONTH_ABBR[start]}${startYear !== year ? ` ${startYear}` : ''}–${MONTH_ABBR[end]} ${year}`,
    priorYear: year - 1,
  };
}

/**
 * Rapid Increase in TB Cases
 * Per barangay, cases in the last 3 complete months vs the same 3 months a year earlier.
 * `period` may be a forecast month with no cases yet, so the window ends at the latest
 * month with data on or before it, skipping the unfinished current month (Philippine time).
 * Creates a single summary alert listing all affected barangays.
 */
async function evaluateCaseIncreaseAlerts(poolOrClient, period) {
  const created = [];
  await deleteStaleAlerts(poolOrClient, { alertType: 'case_increase', period });

  const result = await poolOrClient.query(
    `WITH window_end AS (
       SELECT MAX(month) AS m FROM monthly_case_summary
       WHERE month <= date_trunc('month', $1::date)
         AND month < date_trunc('month', now() AT TIME ZONE 'Asia/Manila')
     )
     SELECT s.barangay_name,
            w.m::date::text AS end_month,
            COALESCE(SUM(s.case_count) FILTER (
              WHERE s.month > w.m - make_interval(months => $2::int)), 0)::int AS recent_count,
            COALESCE(SUM(s.case_count) FILTER (
              WHERE s.month <= w.m - INTERVAL '12 months'), 0)::int AS prior_count,
            COUNT(*) FILTER (WHERE s.month <= w.m - INTERVAL '12 months')::int AS prior_rows
     FROM monthly_case_summary s
     CROSS JOIN window_end w
     WHERE w.m IS NOT NULL
       AND s.month <= w.m
       AND (s.month > w.m - make_interval(months => $2::int)
            OR (s.month <= w.m - INTERVAL '12 months'
                AND s.month > w.m - INTERVAL '12 months' - make_interval(months => $2::int)))
     GROUP BY s.barangay_name, w.m`,
    [period, CASE_INCREASE.WINDOW_MONTHS]
  );

  if (result.rows.length === 0) return created;
  // No data at all for the same months last year (the first year of records): nothing to compare.
  if (!result.rows.some(r => r.prior_rows > 0)) return created;

  const affected = [];
  for (const row of result.rows) {
    if (isCaseIncrease(row.recent_count, row.prior_count)) {
      const pctChange = row.prior_count > 0
        ? ((row.recent_count - row.prior_count) / row.prior_count) * 100
        : null;
      affected.push({ ...row, pctChange });
    }
  }

  if (affected.length === 0) return created;

  const rise = r => r.pctChange ?? Infinity;
  affected.sort((a, b) => rise(b) - rise(a));
  const severity = affected.some(r => rise(r) >= 50) ? 'critical' : 'high';

  const topList = affected.slice(0, 5).map(r =>
    `${r.barangay_name} (${r.pctChange != null ? `+${r.pctChange.toFixed(1)}%, ` : ''}${r.recent_count} vs ${r.prior_count})`
  ).join('; ');
  const suffix = affected.length > 5 ? ` and ${affected.length - 5} more` : '';
  const endMonth = result.rows[0].end_month;
  const { label, priorYear } = windowLabel(endMonth);

  const id = await insertAlert(poolOrClient, {
    alertType: 'case_increase',
    severity,
    title: affected.length === 1 ? 'Rapid Increase in TB Cases' : `Rapid Increase in TB Cases — ${affected.length} Barangays`,
    message: `${affected.length} barangay${affected.length > 1 ? 's' : ''} had at least ${THRESHOLDS.CASE_INCREASE_PERCENT}% more TB cases in ${label} than in the same months in ${priorYear}, a rise unlikely to be chance: ${topList}${suffix}.`,
    recommendation: `Investigate the surge across affected barangays. Consider expanding case finding and contact tracing.`,
    barangayName: null,
    metadata: {
      affected_barangays: affected.map(row => row.barangay_name),
      window_end: endMonth,
      window_months: CASE_INCREASE.WINDOW_MONTHS,
    },
    period,
    sourceModule: 'analytics',
  });
  if (id) created.push(id);
  return created;
}

/**
 * Forecast Exceeds Threshold
 * Checks model_predictions where incidence_per_100k exceeds threshold.
 * Creates a single summary alert listing all affected barangays.
 */
async function evaluateForecastAlerts(poolOrClient, period) {
  const created = [];
  await deleteStaleAlerts(poolOrClient, { alertType: 'forecast_exceeds_threshold', period });

  const result = await poolOrClient.query(
    `SELECT barangay_name, forecasted_count, incidence_per_100k, confidence_upper
     FROM model_predictions
     WHERE period = $1 AND incidence_per_100k > $2`,
    [period, THRESHOLDS.FORECAST_INCIDENCE]
  );

  if (result.rows.length === 0) return created;

  const sorted = result.rows.sort((a, b) => (b.incidence_per_100k || 0) - (a.incidence_per_100k || 0));
  const maxIncidence = Math.max(...sorted.map(r => r.incidence_per_100k || 0));
  const severity = maxIncidence >= 6000 ? 'critical' : 'high';

  const topList = sorted.slice(0, 5).map(r =>
    `${r.barangay_name} (${r.incidence_per_100k?.toFixed(1)}/100k)`
  ).join('; ');
  const suffix = sorted.length > 5 ? ` and ${sorted.length - 5} more` : '';

  const id = await insertAlert(poolOrClient, {
    alertType: 'forecast_exceeds_threshold',
    severity,
    title: sorted.length === 1 ? 'Forecast Exceeds Threshold' : `Forecast Exceeds Threshold — ${sorted.length} Barangays`,
    message: `${sorted.length} barangay${sorted.length > 1 ? 's' : ''} projected to exceed the incidence threshold (${THRESHOLDS.FORECAST_INCIDENCE}/100k): ${topList}${suffix}.`,
    recommendation: `Prepare contingency resources for affected barangays. Review prevention and treatment capacity.`,
    barangayName: null,
    metadata: { affected_barangays: sorted.map(row => row.barangay_name) },
    period,
    sourceModule: 'forecasting',
  });
  if (id) created.push(id);
  return created;
}

/**
 * Treatment Success Rate Below Target
 * City-wide cohort Treatment Success Rate (computeTreatmentSuccessRate), against
 * TREATMENT_SUCCESS_TARGET.
 */
async function evaluateTreatmentAlerts(poolOrClient, period) {
  const created = [];
  // Clean up stale alerts for this type/period before re-evaluating
  await deleteStaleAlerts(poolOrClient, { alertType: 'low_treatment_success', period });

  // The same cohort Treatment Success Rate the Dashboard card shows: no year, so patients who
  // started treatment in the previous calendar year. Not the year of `period` — the pipeline's
  // forecast month — which in December points at January and would judge a cohort still on
  // treatment. It used to read one month of outcome_summary for `period` (no outcomes yet), so it
  // never fired, and its own formula (finished outcomes only) disagreed with the cards.
  const { successRate, cohortYear } = await computeTreatmentSuccessRate(poolOrClient, {});
  if (successRate == null) return created;

  if (successRate < THRESHOLDS.TREATMENT_SUCCESS_TARGET) {
    const diff = THRESHOLDS.TREATMENT_SUCCESS_TARGET - successRate;
    const severity = successRate < 70 ? 'critical' : 'high';
    const id = await insertAlert(poolOrClient, {
      alertType: 'low_treatment_success',
      severity,
      title: 'Treatment Success Rate Below Target',
      message: `Treatment success for the ${cohortYear} treatment cohort is ${successRate.toFixed(1)}%, below the ${THRESHOLDS.TREATMENT_SUCCESS_TARGET}% target (difference: ${diff.toFixed(1)} percentage points).`,
      recommendation: `Review treatment adherence programs. Identify patients lost to follow-up and initiate re-engagement measures.`,
      barangayName: null,
      period,
      sourceModule: 'analytics',
    });
    if (id) created.push(id);
  }
  return created;
}

/**
 * Run all alert evaluations for a given period.
 * First cleans up ALL non-resolved alerts of the 4 evaluation types
 * to prevent stale per-barangay alerts from accumulating.
 */
async function evaluateAllAlerts(poolOrClient, period) {
  const results = {
    hotspots: [],
    caseIncrease: [],
    forecast: [],
    treatment: [],
  };

  // Clean up ALL non-resolved alerts of the 4 evaluation types (regardless of period)
  // This prevents stale per-barangay alerts from accumulating across periods
  // NOTE: high_risk_escalation is NOT included — those are managed by scoring.js (pipeline)
  await poolOrClient.query(
    `DELETE FROM alerts
     WHERE alert_type IN ('high_risk_hotspot', 'case_increase', 'forecast_exceeds_threshold', 'low_treatment_success')
       AND status != 'resolved'`
  );

  try { results.hotspots = await evaluateHotspotAlerts(poolOrClient, period); } catch (e) {
    console.error('Hotspot alert evaluation error:', e.message);
  }
  try { results.caseIncrease = await evaluateCaseIncreaseAlerts(poolOrClient, period); } catch (e) {
    console.error('Case increase alert evaluation error:', e.message);
  }
  try { results.forecast = await evaluateForecastAlerts(poolOrClient, period); } catch (e) {
    console.error('Forecast alert evaluation error:', e.message);
  }
  try { results.treatment = await evaluateTreatmentAlerts(poolOrClient, period); } catch (e) {
    console.error('Treatment alert evaluation error:', e.message);
  }

  const totalCreated =
    results.hotspots.length + results.caseIncrease.length +
    results.forecast.length + results.treatment.length;

  console.log(`Alert evaluation complete for ${period}: ${totalCreated} alerts created.`);
  return results;
}

module.exports = {
  THRESHOLDS,
  CASE_INCREASE,
  isCaseIncrease,
  riseProbabilityByChance,
  deleteStaleAlerts,
  deduplicateAlert,
  insertAlert,
  createNotification,
  getUnreadCount,
  evaluateHotspotAlerts,
  evaluateCaseIncreaseAlerts,
  evaluateForecastAlerts,
  evaluateTreatmentAlerts,
  evaluateAllAlerts,
};
