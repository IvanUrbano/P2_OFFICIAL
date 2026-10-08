const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function installMockModule(modulePath, exports) {
  const mock = new Module(modulePath);
  mock.filename = modulePath;
  mock.loaded = true;
  mock.exports = exports;
  require.cache[modulePath] = mock;
}

describe('modelEvaluation', () => {
  it('stores aggregate metrics with calendar-dated forecast comparison steps', async () => {
    const modulePaths = [
      require.resolve('../../db'),
      require.resolve('../../tbinsight/mlClient'),
      require.resolve('../../tbinsight/populationService'),
      require.resolve('../../tbinsight/scoring'),
      require.resolve('../../tbinsight/pipeline'),
      require.resolve('../../tbinsight/modelEvaluation'),
    ];
    const previousModules = new Map(modulePaths.map(path => [path, require.cache[path]]));
    let savedMetrics;
    let savedConfig;

    installMockModule(modulePaths[0], {
      query: async sql => {
        if (sql.includes('FROM tb_cases')) {
          return { rows: [
            { barangay_name: 'Dela Paz', month: '2025-11-01', case_count: 120 },
            { barangay_name: 'Dela Paz', month: '2025-12-01', case_count: 105 },
          ] };
        }
        if (sql.includes('SELECT name, population FROM barangays')) {
          return { rows: [{ name: 'Dela Paz', population: 50000 }] };
        }
        if (sql.includes('SELECT name FROM barangays')) {
          return { rows: [{ name: 'Dela Paz' }] };
        }
        if (sql.includes('INSERT INTO model_metadata')) {
          savedMetrics = JSON.parse(sqlValues[3]);
          savedConfig = JSON.parse(sqlValues[4]);
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    });
    let sqlValues;
    const database = require.cache[modulePaths[0]].exports;
    const query = database.query;
    database.query = async (sql, values) => {
      sqlValues = values;
      return query(sql, values);
    };
    installMockModule(modulePaths[1], {
      thresholds: async () => ({ low_max: 1, med_max: 2 }),
      evaluate: async () => ({
        model_version: 'arima-v1.0-rf-v1.0',
        arima: {
          mae: 4.6,
          mape: 8.2,
          n_steps: 1,
          method_counts: { arima: 1 },
          example_barangay: 'Dela Paz',
          steps: [{ test_month: 2, actual: 105, predicted: 100, error: 5, method: 'arima' }],
          per_barangay: [{
            barangay_name: 'Dela Paz', mae: 5, mape: 4.76, n_steps: 1, method_counts: { arima: 1 },
            steps: [{ train_size: 1, test_month: 2, actual: 105, predicted: 100, error: 5, baseline: 98, method: 'arima' }],
          }],
        },
        rf: { accuracy: 0.8, steps: [{ large: 'detail intentionally not persisted' }] },
      }),
    });
    installMockModule(modulePaths[2], { getPopulationMap: async () => ({ 'Dela Paz': 50000 }) });
    installMockModule(modulePaths[3], { monthKey: value => String(value).slice(0, 7) + '-01' });
    installMockModule(modulePaths[4], {
      _buildTrainingRows: async rows => {
        assert.strictEqual(rows.length, 2);
        return [{ month: '2025-11-01' }];
      },
      dropUnfinishedMonth: rows => rows,
      buildDenseSeries: () => ({
        calendar: ['2025-11-01', '2025-12-01'],
        seriesByBarangay: { 'Dela Paz': [{ month: '2025-11-01' }, { month: '2025-12-01' }] },
      }),
    });

    try {
      const { runModelEvaluation, getModelEvaluationStatus } = require('../../tbinsight/modelEvaluation');
      const result = await runModelEvaluation();

      assert.strictEqual(result.arima.steps[0].month, '2025-12-01');
      assert.strictEqual(savedMetrics.arima.mae, 4.6);
      assert.strictEqual(savedMetrics.arima.steps[0].month, '2025-12-01');
      assert.strictEqual(savedMetrics.arima.example_barangay, 'Dela Paz');
      assert.strictEqual(savedMetrics.rf.steps, undefined);
      // Each barangay's own result is saved with dated months (compact: no train size / error), so the
      // Forecasting page can filter by barangay or year without rerunning anything.
      assert.strictEqual(savedMetrics.arima.per_barangay.length, 1);
      assert.strictEqual(savedMetrics.arima.per_barangay[0].barangay_name, 'Dela Paz');
      assert.strictEqual(savedMetrics.arima.per_barangay[0].mae, 5);
      assert.deepStrictEqual(savedMetrics.arima.per_barangay[0].steps, [
        { month: '2025-12-01', actual: 105, predicted: 100, baseline: 98, method: 'arima' },
      ]);
      assert.strictEqual(savedConfig.method, 'ARIMA');
      assert.strictEqual(savedConfig.evaluation_start, '2025-12-01');
      assert.strictEqual(savedConfig.evaluation_end, '2025-12-01');
      assert.strictEqual(savedConfig.evaluated_months, 1);
      assert.strictEqual(getModelEvaluationStatus().running, false);
    } finally {
      for (const path of modulePaths) {
        if (previousModules.get(path)) require.cache[path] = previousModules.get(path);
        else delete require.cache[path];
      }
    }
  });

  it('saves the failed attempt without replacing the previous successful evaluation', async () => {
    const dbPath = require.resolve('../../db');
    const evaluationPath = require.resolve('../../tbinsight/modelEvaluation');
    const previousDb = require.cache[dbPath];
    const previousEvaluation = require.cache[evaluationPath];
    let failureValues;
    installMockModule(dbPath, {
      query: async (sql, values) => {
        if (sql.includes('FROM tb_cases')) return { rows: [] };
        if (sql.includes('INSERT INTO model_metadata')) {
          failureValues = values;
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    });
    delete require.cache[evaluationPath];
    try {
      const { runModelEvaluation, getModelEvaluationStatus } = require('../../tbinsight/modelEvaluation');
      await assert.rejects(runModelEvaluation(), /No historical data available/);
      assert.strictEqual(failureValues[0], 'evaluation_failed');
      assert.match(getModelEvaluationStatus().failedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.match(getModelEvaluationStatus().lastError, /No historical data available/);
    } finally {
      if (previousDb) require.cache[dbPath] = previousDb;
      else delete require.cache[dbPath];
      if (previousEvaluation) require.cache[evaluationPath] = previousEvaluation;
      else delete require.cache[evaluationPath];
    }
  });
});
