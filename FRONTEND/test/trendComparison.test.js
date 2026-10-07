/**
 * TB Cases Trend — previous-year comparison regression tests.
 *
 * Pure logic tests for FRONTEND/src/utils/trendComparison.js — no DOM,
 * no network, no database.
 *
 * Run: node --test FRONTEND/test/*.test.js   (or: npm test --prefix FRONTEND)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  categorizeAge,
  matchesNonYearFilters,
  buildMonthlySeries,
  buildCaseTrendComparison,
  buildPreviousYearComparison,
  mergeComparison,
  COMPLETE_YEAR_THRESHOLD,
} from '../src/utils/trendComparison.js';

/* ── Fixture helpers ─────────────────────────────────────────────────── */

/** Build one case record. date = 'YYYY-MM-DD'. */
function mk(date, extra = {}) {
  return {
    date_of_diagnosis: date,
    barangay_name: 'Alpha',
    sex: 'Male',
    age: 30,
    outcome_status: 'CURED',
    screening_facility: 'Clinic A',
    treatment_facility: 'Clinic A',
    bacteriological_status: 'Bacteriologically-confirmed TB',
    ...extra,
  };
}

/** Build cases for a year from a 12-slot monthly count array. */
function yearCases(year, counts, extra = {}) {
  const out = [];
  for (let m = 0; m < 12; m++) {
    const n = counts[m] || 0;
    const mm = String(m + 1).padStart(2, '0');
    for (let i = 0; i < n; i++) {
      out.push(mk(`${year}-${mm}-${String((i % 27) + 1).padStart(2, '0')}`, extra));
    }
  }
  return out;
}

const C2023 = [30, 31, 32, 33, 34, 35, 36, 37, 38, 35, 40, 41]; // Oct = 35, total 422
const C2024 = [40, 41, 42, 43, 44, 45, 46, 47, 48, 41, 50, 51]; // Oct = 41, total 538
const C2025 = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]; // total 186

function fixture() {
  return [
    mk('2022-11-20'), // the lone 2022 record → incomplete year
    ...yearCases(2023, C2023),
    ...yearCases(2024, C2024),
    ...yearCases(2025, C2025),
    // malformed dates must be ignored, never crash or count
    { ...mk('2024-06-15'), date_of_diagnosis: null },
    { ...mk('2024-06-15'), date_of_diagnosis: 'not-a-date' },
    { ...mk('2024-06-15'), date_of_diagnosis: '' },
  ];
}

const sum = (rows, key = 'Cases') => rows.reduce((s, r) => s + (r[key] || 0), 0);
const valueKey = (year) => `Previous Year (${year})`;

