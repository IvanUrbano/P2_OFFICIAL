/**
 * TBInsight — Pipeline Orchestrator
 *
 * Runs the full prediction pipeline:
 *   1. Group validated cases by month and load barangay populations
 *   2. Build series for Python /forecast → ARIMA predictions
 *   3. Compute RF features per barangay (rolling_12m_incidence, recent_trend,
 *      seasonality_flag, lag_1m, lag_2m, lag_3m, neighbor_risk)
 *   4. Build classify request → Python /classify → risk classes + proba
 *   5. Compute weighted risk scores → L5 (barangay_risk_scores)
 *   6. Store forecasts + classifications → L4 (model_predictions)
 *   7. Generate alerts → L6 (alerts)
 *
 * Design principles:
 *   - Python service is stateless: all data passed in request body
 *   - Thresholds computed once, frozen, passed to /classify each run
 *   - All L4/L5/L6 writes in a single transaction (idempotent re-runs)
 *   - neighbor_risk = incidence of the barangays sharing a border (barangayAdjacency.js)
 *   - Past forecast error feeds only the weighted risk index, never the RF
 *   - Walk-forward evaluation is refreshed automatically after successful
 *     current pipeline runs and saved to model_metadata for the Forecasting UI
 */

const pool = require('../db');
const { forecast, classify, thresholds: callThresholds, healthCheck } = require('./mlClient');
const {
  monthKey,
  computeRiskScore,
  classifyByTertile,
  LOW_PERCENTILE,
  MED_PERCENTILE,
  computeNeighborRisks,
  computeHistoricalBias,
  classifyTrend,
  generateAlerts,
  alertRateByName,
  storeResults,
} = require('./scoring');
const { getPopulationMap, calculateAnnualizedIncidence, GEOJSON_REFERENCE_YEAR } = require('./populationService');
const { createNotification, evaluateAllAlerts } = require('./alertEngine');
const { lockCaseData, caseDataFingerprint } = require('./caseDataLock');
const { loadAdjacency, neighboursOf } = require('./barangayAdjacency');
const { pasigResidentOnly } = require('./locationScope');

// Default thresholds — overridden by auto-calibration from real data on each run
const DEFAULT_THRESHOLDS = {
  low_max: 150.0,
  med_max: 350.0,
};

// Single source of truth for the combined model version string persisted
// alongside every forecast/risk row this run produces.
const MODEL_VERSION = 'arima-v1.2-rf-v1.3';

// Mirrors ML_SERVICE/config.py's ARIMA_MIN_HISTORY_NONSEASONAL. Below this
// many monthly observations, no forecast method (ARIMA or fallback) has
// enough history to be meaningful — used by this file's own ML-service-down
// fallback path, which runs entirely in Node and never calls that Python
// constant directly.
const ARIMA_MIN_HISTORY_NONSEASONAL = 10;

// Every run forecasts at least this many months ahead so the Forecasting
// page's 1-month and 3-month views both have stored data, whichever horizon
// triggered the run (automatic sync runs used to store one month only).
const MIN_STORED_HORIZON = 3;

// Leading months whose city-wide total is below this share of the median month
// are treated as stray records (e.g. one old case) and dropped from the calendar.
const LEADING_TRIM_SHARE = 0.2;

// Months averaged to form one RF training label, starting at the target month
// and running forward (see buildTrainingRows): risk levels cover the next half
// year, the planning period for DOTS staff and supplies. On the same 660
// walk-forward predictions (Jan 2024-Oct 2025, 5 seeds) six months beat three:
// exact level 59.8% -> 61.1%, High vs not High 75.9% -> 76.8%, High<->Low
// mix-ups 49 -> 26. One month is dominated by noise in small barangays; twelve
// fell behind the simple ranking rule. Must match RF_LABEL_HORIZON_MONTHS in
// ML_SERVICE/config.py; defined in riskWindow.js so the page text uses the same number.
const { RISK_WINDOW_MONTHS: LABEL_HORIZON_MONTHS } = require('./riskWindow');

/**
 * Put every barangay on ONE shared monthly calendar with zero-filled gaps.
 *
 * monthly_case_summary has no row for a month with zero cases, so raw series
 * have gaps. Lags, trend windows and neighbor comparisons all assume
 * consecutive months, so gaps must be filled before features are computed.
 *
 * @param {Array} monthlyRows - [{barangay_name, month, case_count}]
 * @param {string[]} barangayNames - Barangays to build series for
 * @returns {{calendar: string[], seriesByBarangay: Object}} series are
 *   [{barangay_name, month: 'YYYY-MM-01', case_count}] in calendar order
 */
function buildDenseSeries(monthlyRows, barangayNames) {
  const totals = new Map();
  const counts = {};
  for (const r of monthlyRows) {
    const m = monthKey(r.month);
    const c = Number(r.case_count);
    totals.set(m, (totals.get(m) || 0) + c);
    (counts[r.barangay_name] ??= {})[m] = (counts[r.barangay_name][m] || 0) + c;
  }
  const sortedMonths = [...totals.keys()].sort();
  if (sortedMonths.length === 0) return { calendar: [], seriesByBarangay: {} };

  const positive = [...totals.values()].filter(v => v > 0).sort((a, b) => a - b);
  const mid = Math.floor(positive.length / 2);
  const median = positive.length === 0
    ? 0
    : positive.length % 2 ? positive[mid] : (positive[mid - 1] + positive[mid]) / 2;
  const first = sortedMonths.find(m => totals.get(m) >= LEADING_TRIM_SHARE * median) || sortedMonths[0];
  const last = sortedMonths[sortedMonths.length - 1];

  const calendar = [];
  let [y, mo] = first.split('-').map(Number);
  const [ly, lmo] = last.split('-').map(Number);
  while (y < ly || (y === ly && mo <= lmo)) {
    calendar.push(`${y}-${String(mo).padStart(2, '0')}-01`);
    mo += 1;
    if (mo > 12) { mo = 1; y += 1; }
  }

  const seriesByBarangay = {};
  for (const name of barangayNames) {
    seriesByBarangay[name] = calendar.map(m => ({
      barangay_name: name,
      month: m,
      case_count: counts[name]?.[m] || 0,
    }));
  }
  return { calendar, seriesByBarangay };
}

/**
 * Drop case rows from the month that has not finished yet (Philippine time).
 *
 * A month still in progress holds only part of its cases, so it reads as a
 * sudden drop: forecasts fitted on it come out low and the RF sees a falling
 * barangay that isn't falling. Forecasting therefore starts from the current
 * month instead of after it. Historical (cutoff) runs never reach this month.
 *
 * @param {Array} monthlyRows - [{month, ...}]
 * @param {Date} [now]
 */
function dropUnfinishedMonth(monthlyRows, now = new Date()) {
  const manila = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const current = `${manila.getUTCFullYear()}-${String(manila.getUTCMonth() + 1).padStart(2, '0')}-01`;
  return monthlyRows.filter(r => monthKey(r.month) < current);
}

/**
 * Run the full prediction pipeline.
 *
 * @param {object} options
 * @param {string} options.period - Forecast period in YYYY-MM-DD format
 *   (defaults to next month from the latest validated case)
 * @param {object} options.thresholds - Override frozen thresholds {low_max, med_max}
 * @param {number} options.forecastHorizon - Months to forecast ahead (raised to MIN_STORED_HORIZON)
 * @param {string[]} options.barangays - Optional array of barangay names to filter (if empty, all)
 * @returns {object} Pipeline run summary
 */
