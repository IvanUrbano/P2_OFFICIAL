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
    text = `Reported TB cases **increased** by **${abs(changePercent)}%** over the most recent 3-month period (${recentCount} cases) compared with the preceding 3 months (${priorCount} cases).`;
  } else if (direction === 'decreasing') {
    text = `Reported TB cases **decreased** by **${abs(changePercent)}%** over the most recent 3-month period (${recentCount} cases) compared with the preceding 3 months (${priorCount} cases).`;
  } else {
    text = `Reported TB cases remained **relatively stable** over the most recent 3-month period, with ${recentCount} cases compared with ${priorCount} cases during the preceding 3 months.`;
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
    text = 'No barangay showed a statistically notable change compared with its historical average during the selected period.';
  } else if (hasIncrease) {
    const items = sig.filter((s) => s.caseCount > s.historicalMean);
    const first = items[0];
    const pctChange = first.historicalMean > 0
      ? Math.round(((first.caseCount - first.historicalMean) / first.historicalMean) * 100)
      : 0;
    text = `Barangay **${first.barangay}** showed a notable **${pctChange}% increase** in ${formatMonth(first.month)} compared with its historical monthly average, with cases ${first.zScore} standard deviations above the mean.`;
  } else {
    const first = sig[0];
    text = `Barangay **${first.barangay}** showed a notable deviation in ${formatMonth(first.month)}, with cases ${first.zScore} standard deviations above its historical monthly average.`;
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
    const text = `The Random Forest risk model classifies **${filters.barangay}** as **${label}**.` + caveat;
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
    text = 'No barangays are currently classified as high-risk based on the selected results.';
    if (medCount > 0) {
      text += ` However, ${medCount} barangay(s) are classified as medium-risk and should continue to be monitored.`;
    }
  } else if (highCount <= 5) {
    text = `The Random Forest risk model classified **${highCount}**${ofAssessed} as **High Risk**: ${names.join(', ')}.`;
  } else {
    const top4 = names.slice(0, 4).join(', ');
    const others = highCount - 4;
    text = `The Random Forest risk model classified **${highCount}**${ofAssessed} as **High Risk**. These include ${top4}, and ${others} others.`;
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
  const ageText = age ? `The **${age.group}** age group represents the largest demographic at **${age.percentage}%**.` : '';

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
    text = 'The cohort-based Treatment Success Rate cannot be calculated because previous-year treatment cohort data are unavailable.';
  } else {
    text = `The Treatment Success Rate is **${rate}%**`;
    const context = [];
    if (m.treatment.cohortYear) context.push(`for the ${m.treatment.cohortYear} treatment cohort`);
    if (m.treatment.cohortTotal) context.push(`${m.treatment.cohortTotal.toLocaleString()} patients`);
    if (context.length > 0) text += ` ${context.join(' — ')}`;
    text += '.';
  }
  if (fatalityRate === null || fatalityRate === undefined) {
    text += ' Case Fatality Rate is unavailable because no evaluated terminal outcomes are recorded for this scope.';
  } else {
    text += ` The Case Fatality Rate among evaluated terminal outcomes is **${fatalityRate}%**.`;
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
      parts.push(`Reported TB cases increased by ${abs(m.trend.changePercent)}% over the most recent 3-month period compared with the preceding 3 months`);
    } else if (m.trend.direction === 'decreasing') {
      parts.push(`Reported TB cases decreased by ${abs(m.trend.changePercent)}% over the most recent 3-month period compared with the preceding 3 months`);
    } else {
      parts.push('Reported TB cases remained stable over the most recent 3-month period');
    }
  }
  // Risk — omitted when the risk metric is unavailable
  if (m.riskCounts) {
    if (m.riskCounts.high > 0) {
      const assessed = m.riskCounts.assessed;
      const phrase = assessed
        ? `${m.riskCounts.high} of ${assessed} assessed barangays are classified as High Risk`
        : `${m.riskCounts.high} barangays are classified as High Risk`;
      parts.push(parts.length > 0 ? `while ${phrase}` : phrase);
    } else {
      parts.push(parts.length > 0
        ? 'and no barangays are currently classified as High Risk'
        : 'no barangays are currently classified as High Risk');
    }
  }
  // Demographics — skip when a sex/age filter makes the split a tautology
  // or when the demographics metric is unavailable
  if (m.demographics && m.demographics.sexSplit) {
    const { male, female } = m.demographics.sexSplit;
    if ((male > 0 || female > 0) && !filters.sex && !filters.ageGroup) {
      const dominant = male > female ? 'Male' : female > male ? 'Female' : null;
      if (dominant) {
        parts.push(`${dominant} cases represent the majority of reported cases`);
      }
    }
  }
  // Treatment — omitted when TSR/CFR could not be computed
  if (m.treatment) {
    if (m.treatment.successRate !== null && m.treatment.successRate !== undefined) {
      parts.push(`the Treatment Success Rate was ${m.treatment.successRate}%`);
    }
    if (m.treatment.fatalityRate !== null && m.treatment.fatalityRate !== undefined) {
      parts.push(`and the Case Fatality Rate among evaluated terminal outcomes was ${m.treatment.fatalityRate}%`);
    }
  }
  if (parts.length === 0) {
    return {
      id: 'overallSummary',
      title: 'Overall Summary',
      text: 'Matching TB records were found, but no supporting metrics could be computed for this selection.',
    };
  }
  let text = parts.join(', ') + '.';
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return { id: 'overallSummary', title: 'Overall Summary', text };
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
    text = 'Forecast interpretation is unavailable because there is insufficient historical data for the selected series.';
  } else if (tier === 'baseline') {
    text = `Historical data is not yet long enough for full ARIMA modeling, so this is a **preliminary baseline estimate**, not a modeled forecast direction.`;
  } else if (trend === 'increasing') {
    text = `TB cases are projected to **increase** over the next ${horizon} months.`;
  } else if (trend === 'decreasing') {
    text = `TB cases are projected to **decrease** over the next ${horizon} months.`;
  } else {
    text = `TB cases are projected to remain **relatively stable** over the next ${horizon} months.`;
  }
  return { id: 'forecastDirection', title: 'Forecast Direction', text };
}

