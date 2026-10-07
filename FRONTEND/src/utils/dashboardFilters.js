// Dashboard filters: which views the page recommends, and how a chosen view scopes the data.
//
// A filter is a year and/or a group of barangays. Recommendations are computed from the
// data already on the page (monthly cases, the Random Forest risk classes, the forecast),
// so every suggestion can be applied and always matches at least one barangay. Nothing
// here classifies risk: "High risk" is read straight from the persisted RF class.

const norm = (s) => String(s ?? '').trim().toLowerCase();

// 'YYYY-MM-DD' (or ISO) -> months since year 0, so month arithmetic survives year changes
const monthIndex = (iso) => {
  const s = String(iso ?? '');
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  return Number.isFinite(y) && Number.isFinite(m) && m >= 1 ? y * 12 + (m - 1) : null;
};

const RISING_MIN_INCREASE = 2;      // at least this many more cases than the previous 3 months
const FORECAST_MIN_RATIO = 1.2;     // forecast at least 20% above the recent monthly average
const TOP_BURDEN_COUNT = 5;

/** Years that have case data, newest first. */
export function dataYears(monthly) {
  return [...new Set((monthly || []).map((r) => String(r.month ?? '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))]
    .sort()
    .reverse();
}

/** Barangay names that exist anywhere in the data, A-Z. */
export function barangayNames(monthly, risk) {
  const seen = new Map();
  [...(monthly || []).map((r) => r.barangay_name), ...(risk || []).map((r) => r.name)]
    .filter(Boolean)
    .forEach((n) => { if (!seen.has(norm(n))) seen.set(norm(n), String(n).trim()); });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Rows whose barangay is in `names` (all rows when no scope). Comparison ignores case/spacing. */
export function scopeByBarangay(rows, names, key = 'barangay_name') {
  if (!names || names.length === 0) return rows;
  const set = new Set(names.map(norm));
  return rows.filter((r) => set.has(norm(r[key])));
}

/** Monthly case rows for a year and/or barangay group. */
export function scopeMonthly(monthly, { year = '', barangays = null } = {}) {
  const byBarangay = scopeByBarangay(monthly, barangays);
  return year ? byBarangay.filter((r) => String(r.month ?? '').startsWith(year)) : byBarangay;
}

/** Query string for the dashboard endpoints that take a year and one or more barangays. */
export function filterQuery({ year = '', barangays = null } = {}, { withBarangays = true } = {}) {
  const q = new URLSearchParams();
  if (year) q.set('year', year);
  if (withBarangays && barangays) barangays.forEach((b) => q.append('barangay', b));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * The views the page recommends right now.
 * Each: { key, kind: 'group'|'year', label, figure, unit, hint, barangays?, year?, count }
 * `count` is how many barangays (or 1 for a year) it selects; 0 means "nothing to recommend".
 */
export function recommendFilters({ monthly = [], risk = [], forecasts = [] } = {}) {
  // Canonical spelling = the one used in the case data, which is what the server filters on.
  const canon = new Map();
  monthly.forEach((r) => { if (r.barangay_name && !canon.has(norm(r.barangay_name))) canon.set(norm(r.barangay_name), String(r.barangay_name).trim()); });
  const toCanon = (n) => canon.get(norm(n)) || String(n).trim();

  // per barangay, per month index
  const perMonth = new Map();   // canon name -> Map(monthIndex -> cases)
  const totals = new Map();     // canon name -> all-time cases
  let latest = null;
  monthly.forEach((r) => {
    const name = toCanon(r.barangay_name);
    const idx = monthIndex(r.month);
    if (!r.barangay_name || idx == null) return;
    const n = Number(r.case_count || 0);
    if (!perMonth.has(name)) perMonth.set(name, new Map());
    perMonth.get(name).set(idx, (perMonth.get(name).get(idx) || 0) + n);
    totals.set(name, (totals.get(name) || 0) + n);
    if (latest == null || idx > latest) latest = idx;
  });
  const sumMonths = (name, from, to) => {
    const m = perMonth.get(name);
    let s = 0;
    for (let i = from; i <= to; i += 1) s += m?.get(i) || 0;
    return s;
  };

  // 1. Barangays the risk model currently rates High
  const high = [...new Set(risk.filter((r) => norm(r.risk_class) === 'high').map((r) => toCanon(r.name)))];

  // 2. More cases in the last 3 calendar months than in the 3 before
  const rising = [];
  if (latest != null) {
    for (const name of perMonth.keys()) {
      const recent = sumMonths(name, latest - 2, latest);
      const before = sumMonths(name, latest - 5, latest - 3);
      if (recent - before >= RISING_MIN_INCREASE) rising.push(name);
    }
  }

  // 3. Forecast for the next period is well above the recent monthly average
  const forecastRows = forecasts.filter((r) => r.period && r.method !== 'insufficient_data');
  const nextPeriod = forecastRows.reduce((max, r) => (r.period > max ? r.period : max), '');
  const expected = [];
  if (nextPeriod && latest != null) {
    forecastRows.filter((r) => r.period === nextPeriod).forEach((r) => {
      const name = toCanon(r.barangay_name);
      const avg = sumMonths(name, latest - 2, latest) / 3;
      const f = Number(r.forecasted_count || 0);
      if (f - avg >= 1 && f >= avg * FORECAST_MIN_RATIO) expected.push(name);
    });
  }

  // 4. Where most cases have been recorded
  const burden = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_BURDEN_COUNT).map(([n]) => n);

  // 5. The latest year with data
  const years = dataYears(monthly);

  const periodLabel = nextPeriod
    ? new Date(nextPeriod).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  const group = (key, label, names, unit, hint) => ({
    key, kind: 'group', label, barangays: [...new Set(names)], count: new Set(names).size,
    figure: new Set(names).size, unit, hint,
  });

  return [
    group('high_risk', 'High-risk barangays', high, high.length === 1 ? 'barangay' : 'barangays',
      'Rated High by the risk model in the latest assessment.'),
    group('rising', 'Rising cases', rising, rising.length === 1 ? 'barangay' : 'barangays',
      'More cases in the last 3 months than in the 3 months before.'),
    group('forecast_up', 'Expected to rise', expected, expected.length === 1 ? 'barangay' : 'barangays',
      periodLabel ? `Forecast for ${periodLabel} is 20% or more above the recent monthly average.` : 'No forecast available.'),
    group('top_burden', 'Highest case burden', burden, burden.length === 1 ? 'barangay' : 'barangays',
      `Top ${TOP_BURDEN_COUNT} barangays by cases recorded.`),
    {
      key: 'latest_year', kind: 'year', label: 'Latest year', year: years[0] || '',
      count: years[0] ? 1 : 0, figure: years[0] || '—', unit: 'diagnoses',
      hint: years[0] ? `Cases diagnosed in ${years[0]} only.` : 'No dated cases yet.',
    },
  ];
}
