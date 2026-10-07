import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecordKpis } from '../src/utils/recordKpis.js';

// Live figures (16,148 records; 13,158 with a final outcome).
const summary = {
  total_cases: 16148, on_treatment_count: 2774, diagnosed_count: 182, diagnosed_overdue_count: 175,
  died_count: 255, ltfu_count: 1021, total_outcomes: 13158,
};
const tsr = { successRate: 81.2, cohortYear: 2025, cohortTotal: 4281 };

test('rates use evaluated terminal outcomes as the base, not every record', () => {
  const k = buildRecordKpis(summary, tsr);
  assert.equal(k.fatalityRate, 1.9);   // 255 / 13,158 — the card used to show 1.6% (255 / 16,148)
  assert.equal(k.ltfuRate, 7.8);       // 1,021 / 13,158 — the card used to show 6.3%
  assert.equal(k.evaluated, 13158);
});

test('on treatment share and the success rate come through unchanged', () => {
  const k = buildRecordKpis(summary, tsr);
  assert.equal(k.onTreatment, 2774);
  assert.equal(k.onTreatmentShare, 17.2);
  assert.equal(k.successRate, 81.2);
  assert.equal(k.cohortYear, 2025);
  assert.equal(k.cohortTotal, 4281);
});

test('diagnosed records without a treatment start are counted, with the overdue ones', () => {
  const k = buildRecordKpis(summary, tsr);
  assert.equal(k.diagnosed, 182);
  assert.equal(k.diagnosedOverdue, 175);
});

test('an empty base gives null (never 0%), including no cohort', () => {
  const k = buildRecordKpis({ total_cases: 40, on_treatment_count: 40, total_outcomes: 0, died_count: 0, ltfu_count: 0 }, { successRate: null, cohortYear: 2025, cohortTotal: 0 });
  assert.equal(k.fatalityRate, null);
  assert.equal(k.ltfuRate, null);
  assert.equal(k.successRate, null);
});

test('no data at all is safe', () => {
  const k = buildRecordKpis(null, null);
  assert.equal(k.total, 0);
  assert.equal(k.onTreatmentShare, null);
  assert.equal(k.fatalityRate, null);
  assert.equal(k.successRate, null);
});
