const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const dbModule = require.resolve('../../db');
require.cache[dbModule] = { id: dbModule, filename: dbModule, loaded: true, exports: {} };
const { LABEL_HORIZON_MONTHS } = require('../../tbinsight/pipeline');

test('RF labels cover the next 6 months', () => {
  assert.equal(LABEL_HORIZON_MONTHS, 6);
});

test('the ML service uses the same label window as the backend', () => {
  // A mismatch lets walk-forward evaluation train on labels that reach into the test month.
  const config = fs.readFileSync(path.join(__dirname, '../../../ML_SERVICE/config.py'), 'utf8');
  const match = config.match(/^RF_LABEL_HORIZON_MONTHS\s*=\s*(\d+)/m);
  assert.ok(match, 'RF_LABEL_HORIZON_MONTHS found in ML_SERVICE/config.py');
  assert.equal(Number(match[1]), LABEL_HORIZON_MONTHS);
});
