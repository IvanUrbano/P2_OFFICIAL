/**
 * TBInsight — Python ML Service HTTP Client
 *
 * Wraps fetch calls to the FastAPI ML service (Plan 02).
 * Service URL configured via ML_SERVICE_URL env var (default: http://localhost:8001).
 *
 * Endpoints consumed:
 *   POST /forecast   — ARIMA forecasting
 *   POST /classify   — RF risk classification
 *   POST /thresholds — Risk band cut points
 *   GET  /health     — Service liveness check
 */

const ML_BASE = process.env.ML_SERVICE_URL || 'http://localhost:8001';

// Timeout for ML calls (ARIMA can be slow on first run)
const ML_TIMEOUT_MS = 60_000;

/**
 * Generic POST to the ML service
 * @param {string} path - Endpoint path (e.g. '/forecast')
 * @param {object} body - Request body
 * @returns {object} Parsed JSON response
 * @throws {Error} On network or HTTP errors
 */
async function mlPost(path, body) {
  const url = `${ML_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ML_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ML service ${path} returned ${res.status}: ${text}`);
    }

    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`ML service ${path} timed out after ${ML_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Health check — verify ML service is reachable
 * @returns {boolean} true if healthy
 */
async function healthCheck() {
  try {
    const res = await fetch(`${ML_BASE}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * POST /forecast — ARIMA forecasting
 * @param {Array} series - [{barangay_name, month, case_count}] per barangay
 * @param {number} seasonalM - Seasonal period (default 12)
 * @returns {object} {forecasts: [{barangay_name, method, backtest_mae, predictions: [{month, yhat, yhat_lower, yhat_upper}]}]}
 */
async function forecast(series, seasonalM = 12) {
  return mlPost('/forecast', { seasonal_m: seasonalM, series });
}

/**
 * POST /classify — RF risk classification
 * @param {object} thresholds - {low_max, med_max}
 * @param {Array} train - [{features: {...}, incidence: float}]
 * @param {Array} predict - [{barangay_name, features: {...}}]
 * @returns {object} {predictions: [{barangay_name, risk_class, proba: {Low, Medium, High}}]}
 */
async function classify(thresholds, train, predict) {
  return mlPost('/classify', { thresholds, train, predict });
}

/**
 * POST /thresholds — Compute risk band cut points
 * @param {Array} incidences - [float, ...] per barangay
 * @param {string} method - 'tertile' or 'jenks'
 * @returns {object} {method, low_max, med_max}
 */
async function thresholds(incidences, method = 'tertile') {
  return mlPost('/thresholds', { incidences, method });
}

module.exports = {
  mlPost,
  healthCheck,
  forecast,
  classify,
  thresholds,
  ML_BASE,
};
