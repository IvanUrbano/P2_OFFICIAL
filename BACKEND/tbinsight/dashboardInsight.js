/**
 * TBInsight — Dashboard Insight (metrics + template NLG)
 *
 * The Dashboard is an executive overview page, so it gets its OWN concise
 * metric set and its OWN short NLG summary. It deliberately does not reuse
 * the Analytics insight: before this module existed, the Dashboard called
 * GET /api/tb/insights/analytics, which computes the full seven-section
 * Analytics narrative (highest/lowest barangay, per-barangay significance
 * testing, demographic splits, outcome breakdowns) for a page that shows
 * none of those things — and whose panel then read a top-level `summary`
 * field that the Analytics response has never contained, so the headline
 * interpretation silently fell back to placeholder text on every load.
 *
 * Division of responsibility, same as the Analytics pair
 * (insightDataBuilder.js + nlgEngine.js):
 *   buildDashboardMetrics(pool)  — queries and numbers only, no text.
 *   generateDashboardInsight(m)  — text only, no arithmetic beyond phrasing.
 *
 * This is TEMPLATE-BASED NLG. No language model is involved, and nothing
 * here may be described as LLM- or AI-generated output.
 *
 * Every shared indicator is delegated to its canonical implementation —
 * computeTreatmentSuccessRate (previous-year treatment-start cohort),
 * computeCaseFatalityRate (evaluated terminal outcomes), the persisted
 * Random Forest classification in barangay_risk_scores, and the persisted
 * forecast rows in model_predictions. This module never re-derives TSR, CFR,
 * incidence, a risk classification, or a forecast, and never fabricates a
 * population figure.
 *
 * Unavailable metrics stay unavailable: a missing input yields null and is
 * listed in `unavailable`, never coerced to 0, and one missing metric never
 * suppresses the findings that are still valid.
 */

const { computeTreatmentSuccessRate } = require('./treatmentSuccessRate');
const { computeCaseFatalityRate } = require('./caseFatalityRate');
const { countedCases } = require('./locationScope');

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Minimum number of distinct months carrying at least one reported case
 * before a calendar year counts as a usable reporting year for
 * year-over-year comparison.
 *
 * This is a coverage heuristic applied to whatever the data contains — not a
 * hardcoded list of years. A year holding a single isolated record (the live
 * dataset has exactly one, in late 2022) must not be presented as a complete
 * reporting year and must not serve as a YoY baseline. It remains legitimate
 * historical data: it still counts in case totals and is never deleted.
 */
const MIN_MONTHS_FOR_COMPLETE_YEAR = 6;

// ============================================================
//  METRICS
// ============================================================

/**
 * Build the Dashboard's metric set. Takes no filters — the Dashboard has no
 * global filter controls, and the shared cohort/outcome indicators it shows
 * are city-wide by definition.
 *
 * @param {object} pool - pg Pool (or a mock exposing the same `query` shape)
 * @returns {Promise<object>} metrics object
 */
