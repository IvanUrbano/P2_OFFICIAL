import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareInsight, rankingInsight, outcomeInsight, riskInsight, trendInsight, forecastInsight, accuracyInsight } from '../src/utils/chartInsights.js';

const today = new Date(2026, 9, 21); // 21 Oct 2026: October is unfinished
const months = (year, counts, from = 1) => counts.map((c, i) => ({ month: `${year}-${String(from + i).padStart(2, '0')}`, cases: c }));
const points = (rows) => rows.map((r) => ({ month: r.month, label: r.month, cases: r.cases }));

test('without older records the interpretations carry no comparison', () => {
  assert.doesNotMatch(shareInsight([{ name: 'Male', value: 6 }, { name: 'Female', value: 4 }], { noun: 'sex' }), /in 20\d\d/);
  assert.doesNotMatch(outcomeInsight([{ name: 'CURED', Cases: 5 }]), /in 20\d\d/);
});

test('trend: a gap beyond counting noise against the same months last year is a real change', () => {
  const history = [...months(2025, [100, 100, 100, 100, 100, 100, 100, 100, 100]), ...months(2026, [100, 100, 100, 100, 100, 100, 130, 130, 130, 40])];
  const text = trendInsight(points(history.filter((r) => r.month >= '2026')), { history, today });
  assert.match(text, /^Jul–Sep 2026 had 390 cases, 30% more than Jul–Sep 2025 \(300\)\./);
  assert.match(text, /real increase/);
  assert.doesNotMatch(text, /Oct/); // the unfinished month is left out
});

test('trend: within noise, a rise that also happened last year is called the usual seasonal pattern', () => {
  const history = [...months(2025, [100, 100, 100, 100, 100, 100, 130, 130, 130]), ...months(2026, [100, 100, 100, 100, 100, 100, 128, 132, 131])];
  const text = trendInsight(points(history.filter((r) => r.month >= '2026')), { history, today });
  assert.match(text, /within normal variation/);
  assert.match(text, /rise from the months before also happened last year, so it is the usual seasonal pattern/);
});

test('trend: no year-earlier months falls back to the latest and busiest month', () => {
  const rows = months(2026, [10, 30, 20]);
  assert.equal(trendInsight(points(rows), { history: rows, today }), '2026-03 had 20 cases; the highest month shown was 2026-02 (30).');
});

test('trend: a report total is checked against the same period a year earlier', () => {
  const text = trendInsight(points(months(2026, [50])), { today, previous: { label: 'January 2025', value: 48 } });
  assert.equal(text, 'This period had 50 cases, 4% more than January 2025 (48), within normal variation.');
});

test('share: names the largest group with its share a year earlier', () => {
  const text = shareInsight([{ name: 'Male', value: 60 }, { name: 'Female', value: 40 }], {
    noun: 'sex', previous: { label: '2025', items: [{ name: 'Male', value: 50 }, { name: 'Female', value: 50 }] },
  });
  assert.equal(text, 'Male patients make up most cases (60%; 50% in 2025).');
});

test('ranking: mentions the earlier leader only when it changed', () => {
  const now = [{ name: 'A', Cases: 30 }, { name: 'B', Cases: 10 }];
  assert.match(rankingInsight(now, { previous: { label: '2025', items: [{ name: 'B', Cases: 20 }, { name: 'A', Cases: 15 }] } }), /In 2025, B had the most \(20\)/);
  assert.doesNotMatch(rankingInsight(now, { previous: { label: '2025', items: [{ name: 'A', Cases: 20 }] } }), /In 2025/);
});

test('outcomes: the cohort success rate is judged against the 85% target', () => {
  const items = [{ name: 'CURED', Cases: 80 }, { name: 'LOST TO FOLLOW-UP', Cases: 20 }];
  assert.match(outcomeInsight(items, { tsr: { rate: '82.5', cohortYear: 2025 } }), /^The 2025 treatment cohort reached 82.5% success, 2.5 points below the 85% target\./);
  assert.match(outcomeInsight(items, { tsr: { rate: 88, cohortYear: 2025 } }), /meeting the 85% target/);
  const text = outcomeInsight(items, { previous: { label: '2025', items: [{ name: 'CURED', Cases: 70 }, { name: 'LOST TO FOLLOW-UP', Cases: 30 }] } });
  assert.match(text, /^80% of recorded outcomes were cured or completed treatment\./);
  assert.match(text, /Loss to follow-up is 20% of recorded outcomes, down from 30% in 2025\./);
});

test('risk: says whether the High barangays are the same as in the previous assessment', () => {
  const now = [{ name: 'A', risk_class: 'High' }, { name: 'B', risk_class: 'Low' }];
  assert.match(riskInsight(now, { previous: { label: '2025', items: [{ name: 'A', risk_class: 'High' }, { name: 'B', risk_class: 'Low' }] } }), /burden stays in the same barangays/);
  assert.match(riskInsight(now, { previous: { label: '2025', items: [{ name: 'A', risk_class: 'Low' }, { name: 'B', risk_class: 'High' }] } }), /None of them was High in the 2025 assessment\./);
  const two = [{ name: 'A', risk_class: 'High' }, { name: 'C', risk_class: 'High' }, { name: 'B', risk_class: 'Low' }];
  assert.match(riskInsight(two, { previous: { label: '2025', items: [{ name: 'A', risk_class: 'High' }] } }), /1 was also High in 2025; newly High: C\./);
  assert.match(riskInsight(now), /^1 of 2 barangays are High risk: A\. Levels rank barangays/);
});

test('forecast: compares the projection with the same months a year earlier', () => {
  const fc = [{ label: 'Sep', Actual: 10 }, { label: 'Oct', Forecast: 12 }, { label: 'Nov', Forecast: 12 }];
  assert.equal(forecastInsight(fc, { previous: { label: 'the same months of 2025', value: 20 } }), 'The model projects about 24 cases for Oct–Nov, 20% more than the same months of 2025 (20).');
  assert.equal(forecastInsight(fc), 'The model projects about 24 cases for Oct–Nov; the latest actual month, Sep, had 10.');
});

test('accuracy: says whether recent months were predicted better than older ones', () => {
  const pts = [10, 10, 10, 10, 10, 10].map((a, i) => ({ label: `M${i + 1}`, Actual: a, Predicted: i < 3 ? a + 4 : a + 1 }));
  assert.match(accuracyInsight(pts), /most recent months were predicted more closely than the older months \(M1 to M3\)/);
});
