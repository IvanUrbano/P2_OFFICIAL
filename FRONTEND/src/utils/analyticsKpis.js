// KPI helpers for the Analytics page.
//
// Incidence per 100,000 must divide one year's cases by THAT SAME year's population. With a year
// selected that is straightforward; on "All Years" it used to be N/A, which left the card empty on
// first load. It now reports the latest COMPLETE calendar year (all 12 months have data), labelled
// with that year, so the figure is never a partial year's count over a full year's population.

// Same year/month reading as the rest of the page: the local calendar date of the diagnosis.
const yearOf = (d) => new Date(d).getFullYear();
const monthOf = (d) => new Date(d).getMonth();

/** Latest calendar year in which all 12 months have at least one diagnosis; '' if none. */
export function latestCompleteYear(cases) {
  const months = new Map();
  (cases || []).forEach((c) => {
    if (!c.date_of_diagnosis) return;
    const y = yearOf(c.date_of_diagnosis);
    if (!Number.isInteger(y)) return;
    if (!months.has(y)) months.set(y, new Set());
    months.get(y).add(monthOf(c.date_of_diagnosis));
  });
  const full = [...months.entries()].filter(([, m]) => m.size === 12).map(([y]) => y);
  return full.length ? String(Math.max(...full)) : '';
}

/**
 * Cases per 100,000 for one year. `cases` are already filtered by everything except year.
 * `populationMap` is { barangay: population } for that year; a barangay filter uses that barangay's
 * population, otherwise the city total. Null (never 0) when there is no year or no population.
 */
export function incidencePer100k(cases, year, populationMap, barangay = '') {
  if (!year) return null;
  const population = barangay
    ? (populationMap?.[barangay] ?? null)
    : Object.values(populationMap || {}).reduce((s, v) => s + v, 0) || null;
  if (!(population > 0)) return null;
  const n = (cases || []).filter((c) => c.date_of_diagnosis && yearOf(c.date_of_diagnosis) === Number(year)).length;
  return Math.round((n / population) * 100000 * 10) / 10;
}
