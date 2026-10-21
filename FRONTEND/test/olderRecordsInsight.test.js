import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareInsight, rankingInsight, outcomeInsight, riskInsight, trendInsight, forecastInsight, accuracyInsight } from '../src/utils/chartInsights.js';

test('without older records the interpretations carry no comparison', () => {
  assert.doesNotMatch(shareInsight([{ name: 'Male', value: 6 }, { name: 'Female', value: 4 }]), /Compared|In \d{4}/);
  assert.doesNotMatch(outcomeInsight([{ name: 'CURED', Cases: 5 }]), /In 20/);
});

test('share: reports the change in the leading group against the earlier year', () => {
  const text = shareInsight([{ name: 'Male', value: 60 }, { name: 'Female', value: 40 }], {
    noun: 'sex', previous: { label: '2025', items: [{ name: 'Male', value: 50 }, { name: 'Female', value: 50 }] },
  });
  assert.match(text, /also the largest in 2025, when it made up 50%/);
  assert.match(text, /up 10 percentage points/);
});

test('ranking: names the earlier leader and the largest rise and fall', () => {
  const text = rankingInsight([{ name: 'A', Cases: 30 }, { name: 'B', Cases: 10 }], {
    previous: { label: '2025', items: [{ name: 'B', Cases: 20 }, { name: 'A', Cases: 15 }] },
  });
  assert.match(text, /In 2025, B had the most cases \(20\)/);
  assert.match(text, /largest increase since 2025 is in A \(\+15\)/);
  assert.match(text, /largest decrease is in B/);
});

test('outcomes: compares success and loss to follow-up with the earlier year', () => {
  const text = outcomeInsight([{ name: 'CURED', Cases: 80 }, { name: 'LOST TO FOLLOW-UP', Cases: 20 }], {
    previous: { label: '2025', items: [{ name: 'CURED', Cases: 70 }, { name: 'LOST TO FOLLOW-UP', Cases: 30 }] },
  });
  assert.match(text, /In 2025, 70% were cured or completed treatment/);
  assert.match(text, /Loss to follow-up went from 30% to 20% \(better\)/);
});

test('risk: lists barangays that became or stopped being high risk', () => {
  const text = riskInsight([{ name: 'A', risk_class: 'High' }, { name: 'B', risk_class: 'Low' }], {
    previous: { label: '2025', items: [{ name: 'A', risk_class: 'Low' }, { name: 'B', risk_class: 'High' }] },
  });
  assert.match(text, /Newly high risk: A/);
  assert.match(text, /No longer high risk: B/);
});

test('trend and forecast: compare totals with the earlier period, never with a missing one', () => {
  const pts = [1, 2, 3, 4].map((i) => ({ label: `M${i}`, cases: 10 }));
  assert.match(trendInsight(pts, { previous: { label: '2025', value: 20 } }), /Compared with 2025, cases are 100% higher \(20 → 40\)/);
  assert.doesNotMatch(trendInsight(pts, { previous: { label: '2025', value: null } }), /Compared with/);
  const fc = [{ label: 'Oct', Actual: 10 }, { label: 'Nov', Forecast: 12 }];
  assert.match(forecastInsight(fc, { previous: { label: 'the same months a year earlier', value: 8 } }), /Compared with the same months a year earlier, the projected cases are 50% higher/);
});

test('accuracy: says whether recent months were predicted better than older ones', () => {
  const pts = [10, 10, 10, 10, 10, 10].map((a, i) => ({ label: `M${i + 1}`, Actual: a, Predicted: i < 3 ? a + 4 : a + 1 }));
  assert.match(accuracyInsight(pts), /most recent months were predicted more closely than the older months \(M1 to M3\)/);
});
