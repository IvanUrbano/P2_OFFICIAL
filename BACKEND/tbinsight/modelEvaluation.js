const pool = require('../db');
const { evaluate, thresholds: callThresholds } = require('./mlClient');
const { getPopulationMap } = require('./populationService');
const { monthKey } = require('./scoring');
const { pasigResidentOnly } = require('./locationScope');
const { forecastErrorFloor, riskBandCeiling, lowHighConfusion } = require('./achievable');

const MIN_TRAIN_MONTHS = 24;
const MODEL_VERSION = 'arima-v1.2-rf-v1.2';

let evaluationStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  lastError: null,
  failedAt: null,
};
let inFlight = null;
let queuedEvaluation = false;
let queuedMinTrain = MIN_TRAIN_MONTHS;

async function executeEvaluation(minTrain = MIN_TRAIN_MONTHS) {
  const { _buildTrainingRows, buildDenseSeries, dropUnfinishedMonth, LABEL_HORIZON_MONTHS } = require('./pipeline');
  const monthlyResult = await pool.query(
    `SELECT barangay_name, DATE_TRUNC('month', date_of_diagnosis)::date AS month,
            COUNT(*)::integer AS case_count
     FROM tb_cases
     WHERE date_of_diagnosis IS NOT NULL AND ${pasigResidentOnly()}
     GROUP BY barangay_name, DATE_TRUNC('month', date_of_diagnosis)
     ORDER BY month`
  );
  // Same rule as the pipeline: a month still in progress is not scored.
  monthlyResult.rows = dropUnfinishedMonth(monthlyResult.rows);
  if (monthlyResult.rows.length === 0) {
    throw new Error('No historical data available for evaluation.');
  }

  const barangaysResult = await pool.query('SELECT name, population FROM barangays ORDER BY name');
  const populationMap = {};
  for (const row of barangaysResult.rows) populationMap[row.name] = row.population;

  const barangayIncidences = [];
  const byBarangay = {};
  for (const row of monthlyResult.rows) {
    (byBarangay[row.barangay_name] ||= []).push(row);
  }
  for (const [name, months] of Object.entries(byBarangay)) {
    const totalCases = months.reduce((sum, month) => sum + Number(month.case_count), 0);
    const population = Number(populationMap[name]) || 0;
    const incidence = population > 0 ? ((totalCases / months.length) * 12 / population) * 100_000 : 0;
    barangayIncidences.push(incidence);
  }

  let thresholds;
  try {
    const thresholdResult = await callThresholds(barangayIncidences, 'tertile');
    thresholds = { low_max: thresholdResult.low_max, med_max: thresholdResult.med_max };
  } catch (error) {
    console.warn('Evaluation threshold calibration failed; using documented defaults:', error.message);
    thresholds = { low_max: 150.0, med_max: 350.0 };
  }

  const dataYears = [...new Set(monthlyResult.rows.map(row => Number(monthKey(row.month).slice(0, 4))))];
  const popMapByYear = {};
  for (const year of dataYears) popMapByYear[year] = await getPopulationMap(year);
  const trainRows = await _buildTrainingRows(monthlyResult.rows, popMapByYear);

  const barangayNamesResult = await pool.query('SELECT name FROM barangays ORDER BY name');
  const { calendar, seriesByBarangay } = buildDenseSeries(
    monthlyResult.rows,
    barangayNamesResult.rows.map(row => row.name)
  );
  const series = Object.values(seriesByBarangay).flat();
  const evaluation = await evaluate(series, trainRows, thresholds, minTrain);
  const steps = (evaluation.arima?.steps || []).map(step => ({
    ...step,
    month: calendar[Number(step.test_month) - 1] || null,
  }));
  // Every evaluated barangay's own result with dated months, so the Forecasting page can show
  // results for one barangay or a year range from what is SAVED (viewing never reruns the model).
  // Kept compact: month, actual, predicted, method — the error is derived when read.
  const perBarangay = (evaluation.arima?.per_barangay || []).map(b => ({
    barangay_name: b.barangay_name,
    mae: b.mae ?? null,
    mape: b.mape ?? null,
    rmse: b.rmse ?? null,
    wape: b.wape ?? null,
    skill: b.skill ?? null,
    mae_3m: b.mae_3m ?? null,
    wape_3m: b.wape_3m ?? null,
    skill_3m: b.skill_3m ?? null,
    n_steps: b.n_steps ?? 0,
    method_counts: b.method_counts || {},
    steps: (b.steps || [])
      .map(step => ({
        month: calendar[Number(step.test_month) - 1] || null,
        actual: step.actual,
        predicted: step.predicted,
        baseline: step.baseline ?? null,
        // Next-3-months total starting this month (absent for the last 2 months tested)
        ...(step.actual_3m != null && {
          actual_3m: step.actual_3m,
          predicted_3m: step.predicted_3m,
          baseline_3m: step.baseline_3m,
        }),
        method: step.method || 'arima',
      }))
      .filter(step => step.month),
  }));
  const result = {
    ...evaluation,
    arima: { ...evaluation.arima, steps },
  };
  const methodCounts = result.arima?.method_counts || {};
  const methods = Object.keys(methodCounts).filter(method => methodCounts[method] > 0);
  const method = methods.length === 0
    ? null
    : methods.length === 1 && methods[0] === 'arima'
      ? 'ARIMA'
      : methods.map(name => name === 'arima' ? 'ARIMA' : name.replaceAll('_', ' ')).join(' + ');
  const evaluatedMonths = steps.map(step => step.month).filter(Boolean).sort();
  if ((result.arima?.mae != null || result.arima?.mape != null) && evaluatedMonths.length === 0) {
    throw new Error('Evaluation returned error metrics without dated comparison periods.');
  }
  // What a perfect model would score on the same months (see achievable.js): the
  // evaluation is read against this, not against 100%. The RF was tested on the last
  // n_steps label months.
  const rfSteps = result.rf?.n_steps || 0;
  const labelMonths = [...new Set(trainRows.map(row => row.month))].sort();
  const achievableMae = forecastErrorFloor(perBarangay, seriesByBarangay);
  const rfCeiling = rfSteps > 0
    ? riskBandCeiling(seriesByBarangay, popMapByYear, labelMonths.slice(-rfSteps), LABEL_HORIZON_MONTHS)
    : null;

  const savedMetrics = {
    arima: {
      achievable_mae: achievableMae,
      mae: result.arima?.mae ?? null,
      mape: result.arima?.mape ?? null,
      n_steps: result.arima?.n_steps ?? 0,
      method_counts: methodCounts,
      failed_barangays: result.arima?.failed_barangays || [],
      baseline_mae: result.arima?.baseline_mae ?? null,
      baseline_mape: result.arima?.baseline_mape ?? null,
      rmse: result.arima?.rmse ?? null,
      wape: result.arima?.wape ?? null,
      baseline_wape: result.arima?.baseline_wape ?? null,
      skill: result.arima?.skill ?? null,
      mae_3m: result.arima?.mae_3m ?? null,
      wape_3m: result.arima?.wape_3m ?? null,
      baseline_wape_3m: result.arima?.baseline_wape_3m ?? null,
      skill_3m: result.arima?.skill_3m ?? null,
      steps,
      example_barangay: result.arima?.example_barangay || null,
      per_barangay: perBarangay,
    },
    rf: {
      accuracy: result.rf?.accuracy ?? null,
      f1_macro: result.rf?.f1_macro ?? null,
      precision: result.rf?.precision || {},
      recall: result.rf?.recall || {},
      kappa: result.rf?.kappa ?? null,
      baseline_accuracy: result.rf?.baseline_accuracy ?? null,
      baseline_kappa: result.rf?.baseline_kappa ?? null,
      persistence_accuracy: result.rf?.persistence_accuracy ?? null,
      persistence_kappa: result.rf?.persistence_kappa ?? null,
      n_steps: result.rf?.n_steps ?? 0,
      confusion_matrix: result.rf?.confusion_matrix || null,
      ceiling_accuracy: rfCeiling,
      low_high_confusion: lowHighConfusion(result.rf?.confusion_matrix),
    },
  };

  await pool.query(
    `INSERT INTO model_metadata (run_type, model_version, training_months, metrics, config)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      'evaluation',
      result.model_version || MODEL_VERSION,
      calendar.length,
      JSON.stringify(savedMetrics),
      JSON.stringify({
        thresholds,
        min_train: minTrain,
        period: calendar[calendar.length - 1] || null,
        method,
        evaluation_start: evaluatedMonths[0] || null,
        evaluation_end: evaluatedMonths[evaluatedMonths.length - 1] || null,
        evaluated_months: new Set(evaluatedMonths).size,
      }),
    ]
  );

  return result;
}

function runModelEvaluation(minTrain = MIN_TRAIN_MONTHS) {
  if (inFlight) {
    queuedEvaluation = true;
    queuedMinTrain = minTrain;
    return inFlight;
  }
  evaluationStatus = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastError: null,
    failedAt: null,
  };
  inFlight = (async () => {
    let result;
    let nextMinTrain = minTrain;
    do {
      queuedEvaluation = false;
      try {
        result = await executeEvaluation(nextMinTrain);
        evaluationStatus.lastError = null;
        evaluationStatus.failedAt = null;
      } catch (error) {
        evaluationStatus.lastError = error.message;
        evaluationStatus.failedAt = new Date().toISOString();
        try {
          await pool.query(
            `INSERT INTO model_metadata (run_type, model_version, training_months, metrics, config)
             VALUES ($1, $2, $3, $4, $5)`,
            ['evaluation_failed', MODEL_VERSION, 0,
              JSON.stringify({ error: error.message }),
              JSON.stringify({ min_train: nextMinTrain })]
          );
        } catch (saveError) {
          console.error('Could not save evaluation failure status:', saveError.message);
        }
        if (!queuedEvaluation) throw error;
      }
      if (queuedEvaluation) nextMinTrain = queuedMinTrain;
    } while (queuedEvaluation);
    return result;
  })().finally(() => {
    evaluationStatus = {
      ...evaluationStatus,
      running: false,
      finishedAt: new Date().toISOString(),
    };
    inFlight = null;
  });
  return inFlight;
}

function getModelEvaluationStatus() {
  return { ...evaluationStatus };
}

module.exports = { runModelEvaluation, getModelEvaluationStatus };