async function buildDashboardMetrics(pool) {
  const unavailable = [];
  const safe = (promise, label) => promise.catch((err) => {
    console.error(`Dashboard metric failed (${label}):`, err.message);
    unavailable.push(label);
    return null;
  });

  const [monthlyRes, yearlyRes, riskRes, forecastRes, totalRes, onTreatmentRes] = await Promise.all([
    // Monthly counts, newest first — drives the 3-month trend comparison.
    safe(pool.query(`
      SELECT DATE_TRUNC('month', date_of_diagnosis)::DATE AS month,
             COUNT(*)::INTEGER AS case_count
      FROM tb_cases
      WHERE date_of_diagnosis IS NOT NULL
        AND ${countedCases()}
      GROUP BY DATE_TRUNC('month', date_of_diagnosis)
      ORDER BY month DESC
    `), 'trend'),

    // Per-year counts WITH month coverage, so an incomplete reporting year is
    // identified from the data rather than assumed.
    safe(pool.query(`
      SELECT EXTRACT(YEAR FROM date_of_diagnosis)::INTEGER AS year,
             COUNT(*)::INTEGER AS case_count,
             COUNT(DISTINCT DATE_TRUNC('month', date_of_diagnosis))::INTEGER AS months_covered
      FROM tb_cases
      WHERE date_of_diagnosis IS NOT NULL
        AND ${countedCases()}
      GROUP BY 1
      ORDER BY 1
    `), 'annual'),

    // Persisted Random Forest classification — the authoritative risk source.
    // The assessment year is extracted in SQL: a DATE column read back into
    // JS becomes local-midnight, so parsing it here would shift the year by
    // one for any timezone east of UTC.
    safe(pool.query(`
      SELECT barangay_name, risk_class, model_type,
             EXTRACT(YEAR FROM period)::INTEGER AS period_year
      FROM barangay_risk_scores
      WHERE period = (SELECT MAX(period) FROM barangay_risk_scores)
    `), 'risk'),

    // Persisted forecast rows for the latest forecast period only.
    safe(pool.query(`
      SELECT barangay_name, forecasted_count, method,
             EXTRACT(YEAR FROM period)::INTEGER AS period_year,
             EXTRACT(MONTH FROM period)::INTEGER AS period_month
      FROM model_predictions
      WHERE period = (SELECT MAX(period) FROM model_predictions)
    `), 'forecast'),

    // Required: overall totals. A failure here is a genuine database error
    // and is allowed to reject.
    pool.query(`
      SELECT COUNT(*)::INTEGER AS total_cases,
             COUNT(DISTINCT barangay_name)::INTEGER AS barangays_with_data,
             COUNT(DISTINCT DATE_TRUNC('month', date_of_diagnosis))::INTEGER AS months_covered,
             MIN(date_of_diagnosis) AS earliest_date,
             MAX(date_of_diagnosis) AS latest_date
      FROM tb_cases
      WHERE ${countedCases()}
    `),

    safe(pool.query(`
      SELECT COUNT(*)::INTEGER AS on_treatment
      FROM tb_cases
      WHERE UPPER(TRIM(outcome_status)) = 'ON TREATMENT'
        AND ${countedCases()}
    `), 'onTreatment'),
  ]);

  // --- 3-month trend (same comparison shape as the Analytics insight) ---
  let trend = null;
  let latestMonth = null;
  if (monthlyRes) {
    const rows = monthlyRes.rows;
    if (rows.length > 0) {
      latestMonth = { month: rows[0].month, cases: rows[0].case_count };
    }
    const recentCount = rows.slice(0, 3).reduce((s, r) => s + r.case_count, 0);
    const priorCount = rows.slice(3, 6).reduce((s, r) => s + r.case_count, 0);
    // No prior window means no comparison — null, not a 0% change.
    if (priorCount > 0) {
      const changePercent = Math.round(((recentCount - priorCount) / priorCount) * 1000) / 10;
      trend = {
        direction: changePercent > 5 ? 'increasing' : changePercent < -5 ? 'decreasing' : 'stable',
        changePercent,
        recentCount,
        priorCount,
      };
    }
  }

  // --- Annual coverage + year-over-year change ---
  // YoY is computed only between two ADJACENT years that both have usable
  // coverage. Otherwise it is null with an explicit reason — never a
  // percentage measured against an isolated record, and never 0.
  let annual = null;
  if (yearlyRes) {
    const years = yearlyRes.rows.map((r) => ({
      year: Number(r.year),
      cases: Number(r.case_count),
      monthsCovered: Number(r.months_covered),
      complete: Number(r.months_covered) >= MIN_MONTHS_FOR_COMPLETE_YEAR,
    }));
    const complete = years.filter((y) => y.complete);
    const incompleteYears = years.filter((y) => !y.complete).map((y) => y.year);
    const latest = complete.length > 0 ? complete[complete.length - 1] : null;
    const prior = complete.length > 1 ? complete[complete.length - 2] : null;

    let yoyChangePercent = null;
    let yoyUnavailableReason = null;
    if (!latest) {
      yoyUnavailableReason = 'no reporting year has enough month coverage for a comparison';
    } else if (!prior) {
      yoyUnavailableReason = 'no complete previous reporting year is available as a baseline';
    } else if (prior.year !== latest.year - 1) {
      yoyUnavailableReason = `${latest.year - 1} has incomplete coverage, so no year-over-year baseline is available`;
    } else if (prior.cases > 0) {
      yoyChangePercent = Math.round(((latest.cases - prior.cases) / prior.cases) * 1000) / 10;
    } else {
      yoyUnavailableReason = 'the previous reporting year recorded no cases';
    }

    annual = {
      years,
      incompleteYears,
      latestCompleteYear: latest ? latest.year : null,
      latestYearCases: latest ? latest.cases : null,
      previousYear: prior ? prior.year : null,
      previousYearCases: prior ? prior.cases : null,
      yoyChangePercent,
      yoyUnavailableReason,
    };
  }

  // --- Risk classification (persisted Random Forest output) ---
  // `assessed` is the real denominator for "N of M barangays": barangays with
  // no persisted classification are counted separately and are never folded
  // into the assessed total, so the Dashboard cannot imply coverage that the
  // snapshot does not have.
  let riskCounts = null;
  let highRiskBarangays = null;
  if (riskRes) {
    const counts = { high: 0, medium: 0, low: 0, noData: 0, assessed: 0, assessmentYear: null };
    const highNames = [];
    for (const r of riskRes.rows) {
      const cls = (r.risk_class || '').toLowerCase();
      if (cls === 'high') {
        counts.high++; counts.assessed++; highNames.push(r.barangay_name);
      } else if (cls === 'medium') {
        counts.medium++; counts.assessed++;
      } else if (cls === 'low') {
        counts.low++; counts.assessed++;
      } else {
        counts.noData++;
      }
    }
    const periodYear = riskRes.rows[0]?.period_year;
    counts.assessmentYear = periodYear ? Number(periodYear) - 1 : null;
    counts.modelTypes = [...new Set(riskRes.rows.map((r) => r.model_type).filter(Boolean))];
    if (counts.assessed > 0) {
      riskCounts = counts;
      highRiskBarangays = highNames;
    } else {
      // Nothing was classified — "no assessment exists" is not "zero High
      // Risk barangays", so the metric is reported unavailable instead.
      unavailable.push('risk');
    }
  }

  // --- Treatment indicators (canonical shared calculations) ---
  let treatment = null;
  try {
    const [tsr, cfr] = await Promise.all([
      computeTreatmentSuccessRate(pool, {}),
      computeCaseFatalityRate(pool, {}),
    ]);
    treatment = {
      successRate: tsr.successRate,
      cohortYear: tsr.cohortYear,
      cohortTotal: tsr.cohortTotal,
      fatalityRate: cfr.rate,
      fatalityDied: cfr.died,
      fatalityEvaluated: cfr.evaluated,
      onTreatment: onTreatmentRes ? onTreatmentRes.rows[0]?.on_treatment ?? null : null,
    };
  } catch (err) {
    console.error('Dashboard metric failed (treatment):', err.message);
    unavailable.push('treatment');
  }

  // --- Forecast (persisted model_predictions, latest period) ---
  // The tier label follows the established convention already used by the
  // Forecasting page: method 'arima' is an ARIMA Forecast, the
  // 'insufficient_data' marker means no forecast was produced for that
  // barangay, and ANY other method is a Baseline Forecast. A baseline result
  // is never relabelled ARIMA.
  let forecast = null;
  if (forecastRes && forecastRes.rows.length > 0) {
    const rows = forecastRes.rows;
    const methods = [...new Set(rows.map((r) => r.method).filter(Boolean))];
    const usable = rows.filter((r) => r.method !== 'insufficient_data');
    const anyFallback = usable.some((r) => r.method && r.method !== 'arima');
    const tier = usable.length === 0
      ? 'insufficient_data'
      : anyFallback ? 'baseline' : 'arima';
    forecast = {
      periodYear: rows[0].period_year ? Number(rows[0].period_year) : null,
      periodMonth: rows[0].period_month ? Number(rows[0].period_month) : null,
      total: usable.length === 0
        ? null
        : Math.round(usable.reduce((s, r) => s + Number(r.forecasted_count || 0), 0)),
      barangays: usable.length,
      methods,
      tier,
      tierLabel: tier === 'insufficient_data'
        ? 'Insufficient Historical Data'
        : tier === 'baseline' ? 'Baseline Forecast' : 'ARIMA Forecast',
    };
  } else if (forecastRes) {
    unavailable.push('forecast');
  }

  const totalRow = totalRes.rows[0] || {};
  return {
    summary: {
      totalCases: totalRow.total_cases || 0,
      barangaysWithData: totalRow.barangays_with_data || 0,
      monthsCovered: totalRow.months_covered || 0,
      earliestDate: totalRow.earliest_date || null,
      latestDate: totalRow.latest_date || null,
      latestMonth,
    },
    trend,
    annual,
    riskCounts,
    highRiskBarangays,
    treatment,
    forecast,
    unavailable,
  };
}

