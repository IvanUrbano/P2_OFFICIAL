/**
 * NLG Engine — Template-Based Natural Language Generation
 *
 * Converts computed metrics objects into structured text sections.
 * NEVER calculates — only formats pre-computed values into readable text.
 *
 * Exports:
 *   generateAnalyticsInsight(metrics, filters) -> { type, sections, meta }
 *   generateForecastingInsight(metrics, filters) -> { type, sections, meta }
 *   generateGisInsight(metrics, filters) -> { type, sections, meta }
 */

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatMonth(dateStr) {
  if (!dateStr) return 'Unknown';
  const d = new Date(dateStr);
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function abs(n) {
  return Math.abs(n);
}

// ============================================================
//  ANALYTICS INSIGHT — 7 sections
// ============================================================

function buildKeyTrend(m, noData) {
  if (noData) {
    return { id: 'keyTrend', title: 'Key Trend', text: 'No TB records matched the selected filters, so a trend comparison cannot be calculated.' };
  }
  if (!m.trend) return null;
  const { direction, changePercent, recentCount, priorCount } = m.trend;
  let text;
  if (direction === 'increasing') {
    text = `The last 3 months had **${recentCount}** reported TB cases, **${abs(changePercent)}% more** than the 3 months before (${priorCount}).`;
  } else if (direction === 'decreasing') {
    text = `The last 3 months had **${recentCount}** reported TB cases, **${abs(changePercent)}% fewer** than the 3 months before (${priorCount}).`;
  } else {
    text = `Reported TB cases were **about the same** in the last 3 months (${recentCount}) as in the 3 months before (${priorCount}).`;
  }
  return { id: 'keyTrend', title: 'Key Trend', text };
}

function buildHighestLowest(m, filters = {}) {
  if (filters.barangay) return null;
  if ((m.unavailable || []).includes('highestLowest')) return null;
  const h = m.highestBarangay;
  const l = m.lowestBarangay;
  const hasData = h && l;
  const isSame = hasData && h.name === l.name;
  let text;
  if (!hasData) {
    text = 'No barangay data available for the selected period.';
  } else if (isSame) {
    text = `Barangay **${h.name}** recorded both the highest and lowest case counts (${h.total} cases), as only one barangay reported cases during this period.`;
  } else {
    text = `Barangay **${h.name}** recorded the highest case count (${h.total} cases), while Barangay **${l.name}** recorded the lowest (${l.total} cases).`;
  }
  return { id: 'highestLowest', title: 'Highest / Lowest', text };
}

function buildSignificantChanges(m) {
  const sig = m.significantChanges;
  if (!Array.isArray(sig)) return null;
  const hasIncrease = sig.some((s) => s.caseCount > s.historicalMean);
  const hasDecrease = sig.some((s) => s.caseCount < s.historicalMean);
  let text;
  if (sig.length === 0) {
    text = 'No barangay had a notable change from its usual monthly case count during this period.';
  } else if (hasIncrease) {
    const items = sig.filter((s) => s.caseCount > s.historicalMean);
    const first = items[0];
    const pctChange = first.historicalMean > 0
      ? Math.round(((first.caseCount - first.historicalMean) / first.historicalMean) * 100)
      : 0;
    text = `In ${formatMonth(first.month)}, **${first.barangay}** had **${pctChange}% more cases** than its usual monthly average (${first.caseCount} versus ${Math.round(first.historicalMean)}).`;
  } else {
    const first = sig[0];
    text = `In ${formatMonth(first.month)}, **${first.barangay}** had a notable change from its usual monthly average (${first.caseCount} versus ${Math.round(first.historicalMean)}).`;
  }
  return { id: 'significantChanges', title: 'Significant Changes', text };
}

function buildRiskFindings(m, filters = {}) {
  const caveat = ' Classification reflects the latest barangay-level assessment rather than the current filter selection.';
  // Single-barangay selection: state that barangay's own RF classification
  // instead of an aggregate city-wide distribution that ignores the filter.
  if (filters.barangay && m.riskByBarangay) {
    const riskClass = m.riskByBarangay[filters.barangay];
    if (!riskClass) return null;
    const label = /^(High|Medium|Low)$/i.test(riskClass) ? `${riskClass} Risk` : riskClass;
    const text = `The latest assessment places **${filters.barangay}** in the **${label}** group.` + caveat;
    return { id: 'riskFindings', title: 'Risk Findings', text };
  }
  if (!m.riskCounts) return null;
  const highCount = m.riskCounts.high;
  const medCount = m.riskCounts.medium;
  const names = m.highRiskBarangays || [];
  // Denominator comes from the snapshot's own assessed count, never a
  // hardcoded 30: if a barangay has no persisted classification it is not
  // part of "N of M", and saying 30 would claim coverage that does not exist.
  const assessed = m.riskCounts.assessed;
  const ofAssessed = assessed ? ` of ${assessed} assessed barangays` : ' barangays';
  let text;
  if (highCount === 0) {
    text = 'No barangays are classified High Risk in the latest assessment.';
    if (medCount > 0) {
      text += ` However, ${medCount} barangay(s) are classified as medium-risk and should continue to be monitored.`;
    }
  } else if (highCount <= 5) {
    text = `**${highCount}**${ofAssessed} are **High Risk**: ${names.join(', ')}.`;
  } else {
    const top4 = names.slice(0, 4).join(', ');
    const others = highCount - 4;
    text = `**${highCount}**${ofAssessed} are **High Risk**, including ${top4} and ${others} others.`;
  }
  if (m.riskCounts.noData > 0) {
    text += ` ${m.riskCounts.noData} barangay(s) have no classification in this snapshot.`;
  }
  text += caveat;
  return { id: 'riskFindings', title: 'Risk Findings', text };
}

function buildDemographics(m, filters = {}) {
  if (!m.demographics || !m.demographics.sexSplit) return null;
  const { male, female } = m.demographics.sexSplit;
  const age = m.demographics.dominantAgeGroup;
  const ageText = age ? `The **${age.group}** age group has the largest share of cases (**${age.percentage}%**).` : '';

  if (male === 0 && female === 0) {
    return { id: 'demographics', title: 'Demographics', text: 'No demographic data available for the selected period.' };
  }
  if (filters.sex) {
    // Both demographic dimensions filtered → nothing left to describe.
    if (filters.ageGroup) return null;
    if (!age) return null;
    return { id: 'demographics', title: 'Demographics', text: ageText };
  }
  if (filters.ageGroup) {
    // Dominant-age statement would merely restate the active age filter.
    return { id: 'demographics', title: 'Demographics', text: sexSentence(male, female) };
  }
  const text = `${sexSentence(male, female)} ${ageText}`.trim();
  return { id: 'demographics', title: 'Demographics', text };
}

// Shared sex-split sentence used by Demographics (and filter variants).
function sexSentence(male, female) {
  if (male > female + 5) {
    return `Males account for **${male}%** of reported cases.`;
  }
  if (female > male + 5) {
    return `Females account for **${female}%** of reported cases.`;
  }
  return `Cases were relatively balanced by sex, with males at **${male}%** and females at **${female}%**.`;
}

function buildTreatment(m) {
  if (!m.treatment) return null;
  const rate = m.treatment.successRate;
  const fatalityRate = m.treatment.fatalityRate;
  let text;
  if (rate === null || rate === undefined) {
    text = 'Treatment success cannot be calculated because data for the previous treatment cohort is unavailable.';
  } else {
    text = `Treatment success was **${rate}%**`;
    const context = [];
    if (m.treatment.cohortYear) context.push(`for the ${m.treatment.cohortYear} treatment cohort`);
    if (m.treatment.cohortTotal) context.push(`${m.treatment.cohortTotal.toLocaleString()} patients`);
    if (context.length > 0) text += ` ${context.join(' — ')}`;
    text += '.';
  }
  if (fatalityRate === null || fatalityRate === undefined) {
    text += ' The case fatality rate is unavailable because no final outcomes have been recorded for this selection.';
  } else {
    text += ` Among patients with an evaluated final outcome, **${fatalityRate}%** died.`;
  }
  return { id: 'treatment', title: 'Treatment', text };
}

function buildAnalyticsOverallSummary(m, filters = {}) {
  if (m.noData) {
    return { id: 'overallSummary', title: 'Overall Summary', text: 'No analytical insight is available for the selected filters because no matching TB records were found.' };
  }
  const parts = [];
  // Trend — omitted when the trend metric is unavailable
  if (m.trend) {
    if (m.trend.direction === 'increasing') {
      parts.push(`Reported TB cases rose ${abs(m.trend.changePercent)}% in the last 3 months compared with the 3 months before.`);
    } else if (m.trend.direction === 'decreasing') {
      parts.push(`Reported TB cases fell ${abs(m.trend.changePercent)}% in the last 3 months compared with the 3 months before.`);
    } else {
      parts.push('Reported TB cases were about the same in the last 3 months as in the 3 months before.');
    }
  }
  // Risk — omitted when the risk metric is unavailable
  if (m.riskCounts) {
    if (m.riskCounts.high > 0) {
      const assessed = m.riskCounts.assessed;
      const phrase = assessed
        ? `${m.riskCounts.high} of ${assessed} assessed barangays are High Risk.`
        : `${m.riskCounts.high} barangays are High Risk.`;
      parts.push(phrase);
    } else {
      parts.push('No barangays are classified High Risk in the latest assessment.');
    }
  }
  // Demographics — skip when a sex/age filter makes the split a tautology
  // or when the demographics metric is unavailable
  if (m.demographics && m.demographics.sexSplit) {
    const { male, female } = m.demographics.sexSplit;
    if ((male > 0 || female > 0) && !filters.sex && !filters.ageGroup) {
      const dominant = male > female ? 'Male' : female > male ? 'Female' : null;
      if (dominant) {
        parts.push(`${dominant} patients account for the larger share of reported cases.`);
      }
    }
  }
  // Treatment — omitted when TSR/CFR could not be computed
  if (m.treatment) {
    if (m.treatment.successRate !== null && m.treatment.successRate !== undefined) {
      parts.push(`Treatment success was ${m.treatment.successRate}% for the treatment cohort.`);
    }
    if (m.treatment.fatalityRate !== null && m.treatment.fatalityRate !== undefined) {
      parts.push(`The case fatality rate was ${m.treatment.fatalityRate}% among patients with an evaluated final outcome.`);
    }
  }
  if (parts.length === 0) {
    return {
      id: 'overallSummary',
      title: 'Overall Summary',
      text: 'Matching TB records were found, but no supporting metrics could be computed for this selection.',
    };
  }
  return { id: 'overallSummary', title: 'Overall Summary', text: parts.join(' ') };
}

/**
 * Generate analytics insight sections from computed metrics.
 * Sections are filter-aware: irrelevant sections are omitted (return null)
 * and filtered out. Zero matching records produces a single no-data section.
 */
function generateAnalyticsInsight(metrics, filters = {}) {
  const noData = !metrics.summary || !metrics.summary.totalCases;
  const basedOnParts = () => {
    const parts = [];
    if (filters.year) parts.push(filters.year);
    else parts.push('All Years');
    if (filters.month) parts.push(MONTH_NAMES[Number(filters.month)] || filters.month);
    if (filters.barangay) parts.push(filters.barangay);
    else parts.push('All Barangays');
    if (filters.facility) parts.push(filters.facility);
    if (filters.sex) parts.push(filters.sex);
    if (filters.ageGroup) parts.push(`Age ${filters.ageGroup}`);
    if (filters.bacteriological) parts.push(filters.bacteriological);
    if (filters.status) parts.push(`Case status: ${filters.status}`);
    if (filters.outcome) parts.push(`Treatment outcome: ${filters.outcome}`);
    return parts;
  };

  if (noData) {
    metrics.noData = true;
    return {
      type: 'analytics',
      sections: [
        { id: 'overallSummary', title: 'Overall Summary', text: 'No analytical insight is available for the selected filters because no matching TB records were found.' },
      ],
      meta: {
        basedOn: basedOnParts().join(' • '),
        generatedAt: new Date().toISOString(),
      },
    };
  }

  // Per-section isolation: a failing builder omits only its own section and
  // is logged — it never fails the whole response.
  const builders = [
    () => buildKeyTrend(metrics, noData),
    () => buildHighestLowest(metrics, filters),
    () => buildSignificantChanges(metrics),
    () => buildRiskFindings(metrics, filters),
    () => buildDemographics(metrics, filters),
    () => buildTreatment(metrics),
    () => buildAnalyticsOverallSummary(metrics, filters),
  ];
  const sections = [];
  for (const build of builders) {
    try {
      const section = build();
      if (section) sections.push(section);
    } catch (err) {
      console.error('NLG section builder failed:', err.message);
    }
  }

  return {
    type: 'analytics',
    sections,
    meta: {
      basedOn: basedOnParts().join(' • '),
      generatedAt: new Date().toISOString(),
    },
  };
}

// ============================================================
//  FORECASTING INSIGHT — 7 sections
// ============================================================

function buildForecastDirection(m) {
  const { trend, growthRate } = m.direction;
  const horizon = m.predictedCases.horizon || m.modelInfo.horizon || 3;
  const tier = m.modelInfo?.tier;
  let text;
  if (tier === 'insufficient_data' || tier === 'none') {
    text = 'There are too few past monthly records to estimate future cases for this selection.';
  } else if (growthRate == null) {
    text = 'A trend comparison is unavailable because the past monthly average is zero.';
  } else if (tier === 'baseline') {
    text = 'There are too few past months for the full model. This is a **preliminary estimate** based on the available case history.';
  } else if (trend === 'increasing') {
    text = `The forecast suggests **more TB cases** over the next ${horizon} months.`;
  } else if (trend === 'decreasing') {
    text = `The forecast suggests **fewer TB cases** over the next ${horizon} months.`;
  } else {
    text = `The forecast suggests TB cases will stay **relatively stable** over the next ${horizon} months.`;
  }
  return { id: 'forecastDirection', title: 'Forecast Direction', text };
}

function buildPredictedCases(m) {
  const { total, monthlyAvg, horizon, available } = m.predictedCases;
  let text;
  if (available === true || (available == null && total > 0)) {
    text = `About **${total}** cases are projected across the next ${horizon} months, or **${monthlyAvg}** per month on average.`;
  } else {
    text = 'No forecast data available for the selected parameters.';
  }
  return { id: 'predictedCases', title: 'Predicted Cases', text };
}

function buildPeakPeriod(m) {
  const { label, count } = m.peakPeriod;
  let text;
  if (label) {
    text = `**${label}** is projected to have the most cases (**${count}**).`;
  } else {
    text = 'Unable to determine peak period from the available forecast data.';
  }
  return { id: 'peakPeriod', title: 'Peak Period', text };
}

function buildGrowthRate(m) {
  const { growthRate } = m.direction;
  let text;
  if (growthRate == null) {
    text = 'Expected growth rate is unavailable because the selected historical range has no positive monthly baseline.';
  } else if (growthRate > 0) {
    text = `The forecast is **${growthRate}% above** the average of past months.`;
  } else if (growthRate < 0) {
    text = `The forecast is **${Math.abs(growthRate)}% below** the average of past months (declining).`;
  } else {
    text = 'The forecast shows **no significant change** from the average of past months.';
  }
  return { id: 'growthRate', title: 'Growth Rate', text };
}

function buildHighRiskAreas(m) {
  const names = m.highRiskForecastBarangays;
  const count = names.length;
  let text;
  if (m.riskAssessmentAvailable === false) {
    text = 'No current risk assessment is available for the selected barangays.';
  } else if (count === 0) {
    text = 'No barangays are classified High Risk in the current assessment.';
  } else if (count <= 5) {
    text = `The current assessment classifies **${count}** ${count === 1 ? 'barangay' : 'barangays'} as High Risk: ${names.join(', ')}.`;
  } else {
    const top4 = names.slice(0, 4).join(', ');
    text = `The current assessment classifies **${count}** barangays as High Risk, including ${top4}.`;
  }
  return { id: 'highRiskAreas', title: 'High-Risk Areas', text };
}

function buildConfidence(m) {
  const { interpretation } = m.confidence;
  let text;
  if (interpretation === 'narrow') {
    text = 'The likely range around the forecast is **narrow**. Actual case counts may still differ.';
  } else if (interpretation === 'moderate') {
    text = 'The likely range around the forecast is **moderate**. Actual case counts may differ.';
  } else {
    text = 'The likely range around the forecast is **wide**, so actual case counts could differ considerably.';
  }
  return { id: 'confidence', title: 'Forecast Confidence', text };
}

function buildForecastOverallSummary(m) {
  const tier = m.modelInfo?.tier;
  if (tier === 'insufficient_data' || tier === 'none') {
    return {
      id: 'overallSummary',
      title: 'Overall Summary',
      text: 'There are too few past monthly records to estimate future cases for this selection.',
    };
  }
  const parts = [];
  if (m.direction.growthRate == null) {
    parts.push('A comparison with past months is unavailable because the past monthly average is zero.');
  } else if (tier === 'baseline') {
    parts.push('This is a preliminary estimate because there are too few past months for the full model.');
  } else if (m.direction.growthRate > 5) {
    parts.push('The forecast suggests more TB cases than the average of past months.');
  } else if (m.direction.growthRate < -5) {
    parts.push('The forecast suggests fewer TB cases than the average of past months.');
  } else {
    parts.push('The forecast suggests case counts will stay close to the average of past months.');
  }
  if (m.predictedCases.available === true || (m.predictedCases.available == null && m.predictedCases.total > 0)) {
    const horizon = m.predictedCases.horizon || m.modelInfo?.horizon;
    parts.push(`About ${m.predictedCases.total} cases are projected ${horizon ? `over the next ${horizon} months` : 'for the selected forecast period'}.`);
  }
  if (m.peakPeriod.label) {
    parts.push(`${m.peakPeriod.label} has the highest monthly estimate (${m.peakPeriod.count} cases).`);
  }
  if (m.confidence.avgRelativeCIWidth > 0.6) {
    parts.push('The wide forecast range means actual case counts could differ considerably.');
  }
  return { id: 'overallSummary', title: 'Overall Summary', text: parts.join(' ') };
}

/**
 * Generate forecasting insight sections from computed metrics.
 */
function generateForecastingInsight(metrics, filters = {}) {
  const sections = [
    buildForecastDirection(metrics),
    buildPredictedCases(metrics),
    buildPeakPeriod(metrics),
    buildGrowthRate(metrics),
    buildHighRiskAreas(metrics),
    buildConfidence(metrics),
    buildForecastOverallSummary(metrics),
  ];

  const parts = [];
  if (filters.startYear) parts.push(filters.startYear);
  if (filters.endYear && filters.endYear !== filters.startYear) parts.push(filters.endYear);
  if (filters.barangay) parts.push(filters.barangay);
  else parts.push('All Barangays');
  if (filters.horizon) parts.push(`${filters.horizon}-Month Forecast`);

  return {
    type: 'forecasting',
    sections,
    meta: {
      basedOn: parts.join(' • '),
      generatedAt: new Date().toISOString(),
    },
  };
}

// ============================================================
//  GIS INSIGHT — 6 sections
// ============================================================

/**
 * Guard: when matching-year population reference data is unavailable for the
 * risk period, no incidence-based interpretation may be generated.
 */
function incidenceUnavailableNote(m) {
  const year = m.coverage?.periodYear ?? m.incidence?.periodYear;
  if (year) {
    return `Incidence interpretation is unavailable for ${year} because matching-year population reference data is not configured.`;
  }
  return 'Incidence interpretation is unavailable for the current map period because matching-year population reference data is not configured.';
}

const MONTH_NAMES_GIS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function buildGisRiskOverview(m) {
  const rc = m.riskCounts || {};
  const cov = m.coverage || {};
  const total = cov.totalBarangays || 0;
  let text;
  if (total === 0 || (cov.scoredBarangays || 0) === 0) {
    text =
      'No risk classifications have been generated for the map yet. Run the prediction pipeline to classify barangays.';
  } else {
    text = `For ${cov.periodYear ? `the **${cov.periodYear}** assessment, ` : ''}**${rc.High || 0}** of **${total}** barangays are **High** risk, **${rc.Medium || 0}** are **Medium**, and **${rc.Low || 0}** are **Low**. **${rc['No Data'] || 0}** have **No Data**${cov.dataYear ? `; case data are from **${cov.dataYear}**` : ''}.`;
    if (m.focus) {
      const f = m.focus;
      text += ` **${f.name}** is classified **${f.risk_class}**${f.rank && f.incidence_per_100k != null ? ` and ranks ${f.rank} of ${f.total_scored} assessed barangays by incidence` : ''}.`;
    }
    if (m.incidence && m.incidence.available === false) {
      text += ` ${incidenceUnavailableNote(m)}`;
    }
  }
  return { id: 'riskOverview', title: 'Risk Overview', text };
}

function buildGisTopHotspots(m) {
  const spots = m.topHotspots || [];
  if (spots.length === 0) {
    return {
      id: 'topHotspots',
      title: 'Top Hotspots',
      text: 'No barangays currently have risk scores for this period.',
    };
  }
  const incidenceAvailable = m.incidence && m.incidence.available === true;
  const year = m.coverage?.caseYear;
  const partial = incidenceAvailable && year && m.coverage?.latestCaseMonth
    ? ` (so far in ${year}, January to ${MONTH_NAMES_GIS[m.coverage.latestCaseMonth - 1]})`
    : '';
  let text;
  if (incidenceAvailable) {
    const names = spots
      .map((s) => `**${s.name}** (${s.risk_class}${s.incidence_per_100k != null ? `, ${s.incidence_per_100k} per 100,000` : ''})`)
      .join(', ');
    text = `Ranked by cases per 100,000 population${year ? ` in ${year}` : ''}${partial}, the highest are ${names}. Incidence accounts for population size.`;
  } else {
    const names = spots.map((s) => `**${s.name}** (${s.risk_class})`).join(', ');
    text = `The barangays classified at the highest risk are ${names}.`;
  }
  return { id: 'topHotspots', title: 'Top Hotspots', text };
}

function buildGisCaseConcentration(m) {
  const c = m.concentration || {};
  if (!c.totalCases || c.top5CaseSharePct === null || c.top5CaseSharePct === undefined) {
    return {
      id: 'caseConcentration',
      title: 'Case Concentration',
      text: 'No reported case data is available to assess case concentration.',
    };
  }
  const top5Count = (c.top5 || []).reduce((s, r) => s + (r.total_cases || 0), 0);
  const names = (c.top5 || []).map((r) => r.name).join(', ');
  const text = `The five barangays with the most cases account for **${c.top5CaseSharePct}%** of reported TB cases ${c.scope === 'year' ? 'in the selected year' : 'across all years'} (**${top5Count}** of **${c.totalCases}**): ${names}.`;
  return { id: 'caseConcentration', title: 'Case Concentration', text };
}

function buildGisCasesVsRiskPatterns(m) {
  const p = m.casesVsRiskPatterns || {};
  const highLow = p.highRiskLowerCaseCount || 0;
  const caseLow = p.highCaseCountLowerRisk || 0;
  if (highLow === 0 && caseLow === 0) {
    return {
      id: 'casesVsRiskPatterns',
      title: 'Cases vs Risk Patterns',
      text: 'Risk classifications and reported case counts are closely aligned across barangays for this period.',
    };
  }
  let text = `**${highLow}** ${highLow === 1 ? 'barangay has' : 'barangays have'} **High** risk despite fewer cases than the middle barangay. **${caseLow}** ${caseLow === 1 ? 'barangay has' : 'barangays have'} among the highest case counts but are not classified **High** risk.`;
  const incidenceAvailable = m.incidence && m.incidence.available === true;
  if (incidenceAvailable) {
    text += ' Risk also considers cases relative to population, recent trends, recent monthly cases, and neighboring barangays.';
  } else {
    text += ' Risk also uses measures beyond the total case count.';
  }
  const hlNames = (p.highRiskLowerCase || []).slice(0, 3).map((r) => r.name);
  if (hlNames.length > 0) {
    text += ` These High Risk barangays include ${hlNames.join(', ')}.`;
  }
  return { id: 'casesVsRiskPatterns', title: 'Cases vs Risk Patterns', text };
}

function buildGisTrendDistribution(m) {
  const t = m.trendCounts || {};
  const scored = (m.coverage && m.coverage.scoredBarangays) || 0;
  if (scored === 0) {
    return {
      id: 'trendDistribution',
      title: 'Trend Distribution',
      text: 'No classified barangays are available to summarize case trends.',
    };
  }
  const text = `Of **${scored}** classified barangays, **${t.Increasing || 0}** show an **Increasing** long-term trend, **${t.Decreasing || 0}** a **Decreasing** long-term trend, and **${t.Stable || 0}** a **Stable** one. These labels describe the overall slope of each barangay's monthly cases, not the latest few months.`;
  return { id: 'trendDistribution', title: 'Trend Distribution', text };
}

function buildGisOverallSummary(m) {
  const rc = m.riskCounts || {};
  const cov = m.coverage || {};
  const parts = [];
  if ((cov.scoredBarangays || 0) === 0) {
    parts.push('No risk classifications are available yet for this map period.');
  } else {
    parts.push(`${rc.High || 0} barangay(s) are classified High risk${cov.periodYear ? ` in the ${cov.periodYear} risk period` : ''}.`);
    if (m.concentration && m.concentration.top5CaseSharePct != null) {
      parts.push(`${m.concentration.top5CaseSharePct}% of reported cases ${m.concentration.scope === 'year' ? 'in the selected year' : 'across all years'} are in the five barangays with the most cases.`);
    }
    const t = m.trendCounts || {};
    if ((t.Increasing || 0) > (t.Decreasing || 0)) {
      parts.push('More barangays show an increasing than a decreasing long-term case trend.');
    } else if ((t.Decreasing || 0) > (t.Increasing || 0)) {
      parts.push('More barangays show a decreasing than an increasing long-term case trend.');
    } else if ((t.Increasing || 0) > 0) {
      parts.push('Increasing and decreasing long-term case trends are equally common.');
    }
  }
  if (m.incidence && m.incidence.available === false && (cov.scoredBarangays || 0) > 0) {
    parts.push(incidenceUnavailableNote(m));
  }
  return { id: 'overallSummary', title: 'Overall Summary', text: parts.join(' ') };
}

/**
 * Generate GIS insight sections from computed metrics.
 * Section ids: riskOverview, topHotspots, caseConcentration,
 *              casesVsRiskPatterns, trendDistribution, overallSummary
 */
function generateGisInsight(metrics, filters = {}) {
  const sections = [
    buildGisRiskOverview(metrics),
    buildGisTopHotspots(metrics),
    buildGisCaseConcentration(metrics),
    buildGisCasesVsRiskPatterns(metrics),
    buildGisTrendDistribution(metrics),
    buildGisOverallSummary(metrics),
  ];

  const parts = [];
  if (filters.barangay) parts.push(filters.barangay);
  else parts.push('All Barangays');
  if (metrics.coverage && metrics.coverage.periodYear) {
    if (filters.year) parts.push(`GIS Year ${filters.year}`);
    parts.push(`Assessment Year ${metrics.coverage.periodYear}`);
  }

  return {
    type: 'gis',
    sections,
    meta: {
      basedOn: parts.join(' • '),
      generatedAt: new Date().toISOString(),
    },
  };
}

module.exports = { generateAnalyticsInsight, generateForecastingInsight, generateGisInsight };
