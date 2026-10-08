/**
 * alertEngine.js — Rule-based alert evaluation + notification creation
 *
 * Alerts:    Conditions requiring attention (hotspot, surge, forecast, treatment)
 * Notifications: Informational system events (import, forecast generated, report)
 */

const pool = require('../db');
const { NORMALIZE_OUTCOME_SQL, SUCCESS_OUTCOMES, EVALUATED_TERMINAL_OUTCOMES } = require('./outcomeNormalization');

// ── Thresholds ──────────────────────────────────────────────────────────────
const THRESHOLDS = {
  CASE_INCREASE_PERCENT: 20,
  FORECAST_INCIDENCE: 4200,  // Annual incidence per 100k (was 350 monthly × 12)
  TREATMENT_SUCCESS_TARGET: 85,
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
 * High-Risk Hotspot Detected
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
    title: sorted.length === 1 ? 'High-Risk Hotspot Detected' : `${sorted.length} High-Risk Hotspots Detected`,
    message: `${sorted.length} barangay${sorted.length > 1 ? 's' : ''} classified as high-risk TB hotspot${sorted.length > 1 ? 's' : ''}: ${topList}${suffix}.`,
    recommendation: `Increase surveillance and resource allocation in affected barangays. Review TB case management and contact tracing activities.`,
    barangayName: null,
    metadata: { affected_barangays: sorted.map(row => row.barangay_name) },
    period,
    sourceModule: 'gis',
  });
  if (id) created.push(id);
  return created;
}

/**
 * Rapid Increase in TB Cases
 * Compares current month case count with previous month per barangay.
 * Creates a single summary alert listing all affected barangays.
 */
async function evaluateCaseIncreaseAlerts(poolOrClient, period) {
  const created = [];
  await deleteStaleAlerts(poolOrClient, { alertType: 'case_increase', period });

  const result = await poolOrClient.query(
    `SELECT
       curr.barangay_name,
       curr.case_count AS current_count,
       prev.case_count AS previous_count
     FROM monthly_case_summary curr
     LEFT JOIN monthly_case_summary prev
       ON curr.barangay_name = prev.barangay_name
       AND prev.month = curr.month - INTERVAL '1 month'
     WHERE curr.month = $1
       AND prev.case_count IS NOT NULL
       AND prev.case_count > 0`,
    [period]
  );

  const affected = [];
  for (const row of result.rows) {
    const pctChange = ((row.current_count - row.previous_count) / row.previous_count) * 100;
    if (pctChange >= THRESHOLDS.CASE_INCREASE_PERCENT) {
      affected.push({ ...row, pctChange });
    }
  }

  if (affected.length === 0) return created;

  affected.sort((a, b) => b.pctChange - a.pctChange);
  const maxPct = Math.max(...affected.map(r => r.pctChange));
  const severity = maxPct >= 50 ? 'critical' : 'high';

  const topList = affected.slice(0, 5).map(r =>
    `${r.barangay_name} (+${r.pctChange.toFixed(1)}%, ${r.current_count} vs ${r.previous_count})`
  ).join('; ');
  const suffix = affected.length > 5 ? ` and ${affected.length - 5} more` : '';

  const id = await insertAlert(poolOrClient, {
    alertType: 'case_increase',
    severity,
    title: affected.length === 1 ? 'Rapid Increase in TB Cases' : `Rapid Increase in TB Cases — ${affected.length} Barangays`,
    message: `${affected.length} barangay${affected.length > 1 ? 's' : ''} showed a ≥${THRESHOLDS.CASE_INCREASE_PERCENT}% increase in TB cases compared to the previous period: ${topList}${suffix}.`,
    recommendation: `Investigate the surge across affected barangays. Consider expanding case finding and contact tracing.`,
    barangayName: null,
    metadata: { affected_barangays: affected.map(row => row.barangay_name) },
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
 * Calculates overall treatment success rate from outcome_summary.
 */
async function evaluateTreatmentAlerts(poolOrClient, period) {
  const created = [];
  // Clean up stale alerts for this type/period before re-evaluating
  await deleteStaleAlerts(poolOrClient, { alertType: 'low_treatment_success', period });

  const result = await poolOrClient.query(
    `SELECT
       SUM(CASE WHEN ${NORMALIZE_OUTCOME_SQL} = ANY($2) THEN case_count ELSE 0 END) AS success_count,
       SUM(CASE WHEN ${NORMALIZE_OUTCOME_SQL} = ANY($3) THEN case_count ELSE 0 END) AS total_count
     FROM outcome_summary
     WHERE month = $1`,
    [period, SUCCESS_OUTCOMES, EVALUATED_TERMINAL_OUTCOMES]
  );

  if (!result.rows.length) return created;
  const { success_count, total_count } = result.rows[0];
  if (!total_count || total_count === 0) return created;

  const successRate = (success_count / total_count) * 100;
  if (successRate < THRESHOLDS.TREATMENT_SUCCESS_TARGET) {
    const diff = THRESHOLDS.TREATMENT_SUCCESS_TARGET - successRate;
    const severity = successRate < 70 ? 'critical' : 'high';
    const id = await insertAlert(poolOrClient, {
      alertType: 'low_treatment_success',
      severity,
      title: 'Treatment Success Rate Below Target',
      message: `Treatment success rate for the reporting period is ${successRate.toFixed(1)}%, which is below the ${THRESHOLDS.TREATMENT_SUCCESS_TARGET}% target (difference: ${diff.toFixed(1)} percentage points).`,
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
