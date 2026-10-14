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

test('risk window label names the months a risk level covers', () => {
  const { riskWindowLabel } = require('../../tbinsight/riskWindow');
  assert.equal(riskWindowLabel('2026-01-01'), 'Jan – Jun 2026');
  assert.equal(riskWindowLabel('2026-10-01'), 'Oct 2026 – Mar 2027');
  assert.equal(riskWindowLabel(new Date(Date.UTC(2025, 6, 1))), 'Jul – Dec 2025');
  assert.equal(riskWindowLabel(null), null);
});

test('the frontend uses the same risk window as the backend', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../FRONTEND/src/utils/riskWindow.js'), 'utf8');
  const match = src.match(/RISK_WINDOW_MONTHS\s*=\s*(\d+)/);
  assert.ok(match, 'RISK_WINDOW_MONTHS found in FRONTEND/src/utils/riskWindow.js');
  assert.equal(Number(match[1]), LABEL_HORIZON_MONTHS);
});
