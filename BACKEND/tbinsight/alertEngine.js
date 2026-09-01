/**
 * alertEngine.js — Rule-based alert evaluation + notification creation
 *
 * Alerts:    Conditions requiring attention (hotspot, surge, forecast, treatment)
 * Notifications: Informational system events (import, forecast generated, report)
 */

const pool = require('../db');

// ── Thresholds ──────────────────────────────────────────────────────────────
const THRESHOLDS = {
  CASE_INCREASE_PERCENT: 20,
  FORECAST_INCIDENCE: 4200,  // Annual incidence per 100k (was 350 monthly × 12)
  TREATMENT_SUCCESS_TARGET: 85,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

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
       barangay_name, period, source_module, status)
     VALUES ('alert', $1, $2, $3, $4, $5, $6, $7, $8, 'unread')
     RETURNING id`,
    [title || alertType, alertType, severity, message, recommendation || null,
     barangayName || null, period, sourceModule]
  );
  return result.rows[0].id;
}

/**
 * Create a notification row (type = 'notification').
 */
async function createNotification(poolOrClient, { title, message, sourceModule, relatedRecordId, relatedEntityType, metadata }) {
  const result = await poolOrClient.query(
    `INSERT INTO alerts (type, title, alert_type, severity, message,
       source_module, related_record_id, related_entity_type, status, metadata)
     VALUES ('notification', $1, 'system_notification', 'info', $2, $3, $4, $5, 'unread', $6)
     RETURNING id`,
    [title, message, sourceModule || null, relatedRecordId || null,
     relatedEntityType || null, metadata ? JSON.stringify(metadata) : null]
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
 */
async function evaluateHotspotAlerts(poolOrClient, period) {
  const created = [];
  const result = await poolOrClient.query(
    `SELECT barangay_name, risk_score, incidence_per_100k
     FROM barangay_risk_scores
     WHERE period = $1 AND risk_class = 'High'`,
    [period]
  );

  for (const row of result.rows) {
    const severity = row.risk_score >= 80 ? 'critical' : 'high';
    const id = await insertAlert(poolOrClient, {
      alertType: 'high_risk_hotspot',
      severity,
      title: 'High-Risk Hotspot Detected',
      message: `Barangay ${row.barangay_name} has been classified as a high-risk TB hotspot. Risk score: ${row.risk_score?.toFixed(1)}. Incidence: ${row.incidence_per_100k?.toFixed(1)} per 100k.`,
      recommendation: `Increase surveillance and resource allocation in ${row.barangay_name}. Review TB case management and contact tracing activities.`,
      barangayName: row.barangay_name,
      period,
      sourceModule: 'gis',
    });
    if (id) created.push(id);
  }
  return created;
}

/**
 * Rapid Increase in TB Cases
 * Compares current month case count with previous month per barangay.
 */
async function evaluateCaseIncreaseAlerts(poolOrClient, period) {
  const created = [];
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

  for (const row of result.rows) {
    const pctChange = ((row.current_count - row.previous_count) / row.previous_count) * 100;
    if (pctChange >= THRESHOLDS.CASE_INCREASE_PERCENT) {
      const severity = pctChange >= 50 ? 'critical' : 'high';
      const id = await insertAlert(poolOrClient, {
        alertType: 'case_increase',
        severity,
        title: 'Rapid Increase in TB Cases',
        message: `TB cases in ${row.barangay_name} increased by ${pctChange.toFixed(1)}% compared with the previous period. Current: ${row.current_count}, Previous: ${row.previous_count}.`,
        recommendation: `Investigate the surge in ${row.barangay_name}. Consider expanding case finding and contact tracing.`,
        barangayName: row.barangay_name,
        period,
        sourceModule: 'analytics',
      });
      if (id) created.push(id);
    }
  }
  return created;
}

/**
 * Forecast Exceeds Threshold
 * Checks model_predictions where incidence_per_100k exceeds threshold.
 */
async function evaluateForecastAlerts(poolOrClient, period) {
  const created = [];
  const result = await poolOrClient.query(
    `SELECT barangay_name, forecasted_count, incidence_per_100k, confidence_upper
     FROM model_predictions
     WHERE period = $1 AND incidence_per_100k > $2`,
    [period, THRESHOLDS.FORECAST_INCIDENCE]
  );

  for (const row of result.rows) {
    const severity = row.incidence_per_100k >= 6000 ? 'critical' : 'high';
    const id = await insertAlert(poolOrClient, {
      alertType: 'forecast_exceeds_threshold',
      severity,
      title: 'Forecast Exceeds Threshold',
      message: `Projected TB cases for ${row.barangay_name} exceed the defined threshold. Forecasted incidence: ${row.incidence_per_100k?.toFixed(1)} per 100k (threshold: ${THRESHOLDS.FORECAST_INCIDENCE}).`,
      recommendation: `Prepare contingency resources for ${row.barangay_name}. Review prevention and treatment capacity.`,
      barangayName: row.barangay_name,
      period,
      sourceModule: 'forecasting',
    });
    if (id) created.push(id);
  }
  return created;
}

/**
 * Treatment Success Rate Below Target
 * Calculates overall treatment success rate from outcome_summary.
 */
async function evaluateTreatmentAlerts(poolOrClient, period) {
  const created = [];
  const result = await poolOrClient.query(
    `SELECT
       SUM(CASE WHEN outcome_status IN ('TREATMENT COMPLETED', 'CURED') THEN case_count ELSE 0 END) AS success_count,
       SUM(case_count) AS total_count
     FROM outcome_summary
     WHERE month = $1`,
    [period]
  );

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
 */
async function evaluateAllAlerts(poolOrClient, period) {
  const results = {
    hotspots: [],
    caseIncrease: [],
    forecast: [],
    treatment: [],
  };

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
