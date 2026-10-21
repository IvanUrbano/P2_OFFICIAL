/**
 * Template-based, per-chart interpretations (deterministic — no AI model). Each function
 * takes the exact data a chart draws, so the sentence always matches what is shown,
 * including any active filters. Returns null when there isn't enough data to say anything.
 *
 * Kept to one or two sentences. Where a check on the data supports it (trend, risk, outcomes,
 * forecast) the sentence says what the figures mean; it never states a cause, and never a
 * prediction the forecast model did not make. Without enough data for the check it falls back
 * to a short factual line.
 */

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const sum = (arr) => arr.reduce((s, v) => s + v, 0);
const avg = (arr) => (arr.length ? sum(arr) / arr.length : 0);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Same number as TREATMENT_SUCCESS_TARGET in BACKEND/tbinsight/targets.js (alerts and reports). */
export const TREATMENT_SUCCESS_TARGET = 85;

/* Functions accept an optional `previous` describing the same measure for an earlier period
 * ({ label, items } for lists, { label, value } for totals). With no previous data the
 * comparison is left out - nothing is ever compared with a made-up zero. */

/** "YYYY-MM" from a "YYYY-MM" key or a date value, read on local parts like the charts do. */
function ymOf(value) {
  if (value == null || value === '') return null;
  const s = String(value);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const d = value instanceof Date ? value : new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function shiftYm(ym, months) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** "Jul–Sep 2026", or "Nov 2025–Jan 2026" across a year end. */
function spanLabel(first, last) {
  const [y1, m1] = first.split('-').map(Number);
  const [y2, m2] = last.split('-').map(Number);
  if (first === last) return `${MONTHS[m1 - 1]} ${y1}`;
  return y1 === y2 ? `${MONTHS[m1 - 1]}–${MONTHS[m2 - 1]} ${y2}` : `${MONTHS[m1 - 1]} ${y1}–${MONTHS[m2 - 1]} ${y2}`;
}

/**
 * Is the gap between two case counts larger than chance? Under an unchanged rate each case
 * is equally likely to fall in either period, so the gap is compared with its counting noise
 * (normal approximation to the binomial, continuity-corrected, two-sided 5%).
 */
function beyondChance(now, then) {
  const n = now + then;
  return n > 0 && (Math.abs(now - then) - 1) / Math.sqrt(n) > 1.96;
}

/**
 * Monthly trend. Compares the last 3 complete months with the same months a year earlier
 * and says whether the difference is beyond normal variation; when the rise or fall from the
 * 3 months before also happened in the same months last year, it is called the usual seasonal
 * pattern. `history` ([{ month, cases }], any number of rows per month) is the same scope
 * across all years, needed for the year-earlier months; the current calendar month is left
 * out because it is not finished. Falls back to the latest and busiest month.
 */
export function trendInsight(points, { valueKey = 'cases', labelKey = 'label', monthKey = 'month', history = null, previous = null, today = new Date() } = {}) {
  const current = ymOf(today);
  const series = (points || [])
    .filter((p) => p && p[valueKey] != null && !p.missing)
    .map((p) => ({ ym: ymOf(p[monthKey]), label: p[labelKey], v: Number(p[valueKey]) }))
    .filter((p) => !p.ym || p.ym < current);
  if (series.length === 0) return null;

  const byMonth = new Map();
  for (const r of history || series.map((p) => ({ month: p.ym, cases: p.v }))) {
    const ym = ymOf(r.month);
    if (ym) byMonth.set(ym, (byMonth.get(ym) || 0) + Number(r.cases || 0));
  }
  const total = (months) => (months.every((m) => byMonth.has(m)) ? sum(months.map((m) => byMonth.get(m))) : null);

  const last = series[series.length - 1];
  if (last.ym) {
    const recent = [-2, -1, 0].map((k) => shiftYm(last.ym, k));
    const yearBefore = recent.map((m) => shiftYm(m, -12));
    const now = total(recent);
    const then = total(yearBefore);
    if (now != null && then) {
      const change = Math.round(((now - then) / then) * 100);
      const nowSpan = spanLabel(recent[0], recent[2]);
      const thenSpan = spanLabel(yearBefore[0], yearBefore[2]);
      const amount = Math.abs(change) < 1 ? 'about the same as' : `${Math.abs(change)}% ${change > 0 ? 'more than' : 'fewer than'}`;
      if (beyondChance(now, then)) {
        return `${nowSpan} had ${fmt(now)} cases, ${amount} ${thenSpan} (${fmt(then)}). The difference is larger than normal variation, so this is a real ${change > 0 ? 'increase' : 'decrease'}.`;
      }
      let text = `${nowSpan} had ${fmt(now)} cases, ${amount} ${thenSpan} (${fmt(then)}), within normal variation.`;
      const before = total(recent.map((m) => shiftYm(m, -3)));
      const beforeThen = total(yearBefore.map((m) => shiftYm(m, -3)));
      if (before && beforeThen) {
        const move = (now - before) / before;
        const moveThen = (then - beforeThen) / beforeThen;
        if (Math.abs(move) >= 0.1 && Math.abs(moveThen) >= 0.1 && Math.sign(move) === Math.sign(moveThen)) {
          text += ` The ${move > 0 ? 'rise' : 'drop'} from the months before also happened last year, so it is the usual seasonal pattern.`;
        }
      }
      return text;
    }
  }

  // A report passes the same date range a year earlier as one total: compare all months shown with it.
  if (previous && Number(previous.value) > 0) {
    const now = sum((points || []).filter((p) => p && p[valueKey] != null && !p.missing).map((p) => Number(p[valueKey])));
    const then = Number(previous.value);
    const change = Math.round(((now - then) / then) * 100);
    const amount = Math.abs(change) < 1 ? 'about the same as' : `${Math.abs(change)}% ${change > 0 ? 'more than' : 'fewer than'}`;
    return beyondChance(now, then)
      ? `This period had ${fmt(now)} cases, ${amount} ${previous.label} (${fmt(then)}). The difference is larger than normal variation, so this is a real ${change > 0 ? 'increase' : 'decrease'}.`
      : `This period had ${fmt(now)} cases, ${amount} ${previous.label} (${fmt(then)}), within normal variation.`;
  }

  const peak = series.reduce((a, b) => (b.v > a.v ? b : a));
  return peak === last
    ? `${last.label} had ${fmt(last.v)} cases, the highest month shown.`
    : `${last.label} had ${fmt(last.v)} cases; the highest month shown was ${peak.label} (${fmt(peak.v)}).`;
}

/** Ranking (barangays, facilities): the leader's share and how concentrated the top 3 are. */
export function rankingInsight(items, { nameKey = 'name', valueKey = 'Cases', noun = 'barangay', unit = 'cases', previous = null } = {}) {
  const rows = (items || []).filter((r) => r && Number(r[valueKey]) > 0 && r[nameKey] && r[nameKey] !== 'Unknown');
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]));
  const total = sum(sorted.map((r) => Number(r[valueKey])));
  const top = sorted[0];
  let text = `${top[nameKey]} has the most ${unit} (${fmt(top[valueKey])}, ${pct(top[valueKey], total)}% of the total).`;
  if (sorted.length >= 6) {
    const top3 = sum(sorted.slice(0, 3).map((r) => Number(r[valueKey])));
    text += ` The top 3 ${noun === 'barangay' ? 'barangays' : `${noun === 'facility' ? 'facilities' : `${noun}s`}`} account for ${pct(top3, total)}%.`;
  }
  const prevRows = previous ? (previous.items || []).filter((r) => r && Number(r[valueKey]) > 0 && r[nameKey] && r[nameKey] !== 'Unknown') : [];
  if (prevRows.length > 0) {
    const prevTop = [...prevRows].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]))[0];
    if (prevTop[nameKey] !== top[nameKey]) text += ` In ${previous.label}, ${prevTop[nameKey]} had the most (${fmt(prevTop[valueKey])}).`;
  }
  return text;
}

