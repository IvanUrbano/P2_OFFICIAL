/**
 * TBInsight — Python ML Service HTTP Client
 *
 * Wraps fetch calls to the FastAPI ML service (Plan 02).
 * Service URL configured via ML_SERVICE_URL env var (default: http://localhost:8001).
 *
 * Endpoints consumed:
 *   POST /forecast   — ARIMA forecasting
 *   POST /classify   — RF risk classification
 *   POST /evaluate   — Walk-forward evaluation (ARIMA + RF)
 *   POST /thresholds — Risk band cut points
 *   GET  /health     — Service liveness check
 */

const ML_BASE = process.env.ML_SERVICE_URL || 'http://localhost:8001';
const ML_API_KEY = process.env.ML_API_KEY;
if (!ML_API_KEY) {
  console.warn('⚠️ ML_API_KEY not set — ML service calls will fail');
}

// Timeout for ML calls. /forecast fits an ARIMA model per barangay (30 fits + backtests), which
// takes well over a minute on a single core (e.g. Render's free plan).
const ML_TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS) || 300_000;

// Health check timeout. Must exceed a Lambda cold start (the AWS Lambda ML service
// takes ~10s to init), otherwise the first request after idle fails and the pipeline
// falls back to rule-based classification.
const ML_HEALTH_TIMEOUT_MS = Number(process.env.ML_HEALTH_TIMEOUT_MS) || 30_000;

/**
 * Generic POST to the ML service
 * @param {string} path - Endpoint path (e.g. '/forecast')
 * @param {object} body - Request body
 * @returns {object} Parsed JSON response
 * @throws {Error} On network or HTTP errors
 */
async function mlPost(path, body) {
  const url = `${ML_BASE}/api/ml${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ML_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': ML_API_KEY,
      },
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
    const res = await fetch(`${ML_BASE}/api/ml/health`, { signal: AbortSignal.timeout(ML_HEALTH_TIMEOUT_MS) });
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
 * @param {number} forecastHorizon - Number of months to forecast ahead (default 1)
 * @returns {object} {forecasts: [{barangay_name, method, backtest_mae, predictions: [{month, yhat, yhat_lower, yhat_upper}]}]}
 */
async function forecast(series, seasonalM = 12, forecastHorizon = 1) {
  return mlPost('/forecast', { seasonal_m: seasonalM, forecast_horizon: forecastHorizon, series });
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

/**
 * POST /evaluate — Walk-forward evaluation for ARIMA + RF
 * @param {Array} series - [{barangay_name, month, case_count}] per barangay
 * @param {Array} train - [{features: {...}, incidence: float}] training rows
 * @param {object} thresholds - {low_max, med_max}
 * @param {number} minTrain - Minimum training size (default 24)
 * @returns {object} {arima: {mae, mape, n_steps, steps}, rf: {accuracy, f1_macro, ...}}
 */
async function evaluate(series, train, thresholds, minTrain = 24) {
  return mlPost('/evaluate', { series, train, thresholds, min_train: minTrain });
}

module.exports = {
  mlPost,
  healthCheck,
  forecast,
  classify,
  thresholds,
  evaluate,
  ML_BASE,
};
