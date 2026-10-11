// What the Forecasting page's "Model Evaluation" panel shows, from the SAVED evaluation record
// (GET /api/tb/evaluation/latest). Nothing here calls the model or any API: it only reads what was
// saved, narrowed by the page's active Year/Period and Barangay filters.
//
// What is saved:
//   metrics.arima.mae / mape        overall figures: the mean of each evaluated barangay's own MAE / MAPE
//   metrics.arima.wape / skill      pooled over every tested barangay-month (newer records only)
//   metrics.arima.*_3m              the same for 3-month totals; steps carry actual_3m / predicted_3m /
//                                   baseline_3m (absent for the last 2 months tested, and in older records)
//   metrics.arima.per_barangay[]    each barangay's MAE / MAPE and every tested month (actual, predicted,
//                                   and, in newer records, the 12-month-average baseline)
//   metrics.arima.steps[]           (older records) the monthly rows of ONE barangay only
//   config.method / evaluation_*    method label and the first / last month tested
//
// Rules:
//   - "All barangays" is the OVERALL evaluation — never one barangay standing in for the city. Its monthly
//     comparison is the city-wide total (actual and predicted summed over the barangays) for each month.
//   - Overall MAE / MAPE keep the saved definition: the average of the barangays' own figures. `city`
//     scores that city-wide total itself.
//   - With no narrowing the SAVED figures are shown as they are; with a year range or a barangay they are
//     recomputed from the saved months, the same way.
//   - An older record that kept only one barangay's months cannot answer a barangay or year filter it has no
//     data for; the view says so instead of guessing.

const monthKey = (m) => String(m).slice(0, 10);
const yearOf = (m) => Number(String(m).slice(0, 4));
const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const finite = (v) => v != null && Number.isFinite(Number(v));

/** 'arima' -> 'ARIMA'; other methods keep their name ('exponential_smoothing' -> 'exponential smoothing'). */
export function methodLabel(counts) {
  const names = Object.entries(counts || {}).filter(([, n]) => n > 0).map(([name]) => name);
  if (names.length === 0) return '—';
  return names.map((n) => (n === 'arima' ? 'ARIMA' : n.replaceAll('_', ' '))).join(' + ');
}

function countMethods(steps) {
  const counts = {};
  steps.forEach((s) => { const m = s.method || 'arima'; counts[m] = (counts[m] || 0) + 1; });
  return counts;
}

/**
 * Error figures over a list of { actual, predicted, baseline? } months.
 *   mae    average cases off per month
 *   mape   average % off per month; skips months with 0 actual cases and blows up on 1-2 case months
 *   wape   total cases off / total actual cases, in % — safe with small and zero months
 *   skill  1 - (error / error of the 12-month average); above 0 beats that simple reference.
 *          Only when every month carries its baseline (older records don't).
 */
export function errorStats(steps) {
  const valid = steps.filter((s) => finite(s.actual) && finite(s.predicted));
  if (valid.length === 0) return { mae: null, mape: null, wape: null, skill: null };
  const abs = valid.map((s) => Math.abs(Number(s.actual) - Number(s.predicted)));
  const pct = valid.filter((s) => Number(s.actual) > 0)
    .map((s) => Math.abs(Number(s.actual) - Number(s.predicted)) / Number(s.actual));
  const sum = (xs) => xs.reduce((t, v) => t + v, 0);
  const totalActual = sum(valid.map((s) => Number(s.actual)));
  const baseAbs = valid.every((s) => finite(s.baseline))
    ? sum(valid.map((s) => Math.abs(Number(s.actual) - Number(s.baseline))))
    : null;
  return {
    mae: mean(abs),
    mape: pct.length ? mean(pct) * 100 : null,
    wape: totalActual > 0 ? (sum(abs) / totalActual) * 100 : null,
    skill: baseAbs ? 1 - sum(abs) / baseAbs : null,
  };
}

