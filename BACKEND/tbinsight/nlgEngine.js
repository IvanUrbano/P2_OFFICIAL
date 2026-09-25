/**
 * NLG Engine — Template-Based Natural Language Generation
 *
 * Converts computed metrics objects into structured text sections.
 * NEVER calculates — only formats pre-computed values into readable text.
 *
 * Exports:
 *   generateAnalyticsInsight(metrics, filters) -> { type, sections, meta }
 *   generateForecastingInsight(metrics, filters) -> { type, sections, meta }
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

function buildKeyTrend(m) {
  const { direction, changePercent, recentCount, priorCount } = m.trend;
  let text;
  if (direction === 'increasing') {
    text = `TB cases show an **increasing trend** of **${abs(changePercent)}%** over the last 3 months (${recentCount} cases) compared with the prior 3 months (${priorCount} cases).`;
  } else if (direction === 'decreasing') {
    text = `TB cases show a **decreasing trend** of **${abs(changePercent)}%** over the last 3 months (${recentCount} cases) compared with the prior 3 months (${priorCount} cases).`;
  } else {
    text = `TB cases remained **relatively stable** over the last 3 months, with ${recentCount} cases compared with ${priorCount} cases during the prior 3 months.`;
  }
  return { id: 'keyTrend', title: 'Key Trend', icon: '📈', text };
}

function buildHighestLowest(m) {
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
  return { id: 'highestLowest', title: 'Highest / Lowest', icon: '📊', text };
}

function buildSignificantChanges(m) {
  const sig = m.significantChanges;
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
    text = `Barangay **${first.barangay}** showed a notable **${pctChange}% increase** in ${formatMonth(first.month)}, with cases exceeding its historical average (${first.zScore} standard deviations above the mean).`;
  } else {
    const first = sig[0];
    text = `Barangay **${first.barangay}** showed a notable deviation in ${formatMonth(first.month)}, with cases ${first.zScore} standard deviations above the historical average.`;
  }
  return { id: 'significantChanges', title: 'Significant Changes', icon: '⚠️', text };
}

function buildRiskFindings(m) {
  const highCount = m.riskCounts.high;
  const medCount = m.riskCounts.medium;
  const names = m.highRiskBarangays;
  let text;
  if (highCount === 0) {
    text = 'No barangays are currently classified as high-risk based on the selected results.';
    if (medCount > 0) {
      text += ` However, ${medCount} barangay(s) are classified as medium-risk and should continue to be monitored.`;
    }
  } else if (highCount <= 5) {
    text = `**${highCount}** barangay(s) are classified as **high-risk**: ${names.join(', ')}.`;
  } else {
    const top4 = names.slice(0, 4).join(', ');
    text = `**${highCount}** barangays are classified as **high-risk**, including ${top4}.`;
  }
  return { id: 'riskFindings', title: 'Risk Findings', icon: '🎯', text };
}

function buildDemographics(m) {
  const { male, female } = m.demographics.sexSplit;
  const age = m.demographics.dominantAgeGroup;
  const ageText = age ? `The **${age.group}** age group represents the largest demographic at **${age.percentage}%**.` : '';

  let text;
  if (male === 0 && female === 0) {
    text = 'No demographic data available for the selected period.';
  } else if (male > female + 5) {
    text = `Males account for **${male}%** of reported cases. ${ageText}`;
  } else if (female > male + 5) {
    text = `Females account for **${female}%** of reported cases. ${ageText}`;
  } else {
    text = `Cases were relatively balanced by sex, with males at **${male}%** and females at **${female}%**. ${ageText}`;
  }
  return { id: 'demographics', title: 'Demographics', icon: '👥', text };
}

function buildTreatment(m) {
  const rate = m.treatment.successRate;
  let text;
  if (rate > 85) {
    text = `Treatment success rate is **${rate}%**, **exceeding** the DOH target of 85%.`;
  } else if (rate < 85) {
    text = `Treatment success rate is **${rate}%**, **below** the DOH target of 85%.`;
  } else {
    text = `Treatment success rate is **${rate}%**, **meeting** the 85% target.`;
  }
  return { id: 'treatment', title: 'Treatment', icon: '💊', text };
}

function buildAnalyticsOverallSummary(m) {
  const parts = [];
  if (m.trend.direction === 'increasing') {
    parts.push('TB activity is increasing during the selected period.');
  } else if (m.trend.direction === 'decreasing') {
    parts.push('TB activity shows a declining trend during the selected period.');
  } else {
    parts.push('TB activity remained stable during the selected period.');
  }
  if (m.riskCounts.high > 0) {
    parts.push(`${m.riskCounts.high} barangay(s) are classified as high-risk.`);
  } else {
    parts.push('No barangays are currently classified as high-risk.');
  }
  if (m.treatment.successRate >= 85) {
    parts.push('Treatment success is at or above the 85% target, indicating favorable current treatment outcomes.');
  } else {
    parts.push('Treatment success remains below the 85% target, indicating areas that may require closer monitoring.');
  }
  return { id: 'overallSummary', title: 'Overall Summary', icon: '📝', text: parts.join(' ') };
}

/**
 * Generate analytics insight sections from computed metrics.
 */