/** Incidence ranking (cases per 100,000) — only when a year with population data is selected. */
export function incidenceInsight(items, { nameKey = 'name', valueKey = 'Incidence' } = {}) {
  const rows = (items || []).filter((r) => r && r[valueKey] != null);
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => b[valueKey] - a[valueKey]);
  const top = sorted[0];
  const low = sorted[sorted.length - 1];
  return `${top[nameKey]} has the highest rate (${top[valueKey]} cases per 100,000 people) and ${low[nameKey]} the lowest (${low[valueKey]}).`;
}

/** Share of a total across categories (sex, age group): the largest group, with last year's share. */
export function shareInsight(items, { nameKey = 'name', valueKey = 'value', noun = 'group', format = (s) => s, previous = null } = {}) {
  const rows = (items || []).filter((r) => r && Number(r[valueKey]) > 0 && r[nameKey] !== 'Unknown');
  if (rows.length === 0) return null;
  const total = sum(rows.map((r) => Number(r[valueKey])));
  const [first, second] = [...rows].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]));
  const prevRows = previous ? (previous.items || []).filter((r) => r && Number(r[valueKey]) > 0 && r[nameKey] !== 'Unknown') : [];
  const prevTotal = sum(prevRows.map((r) => Number(r[valueKey])));
  const was = prevRows.find((r) => r[nameKey] === first[nameKey]);
  const share = `${pct(first[valueKey], total)}%${was && prevTotal ? `; ${pct(was[valueKey], prevTotal)}% in ${previous.label}` : ''}`;
  if (noun === 'age group') {
    return `The ${format(first[nameKey])} age group has the most cases (${share})${second ? `, followed by ${format(second[nameKey])} (${pct(second[valueKey], total)}%)` : ''}.`;
  }
  if (noun === 'sex') return `${format(first[nameKey])} patients make up most cases (${share}).`;
  return `${format(first[nameKey])} accounts for the largest share of cases (${share}).`;
}

