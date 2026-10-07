// Dashboard forecast summary and barangay ranking, kept out of the page so they can be tested.
// Both feed numbers and sentences that must agree with the Dashboard narrative
// (BACKEND/tbinsight/dashboardInsight.js) — see the matching rules there.

const monthIndex = (iso) => {
  const s = String(iso ?? '');
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  return Number.isFinite(y) && Number.isFinite(m) && m >= 1 ? y * 12 + (m - 1) : null;
};

const EMPTY = {
  total: 0, period: '', growthRate: 0, riskLevel: 'N/A', tier: null, tierLabel: null,
  periodCount: 0, arimaBarangays: 0, fallbackBarangays: [], methodNote: '',
};

const humanMethod = (m) => String(m).replace(/_/g, ' ');

/**
 * Forecast figures for ONE forecast month.
 *
 * The month is the first forecast period after `anchorMonth` (the latest month with recorded
 * cases), so the KPI, the summary card and the narrative all describe the same month; if no
 * period lies ahead, the newest period is used. Barangays are summed raw and rounded once.
 *
 * The forecast is labelled by coverage, never relabelled because of one barangay: ARIMA for
 * most barangays stays an "ARIMA Forecast" and the exceptions (barangays whose case history is
 * too sparse for ARIMA, which use a fallback such as exponential smoothing) are named in
 * `methodNote`. Only a forecast with no ARIMA barangay at all is a "Baseline Forecast".
 *
 * @param {Array} forecastsData  model_predictions rows (already scoped by barangay if filtered)
 * @param {Array} monthlyData    monthly case rows used for the growth baseline
 * @param {string} [anchorMonth] 'YYYY-MM-DD' of the latest recorded month (unfiltered)
 */
export function summarizeForecast(forecastsData, monthlyData, anchorMonth = '') {
  const periods = [...new Set((forecastsData || []).map((r) => r.period).filter(Boolean))].sort();
  if (periods.length === 0) return { ...EMPTY };

  const anchor = monthIndex(anchorMonth);
  const ahead = anchor == null ? [] : periods.filter((p) => monthIndex(p) > anchor);
  const chosen = ahead.length > 0 ? ahead[0] : periods[periods.length - 1];
  const latest = forecastsData.filter((r) => r.period === chosen);

  const sum = (rows) => rows.reduce((s, r) => s + Number(r.forecasted_count || 0), 0);
  const total = Math.round(sum(latest));

  // Growth: this forecast vs the historical monthly average (same baseline as the Forecasting page)
  const byMonth = {};
  monthlyData.forEach((r) => { byMonth[r.month] = (byMonth[r.month] || 0) + Number(r.case_count || 0); });
  const historicalMonths = Object.keys(byMonth).length || 1;
  const monthlyAvg = Object.values(byMonth).reduce((s, v) => s + v, 0) / historicalMonths;
  const baseline = monthlyAvg || 1;
  const growthRate = ((sum(latest) - baseline) / baseline) * 100;

  // Predominant Random Forest class among these barangays (a copy of the RF result, not a
  // forecast output; barangays with none are counted as "No Data", never as Low).
  const riskCounts = {};
  latest.forEach((r) => { const rc = r.risk_class || 'No Data'; riskCounts[rc] = (riskCounts[rc] || 0) + 1; });
  let majorityRisk = 'No Data';
  let maxCount = 0;
  Object.entries(riskCounts).forEach(([cls, cnt]) => { if (cnt > maxCount) { maxCount = cnt; majorityRisk = cls; } });

  const methods = [...new Set(latest.map((r) => r.method).filter(Boolean))];
  const usable = latest.filter((r) => r.method !== 'insufficient_data');
  const arimaRows = usable.filter((r) => r.method === 'arima');
  const fallbackRows = usable.filter((r) => r.method && r.method !== 'arima');
  const tier = methods.length === 0 ? null
    : usable.length === 0 ? 'insufficient_data'
      : fallbackRows.length === 0 ? 'arima'
        : arimaRows.length === 0 ? 'baseline' : 'mixed';
  const tierLabel = tier === 'insufficient_data' ? 'Insufficient Historical Data'
    : tier === 'baseline' ? 'Baseline Forecast'
      : tier === 'arima' || tier === 'mixed' ? 'ARIMA Forecast' : null;

  const fallbackNames = fallbackRows.map((r) => r.barangay_name).sort();
  const fallbackMethods = [...new Set(fallbackRows.map((r) => humanMethod(r.method)))].join(' / ');
  const methodNote = tier === 'mixed'
    ? `${arimaRows.length} of ${usable.length} barangays use ARIMA. ${fallbackNames.length} with sparse case history (${fallbackNames.join(', ')}) use ${fallbackMethods}.`
    : tier === 'baseline'
      ? 'No barangay had enough case history for ARIMA, so a baseline method was used.'
      : '';

  const periodLabel = new Date(chosen).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return {
    total, period: periodLabel, growthRate, riskLevel: majorityRisk, tier, tierLabel,
    periodCount: ahead.length > 0 ? ahead.length : periods.length,
    arimaBarangays: arimaRows.length, fallbackBarangays: fallbackNames, methodNote,
  };
}

const RISK_PRIORITY = { High: 3, Medium: 2, Moderate: 2, Low: 1, 'No Data': 0 };

/**
 * Barangays ordered by Random Forest risk level first, then by recorded cases (then name).
 * Barangays with no classification are "No Assessment" and sort last; they are never ranked
 * as Low. Cases decide the order within a risk level — the risk score is not used, so the
 * order matches the TB Cases column that is shown next to it.
 */
export function topBarangayRanking(monthly, risk, limit = 5) {
  const by = {};
  (monthly || []).forEach((r) => {
    if (!r.barangay_name) return;
    if (!by[r.barangay_name]) by[r.barangay_name] = { name: r.barangay_name, cases: 0 };
    by[r.barangay_name].cases += Number(r.case_count || 0);
  });
  (risk || []).forEach((r) => {
    if (!by[r.name]) by[r.name] = { name: r.name, cases: 0 };
    by[r.name].risk = r.risk_class && String(r.risk_class).toLowerCase() !== 'no data' ? r.risk_class : null;
  });
  return Object.values(by)
    .sort((a, b) => ((RISK_PRIORITY[b.risk] ?? 0) - (RISK_PRIORITY[a.risk] ?? 0))
      || (b.cases - a.cases)
      || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((b, i) => ({ rank: i + 1, ...b }));
}