describe('buildCaseTrendComparison', () => {
  it('compares the latest partial year with the same months in the prior year', () => {
    const cases = [
      ...yearCases(2025, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
      ...yearCases(2026, [2, 2, 2, 2, 2, 2, 2, 2, 2]),
    ];
    const result = buildCaseTrendComparison(cases);

    assert.equal(result.latestPeriod.year, 2026);
    assert.equal(result.latestPeriod.previousYear, 2025);
    assert.equal(result.latestPeriod.period, 'Jan–Sep');
    assert.equal(result.latestPeriod.coverage, 'Jan–Sep');
    assert.equal(result.latestPeriod.currentPeriodCases, 18);
    assert.equal(result.latestPeriod.previousPeriodCases, 9);
    assert.equal(result.latestPeriod.changePct, 100);
    assert.equal(result.rows.find(row => row.year === 2025).coverage, 'Full Year');
  });

  it('requires matching reported months and describes non-contiguous coverage', () => {
    const cases = [
      ...yearCases(2025, [1, 1, 0, 1]),
      ...yearCases(2026, [2, 2, 0, 2]),
    ];
    const result = buildCaseTrendComparison(cases);

    assert.equal(result.latestPeriod.period, 'Jan–Feb, Apr');
    assert.equal(result.latestPeriod.comparable, true);
    assert.equal(result.latestPeriod.changePct, 100);
    assert.equal(result.rows[0].comparable, false);
  });

  it('does not treat a missing prior-year month as zero cases', () => {
    const cases = [
      ...yearCases(2025, [1, 1]),
      ...yearCases(2026, [2, 2, 2]),
    ];
    const result = buildCaseTrendComparison(cases);

    assert.equal(result.latestPeriod.comparable, false);
    assert.equal(result.latestPeriod.changePct, null);
  });

  it('applies the same non-period filters to every year', () => {
    const cases = [
      ...yearCases(2025, [1], { barangay_name: 'Alpha' }),
      ...yearCases(2025, [0, 1], { barangay_name: 'Beta' }),
      ...yearCases(2026, [2], { barangay_name: 'Alpha' }),
    ];
    const result = buildCaseTrendComparison(cases, { filters: { barangay: 'Alpha' } });

    assert.equal(result.rows.length, 2);
    assert.equal(result.latestPeriod.previousPeriodCases, 1);
    assert.equal(result.latestPeriod.currentPeriodCases, 2);
  });
});

/* ── categorizeAge (moved from Analytics.jsx — parity) ──────────────── */

describe('categorizeAge', () => {
  it('assigns the same buckets the page always used', () => {
    assert.equal(categorizeAge(10), '0-14');
    assert.equal(categorizeAge(14), '0-14');
    assert.equal(categorizeAge(15), '15-24');
    assert.equal(categorizeAge(24), '15-24');
    assert.equal(categorizeAge(25), '25-34');
    assert.equal(categorizeAge(34), '25-34');
    assert.equal(categorizeAge(35), '35-44');
    assert.equal(categorizeAge(45), '45-54');
    assert.equal(categorizeAge(55), '55-64');
    assert.equal(categorizeAge(65), '65+');
    assert.equal(categorizeAge(99), '65+');
    // Parity with the original implementation: Number(null) === 0 → 0-14.
    assert.equal(categorizeAge(null), '0-14');
    assert.equal(categorizeAge('x'), 'Unknown');
    assert.equal(categorizeAge(-1), 'Unknown');
  });
});

/* ── matchesNonYearFilters (the ONE shared predicate) ───────────────── */

describe('matchesNonYearFilters', () => {
  const c = mk('2024-10-01', {
    barangay_name: 'Pinagbuhatan',
    sex: 'Female',
    age: 40,
    outcome_status: ' DIED ',
    screening_facility: 'Clinic A',
    treatment_facility: 'Clinic B',
    bacteriological_status: 'Bacteriologically-confirmed TB',
  });

  it('applies barangay exactly', () => {
    assert.equal(matchesNonYearFilters(c, { barangay: 'Pinagbuhatan' }), true);
    assert.equal(matchesNonYearFilters(c, { barangay: 'Oranbo' }), false);
  });

  it('facility matches screening OR treatment facility', () => {
    assert.equal(matchesNonYearFilters(c, { facility: 'Clinic A' }), true);
    assert.equal(matchesNonYearFilters(c, { facility: 'Clinic B' }), true);
    assert.equal(matchesNonYearFilters(c, { facility: 'Clinic C' }), false);
  });

  it('sex matches by trimmed case-insensitive equality (backend ILIKE parity)', () => {
    assert.equal(matchesNonYearFilters(c, { sex: 'Female' }), true);
    assert.equal(matchesNonYearFilters(c, { sex: 'female' }), true);
    assert.equal(matchesNonYearFilters(c, { sex: ' FEMALE ' }), true);
    // Regression: the old substring check matched "Male" against "Female"
    // because "female" contains "male" — the Male filter returned everything.
    assert.equal(matchesNonYearFilters(c, { sex: 'Male' }), false);
  });

  it('outcome trims and uppercases both sides', () => {
    assert.equal(matchesNonYearFilters(c, { outcome: 'died' }), true);
    assert.equal(matchesNonYearFilters(c, { outcome: 'CURED' }), false);
  });

  it('age group uses categorizeAge', () => {
    assert.equal(matchesNonYearFilters(c, { ageGroup: '35-44' }), true);
    assert.equal(matchesNonYearFilters(c, { ageGroup: '25-34' }), false);
  });

  it('bacteriological status matches by trimmed case-insensitive equality', () => {
    assert.equal(matchesNonYearFilters(c, { bacteriological: 'bacteriologically-confirmed tb' }), true);
    assert.equal(matchesNonYearFilters(c, { bacteriological: 'Bacteriologically-confirmed TB' }), true);
    assert.equal(matchesNonYearFilters(c, { bacteriological: 'Clinically-diagnosed TB' }), false);
  });

  it('empty/absent filters pass everything', () => {
    assert.equal(matchesNonYearFilters(c, {}), true);
    assert.equal(matchesNonYearFilters(c, undefined), true);
    assert.equal(matchesNonYearFilters(c, { barangay: '', sex: '' }), true);
  });

  it('multiple filters must ALL pass (AND)', () => {
    assert.equal(
      matchesNonYearFilters(c, { barangay: 'Pinagbuhatan', sex: 'Female', outcome: 'DIED' }),
      true
    );
    assert.equal(
      matchesNonYearFilters(c, { barangay: 'Pinagbuhatan', sex: 'Male', outcome: 'DIED' }),
      false
    );
  });
});

/* ── buildMonthlySeries ─────────────────────────────────────────────── */

describe('buildMonthlySeries', () => {
  it('aggregates by month with Jan-style labels and correct keys', () => {
    const rows = buildMonthlySeries([
      mk('2024-01-05'),
      mk('2024-01-20'),
      mk('2024-10-01'),
      mk('2024-12-31'),
    ]);
    assert.deepEqual(rows.map((r) => r.key), ['2024-01', '2024-10', '2024-12']);
    assert.equal(rows[0].label, 'Jan 2024');
    assert.equal(rows[1].label, 'Oct 2024');
    assert.equal(rows[0].Cases, 2);
    assert.equal(rows[1].Cases, 1);
    assert.equal(rows[2].Cases, 1);
  });

  it('skips null and invalid dates instead of counting or throwing', () => {
    const rows = buildMonthlySeries([
      mk('2024-05-10'),
      { ...mk('x'), date_of_diagnosis: null },
      { ...mk('x'), date_of_diagnosis: 'garbage' },
      { ...mk('x'), date_of_diagnosis: '' },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, '2024-05');
    assert.equal(rows[0].Cases, 1);
  });

  it('an empty input produces an empty series (no fabricated months)', () => {
    assert.deepEqual(buildMonthlySeries([]), []);
  });
});

/* ── buildPreviousYearComparison + mergeComparison ──────────────────── */

describe('YoY comparison — Year 2025 vs 2024', () => {
  const all = fixture();

  it('produces the REAL previous-year (2024) monthly counts', () => {
    const prev = buildPreviousYearComparison({ allCases: all, year: '2025' });
    assert.equal(prev.available, true);
    assert.equal(prev.prevYear, '2024');
    assert.equal(prev.rows.length, 12);
    assert.equal(sum(prev.rows), 538);
    const oct = prev.rows.find((r) => r.key === '2024-10');
    assert.equal(oct.Cases, 41);
  });

  it('merges onto 2025 months as Previous Year (2024) with real values', () => {
    const current = buildMonthlySeries(all.filter((c) => c.date_of_diagnosis?.startsWith('2025')));
    const prev = buildPreviousYearComparison({ allCases: all, year: '2025' });
    const merged = mergeComparison(current, prev);
    assert.equal(merged.length, 12);
    assert.equal(merged[0][valueKey(2024)], 40); // Jan 2024
    assert.equal(merged[9][valueKey(2024)], 41); // Oct 2024
    assert.equal(sum(merged, valueKey(2024)), 538);
    assert.equal(sum(merged, 'Cases'), 186);
  });
});

describe('YoY comparison — Year 2024 vs 2023 (the broken scenario)', () => {
  const all = fixture();

  it('produces the REAL previous-year (2023) monthly counts, not zeros', () => {
    const prev = buildPreviousYearComparison({ allCases: all, year: '2024' });
    assert.equal(prev.available, true);
    assert.equal(prev.prevYear, '2023');
    assert.equal(sum(prev.rows), 422);
    const oct = prev.rows.find((r) => r.key === '2023-10');
    assert.equal(oct.Cases, 35);
  });

  it('tooltip path: Oct 2024 row carries Previous Year (2023) = 35 (non-zero)', () => {
    const current = buildMonthlySeries(all.filter((c) => c.date_of_diagnosis?.startsWith('2024')));
    const prev = buildPreviousYearComparison({ allCases: all, year: '2024' });
    const merged = mergeComparison(current, prev);
    const oct = merged.find((r) => r.key === '2024-10');
    assert.ok(oct, 'Oct 2024 row must exist');
    assert.equal(oct.Cases, 41);
    assert.equal(oct[valueKey(2023)], 35);
    assert.notEqual(oct[valueKey(2023)], 0);
  });

  it('every merged month carries a real previous-year value', () => {
    const current = buildMonthlySeries(all.filter((c) => c.date_of_diagnosis?.startsWith('2024')));
    const prev = buildPreviousYearComparison({ allCases: all, year: '2024' });
    const merged = mergeComparison(current, prev);
    for (const row of merged) {
      const v = row[valueKey(2023)];
      assert.ok(typeof v === 'number', `${row.key} missing previous-year value`);
      assert.ok(v > 0, `${row.key} previous-year value is ${v}, expected > 0`);
    }
  });

  it('annual totals reconcile: Σ months = yearly totals (422 / 538)', () => {
    const current = buildMonthlySeries(all.filter((c) => c.date_of_diagnosis?.startsWith('2024')));
    const prev = buildPreviousYearComparison({ allCases: all, year: '2024' });
    assert.equal(sum(current), 538);
    assert.equal(sum(prev.rows), 422);
  });
});

describe('YoY comparison — Year 2023 vs incomplete 2022', () => {
  const all = fixture();

  it('marks the comparison unavailable (2022 has only 1 distinct month)', () => {
    const prev = buildPreviousYearComparison({ allCases: all, year: '2023' });
    assert.equal(prev.available, false);
    assert.equal(prev.reason, 'incomplete-previous-year');
    assert.equal(prev.prevYear, '2022');
    assert.equal(prev.incompleteMonths, 1);
    assert.ok(1 < COMPLETE_YEAR_THRESHOLD);
    assert.deepEqual(prev.rows, []);
  });

  it('merge emits NO previous-year key — twelve zeros are never fabricated', () => {
    const current = buildMonthlySeries(all.filter((c) => c.date_of_diagnosis?.startsWith('2023')));
    const prev = buildPreviousYearComparison({ allCases: all, year: '2023' });
    const merged = mergeComparison(current, prev);
    assert.equal(merged.length, 12);
    for (const row of merged) {
      const keys = Object.keys(row).filter((k) => k.startsWith('Previous Year'));
      assert.deepEqual(keys, [], `${row.key} must not carry a previous-year value`);
    }
    assert.equal(merged[0].Cases, 30); // current series untouched
  });

  it('uses the same >=3-month completeness threshold as the YoY table', () => {
    assert.equal(COMPLETE_YEAR_THRESHOLD, 3);
    // previous year = 2022 when selected year is 2023:
    // exactly 3 distinct months → complete; only 1 → incomplete
    const three = [...yearCases(2022, [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]), mk('2022-01-05')];
    const two = yearCases(2022, [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(buildPreviousYearComparison({ allCases: three, year: '2023' }).available, true);
    assert.equal(buildPreviousYearComparison({ allCases: two, year: '2023' }).available, false);
  });
});

describe('YoY comparison — All Years', () => {
  const all = fixture();

  it('reports no-year so no comparison UI can appear', () => {
    const prev = buildPreviousYearComparison({ allCases: all, year: '' });
    assert.equal(prev.available, false);
    assert.equal(prev.reason, 'no-year');
    assert.deepEqual(prev.rows, []);
  });

  it('merge leaves current rows completely untouched (no Previous Year key)', () => {
    const current = buildMonthlySeries(all);
    const prev = buildPreviousYearComparison({ allCases: all, year: '' });
    const merged = mergeComparison(current, prev);
    assert.deepEqual(merged, current);
    for (const row of merged) {
      assert.ok(!Object.keys(row).some((k) => k.startsWith('Previous Year')));
    }
  });
});

describe('YoY comparison — month filter (Year 2024, Month 10)', () => {
  const all = fixture();

  it('coverage is assessed BEFORE the month filter (2023 is complete)', () => {
    const prev = buildPreviousYearComparison({ allCases: all, year: '2024', month: '10' });
    assert.equal(prev.available, true);
    assert.equal(prev.rows.length, 1);
    assert.equal(prev.rows[0].key, '2023-10');
    assert.equal(prev.rows[0].Cases, 35);
  });

  it('aligns October 2024 against October 2023', () => {
    const current = buildMonthlySeries(
      all.filter((c) => {
        const d = new Date(c.date_of_diagnosis);
        return !isNaN(d.getTime()) && d.getFullYear() === 2024 && d.getMonth() + 1 === 10;
      })
    );
    assert.equal(current.length, 1);
    assert.equal(current[0].key, '2024-10');
    const prev = buildPreviousYearComparison({ allCases: all, year: '2024', month: '10' });
    const merged = mergeComparison(current, prev);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].key, '2024-10');
    assert.equal(merged[0].Cases, 41);
    assert.equal(merged[0][valueKey(2023)], 35);
  });
});

describe('YoY comparison — non-year filters applied to BOTH years', () => {
  function dualFixture() {
    const out = [];
    // 2023: 7 Alpha (all Female; months Jan-May, Oct, Nov) + 7 Beta (Male; Jan-Jul)
    for (let i = 0; i < 5; i++) out.push(mk(`2023-0${i + 1}-10`, { barangay_name: 'Alpha', sex: 'Female' }));
    out.push(mk('2023-10-11', { barangay_name: 'Alpha', sex: 'Female' }));
    out.push(mk('2023-11-12', { barangay_name: 'Alpha', sex: 'Female' }));
    for (let i = 0; i < 7; i++) out.push(mk(`2023-0${i + 1}-15`, { barangay_name: 'Beta', sex: 'Male' }));
    // 2024: 12 Alpha-Female (one per month) + 3 Alpha-Male (Sep-Nov) + 4 Beta-Male (Jan-Apr)
    for (let i = 0; i < 12; i++) out.push(mk(`2024-${String(i + 1).padStart(2, '0')}-10`, { barangay_name: 'Alpha', sex: 'Female' }));
    ['09', '10', '11'].forEach((m) => out.push(mk(`2024-${m}-11`, { barangay_name: 'Alpha', sex: 'Male' })));
    for (let i = 0; i < 4; i++) out.push(mk(`2024-0${i + 1}-15`, { barangay_name: 'Beta', sex: 'Male' }));
    return out;
  }
  const all = dualFixture();

  it('barangay filter hits 2023 and 2024 equally', () => {
    const currentCases = all.filter(
      (c) => matchesNonYearFilters(c, { barangay: 'Alpha' }) && c.date_of_diagnosis.startsWith('2024')
    );
    const current = buildMonthlySeries(currentCases);
    const prev = buildPreviousYearComparison({ allCases: all, year: '2024', filters: { barangay: 'Alpha' } });
    assert.equal(sum(current), 15); // 12 F + 3 M Alpha in 2024
    assert.equal(sum(prev.rows), 7); // only Alpha in 2023 (Beta excluded)
  });

  it('sex filter hits both years (Female: 7 in 2023, 12 in 2024)', () => {
    const currentCases = all.filter(
      (c) => matchesNonYearFilters(c, { sex: 'Female' }) && c.date_of_diagnosis.startsWith('2024')
    );
    const current = buildMonthlySeries(currentCases);
    const prev = buildPreviousYearComparison({ allCases: all, year: '2024', filters: { sex: 'Female' } });
    assert.equal(sum(current), 12);
    assert.equal(sum(prev.rows), 7);
    // merged values are the FILTERED previous year, never unfiltered
    const merged = mergeComparison(current, prev);
    assert.equal(sum(merged, valueKey(2023)), 7);
    assert.equal(sum(merged, 'Cases'), 12);
  });

  it('sex=Male excludes Female cases in BOTH years (substring-match regression)', () => {
    // The old "female".includes("male") check made Male match everyone:
    // unfiltered totals are 19 (2024) / 14 (2023); Male-only is 7 / 7.
    const currentCases = all.filter(
      (c) => matchesNonYearFilters(c, { sex: 'Male' }) && c.date_of_diagnosis.startsWith('2024')
    );
    const current = buildMonthlySeries(currentCases);
    const prev = buildPreviousYearComparison({ allCases: all, year: '2024', filters: { sex: 'Male' } });
    assert.equal(sum(current), 7); // 3 Alpha-Male + 4 Beta-Male
    assert.equal(sum(prev.rows), 7); // 7 Beta-Male
  });

  it('combined filters (barangay + sex) restrict both years', () => {
    const filters = { barangay: 'Alpha', sex: 'Female' };
    const currentCases = all.filter(
      (c) => matchesNonYearFilters(c, filters) && c.date_of_diagnosis.startsWith('2024')
    );
    const prev = buildPreviousYearComparison({ allCases: all, year: '2024', filters });
    assert.equal(sum(buildMonthlySeries(currentCases)), 12);
    assert.equal(sum(prev.rows), 7);
  });
});

describe('YoY comparison — genuine zero vs unavailable', () => {
  it('a complete previous year missing ONE month yields 0 (genuine zero), not null', () => {
    // 2023 complete but February has zero cases
    const c2023 = [10, 0, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
    const all = [...yearCases(2023, c2023), ...yearCases(2024, C2024)];
    const prev = buildPreviousYearComparison({ allCases: all, year: '2024' });
    assert.equal(prev.available, true);
    const current = buildMonthlySeries(all.filter((c) => c.date_of_diagnosis.startsWith('2024')));
    const merged = mergeComparison(current, prev);
    const feb = merged.find((r) => r.key === '2024-02');
    assert.equal(feb[valueKey(2023)], 0); // genuine zero — key EXISTS with 0
    const jan = merged.find((r) => r.key === '2024-01');
    assert.equal(jan[valueKey(2023)], 10);
  });

  it('unavailable comparison → key absent entirely (tooltip would show nothing, not 0)', () => {
    const all = [...yearCases(2023, C2023), mk('2022-11-20')];
    const prev = buildPreviousYearComparison({ allCases: all, year: '2023' });
    assert.equal(prev.available, false);
    const current = buildMonthlySeries(all.filter((c) => c.date_of_diagnosis.startsWith('2023')));
    const merged = mergeComparison(current, prev);
    assert.ok(merged.every((r) => !('Previous Year (2022)' in r)));
  });

  it('merge is a no-op when the previous object is missing/off', () => {
    const current = buildMonthlySeries(fixture().filter((c) => c.date_of_diagnosis?.startsWith('2024')));
    assert.deepEqual(mergeComparison(current, null), current);
    assert.deepEqual(mergeComparison(current, { available: false }), current);
  });
});
