import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestCompleteYear, incidencePer100k } from '../src/utils/analyticsKpis.js';

// A case on the 15th of a month, in the given year.
const c = (y, m) => ({ date_of_diagnosis: `${y}-${String(m).padStart(2, '0')}-15` });
const year = (y, months, perMonth = 1) => months.flatMap((m) => Array.from({ length: perMonth }, () => c(y, m)));
const all12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

test('the latest complete year skips a year that is still in progress', () => {
  // Live shape: 2023–2025 run January–December, 2026 stops in September.
  const cases = [...year(2023, all12), ...year(2024, all12), ...year(2025, all12), ...year(2026, all12.slice(0, 9))];
  assert.equal(latestCompleteYear(cases), '2025');
});

test('a year with a missing month is not complete, and an empty list gives no year', () => {
  assert.equal(latestCompleteYear([...year(2024, all12), ...year(2025, all12.filter((m) => m !== 8))]), '2024');
  assert.equal(latestCompleteYear([]), '');
  assert.equal(latestCompleteYear(null), '');
  assert.equal(latestCompleteYear([{ date_of_diagnosis: null }]), '');
});

test('incidence divides that year\'s cases by that year\'s population', () => {
  const cases = [...year(2025, all12, 360), ...year(2024, all12, 5)];   // 4,320 cases in 2025
  const population = { Rosario: 400000, Ugong: 442761 };                // 842,761 city total
  assert.equal(incidencePer100k(cases, '2025', population), 512.6);     // 4,320 / 842,761 x 100,000
});

test('with All Years selected the cases of OTHER years are not counted', () => {
  const cases = [...year(2025, all12, 10), ...year(2023, all12, 100)];
  assert.equal(incidencePer100k(cases, '2025', { A: 1000 }), 12000);
});

test('a barangay filter uses that barangay\'s own population', () => {
  const cases = year(2025, all12, 2).map((x) => ({ ...x, barangay_name: 'Ugong' }));   // 24 cases in Ugong
  assert.equal(incidencePer100k(cases, '2025', { Ugong: 24000, Rosario: 90000 }, 'Ugong'), 100);
});

test('no year or no population gives null, never 0', () => {
  assert.equal(incidencePer100k(year(2025, all12), '', { A: 1000 }), null);
  assert.equal(incidencePer100k(year(2025, all12), '2025', {}), null);
  assert.equal(incidencePer100k(year(2025, all12), '2025', { A: 1000 }, 'Missing'), null);
});