function generateAnalyticsInsight(metrics, filters = {}) {
  const sections = [
    buildKeyTrend(metrics),
    buildHighestLowest(metrics),
    buildSignificantChanges(metrics),
    buildRiskFindings(metrics),
    buildDemographics(metrics),
    buildTreatment(metrics),
    buildAnalyticsOverallSummary(metrics),
  ];

  const parts = [];
  if (filters.year) parts.push(filters.year);
  if (filters.month) parts.push(MONTH_NAMES[Number(filters.month)] || filters.month);
  if (filters.barangay) parts.push(filters.barangay);
  else parts.push('All Barangays');

  return {
    type: 'analytics',
    sections,
    meta: {
      basedOn: parts.join(' • '),
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
  let text;
  if (trend === 'increasing') {
    text = `TB cases are projected to **increase** over the next ${horizon} months.`;
  } else if (trend === 'decreasing') {
    text = `TB cases are projected to **decrease** over the next ${horizon} months.`;
  } else {
    text = `TB cases are projected to remain **relatively stable** over the next ${horizon} months.`;
  }
  return { id: 'forecastDirection', title: 'Forecast Direction', icon: '📈', text };
}

function buildPredictedCases(m) {
  const { total, monthlyAvg, horizon } = m.predictedCases;
  let text;
  if (total > 0) {
    text = `The model projects approximately **${total}** total cases over the next ${horizon} months, averaging **${monthlyAvg}** per month.`;
  } else {
    text = 'No forecast data available for the selected parameters.';
  }
  return { id: 'predictedCases', title: 'Predicted Cases', icon: '🔮', text };
}

function buildPeakPeriod(m) {
  const { label, count } = m.peakPeriod;
  let text;
  if (label) {
    text = `The highest caseload is expected in **${label}**, with **${count}** projected cases.`;
  } else {
    text = 'Unable to determine peak period from the available forecast data.';
  }
  return { id: 'peakPeriod', title: 'Peak Period', icon: '📅', text };
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
  return { id: 'growthRate', title: 'Growth Rate', icon: '📊', text };
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
  return { id: 'highRiskAreas', title: 'High-Risk Areas', icon: '🎯', text };
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
  return { id: 'confidence', title: 'Forecast Confidence', icon: '📘', text };
}

function buildForecastOverallSummary(m) {
  const parts = [];
  if (m.direction.growthRate > 5) {
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
  return { id: 'overallSummary', title: 'Overall Summary', icon: '📝', text: parts.join(' ') };
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

module.exports = { generateAnalyticsInsight, generateForecastingInsight };