// ============================================================
//  NLG — concise overview sections
// ============================================================

/** Format a persisted forecast period without re-parsing a DATE in JS. */
function forecastPeriodLabel(f) {
  if (!f || !f.periodYear || !f.periodMonth) return null;
  return `${MONTH_NAMES[f.periodMonth]} ${f.periodYear}`;
}

function buildCaseActivity(m) {
  const parts = [];
  if (m.trend) {
    const pct = Math.abs(m.trend.changePercent);
    if (m.trend.direction === 'increasing') {
      parts.push(`Reported TB cases **increased** by **${pct}%** over the most recent 3-month period (${m.trend.recentCount} cases) compared with the preceding 3 months (${m.trend.priorCount} cases).`);
    } else if (m.trend.direction === 'decreasing') {
      parts.push(`Reported TB cases **decreased** by **${pct}%** over the most recent 3-month period (${m.trend.recentCount} cases) compared with the preceding 3 months (${m.trend.priorCount} cases).`);
    } else {
      parts.push(`Reported TB cases remained **relatively stable** over the most recent 3-month period (${m.trend.recentCount} cases versus ${m.trend.priorCount} in the preceding 3 months).`);
    }
  }
  if (m.annual) {
    const a = m.annual;
    if (a.yoyChangePercent != null && a.latestCompleteYear != null) {
      const dir = a.yoyChangePercent > 0 ? 'higher than' : a.yoyChangePercent < 0 ? 'lower than' : 'level with';
      parts.push(`Across full reporting years, **${a.latestCompleteYear}** recorded **${a.latestYearCases.toLocaleString()}** cases — **${Math.abs(a.yoyChangePercent)}% ${dir}** ${a.previousYear} (${a.previousYearCases.toLocaleString()} cases).`);
    } else if (a.yoyUnavailableReason) {
      parts.push(`A year-over-year comparison is not available because ${a.yoyUnavailableReason}.`);
    }
  }
  if (parts.length === 0) return null;
  return { id: 'caseActivity', title: 'Reported Case Trend', text: parts.join(' ') };
}

