/**
 * TBInsight — Pipeline Orchestrator
 *
 * Runs the full prediction pipeline:
 *   1. Query L3 (monthly_case_summary) + L0 (barangays) for population
 *   2. Build series for Python /forecast → ARIMA predictions
 *   3. Compute RF features per barangay (forecasted_incidence, recent_trend,
 *      seasonality_flag, lag_1m, lag_2m, lag_3m, neighbor_risk, historical_bias)
 *   4. Build classify request → Python /classify → risk classes + proba
 *   5. Compute weighted risk scores → L5 (barangay_risk_scores)
 *   6. Store forecasts + classifications → L4 (model_predictions)
 *   7. Generate alerts → L6 (alerts)
 *
 * Design principles:
 *   - Python service is stateless: all data passed in request body
 *   - Thresholds computed once, frozen, passed to /classify each run
 *   - All L4/L5/L6 writes in a single transaction (idempotent re-runs)
 *   - Historical bias = AVG(past forecast errors) → feedback loop (Approach B)
 *   - Walk-forward evaluation available via POST /api/tb/evaluate (admin only)
 */

const pool = require('../db');
const { forecast, classify, thresholds: callThresholds, healthCheck, evaluate } = require('./mlClient');
const {
  monthKey,
  computeRiskScore,
  classifyByTertile,
  computeNeighborRisks,
  computeHistoricalBias,
  classifyTrend,
  generateAlerts,
  storeResults,
} = require('./scoring');

// Default thresholds — overridden by auto-calibration from real data on each run
const DEFAULT_THRESHOLDS = {
  low_max: 150.0,
  med_max: 350.0,
};

// Leading months whose city-wide total is below this share of the median month
// are treated as stray records (e.g. one old case) and dropped from the calendar.
const LEADING_TRIM_SHARE = 0.2;

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
 * Run the full prediction pipeline.
 *
 * @param {object} options
 * @param {string} options.period - Forecast period in YYYY-MM-DD format
 *   (defaults to next month from latest in monthly_case_summary)
 * @param {object} options.thresholds - Override frozen thresholds {low_max, med_max}
 * @param {number} options.forecastHorizon - Number of months to forecast ahead (default 1)
 * @param {string[]} options.barangays - Optional array of barangay names to filter (if empty, all)
 * @returns {object} Pipeline run summary
 */
