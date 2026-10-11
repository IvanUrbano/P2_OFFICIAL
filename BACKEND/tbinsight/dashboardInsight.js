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
const { loadAdjacency } = require('./barangayAdjacency');

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
    // identified from the data rather than assumed. `last_month` is the last month of
    // the year that has data; `ytd_cases` counts only the months up to the month the
    // newest record falls in, so a year still in progress can be compared with the
    // SAME months of the year before instead of with its full 12 months.
    safe(pool.query(`
      SELECT EXTRACT(YEAR FROM date_of_diagnosis)::INTEGER AS year,
             COUNT(*)::INTEGER AS case_count,
             COUNT(DISTINCT DATE_TRUNC('month', date_of_diagnosis))::INTEGER AS months_covered,
             MAX(EXTRACT(MONTH FROM date_of_diagnosis))::INTEGER AS last_month,
             COUNT(*) FILTER (
               WHERE EXTRACT(MONTH FROM date_of_diagnosis) <=
                 (SELECT EXTRACT(MONTH FROM MAX(date_of_diagnosis))::INTEGER FROM tb_cases
                  WHERE date_of_diagnosis IS NOT NULL AND ${countedCases()})
             )::INTEGER AS ytd_cases
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

    // Persisted forecast rows for ONE period: the first forecast month after the latest
    // recorded case (the "next month"), so every forecast figure on the Dashboard talks
    // about the same month. Falls back to the newest period when none lies ahead.
    safe(pool.query(`
      SELECT barangay_name, forecasted_count, method,
             EXTRACT(YEAR FROM period)::INTEGER AS period_year,
             EXTRACT(MONTH FROM period)::INTEGER AS period_month
      FROM model_predictions
      WHERE period = COALESCE(
        (SELECT MIN(period) FROM model_predictions
          WHERE period > (SELECT MAX(date_of_diagnosis) FROM tb_cases
                           WHERE date_of_diagnosis IS NOT NULL AND ${countedCases()})),
        (SELECT MAX(period) FROM model_predictions)
      )
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
      WHERE case_status = 'ON TREATMENT'
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
    const years = yearlyRes.rows.map((r) => {
      const monthsCovered = Number(r.months_covered);
      return {
        year: Number(r.year),
        cases: Number(r.case_count),
        monthsCovered,
        // Last month that has data; a year with all 12 months is complete by definition.
        lastMonth: r.last_month != null ? Number(r.last_month) : (monthsCovered >= 12 ? 12 : null),
        ytdCases: r.ytd_cases != null ? Number(r.ytd_cases) : null,
        complete: monthsCovered >= MIN_MONTHS_FOR_COMPLETE_YEAR,
      };
    });
    const usable = years.filter((y) => y.complete);
    const incompleteYears = years.filter((y) => !y.complete).map((y) => y.year);
    // A usable year whose data stops before December is still in progress. Comparing its
    // partial total with a full previous year would read as a large drop that is not real,
    // so full-year comparisons use only years that run to December.
    const latestUsable = usable.length > 0 ? usable[usable.length - 1] : null;
    const inProgress = latestUsable && latestUsable.lastMonth != null && latestUsable.lastMonth < 12
      ? latestUsable : null;
    const complete = usable.filter((y) => y !== inProgress);
    const latest = complete.length > 0 ? complete[complete.length - 1] : null;
    const prior = complete.length > 1 ? complete[complete.length - 2] : null;

    // Year to date: the in-progress year against the same months of the year before.
    let yearToDate = null;
    if (inProgress) {
      const prev = years.find((y) => y.year === inProgress.year - 1 && y.complete);
      yearToDate = { year: inProgress.year, throughMonth: inProgress.lastMonth, cases: inProgress.cases };
      if (prev && prev.ytdCases > 0) {
        yearToDate.priorYear = prev.year;
        yearToDate.priorCases = prev.ytdCases;
        yearToDate.changePercent = Math.round(((inProgress.cases - prev.ytdCases) / prev.ytdCases) * 1000) / 10;
      }
    }

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
      inProgressYear: inProgress ? inProgress.year : null,
      yearToDate,
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
    // The snapshot's own year is the assessment year (the GIS API reports it the same
    // way). It used to subtract 1, which labelled an October 2026 snapshot "2025".
    const periodYear = riskRes.rows[0]?.period_year;
    counts.assessmentYear = periodYear ? Number(periodYear) : null;
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

  // --- Map pattern: connected groups of High Risk barangays (shared borders) ---
  let mapPattern = null;
  if (highRiskBarangays && highRiskBarangays.length > 0) {
    try {
      const adj = await loadAdjacency(pool);
      if (adj) {
        const high = new Set(highRiskBarangays);
        const seen = new Set();
        const groups = [];
        for (const start of highRiskBarangays) {
          if (seen.has(start)) continue;
          const group = [];
          const stack = [start];
          seen.add(start);
          while (stack.length) {
            const cur = stack.pop();
            group.push(cur);
            for (const nb of adj[cur] || []) {
              if (high.has(nb) && !seen.has(nb)) { seen.add(nb); stack.push(nb); }
            }
          }
          groups.push(group.sort());
        }
        groups.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
        mapPattern = {
          clusters: groups.filter((g) => g.length > 1),
          isolated: groups.filter((g) => g.length === 1).map((g) => g[0]).sort(),
        };
      }
    } catch (err) {
      console.error('Dashboard metric failed (map):', err.message);
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

  // --- Forecast (persisted model_predictions, one period) ---
  // Tier follows what the rows actually say: 'arima' is ARIMA, 'insufficient_data' means
  // no forecast was produced for that barangay, and any other method is a fallback used
  // when a barangay's case history is too sparse for ARIMA. The forecast as a whole is
  // labelled by its coverage:
  //   arima    every usable barangay is ARIMA
  //   mixed    ARIMA for most barangays, a fallback for the sparse ones (stays an ARIMA Forecast
  //            and names the exceptions — one sparse barangay must not relabel the whole city)
  //   baseline no usable barangay is ARIMA
  let forecast = null;
  if (forecastRes && forecastRes.rows.length > 0) {
    const rows = forecastRes.rows;
    const methods = [...new Set(rows.map((r) => r.method).filter(Boolean))];
    const usable = rows.filter((r) => r.method !== 'insufficient_data');
    const arimaRows = usable.filter((r) => r.method === 'arima');
    const fallbackRows = usable.filter((r) => r.method && r.method !== 'arima');
    const sum = (list) => list.reduce((t, r) => t + Number(r.forecasted_count || 0), 0);
    const tier = usable.length === 0
      ? 'insufficient_data'
      : fallbackRows.length === 0 ? 'arima'
        : arimaRows.length === 0 ? 'baseline' : 'mixed';
    forecast = {
      periodYear: rows[0].period_year ? Number(rows[0].period_year) : null,
      periodMonth: rows[0].period_month ? Number(rows[0].period_month) : null,
      total: usable.length === 0 ? null : Math.round(sum(usable)),
      barangays: usable.length,
      methods,
      tier,
      tierLabel: tier === 'insufficient_data'
        ? 'Insufficient Historical Data'
        : tier === 'baseline' ? 'Baseline Forecast' : 'ARIMA Forecast',
      arimaBarangays: arimaRows.length,
      fallbackBarangays: fallbackRows.map((r) => r.barangay_name).sort(),
      fallbackMethods: [...new Set(fallbackRows.map((r) => r.method))],
      fallbackTotal: Math.round(sum(fallbackRows) * 10) / 10,
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
    mapPattern,
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
    const ytd = a.yearToDate;
    // A year still in progress is compared with the SAME months of the year before,
    // never with that year's full total.
    if (ytd && ytd.changePercent != null) {
      const pct = Math.abs(ytd.changePercent);
      const how = pct < 1 ? 'about the same as' : `${pct}% ${ytd.changePercent > 0 ? 'higher than' : 'lower than'}`;
      parts.push(`Year to date (January–${MONTH_NAMES[ytd.throughMonth]}), **${ytd.year}** recorded **${ytd.cases.toLocaleString()}** cases — **${how}** the same months of ${ytd.priorYear} (${ytd.priorCases.toLocaleString()} cases).`);
    } else if (ytd) {
      parts.push(`**${ytd.year}** has **${ytd.cases.toLocaleString()}** cases recorded through ${MONTH_NAMES[ytd.throughMonth]}; the same months of the previous year are not available for comparison.`);
    }
    if (a.yoyChangePercent != null && a.latestCompleteYear != null) {
      const dir = a.yoyChangePercent > 0 ? 'higher than' : a.yoyChangePercent < 0 ? 'lower than' : 'level with';
      parts.push(`Across full reporting years, **${a.latestCompleteYear}** recorded **${a.latestYearCases.toLocaleString()}** cases — **${Math.abs(a.yoyChangePercent)}% ${dir}** ${a.previousYear} (${a.previousYearCases.toLocaleString()} cases).`);
    } else if (a.yoyUnavailableReason && !ytd) {
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
    text += others > 0 ? `, including ${names}, and ${others} others.` : `: ${names || 'see GIS Mapping'}.`;
  }
  if (r.noData > 0) {
    text += ` **${r.noData}** barangay(s) have no classification in this snapshot and are reported as No Assessment rather than Low Risk.`;
  }
  return { id: 'riskSituation', title: 'Risk Situation', text };
}

function buildMapInterpretation(m) {
  if (!m.riskCounts) return null;
  const r = m.riskCounts;
  const year = r.assessmentYear ? `${r.assessmentYear} ` : '';
  if (r.high === 0) {
    return {
      id: 'mapInterpretation',
      title: 'Map Interpretation',
      text: `No barangay is classified High Risk in the latest ${year}map, so there is no High Risk area to interpret. **${r.medium}** are Medium and **${r.low}** are Low.`,
    };
  }
  const p = m.mapPattern;
  if (!p) return null; // border data unavailable: no spatial claim is made
  const join = (a) => a.join(', ');
  const parts = [];
  if (p.clusters.length === 0) {
    parts.push(`The **${r.high}** High Risk barangays on the ${year}map are scattered: none shares a border with another High Risk barangay (${join(p.isolated)}).`);
  } else {
    const [big, ...rest] = p.clusters;
    parts.push(`On the ${year}map, **${big.length}** of the **${r.high}** High Risk barangays are connected along shared borders, forming the largest High Risk area: ${join(big)}.`);
    rest.forEach((g) => parts.push(`A second connected group: ${join(g)}.`));
    if (p.isolated.length > 0) {
      parts.push(`${p.isolated.length === 1 ? '**1** is' : `**${p.isolated.length}** are`} High Risk without a High Risk neighbour: ${join(p.isolated)}.`);
    }
  }
  parts.push('Adjacency is based on shared barangay boundaries; it describes where High Risk areas sit, not why.');
  return { id: 'mapInterpretation', title: 'Map Interpretation', text: parts.join(' ') };
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
  let text = `The **${f.tierLabel}** projects **${f.total.toLocaleString()}** cases${periodText} across ${f.barangays} barangay(s).`;
  if (f.tier === 'mixed') {
    const names = f.fallbackBarangays.join(', ');
    const methods = f.fallbackMethods.map((x) => String(x).replace(/_/g, ' ')).join(' / ');
    text += ` ${f.arimaBarangays} barangay(s) use ARIMA; ${f.fallbackBarangays.length} (${names}) use ${methods} because their case history is too sparse for ARIMA, adding ${f.fallbackTotal.toLocaleString()} of the projected cases.`;
  } else if (f.tier === 'baseline') {
    text += ' This is a Baseline Forecast, not ARIMA: every barangay\'s case history was too sparse for ARIMA.';
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
      parts.push(`Reported TB cases rose ${Math.abs(m.trend.changePercent)}% in the last 3 months compared with the 3 months before.`);
    } else if (m.trend.direction === 'decreasing') {
      parts.push(`Reported TB cases fell ${Math.abs(m.trend.changePercent)}% in the last 3 months compared with the 3 months before.`);
    } else {
      parts.push('Reported TB cases were about the same in the last 3 months as in the 3 months before.');
    }
  }
  if (m.riskCounts) {
    parts.push(m.riskCounts.high > 0
      ? `${m.riskCounts.high} of ${m.riskCounts.assessed} assessed barangays are High Risk in the latest assessment.`
      : 'No barangays are High Risk in the latest assessment.');
  }
  if (m.treatment?.successRate != null) {
    parts.push(`Treatment success was ${m.treatment.successRate}%${m.treatment.cohortYear ? ` for the ${m.treatment.cohortYear} treatment cohort` : ' for the treatment cohort'}.`);
  }
  if (m.treatment?.fatalityRate != null) {
    parts.push(`The case fatality rate was ${m.treatment.fatalityRate}% among patients with an evaluated final outcome.`);
  }
  if (parts.length === 0) {
    return 'No overview could be generated yet: none of the underlying metrics are available for the current data.';
  }
  return parts.join(' ');
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
    () => buildMapInterpretation(metrics),
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

  const coverage = [
    metrics.annual?.incompleteYears?.length
      ? ` • Incomplete reporting year(s): ${metrics.annual.incompleteYears.join(', ')}`
      : '',
    metrics.annual?.yearToDate
      ? ` • ${metrics.annual.yearToDate.year} is year to date (through ${MONTH_NAMES[metrics.annual.yearToDate.throughMonth]})`
      : '',
  ].join('');

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