function buildRiskSituation(m) {
  if (!m.riskCounts) {
    return {
      id: 'riskSituation',
      title: 'Risk Situation',
      text: 'No Random Forest risk classification is available yet, so barangay risk levels cannot be reported. Run the prediction pipeline to produce an assessment.',
    };
  }
  const r = m.riskCounts;
  const yearNote = r.assessmentYear ? ` (${r.assessmentYear} assessment)` : '';
  let text;
  if (r.high === 0) {
    text = `The Random Forest risk classification places **no barangays** in the High Risk band${yearNote}, across ${r.assessed} assessed barangay(s).`;
    if (r.medium > 0) text += ` **${r.medium}** are classified Moderate Risk and warrant continued monitoring.`;
  } else {
    const names = (m.highRiskBarangays || []).slice(0, 4).join(', ');
    const others = r.high - 4;
    text = `The Random Forest risk classification places **${r.high}** of **${r.assessed}** assessed barangays in the **High Risk** band${yearNote}`;
    text += others > 0 ? `, including ${names}, and ${others} others.` : `: ${names || 'see GIS Hotspots'}.`;
  }
  if (r.noData > 0) {
    text += ` **${r.noData}** barangay(s) have no classification in this snapshot and are reported as No Assessment rather than Low Risk.`;
  }
  return { id: 'riskSituation', title: 'Risk Situation', text };
}

function buildTreatmentPerformance(m) {
  if (!m.treatment) return null;
  const t = m.treatment;
  const parts = [];
  if (t.successRate != null) {
    const ctx = [];
    if (t.cohortYear) ctx.push(`the ${t.cohortYear} treatment cohort`);
    if (t.cohortTotal) ctx.push(`${t.cohortTotal.toLocaleString()} patients`);
    parts.push(`The Treatment Success Rate is **${t.successRate}%** for ${ctx.join(' — ')}.`);
  } else {
    parts.push('The Treatment Success Rate cannot be calculated because the previous-year treatment cohort is empty.');
  }
  if (t.fatalityRate != null) {
    parts.push(`The Case Fatality Rate among evaluated terminal outcomes is **${t.fatalityRate}%** (${t.fatalityDied} of ${t.fatalityEvaluated.toLocaleString()}).`);
  } else {
    parts.push('The Case Fatality Rate is unavailable because no evaluated terminal outcomes are recorded.');
  }
  if (t.onTreatment != null) {
    parts.push(`**${t.onTreatment.toLocaleString()}** records currently carry an ON TREATMENT status.`);
  }
  return { id: 'treatmentPerformance', title: 'Treatment Performance', text: parts.join(' ') };
}

