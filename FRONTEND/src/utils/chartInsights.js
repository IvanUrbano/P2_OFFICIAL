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

/* -- Comparison with older records --
 * Each chart function accepts an optional `previous` argument describing the same measure
 * for an earlier period ({ label, items } for lists, { label, value } for totals). With no
 * previous data the sentence is simply left out - nothing is ever compared with a made-up zero. */
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;

/** "Compared with 2025, cases are 12% higher (80 -> 90)." for a total against an earlier total. */
function totalChange(now, then, label, noun = 'cases') {
  if (then == null || !Number.isFinite(Number(then))) return '';
  if (Number(then) === 0) return now > 0 ? `${label} had no recorded ${noun}, so there is no earlier figure to compare with.` : '';
  const change = Math.round(((now - then) / then) * 100);
  const phrase = Math.abs(change) < 3 ? 'about the same' : `${Math.abs(change)}% ${change > 0 ? 'higher' : 'lower'}`;
  return `Compared with ${label}, ${noun} are ${phrase} (${fmt(then)} → ${fmt(now)}).`;
}

/** Monthly trend: direction over the last few months, peak month, latest month. */
export function trendInsight(points, { valueKey = 'cases', labelKey = 'label', unit = 'cases', window = 3, previous = null } = {}) {
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
  const lowest = pts.reduce((a, b) => (v(b) < v(a) ? b : a));
  const total = sum(pts.map(v));
  let text = `${direction}${peak[labelKey]} had the most ${unit} (${fmt(v(peak))}) and ${lowest[labelKey]} the fewest (${fmt(v(lowest))}). The latest month, ${last[labelKey]}, had ${fmt(v(last))}`;
  const mean = avg(pts.map(v));
  if (mean > 0) {
    const gap = Math.round(((v(last) - mean) / mean) * 100);
    text += Math.abs(gap) < 5 ? ', close to the monthly average' : `, ${Math.abs(gap)}% ${gap > 0 ? 'above' : 'below'} the monthly average of ${fmt(Math.round(mean))}`;
  }
  text += `. Across the ${pts.length} months shown there were ${fmt(total)} ${unit} in total.`;
  const cmp = previous && totalChange(total, previous.value, previous.label, unit);
  return cmp ? `${text} ${cmp}` : text;
}

/** Ranking (barangays, facilities): highest, lowest, and how concentrated the top 3 are. */
export function rankingInsight(items, { nameKey = 'name', valueKey = 'Cases', noun = 'barangay', unit = 'cases', previous = null } = {}) {
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
  const prevRows = previous ? (previous.items || []).filter((r) => r && Number(r[valueKey]) > 0 && r[nameKey] && r[nameKey] !== 'Unknown') : [];
  if (previous && prevRows.length > 0) {
    const prevSorted = [...prevRows].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]));
    const prevTotal = sum(prevSorted.map((r) => Number(r[valueKey])));
    const prevTop = prevSorted[0];
    text += prevTop[nameKey] === top[nameKey]
      ? ` ${top[nameKey]} also had the most ${unit} in ${previous.label} (${fmt(prevTop[valueKey])}).`
      : ` In ${previous.label}, ${prevTop[nameKey]} had the most ${unit} (${fmt(prevTop[valueKey])}); ${top[nameKey]} has since moved to the top.`;
    const prevMap = new Map(prevSorted.map((r) => [r[nameKey], Number(r[valueKey])]));
    const moves = sorted.filter((r) => prevMap.has(r[nameKey])).map((r) => ({ name: r[nameKey], diff: Number(r[valueKey]) - prevMap.get(r[nameKey]) }));
    const up = moves.reduce((a, b) => (b.diff > (a?.diff ?? 0) ? b : a), null);
    const down = moves.reduce((a, b) => (b.diff < (a?.diff ?? 0) ? b : a), null);
    if (up && up.diff > 0) text += ` The largest increase since ${previous.label} is in ${up.name} (${signed(up.diff)}).`;
    if (down && down.diff < 0) text += ` The largest decrease is in ${down.name} (${signed(down.diff)}).`;
    const cmp = totalChange(total, prevTotal, previous.label, unit);
    if (cmp) text += ` ${cmp.replace(/^Compared with [^,]+, /, 'Overall, ')}`;
  }
  return text;
}

