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
  computeRiskScore,
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

/**
 * Run the full prediction pipeline.
 *
 * @param {object} options
 * @param {string} options.period - Forecast period in YYYY-MM-DD format
 *   (defaults to next month from latest in monthly_case_summary)
 * @param {object} options.thresholds - Override frozen thresholds {low_max, med_max}
 * @returns {object} Pipeline run summary
 */
async function runPipeline({ period, thresholds: thresholdsOverride } = {}) {
  const client = await pool.connect();
  const results = {
    status: 'started',
    period: null,
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
    const barangays = barangaysResult.rows;

    if (barangays.length === 0) {
      results.status = 'no_data';
      results.errors.push('No barangays found. Run POST /api/tb/barangays/seed first.');
      return results;
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

    // Determine forecast period (next month from latest)
    const months = [...new Set(monthlyRows.map(r => r.month.toISOString().slice(0, 10)))].sort();
    const latestMonth = months[months.length - 1];
    results.period = period || _nextMonth(latestMonth);
    console.log(`📊 Pipeline period: ${results.period} (latest data: ${latestMonth})`);

    // ── Step 3: Build series for /forecast ──
    // Group by barangay → [{barangay_name, month, case_count}]
    const seriesByBarangay = {};
    for (const row of monthlyRows) {
      const name = row.barangay_name;
      if (!seriesByBarangay[name]) seriesByBarangay[name] = [];
      seriesByBarangay[name].push({
        barangay_name: name,
        month: row.month.toISOString().slice(0, 10),
        case_count: row.case_count,
      });
    }

    const forecastSeries = [];
    for (const b of barangays) {
      const pts = seriesByBarangay[b.name] || [];
      if (pts.length > 0) {
        forecastSeries.push(...pts);
      } else {
        // Barangay with no cases — add a zero row so it appears in results
        forecastSeries.push({
          barangay_name: b.name,
          month: latestMonth,
          case_count: 0,
        });
      }
    }

    // ── Step 4: Call Python /forecast ──
    let forecastResults = [];
    if (results.mlServiceHealthy && forecastSeries.length > 0) {
      try {
        const forecastResponse = await forecast(forecastSeries, 12);
        forecastResults = forecastResponse.forecasts || [];
        results.forecastsCount = forecastResults.length;
        console.log(`🔮 Forecast: ${forecastResults.length} barangays processed`);
      } catch (err) {
        console.error('❌ Forecast call failed:', err.message);
        results.errors.push(`Forecast failed: ${err.message}`);
      }
    }

    // ── Step 5: Compute RF features per barangay ──

    // 5a. Compute neighbor risks
    const barangayIncidences = barangays.map(b => {
      const fc = forecastResults.find(f => f.barangay_name === b.name);
      const predictedCount = fc?.predictions?.[0]?.yhat || 0;
      const inc = _computeIncidence(predictedCount, populationMap[b.name] || 1000);
      return { name: b.name, incidence_per_100k: inc };
    });
    const neighborRisks = computeNeighborRisks(barangayIncidences);

    // 5b. Compute historical bias from past predictions
    let historicalBias = {};
    try {
      const pastPreds = await client.query(
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
      const predictedCount = fc?.predictions?.[0]?.yhat || 0;
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
        console.log(`📋 Training rows: ${trainRows.length} monthly snapshots`);

        const classifyResponse = await classify(thresholds, trainRows, predictRows);
        classifyResults = classifyResponse.predictions || [];
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

      const { riskScore, riskClass } = computeRiskScore({
        incidence: inc,
        trend,
        neighborRisk: neighbor,
        forecastError: histErr,
        maxIncidence,
        maxTrend,
        maxError,
      });

      // Use RF classification if it has meaningful diversity (not all same class)
      // On first run, RF trains on all-same labels → unreliable → use score-based
      const rfResult = classifyResults.find(c => c.barangay_name === name);
      const uniqueRfClasses = new Set(classifyResults.map(c => c.risk_class));
      const rfIsDiverse = uniqueRfClasses.size > 1;
      const finalClass = (rfIsDiverse && rfResult?.risk_class) ? rfResult.risk_class : riskClass;

      return {
        barangay_name: name,
        risk_score: riskScore,
        risk_class: finalClass,
        incidence_per_100k: Math.round(inc * 100) / 100,
        trend_direction: trendByBarangay[name]?.direction || 'Stable',
      };
    });
    results.riskScoresCount = riskScores.length;

    // ── Step 8: Generate alerts ──
    let prevRiskClasses = {};
    try {
      const prev = await client.query(
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
    await client.query('BEGIN');

    await storeResults(
      client,
      results.period,
      forecastResults,
      classifyResults,
      riskScores,
      alerts,
      'arima-v1.0-rf-v1.0'
    );

    // Record pipeline run in model_metadata
    await client.query(
      `INSERT INTO model_metadata (run_type, model_version, training_months, metrics, config)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'pipeline',
        'arima-v1.0-rf-v1.0',
        monthlyRows.length,
        JSON.stringify({
          barangaysProcessed: results.barangaysProcessed,
          forecastsCount: results.forecastsCount,
          classificationsCount: results.classificationsCount,
          alertsCount: results.alertsCount,
        }),
        JSON.stringify({
          thresholds: results.thresholds,
          period: results.period,
        }),
      ]
    );

    await client.query('COMMIT');

    results.status = 'completed';
    results.barangaysProcessed = barangays.length;
    console.log(`✅ Pipeline complete: ${results.barangaysProcessed} barangays, ` +
                `${results.alertsCount} alerts, period ${results.period}`);

    return results;
  } catch (err) {
    await client.query('ROLLBACK');
    results.status = 'error';
    results.errors.push(err.message);
    console.error('❌ Pipeline failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Compute incidence per 100k from case count and population.
 */
function _computeIncidence(cases, population) {
  if (!population || population <= 0) return 0;
  return (cases / population) * 100_000;
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
  return d.toISOString().slice(0, 10);
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
async function _buildTrainingRows(client, populationMap, thresholds) {
  // Fetch all monthly data sorted by month
  const result = await client.query(
    `SELECT barangay_name, month, case_count
     FROM monthly_case_summary
     ORDER BY month ASC`
  );

  if (result.rows.length === 0) return [];

  // Group by barangay, sorted by month ascending
  const byBarangay = {};
  for (const row of result.rows) {
    const name = row.barangay_name;
    if (!byBarangay[name]) byBarangay[name] = [];
    byBarangay[name].push({
      month: row.month.toISOString().slice(0, 10),
      case_count: row.case_count,
    });
  }

  // Get all unique months sorted
  const allMonths = [...new Set(result.rows.map(r => r.month.toISOString().slice(0, 10)))].sort();

  // Fetch past predictions with actual_count for historical_bias computation
  let pastPredictions = [];
  try {
    const pastResult = await client.query(
      `SELECT barangay_name, period, actual_count, forecasted_count
       FROM model_predictions
       WHERE actual_count IS NOT NULL
       ORDER BY period ASC`
    );
    pastPredictions = pastResult.rows;
  } catch {
    // table might be empty on first run
  }

  // Build historical bias map: { barangay_name -> [absolute_errors] }
  const biasByName = {};
  for (const row of pastPredictions) {
    const name = row.barangay_name;
    if (!biasByName[name]) biasByName[name] = [];
    const absErr = Math.abs(row.actual_count - row.forecasted_count);
    biasByName[name].push(absErr);
  }
  // Convert to averages
  const historicalBiasAvg = {};
  for (const [name, errs] of Object.entries(biasByName)) {
    historicalBiasAvg[name] = errs.reduce((a, b) => a + b, 0) / errs.length;
  }

  const ROLLING_WINDOW = 12;
  const trainRows = [];

  for (const name of Object.keys(byBarangay)) {
    const months = byBarangay[name];
    const pop = populationMap[name] || 1000;

    // Need at least ROLLING_WINDOW + 1 months to create one training row
    if (months.length < ROLLING_WINDOW + 1) continue;

    // For each valid target month (index ROLLING_WINDOW onwards)
    for (let i = ROLLING_WINDOW; i < months.length; i++) {
      const targetMonth = months[i];

      // Rolling window: the 12 months before the target month
      const window = months.slice(i - ROLLING_WINDOW, i);
      const windowCounts = window.map(w => w.case_count);

      // 1. forecasted_incidence: annualized from window
      const totalCount = windowCounts.reduce((a, b) => a + b, 0);
      const annualized = (totalCount / windowCounts.length) * 12;
      const forecastedIncidence = _computeIncidence(annualized, pop);

      // 2. recent_trend: slope over the window
      const slope = _linearSlope(windowCounts);

      // 3. seasonality_flag: need ≥24 months of history up to this point
      const historyUpToTarget = months.slice(0, i + 1);
      const seasonalityFlag = _detectSeasonality(historyUpToTarget) ? 1 : 0;

      // 4. lag features: case counts from 1-3 months ago
      const lag1m = i >= 1 ? months[i - 1].case_count : 0;
      const lag2m = i >= 2 ? months[i - 2].case_count : 0;
      const lag3m = i >= 3 ? months[i - 3].case_count : 0;

      // 5. neighbor_risk: average incidence of OTHER barangays in the target month
      let neighborRisk = 0;
      const otherIncidences = [];
      for (const [otherName, otherMonths] of Object.entries(byBarangay)) {
        if (otherName === name) continue;
        const otherMonthData = otherMonths.find(m => m.month === targetMonth.month);
        if (otherMonthData) {
          const otherPop = populationMap[otherName] || 1000;
          otherIncidences.push(_computeIncidence(otherMonthData.case_count, otherPop));
        }
      }
      if (otherIncidences.length > 0) {
        neighborRisk = otherIncidences.reduce((a, b) => a + b, 0) / otherIncidences.length;
      }

      // 6. historical_bias: average past forecast errors for this barangay
      const histBias = historicalBiasAvg[name] || 0;

      // Incidence for the target month (this becomes the label via tertile thresholds)
      const incidence = _computeIncidence(targetMonth.case_count, pop);

      trainRows.push({
        features: {
          forecasted_incidence: forecastedIncidence,
          recent_trend: slope,
          seasonality_flag: seasonalityFlag,
          lag_1m: lag1m,
          lag_2m: lag2m,
          lag_3m: lag3m,
          neighbor_risk: neighborRisk,
          historical_bias: histBias,
        },
        incidence,
      });
    }
  }

  // Normalize neighbor_risk to [0, 1] across all training rows
  if (trainRows.length > 0) {
    const nrValues = trainRows.map(r => r.features.neighbor_risk);
    const nrMin = Math.min(...nrValues);
    const nrMax = Math.max(...nrValues);
    const nrRange = nrMax - nrMin;
    for (const row of trainRows) {
      row.features.neighbor_risk = nrRange > 0
        ? (row.features.neighbor_risk - nrMin) / nrRange
        : 0;
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
};