function buildForecastSignal(m) {
  const f = m.forecast;
  // No predictive wording at all when there is no valid forecast — the
  // section is omitted rather than filled with a fabricated outlook.
  if (!f) return null;
  if (f.tier === 'insufficient_data') {
    return {
      id: 'forecastSignal',
      title: 'Forecast Signal',
      text: 'Forecasting is unavailable for this scope: the available history falls below the minimum monthly observations required, so no forecast was produced (Insufficient Historical Data).',
    };
  }
  const label = forecastPeriodLabel(f);
  const periodText = label ? ` for **${label}**` : '';
  let text = `The latest **${f.tierLabel}** projects **${f.total.toLocaleString()}** cases${periodText} across ${f.barangays} barangay(s).`;
  if (f.tier === 'baseline') {
    text += ' This is a Baseline Forecast, not ARIMA — at least one barangay had fewer than 24 monthly observations.';
  }
  return { id: 'forecastSignal', title: 'Forecast Signal', text };
}

/**
 * One-paragraph headline summary. This is the `summary` field the Dashboard's
 * highlight panel renders; it is built from the same metrics as the sections
 * and omits any clause whose metric is unavailable rather than substituting a
 * zero.
 */
function buildOverallSummary(m) {
  const parts = [];
  if (m.trend) {
    if (m.trend.direction === 'increasing') {
      parts.push(`reported TB cases increased by ${Math.abs(m.trend.changePercent)}% over the most recent 3-month period`);
    } else if (m.trend.direction === 'decreasing') {
      parts.push(`reported TB cases decreased by ${Math.abs(m.trend.changePercent)}% over the most recent 3-month period`);
    } else {
      parts.push('reported TB cases remained stable over the most recent 3-month period');
    }
  }
  if (m.riskCounts) {
    parts.push(m.riskCounts.high > 0
      ? `${m.riskCounts.high} of ${m.riskCounts.assessed} assessed barangays are classified High Risk by the Random Forest model`
      : `no barangays are currently classified High Risk by the Random Forest model`);
  }
  if (m.treatment?.successRate != null) {
    parts.push(`the Treatment Success Rate is ${m.treatment.successRate}% for the ${m.treatment.cohortYear} cohort`);
  }
  if (m.treatment?.fatalityRate != null) {
    parts.push(`and the Case Fatality Rate among evaluated terminal outcomes is ${m.treatment.fatalityRate}%`);
  }
  if (parts.length === 0) {
    return 'No overview could be generated yet: none of the underlying metrics are available for the current data.';
  }
  const text = parts.join(', ') + '.';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Generate the Dashboard insight from pre-computed metrics.
 *
 * Template-based NLG: it formats numbers that buildDashboardMetrics already
 * produced and performs no analytical calculation of its own. A failing
 * section builder omits only its own section.
 *
 * @param {object} metrics - output of buildDashboardMetrics
 * @returns {{type: string, summary: string, sections: object[], meta: object}}
 */
function generateDashboardInsight(metrics) {
  const noData = !metrics.summary || !metrics.summary.totalCases;
  if (noData) {
    return {
      type: 'dashboard',
      summary: 'No TB records are available yet, so no overview can be generated. Import or synchronise TB records to populate the Dashboard.',
      sections: [],
      meta: {
        basedOn: 'Pasig City • All Years',
        unavailable: metrics.unavailable || [],
        generatedAt: new Date().toISOString(),
        method: 'template-nlg',
      },
    };
  }

  const builders = [
    () => buildCaseActivity(metrics),
    () => buildRiskSituation(metrics),
    () => buildTreatmentPerformance(metrics),
    () => buildForecastSignal(metrics),
  ];
  const sections = [];
  for (const build of builders) {
    try {
      const section = build();
      if (section) sections.push(section);
    } catch (err) {
      console.error('Dashboard NLG section builder failed:', err.message);
    }
  }

  let summary;
  try {
    summary = buildOverallSummary(metrics);
  } catch (err) {
    console.error('Dashboard NLG summary builder failed:', err.message);
    summary = null;
  }

  const coverage = metrics.annual?.incompleteYears?.length
    ? ` • Incomplete reporting year(s): ${metrics.annual.incompleteYears.join(', ')}`
    : '';

  return {
    type: 'dashboard',
    summary,
    sections,
    meta: {
      basedOn: `Pasig City • All Years${coverage}`,
      unavailable: metrics.unavailable || [],
      generatedAt: new Date().toISOString(),
      // Explicitly template-based — never describe this as LLM output.
      method: 'template-nlg',
    },
  };
}

module.exports = {
  buildDashboardMetrics,
  generateDashboardInsight,
  MIN_MONTHS_FOR_COMPLETE_YEAR,
};