/**
 * Treatment outcomes. With `tsr` ({ rate, cohortYear }: the cohort Treatment Success Rate the
 * page shows) it is judged against the programme target; the target is defined on a treatment
 * cohort, so it is never applied to the mix of recorded outcomes. Then the loss-to-follow-up
 * share, with last year's when known.
 */
export function outcomeInsight(items, { nameKey = 'name', valueKey = 'Cases', scope = 'recorded outcomes', tsr = null, previous = null } = {}) {
  const rows = (items || []).filter((r) => r && Number(r[valueKey]) > 0);
  if (rows.length === 0) return null;
  const total = sum(rows.map((r) => Number(r[valueKey])));
  const get = (list, ...names) => sum(list.filter((r) => names.includes(String(r[nameKey]).toUpperCase())).map((r) => Number(r[valueKey])));
  const rate = tsr && tsr.rate != null && Number.isFinite(Number(tsr.rate)) ? Number(tsr.rate) : null;
  let text;
  if (rate != null) {
    const gap = Math.round((TREATMENT_SUCCESS_TARGET - rate) * 10) / 10;
    const cohort = tsr.cohortYear ? `The ${tsr.cohortYear} treatment cohort` : 'The treatment cohort';
    text = `${cohort} reached ${rate}% success, ${gap > 0 ? `${gap} points below` : 'meeting'} the ${TREATMENT_SUCCESS_TARGET}% target.`;
  } else {
    text = `${pct(get(rows, 'CURED', 'TREATMENT COMPLETED'), total)}% of ${scope} were cured or completed treatment.`;
  }
  const lNow = pct(get(rows, 'LOST TO FOLLOW-UP'), total);
  const prevRows = previous ? (previous.items || []).filter((r) => r && Number(r[valueKey]) > 0) : [];
  if (prevRows.length > 0) {
    const lThen = pct(get(prevRows, 'LOST TO FOLLOW-UP'), sum(prevRows.map((r) => Number(r[valueKey]))));
    const word = Math.abs(lNow - lThen) < 1 ? 'about the same as' : lNow > lThen ? 'up from' : 'down from';
    text += ` Loss to follow-up is ${lNow}% of ${scope}, ${word} ${lThen}% in ${previous.label}.`;
  } else if (lNow) {
    text += ` ${lNow}% of ${scope} were lost to follow-up.`;
  }
  return text;
}