async function runPipeline({
  period, thresholds: thresholdsOverride, forecastHorizon: requestedHorizon = 1, barangays: barangayFilter,
  // historyCutoffMonth ('YYYY-MM-01'): when set, only monthly_case_summary
  // rows up to and including this month are used — i.e. "what would this
  // assessment have looked like using only data through this month". Used
  // to compute a historical per-year risk snapshot (see
  // runHistoricalSnapshots) instead of the current/latest assessment.
  // skipForecast/skipAlerts: historical snapshots only need the risk
  // classification, not a re-run of ARIMA (30 model fits) or operational
  // alerts about something that happened years ago.
  historyCutoffMonth, skipForecast = false, skipAlerts = false,
} = {}) {
  const forecastHorizon = Math.max(Number(requestedHorizon) || 1, MIN_STORED_HORIZON);
  const client = await pool.connect();
  // Released before the long ML calls; the finally below covers early returns and errors.
  let clientReleased = false;
  const releaseClient = () => {
    if (!clientReleased) { clientReleased = true; client.release(); }
  };
  const results = {
    status: 'started',
    period: null,
    forecastHorizon,
    barangaysProcessed: 0,
    forecastsCount: 0,
    classificationsCount: 0,
    riskScoresCount: 0,
    alertsCount: 0,
    thresholdMethod: 'tertile',
    thresholds: null,
    thresholdPercentiles: null,
    mlServiceHealthy: false,
    errors: [],
  };

  try {
    // ── Step 0a: Reconcile past forecasts with actual data ──
    // Fills model_predictions.actual_count for any past forecast whose
    // target month's real case count has since arrived — this is what
    // gives the risk index's forecast-error component real values. Previously
    // this only happened if an admin manually called PUT
    // /predictions/backfill with hand-typed counts; the actual counts are
    // already sitting in the validated case records, so there is nothing to type.
    try {
      const backfilled = await _backfillActualCounts();
      if (backfilled > 0) console.log(`📈 Reconciled ${backfilled} past forecast(s) with actual case counts`);
    } catch (err) {
      console.error('⚠️ Actual-count backfill failed (non-fatal):', err.message);
    }

    // ── Step 0: Check ML service health ──
    results.mlServiceHealthy = await healthCheck();
    if (!results.mlServiceHealthy) {
      results.status = 'degraded';
      results.errors.push('ML service is unreachable. Pipeline will use rule-based fallback.');
      console.warn('⚠️ ML service unhealthy — using rule-based classification only');
    }

    // ── Step 1: Query reference data ──
    const barangaysResult = await client.query(
      'SELECT name FROM barangays ORDER BY name'
    );
    let barangays = barangaysResult.rows;

    if (barangays.length === 0) {
      results.status = 'no_data';
      results.errors.push('No barangays found. Run POST /api/tb/barangays/seed first.');
      return results;
    }

    // Apply barangay filter if provided
    if (barangayFilter && barangayFilter.length > 0) {
      const filterSet = new Set(barangayFilter);
      barangays = barangays.filter(b => filterSet.has(b.name));
      console.log(`🔍 Filtered to ${barangays.length} barangays: ${barangayFilter.join(', ')}`);
    }

    // ── Step 2: Load monthly cases ──
    // Fingerprint of the case set this run is based on; checked again before storing
    // (Step 9) so results computed from since-deleted/changed data are never saved.
    const startFingerprint = await caseDataFingerprint(client);
    const monthlyResult = historyCutoffMonth
      ? await client.query('SELECT barangay_name, month, case_count FROM monthly_case_summary ORDER BY month')
      : await client.query(`
          SELECT barangay_name, DATE_TRUNC('month', date_of_diagnosis)::date AS month,
                 COUNT(*)::integer AS case_count
          FROM tb_cases
          WHERE date_of_diagnosis IS NOT NULL AND ${pasigResidentOnly()}
          GROUP BY barangay_name, DATE_TRUNC('month', date_of_diagnosis)
          ORDER BY month
        `);
    // For a historical snapshot, only data up to and including the cutoff
    // month is visible — this is what makes it "as of that year" rather
    // than a relabeled copy of the current/latest assessment.
    const monthlyRows = historyCutoffMonth
      ? monthlyResult.rows.filter(r => monthKey(r.month) <= historyCutoffMonth)
      : dropUnfinishedMonth(monthlyResult.rows);

    if (monthlyRows.length === 0) {
      results.status = 'no_data';
      results.errors.push('No validated case data available. Import and validate cases first.');
      return results;
    }

    // Release client before long-running ML calls to free pool connections
    releaseClient();

    // Determine forecast period (next month from latest)
    const { calendar, seriesByBarangay } = buildDenseSeries(monthlyRows, barangays.map(b => b.name));
    const latestMonth = calendar[calendar.length - 1];
    results.period = period || _nextMonth(latestMonth);
    results.data_year = Number(latestMonth.slice(0, 4));
    results.assessment_year = Number(String(results.period).slice(0, 4));
    results.assessment_period = results.period;
    results.prediction_period = results.period;
    console.log(`📊 Pipeline period: ${results.period} (latest data: ${latestMonth})`);

    // Population must be looked up PER CALENDAR YEAR, not for a single
    // "reporting year" applied to the whole run. Case data spans multiple
    // years (2023–2025) while results.period is a FUTURE forecast month
    // (e.g. 2026-01) that never has its own population — a single blanket
    // popMap for that future year previously made every row's population
    // unavailable, which (a) NaN-crashed the pipeline (Invalid Date from
    // the undefined `period` argument reaching an integer column) and, once
    // that crash was fixed, (b) silently produced incidence = null for
    // every barangay/period because 2026 population never exists anywhere.
    // Build one population map per year actually present in the data so
    // every incidence figure — training labels, RF features, and the
    // persisted/displayed incidence_per_100k — is matched against ITS OWN
    // year's population, per the "exact matching year, never a fallback
    // year" rule for reported incidence.
    // Population years span the FULL (untruncated) case-data history, not
    // just this run's (possibly cutoff-limited) calendar — a historical
    // snapshot's RF *feature* construction may still fall back to a later
    // year's population (see _popForFeature), which requires that later
    // year's population to actually be loaded here. The label/display path
    // stays strict regardless (only uses a year if it's in this set AND
    // matches the row's own year exactly).
    const allDataYears = [...new Set(monthlyResult.rows.map(r => Number(monthKey(r.month).slice(0, 4))))];
    const calendarYears = [...new Set([...allDataYears, ...calendar.map(m => Number(m.slice(0, 4)))])];
    const popMapByYear = {};
    for (const y of calendarYears) {
      popMapByYear[y] = await getPopulationMap(y);
    }
    console.log(`📊 Population reference years loaded: ${calendarYears.join(', ')}`);

    // ── Step 3: Build series for /forecast ──
    // Dense, zero-filled series on the shared calendar (every barangay appears,
    // including those with no cases).
    const forecastSeries = barangays.flatMap(b => seriesByBarangay[b.name]);

    // ── Step 4: Call Python /forecast ──
    // Skipped entirely for historical snapshots: RF risk classification
    // never reads forecastResults (see Step 5a), and re-fitting ARIMA for
    // every past year would be expensive for no benefit here — forecasting
    // a "future" that has already happened is out of scope for a
    // retroactive risk-only snapshot.
    let forecastResults = [];
    if (!skipForecast && results.mlServiceHealthy && forecastSeries.length > 0) {
      try {
        const forecastResponse = await forecast(forecastSeries, 12, forecastHorizon);
        forecastResults = forecastResponse.forecasts || [];
        results.forecastsCount = forecastResults.length;
        console.log(`🔮 Forecast: ${forecastResults.length} barangays processed`);
      } catch (err) {
        console.error('❌ Forecast call failed:', err.message);
        results.errors.push(`Forecast failed: ${err.message}`);
      }
    }

    // Fallback: if ML service is down or ARIMA failed, generate seasonal naive forecasts
    if (!skipForecast && forecastResults.length === 0 && forecastSeries.length > 0) {
      console.log('🔄 ML service unavailable — generating seasonal naive fallback forecasts');
      const barangayMap = {};
      for (const row of forecastSeries) {
        if (!barangayMap[row.barangay_name]) barangayMap[row.barangay_name] = [];
        barangayMap[row.barangay_name].push(row);
      }

      for (const [bName, pts] of Object.entries(barangayMap)) {
        const sorted = pts.sort((a, c) => a.month.localeCompare(c.month));

        // Below ARIMA_MIN_HISTORY_NONSEASONAL months, there isn't enough
        // history for even this naive fallback to be meaningful — report it
        // honestly rather than presenting a "forecast" with no real basis.
        // One prediction point per horizon month is still emitted (yhat:
        // null) so callers can tell "assessed, insufficient data" apart
        // from "not assessed at all".
        if (sorted.length < ARIMA_MIN_HISTORY_NONSEASONAL) {
          const insufficientPredictions = [];
          for (let i = 1; i <= forecastHorizon; i++) {
            const nextDate = new Date(results.period);
            nextDate.setUTCMonth(nextDate.getUTCMonth() + (i - 1));
            insufficientPredictions.push({
              month: nextDate.toISOString().slice(0, 8) + '01',
              yhat: null,
              yhat_lower: null,
              yhat_upper: null,
            });
          }
          forecastResults.push({
            barangay_name: bName,
            method: 'insufficient_data',
            backtest_mae: null,
            predictions: insufficientPredictions,
          });
          continue;
        }

        const predictions = [];

        // Build a lookup: month index (0-11) -> case_count for the most recent year
        const monthLookup = {};
        for (const pt of sorted) {
          const d = new Date(pt.month);
          const monthIdx = d.getUTCMonth();
          monthLookup[monthIdx] = pt.case_count;
        }

        // Compute simple trend from last 6 months vs previous 6 months
        const last6 = sorted.slice(-6);
        const prev6 = sorted.slice(-12, -6);
        const avgRecent = last6.length > 0 ? last6.reduce((s, p) => s + p.case_count, 0) / last6.length : 0;
        const avgPrev = prev6.length > 0 ? prev6.reduce((s, p) => s + p.case_count, 0) / prev6.length : 0;
        const trendFactor = avgPrev > 0 ? avgRecent / avgPrev : 1;

        for (let i = 1; i <= forecastHorizon; i++) {
          const nextDate = new Date(results.period);
          nextDate.setUTCMonth(nextDate.getUTCMonth() + (i - 1));
          const nextPeriod = nextDate.toISOString().slice(0, 8) + '01';
          const monthIdx = nextDate.getUTCMonth();

          // Seasonal naive: use same month last year, adjusted by trend
          const seasonalValue = monthLookup[monthIdx] != null ? monthLookup[monthIdx] : avgRecent;
          const yhat = Math.max(0, Math.round(seasonalValue * trendFactor));

          // This is a naive heuristic, not a statistically fitted model — it
          // has no real basis for a confidence interval, so none is reported
          // (never fabricate bounds; see arima_forecast.py's own fallback,
          // which is a real model with a defensible interval and is the only
          // tier below true ARIMA that DOES get one).
          predictions.push({
            month: nextPeriod,
            yhat,
            yhat_lower: null,
            yhat_upper: null,
          });
        }
        forecastResults.push({
          barangay_name: bName,
          method: 'seasonal-naive-fallback',
          backtest_mae: null,
          predictions,
        });
      }
      results.forecastsCount = forecastResults.length;
      console.log(`🔄 Fallback: ${forecastResults.length} barangays forecasted with seasonal naive`);
    }

    // ── Step 5: Compute RF features per barangay ──

    // 5a. Compute "current" incidence per barangay — the latest ACTUAL
    // reported month's case count against THAT month's own matching-year
    // population. Deliberately does not read forecastResults/ARIMA yhat at
    // all (previously it preferred the ARIMA forecast when available,
    // which made this figure depend on ARIMA succeeding even though a
    // fallback existed for when it didn't). This feeds both the persisted,
    // user-facing incidence_per_100k and the risk-score index, so it must
    // stay strict on year-matching: missing population → null, never a
    // fabricated/substituted value.
    const barangayIncidences = barangays.map(b => {
      const pts = (seriesByBarangay[b.name] || []).slice().sort((a, c) => a.month.localeCompare(c.month));
      const latestPt = pts.length > 0 ? pts[pts.length - 1] : null;
      if (!latestPt) return { name: b.name, incidence_per_100k: null };
      const year = Number(latestPt.month.slice(0, 4));
      const pop = _popFor(popMapByYear, b.name, year);
      return { name: b.name, incidence_per_100k: _computeIncidence(latestPt.case_count, pop) };
    });
    // neighbor_risk for the weighted index must use the SAME lag-1
    // convention as the RF feature (_neighborRisksAt below) — a barangay's
    // neighbor component must read what its neighbors looked like BEFORE
    // the current period, never their contemporaneous incidence. Using the
    // current month here (as an earlier version did) is a same-run
    // consistency gap, not true leakage (this weighted score isn't used
    // for RF training across time), but there is no reason for the two
    // mechanisms to define "neighbor" differently.
    const barangayIncidencesLag1 = barangays.map(b => {
      const pts = (seriesByBarangay[b.name] || []).slice().sort((a, c) => a.month.localeCompare(c.month));
      const lag1Pt = pts.length > 1 ? pts[pts.length - 2] : null;
      if (!lag1Pt) return { name: b.name, incidence_per_100k: null };
      const year = Number(lag1Pt.month.slice(0, 4));
      const pop = _popFor(popMapByYear, b.name, year);
      return { name: b.name, incidence_per_100k: _computeIncidence(lag1Pt.case_count, pop) };
    });
    const adjacency = await loadAdjacency();
    results.neighborSource = adjacency ? 'shared_border' : 'all_barangays';
    const neighborRisks = computeNeighborRisks(barangayIncidencesLag1, adjacency);

    // 5b. Past forecast error per barangay — used ONLY by the weighted risk
    // index (forecast-error component), not as an RF feature. Cutoff-filtered
    // for historical snapshots so it never reads errors recorded by pipeline
    // runs AFTER the year being assessed.
    let historicalBias = {};
    try {
      const pastPreds = await pool.query(
        `SELECT barangay_name, actual_count, forecasted_count, period
         FROM model_predictions
         WHERE actual_count IS NOT NULL
         ORDER BY period DESC
         LIMIT 500`
      );
      const biasRows = historyCutoffMonth
        ? pastPreds.rows.filter(r => monthKey(r.period) <= historyCutoffMonth)
        : pastPreds.rows;
      historicalBias = computeHistoricalBias(biasRows);
    } catch {
      // table might be empty on first run — that's fine
    }

    // 5c. Compute trend + seasonality per barangay
    const trendByBarangay = {};
    for (const b of barangays) {
      const pts = seriesByBarangay[b.name] || [];
      if (pts.length >= 2) {
        const counts = pts.sort((a, c) => a.month.localeCompare(c.month)).map(p => p.case_count);
        const slope = _linearSlope(counts);
        trendByBarangay[b.name] = {
          slope,
          direction: classifyTrend(slope),
        };
      } else {
        trendByBarangay[b.name] = { slope: 0, direction: 'Stable' };
      }
    }

    // 5d. Build prediction feature rows — SAME builder as training rows
    // (buildFeatureRow): 12-month window mean (NOT the ARIMA yhat), window
    // slope, lag-1 neighbor cross-section of actuals, lags, seasonality from
    // pre-target data. Feature parity with _buildTrainingRows is by construction.
    const allLens = barangays.map(b => (seriesByBarangay[b.name] || []).length);
    const rfMaxLen = Math.max(0, ...allLens);
    const rfWindow = _featureWindow(rfMaxLen);
    const rfNeighborRisks = _neighborRisksAt(seriesByBarangay, popMapByYear, rfMaxLen - 1, adjacency);
    const rfHighHistory = _highRiskHistory(seriesByBarangay, popMapByYear);
    const predictRows = addCrossSectionFeatures(barangays.map(b =>
      buildFeatureRow({
        name: b.name,
        t: (seriesByBarangay[b.name] || []).length,
        seriesByBarangay,
        popMapByYear,
        window: rfWindow,
        neighborRisks: rfNeighborRisks,
        highHistory: rfHighHistory,
      })
    ));

    // ── Step 6: Auto-calibrate thresholds and call Python /classify ──
    // Resolved BEFORE the ML-health branch because the rule-based fallback
    // below compares against these same cut points — leaving them unset when
    // the service is down silently handed that path DEFAULT_THRESHOLDS.
    const { thresholds: runThresholds, source: thresholdSource, percentiles: thresholdPercentiles } = await _resolveThresholds({
      thresholdsOverride, barangayIncidences, predictRows,
    });
    results.thresholds = runThresholds;
    results.thresholdSource = thresholdSource;
    results.thresholdPercentiles = thresholdPercentiles || null;

    let classifyResults = [];
    if (results.mlServiceHealthy && predictRows.length > 0) {
      try {
        const thresholds = runThresholds;

        // Build monthly snapshot training rows from historical data
        const trainRows = await _buildTrainingRows(monthlyRows, popMapByYear, adjacency);
        results.trainingRows = trainRows.length;
        console.log(`📋 Training rows: ${trainRows.length} monthly snapshots`);

        const classifyResponse = await classify(thresholds, trainRows, predictRows);
        classifyResults = (classifyResponse.predictions || []).filter(c =>
          c?.barangay_name && ['Low', 'Medium', 'High'].includes(c.risk_class)
        );
        results.classifierMethod = classifyResponse.method || 'random_forest';
        results.classificationsCount = classifyResults.length;
        if (results.classifierMethod === 'rule_based') {
          results.errors.push(`Random Forest could not be trained from ${trainRows.length} valid training rows; rule-based fallback was used.`);
        }
        console.log(`🏷️  Classification: ${classifyResults.length} barangays processed`);
      } catch (err) {
        console.error('❌ Classify call failed:', err.message);
        results.errors.push(`Classify failed: ${err.message}`);
      }
    }

    // Preserve every valid RF result. Fill only missing barangays with the
    // fallback, so a partial model response cannot discard usable predictions.
    const mergedClassifications = _mergeClassifications(
      predictRows, classifyResults, results.classifierMethod, runThresholds
    );
    classifyResults = mergedClassifications.classifications;
    results.classifierMethod = mergedClassifications.method;
    if (mergedClassifications.fallbackCount) {
      console.log(`🏷️  Rule-based fallback: ${mergedClassifications.fallbackCount} barangays classified`);
    }
    results.classificationsCount = classifyResults.length;
    const classifyByName = mergedClassifications.byName;

    // ── Step 7: Compute risk scores ──
    // maxIncidence must ignore barangays with unavailable (null) incidence —
    // Math.max coerces null to 0, which is harmless here since it can only
    // ever be picked as the max when every other value is <= 0.
    const allIncidences = barangayIncidences.map(b => b.incidence_per_100k).filter(v => v != null);
    const maxIncidence = Math.max(...allIncidences, 1);
    const allTrends = barangays.map(b => Math.abs(trendByBarangay[b.name]?.slope || 0));
    const maxTrend = Math.max(...allTrends, 0.01);
    const allErrors = barangays.map(b => historicalBias[b.name] || 0);
    const maxError = Math.max(...allErrors, 0.01);

    const riskScores = barangays.map(b => {
      const name = b.name;
      // null, not 0 — an unavailable incidence is not "zero risk". `?? null`
      // (not `|| 0`) is required here: computeRiskScore only redistributes
      // weight away from incidence when it receives null/undefined, and 0
      // would be treated as a real, lowest-possible incidence.
      const inc = barangayIncidences.find(x => x.name === name)?.incidence_per_100k ?? null;
      const trend = trendByBarangay[name]?.slope || 0;
      const neighbor = neighborRisks[name] || 0;
      const histErr = historicalBias[name] || 0;

      const { riskScore, normIncidence, normTrend, normError, neighborRisk } = computeRiskScore({
        incidence: inc,
        trend,
        neighborRisk: neighbor,
        forecastError: histErr,
        maxIncidence,
        maxTrend,
        maxError,
      });

      // risk_class is the ACTUAL classifier output — see _resolveClassification.
      // It never reads riskScore/riskClass from computeRiskScore above: the
      // weighted index and the classifier are two independent computations
      // that happen to run in the same loop iteration.
      const predictRow = predictRows.find(r => r.barangay_name === name);
      const resolved = _resolveClassification(classifyByName[name], classifyByName[name]?.model_type);

      return {
        barangay_name: name,
        risk_score: riskScore,
        ...resolved,
        features: predictRow?.features || null,
        // LEGACY value: annualized latest-calendar-month calculation
        // ((latest month × 12) / population × 100k) — see step 5a above.
        // NOT the authoritative year-specific GIS incidence: the GIS
        // geojson/choropleth endpoints now compute cases/year-population
        // on the fly (computeYearIncidence). Kept for research/audit only.
        // BACKLOG: audit → rename (e.g. legacy_annualized_monthly_incidence)
        // or deprecate, so it can never be accidentally reused as annual
        // incidence. Do not delete until downstream consumers are audited.
        incidence_per_100k: inc != null ? Math.round(inc * 100) / 100 : null,
        trend_direction: trendByBarangay[name]?.direction || 'Stable',
        norm_incidence: normIncidence,
        norm_trend: normTrend,
        norm_neighbor_risk: neighborRisk,
        norm_forecast_error: normError,
      };
    });

    results.riskScoresCount = riskScores.length;

    // ── Step 8: Generate alerts ──
    // Skipped for historical snapshots — an alert is an operational "act on
    // this now" notification, and generating one for a retroactive past-year
    // assessment would misrepresent old history as a current event.
    let alerts = [];
    if (!skipAlerts) {
      let prevRiskClasses = {};
      try {
        const prev = await pool.query(
          `SELECT barangay_name, risk_class FROM barangay_risk_scores
           WHERE period = (SELECT MAX(period) FROM barangay_risk_scores WHERE period < $1)
           AND period IS NOT NULL`,
          [results.period]
        );
        for (const row of prev.rows) {
          prevRiskClasses[row.barangay_name] = row.risk_class;
        }
      } catch {
        // first run — no previous data
      }

      // The classifier returns classes only; the rate shown in the alert text is this run's
      // 12-month rate (see alertRateByName), not the legacy latest-month figure.
      const incidenceByName = alertRateByName(riskScores);
      alerts = generateAlerts({
        forecasts: forecastResults,
        classifications: classifyResults.map(c => ({ ...c, incidence_per_100k: incidenceByName[c.barangay_name] ?? null })),
        barangayList: barangays.map(b => ({ name: b.name })),
        prevRiskClasses,
        period: results.period,
      });
    }
    results.alertsCount = alerts.length;

    // ── Step 9: Store everything in a transaction ──
    // Re-acquire client for transaction
    const txClient = await pool.connect();
    try {
    await txClient.query('BEGIN');

    // Same lock as every writer of case data (batch undo, sync, import): nothing can
    // change the cases between this check and COMMIT. If they changed while the models
    // ran, these results describe data that no longer exists — discard them.
    await lockCaseData(txClient);
    if ((await caseDataFingerprint(txClient)) !== startFingerprint) {
      await txClient.query('ROLLBACK');
      results.status = 'stale';
      results.errors.push('Case data changed while the analysis was running; results were discarded and a new run was requested.');
      console.warn('⚠️ Pipeline results discarded: case data changed during the run');
      return results;
    }

    // Clean up old rows with non-1st-of-month dates (legacy data)
    await txClient.query(
      `DELETE FROM model_predictions WHERE period::date != date_trunc('month', period)::date`
    );

    await storeResults(
      txClient,
      results.period,
      forecastResults,
      classifyResults,
      riskScores,
      alerts,
      MODEL_VERSION
    );

    // Independent RF/ARIMA status for this run, so a caller can tell "both
    // models genuinely succeeded" apart from "one silently degraded to a
    // fallback" or "one's ML call failed outright" — previously only a
    // single combined metrics blob existed and hid partial failure.
    const arimaMethodsUsed = new Set(forecastResults.map(f => f.method));
    let arimaStatus;
    if (forecastResults.length === 0) {
      arimaStatus = results.errors.some(e => e.startsWith('Forecast failed')) ? 'failed' : 'not_run';
    } else if (arimaMethodsUsed.size === 1 && arimaMethodsUsed.has('insufficient_data')) {
      arimaStatus = 'insufficient_data';
    } else if (arimaMethodsUsed.has('arima') && !arimaMethodsUsed.has('seasonal-naive-fallback')) {
      // The ML service ran and fitted ARIMA. Barangays too sparse for ARIMA
      // (mostly zero months) get exponential smoothing BY DESIGN — that is
      // the documented eligibility rule, not a failure, so it doesn't make
      // the run degraded.
      arimaStatus = 'success';
    } else {
      // No ARIMA fit at all, or the ML service was unreachable so every
      // barangay used the Node-side fallback — degraded, not a clean success.
      arimaStatus = 'degraded';
    }
    let rfStatus;
    if (results.classifierMethod === 'random_forest') rfStatus = 'success';
    else if (results.classifierMethod === 'rule_based' || results.classifierMethod === 'mixed') rfStatus = 'degraded';
    else rfStatus = 'not_run';
    const modelStatusTimestamp = new Date().toISOString();

    // Record pipeline run in model_metadata.
    // training_months = distinct months on the shared calendar (NOT the barangay-month row count).
    results.barangaysProcessed = barangays.length;
    await txClient.query(
      `INSERT INTO model_metadata (run_type, model_version, training_months, metrics, config,
                                    rf_status, rf_updated_at, arima_status, arima_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        historyCutoffMonth ? 'pipeline_historical' : 'pipeline',
        MODEL_VERSION,
        calendar.length,
        JSON.stringify({
          barangaysProcessed: results.barangaysProcessed,
          dataStart: calendar[0],
          dataEnd: latestMonth,
          data_year: results.data_year,
          assessment_year: results.assessment_year,
          assessment_period: results.assessment_period,
          prediction_period: results.prediction_period,
          trainingRows: results.trainingRows ?? 0,
          classifierMethod: results.classifierMethod ?? 'rule_based',
          forecastMethods: [...arimaMethodsUsed],
          forecastHorizon,
          neighborSource: results.neighborSource || null,
          forecastsCount: results.forecastsCount,
          classificationsCount: results.classificationsCount,
          alertsCount: results.alertsCount,
        }),
        JSON.stringify({
          thresholds: results.thresholds,
          // How the cut points above were arrived at: 'tertile_incidence' and
          // 'tertile_features' are both calibrated from this run's own data;
          // 'default' means nothing could be calibrated and the bands are not
          // scale-matched, which makes the run's classifications unreliable.
          thresholdSource: results.thresholdSource || null,
          // The percentile cut points behind the thresholds above, when they
          // were derived from this run's data (null for 'default' and for a
          // caller-supplied override). Surfaced read-only in the UI so a
          // classification is never read as an official DOH threshold.
          thresholdPercentiles: results.thresholdPercentiles || null,
          period: results.period,
          historyCutoffMonth: historyCutoffMonth || null,
        }),
        rfStatus,
        modelStatusTimestamp,
        arimaStatus,
        modelStatusTimestamp,
      ]
    );

    await txClient.query('COMMIT');
    } catch (txErr) {
      await txClient.query('ROLLBACK');
      throw txErr;
    } finally {
      txClient.release();
    }

    results.status = 'completed';
    console.log(`✅ Pipeline complete: ${results.barangaysProcessed} barangays, ` +
                `${results.alertsCount} alerts, period ${results.period}`);

    return results;
  } catch (err) {
    results.status = 'error';
    results.errors.push(err.message);
    console.error('❌ Pipeline failed:', err.message);
    throw err;
  } finally {
    releaseClient();
  }
}

/**
 * Backfill risk snapshots from historical data years in monthly_case_summary.
 * Skip a data year when the current pipeline already stored its snapshot;
 * this preserves the current RF result and avoids a duplicate assessment.
 *
 * For year Y, this re-runs the full RF pipeline using ONLY data through
 * Dec of year Y (historyCutoffMonth), storing the result at period
 * (Y+1)-01-01. Here data_year is Y, assessment_year is Y+1, and
 * prediction_period and assessment_period are (Y+1)-01-01. ARIMA and alerts are skipped (out of
 * scope for a retroactive risk-only snapshot; see runPipeline's
 * skipForecast/skipAlerts).
 *
 * A year with too little/no matching-year population (e.g. 2023 in this
 * dataset) will naturally end up with 0 valid training rows and degrade to
 * the rule-based fallback (clearly labeled model_type: 'rule_based') rather
 * than failing outright — this is the same degrade-gracefully behavior the
 * regular pipeline already has, not a special case here.
 *
 * Admin-triggered only (see POST /api/tb/pipeline/historical) — this is a
 * one-time/rare backfill operation, not something that should run on every
 * webhook sync.
 *
 * @returns {Array<{year, data_year, assessment_year, prediction_period, status}>}
 */
async function runHistoricalSnapshots() {
  const monthlyResult = await pool.query(
    `SELECT barangay_name, month, case_count FROM monthly_case_summary ORDER BY month`
  );
  if (monthlyResult.rows.length === 0) return [];
  // Years must come from the TRIMMED calendar (buildDenseSeries drops stray
  // leading months — e.g. this dataset has a single 1-case record months
  // before real reporting begins), not a raw DISTINCT year query. Without
  // this, a stray record produces a bogus "snapshot" for a year that isn't
  // real reporting history at all (barangayNames left empty — only the
  // calendar boundaries are needed here, not the per-barangay series).
  const { calendar } = buildDenseSeries(monthlyResult.rows, []);
  const allYears = [...new Set(calendar.map(m => Number(m.slice(0, 4))))];
  if (allYears.length === 0) return [];
  const latestYear = Math.max(...allYears);
  const currentRun = await pool.query(
    `SELECT config->>'period' AS assessment_period, metrics->>'dataEnd' AS data_end
     FROM model_metadata WHERE run_type = 'pipeline' ORDER BY trained_at DESC LIMIT 1`
  );
  const currentPeriod = currentRun.rows[0]?.assessment_period || null;
  const currentDataYear = currentRun.rows[0]?.data_end
    ? Number(String(currentRun.rows[0].data_end).slice(0, 4)) : null;
  const currentAssessmentYear = currentPeriod ? Number(String(currentPeriod).slice(0, 4)) : null;
  const currentSnapshot = currentPeriod ? await pool.query(
    'SELECT EXISTS(SELECT 1 FROM barangay_risk_scores WHERE period = $1::date) AS present',
    [currentPeriod]
  ) : null;
  const currentSnapshotExists = currentSnapshot?.rows[0]?.present === true;

  const summaries = [];
  for (const y of allYears) {
    const backfillPeriod = `${y + 1}-01-01`;
    if (currentSnapshotExists &&
        (currentDataYear === y || currentPeriod === backfillPeriod ||
          (y === latestYear && currentAssessmentYear === y))) {
      summaries.push({ year: y, data_year: currentDataYear, assessment_year: currentAssessmentYear,
        assessment_period: currentPeriod, prediction_period: currentPeriod,
        status: 'skipped', reason: 'covered by the current/latest assessment' });
      continue;
    }
    const cutoff = `${y}-12-01`;
    try {
      const r = await runPipeline({ historyCutoffMonth: cutoff, skipForecast: true, skipAlerts: true });
      summaries.push({
        year: y,
        period: r.period,
        data_year: r.data_year ?? y,
        assessment_year: r.assessment_year ?? null,
        assessment_period: r.assessment_period ?? null,
        prediction_period: r.prediction_period ?? null,
        status: r.status,
        classifierMethod: r.classifierMethod || null,
        riskScoresCount: r.riskScoresCount,
        trainingRows: r.trainingRows ?? 0,
        errors: r.errors,
      });
      console.log(`📦 Historical snapshot ${y} -> period ${r.period}: ${r.status} (${r.classifierMethod || 'no classifier'})`);
    } catch (err) {
      summaries.push({ year: y, status: 'error', error: err.message });
      console.error(`❌ Historical snapshot ${y} failed:`, err.message);
    }
  }
  return summaries;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Reconcile past forecasts with reality: for every model_predictions row
 * still missing actual_count, fill it in from the validated cases if that
 * barangay/period's real case count has arrived since the forecast was
 * made. This is the ONLY thing that gives the risk index's forecast-error
 * component (AVG(|actual - forecasted|)) real values — without it, every
 * forecast stays "unresolved" forever and that component is permanently 0.
 *
 * A single bulk UPDATE rather than the old per-barangay admin-typed
 * PUT /predictions/backfill: the actual counts already exist in
 * tb_cases once that month is imported, so there is nothing
 * for a human to type — this just joins the two tables.
 *
 * @returns {number} rows updated
 */
async function _backfillActualCounts() {
  const result = await pool.query(
    `UPDATE model_predictions mp
     SET actual_count = actuals.case_count,
         forecast_error = ABS(actuals.case_count - COALESCE(mp.forecasted_count, 0))
     FROM (
       SELECT barangay_name,
              DATE_TRUNC('month', date_of_diagnosis)::date AS month,
              COUNT(*)::integer AS case_count
       FROM tb_cases
       WHERE date_of_diagnosis IS NOT NULL AND ${pasigResidentOnly()}
       GROUP BY barangay_name, DATE_TRUNC('month', date_of_diagnosis)
     ) actuals
     WHERE mp.barangay_name = actuals.barangay_name
       AND mp.period = actuals.month
       AND mp.actual_count IS NULL`
  );
  return result.rowCount || 0;
}

/**
 * Resolve this run's Low/Medium/High incidence cut points.
 *
 * Preference order:
 *   1. override          — caller-supplied, used as-is.
 *   2. tertile_incidence — Python /thresholds over the barangays' current
 *                          incidences. The normal path.
 *   3. tertile_features  — the same tertile split computed locally over
 *                          rolling_12m_incidence from the prediction rows.
 *   4. default           — DEFAULT_THRESHOLDS, last resort only.
 *
 * Step 3 exists because a year with no population reference of its own has a
 * null current incidence for every barangay, leaving step 2 nothing to
 * calibrate from — while the RF features still hold real values (built via
 * _popForFeature's nearest-year fallback). Calibrating from the feature the
 * classifier actually compares against keeps the cut points on the same scale
 * as the values being classified.
 *
 * That scale match is the whole point. DEFAULT_THRESHOLDS are fixed constants
 * (150/350); the annualized-monthly incidence they would be compared against
 * runs in the hundreds to thousands, so nearly every barangay lands above
 * med_max. Falling through to them silently is what made the 2023 snapshot
 * classify 26 of 30 barangays High. The chosen source is returned so the run
 * can record it and callers can flag a snapshot that had no real basis.
 *
 * Alongside { thresholds, source } this returns { percentiles } — the
 * { low_pct, med_pct } split behind data-derived cut points (null for
 * 'override' and 'default'), recorded on the run so the UI can say what the
 * bands mean instead of presenting them as official epidemiological values.
 */
async function _resolveThresholds({
  thresholdsOverride, barangayIncidences, predictRows,
  // Injectable so the calibration logic can be tested without the ML service.
  callThresholds: callThresholdsFn = callThresholds,
}) {
  // A caller-supplied override has no percentile basis: it is a fixed number.
  if (thresholdsOverride) return { thresholds: thresholdsOverride, source: 'override', percentiles: null };

  const validIncidences = (barangayIncidences || [])
    .map(b => b.incidence_per_100k)
    .filter(v => v != null && Number.isFinite(v));

  if (validIncidences.length > 0) {
    try {
      const t = await callThresholdsFn(validIncidences, 'tertile');
      if (Number.isFinite(t?.low_max) && Number.isFinite(t?.med_max)) {
        // Older ML responses carry no percentiles — fall back to the shared
        // constants, which are what the service itself would have used.
        const percentiles = {
          low_pct: Number.isFinite(t.low_pct) ? t.low_pct : LOW_PERCENTILE * 100,
          med_pct: Number.isFinite(t.med_pct) ? t.med_pct : MED_PERCENTILE * 100,
        };
        console.log(`📐 Thresholds (percentile split ${percentiles.low_pct.toFixed(1)}/${percentiles.med_pct.toFixed(1)} ` +
                    `over ${validIncidences.length} incidences): ` +
                    `Low≤${t.low_max.toFixed(1)}, High>${t.med_max.toFixed(1)}`);
        return { thresholds: { low_max: t.low_max, med_max: t.med_max }, source: 'tertile_incidence', percentiles };
      }
    } catch (err) {
      console.warn(`📐 Threshold service unavailable (${err.message}) — calibrating locally`);
    }
  }

  const featureIncidences = (predictRows || [])
    .map(r => r.features?.rolling_12m_incidence)
    .filter(v => v != null && Number.isFinite(v));

  if (featureIncidences.length >= 3) {
    const { low_max, med_max } = classifyByTertile(featureIncidences);
    const percentiles = { low_pct: LOW_PERCENTILE * 100, med_pct: MED_PERCENTILE * 100 };
    console.log(`📐 Thresholds (percentile split ${percentiles.low_pct.toFixed(1)}/${percentiles.med_pct.toFixed(1)} ` +
                `over ${featureIncidences.length} feature incidences): ` +
                `Low≤${low_max.toFixed(1)}, High>${med_max.toFixed(1)}`);
    return { thresholds: { low_max, med_max }, source: 'tertile_features', percentiles };
  }

  console.warn('📐 No calibration basis — using default thresholds. Classifications from ' +
               'this run are NOT scale-matched to the data and should be treated as unreliable.');
  return { thresholds: DEFAULT_THRESHOLDS, source: 'default', percentiles: null };
}

/**
 * Compute ANNUAL incidence per 100k from monthly case count and population.
 * WHO standard is annual incidence per 100,000 population.
 * Returns null if population is unavailable (NOT zero).
 */
function _computeIncidence(monthlyCases, population) {
  if (population === null || population === undefined || population <= 0) return null;
  return ((monthlyCases * 12) / population) * 100_000;
}

/**
 * Simple linear regression slope (cases per month).
 */
function _linearSlope(values) {
  if (values.length < 2) return 0;
  const n = values.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const y = values;
  const xMean = x.reduce((a, b) => a + b, 0) / n;
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - xMean) * (y[i] - yMean);
    den += (x[i] - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// Lag-12 autocorrelation at or above this counts as a seasonal pattern. 0.3 is
// the conventional "weak but real" cutoff for a seasonal signal in a short
// monthly public-health series.
const SEASONALITY_MIN_AUTOCORRELATION = 0.3;

/**
 * Detect seasonality as the lag-12 autocorrelation of the DETRENDED series,
 * over at least 24 months.
 *
 * The previous implementation split the series in half and counted how often
 * consecutive month-to-month changes shared a sign. That measures whether the
 * series moves in a consistent direction, not whether it repeats annually: a
 * barangay with steadily rising cases has a positive change almost everywhere
 * in both halves, matched on nearly every position, and was flagged seasonal.
 * A trend is not a season, and seasonality_flag is one of the eight RF inputs,
 * so the false positives landed directly in the classifier.
 *
 * Detrending is what makes the lag-12 comparison mean what it should. Pearson
 * correlation measures a LINEAR relationship, and a straight line shifted by
 * twelve months is still perfectly linearly related to itself — correlating the
 * raw series against its own lag would score a pure trend at 1.0 and reproduce
 * the original bug in a new form. Removing the least-squares trend line first
 * leaves only the variation around it, so what remains correlates at lag 12
 * when, and only when, the series genuinely repeats year over year. A series
 * that is purely linear leaves no residual variation at all and is correctly
 * reported as non-seasonal.
 */
function _detectSeasonality(series) {
  if (series.length < 24) return false;
  const counts = [...series]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(s => s.case_count);

  // Remove the least-squares trend line; what is left is the variation around it.
  const slope = _linearSlope(counts);
  const meanIndex = (counts.length - 1) / 2;
  const meanCount = counts.reduce((a, b) => a + b, 0) / counts.length;
  const intercept = meanCount - slope * meanIndex;
  const residuals = counts.map((value, i) => value - (intercept + slope * i));

  // A flat or perfectly linear series leaves no residual variation to analyse.
  // Compared against the original scale so the check is unit-independent and
  // tolerant of floating-point dust from the subtraction above.
  const residualSpread = residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length;
  const scale = Math.max(Math.abs(meanCount), 1);
  if (residualSpread / (scale * scale) < 1e-6) return false;

  // Pair each month's residual with the same month's residual a year earlier.
  const pairs = residuals.slice(12).map((value, i) => [value, residuals[i]]);
  if (pairs.length < 12) return false;

  const meanCurrent = pairs.reduce((sum, p) => sum + p[0], 0) / pairs.length;
  const meanLagged = pairs.reduce((sum, p) => sum + p[1], 0) / pairs.length;

  let covariance = 0;
  let varCurrent = 0;
  let varLagged = 0;
  for (const [current, lagged] of pairs) {
    const dCurrent = current - meanCurrent;
    const dLagged = lagged - meanLagged;
    covariance += dCurrent * dLagged;
    varCurrent += dCurrent ** 2;
    varLagged += dLagged ** 2;
  }
  if (varCurrent === 0 || varLagged === 0) return false;

  const correlation = covariance / Math.sqrt(varCurrent * varLagged);
  return correlation >= SEASONALITY_MIN_AUTOCORRELATION;
}

/**
 * Next month from a YYYY-MM-DD string.
 */
function _nextMonth(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  // Always normalize to 1st of month
  return d.toISOString().slice(0, 8) + '01';
}

/**
 * Build monthly snapshot training rows for RF from historical data.
 *
 * Instead of 1 row per barangay (30 total), produces 1 row per barangay per month
 * using rolling 12-month windows. With 30 barangays × 24+ valid months = 720+ rows.
 *
 * Each row: { features: {7 features}, incidence: float, month }
 * Labels derived in Python by ranking barangays within each month (bottom 40% Low, top third High).
 *
 * Features are computed with rolling windows to prevent data leakage:
 *   - rolling_12m_incidence: annualized cases from the 12-month lookback window
 *   - recent_trend: slope over the 12-month window
 *   - seasonality_flag: 1 if ≥24 months available and sign-pattern match > 60%
 *   - lag_1m/2m/3m: actual counts 1–3 months before the target
 *   - neighbor_risk: average incidence of the barangays sharing a border at
 *     the month before the target (lag-1), min-max normalized within that month
 */
async function _buildTrainingRows(rows, popMapByYear, adjacency) {
  // Use the same validated, already cutoff-scoped series as forecasting and
  // current RF features. Requerying the summary can train on stale months.
  if (rows.length === 0) return [];
  const barangayNames = await pool.query('SELECT name FROM barangays ORDER BY name');
  const { seriesByBarangay } = buildDenseSeries(rows, barangayNames.rows.map(r => r.name));
  const adj = adjacency === undefined ? await loadAdjacency() : adjacency;
  return buildTrainingRows(seriesByBarangay, popMapByYear, adj);
}

/**
 * RF feature window length (months of look-back).
 *
 * Single rule used at BOTH training and prediction time so the window-based
 * features (rolling_12m_incidence, recent_trend) are constructed identically.
 * 12 months when there is at least 18 months of history; otherwise half the
 * history (min 3), so short histories still yield training rows.
 */
function _featureWindow(seriesLen) {
  return seriesLen >= 18 ? 12 : Math.max(3, Math.floor(seriesLen / 2));
}

/**
 * Wrap a flat population map ({name: {population, available}}) so it can be
 * used anywhere a `popMapByYear` is expected, resolving to the same map for
 * ANY year. For callers (tests, or a caller who has already resolved
 * population for a single relevant year) that don't need per-row year
 * matching — real pipeline runs always build a genuine per-year map instead.
 */
function _uniformPopMapByYear(popMap) {
  return new Proxy({}, { get: () => popMap });
}

/**
 * Strict, exact-year population lookup: population for `name` in `year`, or
 * null if that year has no reference for this barangay. Never substitutes a
 * different year. Used for anything that is REPORTED as a specific year's
 * incidence (training labels, the persisted/displayed incidence_per_100k).
 *
 * @param {Object} popMapByYear - {year: {name: {population, available}}}
 */
function _popFor(popMapByYear, name, year) {
  const yearMap = popMapByYear[year];
  return yearMap?.[name]?.available ? yearMap[name].population : null;
}

/**
 * Population lookup for RF FEATURE CONSTRUCTION only — tries the exact year
 * first, then falls back to the most recent OTHER year that has a
 * population reference for this barangay. RF needs a real number for every
 * feature on every row or it cannot run at all; "last known population" is
 * a standard, explicitly-documented feature-construction compromise. This
 * must never be used for a value presented to a user as "incidence for
 * year Y" — that always goes through the strict _popFor above instead.
 */
function _popForFeature(popMapByYear, name, year) {
  const exact = _popFor(popMapByYear, name, year);
  if (exact != null) return exact;
  const years = Object.keys(popMapByYear).map(Number).sort((a, b) => b - a);
  for (const y of years) {
    const p = _popFor(popMapByYear, name, y);
    if (p != null) return p;
  }
  return null;
}

/**
 * neighbor_risk cross-section for ONE month: mean incidence of the barangays
 * sharing a border (all other barangays when `adjacency` is null) at
 * `monthIndex` (actuals), min-max normalized to [0, 1] across
 * barangays within that month. Barangays whose incidence is unavailable
 * (missing matching-year population) are excluded from the average rather
 * than counted as 0 — an unknown incidence must never pull neighbors'
 * scores toward "low risk".
 *
 * Called with monthIndex = target - 1 (lag-1) for both training rows and
 * prediction rows, so neighbor_risk never reads the target month itself —
 * no target-period information, and train/predict are identical.
 */
function _neighborRisksAt(seriesByBarangay, popMapByYear, monthIndex, adjacency = null) {
  const names = Object.keys(seriesByBarangay);
  const inc = {};
  for (const name of names) {
    const pt = monthIndex >= 0 ? seriesByBarangay[name][monthIndex] : undefined;
    const year = pt ? Number(pt.month.slice(0, 4)) : null;
    const pop = year != null ? _popFor(popMapByYear, name, year) : null;
    inc[name] = pt ? _computeIncidence(pt.case_count, pop) : null;
  }
  const raws = names.map(name => {
    const others = neighboursOf(name, names, adjacency).filter(o => inc[o] != null);
    return others.length > 0 ? others.reduce((s, o) => s + inc[o], 0) / others.length : 0;
  });
  const min = Math.min(...raws);
  const range = Math.max(...raws) - min;
  const risks = {};
  names.forEach((name, idx) => {
    risks[name] = range > 0 ? (raws[idx] - min) / range : 0;
  });
  return risks;
}

/**
 * Build the 7 RF features for `name` targeting month index `t`, using ONLY
 * data strictly before t:
 *   - rolling_12m_incidence: annualized mean of the [t-window, t) window
 *   - recent_trend: linear slope over the same window
 *   - seasonality_flag: detection over [0, t) (target month excluded)
 *   - lag_1m/2m/3m: actual counts at t-1, t-2, t-3
 *   - neighbor_risk: precomputed lag-1 cross-section of bordering barangays (month t-1)
 *
 * Training rows AND prediction rows must both go through this function —
 * that is what guarantees feature parity between fit and inference.
 *
 * @param {Object} p
 * @param {string} p.name - barangay name
 * @param {number} p.t - target month index (series length = predict next month)
 * @param {Object} p.seriesByBarangay - dense series (calendar order)
 * @param {Object} p.popMapByYear - {year: {name: {population, available}}}
 * @param {number} p.window - look-back window (from _featureWindow)
 * @param {Object} p.neighborRisks - lag-1 normalized neighbor risks ({name: 0..1})
 * @returns {{barangay_name: string, features: Object}}
 */
function buildFeatureRow({ name, t, seriesByBarangay, popMapByYear, window, neighborRisks, highHistory = null }) {
  const months = seriesByBarangay[name] || [];
  const windowCounts = months.slice(Math.max(0, t - window), t).map(w => w.case_count);
  const meanCount = windowCounts.length > 0
    ? windowCounts.reduce((a, b) => a + b, 0) / windowCounts.length
    : 0;
  const count = k => (t - k >= 0 ? months[t - k].case_count : 0);

  // Population for the window feature: the calendar year of the most
  // recent month actually in the window — never the future target month's
  // year (a forecast target has no case data or population of its own).
  // Falls back to the nearest available year (see _popForFeature) so RF can
  // always produce a real feature value from real, non-fabricated
  // population figures.
  const refIdx = Math.min(t - 1, months.length - 1);
  const refYear = refIdx >= 0 ? Number(months[refIdx].month.slice(0, 4)) : null;
  const pop = refYear != null ? _popForFeature(popMapByYear, name, refYear) : null;

  // Lags are incidence, not raw counts: the label is incidence, and 5 cases
  // in a barangay of 1,000 is not the same risk as 5 cases in one of 50,000.
  const recent3 = (count(1) + count(2) + count(3)) / 3;
  // Every month before t. A barangay's rate barely changes from year to year while a
  // month holds a handful of cases, so the longest average is the steadiest estimate
  // of its risk — ranking barangays by it scored above every shorter window.
  const history = months.slice(0, t).map(w => w.case_count);
  const historyMean = history.length > 0 ? history.reduce((a, b) => a + b, 0) / history.length : 0;

  // Monthly incidence of earlier months, for the features below (all strictly before t).
  const incAt = k => (k >= 0 && k < t ? _computeIncidence(months[k].case_count, pop) : null);
  const meanInc = (from, to) => {
    const vals = [];
    for (let k = Math.max(0, from); k < to; k++) vals.push(incAt(k));
    return vals.length && vals.every(v => v != null) ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const last12 = [];
  for (let k = Math.max(0, t - 12); k < t; k++) last12.push(incAt(k));
  const mean12 = meanInc(t - 12, t);
  // Share of the last 12 months the barangay spent in the High band (see _highRiskHistory):
  // a barangay's band is persistent, so how often it has been High is a strong signal.
  const highFlags = highHistory?.[name];
  const highWindow = [];
  if (highFlags) for (let k = Math.max(3, t - 12); k < t; k++) highWindow.push(highFlags[k]);

  return {
    barangay_name: name,
    features: {
      rolling_12m_incidence: _computeIncidence(meanCount, pop),
      incidence_3m: _computeIncidence(recent3, pop),
      recent_trend: _linearSlope(windowCounts),
      seasonality_flag: _detectSeasonality(months.slice(0, t)) ? 1 : 0,
      lag_1m: _computeIncidence(count(1), pop),
      lag_2m: _computeIncidence(count(2), pop),
      lag_3m: _computeIncidence(count(3), pop),
      neighbor_risk: neighborRisks[name] || 0,
      history_incidence: history.length > 0 ? _computeIncidence(historyMean, pop) : null,
      // Added after walk-forward tuning (Oct 2024-Jul 2025) and confirmed on unseen months
      // (Aug 2025-Jun 2026): with band filling (rf_classifier) accuracy 56% -> 63%.
      incidence_6m: meanInc(t - 6, t),
      volatility: last12.length && last12.every(v => v != null)
        ? Math.sqrt(last12.reduce((s, v) => s + (v - mean12) ** 2, 0) / last12.length) : null,
      yoy_change: t >= 13 && mean12 != null && meanInc(t - 24, t - 12) != null
        ? mean12 - meanInc(t - 24, t - 12) : 0,
      high_share_12m: highWindow.length ? highWindow.reduce((a, b) => a + b, 0) / highWindow.length : 0.5,
    },
  };
}

/**
 * For every month index k >= 3: was each barangay in the High band (top third, the label
 * rule) when ranked by its mean incidence over months k-3..k-1? Computed once per run
 * and read by buildFeatureRow's high_share_12m. Uses only months before k.
 * @returns {Object} { name: number[] } 1 = High at k, 0 = not (or unknown)
 */
function _highRiskHistory(seriesByBarangay, popMapByYear) {
  const names = Object.keys(seriesByBarangay);
  const len = Math.max(0, ...names.map(n => seriesByBarangay[n].length));
  const out = Object.fromEntries(names.map(n => [n, new Array(len).fill(0)]));
  for (let k = 3; k < len; k++) {
    const known = [];
    for (const name of names) {
      const months = seriesByBarangay[name];
      if (months.length < k) continue;
      const year = Number(months[k - 1].month.slice(0, 4));
      const inc = _computeIncidence((months[k - 3].case_count + months[k - 2].case_count + months[k - 1].case_count) / 3,
        _popForFeature(popMapByYear, name, year));
      if (inc != null) known.push([name, inc]);
    }
    known.sort((a, b) => a[1] - b[1]);
    known.forEach(([name], i) => {
      const q = known.length > 1 ? i / (known.length - 1) : 0.5;
      out[name][k] = q >= MED_PERCENTILE ? 1 : 0;
    });
  }
  return out;
}

/**
 * Add the two cross-sectional features to ONE month's feature rows (every
 * barangay, same target month), in place:
 *   - incidence_rank: position of rolling_12m_incidence among the barangays
 *     that month, 0 (lowest) to 1 (highest)
 *   - prev_category: the band the last 3 months would get under the label
 *     rule (bottom 40% Low, top third High): 0 Low, 1 Medium, 2 High
 * The labels are relative (bands within a month), so the model needs inputs
 * on the same relative scale. Both read only months before the target.
 * A row with unknown incidence gets the middle (0.5 / 1) rather than Low.
 *
 * Training rows AND prediction rows both go through this, after
 * buildFeatureRow, so the two stay identical.
 */
function addCrossSectionFeatures(rows) {
  // Same cut points as the RF labels (rf_classifier.band_for_rank) and the
  // risk thresholds: bottom 40% Low, top third High.
  const positions = key => {
    const known = rows.filter(r => r.features[key] != null).sort((a, b) => a.features[key] - b.features[key]);
    const pos = new Map();
    known.forEach((r, i) => pos.set(r, known.length > 1 ? i / (known.length - 1) : 0.5));
    return pos;
  };
  const rank12 = positions('rolling_12m_incidence');
  const rank3 = positions('incidence_3m');
  const rankAll = positions('history_incidence');
  for (const r of rows) {
    r.features.incidence_rank = rank12.has(r) ? rank12.get(r) : 0.5;
    r.features.history_rank = rankAll.has(r) ? rankAll.get(r) : 0.5;
    const q = rank3.has(r) ? rank3.get(r) : 0.5;
    r.features.prev_category = q < LOW_PERCENTILE ? 0 : q >= MED_PERCENTILE ? 2 : 1;
  }
  return rows;
}

/**
 * Pure: turn dense per-barangay series into RF training rows (one per
 * barangay-month that has a full look-back window before it).
 *
 * Every feature is built by buildFeatureRow — the exact same function used
 * for prediction rows — from data strictly BEFORE the target month:
 *   - rolling_12m_incidence: annualized incidence of the window's mean monthly count
 *   - recent_trend: slope over the window
 *   - seasonality_flag: detected on [0, target) — target month excluded
 *   - lag_1m/2m/3m: actuals at target-1/-2/-3
 *   - neighbor_risk: mean incidence of the bordering barangays at target-1,
 *     min-max normalized across barangays within that month (lag-1, never the
 *     target month itself)
 * The label source `incidence` is the target month's annualized incidence.
 *
 * Rows are emitted month-major: all barangays of month i, then month i+1 —
 * walk-forward evaluation groups every n_barangays rows into one month.
 *
 * @param {Object} seriesByBarangay - from buildDenseSeries (all same length)
 * @param {Object} popMapByYear - {year: {name: {population, available}}}
 * @param {Object|null} [adjacency] - {name: [bordering barangays]}; null = all others
 */
function buildTrainingRows(seriesByBarangay, popMapByYear, adjacency = null) {
  const names = Object.keys(seriesByBarangay);
  const maxLen = Math.max(0, ...names.map(n => seriesByBarangay[n].length));
  const window = _featureWindow(maxLen);
  if (maxLen <= window) return [];

  const trainRows = [];
  const highHistory = _highRiskHistory(seriesByBarangay, popMapByYear);
  for (let i = window; i < maxLen; i++) {
    // neighbor_risk cross-section at the month BEFORE the target (lag-1)
    const neighborRisks = _neighborRisksAt(seriesByBarangay, popMapByYear, i - 1, adjacency);
    // Features for every barangay this month first, so the ranks are taken
    // across all of them — same set as at prediction time.
    const featureRows = new Map();
    for (const name of names) {
      if (seriesByBarangay[name].length <= i) continue;
      featureRows.set(name, buildFeatureRow({
        name, t: i, seriesByBarangay, popMapByYear, window, neighborRisks, highHistory,
      }));
    }
    addCrossSectionFeatures([...featureRows.values()]);
    for (const [name, row] of featureRows) {
      const months = seriesByBarangay[name];
      // Label incidence is STRICT: the case count occurred in this exact
      // calendar year, so it must be matched against that exact year's
      // population — never a fallback year. Missing population → no label
      // and no row (skip), never a zero/estimated incidence.
      const targetYear = Number(months[i].month.slice(0, 4));
      const pop = _popFor(popMapByYear, name, targetYear);

      // The label is the mean monthly case count over the target month and the
      // LABEL_HORIZON_MONTHS - 1 months after it, annualized. A single month was
      // used before, which for a small barangay is mostly noise rather than
      // signal: Bagong Katipunan averages under two cases a month against a
      // population under a thousand, so one extra case moves its annualized rate
      // by more than a thousand per 100k and flips its band. No model can learn
      // that, and walk-forward evaluation showed it scoring below the trivial
      // majority-class baseline. Averaging the window suppresses that noise
      // while keeping the question forward-looking.
      //
      // The window starts AT the target month and runs forward, never backward:
      // every feature is built strictly before the target month, so a backward
      // label window would share months with the features and inflate accuracy
      // without the model having learned anything. A barangay without the full
      // forward window (the final months of the series) yields no label and no
      // row, rather than one averaged over a short window that is not comparable
      // to the rest.
      const labelMonths = months.slice(i, i + LABEL_HORIZON_MONTHS);
      if (labelMonths.length < LABEL_HORIZON_MONTHS) continue;
      const meanCases = labelMonths.reduce((sum, m) => sum + m.case_count, 0) / labelMonths.length;
      const incidence = _computeIncidence(meanCases, pop);
      if (incidence == null) continue;

      row.month = months[i].month;
      row.incidence = incidence;
      trainRows.push(row);
    }
  }
  return trainRows;
}

/**
 * Rule-based classification when the ML service is unavailable.
 * Low if incidence ≤ low_max, High if > med_max, else Medium.
 *
 * Only rolling_12m_incidence is comparable to the thresholds — both are
 * incidence per 100k. The previous `|| row.features.lag_1m` fallback put a raw
 * monthly case count (single digits to low hundreds) up against a per-100k cut
 * point, which reads as "well below low_max" for any barangay and classified it
 * Low regardless of its actual risk. When incidence is genuinely unavailable
 * the honest answer is that this barangay cannot be placed in a band, so it
 * defaults to Medium rather than being asserted as Low.
 */
function _ruleBasedClassify(predictRows, thresholds) {
  const { low_max, med_max } = thresholds;
  return predictRows.map(row => {
    const inc = row.features?.rolling_12m_incidence;
    const known = inc != null && Number.isFinite(inc);
    let riskClass;
    if (!known) riskClass = 'Medium';
    else if (inc <= low_max) riskClass = 'Low';
    else if (inc > med_max) riskClass = 'High';
    else riskClass = 'Medium';

    return {
      barangay_name: row.barangay_name,
      risk_class: riskClass,
      proba: { Low: riskClass === 'Low' ? 1 : 0, Medium: riskClass === 'Medium' ? 1 : 0, High: riskClass === 'High' ? 1 : 0 },
    };
  });
}

function _mergeClassifications(predictRows, predictions, method, thresholds) {
  const eligible = new Set(predictRows.map(row => row.barangay_name));
  const saved = new Map();
  for (const result of predictions) {
    if (eligible.has(result?.barangay_name) && ['Low', 'Medium', 'High'].includes(result.risk_class)) {
      saved.set(result.barangay_name, result);
    }
  }
  const fallback = _ruleBasedClassify(predictRows.filter(row => !saved.has(row.barangay_name)), thresholds);
  const hasRf = method === 'random_forest' && saved.size > 0;
  const byName = {};
  for (const [name, result] of saved) byName[name] = { ...result, model_type: hasRf ? 'random_forest' : 'rule_based' };
  for (const result of fallback) byName[result.barangay_name] = { ...result, model_type: 'rule_based' };
  return {
    classifications: [...saved.values(), ...fallback],
    byName,
    fallbackCount: fallback.length,
    method: hasRf ? (fallback.length ? 'mixed' : 'random_forest')
      : saved.size || fallback.length ? 'rule_based' : null,
  };
}

/**
 * Resolve the persisted risk classification fields for ONE barangay from
 * the classifier's own output — deliberately takes no risk_score/riskClass
 * input, so it is structurally impossible for the legacy weighted index to
 * leak into risk_class. `classified` is `classifyByName[name]` (undefined
 * if that barangay has no classification at all, e.g. classify totally
 * failed and even the rule-based fallback produced nothing).
 *
 * classification_confidence/prob_* are only populated when `classifierMethod`
 * is 'random_forest': the rule-based fallback's proba is a manufactured
 * 100%/0%/0% split (see _ruleBasedClassify), not a real confidence, so it
 * is intentionally withheld rather than persisted as if it were one.
 *
 * @param {{risk_class: string, proba?: object}|undefined} classified
 * @param {string|undefined} classifierMethod - 'random_forest' | 'rule_based'
 */
function _resolveClassification(classified, classifierMethod) {
  const isRealRf = !!classified && classifierMethod === 'random_forest';
  const proba = isRealRf ? classified.proba : null;
  return {
    risk_class: classified?.risk_class || null,
    model_type: classified ? classifierMethod : null,
    model_version: MODEL_VERSION,
    classification_confidence: proba ? proba[classified.risk_class] ?? null : null,
    prob_low: proba?.Low ?? null,
    prob_medium: proba?.Medium ?? null,
    prob_high: proba?.High ?? null,
  };
}

// ==================== BACKGROUND RUN (auto-trigger after sync) ====================
//
// In-memory state for pipeline runs kicked off in the background (webhook/sync)
// and surfaced by GET /api/tb/pipeline/status as `current_run`. Resets to idle
// on server restart — durable history lives in model_metadata; this state only
// answers "is a run happening right now?".

const _runState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  lastError: null,
  lastDurationMs: null,
  trigger: null,
  lastTrigger: null,
  runsCompleted: 0,
  runsFinished: 0,
  // Outcome of the most recently finished run (results.status):
  // 'completed' | 'degraded' (ML down, rule-based results persisted) |
  // 'no_data' | 'error'. Null until a run has finished.
  lastRunStatus: null,
  lastRiskScoresCount: null,
  lastAlertsCount: null,
};
let _pendingTimer = null;
// A run requested while one is in progress is queued (not dropped) and starts after it.
let _rerunRequested = false;

function getPipelineRunStatus() {
  return {
    running: _runState.running,
    startedAt: _runState.startedAt,
    finishedAt: _runState.finishedAt,
    lastError: _runState.lastError,
    lastDurationMs: _runState.lastDurationMs,
    trigger: _runState.trigger,
    lastTrigger: _runState.lastTrigger,
    runsCompleted: _runState.runsCompleted,
    runsFinished: _runState.runsFinished,
    lastRunStatus: _runState.lastRunStatus,
    lastRiskScoresCount: _runState.lastRiskScoresCount,
    lastAlertsCount: _runState.lastAlertsCount,
    scheduled: _pendingTimer != null,
  };
}

/**
 * Run the pipeline with a single-flight lock and full run-state tracking.
 * Shared by the manual admin route (trigger 'manual') and the sync
 * auto-trigger (background), so BOTH update `current_run` and run the same
 * post-run side effects (notification + alert evaluation).
 *
 * If a run is already in progress this call is a no-op (returns null).
 * Never rejects — failures are captured in the run state so status polling
 * (GIS banner) can show them.
 */
async function runPipelineTracked(options = {}, trigger = 'manual') {
  if (_runState.running) {
    _rerunRequested = true;
    console.log(`ℹ️  Pipeline already running — "${trigger}" will run when it finishes`);
    return null;
  }
  _runState.running = true;
  _runState.startedAt = new Date().toISOString();
  _runState.finishedAt = null;
  _runState.lastError = null;
  _runState.trigger = trigger;
  console.log(`🔁 Pipeline started (trigger: ${trigger})`);
  const t0 = Date.now();
  try {
    const results = await runPipeline(options);
    if (results.status === 'stale') _rerunRequested = true;
    _runState.runsCompleted += 1;
    _runState.lastTrigger = trigger;
    _runState.lastRunStatus = results.status;
    _runState.lastRiskScoresCount = results.riskScoresCount;
    _runState.lastAlertsCount = results.alertsCount;
    // 'no_data' and 'stale' runs stored nothing, so there is no new forecast to announce.
    const stored = ['completed', 'degraded'].includes(results.status);

    if (stored) {
      try {
        await createNotification(pool, {
          title: 'Forecast Generated',
          message: `A new forecast has been generated for ${results.period || 'latest period'}.`,
          sourceModule: 'forecasting',
          relatedEntityType: 'pipeline',
          metadata: { period: results.period, trigger },
        });
      } catch (notifErr) {
        console.error('Pipeline notification error:', notifErr.message);
      }
    }

    try {
      await evaluateAllAlerts(pool, results.period || new Date().toISOString().slice(0, 10));
    } catch (alertErr) {
      console.error('Post-pipeline alert evaluation error:', alertErr.message);
    }

    if (!options.historyCutoffMonth && stored) {
      const { runModelEvaluation } = require('./modelEvaluation');
      runModelEvaluation().catch(evaluationErr => {
        console.error('Automatic model evaluation failed:', evaluationErr.message);
      });
    }

    return results;
  } catch (err) {
    _runState.lastError = err.message;
    _runState.lastRunStatus = 'error';
    console.error(`❌ Pipeline failed (${trigger}):`, err.message);
    return null;
  } finally {
    _runState.lastDurationMs = Date.now() - t0;
    _runState.running = false;
    _runState.finishedAt = new Date().toISOString();
    _runState.trigger = null;
    _runState.runsFinished += 1;
    if (_rerunRequested) {
      _rerunRequested = false;
      schedulePipelineRun(`${trigger}:rerun`, 2000);
    }
  }
}

/**
 * Background variant of runPipelineTracked for the sync auto-trigger:
 * runs the default (no options) pipeline, never rejects.
 */
async function runPipelineInBackground(trigger = 'manual') {
  return runPipelineTracked({}, trigger);
}

/**
 * Debounced scheduling: each call (re)arms the timer, so a burst of syncs
 * (e.g. 2023 + 2024 + 2025 uploads in quick succession) collapses into ONE
 * pipeline run instead of three. Fire-and-forget — never throws.
 */
function schedulePipelineRun(trigger = 'sync', delayMs = 5000) {
  if (_pendingTimer) clearTimeout(_pendingTimer);
  _pendingTimer = setTimeout(() => {
    _pendingTimer = null;
    runPipelineInBackground(trigger);
  }, delayMs);
  if (typeof _pendingTimer.unref === 'function') _pendingTimer.unref();
  console.log(`⏳ Pipeline scheduled in ${delayMs}ms (trigger: ${trigger})`);
}

module.exports = {
  runPipeline,
  runHistoricalSnapshots,
  runPipelineTracked,
  runPipelineInBackground,
  schedulePipelineRun,
  getPipelineRunStatus,
  DEFAULT_THRESHOLDS,
  MODEL_VERSION,
  MIN_STORED_HORIZON,
  LABEL_HORIZON_MONTHS,
  buildDenseSeries,
  dropUnfinishedMonth,
  buildTrainingRows,
  buildFeatureRow,
  addCrossSectionFeatures,
  _buildTrainingRows,
  _featureWindow,
  _neighborRisksAt,
  _highRiskHistory,
  _popFor,
  _popForFeature,
  _uniformPopMapByYear,
  _resolveClassification,
  _ruleBasedClassify,
  _mergeClassifications,
  _resolveThresholds,
  _detectSeasonality,
  _backfillActualCounts,
};
