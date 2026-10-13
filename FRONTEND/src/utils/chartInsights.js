/**
 * Template-based, per-chart interpretations (deterministic — no AI model). Each function
 * takes the exact data a chart draws, so the sentence always matches what is shown,
 * including any active filters. Returns null when there isn't enough data to say anything.
 */

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const sum = (arr) => arr.reduce((s, v) => s + v, 0);
const avg = (arr) => (arr.length ? sum(arr) / arr.length : 0);
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Monthly trend: direction over the last few months, peak month, latest month. */
export function trendInsight(points, { valueKey = 'cases', labelKey = 'label', unit = 'cases', window = 3 } = {}) {
  const pts = (points || []).filter((p) => p && p[valueKey] != null);
  if (pts.length < 2) return null;
  const v = (p) => Number(p[valueKey]);
  const last = pts[pts.length - 1];
  const peak = pts.reduce((a, b) => (v(b) > v(a) ? b : a));
  let direction = '';
  if (pts.length >= window * 2) {
    const recent = avg(pts.slice(-window).map(v));
    const before = avg(pts.slice(-window * 2, -window).map(v));
    if (before > 0) {
      const change = Math.round(((recent - before) / before) * 100);
      direction = Math.abs(change) < 5
        ? `Cases were about the same in the last ${window} months as in the ${window} months before. `
        : `The last ${window} months averaged ${Math.abs(change)}% ${change > 0 ? 'more' : 'fewer'} cases than the ${window} months before. `;
    }
  }
  return `${direction}${peak[labelKey]} had the most ${unit} (${fmt(v(peak))}). The latest month, ${last[labelKey]}, had ${fmt(v(last))}.`;
}

/** Ranking (barangays, facilities): highest, lowest, and how concentrated the top 3 are. */
export function rankingInsight(items, { nameKey = 'name', valueKey = 'Cases', noun = 'barangay', unit = 'cases' } = {}) {
  const rows = (items || []).filter((r) => r && Number(r[valueKey]) > 0 && r[nameKey] && r[nameKey] !== 'Unknown');
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]));
  const total = sum(sorted.map((r) => Number(r[valueKey])));
  const top = sorted[0];
  const low = sorted[sorted.length - 1];
  let text = `${top[nameKey]} has the most ${unit}: ${fmt(top[valueKey])} (${pct(top[valueKey], total)}% of those shown).`;
  if (sorted.length > 1) text += ` ${low[nameKey]} has the fewest (${fmt(low[valueKey])}).`;
  if (sorted.length >= 6) {
    const top3 = sum(sorted.slice(0, 3).map((r) => Number(r[valueKey])));
    text += ` The top 3 ${noun === 'barangay' ? 'barangays' : `${noun}s`} account for ${pct(top3, total)}% of all ${unit} shown.`;
  }
  return text;
}

/** Incidence ranking (cases per 100,000) — only when a year with population data is selected. */
export function incidenceInsight(items, { nameKey = 'name', valueKey = 'Incidence' } = {}) {
  const rows = (items || []).filter((r) => r && r[valueKey] != null);
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => b[valueKey] - a[valueKey]);
  return `${sorted[0][nameKey]} has the highest rate (${sorted[0][valueKey]} cases per 100,000 people). ${sorted[sorted.length - 1][nameKey]} has the lowest (${sorted[sorted.length - 1][valueKey]} per 100,000). These rates account for population size.`;
}

/** Share of a total across categories (sex, age group): largest and smallest groups. */
export function shareInsight(items, { nameKey = 'name', valueKey = 'value', noun = 'group', format = (s) => s } = {}) {
  const rows = (items || []).filter((r) => r && Number(r[valueKey]) > 0 && r[nameKey] !== 'Unknown');
  if (rows.length === 0) return null;
  const total = sum(rows.map((r) => Number(r[valueKey])));
  const sorted = [...rows].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]));
  const [first, second] = sorted;
  const label = noun === 'age group' ? `The ${format(first[nameKey])} age group` : format(first[nameKey]);
  let text = `${label} accounts for the largest share: ${fmt(first[valueKey])} cases (${pct(first[valueKey], total)}%).`;
  if (second) text += ` Next is ${format(second[nameKey])} (${pct(second[valueKey], total)}%).`;
  return text;
}