function buildPredictedCases(m) {
  const { total, monthlyAvg, horizon } = m.predictedCases;
  let text;
  if (total > 0) {
    text = `The model projects approximately **${total}** total cases over the next ${horizon} months, averaging **${monthlyAvg}** per month.`;
  } else {
    text = 'No forecast data available for the selected parameters.';
  }
  return { id: 'predictedCases', title: 'Predicted Cases', text };
}

function buildPeakPeriod(m) {
  const { label, count } = m.peakPeriod;
  let text;
  if (label) {
    text = `The highest caseload is expected in **${label}**, with **${count}** projected cases.`;
  } else {
    text = 'Unable to determine peak period from the available forecast data.';
  }
  return { id: 'peakPeriod', title: 'Peak Period', text };
}

function buildGrowthRate(m) {
  const { growthRate } = m.direction;
  let text;
  if (growthRate > 0) {
    text = `Expected growth rate: **+${growthRate}%** compared with the historical average.`;
  } else if (growthRate < 0) {
    text = `Expected growth rate: **${growthRate}%** compared with the historical average (declining).`;
  } else {
    text = 'The forecast indicates **no significant change** compared with the historical average.';
  }
  return { id: 'growthRate', title: 'Growth Rate', text };
}

function buildHighRiskAreas(m) {
  const names = m.highRiskForecastBarangays;
  const count = names.length;
  let text;
  if (count === 0) {
    text = 'No barangays are projected to be in the high-risk category.';
  } else if (count <= 5) {
    text = `**${count}** barangay(s) remain in the high-risk category: ${names.join(', ')}.`;
  } else {
    const top4 = names.slice(0, 4).join(', ');
    text = `**${count}** barangays remain in the high-risk category, including ${top4}.`;
  }
  return { id: 'highRiskAreas', title: 'High-Risk Areas', text };
}

function buildConfidence(m) {
  const { avgRelativeCIWidth, interpretation } = m.confidence;
  let text;
  if (interpretation === 'narrow') {
    text = 'The 95% confidence intervals are **narrow**, indicating **high forecast certainty**.';
  } else if (interpretation === 'moderate') {
    text = 'The 95% confidence intervals are **moderate**, suggesting **reasonable forecast certainty**.';
  } else {
    text = 'The 95% confidence intervals are **wide**, indicating **significant forecast uncertainty**.';
  }
  return { id: 'confidence', title: 'Forecast Confidence', text };
}