/** Incidence ranking (cases per 100,000) — only when a year with population data is selected. */
export function incidenceInsight(items, { nameKey = 'name', valueKey = 'Incidence', previous = null } = {}) {
  const rows = (items || []).filter((r) => r && r[valueKey] != null);
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => b[valueKey] - a[valueKey]);
  let text = `${sorted[0][nameKey]} has the highest rate (${sorted[0][valueKey]} cases per 100,000 people). ${sorted[sorted.length - 1][nameKey]} has the lowest (${sorted[sorted.length - 1][valueKey]} per 100,000). These rates account for population size.`;
  const prevRows = previous ? (previous.items || []).filter((r) => r && r[valueKey] != null) : [];
  if (prevRows.length > 1) {
    const prevMap = new Map(prevRows.map((r) => [r[nameKey], Number(r[valueKey])]));
    const prevTop = [...prevRows].sort((a, b) => b[valueKey] - a[valueKey])[0];
    text += prevTop[nameKey] === sorted[0][nameKey]
      ? ` ${prevTop[nameKey]} also had the highest rate in ${previous.label} (${prevTop[valueKey]} per 100,000).`
      : ` In ${previous.label} the highest rate was in ${prevTop[nameKey]} (${prevTop[valueKey]} per 100,000).`;
    const own = prevMap.get(sorted[0][nameKey]);
    if (own != null) text += ` ${sorted[0][nameKey]} is ${Math.abs(sorted[0][valueKey] - own) < 0.5 ? 'unchanged' : `${sorted[0][valueKey] > own ? 'up' : 'down'} from ${own}`} since then.`;
  }
  return text;
}

/** Share of a total across categories (sex, age group): largest and smallest groups. */
export function shareInsight(items, { nameKey = 'name', valueKey = 'value', noun = 'group', format = (s) => s, previous = null } = {}) {
  const rows = (items || []).filter((r) => r && Number(r[valueKey]) > 0 && r[nameKey] !== 'Unknown');
  if (rows.length === 0) return null;
  const total = sum(rows.map((r) => Number(r[valueKey])));
  const sorted = [...rows].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]));
  const [first, second] = sorted;
  const label = noun === 'age group' ? `The ${format(first[nameKey])} age group` : format(first[nameKey]);
  let text = `${label} accounts for the largest share: ${fmt(first[valueKey])} cases (${pct(first[valueKey], total)}%).`;
  if (second) text += ` Next is ${format(second[nameKey])} (${pct(second[valueKey], total)}%).`;
  if (second && rows.length >= 3) text += ` Together the two largest ${noun === 'age group' ? 'age groups' : `${noun}s`} make up ${pct(Number(first[valueKey]) + Number(second[valueKey]), total)}% of cases.`;
  const prevRows = previous ? (previous.items || []).filter((r) => r && Number(r[valueKey]) > 0 && r[nameKey] !== 'Unknown') : [];
  if (prevRows.length > 0) {
    const prevTotal = sum(prevRows.map((r) => Number(r[valueKey])));
    const prevSorted = [...prevRows].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]));
    const prevOf = (name) => prevRows.find((r) => r[nameKey] === name);
    const was = prevOf(first[nameKey]);
    const lead = (name) => (noun === 'age group' ? `the ${format(name)} age group` : format(name));
    if (prevSorted[0][nameKey] === first[nameKey]) {
      const before = pct(was[valueKey], prevTotal);
      const now = pct(first[valueKey], total);
      const diff = Math.round((now - before) * 10) / 10;
      text += ` It was also the largest in ${previous.label}, when it made up ${before}%, so its share is ${Math.abs(diff) < 1 ? 'about the same' : `${diff > 0 ? 'up' : 'down'} ${Math.abs(diff)} percentage points`}.`;
    } else {
      text += ` In ${previous.label} the largest was ${lead(prevSorted[0][nameKey])} (${pct(prevSorted[0][valueKey], prevTotal)}%), so the leading ${noun} has changed.`;
    }
    const shifts = rows.filter((r) => prevOf(r[nameKey]))
      .map((r) => ({ name: r[nameKey], diff: pct(r[valueKey], total) - pct(prevOf(r[nameKey])[valueKey], prevTotal) }))
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    if (shifts[0] && Math.abs(shifts[0].diff) >= 3 && shifts[0].name !== first[nameKey]) {
      text += ` The biggest shift in share is ${lead(shifts[0].name)}, ${shifts[0].diff > 0 ? 'up' : 'down'} ${Math.abs(Math.round(shifts[0].diff * 10) / 10)} percentage points.`;
    }
    const cmp = totalChange(total, prevTotal, previous.label);
    if (cmp) text += ` ${cmp.replace(/^Compared with [^,]+, /, 'Overall, ')}`;
  }
  return text;
}