/**
 * Final treatment outcomes only; current case status is a separate measure.
 * `scope` says what the percentages cover (default "recorded outcomes"); `note` adds a closing
 * sentence, e.g. to explain why this differs from the cohort-based Treatment Success Rate.
 */
export function outcomeInsight(items, { nameKey = 'name', valueKey = 'Cases', scope = 'recorded outcomes', note = '' } = {}) {
  const rows = (items || []).filter((r) => r && Number(r[valueKey]) > 0);
  if (rows.length === 0) return null;
  const total = sum(rows.map((r) => Number(r[valueKey])));
  const get = (...names) => sum(rows.filter((r) => names.includes(String(r[nameKey]).toUpperCase())).map((r) => Number(r[valueKey])));
  const top = [...rows].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]))[0];
  const success = get('CURED', 'TREATMENT COMPLETED');
  const ltfu = get('LOST TO FOLLOW-UP');
  let text = `${titleCase(top[nameKey])} is the most common outcome (${pct(top[valueKey], total)}% of ${scope}). `;
  text += `${pct(success, total)}% of ${scope} were cured or completed treatment`;
  if (ltfu) text += `; ${pct(ltfu, total)}% were lost to follow-up`;
  return `${text}.${note ? ` ${note}` : ''}`;
}

/** Risk classification counts. Risk levels are relative (Pasig's barangays ranked by incidence: bottom 40% Low, top third High). */
export function riskInsight(rows, { nameKey = 'name', classKey = 'risk_class' } = {}) {
  const list = (rows || []).filter((r) => r && r[classKey] && String(r[classKey]).toLowerCase() !== 'no data');
  if (list.length === 0) return null;
  const count = (c) => list.filter((r) => String(r[classKey]).toLowerCase() === c).length;
  const high = list.filter((r) => String(r[classKey]).toLowerCase() === 'high').map((r) => r[nameKey]);
  let text = `Among ${list.length} assessed barangays, ${count('high')} are high risk, ${count('medium')} moderate risk, and ${count('low')} low risk.`;
  if (high.length) text += ` High risk includes ${high.slice(0, 4).join(', ')}${high.length > 4 ? ` and ${high.length - 4} more` : ''}.`;
  return `${text} These levels compare barangays within Pasig; they are not official national risk levels.`;
}

/** Case trend: matched-period change and the year with the most reported cases. */
export function caseTrendInsight(rows, latestPeriod) {
  if (!rows || rows.length === 0) return null;
  const peak = rows.reduce((a, b) => (b.cases > a.cases ? b : a));
  let text = '';
  if (latestPeriod && latestPeriod.changePct != null) {
    text = `For ${latestPeriod.period}, ${latestPeriod.year} had ${Math.abs(latestPeriod.changePct)}% ${latestPeriod.changePct >= 0 ? 'more' : 'fewer'} cases than ${latestPeriod.previousYear}. `;
  }
  text += `${peak.year} had the most reported cases (${fmt(peak.cases)} across ${peak.coverage.toLowerCase()}).`;
  return text;
}