/** Risk levels: how many barangays are High, and whether they are the same ones as in the previous assessment. */
export function riskInsight(rows, { nameKey = 'name', classKey = 'risk_class', previous = null } = {}) {
  const list = (rows || []).filter((r) => r && r[classKey] && String(r[classKey]).toLowerCase() !== 'no data');
  if (list.length === 0) return null;
  const level = (r) => String(r[classKey]).toLowerCase();
  const names = (arr) => `${arr.slice(0, 3).join(', ')}${arr.length > 3 ? ` and ${arr.length - 3} more` : ''}`;
  const high = list.filter((r) => level(r) === 'high').map((r) => r[nameKey]);
  let text = high.length
    ? `${high.length} of ${list.length} barangays are High risk: ${names(high)}.`
    : `None of the ${list.length} assessed barangays is High risk.`;
  const prevList = previous ? (previous.items || []).filter((r) => r && r[classKey] && level(r) !== 'no data') : [];
  if (prevList.length > 0 && high.length) {
    const prevHigh = new Set(prevList.filter((r) => level(r) === 'high').map((r) => r[nameKey]));
    const stayed = high.filter((n) => prevHigh.has(n));
    const newly = high.filter((n) => !prevHigh.has(n));
    if (newly.length === 0) {
      text += ` All ${high.length === 1 ? 'of them were' : `${high.length} were`} also High in the ${previous.label} assessment, so the burden stays in the same barangays.`;
    } else if (stayed.length === 0) {
      text += ` None of them was High in the ${previous.label} assessment.`;
    } else {
      text += ` ${stayed.length} ${stayed.length === 1 ? 'was' : 'were'} also High in ${previous.label}; newly High: ${names(newly)}.`;
    }
  } else {
    text += ' Levels rank barangays against each other within Pasig.';
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

/** Forecast: the projected total against the same months a year earlier, else against the latest actual month. */
export function forecastInsight(points, { actualKey = 'Actual', forecastKey = 'Forecast', labelKey = 'label', previous = null } = {}) {
  const actual = (points || []).filter((p) => p[actualKey] != null);
  const fc = (points || []).filter((p) => p[forecastKey] != null);
  if (fc.length === 0) return null;
  const projected = Math.round(sum(fc.map((p) => Number(p[forecastKey]))));
  const span = fc.length > 1 ? `${fc[0][labelKey]}–${fc[fc.length - 1][labelKey]}` : fc[0][labelKey];
  if (previous && Number(previous.value) > 0) {
    const change = Math.round(((projected - previous.value) / previous.value) * 100);
    const amount = Math.abs(change) < 3 ? 'about the same as' : `${Math.abs(change)}% ${change > 0 ? 'more than' : 'fewer than'}`;
    return `The model projects about ${fmt(projected)} cases for ${span}, ${amount} ${previous.label} (${fmt(previous.value)}).`;
  }
  const lastActual = actual[actual.length - 1];
  return `The model projects about ${fmt(projected)} cases for ${span}${lastActual ? `; the latest actual month, ${lastActual[labelKey]}, had ${fmt(lastActual[actualKey])}` : ''}.`;
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