async function runPipeline({ period, thresholds: thresholdsOverride, forecastHorizon = 1, barangays: barangayFilter } = {}) {
  const client = await pool.connect();
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
    mlServiceHealthy: false,
    errors: [],
  };

  try {
    // ── Step 0: Check ML service health ──
    results.mlServiceHealthy = await healthCheck();
    if (!results.mlServiceHealthy) {
      results.status = 'degraded';
      results.errors.push('ML service is unreachable. Pipeline will use rule-based fallback.');
      console.warn('⚠️ ML service unhealthy — using rule-based classification only');
    }

    // ── Step 1: Query reference data ──
    const barangaysResult = await client.query(
      'SELECT name, population FROM barangays ORDER BY name'
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

    const populationMap = {};
    for (const b of barangays) {
      populationMap[b.name] = b.population;
    }

    // ── Step 2: Query L3 monthly case summary ──
    const monthlyResult = await client.query(
      'SELECT barangay_name, month, case_count FROM monthly_case_summary ORDER BY month'
    );
    const monthlyRows = monthlyResult.rows;

    if (monthlyRows.length === 0) {
      results.status = 'no_data';
      results.errors.push('No case data in monthly_case_summary. Import CSV first.');
      return results;
    }

    // Release client before long-running ML calls to free pool connections
    client.release();

    // Determine forecast period (next month from latest)
    const { calendar, seriesByBarangay } = buildDenseSeries(monthlyRows, barangays.map(b => b.name));
    const latestMonth = calendar[calendar.length - 1];
    results.period = period || _nextMonth(latestMonth);
    console.log(`📊 Pipeline period: ${results.period} (latest data: ${latestMonth})`);

    // ── Step 3: Build series for /forecast ──
    // Dense, zero-filled series on the shared calendar (every barangay appears,
    // including those with no cases).
    const forecastSeries = barangays.flatMap(b => seriesByBarangay[b.name]);

    // ── Step 4: Call Python /forecast ──
    let forecastResults = [];
    if (results.mlServiceHealthy && forecastSeries.length > 0) {
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
    if (forecastResults.length === 0 && forecastSeries.length > 0) {
      console.log('🔄 ML service unavailable — generating seasonal naive fallback forecasts');
      const barangayMap = {};
      for (const row of forecastSeries) {
        if (!barangayMap[row.barangay_name]) barangayMap[row.barangay_name] = [];
        barangayMap[row.barangay_name].push(row);
      }

      for (const [bName, pts] of Object.entries(barangayMap)) {
        const sorted = pts.sort((a, c) => a.month.localeCompare(c.month));
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

          // CI widens with forecast horizon
          const ciSpread = 0.15 + (i * 0.03);
          predictions.push({
            month: nextPeriod,
            yhat,
            yhat_lower: Math.max(0, Math.round(yhat * (1 - ciSpread))),
            yhat_upper: Math.round(yhat * (1 + ciSpread)),
          });
        }
        forecastResults.push({
          barangay_name: bName,
          method: 'seasonal-naive-fallback',
          backtest_mae: 0,
          predictions,
        });
      }
      results.forecastsCount = forecastResults.length;
      console.log(`🔄 Fallback: ${forecastResults.length} barangays forecasted with seasonal naive`);
    }

    // ── Step 5: Compute RF features per barangay ──

    // 5a. Compute neighbor risks
    const barangayIncidences = barangays.map(b => {
      const fc = forecastResults.find(f => f.barangay_name === b.name);
      let predictedCount = fc?.predictions?.[0]?.yhat;
      // Fallback: if ARIMA failed, use actual case count from latest month
      if (predictedCount == null) {
        const pts = seriesByBarangay[b.name] || [];
        const sorted = pts.sort((a, c) => a.month.localeCompare(c.month));
        predictedCount = sorted.length > 0 ? sorted[sorted.length - 1].case_count : 0;
      }
      const inc = _computeIncidence(predictedCount, populationMap[b.name] || 1000);
      return { name: b.name, incidence_per_100k: inc };
    });
    const neighborRisks = computeNeighborRisks(barangayIncidences);

    // 5b. Compute historical bias from past predictions
    let historicalBias = {};
    try {
      const pastPreds = await pool.query(
        `SELECT barangay_name, actual_count, forecasted_count
         FROM model_predictions
         WHERE actual_count IS NOT NULL
         ORDER BY period DESC
         LIMIT 500`
      );
      historicalBias = computeHistoricalBias(pastPreds.rows);
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

    // 5d. Build prediction feature rows
    const predictRows = barangays.map(b => {
      const name = b.name;
      const pop = populationMap[name] || 1000;
      const fc = forecastResults.find(f => f.barangay_name === name);
      let predictedCount = fc?.predictions?.[0]?.yhat;
      // Fallback: if ARIMA failed, use actual case count from latest month
      if (predictedCount == null) {
        const pts = seriesByBarangay[name] || [];
        const sorted = pts.sort((a, c) => a.month.localeCompare(c.month));
        predictedCount = sorted.length > 0 ? sorted[sorted.length - 1].case_count : 0;
      }
      const forecastedIncidence = _computeIncidence(predictedCount, pop);
      const slope = trendByBarangay[name]?.slope || 0;
      const seasonalityFlag = _detectSeasonality(seriesByBarangay[name] || []);

      // Lag features: case counts from 1-3 months ago
      const series = seriesByBarangay[name] || [];
      const sorted = series.sort((a, c) => a.month.localeCompare(c.month));
      const lag1m = sorted.length >= 1 ? sorted[sorted.length - 1].case_count : 0;
      const lag2m = sorted.length >= 2 ? sorted[sorted.length - 2].case_count : 0;
      const lag3m = sorted.length >= 3 ? sorted[sorted.length - 3].case_count : 0;

      return {
        barangay_name: name,
        features: {
          forecasted_incidence: forecastedIncidence,
          recent_trend: slope,
          seasonality_flag: seasonalityFlag ? 1 : 0,
          lag_1m: lag1m,
          lag_2m: lag2m,
          lag_3m: lag3m,
          neighbor_risk: neighborRisks[name] || 0,
          historical_bias: historicalBias[name] || 0,
        },
      };
    });

    // ── Step 6: Auto-calibrate thresholds and call Python /classify ──
    let classifyResults = [];
    if (results.mlServiceHealthy && predictRows.length > 0) {
      try {
        // Auto-calibrate thresholds from current data (tertile method)
        let thresholds = thresholdsOverride;
        if (!thresholds) {
          try {
            const allIncs = barangayIncidences.map(b => b.incidence_per_100k);
            if (allIncs.length > 0) {
              const thresholdResult = await callThresholds(allIncs, 'tertile');
              thresholds = { low_max: thresholdResult.low_max, med_max: thresholdResult.med_max };
              console.log(`📐 Auto-calibrated thresholds: Low≤${thresholds.low_max.toFixed(1)}, High≥${thresholds.med_max.toFixed(1)}`);
            } else {
              thresholds = DEFAULT_THRESHOLDS;
            }
          } catch {
            thresholds = DEFAULT_THRESHOLDS;
            console.log('📐 Using default thresholds (calibration failed)');
          }
        }
        results.thresholds = thresholds;

        // Build monthly snapshot training rows from historical data
        const trainRows = await _buildTrainingRows(client, populationMap, thresholds);
        results.trainingRows = trainRows.length;
        console.log(`📋 Training rows: ${trainRows.length} monthly snapshots`);

        const classifyResponse = await classify(thresholds, trainRows, predictRows);
        classifyResults = classifyResponse.predictions || [];
        results.classifierMethod = classifyResponse.method || 'random_forest';
        results.classificationsCount = classifyResults.length;
        console.log(`🏷️  Classification: ${classifyResults.length} barangays processed`);
      } catch (err) {
        console.error('❌ Classify call failed:', err.message);
        results.errors.push(`Classify failed: ${err.message}`);
      }
    }

    // Rule-based fallback if ML service is down or classify failed
    if (classifyResults.length === 0 && predictRows.length > 0) {
      classifyResults = _ruleBasedClassify(predictRows, results.thresholds || DEFAULT_THRESHOLDS);
      results.classificationsCount = classifyResults.length;
      console.log(`🏷️  Rule-based fallback: ${classifyResults.length} barangays classified`);
    }

    // ── Step 7: Compute risk scores ──
    const allIncidences = barangayIncidences.map(b => b.incidence_per_100k);
    const maxIncidence = Math.max(...allIncidences, 1);
    const allTrends = barangays.map(b => Math.abs(trendByBarangay[b.name]?.slope || 0));
    const maxTrend = Math.max(...allTrends, 0.01);
    const allErrors = barangays.map(b => historicalBias[b.name] || 0);
    const maxError = Math.max(...allErrors, 0.01);

    const riskScores = barangays.map(b => {
      const name = b.name;
      const inc = barangayIncidences.find(x => x.name === name)?.incidence_per_100k || 0;
      const trend = trendByBarangay[name]?.slope || 0;
      const neighbor = neighborRisks[name] || 0;
      const histErr = historicalBias[name] || 0;

      const { riskScore, riskClass, normIncidence, normTrend, normError, neighborRisk } = computeRiskScore({
        incidence: inc,
        trend,
        neighborRisk: neighbor,
        forecastError: histErr,
        maxIncidence,
        maxTrend,
        maxError,
      });

      // Use weighted risk score's tertile classification for barangay_risk_scores
      // This ensures consistent Low/Medium/High distribution regardless of ML service availability
      const finalClass = riskClass;

      return {
        barangay_name: name,
        risk_score: riskScore,
        risk_class: finalClass,
        incidence_per_100k: Math.round(inc * 100) / 100,
        trend_direction: trendByBarangay[name]?.direction || 'Stable',
        norm_incidence: normIncidence,
        norm_trend: normTrend,
        norm_neighbor_risk: neighborRisk,
        norm_forecast_error: normError,
      };
    });

    // The displayed class is the tertile of the weighted score across barangays (computeRiskScore's
    // fixed 33/66 cutoffs would put nearly everything in Medium — see classifyByTertile).
    const scoreTiers = classifyByTertile(riskScores.map(r => r.risk_score));
    riskScores.forEach((r, i) => { r.risk_class = scoreTiers.classes[i]; });
    results.scoreThresholds = { low_max: scoreTiers.low_max, med_max: scoreTiers.med_max };
    results.riskScoresCount = riskScores.length;

    // ── Step 8: Generate alerts ──
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

    const alerts = generateAlerts({
      forecasts: forecastResults,
      classifications: classifyResults,
      barangayList: barangays.map(b => ({ name: b.name })),
      prevRiskClasses,
      period: results.period,
    });
    results.alertsCount = alerts.length;

    // ── Step 9: Store everything in a transaction ──
    // Re-acquire client for transaction
    const txClient = await pool.connect();
    try {
    await txClient.query('BEGIN');

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
      'arima-v1.0-rf-v1.0'
    );

    // Record pipeline run in model_metadata.
    // training_months = distinct months on the shared calendar (NOT the barangay-month row count).
    results.barangaysProcessed = barangays.length;
    await txClient.query(
      `INSERT INTO model_metadata (run_type, model_version, training_months, metrics, config)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'pipeline',
        'arima-v1.0-rf-v1.0',
        calendar.length,
        JSON.stringify({
          barangaysProcessed: results.barangaysProcessed,
          dataStart: calendar[0],
          dataEnd: latestMonth,
          trainingRows: results.trainingRows ?? 0,
          classifierMethod: results.classifierMethod ?? 'rule_based',
          forecastMethods: [...new Set(forecastResults.map(f => f.method))],
          forecastsCount: results.forecastsCount,
          classificationsCount: results.classificationsCount,
          alertsCount: results.alertsCount,
        }),
        JSON.stringify({
          thresholds: results.thresholds,
          scoreThresholds: results.scoreThresholds,
          period: results.period,
        }),
      ]
    );

    await txClient.query('COMMIT');
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
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Compute ANNUAL incidence per 100k from monthly case count and population.
 * WHO standard is annual incidence per 100,000 population.
 */
function _computeIncidence(monthlyCases, population) {
  if (!population || population <= 0) return 0;
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

/**
 * Detect seasonality: if there's at least 24 months,
 * check if the same month last year correlates with this month.
 */
function _detectSeasonality(series) {
  if (series.length < 24) return false;
  const sorted = series.sort((a, b) => a.month.localeCompare(b.month));
  const counts = sorted.map(s => s.case_count);

  // Simple check: compare first half vs second half season patterns
  const half = Math.floor(counts.length / 2);
  const firstHalf = counts.slice(0, half);
  const secondHalf = counts.slice(half);

  // Check if seasonal pattern (same relative peaks) persists
  // Simple: check if month-to-month changes have similar sign patterns
  const changes1 = firstHalf.slice(1).map((v, i) => v - firstHalf[i]);
  const changes2 = secondHalf.slice(1).map((v, i) => v - secondHalf[i]);

  if (changes1.length < 6 || changes2.length < 6) return false;

  // Count matching sign patterns in aligned positions
  let matches = 0;
  const len = Math.min(changes1.length, changes2.length, 12);
  for (let i = 0; i < len; i++) {
    if ((changes1[i] >= 0) === (changes2[i] >= 0)) matches++;
  }
  return matches / len > 0.6;
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
 * Each row: { features: {6 features}, incidence: float }
 * Labels derived from incidence via tertile thresholds in Python.
 *
 * Features are computed with rolling windows to prevent data leakage:
 *   - forecasted_incidence: annualized cases from the 12-month lookback window
 *   - recent_trend: slope over the 12-month window
 *   - seasonality_flag: 1 if ≥24 months available and sign-pattern match > 60%
 *   - population_density: same as forecasted_incidence (per design spec)
 *   - neighbor_risk: average incidence of OTHER barangays in the same month, normalized
 *   - historical_bias: AVG(|actual - forecasted|) from past predictions (0 if no history)
 */
async function _buildTrainingRows(_client, populationMap, thresholds) {
  // Fetch all monthly data (use pool directly — client is released)
  const result = await pool.query(
    `SELECT barangay_name, month, case_count
     FROM monthly_case_summary
     ORDER BY month ASC`
  );

  if (result.rows.length === 0) return [];

  // Fetch past predictions with actual_count for historical_bias computation
  let pastPredictions = [];
  try {
    const pastResult = await pool.query(
      `SELECT barangay_name, period, actual_count, forecasted_count
       FROM model_predictions
       WHERE actual_count IS NOT NULL
       ORDER BY period ASC`
    );
    pastPredictions = pastResult.rows;
  } catch {
    // table might be empty on first run
  }

  // Average absolute forecast error per barangay
  const biasByName = {};
  for (const row of pastPredictions) {
    (biasByName[row.barangay_name] ??= []).push(Math.abs(row.actual_count - row.forecasted_count));
  }
  const historicalBiasAvg = {};
  for (const [name, errs] of Object.entries(biasByName)) {
    historicalBiasAvg[name] = errs.reduce((a, b) => a + b, 0) / errs.length;
  }

  const { seriesByBarangay } = buildDenseSeries(result.rows, Object.keys(populationMap));
  return buildTrainingRows(seriesByBarangay, populationMap, historicalBiasAvg);
}

/**
 * Pure: turn dense per-barangay series into RF training rows (one per
 * barangay-month that has a full look-back window before it).
 *
 * Window: 12 months when there are at least 18 months of history; otherwise
 * half the history (min 3), so short histories still yield training rows
 * instead of none.
 *
 * Features mirror what is computed at prediction time, in the same units:
 *   - forecasted_incidence: annualized incidence of the window's mean monthly count
 *   - neighbor_risk: mean incidence of the other barangays in the target month,
 *     min-max normalized across barangays within that month
 * The label source `incidence` is the target month's annualized incidence.
 *
 * @param {Object} seriesByBarangay - from buildDenseSeries (all same length)
 * @param {Object} populationMap - {name: population}
 * @param {Object} historicalBiasAvg - {name: mean abs forecast error}
 */
function buildTrainingRows(seriesByBarangay, populationMap, historicalBiasAvg = {}) {
  const names = Object.keys(seriesByBarangay);
  const maxLen = Math.max(0, ...names.map(n => seriesByBarangay[n].length));
  const window = maxLen >= 18 ? 12 : Math.max(3, Math.floor(maxLen / 2));
  if (maxLen <= window) return [];

  const trainRows = [];
  for (let i = window; i < maxLen; i++) {
    // Incidence of every barangay in the target month (for neighbor_risk)
    const monthInc = {};
    for (const name of names) {
      const pt = seriesByBarangay[name][i];
      monthInc[name] = pt ? _computeIncidence(pt.case_count, populationMap[name] || 1000) : 0;
    }
    const incSum = Object.values(monthInc).reduce((a, b) => a + b, 0);

    const monthRows = [];
    for (const name of names) {
      const months = seriesByBarangay[name];
      if (months.length <= i) continue;
      const pop = populationMap[name] || 1000;
      const windowCounts = months.slice(i - window, i).map(w => w.case_count);

      const meanCount = windowCounts.reduce((a, b) => a + b, 0) / windowCounts.length;
      const seasonalityFlag = _detectSeasonality(months.slice(0, i + 1)) ? 1 : 0;

      monthRows.push({
        rawNeighbor: names.length > 1 ? (incSum - monthInc[name]) / (names.length - 1) : 0,
        row: {
          features: {
            forecasted_incidence: _computeIncidence(meanCount, pop),
            recent_trend: _linearSlope(windowCounts),
            seasonality_flag: seasonalityFlag,
            lag_1m: months[i - 1].case_count,
            lag_2m: months[i - 2].case_count,
            lag_3m: months[i - 3].case_count,
            neighbor_risk: 0,
            historical_bias: historicalBiasAvg[name] || 0,
          },
          incidence: monthInc[name],
        },
      });
    }

    // Normalize neighbor_risk to [0, 1] within the month, as done at prediction time
    const raws = monthRows.map(r => r.rawNeighbor);
    const min = Math.min(...raws);
    const range = Math.max(...raws) - min;
    for (const { rawNeighbor, row } of monthRows) {
      row.features.neighbor_risk = range > 0 ? (rawNeighbor - min) / range : 0;
      trainRows.push(row);
    }
  }
  return trainRows;
}

/**
 * Rule-based classification when ML service is unavailable.
 * Simple threshold-based: Low if incidence ≤ low_max, High if > med_max, else Medium.
 */
function _ruleBasedClassify(predictRows, thresholds) {
  const { low_max, med_max } = thresholds;
  return predictRows.map(row => {
    const inc = row.features.forecasted_incidence || row.features.lag_1m || 0;
    let riskClass;
    if (inc <= low_max) riskClass = 'Low';
    else if (inc > med_max) riskClass = 'High';
    else riskClass = 'Medium';

    return {
      barangay_name: row.barangay_name,
      risk_class: riskClass,
      proba: { Low: riskClass === 'Low' ? 1 : 0, Medium: riskClass === 'Medium' ? 1 : 0, High: riskClass === 'High' ? 1 : 0 },
    };
  });
}

module.exports = {
  runPipeline,
  DEFAULT_THRESHOLDS,
  buildDenseSeries,
  buildTrainingRows,
};
