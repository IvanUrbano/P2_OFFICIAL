// One-off script: replicates POST /api/tb/evaluate route logic directly,
// against the already-running local ML service, to read real walk-forward
// accuracy numbers without going through HTTP auth on the live dev server.
process.env.ML_SERVICE_URL = 'http://localhost:8001';
process.env.ML_API_KEY = 'eval-test-key-123';

require('dotenv').config();
const pool = require('./db');
const { thresholds: callThresholds, evaluate: mlEvaluate } = require('./tbinsight/mlClient');
const { _buildTrainingRows, buildDenseSeries } = require('./tbinsight/pipeline');
const { getPopulationMap } = require('./tbinsight/populationService');

async function main() {
  const minTrain = 24;

  const monthlyResult = await pool.query(
    'SELECT barangay_name, month, case_count FROM monthly_case_summary ORDER BY month'
  );
  if (monthlyResult.rows.length === 0) {
    console.log('No historical data available.');
    process.exit(1);
  }

  const barangaysResult = await pool.query('SELECT name, population FROM barangays ORDER BY name');
  const populationMap = {};
  for (const row of barangaysResult.rows) populationMap[row.name] = row.population;

  const byBarangay = {};
  for (const row of monthlyResult.rows) {
    (byBarangay[row.barangay_name] ??= []).push(row);
  }
  const barangayIncidences = [];
  for (const [name, months] of Object.entries(byBarangay)) {
    const totalCases = months.reduce((s, m) => s + m.case_count, 0);
    const pop = populationMap[name] || 0;
    const annualized = (totalCases / months.length) * 12;
    barangayIncidences.push((annualized / pop) * 100_000);
  }

  let thresholds;
  try {
    const r = await callThresholds(barangayIncidences, 'tertile');
    thresholds = { low_max: r.low_max, med_max: r.med_max };
  } catch {
    thresholds = { low_max: 150.0, med_max: 350.0 };
  }
  console.log('Thresholds:', thresholds);

  const allMonths = [...new Set(monthlyResult.rows.map(r => r.month.toISOString().slice(0, 10)))].sort();
  const dataYears = [...new Set(allMonths.map(m => Number(m.slice(0, 4))))];
  const popMapByYear = {};
  for (const y of dataYears) popMapByYear[y] = await getPopulationMap(y);

  const trainRows = await _buildTrainingRows(null, popMapByYear, thresholds);
  console.log('Training rows:', trainRows.length);

  const barangayNamesRes = await pool.query('SELECT name FROM barangays ORDER BY name');
  const { seriesByBarangay } = buildDenseSeries(monthlyResult.rows, barangayNamesRes.rows.map(r => r.name));
  const series = Object.values(seriesByBarangay).flat();

  console.log('Calling ML /evaluate ... (this fits ~30 ARIMA models, can take a minute)');
  const result = await mlEvaluate(series, trainRows, thresholds, minTrain);

  console.log('\n===== ARIMA =====');
  console.log('MAE:', result.arima.mae, ' MAPE:', result.arima.mape, '%  n_steps:', result.arima.n_steps);
  console.log('method_counts:', result.arima.method_counts);

  console.log('\n===== RF =====');
  console.log('accuracy:', result.rf.accuracy, ' f1_macro:', result.rf.f1_macro, ' n_steps:', result.rf.n_steps);
  console.log('precision:', result.rf.precision);
  console.log('recall:', result.rf.recall);
  console.log('confusion_matrix:', JSON.stringify(result.rf.confusion_matrix));

  process.exit(0);
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