/** The same figures for the 3-month totals carried on each step (null when none were saved). */
export function totalStats(steps) {
  const rows = steps
    .filter((s) => finite(s.actual_3m) && finite(s.predicted_3m))
    .map((s) => ({ actual: s.actual_3m, predicted: s.predicted_3m, baseline: s.baseline_3m }));
  return { ...errorStats(rows), months: rows.length };
}

const toRows = (steps) => steps
  .map((s) => ({
    month: monthKey(s.month),
    actual: Number(s.actual),
    predicted: Number(s.predicted),
    error: Math.abs(Number(s.actual) - Number(s.predicted)),
  }))
  .sort((a, b) => a.month.localeCompare(b.month));

const firstLast = (steps) => {
  const months = steps.map((s) => monthKey(s.month)).sort();
  return { start: months[0] || null, end: months[months.length - 1] || null };
};

export function buildEvaluationView(record, filters = {}) {
  const arima = record?.metrics?.arima;
  if (!arima) return { state: 'none' };

  const startYear = filters.startYear ? Number(filters.startYear) : null;
  const endYear = filters.endYear ? Number(filters.endYear) : null;
  const barangay = filters.barangay || '';
  const inRange = (month) => {
    const y = yearOf(month);
    return (startYear == null || y >= startYear) && (endYear == null || y <= endYear);
  };
  const rangeLabel = startYear && endYear
    ? (startYear === endYear ? String(startYear) : `${startYear}–${endYear}`)
    : 'All years';
  const config = record?.config || {};
  const base = { scope: barangay ? 'barangay' : 'overall', scopeLabel: barangay || 'All barangays', rangeLabel, notes: [] };

  const perBarangay = Array.isArray(arima.per_barangay) ? arima.per_barangay.filter((b) => Array.isArray(b.steps)) : [];
  const legacySteps = Array.isArray(arima.steps) ? arima.steps.filter((s) => s.month) : [];
  const savedWindow = config.evaluation_start && config.evaluation_end
    ? { start: monthKey(config.evaluation_start), end: monthKey(config.evaluation_end) }
    : firstLast(perBarangay.length ? perBarangay.flatMap((b) => b.steps) : legacySteps);

  const outsideRange = (steps) => {
    const w = firstLast(steps);
    return { ...base, state: 'no_steps_in_range', evaluatedStart: w.start || savedWindow.start, evaluatedEnd: w.end || savedWindow.end };
  };

  // ── One barangay ──
  if (barangay) {
    const hit = perBarangay.find((b) => same(b.barangay_name, barangay));
    let steps;
    let saved;
    if (hit) {
      steps = hit.steps;
      saved = { mae: hit.mae, mape: hit.mape, wape: hit.wape, skill: hit.skill };
    } else if (perBarangay.length === 0 && arima.example_barangay && same(arima.example_barangay, barangay)) {
      steps = legacySteps; // an older record kept this one barangay's months
      saved = null;
    } else {
      return {
        ...base,
        state: 'barangay_unavailable',
        savedFor: perBarangay.length === 0 ? (arima.example_barangay || null) : null,
        hasPerBarangay: perBarangay.length > 0,
      };
    }
    const inScope = steps.filter((s) => inRange(s.month));
    if (inScope.length === 0) return outsideRange(steps);
    const computed = errorStats(inScope);
    const useSaved = saved && finite(saved.mae) && inScope.length === steps.length;
    const w = firstLast(inScope);
    return {
      ...base,
      state: 'ready',
      total3m: totalStats(inScope),
      mae: useSaved ? Number(saved.mae) : computed.mae,
      mape: useSaved && finite(saved.mape) ? Number(saved.mape) : computed.mape,
      wape: useSaved && finite(saved.wape) ? Number(saved.wape) : computed.wape,
      skill: useSaved && finite(saved.skill) ? Number(saved.skill) : computed.skill,
      method: methodLabel(countMethods(inScope)),
      periodStart: w.start,
      periodEnd: w.end,
      rows: toRows(inScope),
      rowsLabel: barangay,
      narrowed: inScope.length !== steps.length,
    };
  }

  // ── All barangays: the overall evaluation ──
  if (perBarangay.length > 0) {
    const scoped = perBarangay
      .map((b) => ({ ...b, inScope: b.steps.filter((s) => inRange(s.month)) }))
      .filter((b) => b.inScope.length > 0);
    if (scoped.length === 0) return outsideRange(perBarangay.flatMap((b) => b.steps));

    const allSteps = scoped.flatMap((b) => b.inScope);
    const total = perBarangay.reduce((n, b) => n + b.steps.length, 0);
    const narrowed = allSteps.length !== total;
    const perStats = scoped.map((b) => errorStats(b.inScope));
    const maes = perStats.map((s) => s.mae).filter(finite);
    const mapes = perStats.map((s) => s.mape).filter(finite);
    const pooled = errorStats(allSteps);

    // City-wide monthly totals: actual and predicted summed over the barangays tested that month.
    // The baseline is summed too, so the city total gets its own skill (null if any month lacks one).
    const byMonth = new Map();
    allSteps.forEach((s) => {
      const k = monthKey(s.month);
      const cur = byMonth.get(k) || { month: k, actual: 0, predicted: 0, baseline: 0 };
      cur.actual += Number(s.actual);
      cur.predicted += Number(s.predicted);
      cur.baseline = cur.baseline != null && finite(s.baseline) ? cur.baseline + Number(s.baseline) : null;
      byMonth.set(k, cur);
    });
    const w = firstLast(allSteps);
    const t3 = totalStats(allSteps);
    return {
      ...base,
      state: 'ready',
      total3m: narrowed || !finite(arima.wape_3m)
        ? t3
        : { ...t3, mae: Number(arima.mae_3m), wape: Number(arima.wape_3m), skill: finite(arima.skill_3m) ? Number(arima.skill_3m) : t3.skill },
      mae: !narrowed && finite(arima.mae) ? Number(arima.mae) : mean(maes),
      mape: !narrowed && finite(arima.mape) ? Number(arima.mape) : mean(mapes),
      wape: !narrowed && finite(arima.wape) ? Number(arima.wape) : pooled.wape,
      skill: !narrowed && finite(arima.skill) ? Number(arima.skill) : pooled.skill,
      method: !narrowed && config.method ? config.method : methodLabel(countMethods(allSteps)),
      periodStart: w.start,
      periodEnd: w.end,
      // The city-wide monthly total scored as one forecast: barangay errors partly cancel out.
      city: errorStats([...byMonth.values()]),
      rows: toRows([...byMonth.values()]),
      rowsLabel: 'City-wide total (all barangays)',
      barangaysEvaluated: scoped.length,
      narrowed,
    };
  }

  // Older record: only the overall figures (and one barangay's months) were kept.
  const notes = [];
  const narrower = (startYear != null && savedWindow.start && startYear > yearOf(savedWindow.start))
    || (endYear != null && savedWindow.end && endYear < yearOf(savedWindow.end));
  if (narrower) notes.push('yearFilterNotApplied');
  return {
    ...base,
    state: 'ready',
    legacyOverall: true,
    total3m: { mae: finite(arima.mae_3m) ? Number(arima.mae_3m) : null, wape: finite(arima.wape_3m) ? Number(arima.wape_3m) : null, skill: finite(arima.skill_3m) ? Number(arima.skill_3m) : null, months: 0 },
    exampleBarangay: arima.example_barangay || null,
    mae: finite(arima.mae) ? Number(arima.mae) : null,
    mape: finite(arima.mape) ? Number(arima.mape) : null,
    wape: finite(arima.wape) ? Number(arima.wape) : null,
    skill: finite(arima.skill) ? Number(arima.skill) : null,
    method: config.method || methodLabel(arima.method_counts),
    periodStart: savedWindow.start,
    periodEnd: savedWindow.end,
    rows: [],
    rowsLabel: 'City-wide total (all barangays)',
    notes,
  };
}
