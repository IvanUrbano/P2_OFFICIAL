import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChart, Line, Area, CartesianGrid, XAxis, YAxis,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import API from '../api/axios';
import AnalyticsInsightPanel from '../components/AnalyticsInsightPanel';
import ChartInsight from '../components/ChartInsight';
import { forecastInsight, accuracyInsight, monthByMonthForecastInsight, accuracySummary, scopeLabel } from '../utils/chartInsights';
import FilterSelect from '../components/FilterSelect';
import ProgressOverlay from '../components/ProgressOverlay';
import { getForecastingInsight } from '../services/insightService';
import { buildEvaluationView } from '../utils/modelEvaluationView';
import { forecastMonthKey as localMonthKey, aggregateForecastHistory, calculateForecastGrowth } from '../utils/forecastSeries';

/* ─── Constants ──────────────────────────────────────────────────────── */


const HORIZON_OPTIONS = [
  { value: 1, label: '1 Month' },
  { value: 3, label: '3 Months' },
];

const MODEL_STATUS_COLORS = {
  success: '#047857',
  degraded: '#B45309',
  insufficient_data: '#B91C1C',
  failed: '#991B1B',
  not_run: '#94A3B8',
};

const MODEL_STATUS_LABELS = {
  success: 'Success',
  degraded: 'Degraded',
  insufficient_data: 'Insufficient Data',
  failed: 'Failed',
  not_run: 'Not Run',
};

function formatModelStatus(status) {
  return MODEL_STATUS_LABELS[status] || 'Not Run';
}

// Just the method name for a forecast tier — 'ARIMA' | 'Baseline Forecast'
// | 'Insufficient Historical Data' | null.
function forecastTierMethodLabel(tier) {
  if (tier === 'arima') return 'ARIMA';
  if (tier === 'insufficient_data') return 'Insufficient Historical Data';
  if (tier != null) return 'Baseline Forecast';
  return null;
}

// Shared by the Model Status KPI card and the Run Analysis Pipeline result
// banner. Never renders "ARIMA: Baseline Forecast" — a 10-23 month result is
// a real success, just not the ARIMA tier, so it reads "Success — Method:
// Baseline Forecast" instead of implying the model failed to be ARIMA.
function formatForecastingStatus(status) {
  switch (status) {
    case 'success':
    case 'arima':
      return { label: 'Success — Method: ARIMA', color: MODEL_STATUS_COLORS.success };
    case 'degraded':
    case 'baseline':
      return { label: 'Success — Method: Baseline Forecast', color: MODEL_STATUS_COLORS.degraded };
    case 'insufficient_data':
      return { label: 'Insufficient Historical Data', color: MODEL_STATUS_COLORS.insufficient_data };
    case 'failed':
      return { label: 'Failed', color: MODEL_STATUS_COLORS.failed };
    default:
      return { label: 'Not Run', color: MODEL_STATUS_COLORS.not_run };
  }
}

/* ─── Helper Components ──────────────────────────────────────────────── */

function ForecastTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="border border-[#E2E8F0] bg-white px-3 py-2 text-xs shadow-sm"
      style={{
        background: '#ffffff',
        border: '1px solid #E2E8F0',
        minWidth: 130,
      }}
    >
      {label && (
        <div
          className="text-[10px] font-semibold mb-1.5 pb-1"
          style={{ color: '#64748B', borderBottom: '1px solid #F1F5F9' }}
        >
          {label}
        </div>
      )}
      {payload
        .filter((e) => e.dataKey !== 'ci_upper' && e.dataKey !== 'ci_lower')
        .map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-0.5">
            <div className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: entry.color || entry.stroke }}
              />
              <span style={{ color: '#64748B' }}>{entry.name}</span>
            </div>
            <span className="font-bold" style={{ color: '#1E293B' }}>
              {entry.value != null ? Number(entry.value).toLocaleString() : '\u2014'}
            </span>
          </div>
        ))}
      {payload[0]?.payload?.ci_lower != null && payload[0]?.payload?.ci_upper != null && (
        <div className="mt-1 pt-1 text-[11px]" style={{ color: '#64748B', borderTop: '1px solid #F1F5F9' }}>
          Likely range: {Number(payload[0].payload.ci_lower).toLocaleString()} – {Number(payload[0].payload.ci_upper).toLocaleString()} cases
        </div>
      )}
    </div>
  );
}

/** Actual-vs-predicted hover: both counts and the difference in plain words. */
function AvpTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const diff = row.Predicted != null && row.Actual != null ? row.Predicted - row.Actual : null;
  const diffText = diff == null ? null
    : diff === 0 ? 'Exactly right'
      : `Predicted ${Math.abs(diff).toLocaleString()} ${diff > 0 ? 'more' : 'fewer'} than actual`;
  return (
    <div className="bg-white px-3 py-2.5 text-xs shadow-md" style={{ border: '1px solid #CBD5E1', borderRadius: 6, minWidth: 190 }}>
      <div className="text-[12px] font-bold mb-1.5" style={{ color: '#0F2D52' }}>{label}</div>
      <div className="flex justify-between gap-4 py-0.5"><span style={{ color: '#475569' }}>Actual (reported)</span><span className="font-bold" style={{ color: '#0F2D52' }}>{row.Actual?.toLocaleString() ?? '\u2014'}</span></div>
      <div className="flex justify-between gap-4 py-0.5"><span style={{ color: '#475569' }}>Predicted by the model</span><span className="font-bold" style={{ color: '#3F7F6B' }}>{row.Predicted?.toLocaleString() ?? '\u2014'}</span></div>
      {diffText && <div className="mt-1 pt-1 text-[11px] font-semibold" style={{ color: '#64748B', borderTop: '1px solid #F1F5F9' }}>{diffText}</div>}
    </div>
  );
}

/** Big, plain headline figure above a chart. */
function SummaryStat({ value, label }) {
  return (
    <div className="rounded-lg px-4 py-3" style={{ background: '#F1F5F9', border: '1px solid #E2E8F0' }}>
      <div className="text-2xl font-extrabold leading-tight" style={{ color: '#0F2D52' }}>{value}</div>
      <div className="mt-0.5 text-xs font-medium" style={{ color: '#475569' }}>{label}</div>
    </div>
  );
}

function SectionSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-4 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-lg"
          style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}
        >
          <div className="px-5 py-3.5" style={{ borderBottom: '1px solid #F1F5F9' }}>
            <div className="h-3 w-32 rounded" style={{ background: '#E2E8F0' }} />
          </div>
          <div className="p-5">
            <div className="h-48 w-full" style={{ background: '#F1F5F9' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ModelOverview() {
  return (
    <details className="group border-t border-[#E2E8F0] bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-3 text-xs font-semibold text-[#0F2D52] marker:hidden hover:bg-[#F8FAFC] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0F2D52] [&::-webkit-details-marker]:hidden">
        <span>How are forecasts and GIS risk levels produced?</span>
        <i className="ri-arrow-down-s-line text-base transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="grid gap-4 border-t border-[#E8EDF2] px-6 py-4 sm:grid-cols-2">
        <div>
          <h2 className="text-xs font-semibold text-[#0F2D52]">ARIMA forecasting</h2>
          <p className="mt-1 text-xs leading-relaxed text-[#475569]">Uses past monthly TB cases to estimate future monthly case counts for each barangay. When there is too little history, a simpler baseline estimate may be shown instead.</p>
        </div>
        <div>
          <h2 className="text-xs font-semibold text-[#0F2D52]">Random Forest risk assessment</h2>
          <p className="mt-1 text-xs leading-relaxed text-[#475569]">Classifies barangays as Low, Moderate, or High Risk. View those classifications on the GIS map; they are separate from the case forecasts below.</p>
        </div>
      </div>
    </details>
  );
}

/* ─── Model Evaluation (saved walk-forward metrics from the ML service) ─── */

function EvalMetric({ label, value }) {
  return (
    <div className="px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#94A3B8' }}>{label}</div>
      <div className="text-sm font-extrabold mt-0.5" style={{ color: '#0F2D52' }}>{value}</div>
    </div>
  );
}

function formatEvaluationMonth(value) {
  if (!value) return null;
  const [year, month] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month) return null;
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

const pct = (value, digits = 0) => `${(Number(value) * 100).toFixed(digits)}%`;

/** High vs not High from the confusion matrix, for evaluations saved before it was stored. */
function priorityFromConfusion(cm) {
  if (!cm) return null;
  let total = 0;
  let right = 0;
  for (const [actual, row] of Object.entries(cm)) {
    for (const [predicted, n] of Object.entries(row)) {
      total += n;
      if ((actual === 'High') === (predicted === 'High')) right += n;
    }
  }
  return total > 0 ? right / total : null;
}

/** The Random Forest's own evaluation (all barangays, all tested months). */
function RiskClassificationEvaluation({ rf }) {
  if (!rf || rf.accuracy == null) return null;
  const highRecall = rf.recall?.High;
  const priority = rf.priority_accuracy ?? priorityFromConfusion(rf.confusion_matrix);
  return (
    <div className="mt-3 rounded px-3 py-2.5" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
      <p className="text-[11px] font-bold" style={{ color: '#0F2D52' }}>Risk levels (Random Forest)</p>
      <div className="mt-1 grid grid-cols-2 gap-3 md:grid-cols-4">
        <EvalMetric label="Priority barangays identified" value={priority != null ? pct(priority, 1) : '—'} />
        <EvalMetric label="Correct risk level" value={rf.ceiling_accuracy != null ? `${pct(rf.accuracy)} (best possible ${pct(rf.ceiling_accuracy)})` : pct(rf.accuracy)} />
        <EvalMetric label="Right or one level off" value={rf.low_high_confusion != null ? pct(1 - rf.low_high_confusion, 1) : '—'} />
        <EvalMetric label="High-risk barangays caught" value={highRecall != null ? pct(highRecall) : '—'} />
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed" style={{ color: '#64748B' }}>
        Risk level for the next 6 months, checked against the cases later reported ({rf.n_steps} months tested). "Priority barangays identified": each barangay correctly called High priority or not (High vs Low/Medium).
      </p>
    </div>
  );
}

/**
 * Model evaluation: hidden until "View Model Evaluation" is pressed. It only READS the saved evaluation
 * (GET /api/tb/evaluation/latest) — viewing never reruns ARIMA, the Random Forest or the evaluation.
 * The figures follow the page's active Year/Period and Barangay filters (utils/modelEvaluationView.js):
 * "All barangays" is the overall evaluation, not one barangay.
 */
function ModelEvaluationPanel({ open, onToggle, record, status, loading, error, filters }) {
  const view = useMemo(
    () => buildEvaluationView(record, filters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record, filters.startYear, filters.endYear, filters.barangay]
  );
  const savedAt = record?.trained_at ? new Date(record.trained_at).toLocaleString() : 'date unavailable';
  const failedAt = status?.failedAt ? new Date(status.failedAt).toLocaleString() : 'date unavailable';
  const formatCount = value => value == null || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
  const periodStart = formatEvaluationMonth(view.periodStart);
  const periodEnd = formatEvaluationMonth(view.periodEnd);
  const evaluationPeriod = periodStart && periodEnd
    ? periodStart === periodEnd ? periodStart : `${periodStart}–${periodEnd}`
    : 'Not recorded in this saved evaluation';

  return (
    <section className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
      <div className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center" style={{ borderBottom: open ? '1px solid #E2E8F0' : 'none' }}>
        <div>
          <h2 className="text-sm font-semibold text-[#0F2D52]">How accurate were past forecasts?</h2>
          <p className="mt-0.5 text-[11px] text-[#64748B]">Compare saved predictions with cases reported later. Opening this section does not rerun the model.</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="shrink-0 px-4 py-2 text-xs font-semibold"
          style={{ background: '#ffffff', color: '#0F2D52', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#EFF6FF'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#ffffff'; }}
        >
          <i className={`${open ? 'ri-eye-off-line' : 'ri-bar-chart-2-line'} mr-1`} />
          {open ? 'Hide evaluation' : 'View evaluation'}
        </button>
      </div>

      {open && (
        <div className="px-5 py-4">
          {loading && !record ? (
            <p className="text-xs" style={{ color: '#64748B' }}>Loading the saved evaluation…</p>
          ) : error && !record ? (
            <p className="text-xs" style={{ color: '#B91C1C' }}>{error}</p>
          ) : !record || view.state === 'none' ? (
            <p className="text-xs" style={{ color: '#64748B' }}>
              No saved evaluation is available yet. Results will be generated automatically after the next analysis pipeline run.
              {status?.lastError && <span className="block mt-1" style={{ color: '#B91C1C' }}>The latest automatic evaluation could not be completed; an administrator may need to check the model service.</span>}
            </p>
          ) : (
            <>
              {error && <p className="text-[10px] mb-2" style={{ color: '#B91C1C' }}>Could not refresh the saved evaluation: {error}. Showing the last loaded result.</p>}
              <p className="text-[11px] mb-3" style={{ color: '#64748B' }}>
                Showing <strong style={{ color: '#0F2D52' }}>{view.scopeLabel}</strong> · <strong style={{ color: '#0F2D52' }}>{view.rangeLabel}</strong>
              </p>

              {view.state === 'barangay_unavailable' && (
                <p className="text-xs leading-relaxed" style={{ color: '#92400E' }}>
                  {view.hasPerBarangay
                    ? `There is no saved evaluation for ${view.scopeLabel}: barangays whose history is too short to test are not evaluated.`
                    : `This saved evaluation kept monthly results for ${view.savedFor || 'one barangay'} only. Results for every barangay are saved the next time the evaluation runs, which happens automatically after each analysis pipeline run. Choose All Barangays to see the overall evaluation.`}
                </p>
              )}

              {view.state === 'no_steps_in_range' && (
                <p className="text-xs leading-relaxed" style={{ color: '#92400E' }}>
                  No evaluated months fall in {view.rangeLabel}. This evaluation tested {formatEvaluationMonth(view.evaluatedStart)}–{formatEvaluationMonth(view.evaluatedEnd)}. Widen the Year/Period filter to see results.
                </p>
              )}

              {view.state === 'ready' && (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-0">
                    <EvalMetric label="Average error" value={view.mae == null ? '—' : `${Number(view.mae).toFixed(1)} cases`} />
                    <EvalMetric label="Cases missed (WAPE)" value={view.wape == null ? '—' : `${Number(view.wape).toFixed(1)}%`} />
                    <EvalMetric label="vs. 12-month average" value={view.skill == null ? '—' : `${view.skill >= 0 ? '+' : ''}${(Number(view.skill) * 100).toFixed(1)}%`} />
                    <EvalMetric label="Months tested" value={evaluationPeriod} />
                  </div>
                  {view.total3m?.wape != null && (
                    <div className="mt-3 rounded px-3 py-2.5" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                      <p className="text-[11px] font-bold" style={{ color: '#0F2D52' }}>3-month totals</p>
                      <div className="mt-1 grid grid-cols-3 gap-3">
                        <EvalMetric label="Average error" value={`${Number(view.total3m.mae).toFixed(1)} cases`} />
                        <EvalMetric label="Cases missed (WAPE)" value={`${Number(view.total3m.wape).toFixed(1)}%`} />
                        <EvalMetric label="vs. 12-month average" value={view.total3m.skill == null ? '—' : `${view.total3m.skill >= 0 ? '+' : ''}${(Number(view.total3m.skill) * 100).toFixed(1)}%`} />
                      </div>
                      <p className="mt-1.5 text-[10px] leading-relaxed" style={{ color: '#64748B' }}>Chance ups and downs even out over 3 months: the better guide for planning supplies and staff.</p>
                    </div>
                  )}
                  {view.city?.wape != null && (
                    <div className="mt-3 rounded px-3 py-2.5" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                      <p className="text-[11px] font-bold" style={{ color: '#0F2D52' }}>City-wide total</p>
                      <div className="mt-1 grid grid-cols-3 gap-3">
                        <EvalMetric label="Average error" value={`${Number(view.city.mae).toFixed(1)} cases`} />
                        <EvalMetric label="Cases missed (WAPE)" value={`${Number(view.city.wape).toFixed(1)}%`} />
                        <EvalMetric label="vs. 12-month average" value={view.city.skill == null ? '—' : `${view.city.skill >= 0 ? '+' : ''}${(Number(view.city.skill) * 100).toFixed(1)}%`} />
                      </div>
                      <p className="mt-1.5 text-[10px] leading-relaxed" style={{ color: '#64748B' }}>All barangays added up each month; small misses cancel out. The figure for city-wide planning.</p>
                    </div>
                  )}
                  <p className="mt-3 text-[11px] leading-relaxed text-[#475569]">"vs. 12-month average": above 0% means the forecast beat simply using each barangay's average of the past 12 months.</p>
                  <RiskClassificationEvaluation rf={record?.metrics?.rf} />

                  {view.rows.length > 0 ? (
                    <details className="group mt-4">
                      <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-bold [&::-webkit-details-marker]:hidden" style={{ color: '#0F2D52' }}>
                        <i className="ri-arrow-right-s-line text-sm transition-transform group-open:rotate-90" aria-hidden="true" />
                        Show months: predicted vs reported — {view.rowsLabel}
                      </summary>
                      <div className="overflow-x-auto mt-3">
                        <table className="w-full text-[11px] text-left">
                          <thead style={{ color: '#64748B', background: '#F8FAFC' }}>
                            <tr>
                              {['Month', 'Reported', 'Predicted', 'Difference'].map(label => (
                                <th key={label} className="px-3 py-2 font-semibold">{label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {view.rows.map(row => (
                              <tr key={row.month} style={{ borderTop: '1px solid #F1F5F9', color: '#334155' }}>
                                <td className="px-3 py-2">{formatEvaluationMonth(row.month)}</td>
                                <td className="px-3 py-2">{formatCount(row.actual)}</td>
                                <td className="px-3 py-2">{formatCount(row.predicted)}</td>
                                <td className="px-3 py-2">{formatCount(row.error)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ) : (
                    <p className="text-[10px] mt-2 leading-relaxed" style={{ color: '#64748B' }}>
                      A month-by-month comparison for all barangays was not saved with this evaluation. It will be saved the next time the evaluation runs, which happens automatically after each analysis pipeline run.
                      {view.exampleBarangay ? ` Choose ${view.exampleBarangay} to see the months that were saved.` : ''}
                    </p>
                  )}

                  {view.notes.includes('yearFilterNotApplied') && (
                    <p className="text-[10px] mt-2 leading-relaxed" style={{ color: '#92400E' }}>
                      The Year/Period filter cannot narrow this saved evaluation, so it shows the whole evaluation period.
                    </p>
                  )}
                </>
              )}

              {status?.running && <p className="text-[10px] mt-3" style={{ color: '#64748B' }}>A newer evaluation is running. Showing saved results from {savedAt}.</p>}
              {!status?.running && status?.lastError && (
                <p className="text-[10px] mt-3 leading-relaxed" style={{ color: '#B45309' }}>
                  The latest evaluation failed on {failedAt}. These are previous saved results from {savedAt}.
                </p>
              )}
              <p className="text-[10px] mt-3" style={{ color: '#94A3B8' }}>Last evaluated: {savedAt}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/* ─── Main Forecasting Component ─────────────────────────────────────── */

export default function Forecasting() {
  /* ── Data state ── */
  const [monthlyData, setMonthlyData] = useState([]);
  const [forecastsData, setForecastsData] = useState([]);
  const [backtestData, setBacktestData] = useState([]);
  const [backtestEvaluatedAt, setBacktestEvaluatedAt] = useState(null);
  const [barangays, setBarangays] = useState([]);
  const [casesData, setCasesData] = useState([]);
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const availableYears = useMemo(() => [...new Set(monthlyData
    .map(row => localMonthKey(row.month)?.slice(0, 4)).filter(Boolean))].sort(), [monthlyData]);

  /* ── Control state (user selections before clicking Run) ── */
  const [startYear, setStartYear] = useState('');
  const [endYear, setEndYear] = useState('');
  const [selectedBarangay, setSelectedBarangay] = useState('');
  const [forecastMonths, setForecastMonths] = useState(3);
  const [compareBarangay, setCompareBarangay] = useState('');
  const [showCompare, setShowCompare] = useState(false);

  /* ── Applied state (updated only on Run Forecast) ── */
  const [appliedStartYear, setAppliedStartYear] = useState(null);
  const [appliedEndYear, setAppliedEndYear] = useState(null);
  const [appliedBarangay, setAppliedBarangay] = useState(null);
  const [appliedMonths, setAppliedMonths] = useState(null);

  /* ── UI state ── */
  const [error, setError] = useState(null);

  // View Forecast content-area state — 'idle' (nothing requested yet),
  // 'loading' (request in flight), 'checking' (request succeeded, waiting
  // one render for the filtered/aggregated memos below to recompute against
  // the fresh data so we can tell "no data for this scope" apart from
  // "data exists"), 'success', 'no_data', or 'error'. A failed request must
  // never fall through to 'success'/'no_data' and render stale data as if
  // the click had worked.
  const [viewStatus, setViewStatus] = useState('idle');
  const [viewErrorMessage, setViewErrorMessage] = useState(null);
  const [viewSuccessInfo, setViewSuccessInfo] = useState(null); // { scope, method }

  // Run Analysis Pipeline result — separate from viewStatus because this is
  // reporting on the ACTION (did reprocessing succeed?), not on the content
  // area, even though a successful run also refreshes that content.
  const [pipelineRunStatus, setPipelineRunStatus] = useState('idle');
  const [pipelineRunResult, setPipelineRunResult] = useState(null);
  const [pipelineRunErrorMessage, setPipelineRunErrorMessage] = useState(null);

  const isBusy = viewStatus === 'loading' || viewStatus === 'checking' || pipelineRunStatus === 'loading';

  // The Year/Period and Barangay the Model Evaluation follows: the filters applied by View Forecast,
  // or — before anything has been applied — what is currently selected. Empty barangay = All Barangays.
  const evaluationStartYear = appliedStartYear || startYear;
  const evaluationEndYear = appliedStartYear ? appliedEndYear : endYear;
  const evaluationBarangay = (appliedStartYear ? appliedBarangay : selectedBarangay) || '';
  const evaluationFilters = useMemo(
    () => ({ startYear: evaluationStartYear, endYear: evaluationEndYear, barangay: evaluationBarangay }),
    [evaluationStartYear, evaluationEndYear, evaluationBarangay]
  );

  /* ── Automatically updated model performance ── */
  const [modelEvaluation, setModelEvaluation] = useState(null);
  const [evaluationStatus, setEvaluationStatus] = useState(null);
  const [evaluationOpen, setEvaluationOpen] = useState(false);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [performanceError, setPerformanceError] = useState(null);
  const isAdmin = (() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}')?.role === 'admin'; } catch { return false; }
  })();

  /* ── NLG Insight state ── */
  const [insightData, setInsightData] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState(null);

  /* ── Table sorting ── */
  const [sortKey, setSortKey] = useState('period');
  const [sortDir, setSortDir] = useState('asc');

  /* ────────── Data fetching ────────── */

  const loadModelPerformance = useCallback(async () => {
    setPerformanceLoading(true);
    setPerformanceError(null);
    try {
      const response = await API.get('/api/tb/evaluation/latest');
      setModelEvaluation(response.data?.latest_evaluation || null);
      setEvaluationStatus(response.data?.evaluation_status || null);
    } catch (err) {
      setPerformanceError(err.response?.data?.error || err.message || 'Unable to load model performance.');
    } finally {
      setPerformanceLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setError(null);
      // Every case, but only the fields the charts compute from (no identifiers).
      const [monthlyRes, forecastsRes, barangaysRes, allCasesRes, pipelineRes, backtestRes] =
        await Promise.all([
          API.get('/api/tb/dashboard/monthly'),
          API.get('/api/tb/forecasts'),
          API.get('/api/tb/barangays').catch(() => ({ data: { barangays: [] } })),
          API.get('/api/tb/cases/analytics-dataset').catch(() => ({ data: { cases: [] } })),
          API.get('/api/tb/pipeline/status').catch(() => ({ data: { latest_run: null } })),
          API.get('/api/tb/forecast/backtest').catch(() => ({ data: { data: [] } })),
        ]);
      setMonthlyData(monthlyRes.data.monthly || []);
      const years = [...new Set((monthlyRes.data.monthly || [])
        .map(row => localMonthKey(row.month)?.slice(0, 4)).filter(Boolean))].sort();
      setStartYear(current => years.includes(current) ? current : (years[0] || ''));
      setEndYear(current => years.includes(current) ? current : (years[years.length - 1] || ''));
      setForecastsData(forecastsRes.data.forecasts || []);
      setBarangays(barangaysRes.data.barangays || []);
      setCasesData(allCasesRes.data.cases || []);
      setPipelineStatus(pipelineRes.data.latest_run || null);
      setBacktestData(backtestRes.data.data || []);
      setBacktestEvaluatedAt(backtestRes.data.evaluated_at || null);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Forecasting fetch error:', err);
      setError('Failed to load analytics data. Make sure the backend is running.');
      setPerformanceLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    window.addEventListener('focus', loadAll);
    return () => window.removeEventListener('focus', loadAll);
  }, [loadAll]);

  // Hidden by default: the saved evaluation is only read when "View Model Evaluation" is pressed
  // (and re-read while a newer evaluation is running and the panel is open). Reading it never
  // reruns the model.
  const toggleEvaluation = useCallback(() => {
    if (!evaluationOpen) loadModelPerformance();
    setEvaluationOpen(open => !open);
  }, [evaluationOpen, loadModelPerformance]);

  useEffect(() => {
    if (!evaluationOpen || !evaluationStatus?.running) return undefined;
    const interval = window.setInterval(loadModelPerformance, 5000);
    return () => window.clearInterval(interval);
  }, [evaluationOpen, evaluationStatus?.running, loadModelPerformance]);

  /* ────────── Run Forecast ────────── */

  const refreshForecastView = useCallback(async () => {
    const [freshMonthly, freshForecasts, freshAvp, freshPipeline, freshCases] = await Promise.all([
      API.get('/api/tb/dashboard/monthly'),
      API.get('/api/tb/forecasts'),
      API.get('/api/tb/forecast/backtest').catch(() => ({ data: { data: [] } })),
      API.get('/api/tb/pipeline/status'),
      API.get('/api/tb/cases/analytics-dataset').catch(() => ({ data: { cases: [] } })),
    ]);
    const monthly = freshMonthly.data.monthly || [];
    const years = [...new Set(monthly.map(row => localMonthKey(row.month)?.slice(0, 4)).filter(Boolean))].sort();
    setMonthlyData(monthly);
    setStartYear(current => years.includes(current) ? current : (years[0] || ''));
    setEndYear(current => years.includes(current) ? current : (years[years.length - 1] || ''));
    setForecastsData(freshForecasts.data.forecasts || []);
    setBacktestData(freshAvp.data.data || []);
    setBacktestEvaluatedAt(freshAvp.data.evaluated_at || null);
    setPipelineStatus(freshPipeline.data.latest_run || null);
    setCasesData(freshCases.data.cases || []);
    return years;
  }, []);

  const applySelectedFilters = useCallback((years = availableYears) => {
    const effectiveStart = years.includes(startYear) ? startYear : (years[0] || null);
    const effectiveEnd = years.includes(endYear) ? endYear : (years[years.length - 1] || null);
    setAppliedStartYear(effectiveStart);
    setAppliedEndYear(effectiveEnd);
    setAppliedBarangay(selectedBarangay);
    setAppliedMonths(forecastMonths);
    return { startYear: effectiveStart, endYear: effectiveEnd, barangay: selectedBarangay, horizon: forecastMonths };
  }, [startYear, endYear, selectedBarangay, forecastMonths, availableYears]);

  // Loads currently persisted forecasts under the selected filters — read-only,
  // available to every user, never reprocesses ARIMA/RF. A failed request
  // moves to 'error' and stops — it never leaves stale forecastsData/
  // backtestData on screen looking like a successful result.
  const handleViewForecast = useCallback(async () => {
    setViewStatus('loading');
    setViewErrorMessage(null);
    setViewSuccessInfo(null);
    setInsightData(null);
    setInsightError(null);

    if (Number(startYear) > Number(endYear)) {
      setViewStatus('error');
      setViewErrorMessage('Start year must be on or before end year.');
      return;
    }

    try {
      const years = await refreshForecastView();
      const filters = applySelectedFilters(years);
      setViewSuccessInfo({ scope: `${filters.barangay || 'All Pasig Barangays'} • ${filters.startYear || 'N/A'}–${filters.endYear || 'N/A'}` });
      setViewStatus('checking');
      setInsightLoading(true);
      try {
        setInsightData(await getForecastingInsight(filters));
      } catch (insightErr) {
        if (import.meta.env.DEV) console.error('Forecast insight error:', insightErr);
        setInsightError('Unable to generate insight.');
      } finally {
        setInsightLoading(false);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Forecast fetch error:', err.response?.data?.error || err.message);
      setViewStatus('error');
      setViewErrorMessage(err.response?.data?.error || err.message || 'Could not load the forecast.');
    }
  }, [startYear, endYear, refreshForecastView, applySelectedFilters]);

  // Admin-only reprocessing action — runs ARIMA + RF, then shows the
  // refreshed view. Captures the full pipeline result (never discards it)
  // and reports Random Forest / Forecasting status separately, distinct
  // from "already running" and outright failure.
  const handleRunPipeline = useCallback(async () => {
    setPipelineRunStatus('loading');
    setPipelineRunResult(null);
    setPipelineRunErrorMessage(null);
    setInsightData(null);
    setInsightError(null);

    if (Number(startYear) > Number(endYear)) {
      setPipelineRunStatus('error');
      setPipelineRunErrorMessage('Start year must be on or before end year.');
      return;
    }

    try {
      const res = await API.post('/api/tb/pipeline', {
        forecastHorizon: forecastMonths,
        barangays: selectedBarangay ? [selectedBarangay] : undefined,
      });

      if (res.status === 202) {
        setPipelineRunStatus('already_running');
        return;
      }

      // The pipeline itself succeeded once we're here — everything below
      // this point is reporting on that success and then trying to refresh
      // the view. A failure in the refresh step must never be reported as
      // "Pipeline failed", since the pipeline run did not fail.
      const result = res.data?.result || {};
      const hasWarnings = Array.isArray(result.errors) && result.errors.length > 0;
      setPipelineRunResult({
        barangaysProcessed: result.barangaysProcessed ?? null,
        forecastsCount: result.forecastsCount ?? null,
        classificationsCount: result.classificationsCount ?? null,
        alertsCount: result.alertsCount ?? null,
        errors: result.errors || [],
      });
      setPipelineRunStatus(hasWarnings ? 'warning' : 'success');
      loadModelPerformance();
    } catch (err) {
      if (import.meta.env.DEV) console.error('Pipeline error:', err.response?.data?.error || err.message);
      setPipelineRunStatus('error');
      setPipelineRunErrorMessage(err.response?.data?.error || err.message || 'Pipeline failed.');
      return;
    }

    // Refresh the persisted forecast/model-status view after successful
    // processing, the same way View Forecast does. A failure here only
    // affects the content-area view state, not the pipeline result banner
    // above (which already correctly reported success/warning).
    setViewStatus('loading');
    setViewErrorMessage(null);
    try {
      const years = await refreshForecastView();
      const filters = applySelectedFilters(years);
      setViewSuccessInfo({ scope: `${filters.barangay || 'All Pasig Barangays'} • ${filters.startYear || 'N/A'}–${filters.endYear || 'N/A'}` });
      setViewStatus('checking');
      setInsightLoading(true);
      try {
        const insight = await getForecastingInsight(filters);
        setInsightData(insight);
      } catch (insightErr) {
        if (import.meta.env.DEV) console.error('Post-pipeline insight error:', insightErr);
        setInsightError('Unable to generate insight.');
      } finally {
        setInsightLoading(false);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Post-pipeline refresh error:', err.response?.data?.error || err.message);
      setViewStatus('error');
      setViewErrorMessage(err.response?.data?.error || err.message || 'Pipeline completed, but the view could not be refreshed. Click View Forecast to try again.');
    }
  }, [startYear, endYear, forecastMonths, selectedBarangay, refreshForecastView, applySelectedFilters, loadModelPerformance]);

  const handleReset = useCallback(() => {
    setStartYear(availableYears[0] || '');
    setEndYear(availableYears[availableYears.length - 1] || '');
    setSelectedBarangay('');
    setForecastMonths(3);
    setAppliedStartYear(null);
    setAppliedEndYear(null);
    setAppliedBarangay(null);
    setAppliedMonths(null);
    setViewStatus('idle');
    setViewErrorMessage(null);
    setViewSuccessInfo(null);
  }, [availableYears]);

  const handleGenerateInsight = useCallback(async () => {
    try {
      setInsightLoading(true);
      setInsightError(null);
      const insight = await getForecastingInsight({
        startYear: appliedStartYear,
        endYear: appliedEndYear,
        barangay: appliedBarangay,
        horizon: appliedMonths,
      });
      setInsightData(insight);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Insight generation failed:', err);
      setInsightError('Unable to generate insight.');
    } finally {
      setInsightLoading(false);
    }
  }, [appliedStartYear, appliedEndYear, appliedBarangay, appliedMonths]);

  /* ────────── Derived data (all behind viewStatus + applied filters) ────────── */

  const barangayNames = useMemo(
    () => barangays.map((b) => b.barangay_name || b.name).filter(Boolean).sort(),
    [barangays]
  );

  /** Filter monthly data by applied year range and barangay */
  const filteredMonthly = useMemo(() => {
    if (!appliedStartYear || !appliedEndYear) return [];
    let data = monthlyData;
    if (appliedBarangay) {
      data = data.filter((r) => r.barangay_name === appliedBarangay);
    }
    return data.filter((r) => {
      const yr = Number(localMonthKey(r.month)?.slice(0, 4));
      return yr >= Number(appliedStartYear) && yr <= Number(appliedEndYear);
    });
  }, [monthlyData, appliedStartYear, appliedEndYear, appliedBarangay]);

  /** Aggregate monthly data into time-series for chart */
  const aggregatedMonthly = useMemo(() => aggregateForecastHistory(filteredMonthly), [filteredMonthly]);

  /** Total historical cases in the selected period */
  const historicalCases = useMemo(() => aggregatedMonthly.length
    ? aggregatedMonthly.reduce((sum, r) => sum + r.cases, 0) : null, [aggregatedMonthly]);

  /** Latest actual month within the selected years and barangay. */
  const latestActualMonth = aggregatedMonthly[aggregatedMonthly.length - 1]?.month || null;

  /** Select the persisted months from the latest completed pipeline run. */
  const filteredForecasts = useMemo(() => {
    const runStart = String(pipelineStatus?.config?.period || '').slice(0, 7);
    if (!appliedMonths || !/^\d{4}-\d{2}$/.test(runStart)) return [];
    const [year, month] = runStart.split('-').map(Number);
    const months = new Set(Array.from({ length: appliedMonths }, (_, i) => {
      const d = new Date(year, month - 1 + i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }));
    let data = forecastsData.filter((r) => months.has(String(r.period || r.forecast_period || '').slice(0, 7)));
    if (appliedBarangay) {
      data = data.filter((r) => (r.barangay_name || '') === appliedBarangay);
    }

    // Aggregate by period. forecasted_count/CI are only summed from rows
    // that actually have a value — a barangay with insufficient history has
    // forecasted_count = null (see arima_forecast.py), and treating that as
    // 0 would misrepresent "not modeled" as "predicted zero cases".
    const byPeriod = {};
    data.forEach((r) => {
      const period = String(r.period || r.forecast_period || '').slice(0, 7);
      if (!period) return;
      if (!byPeriod[period]) {
        byPeriod[period] = {
          period,
          forecasted: 0,
          hasForecast: false,
          actual: 0,
          ci_lower: 0,
          ci_upper: 0,
          hasCI: false,
          count: 0,
          methodCounts: {},
        };
      }
      const p = byPeriod[period];
      if (r.forecasted_count != null) {
        p.forecasted += Number(r.forecasted_count);
        p.hasForecast = true;
      }
      if (r.confidence_lower != null && r.confidence_upper != null) {
        p.ci_lower += Number(r.confidence_lower);
        p.ci_upper += Number(r.confidence_upper);
        p.hasCI = true;
      }
      p.actual += Number(r.actual_count || 0);
      p.count += 1;
      // Tally forecast methods for a majority-vote tier label when
      // aggregating across barangays (city-wide view).
      const m = r.method || 'arima';
      p.methodCounts[m] = (p.methodCounts[m] || 0) + 1;
    });

    // Resolve majority method (forecast tier) per period.
    Object.values(byPeriod).forEach((p) => {
      let maxCount = 0;
      let majority = 'arima';
      for (const [m, cnt] of Object.entries(p.methodCounts)) {
        if (cnt > maxCount) { maxCount = cnt; majority = m; }
      }
      p.method = majority;
      delete p.methodCounts;
    });

    let result = Object.values(byPeriod).sort((a, b) => a.period.localeCompare(b.period));
    // Limit to horizon
    return result;
  }, [forecastsData, appliedBarangay, appliedMonths, pipelineStatus]);

  // Resolves the transient 'checking' state (set right after a successful
  // fetch) into 'success' or 'no_data' once historicalCases/filteredForecasts
  // have recomputed against the freshly-fetched data and just-applied
  // filters — these are memoized from state set in the same action, so they
  // aren't readable synchronously inside the handler that set that state.
  useEffect(() => {
    if (viewStatus !== 'checking') return;
    const hasData = historicalCases != null || filteredForecasts.length > 0;
    setViewStatus(hasData ? 'success' : 'no_data');
  }, [viewStatus, historicalCases, filteredForecasts]);

  /** Comparison forecasts for barangay comparison */
  const comparisonForecasts = useMemo(() => {
    if (!showCompare || !compareBarangay || !appliedMonths) return [];
    const selectedPeriods = new Set(filteredForecasts.map(r => r.period));
    let data = forecastsData.filter((r) => (r.barangay_name || '') === compareBarangay
      && selectedPeriods.has(String(r.period || r.forecast_period || '').slice(0, 7)));
    const byPeriod = {};
    data.forEach((r) => {
      const period = String(r.period || r.forecast_period || '').slice(0, 7);
      if (!period) return;
      if (!byPeriod[period]) {
        byPeriod[period] = { period, forecasted: 0, hasForecast: false, count: 0 };
      }
      if (r.forecasted_count != null) {
        byPeriod[period].forecasted += Number(r.forecasted_count);
        byPeriod[period].hasForecast = true;
      }
      byPeriod[period].count += 1;
    });
    let result = Object.values(byPeriod).sort((a, b) => a.period.localeCompare(b.period));
    if (appliedMonths) result = result.slice(0, appliedMonths);
    return result;
  }, [showCompare, compareBarangay, forecastsData, appliedMonths, filteredForecasts]);

  /** Build AVP chart data from backtest results (historical actual vs predicted) */
  const avpChartData = useMemo(() => {
    if (!backtestData.length) return [];
    let filtered = backtestData;
    if (appliedBarangay) {
      filtered = backtestData.filter((r) => r.barangay_name === appliedBarangay);
    }

    // Group by period — sum actual and predicted per period
    const byPeriod = {};
    filtered.forEach((r) => {
      const key = r.period || '';
      if (!key) return;
      if (!byPeriod[key]) {
        byPeriod[key] = { period: key, actual: 0, predicted: 0 };
      }
      byPeriod[key].actual += Number(r.actual_count || 0);
      byPeriod[key].predicted += Number(r.predicted_count || 0);
    });

    // Filter by applied year range
    return Object.values(byPeriod)
      .sort((a, b) => a.period.localeCompare(b.period))
      .filter((r) => {
        if (!appliedStartYear || !appliedEndYear) return true;
        const yr = new Date(r.period).getFullYear();
        return yr >= Number(appliedStartYear) && yr <= Number(appliedEndYear);
      })
      .map((r) => {
        const d = new Date(r.period);
        return {
          period: r.period,
          label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          Actual: Math.round(r.actual),
          Predicted: Math.round(r.predicted),
        };
      });
  }, [backtestData, appliedBarangay, appliedStartYear, appliedEndYear]);

  const avpSummary = useMemo(() => accuracySummary(avpChartData), [avpChartData]);

  /** Metric card computations */
  const totalForecasted = useMemo(() => {
    const modeled = filteredForecasts.filter(r => r.hasForecast);
    return modeled.length ? modeled.reduce((sum, r) => sum + r.forecasted, 0) : null;
  }, [filteredForecasts]);

  const growth = useMemo(() => calculateForecastGrowth(aggregatedMonthly, filteredForecasts), [aggregatedMonthly, filteredForecasts]);
  const growthRate = growth.rate;

  /** Forecast tier for the selected scope: 'arima' | a baseline method name
   * | 'insufficient_data' | null (nothing loaded yet). Drives the Model
   * Status KPI and the chart/table's tier labeling. */
  const forecastTier = useMemo(() => {
    if (!filteredForecasts.length) return null;
    return filteredForecasts[filteredForecasts.length - 1]?.method || null;
  }, [filteredForecasts]);
  const isBaselineTier = forecastTier != null && forecastTier !== 'arima' && forecastTier !== 'insufficient_data';

  /** Chart data: historical + forecast combined */
  const forecastChartData = useMemo(() => {
    const pointsByMonth = new Map();
    aggregatedMonthly.forEach((r) => {
      pointsByMonth.set(r.month, {
        label: r.label,
        month: r.month,
        Actual: r.cases,
        Forecast: null,
        ci_upper: null,
        ci_lower: null,
        isForecast: false,
      });
    });

    // A saved forecast may overlap months with actuals imported after its run.
    // Keep both series at those months so the chart shows what was predicted
    // alongside what subsequently happened.
    filteredForecasts.forEach((r) => {
      const d = new Date(`${r.period}-01T12:00:00`);
      const key = r.period;
      const hasValue = r.hasForecast;
      const comparePoint = comparisonForecasts.find((c) => {
        return c.period === key;
      });
      const existing = pointsByMonth.get(key);
      pointsByMonth.set(key, {
        ...existing,
        label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        month: r.period,
        Actual: existing?.Actual ?? null,
        // No point is drawn at all for an insufficient-history period — a
        // fabricated zero would misrepresent "not modeled" as a prediction.
        Forecast: hasValue ? Math.round(r.forecasted) : null,
        CompareForecast: hasValue && comparePoint?.hasForecast ? Math.round(comparePoint.forecasted) : null,
        ci_upper: hasValue && r.hasCI ? r.ci_upper : null,
        ci_lower: hasValue && r.hasCI ? r.ci_lower : null,
        isForecast: hasValue,
      });
    });
    return [...pointsByMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [aggregatedMonthly, filteredForecasts, comparisonForecasts]);

  /** First forecast label for the ReferenceLine */
  const forecastStartLabel = useMemo(() => {
    const first = forecastChartData.find((r) => r.isForecast);
    return first ? first.label : null;
  }, [forecastChartData]);

  /** Table rows for forecast details */
  const forecastTableRows = useMemo(() => {
    // Build actual case counts from raw case records (tb_cases) grouped by month
    const actualByPeriod = {};
    let rawCases = casesData;
    if (appliedBarangay) {
      rawCases = rawCases.filter((r) => r.barangay_name === appliedBarangay);
    }
    rawCases.forEach((r) => {
      const d = r.date_of_diagnosis;
      if (!d) return;
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return;
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      if (!actualByPeriod[key]) actualByPeriod[key] = 0;
      actualByPeriod[key] += 1;
    });

    // Find the latest period that has actual data
    const allActualPeriods = Object.keys(actualByPeriod).sort();
    const latestActualPeriod = allActualPeriods.length > 0 ? allActualPeriods[allActualPeriods.length - 1] : null;
    const lastActualCount = latestActualPeriod ? actualByPeriod[latestActualPeriod] : 0;

    return filteredForecasts.map((r, index) => {
      const periodKey = r.period;

      // Determine if this is a historical or forecast period
      const hasActual = actualByPeriod[periodKey] != null;
      const isHistorical = false;

      const actual = hasActual ? actualByPeriod[periodKey] : null;
      const isInsufficient = !isHistorical && r.method === 'insufficient_data';
      const forecasted = !isHistorical && r.hasForecast ? Math.round(Number(r.forecasted)) : null;
      const ci_lower = !isHistorical && r.hasCI ? Math.round(Number(r.ci_lower)) : null;
      const ci_upper = !isHistorical && r.hasCI ? Math.round(Number(r.ci_upper)) : null;

      // Growth: first forecast compares to last actual, subsequent compare to previous forecast
      let gr = null;
      if (!isHistorical && forecasted != null) {
        const previousForecast = filteredForecasts.slice(0, index).reverse().find(previous => previous.hasForecast);
        const baseline = previousForecast ? previousForecast.forecasted : lastActualCount;
        if (baseline > 0) {
          gr = (((forecasted - baseline) / baseline) * 100).toFixed(1);
        }
      }

      return {
        period: r.period,
        periodLabel: new Date(`${r.period}-01T12:00:00`).toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        }),
        actual,
        forecasted,
        ci_lower,
        ci_upper,
        growthRate: gr,
        method: r.method,
        isBaseline: !isHistorical && !isInsufficient && r.method !== 'arima',
        isInsufficient,
        isHistorical,
      };
    });
  }, [filteredForecasts, casesData, appliedBarangay]);

  const sortedForecastTable = useMemo(() => {
    const sorted = [...forecastTableRows];
    sorted.sort((a, b) => {
      let valA = a[sortKey];
      let valB = b[sortKey];
      if (valA == null) return 1;
      if (valB == null) return -1;
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [forecastTableRows, sortKey, sortDir]);

  /** Global min/max across all CI ranges for a shared bar scale */
  const ciGlobalScale = useMemo(() => {
    const forecastRows = sortedForecastTable.filter((r) => !r.isHistorical && r.forecasted != null && r.ci_lower != null && r.ci_upper != null && r.ci_lower <= r.ci_upper);
    if (!forecastRows.length) return { min: 0, max: 1 };
    const mins = forecastRows.map((r) => r.ci_lower);
    const maxs = forecastRows.map((r) => r.ci_upper);
    return { min: Math.min(...mins), max: Math.max(...maxs) };
  }, [sortedForecastTable]);

  const handleSort = useCallback(
    (key) => {
      setSortKey((prev) => {
        if (prev === key) {
          setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
          return key;
        }
        setSortDir('asc');
        return key;
      });
    },
    []
  );

  const renderSortIcon = useCallback(
    (key) => {
      if (sortKey !== key)
        return <i className="ri-arrow-up-down-line text-[10px] ml-1 opacity-30" />;
      return sortDir === 'asc' ? (
        <i className="ri-arrow-up-line text-[10px] ml-1" />
      ) : (
        <i className="ri-arrow-down-line text-[10px] ml-1" />
      );
    },
    [sortKey, sortDir]
  );

  /** Last updated from pipeline run timestamp */
  const lastUpdated = useMemo(() => {
    if (pipelineStatus?.trained_at) return new Date(pipelineStatus.trained_at);
    if (!casesData.length) return null;
    let latest = null;
    casesData.forEach((c) => {
      const d = c.date_of_diagnosis || c.created_at;
      if (d) {
        const dt = new Date(d);
        if (!latest || dt > latest) latest = dt;
      }
    });
    return latest;
  }, [pipelineStatus, casesData]);

  /* ────────── Sortable column definitions ────────── */

  const TABLE_COLUMNS = useMemo(
    () => [
      { key: 'periodLabel', label: 'MONTH' },
      { key: 'actual', label: 'REPORTED' },
      { key: 'forecasted', label: 'FORECAST' },
      { key: 'confidence', label: 'LIKELY RANGE' },
      { key: 'growthRate', label: 'CHANGE' },
      { key: 'method', label: 'METHOD' },
    ],
    []
  );

  /* ────────── Render ────────── */

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
             style={{ background: '#FEF2F2' }}
        >
          <i className="ri-error-warning-line text-3xl" style={{ color: '#EF4444' }} />
        </div>
        <span className="text-sm font-medium" style={{ color: '#64748B' }}>{error}</span>
        <button
          onClick={loadAll}
          className="px-4 py-2 text-xs font-medium"
          style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}
        >
          Retry
        </button>
      </div>
    );
  }

  // What the forecast is based on, from the last analysis run: the forecast always starts
  // the month after the latest month of data — not from today's date.
  const monthLabel = (ymd) => {
    const m = String(ymd || '').match(/^(\d{4})-(\d{2})/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : null;
  };
  const runMetrics = pipelineStatus?.metrics || {};
  const basisStart = monthLabel(aggregatedMonthly[0]?.month);
  const basisEnd = monthLabel(aggregatedMonthly[aggregatedMonthly.length - 1]?.month);
  const forecastStart = monthLabel(filteredForecasts[0]?.period);
  const forecastHorizon = Number(appliedMonths ?? runMetrics.forecastHorizon);
  const forecastEnd = monthLabel(filteredForecasts[filteredForecasts.length - 1]?.period);
  const runMethods = (runMetrics.forecastMethods || []).map(String);
  const forecastMethodLabel = runMethods.length === 0 ? null
    : runMethods.every(m => m === 'arima') ? 'ARIMA'
      : runMethods.includes('arima') ? 'ARIMA for most barangays, a simpler baseline where history is short'
        : 'a simple baseline (not ARIMA) — too little history or the ML service was unavailable';

  return (
    <div className="space-y-6">
      <ProgressOverlay
        open={pipelineRunStatus === 'loading'}
        title="Running the prediction pipeline"
        detail="Fitting an ARIMA forecast for each barangay, classifying risk with the Random Forest, and updating alerts."
        note="This usually takes a few minutes. Keep this page open until it finishes."
      />
      {/* ─── Header + Forecast Settings ─── */}
      <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
        {/* Header row */}
        <div className="flex flex-col justify-between gap-3 border-b border-[#E2E8F0] px-6 py-4 sm:flex-row sm:items-center">
          <div className="shrink-0">
            <h1 className="text-lg font-semibold tracking-tight text-[#0F2D52]">TB forecasting</h1>
            <p className="mt-1 text-xs text-[#64748B]">Review projected TB cases from historical records for Pasig City.</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {lastUpdated && (
              <span className="text-[11px] font-medium mr-2" style={{ color: '#94A3B8' }}>
                Last updated: {lastUpdated.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </span>
            )}
            <button
              type="button"
              onClick={handleReset}
              className="px-3 py-2 text-xs font-medium"
              style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={handleViewForecast}
              disabled={isBusy}
              title="Load the currently persisted forecast for the selected filters — does not reprocess any model"
              className="px-5 py-2 text-xs font-semibold disabled:opacity-60"
              style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}
            >
              {viewStatus === 'loading' || viewStatus === 'checking' ? <><i className="ri-loader-4-line text-xs animate-spin mr-1" /> Loading...</> : 'View Forecast'}
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={handleRunPipeline}
                disabled={isBusy}
                title="Processes the latest TB records to update forecasts and barangay risk classifications (admin)"
                className="px-5 py-2 text-xs font-semibold disabled:opacity-60"
                style={{ background: '#ffffff', color: '#0F2D52', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#EFF6FF'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#ffffff'; }}
              >
                {pipelineRunStatus === 'loading'
                  ? <><i className="ri-loader-4-line text-xs animate-spin mr-1" /> Running...</>
                  : <><i className="ri-refresh-line mr-1" />Run Analysis Pipeline</>}
              </button>
            )}
          </div>
        </div>

        {/* View Forecast success confirmation — small and non-permanent,
            since the chart/table below is the primary result. Cleared at
            the start of the next action. */}
        {viewStatus === 'success' && viewSuccessInfo && (
          <div className="px-6 py-2" style={{ borderTop: '1px solid #E2E8F0', background: '#F0FDF4' }}>
            <p className="text-[11px] font-semibold" style={{ color: '#047857' }}>
              <i className="ri-checkbox-circle-line mr-1" />
              Forecast loaded — {viewSuccessInfo.scope}{forecastTierMethodLabel(forecastTier) ? ` • Method: ${forecastTierMethodLabel(forecastTier)}` : ''}
            </p>
          </div>
        )}

        {/* Filter bar */}
        <div className="flex items-center justify-between px-6 py-3" style={{ background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <FilterSelect label="Start" value={startYear} onChange={setStartYear}>
              {availableYears.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
            </FilterSelect>
            <FilterSelect label="End" value={endYear} onChange={setEndYear}>
              {availableYears.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
            </FilterSelect>
            <FilterSelect label="Barangay" value={selectedBarangay} onChange={setSelectedBarangay} selectStyle={{ maxWidth: 180 }}>
              <option value="">All Pasig Barangays</option>
              {barangayNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </FilterSelect>
            <FilterSelect label="Horizon" value={forecastMonths} onChange={(v) => setForecastMonths(Number(v))}>
              {HORIZON_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </FilterSelect>
            <button
              type="button"
              onClick={() => setShowCompare(!showCompare)}
              className="px-3 py-[7px] text-[11px] font-semibold rounded-lg transition"
              style={{
                background: showCompare ? '#0F2D52' : '#ffffff',
                color: showCompare ? '#ffffff' : '#0F2D52',
                border: `1px solid ${showCompare ? '#0F2D52' : '#E2E8F0'}`,
              }}
            >
              <i className="ri-git-branch-line mr-1" />
              Compare
            </button>
            {showCompare && (
              <FilterSelect label="Compare" value={compareBarangay} onChange={setCompareBarangay} style={{ borderColor: '#F59E0B' }} selectStyle={{ maxWidth: 180 }}>
                <option value="">Select Barangay</option>
                {barangayNames.filter((n) => n !== selectedBarangay).map((name) => <option key={name} value={name}>{name}</option>)}
              </FilterSelect>
            )}
          </div>
        </div>
        <ModelOverview />
      </div>

      {viewStatus === 'success' && (
        <section className="rounded-lg border border-[#E2E8F0] bg-white px-5 py-4" aria-label="Forecast coverage">
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-[11px] font-semibold text-[#64748B]">Records used</p>
              <p className="mt-1 text-xs font-medium text-[#0F2D52]">{basisStart && basisEnd ? `${basisStart} – ${basisEnd}` : 'Unavailable'}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#64748B]">Latest reported month</p>
              <p className="mt-1 text-xs font-medium text-[#0F2D52]">{latestActualMonth ? monthLabel(latestActualMonth) : 'Unavailable'}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#64748B]">Forecast months</p>
              <p className="mt-1 text-xs font-medium text-[#0F2D52]">{forecastStart && forecastEnd ? `${forecastStart} – ${forecastEnd}` : 'Unavailable'}{forecastHorizon > 0 ? ` · ${forecastHorizon} month${forecastHorizon === 1 ? '' : 's'}` : ''}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#64748B]">Forecast method</p>
              <p className="mt-1 text-xs font-medium text-[#0F2D52]">{forecastMethodLabel ?? forecastTierMethodLabel(forecastTier) ?? 'Unavailable'}</p>
            </div>
          </div>
          {latestActualMonth && filteredForecasts.length > 0 && filteredForecasts[filteredForecasts.length - 1].period <= latestActualMonth && (
            <p className="mt-3 border-t border-[#E2E8F0] pt-3 text-xs text-[#92400E]">
              Newer cases are now available than this saved forecast. Run the analysis pipeline to update it.
            </p>
          )}
        </section>
      )}

      {/* ─── Run Analysis Pipeline result (admin) ─── */}
      {isAdmin && pipelineRunStatus !== 'idle' && (
        <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
          <div className="border-b border-[#E2E8F0] px-5 py-4">
            <h2 className="text-sm font-semibold text-[#0F2D52]">Analysis pipeline</h2>
          </div>
          <div className="px-5 py-4">
            {pipelineRunStatus === 'loading' ? (
              <div className="flex items-center gap-2 text-xs font-medium" style={{ color: '#64748B' }}>
                <i className="ri-loader-4-line animate-spin" />
                Processing the latest TB records — this may take a few minutes...
              </div>
            ) : pipelineRunStatus === 'already_running' ? (
              <div className="rounded-lg px-4 py-3" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                <p className="text-xs font-bold" style={{ color: '#92400E' }}>
                  <i className="ri-time-line mr-1" />
                  A pipeline run is already in progress.
                </p>
                <p className="text-[11px] mt-1" style={{ color: '#92400E' }}>
                  Another run (e.g. triggered automatically after a data sync) is currently processing. Try again shortly.
                </p>
              </div>
            ) : pipelineRunStatus === 'error' ? (
              <div className="rounded-lg px-4 py-3" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
                <p className="text-xs font-bold" style={{ color: '#B91C1C' }}>
                  <i className="ri-error-warning-line mr-1" />
                  Pipeline failed.
                </p>
                <p className="text-[11px] mt-1 font-mono break-words" style={{ color: '#991B1B' }}>{pipelineRunErrorMessage}</p>
                <p className="text-[11px] mt-1.5" style={{ color: '#7F1D1D' }}>
                  No forecasts or risk classifications were changed by this run.
                </p>
              </div>
            ) : (pipelineRunStatus === 'success' || pipelineRunStatus === 'warning') && pipelineRunResult ? (
              <div className="rounded-lg p-4" style={{ background: pipelineRunStatus === 'warning' ? '#FFFBEB' : '#F0FDF4', border: `1px solid ${pipelineRunStatus === 'warning' ? '#FDE68A' : '#BBF7D0'}` }}>
                <p className="text-xs font-bold mb-3" style={{ color: pipelineRunStatus === 'warning' ? '#92400E' : '#047857' }}>
                  <i className={pipelineRunStatus === 'warning' ? 'ri-alert-line mr-1' : 'ri-checkbox-circle-line mr-1'} />
                  {pipelineRunStatus === 'warning' ? 'Completed with warnings.' : 'Completed.'}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase" style={{ color: '#64748B' }}>Barangays</p>
                    <p className="text-sm font-extrabold" style={{ color: '#0F2D52' }}>{pipelineRunResult.barangaysProcessed ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase" style={{ color: '#64748B' }}>Forecasts</p>
                    <p className="text-sm font-extrabold" style={{ color: '#0F2D52' }}>{pipelineRunResult.forecastsCount ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase" style={{ color: '#64748B' }}>Classifications</p>
                    <p className="text-sm font-extrabold" style={{ color: '#0F2D52' }}>{pipelineRunResult.classificationsCount ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase" style={{ color: '#64748B' }}>Alerts</p>
                    <p className="text-sm font-extrabold" style={{ color: '#0F2D52' }}>{pipelineRunResult.alertsCount ?? '—'}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4 pt-3" style={{ borderTop: '1px solid #E2E8F0' }}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold" style={{ color: '#64748B' }}>Random Forest:</span>
                    <span className="text-[11px] font-extrabold" style={{ color: MODEL_STATUS_COLORS[pipelineStatus?.rf_status] || '#94A3B8' }}>
                      {formatModelStatus(pipelineStatus?.rf_status)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold" style={{ color: '#64748B' }}>Forecasting:</span>
                    <span className="text-[11px] font-extrabold" style={{ color: formatForecastingStatus(pipelineStatus?.arima_status).color }}>
                      {formatForecastingStatus(pipelineStatus?.arima_status).label}
                    </span>
                  </div>
                </div>
                {pipelineRunResult.errors.length > 0 && (
                  <div className="mt-3 pt-3" style={{ borderTop: '1px solid #E2E8F0' }}>
                    <p className="text-[10px] font-bold uppercase mb-1" style={{ color: '#92400E' }}>Warnings</p>
                    {pipelineRunResult.errors.map((e, i) => (
                      <p key={i} className="text-[11px]" style={{ color: '#92400E' }}>{e}</p>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ─── Content States ───
          Five distinct states, never conflated: idle (nothing requested),
          loading/checking, error (the GET itself failed — never silently
          shows stale data as if it had succeeded), no_data (request
          succeeded but there is no persisted forecast/history for this
          scope — NOT the same message as a request failure or as the
          model's own "Insufficient Historical Data" tier, which is a
          per-period banner shown inside the success view below), success. */}
      {viewStatus === 'idle' ? (
        /* ─── 9. IDLE STATE ─── */
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-[#E2E8F0] bg-white px-5 py-16">
          <div className="text-center">
            <p className="text-sm font-bold" style={{ color: '#475569' }}>
              No Forecast Loaded
            </p>
            <p className="text-xs mt-1 max-w-sm" style={{ color: '#94A3B8' }}>
              Select a historical period, barangay, and forecast horizon, then click View
              Forecast to load the current projections.
            </p>
          </div>
        </div>
      ) : viewStatus === 'loading' || viewStatus === 'checking' ? (
        /* ─── 10. LOADING STATE ─── */
        <SectionSkeleton rows={4} />
      ) : viewStatus === 'error' ? (
        /* ─── 11. REQUEST-FAILED STATE — distinct from "no data" and from
            the model's own "Insufficient Historical Data" tier. ─── */
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-[#E2E8F0] bg-white px-5 py-16">
          <div className="text-center">
            <p className="text-sm font-bold" style={{ color: '#475569' }}>
              Couldn't Load Forecast
            </p>
            <p className="text-xs mt-1 max-w-sm" style={{ color: '#94A3B8' }}>
              {viewErrorMessage || 'The request failed. Check your connection and try again.'}
            </p>
            <button
              type="button"
              onClick={handleViewForecast}
              className="mt-4 px-4 py-2 text-xs font-semibold"
              style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 }}
            >
              Retry
            </button>
          </div>
        </div>
      ) : viewStatus === 'no_data' ? (
        /* ─── 12. NO PERSISTED FORECAST FOR THIS SCOPE — the request
            succeeded; there is simply nothing computed yet. Never worded as
            "Insufficient Historical Data", which is a specific per-period
            model-tier concept shown elsewhere once data exists. ─── */
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-[#E2E8F0] bg-white px-5 py-16">
          <div className="text-center">
            <p className="text-sm font-bold" style={{ color: '#475569' }}>
              No Forecast Available
            </p>
            <p className="text-xs mt-1 max-w-sm" style={{ color: '#94A3B8' }}>
              There is no persisted forecast or historical data for the selected barangay and period.
              Try different filters, or ask an admin to run the analysis pipeline.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6 xl:flex-row">
          {/* ─── LEFT COLUMN: KPI Cards + Charts (scrollable) ─── */}
          <div className="flex-1 min-w-0 space-y-6">

          {/* ─── 3. METRIC CARDS ─── */}
          <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
            <div className="grid grid-cols-2 lg:grid-cols-4">
              {/* Historical Cases */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-database-2-line text-sm" style={{ color: '#6B7FA3' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Reported cases</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{historicalCases != null ? historicalCases.toLocaleString() : 'N/A'}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{appliedStartYear} – {appliedEndYear} period</span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Forecasted Cases */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-line-chart-line text-sm" style={{ color: '#6B9E9E' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Projected cases</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{totalForecasted != null ? Math.round(totalForecasted).toLocaleString() : 'N/A'}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>Next {appliedMonths} month{Number(appliedMonths) === 1 ? '' : 's'}</span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Expected Growth Rate */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-percent-line text-sm" style={{ color: growthRate == null || growthRate >= 0 ? '#B07070' : '#6B9E8A' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Expected change</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <div className="flex items-end gap-2">
                  <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                    {growthRate == null ? 'N/A' : `${growthRate >= 0 ? '+' : '\u2212'}${Math.abs(growthRate).toFixed(1)}%`}
                  </p>
                </div>
                <span className="text-[11px] font-medium mt-1" style={{ color: growthRate >= 0 ? '#B07070' : '#6B9E8A' }}>
                  {growthRate == null ? growth.reason : `${growthRate > 0 ? 'Above' : growthRate < 0 ? 'Below' : 'Same as'} recent average of ${growth.baseline.toFixed(1)} cases/month`}
                </span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Model Status — RF and ARIMA reported independently, since a
                  run where one succeeds and the other degrades/fails is not
                  the same as a fully healthy run (see model_metadata's
                  rf_status/arima_status). Random Forest / GIS risk output is
                  a separate branch and is not shown on this page. */}
              <div className="flex flex-col px-5 py-5" title="Random Forest risk classification is shown on the GIS page, not here — this page tracks ARIMA forecasting only.">
                <div className="flex items-center gap-2">
                  <i className="ri-cpu-line text-sm" style={{ color: '#8B7BA3' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Analysis status</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold" style={{ color: '#64748B' }}>GIS risk</span>
                    <span className="text-[11px] font-extrabold" style={{ color: MODEL_STATUS_COLORS[pipelineStatus?.rf_status] || '#94A3B8' }}>
                      {formatModelStatus(pipelineStatus?.rf_status)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-semibold shrink-0" style={{ color: '#64748B' }}>Case forecast</span>
                    <span className="text-[11px] font-extrabold text-right" style={{ color: formatForecastingStatus(pipelineStatus?.arima_status).color }}>
                      {formatForecastingStatus(pipelineStatus?.arima_status).label}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ─── 4. MAIN FORECAST GRAPH ─── */}
          <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-4">
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="text-base font-bold text-[#0F2D52]">TB cases: reported and forecast — {scopeLabel(appliedBarangay)}</h3>
                  <p className="mt-1 text-xs text-[#475569]">
                    {forecastChartData.length > 0 ? `${forecastChartData[0].label} – ${forecastChartData[forecastChartData.length - 1].label}. ` : ''}
                    Solid line: cases actually reported each month. Dashed line: cases the model expects in the coming months.
                  </p>
                  {forecastTier === 'insufficient_data' && (
                    <p className="text-[10px] mt-0.5 font-medium" style={{ color: '#B91C1C' }}>
                      Insufficient Historical Data — no forecast is shown for the selected scope.
                    </p>
                  )}
                  {isBaselineTier && (
                    <p className="text-[10px] mt-0.5 font-medium" style={{ color: '#D97706' }}>
                      A simpler baseline estimate is shown because the full forecasting model was unavailable for this selection.
                    </p>
                  )}
                </div>
              </div>
              {/* Inline legend */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-6 h-[3px] rounded-full" style={{ background: '#0F2D52' }} />
                  <span className="text-[11px] font-medium" style={{ color: '#64748B' }}>Actual</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-4 h-0 border-t-2" style={{ borderColor: '#6B9E8A', borderStyle: 'dashed' }} />
                  <span className="text-[11px] font-medium" style={{ color: '#64748B' }}>Forecast</span>
                </div>
                {forecastChartData.some((row) => row.ci_upper != null) && (
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-4 bg-[#DCEBE5]" aria-hidden="true" />
                    <span className="text-[11px] text-[#64748B]" title="The real count will most likely fall inside the shaded area">Likely range</span>
                  </div>
                )}
                {showCompare && compareBarangay && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-0 border-t-2" style={{ borderColor: '#F59E0B', borderStyle: 'dashed' }} />
                    <span className="text-[11px] font-medium" style={{ color: '#64748B' }}>{compareBarangay}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="px-5 pb-5">
              {forecastChartData.length > 0 ? (
                <div className="h-[380px] w-full" role="img" aria-label={`Reported and forecast TB cases per month, ${scopeLabel(appliedBarangay)}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={forecastChartData} margin={{ top: 20, right: 25, left: 15, bottom: 20 }}>
                      <CartesianGrid vertical={false} stroke="#E8EDF2" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 12, fill: '#475569' }}
                        axisLine={false}
                        tickLine={false}
                        tickMargin={8}
                        label={{ value: 'Month', position: 'insideBottom', offset: -14, fontSize: 12, fill: '#64748B' }}
                      />
                      <YAxis
                        tick={{ fontSize: 12, fill: '#475569' }}
                        axisLine={false}
                        tickLine={false}
                        tickMargin={4}
                        width={48}
                        label={{ value: 'TB cases per month', angle: -90, position: 'insideLeft', offset: -2, fontSize: 12, fill: '#64748B', style: { textAnchor: 'middle' } }}
                      />
                      <Tooltip content={<ForecastTooltip />} />

                      {/* Confidence band */}
                      <Area
                        type="monotone"
                        dataKey="ci_upper"
                        stroke="none"
                        fill="#6B9E8A"
                        fillOpacity={0.13}
                        isAnimationActive={false}
                        name="CI Upper"
                      />
                      <Area
                        type="monotone"
                        dataKey="ci_lower"
                        stroke="none"
                        fill="#ffffff"
                        isAnimationActive={false}
                        name="CI Lower"
                      />

                      {/* Actual Cases line */}
                      <Line
                        type="monotone"
                        dataKey="Actual"
                        stroke="#0F2D52"
                        strokeWidth={3}
                        dot={{ fill: '#0F2D52', r: 3, strokeWidth: 0 }}
                        activeDot={{ r: 6, strokeWidth: 2, stroke: '#ffffff' }}
                        connectNulls={false}
                        name="Reported cases"
                      />

                      {/* Forecasted Cases line */}
                      <Line
                        type="monotone"
                        dataKey="Forecast"
                        stroke="#3F7F6B"
                        strokeWidth={3}
                        strokeDasharray="8 4"
                        dot={{ fill: '#3F7F6B', r: 3.5, strokeWidth: 1, stroke: '#ffffff' }}
                        activeDot={{ r: 6, strokeWidth: 2, stroke: '#ffffff' }}
                        connectNulls={false}
                        name="Forecast cases"
                      />

                      {/* Comparison Forecast line */}
                      {showCompare && compareBarangay && (
                        <Line
                          type="monotone"
                          dataKey="CompareForecast"
                          stroke="#F59E0B"
                          strokeWidth={2.5}
                          strokeDasharray="8 4"
                          dot={{ fill: '#F59E0B', r: 4, strokeWidth: 2, stroke: '#ffffff' }}
                          activeDot={{ r: 6, strokeWidth: 2, stroke: '#ffffff' }}
                          connectNulls={false}
                          name={`${compareBarangay} Forecast`}
                        />
                      )}

                      {/* Forecast start marker */}
                      {forecastStartLabel && (
                        <ReferenceLine
                          x={forecastStartLabel}
                           stroke="#92400E"
                          strokeWidth={1.5}
                          strokeDasharray="6 4"
                          label={{
                            value: 'Forecast Start',
                            position: 'top',
                             fill: '#92400E',
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="py-12 text-center text-xs text-[#64748B]">No forecast chart data available.</p>
              )}
              <ChartInsight text={forecastInsight(forecastChartData, { methodLabel: forecastMethodLabel })} plain />
            </div>
          </div>

          {/* ─── 5. ACTUAL VS PREDICTED GRAPH ─── */}
            <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-4">
                <div className="flex items-center gap-3">
                  <div>
                    <h3 className="text-base font-bold text-[#0F2D52]">How accurate were the forecasts? — {scopeLabel(appliedBarangay)}</h3>
                    <p className="mt-1 text-xs text-[#475569]">
                      {avpSummary ? `${avpSummary.first} – ${avpSummary.last}. ` : ''}
                      For each past month the model predicted the cases using only earlier records; the chart puts that prediction next to the cases actually reported.
                    </p>
                    {backtestEvaluatedAt && (
                      <p className="text-[10px] mt-0.5" style={{ color: '#94A3B8' }}>
                        From the model test saved {new Date(backtestEvaluatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="w-7 h-[4px]" style={{ background: '#0F2D52' }} />
                    <span className="text-xs font-semibold" style={{ color: '#0F2D52' }}>Actual (reported)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-7 h-0 border-t-[3px]" style={{ borderColor: '#3F7F6B', borderStyle: 'dashed' }} />
                    <span className="text-xs font-semibold" style={{ color: '#3F7F6B' }}>Predicted by the model</span>
                  </div>
                </div>
              </div>
              <div className="px-5 pb-5">
                {avpSummary && (
                  <div className="grid grid-cols-1 gap-3 pt-4 sm:grid-cols-3">
                    <SummaryStat value={`${avpSummary.accuracy}%`} label="accurate overall (predicted vs reported cases)" />
                    <SummaryStat value={`± ${avpSummary.avgOff.toLocaleString()} cases`} label="typical difference in a month" />
                    <SummaryStat value={avpSummary.months} label={`months tested (${avpSummary.first} – ${avpSummary.last})`} />
                  </div>
                )}
                {avpChartData.length > 0 ? (
                  <div className="mt-4 h-[420px] w-full" role="img" aria-label={`Actual and predicted TB cases per month, ${scopeLabel(appliedBarangay)}`}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={avpChartData} margin={{ top: 10, right: 25, left: 15, bottom: 20 }}>
                        <CartesianGrid vertical={false} stroke="#E8EDF2" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 12, fill: '#475569' }}
                          axisLine={false}
                          tickLine={false}
                          tickMargin={8}
                          label={{ value: 'Month', position: 'insideBottom', offset: -14, fontSize: 12, fill: '#64748B' }}
                        />
                        <YAxis
                          tick={{ fontSize: 12, fill: '#475569' }}
                          axisLine={false}
                          tickLine={false}
                          tickMargin={4}
                          width={48}
                          label={{ value: 'TB cases per month', angle: -90, position: 'insideLeft', offset: -2, fontSize: 12, fill: '#64748B', style: { textAnchor: 'middle' } }}
                        />
                        <Tooltip content={<AvpTooltip />} />
                        <Line
                          type="monotone"
                          dataKey="Actual"
                          stroke="#0F2D52"
                          strokeWidth={3}
                          dot={{ fill: '#0F2D52', r: 3, strokeWidth: 0 }}
                          activeDot={{ r: 6, strokeWidth: 2, stroke: '#ffffff' }}
                          name="Actual (reported)"
                        />
                        <Line
                          type="monotone"
                          dataKey="Predicted"
                          stroke="#3F7F6B"
                          strokeWidth={3}
                          strokeDasharray="8 4"
                          dot={{ fill: '#3F7F6B', r: 3, strokeWidth: 0 }}
                          activeDot={{ r: 6, strokeWidth: 2, stroke: '#ffffff' }}
                          name="Predicted by the model"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="py-12 text-center text-xs text-[#64748B]">No saved model test yet. It is created automatically after the analysis pipeline runs.</p>
                )}
                <ChartInsight text={accuracyInsight(avpChartData)} plain />
              </div>
            </div>

            {/* ─── 6. FORECAST DETAILS TABLE ─── */}
            <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
              <div className="border-b border-[#E2E8F0] px-5 py-4">
                <h3 className="text-base font-bold text-[#0F2D52]">Month-by-month forecast — {scopeLabel(appliedBarangay)}</h3>
                <p className="mt-1 text-xs text-[#475569]">Each row is one month. <span className="font-semibold">Forecast</span> is the model's best guess; <span className="font-semibold">Likely range</span> is where the real count will most likely fall (the dot is the forecast). A dash means no value is available.</p>
              </div>
              <div className="px-5 pb-5">
                {sortedForecastTable.length > 0 ? (
                  <div className="overflow-x-auto -mx-5">
                    <table className="w-full text-sm" style={{ minWidth: 750 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#0F2D52' }}>
                          {TABLE_COLUMNS.map((col) => (
                            <th
                              key={col.key}
                              onClick={() => col.key !== 'confidence' && handleSort(col.key)}
                              className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest cursor-pointer select-none whitespace-nowrap"
                              style={{ color: '#ffffff' }}
                            >
                              <span className="inline-flex items-center gap-1">
                                {col.label}
                                {col.key !== 'confidence' && renderSortIcon(col.key)}
                              </span>
                            </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedForecastTable.map((row, i) => {
                        const gr = row.growthRate != null ? Number(row.growthRate) : null;
                        const modelLabel = row.isInsufficient ? 'Too little history' : row.isBaseline ? 'Baseline estimate' : row.method === 'arima' ? 'ARIMA' : null;
                        const modelColor = row.isInsufficient
                          ? MODEL_STATUS_COLORS.insufficient_data
                          : row.isBaseline
                            ? MODEL_STATUS_COLORS.degraded
                            : MODEL_STATUS_COLORS.success;

                        // Historical periods: show actual only. Forecast periods: show forecast + CI only.
                        const hasCI = row.ci_lower != null && row.ci_upper != null && row.ci_lower <= row.ci_upper;
                        const showCI = !row.isHistorical && row.forecasted != null && hasCI;
                        const { min: gMin, max: gMax } = ciGlobalScale;
                        const gRange = gMax - gMin || 1;
                        const barLeft = showCI ? ((row.ci_lower - gMin) / gRange) * 100 : 0;
                        const barWidth = showCI ? ((row.ci_upper - row.ci_lower) / gRange) * 100 : 0;
                        const forecastPos = showCI ? ((row.forecasted - gMin) / gRange) * 100 : 0;

                        return (
                          <tr
                            key={`${row.period}-${i}`}
                            style={{
                              borderBottom: '1px solid #F1F5F9',
                              background: row.isHistorical ? '#F8FAFC' : (i % 2 === 0 ? '#ffffff' : '#FAFBFC'),
                            }}
                            className="hover:bg-blue-50/40 transition-colors"
                          >
                            <td className="px-5 py-3 text-xs font-semibold" style={{ color: '#1E293B' }}>
                              {row.periodLabel}
                              {row.isHistorical && (
                                <span className="ml-2 text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded" style={{ background: '#E2E8F0', color: '#64748B' }}>Actual</span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-xs font-medium" style={{ color: '#1E293B' }}>
                              {row.actual != null ? row.actual.toLocaleString() : '\u2014'}
                            </td>
                            <td className="px-5 py-3 text-xs font-medium" style={{ color: row.isInsufficient ? '#B91C1C' : '#1E293B' }}>
                              {row.isInsufficient
                                ? 'Insufficient Historical Data'
                                : !row.isHistorical && row.forecasted != null ? row.forecasted.toLocaleString() : '\u2014'}
                            </td>
                            <td className="px-5 py-3">
                              {showCI ? (
                                <div className="flex items-center gap-3 min-w-[160px]">
                                  <span className="text-[11px] font-medium tabular-nums" style={{ color: '#94A3B8', minWidth: 28 }}>
                                    {row.ci_lower.toLocaleString()}
                                  </span>
                                  <div className="relative flex-1 h-2 rounded-full" style={{ background: '#E2E8F0' }}
                                    title={`Forecast ${row.forecasted.toLocaleString()} cases; most likely between ${row.ci_lower.toLocaleString()} and ${row.ci_upper.toLocaleString()}`}
                                  >
                                    <div
                                      className="absolute top-0 h-full rounded-full"
                                      style={{
                                        background: '#C8DDD7',
                                        left: `${barLeft}%`,
                                        width: `${Math.max(2, barWidth)}%`,
                                      }}
                                    />
                                    <div
                                      className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white"
                                      style={{ background: '#6B9E8A', left: `${forecastPos}%`, transform: 'translate(-50%, -50%)' }}
                                    />
                                  </div>
                                  <span className="text-[11px] font-medium tabular-nums" style={{ color: '#94A3B8', minWidth: 28 }}>
                                    {row.ci_upper.toLocaleString()}
                                  </span>
                                </div>
                              ) : !row.isHistorical && row.forecasted != null ? (
                                <span className="text-[11px]" style={{ color: '#94A3B8' }}>—</span>
                              ) : (
                                <span className="text-[11px]" style={{ color: '#94A3B8' }}>{"\u2014"}</span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-xs font-semibold" style={{ color: gr != null ? (gr >= 0 ? '#EF4444' : '#10B981') : '#94A3B8' }}>
                              {!row.isHistorical && gr != null ? `${gr >= 0 ? '+' : ''}${gr.toFixed(1)}%` : '\u2014'}
                            </td>
                            <td className="px-5 py-3">
                              {!row.isHistorical && modelLabel ? (
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: modelColor }} />
                                  <span className="text-xs font-semibold" style={{ color: '#1E293B' }}>{modelLabel}</span>
                                </div>
                              ) : (
                                <span className="text-[11px]" style={{ color: '#94A3B8' }}>{"\u2014"}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-12 text-center text-xs text-[#64748B]">No forecast detail data available.</p>
              )}
              <ChartInsight text={monthByMonthForecastInsight(forecastTableRows)} plain />
            </div>
          </div>
          </div>

          {/* Forecast interpretation remains available on smaller screens. */}
          <div className="w-full shrink-0 xl:w-[340px]">
            <div className="xl:sticky xl:top-4">
              <AnalyticsInsightPanel
                title="Forecast interpretation"
                description="The main result and what it means."
                titleId="forecast-interpretation-title"
                compact
                data={insightData}
                loading={insightLoading}
                error={insightError}
                onRetry={handleGenerateInsight}
                onGenerate={handleGenerateInsight}
              />
            </div>
          </div>
        </div>
      )}

      <ModelEvaluationPanel
        open={evaluationOpen}
        onToggle={toggleEvaluation}
        record={modelEvaluation}
        status={evaluationStatus}
        loading={performanceLoading}
        error={performanceError}
        filters={evaluationFilters}
      />
    </div>
  );
}