/**
 * Final treatment outcomes only; current case status is a separate measure.
 * `scope` says what the percentages cover (default "recorded outcomes"); `note` adds a closing
 * sentence, e.g. to explain why this differs from the cohort-based Treatment Success Rate.
 */
export function outcomeInsight(items, { nameKey = 'name', valueKey = 'Cases', scope = 'recorded outcomes', note = '', previous = null } = {}) {
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
  const died = get('DIED');
  text += '.';
  if (died) text += ` ${pct(died, total)}% of ${scope} ended in death.`;
  const prevRows = previous ? (previous.items || []).filter((r) => r && Number(r[valueKey]) > 0) : [];
  if (prevRows.length > 0) {
    const prevTotal = sum(prevRows.map((r) => Number(r[valueKey])));
    const prevGet = (...names) => sum(prevRows.filter((r) => names.includes(String(r[nameKey]).toUpperCase())).map((r) => Number(r[valueKey])));
    const sNow = pct(success, total);
    const sThen = pct(prevGet('CURED', 'TREATMENT COMPLETED'), prevTotal);
    const sDiff = Math.round((sNow - sThen) * 10) / 10;
    text += ` In ${previous.label}, ${sThen}% were cured or completed treatment, so success is ${Math.abs(sDiff) < 1 ? 'about the same' : `${sDiff > 0 ? 'up' : 'down'} ${Math.abs(sDiff)} percentage points`}.`;
    const lThen = pct(prevGet('LOST TO FOLLOW-UP'), prevTotal);
    const lNow = pct(ltfu, total);
    if (lThen || lNow) {
      const lDiff = Math.round((lNow - lThen) * 10) / 10;
      text += ` Loss to follow-up went from ${lThen}% to ${lNow}%${Math.abs(lDiff) < 1 ? ' (little change)' : lDiff > 0 ? ' (worse)' : ' (better)'}.`;
    }
  }
  return `${text}${note ? ` ${note}` : ''}`;
}

