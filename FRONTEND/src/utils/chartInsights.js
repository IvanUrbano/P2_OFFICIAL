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
        ? `Cases have been stable over the last ${window} months. `
        : `Cases are ${change > 0 ? 'rising' : 'falling'}: the last ${window} months averaged ${Math.abs(change)}% ${change > 0 ? 'more' : 'fewer'} than the ${window} months before. `;
    }
  }
  return `${direction}The highest month was ${peak[labelKey]} (${fmt(v(peak))} ${unit}); the latest month, ${last[labelKey]}, had ${fmt(v(last))}.`;
}

/** Ranking (barangays, facilities): highest, lowest, and how concentrated the top 3 are. */
export function rankingInsight(items, { nameKey = 'name', valueKey = 'Cases', noun = 'barangay', unit = 'cases' } = {}) {
  const rows = (items || []).filter((r) => r && Number(r[valueKey]) > 0 && r[nameKey] && r[nameKey] !== 'Unknown');
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]));
  const total = sum(sorted.map((r) => Number(r[valueKey])));
  const top = sorted[0];
  const low = sorted[sorted.length - 1];
  let text = `${top[nameKey]} has the most ${unit} (${fmt(top[valueKey])}, ${pct(top[valueKey], total)}% of the total)`;
  text += sorted.length > 1 ? `; ${low[nameKey]} has the fewest (${fmt(low[valueKey])}).` : '.';
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
  return `Adjusted for population, ${sorted[0][nameKey]} has the highest incidence (${sorted[0][valueKey]} per 100,000) and ${sorted[sorted.length - 1][nameKey]} the lowest (${sorted[sorted.length - 1][valueKey]} per 100,000).`;
}

/** Share of a total across categories (sex, age group): largest and smallest groups. */
export function shareInsight(items, { nameKey = 'name', valueKey = 'value', noun = 'group', format = (s) => s } = {}) {
  const rows = (items || []).filter((r) => r && Number(r[valueKey]) > 0 && r[nameKey] !== 'Unknown');
  if (rows.length === 0) return null;
  const total = sum(rows.map((r) => Number(r[valueKey])));
  const sorted = [...rows].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]));
  const [first, second] = sorted;
  const subject = noun === 'sex' ? `${format(first[nameKey])} patients make up`
    : noun === 'age group' ? `The ${format(first[nameKey])} age group has`
      : `${format(first[nameKey])} has`;
  let text = `${subject} the largest share (${pct(first[valueKey], total)}%, ${fmt(first[valueKey])} cases)`;
  if (second) text += `, followed by ${format(second[nameKey])} (${pct(second[valueKey], total)}%)`;
  if (sorted.length > 2) {
    const last = sorted[sorted.length - 1];
    text += `. The smallest ${noun} is ${format(last[nameKey])} (${pct(last[valueKey], total)}%)`;
  }
  return `${text}.`;
}

/** Final treatment outcomes only; current case status is a separate measure. */
export function outcomeInsight(items, { nameKey = 'name', valueKey = 'Cases' } = {}) {
  const rows = (items || []).filter((r) => r && Number(r[valueKey]) > 0);
  if (rows.length === 0) return null;
  const total = sum(rows.map((r) => Number(r[valueKey])));
  const get = (...names) => sum(rows.filter((r) => names.includes(String(r[nameKey]).toUpperCase())).map((r) => Number(r[valueKey])));
  const top = [...rows].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]))[0];
  const success = get('CURED', 'TREATMENT COMPLETED');
  const ltfu = get('LOST TO FOLLOW-UP');
  let text = `${titleCase(top[nameKey])} is the most common recorded treatment outcome (${pct(top[valueKey], total)}%). `;
  text += `Cured or treatment completed: ${pct(success, total)}% of recorded outcomes`;
  if (ltfu) text += `; lost to follow-up: ${pct(ltfu, total)}%`;
  return `${text}.`;
}

/** Risk classification counts. Risk levels are relative (thirds of Pasig's barangays by incidence). */
export function riskInsight(rows, { nameKey = 'name', classKey = 'risk_class' } = {}) {
  const list = (rows || []).filter((r) => r && r[classKey] && String(r[classKey]).toLowerCase() !== 'no data');
  if (list.length === 0) return null;
  const count = (c) => list.filter((r) => String(r[classKey]).toLowerCase() === c).length;
  const high = list.filter((r) => String(r[classKey]).toLowerCase() === 'high').map((r) => r[nameKey]);
  let text = `Of ${list.length} assessed barangays: ${count('high')} High risk, ${count('medium')} Moderate, ${count('low')} Low`;
  if (high.length) text += `. High-risk: ${high.slice(0, 4).join(', ')}${high.length > 4 ? `, and ${high.length - 4} more` : ''}`;
  return `${text}. Risk levels compare barangays with each other within Pasig; they are not national thresholds.`;
}

/** Case trend: matched-period change and the year with the most reported cases. */
export function caseTrendInsight(rows, latestPeriod) {
  if (!rows || rows.length === 0) return null;
  const peak = rows.reduce((a, b) => (b.cases > a.cases ? b : a));
  let text = '';
  if (latestPeriod && latestPeriod.changePct != null) {
    text = `For ${latestPeriod.period}, ${latestPeriod.year} had ${Math.abs(latestPeriod.changePct)}% ${latestPeriod.changePct >= 0 ? 'more' : 'fewer'} cases than ${latestPeriod.previousYear}. `;
  }
  text += `The year with the most reported cases was ${peak.year} (${fmt(peak.cases)} across ${peak.coverage.toLowerCase()}).`;
  return text;
}

/** Forecast chart: projected next period(s) vs the latest actual month. */
export function forecastInsight(points, { actualKey = 'Actual', forecastKey = 'Forecast', labelKey = 'label', methodLabel } = {}) {
  const actual = (points || []).filter((p) => p[actualKey] != null);
  const fc = (points || []).filter((p) => p[forecastKey] != null);
  if (fc.length === 0) return null;
  const lastActual = actual[actual.length - 1];
  const first = fc[0];
  let text = `The model projects about ${fmt(first[forecastKey])} cases for ${first[labelKey]}`;
  if (fc.length > 1) text += ` and ${fmt(sum(fc.map((p) => Number(p[forecastKey]))))} in total over ${fc.length} months (through ${fc[fc.length - 1][labelKey]})`;
  if (lastActual && Number(lastActual[actualKey]) > 0) {
    const change = Math.round(((first[forecastKey] - lastActual[actualKey]) / lastActual[actualKey]) * 100);
    text += `, ${Math.abs(change) < 5 ? 'about the same as' : `${Math.abs(change)}% ${change > 0 ? 'above' : 'below'}`} the latest actual month (${lastActual[labelKey]}: ${fmt(lastActual[actualKey])})`;
  }
  text += '.';
  if (methodLabel) text += ` Method: ${methodLabel}.`;
  return `${text} Forecasts are estimates based on past patterns, not certainties.`;
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
  const tendency = over > rows.length * 0.65 ? ' The model tended to over-predict.'
    : over < rows.length * 0.35 ? ' The model tended to under-predict.' : '';
  return `On past months, predictions were off by about ${fmt(mae)} cases on average${mape != null ? ` (${mape}% average error)` : ''}.${tendency} Lower is better.`;
}
