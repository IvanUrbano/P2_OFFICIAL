import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riskWindowLabel } from '../src/utils/riskWindow.js';

test('names the 6 months a risk level covers', () => {
  assert.equal(riskWindowLabel('2026-01-01'), 'Jan – Jun 2026');
  assert.equal(riskWindowLabel('2026-10-01T00:00:00.000Z'), 'Oct 2026 – Mar 2027');
  assert.equal(riskWindowLabel(''), null);
  assert.equal(riskWindowLabel('not a date'), null);
});