/** Risk classification counts. Risk levels are relative (Pasig's barangays ranked by incidence: bottom 40% Low, top third High). */
export function riskInsight(rows, { nameKey = 'name', classKey = 'risk_class', previous = null } = {}) {
  const list = (rows || []).filter((r) => r && r[classKey] && String(r[classKey]).toLowerCase() !== 'no data');
  if (list.length === 0) return null;
  const count = (c) => list.filter((r) => String(r[classKey]).toLowerCase() === c).length;
  const high = list.filter((r) => String(r[classKey]).toLowerCase() === 'high').map((r) => r[nameKey]);
  let text = `Among ${list.length} assessed barangays, ${count('high')} are high risk, ${count('medium')} moderate risk, and ${count('low')} low risk.`;
  if (high.length) text += ` High risk includes ${high.slice(0, 4).join(', ')}${high.length > 4 ? ` and ${high.length - 4} more` : ''}.`;
  text += ' These levels compare barangays within Pasig; they are not official national risk levels.';
  const prevList = previous ? (previous.items || []).filter((r) => r && r[classKey] && String(r[classKey]).toLowerCase() !== 'no data') : [];
  if (prevList.length > 0) {
    const level = (r) => String(r[classKey]).toLowerCase();
    const prevHigh = prevList.filter((r) => level(r) === 'high').map((r) => r[nameKey]);
    const nowHigh = new Set(high);
    const newlyHigh = high.filter((n) => !prevHigh.includes(n));
    const noLonger = prevHigh.filter((n) => !nowHigh.has(n) && list.some((r) => r[nameKey] === n));
    text += ` In the ${previous.label} assessment, ${prevHigh.length} barangay${prevHigh.length === 1 ? ' was' : 's were'} high risk (now ${high.length}).`;
    if (newlyHigh.length) text += ` Newly high risk: ${newlyHigh.slice(0, 4).join(', ')}${newlyHigh.length > 4 ? ` and ${newlyHigh.length - 4} more` : ''}.`;
    if (noLonger.length) text += ` No longer high risk: ${noLonger.slice(0, 4).join(', ')}${noLonger.length > 4 ? ` and ${noLonger.length - 4} more` : ''}.`;
    if (!newlyHigh.length && !noLonger.length) text += ' The same barangays are high risk in both assessments.';
  }
  return text;
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
export function forecastInsight(points, { actualKey = 'Actual', forecastKey = 'Forecast', labelKey = 'label', methodLabel, previous = null } = {}) {
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
  if (previous && previous.value != null) {
    const cmp = totalChange(sum(fc.map((p) => Number(p[forecastKey]))), previous.value, previous.label);
    if (cmp) text += ` ${cmp.replace(' cases are ', ' the projected cases are ')}`;
  }
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
    text += ' Each month also has a likely range: the real count will most likely fall inside it.';
  } else if (ranged.length > 0) {
    text += ` A likely range is available for ${ranged.length} of ${projected.length} months; the real count will most likely fall inside it.`;
  } else {
    text += ' No likely range is available, so these estimates should be treated cautiously.';
  }
  if (unavailable > 0) text += ` ${unavailable} ${unavailable === 1 ? 'month has' : 'months have'} no estimate because case history is too short.`;
  return text;
}

/** "Barangay X" or the whole city, for chart titles. */
export function scopeLabel(barangay) {
  return barangay ? `Barangay ${barangay}` : 'Pasig City (all barangays)';
}

/**
 * Headline figures for the actual-vs-predicted chart: accuracy = 100% minus the total
 * difference as a share of all actual cases, and the average difference per month.
 */
export function accuracySummary(points, { actualKey = 'Actual', predictedKey = 'Predicted' } = {}) {
  const rows = (points || []).filter((p) => p[actualKey] != null && p[predictedKey] != null);
  const totalActual = sum(rows.map((p) => p[actualKey]));
  if (rows.length === 0 || totalActual <= 0) return null;
  const errors = rows.map((p) => Math.abs(p[predictedKey] - p[actualKey]));
  return {
    accuracy: Math.max(0, Math.round(100 - (sum(errors) / totalActual) * 100)),
    avgOff: Math.round(avg(errors)),
    months: rows.length,
    first: rows[0].label,
    last: rows[rows.length - 1].label,
  };
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
  let text = `Compared with past months, predictions differed from actual counts by ${fmt(mae)} cases on average${mape != null ? ` (${mape}% of the actual count)` : ''}.${tendency} Smaller differences mean a closer fit.`;
  if (rows.length >= 6) {
    const half = Math.floor(rows.length / 2);
    const early = avg(errors.slice(0, half));
    const recent = avg(errors.slice(-half));
    if (early > 0) {
      const change = Math.round(((recent - early) / early) * 100);
      const span = `${rows[0].label} to ${rows[half - 1].label}`;
      text += Math.abs(change) < 10
        ? ` The fit in the recent months is about the same as in the older months (${span}).`
        : ` The most recent months were ${change < 0 ? 'predicted more closely' : 'predicted less closely'} than the older months (${span}): the average difference ${change < 0 ? 'fell' : 'rose'} from ${fmt(Math.round(early * 10) / 10)} to ${fmt(Math.round(recent * 10) / 10)} cases.`;
    }
  }
  return text;
}