/** Forecast chart: projected next period(s) vs the latest actual month. */
export function forecastInsight(points, { actualKey = 'Actual', forecastKey = 'Forecast', labelKey = 'label', methodLabel } = {}) {
  const actual = (points || []).filter((p) => p[actualKey] != null);
  const fc = (points || []).filter((p) => p[forecastKey] != null);
  if (fc.length === 0) return null;
  const lastActual = actual[actual.length - 1];
  const first = fc[0];
  let text = `About ${fmt(first[forecastKey])} cases are projected for ${first[labelKey]}`;
  if (fc.length > 1) text += `, and ${fmt(sum(fc.map((p) => Number(p[forecastKey]))))} across ${fc.length} months through ${fc[fc.length - 1][labelKey]}`;
  if (lastActual && Number(lastActual[actualKey]) > 0) {
    const change = Math.round(((first[forecastKey] - lastActual[actualKey]) / lastActual[actualKey]) * 100);
    text += `, ${Math.abs(change) < 5 ? 'about the same as' : `${Math.abs(change)}% ${change > 0 ? 'above' : 'below'}`} the latest actual month (${lastActual[labelKey]}: ${fmt(lastActual[actualKey])})`;
  }
  text += '.';
  if (methodLabel) text += ` This uses ${methodLabel}.`;
  return `${text} Forecasts are estimates based on past cases.`;
}

/** Month-by-month forecast table: use the underlying period order, not the user's current table sort. */
export function monthByMonthForecastInsight(rows) {
  const periods = [...(rows || [])].sort((a, b) => String(a.period || '').localeCompare(String(b.period || '')));
  if (periods.length === 0) return null;
  const projected = periods.filter((row) => !row.isInsufficient && row.forecasted != null && Number.isFinite(Number(row.forecasted)));
  const unavailable = periods.filter((row) => row.isInsufficient).length;
  if (projected.length === 0) {
    return unavailable ? 'No monthly case estimate is available because there is too little case history for this selection.' : null;
  }

  const peak = projected.reduce((highest, row) => Number(row.forecasted) > Number(highest.forecasted) ? row : highest);
  const values = projected.map((row) => Number(row.forecasted));
  const lowest = Math.min(...values);
  let text = projected.length === 1
    ? `${peak.periodLabel} is projected to have ${fmt(peak.forecasted)} cases.`
    : `Across ${projected.length} forecast months, monthly estimates range from ${fmt(lowest)} to ${fmt(peak.forecasted)} cases. ${peak.periodLabel} has the highest estimate.`;
  const ranged = projected.filter((row) => row.ci_lower != null && row.ci_upper != null && Number(row.ci_lower) <= Number(row.ci_upper));
  if (ranged.length === projected.length) {
    text += ' The 95% ranges show uncertainty; actual case counts may differ.';
  } else if (ranged.length > 0) {
    text += ` A 95% range is available for ${ranged.length} of ${projected.length} months; actual counts may differ.`;
  } else {
    text += ' No 95% range is available, so these estimates should be treated cautiously.';
  }
  if (unavailable > 0) text += ` ${unavailable} ${unavailable === 1 ? 'month has' : 'months have'} no estimate because case history is too short.`;
  return text;
}

/** Actual vs predicted (back-test): typical error size. */
export function accuracyInsight(points, { actualKey = 'Actual', predictedKey = 'Predicted' } = {}) {
  const rows = (points || []).filter((p) => p[actualKey] != null && p[predictedKey] != null);
  if (rows.length < 2) return null;
  const errors = rows.map((p) => Math.abs(p[predictedKey] - p[actualKey]));
  const mae = Math.round(avg(errors) * 10) / 10;
  const withActual = rows.filter((p) => p[actualKey] > 0);
  const mape = withActual.length ? Math.round(avg(withActual.map((p) => Math.abs(p[predictedKey] - p[actualKey]) / p[actualKey])) * 1000) / 10 : null;
  const over = rows.filter((p) => p[predictedKey] > p[actualKey]).length;
  const tendency = over > rows.length * 0.65 ? ' Predictions were usually too high.'
    : over < rows.length * 0.35 ? ' Predictions were usually too low.' : '';
  return `Compared with past months, predictions differed from actual counts by ${fmt(mae)} cases on average${mape != null ? ` (${mape}% of the actual count)` : ''}.${tendency} Smaller differences mean a closer fit.`;
}
