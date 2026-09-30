/**
 * TB Cases Trend — YoY comparison logic (pure, no React).
 *
 * Single source of truth for how the Analytics trend chart builds its
 * current-year series, its previous-year comparison series, and how the
 * two are merged. Extracted so both series share ONE non-year filter
 * predicate (never "filtered current year vs unfiltered previous year")
 * and so the logic is testable outside the component tree.
 *
 * Key rules:
 *  - Both series are built from the FULL case list (all years); the year
 *    split happens AFTER the shared non-year filters are applied.
 *  - A previous-year comparison is only offered when the previous year has
 *    real coverage (>= COMPLETE_YEAR_THRESHOLD distinct months under the
 *    same non-year filters). Incomplete years (e.g. a single stray 2022
 *    record) yield `available: false` — never twelve fabricated zeros.
 *  - When available, a month with no previous-year records is a GENUINE
 *    zero and is rendered as 0. Unavailable comparisons never emit a
 *    `Previous Year (...)` key at all.
 */

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Same threshold the YoY table uses: a year is complete at >=3 distinct months. */
const COMPLETE_YEAR_THRESHOLD = 3;

/**
 * Categorize an age value into a display group.
 * Moved verbatim from Analytics.jsx so filters, charts, and the trend
 * comparison all agree on the same buckets.
 */
export function categorizeAge(age) {
  const n = Number(age);
  if (isNaN(n) || n < 0) return 'Unknown';
  if (n <= 14) return '0-14';
  if (n <= 24) return '15-24';
  if (n <= 34) return '25-34';
  if (n <= 44) return '35-44';
  if (n <= 54) return '45-54';
  if (n <= 64) return '55-64';
  return '65+';
}

/**
 * Parse a case date value. Returns a valid Date or null.
 * Keeps the exact semantics the page already used (`new Date(v)` + isNaN)
 * — verified against the API wire format (ISO instant strings) and SQL.
 */
export function parseCaseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * The ONE non-year filter predicate, applied identically to the selected
 * year and the previous year: barangay, facility, outcome, sex, age group,
 * bacteriological status. (Year/month are handled separately by callers.)
 *
 * Sex and bacteriological status use TRIM + case-insensitive EQUALITY —
 * the same semantics as the backend's `TRIM(col) ILIKE $` (no wildcards)
 * and the dropdown values, which come from `SELECT DISTINCT TRIM(col)`.
 * The previous substring (`includes`) check was wrong: it made the "Male"
 * filter match "Female" cases too, because "female" contains "male".
 */
export function matchesNonYearFilters(c, filters = {}) {
  const { barangay, facility, outcome, sex, ageGroup, bacteriological } = filters;
  const eq = (value, needle) => String(value ?? '').trim().toLowerCase() === needle.trim().toLowerCase();
  if (barangay && c.barangay_name !== barangay) return false;
  if (facility && c.screening_facility !== facility && c.treatment_facility !== facility) return false;
  if (sex && !eq(c.sex, sex)) return false;
  if (outcome && (c.outcome_status || '').trim().toUpperCase() !== outcome.trim().toUpperCase()) return false;
  if (bacteriological && !eq(c.bacteriological_status, bacteriological)) return false;
  if (ageGroup && categorizeAge(c.age) !== ageGroup) return false;
  return true;
}

/**
 * Aggregate cases into monthly rows: [{ key: 'YYYY-MM', label: 'Jan 2024', Cases }].
 * Label is derived from the key parts (no Date round-trip) so a UTC-shifted
 * parse can never rename a month.
 */
export function buildMonthlySeries(cases) {
  const byMonth = {};
  for (const c of cases) {
    const d = parseCaseDate(c.date_of_diagnosis);
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth[key] = (byMonth[key] || 0) + 1;
  }
  return Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => {
      const [year, month] = key.split('-').map(Number);
      return {
        key,
        label: `${MONTHS_SHORT[month - 1]} ${year}`,
        Cases: count,
      };
    });
}

/**
 * Build the previous-year comparison series for a selected year.
 *
 * @param {object} opts
 * @param {Array}  opts.allCases - FULL case list (all years), never pre-filtered by year
 * @param {string|number} opts.year - selected year ('' / null → no comparison)
 * @param {string|number} [opts.month] - selected month (applied AFTER coverage check)
 * @param {object} [opts.filters] - non-year filters shared with the current series
 * @returns {{available: boolean, prevYear: string, incompleteMonths: number, reason: string, rows: Array}}
 */
export function buildPreviousYearComparison({ allCases, year, month, filters = {} }) {
  if (!year) {
    return { available: false, prevYear: '', incompleteMonths: 0, reason: 'no-year', rows: [] };
  }
  const prevYear = String(Number(year) - 1);

  // Shared non-year filters only — the year split happens here, and the
  // month filter is deliberately NOT part of the coverage assessment.
  const base = (allCases || []).filter((c) => {
    const d = parseCaseDate(c.date_of_diagnosis);
    if (!d) return false;
    if (d.getFullYear() !== Number(prevYear)) return false;
    return matchesNonYearFilters(c, filters);
  });

  // Coverage = distinct months of the previous year under the same
  // non-year filters (evaluated BEFORE the month filter, so a month
  // selection cannot falsely mark a complete year as incomplete).
  const monthsPresent = new Set();
  for (const c of base) {
    const d = parseCaseDate(c.date_of_diagnosis);
    monthsPresent.add(d.getMonth() + 1);
  }

  if (monthsPresent.size < COMPLETE_YEAR_THRESHOLD) {
    return {
      available: false,
      prevYear,
      incompleteMonths: monthsPresent.size,
      reason: 'incomplete-previous-year',
      rows: [],
    };
  }

  const rows = buildMonthlySeries(
    month ? base.filter((c) => parseCaseDate(c.date_of_diagnosis).getMonth() + 1 === Number(month)) : base
  );
  return { available: true, prevYear, incompleteMonths: monthsPresent.size, reason: null, rows };
}

/**
 * Merge the previous-year rows into the current-year rows for charting.
 *
 * - Unavailable comparison → current rows returned untouched (no
 *   `Previous Year (...)` key exists, so no line, legend, or tooltip row
 *   is rendered — never twelve zeros).
 * - Available comparison → each current month gets the corresponding
 *   previous-year month (year key remapped, Jan↔Jan … Dec↔Dec). A month
 *   absent from a complete previous year is a genuine zero → 0.
 *
 * @param {Array} currentRows - rows from buildMonthlySeries for the selected year
 * @param {{available: boolean, prevYear: string, rows: Array}} previous
 * @returns {Array} chart rows: { key, label, Cases, 'Previous Year (YYYY)'? }
 */
export function mergeComparison(currentRows, previous) {
  if (!previous || !previous.available) return currentRows;
  const { prevYear, rows: prevRows } = previous;

  const prevMap = {};
  for (const row of prevRows) {
    // "2023-10" → "2024-10" so Oct aligns with Oct across years.
    const currentYearKey = row.key.replace(/^\d{4}/, String(Number(prevYear) + 1));
    prevMap[currentYearKey] = row;
  }

  const valueKey = `Previous Year (${prevYear})`;
  return currentRows.map((item) => {
    const prevRow = prevMap[item.key];
    return {
      ...item,
      // Explicit presence check: 0 only ever means "that month genuinely
      // had no cases", never "the lookup failed".
      [valueKey]: prevRow !== undefined ? prevRow.Cases : 0,
    };
  });
}

export { COMPLETE_YEAR_THRESHOLD, MONTHS_SHORT };