function buildForecastOverallSummary(m) {
  const tier = m.modelInfo?.tier;
  if (tier === 'insufficient_data' || tier === 'none') {
    return {
      id: 'overallSummary',
      title: 'Overall Summary',
      text: 'Forecast interpretation is unavailable because there is insufficient historical data for the selected series.',
    };
  }
  const parts = [];
  if (tier === 'baseline') {
    parts.push('This is a preliminary baseline estimate, not a full ARIMA forecast, since the selected series does not yet have enough monthly history.');
  } else if (m.direction.growthRate > 5) {
    parts.push('The forecast indicates that TB activity may remain elevated in the coming months.');
  } else if (m.direction.growthRate < -5) {
    parts.push('The forecast suggests a potential decline in TB activity.');
  } else {
    parts.push('The forecast suggests relatively stable TB activity in the near term.');
  }
  if (m.highRiskForecastBarangays.length > 0) {
    parts.push(`${m.highRiskForecastBarangays.length} barangay(s) are projected to remain in the high-risk category.`);
  } else {
    parts.push('No barangays are projected to be in the high-risk category.');
  }
  if (m.confidence.avgRelativeCIWidth > 0.6) {
    parts.push('However, the wide confidence intervals suggest that these projections should be interpreted with caution.');
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

function buildGisRiskOverview(m) {
  const rc = m.riskCounts || {};
  const cov = m.coverage || {};
  const total = cov.totalBarangays || 0;
  let text;
  if (total === 0 || (cov.scoredBarangays || 0) === 0) {
    text =
      'No risk classifications have been generated for the map yet. Run the prediction pipeline to classify barangays.';
  } else {
    text = `Across **${total}** barangays, **${rc.High || 0}** are classified **High**, **${rc.Medium || 0}** **Medium**, **${rc.Low || 0}** **Low**, and **${rc['No Data'] || 0}** have **No Data**${cov.periodYear ? ` (latest risk period: **${cov.periodYear}**)` : ''}.`;
    if (m.focus) {
      const f = m.focus;
      text += ` Focused barangay **${f.name}** is classified **${f.risk_class}**${f.risk_score != null ? ` with a risk score of **${f.risk_score}**` : ''}${f.rank ? ` (rank ${f.rank} of ${f.total_scored} classified barangays)` : ''}.`;
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
  const names = spots.map((s) => `**${s.name}** (${s.risk_class}, score ${s.risk_score})`).join(', ');
  let text = `The highest-risk barangays are ${names}, ranked by the weighted risk index.`;
  const incidenceAvailable = m.incidence && m.incidence.available === true;
  if (incidenceAvailable && spots[0].incidence_per_100k != null) {
    text += ` The leading hotspot, **${spots[0].name}**, records an incidence of **${spots[0].incidence_per_100k} per 100,000 population**.`;
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
  const text = `**${c.top5CaseSharePct}%** of all reported TB cases (**${top5Count}** of **${c.totalCases}**) are concentrated in 5 barangays: ${names}.`;
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
      text: 'Risk classifications and raw case volumes are closely aligned across barangays for this period.',
    };
  }
  let text = `**${highLow}** barangay(s) show **High** risk despite below-median case counts, while **${caseLow}** barangay(s) report top-quarter case counts without a **High** classification.`;
  const incidenceAvailable = m.incidence && m.incidence.available === true;
  if (incidenceAvailable) {
    text += ' This reflects that risk classification incorporates population-adjusted incidence, trend, recent monthly cases and the risk in bordering barangays — not raw case volume alone.';
  } else {
    text += ' This indicates that risk classification draws on indicators beyond raw case volume.';
  }
  const hlNames = (p.highRiskLowerCase || []).slice(0, 3).map((r) => r.name);
  if (hlNames.length > 0) {
    text += ` High-risk/lower-case barangays include ${hlNames.join(', ')}.`;
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
  const text = `Among **${scored}** classified barangays, **${t.Increasing || 0}** show an **Increasing** trend, **${t.Decreasing || 0}** a **Decreasing** trend, and **${t.Stable || 0}** a **Stable** trend.`;
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
      parts.push(`${m.concentration.top5CaseSharePct}% of reported cases are concentrated in the top 5 barangays.`);
    }
    const t = m.trendCounts || {};
    if ((t.Increasing || 0) > (t.Decreasing || 0)) {
      parts.push('More barangays show an increasing than a decreasing case trend.');
    } else if ((t.Decreasing || 0) > (t.Increasing || 0)) {
      parts.push('More barangays show a decreasing than an increasing case trend.');
    } else {
      parts.push('Increasing and decreasing case trends are evenly balanced across barangays.');
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
    parts.push(`Risk Period ${metrics.coverage.periodYear}`);
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
