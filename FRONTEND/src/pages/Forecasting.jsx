import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChart, Line, Area, CartesianGrid, XAxis, YAxis,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import API from '../api/axios';
import AiInsightPanel from '../components/AiInsightPanel';
import ChartInsight from '../components/ChartInsight';
import { forecastInsight, accuracyInsight } from '../utils/chartInsights';
import FilterSelect from '../components/FilterSelect';
import { getForecastingInsight } from '../services/insightService';

/* ─── Constants ──────────────────────────────────────────────────────── */

const ALL_YEARS = ['2023', '2024', '2025', '2026'];

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
      className="px-3 py-2.5 rounded-lg text-xs shadow-lg"
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
    </div>
  );
}

function SectionSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-4 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl overflow-hidden"
          style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}
        >
          <div className="px-5 py-3.5" style={{ borderBottom: '1px solid #F1F5F9' }}>
            <div className="h-3 w-32 rounded" style={{ background: '#E2E8F0' }} />
          </div>
          <div className="p-5">
            <div className="h-48 w-full rounded-lg" style={{ background: '#F1F5F9' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Model Evaluation results (walk-forward metrics from the ML service) ─── */

function EvalMetric({ label, value }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
      <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#94A3B8' }}>{label}</div>
      <div className="text-sm font-extrabold mt-0.5" style={{ color: '#0F2D52' }}>{value}</div>
    </div>
  );
}

function EvaluationResults({ evaluation }) {
  const arima = evaluation?.arima || {};
  const rf = evaluation?.rf || {};
  const methods = arima.method_counts || {};
  const arimaTotal = Object.values(methods).reduce((a, b) => a + b, 0);
  const arimaSteps = methods.arima || 0;
  const fallbackSteps = arimaTotal - arimaSteps;
  const fmt = (v, digits = 4) => (v == null ? '\u2014' : Number(v).toFixed(digits));
  const pct = (v, digits = 1) => (v == null ? '\u2014' : `${(Number(v) * 100).toFixed(digits)}%`);
  const classes = ['Low', 'Medium', 'High'];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* ARIMA */}
      <div className="rounded-lg p-4" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-xs font-extrabold uppercase tracking-wide" style={{ color: '#0F2D52' }}>ARIMA Forecast</h3>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
            style={fallbackSteps === 0
              ? { background: '#ECFDF5', color: '#047857' }
              : { background: '#FFFBEB', color: '#B45309' }}
          >
            {arimaTotal === 0 ? 'No steps evaluated'
              : fallbackSteps === 0 ? `All ${arimaTotal} steps: ARIMA`
              : `${fallbackSteps} of ${arimaTotal} steps used fallback`}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <EvalMetric label="MAE" value={fmt(arima.mae)} />
          <EvalMetric label="MAPE" value={arima.mape != null ? `${arima.mape}%` : '\u2014'} />
          <EvalMetric label="Steps/barangay" value={arima.n_steps ?? '\u2014'} />
        </div>
        {fallbackSteps > 0 && (
          <p className="text-[11px] mt-2.5 leading-relaxed" style={{ color: '#B45309' }}>
            MAE/MAPE include fallback models:{' '}
            {Object.entries(methods).filter(([m]) => m !== 'arima').map(([m, c]) => `${m} \u00D7 ${c}`).join(', ')}.
          </p>
        )}
        {arimaTotal > 0 && (
          <p className="text-[11px] mt-2" style={{ color: '#94A3B8' }}>
            {arimaSteps} real ARIMA fit{arimaSteps === 1 ? '' : 's'} across barangays · one-step-ahead walk-forward.
          </p>
        )}
        {Array.isArray(arima.failed_barangays) && arima.failed_barangays.length > 0 && (
          <div className="mt-2.5 pt-2.5" style={{ borderTop: '1px solid #FECACA' }}>
            <p className="text-[11px] font-bold" style={{ color: '#B91C1C' }}>
              {arima.failed_barangays.length} barangay{arima.failed_barangays.length === 1 ? '' : 's'} could not be evaluated:
            </p>
            {arima.failed_barangays.map((f, i) => (
              <p key={i} className="text-[11px]" style={{ color: '#991B1B' }}>{f.barangay_name}: {f.error}</p>
            ))}
          </div>
        )}
      </div>

      {/* Random Forest */}
      <div className="rounded-lg p-4" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-xs font-extrabold uppercase tracking-wide" style={{ color: '#0F2D52' }}>Random Forest</h3>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: '#EFF6FF', color: '#1E40AF' }}>
            {rf.n_steps ? `${rf.n_steps} test months` : 'No steps evaluated'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <EvalMetric label="Accuracy" value={pct(rf.accuracy)} />
          <EvalMetric label="F1 (macro)" value={pct(rf.f1_macro)} />
          <EvalMetric label="Steps" value={rf.n_steps ?? '\u2014'} />
        </div>
        <div className="mt-3 space-y-1">
          {classes.map((cls) => (
            <div key={cls} className="flex items-center justify-between text-[11px]">
              <span className="font-semibold" style={{ color: '#64748B' }}>{cls}</span>
              <span style={{ color: '#334155' }}>
                Precision {fmt(rf.precision?.[cls])} · Recall {fmt(rf.recall?.[cls])}
              </span>
            </div>
          ))}
        </div>
        {rf.confusion_matrix && (
          <div className="mt-3">
            <p className="text-[10px] font-bold mb-1" style={{ color: '#64748B' }}>Confusion matrix (rows = actual)</p>
            <table className="text-[10px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th />
                  {classes.map((c) => (
                    <th key={c} className="font-semibold" style={{ color: '#94A3B8', padding: '2px 8px', textAlign: 'center' }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classes.map((a) => (
                  <tr key={a}>
                    <th className="font-semibold" style={{ color: '#64748B', padding: '2px 8px', textAlign: 'left' }}>{a}</th>
                    {classes.map((p) => (
                      <td key={p} style={{ color: '#334155', padding: '2px 8px', textAlign: 'center' }}>
                        {rf.confusion_matrix[a]?.[p] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main Forecasting Component ─────────────────────────────────────── */

export default function Forecasting() {
  /* ── Data state ── */
  const [monthlyData, setMonthlyData] = useState([]);
  const [forecastsData, setForecastsData] = useState([]);
  const [backtestData, setBacktestData] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [casesData, setCasesData] = useState([]);
  const [pipelineStatus, setPipelineStatus] = useState(null);

  /* ── Control state (user selections before clicking Run) ── */
  const [startYear, setStartYear] = useState('2024');
  const [endYear, setEndYear] = useState('2025');
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

  /* ── Model evaluation (Evaluate Model — admin only) ── */
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState(null);
  const [evalResult, setEvalResult] = useState(null);
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

  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [monthlyRes, forecastsRes, barangaysRes, firstPageRes, pipelineRes, backtestRes] =
        await Promise.all([
          API.get('/api/tb/dashboard/monthly'),
          API.get('/api/tb/forecasts'),
          API.get('/api/tb/barangays'),
          API.get('/api/tb/cases?limit=1'),
          API.get('/api/tb/pipeline/status').catch(() => ({ data: { latest_run: null } })),
          API.get('/api/tb/forecast/backtest').catch(() => ({ data: { data: [] } })),
        ]);
      const totalCases = firstPageRes.data.pagination?.total || 0;
      const allCasesRes = totalCases > 0
        ? await API.get(`/api/tb/cases?limit=${totalCases}`)
        : firstPageRes;
      setMonthlyData(monthlyRes.data.monthly || []);
      setForecastsData(forecastsRes.data.forecasts || []);
      setBarangays(barangaysRes.data.barangays || []);
      setCasesData(allCasesRes.data.cases || []);
      setPipelineStatus(pipelineRes.data.latest_run || null);
      setBacktestData(backtestRes.data.data || []);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Forecasting fetch error:', err);
      setError('Failed to load analytics data. Make sure the backend is running.');
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /* ────────── Run Forecast ────────── */

  const refreshForecastView = useCallback(async () => {
    const [freshForecasts, freshAvp, freshPipeline] = await Promise.all([
      API.get('/api/tb/forecasts'),
      API.get('/api/tb/forecast/backtest'),
      API.get('/api/tb/pipeline/status').catch(() => ({ data: { latest_run: null } })),
    ]);
    setForecastsData(freshForecasts.data.forecasts || []);
    setBacktestData(freshAvp.data.data || []);
    setPipelineStatus(freshPipeline.data.latest_run || null);
  }, []);

  const applySelectedFilters = useCallback(() => {
    setAppliedStartYear(startYear);
    setAppliedEndYear(endYear);
    setAppliedBarangay(selectedBarangay);
    setAppliedMonths(forecastMonths);
  }, [startYear, endYear, selectedBarangay, forecastMonths]);

  const scopeLabel = useCallback(() => {
    const barangayPart = selectedBarangay || 'All Pasig Barangays';
    return `${barangayPart} • ${startYear}–${endYear}`;
  }, [selectedBarangay, startYear, endYear]);

  // Loads currently persisted forecasts under the selected filters — read-only,
  // available to every user, never reprocesses ARIMA/RF. A failed request
  // moves to 'error' and stops — it never leaves stale forecastsData/
  // backtestData on screen looking like a successful result.
  const handleViewForecast = useCallback(async () => {
    setViewStatus('loading');
    setViewErrorMessage(null);
    setViewSuccessInfo(null);

    if (Number(startYear) > Number(endYear)) {
      setViewStatus('error');
      setViewErrorMessage('Start year must be on or before end year.');
      return;
    }

    try {
      await refreshForecastView();
      applySelectedFilters();
      setViewSuccessInfo({ scope: scopeLabel() });
      setViewStatus('checking');
    } catch (err) {
      if (import.meta.env.DEV) console.error('Forecast fetch error:', err.response?.data?.error || err.message);
      setViewStatus('error');
      setViewErrorMessage(err.response?.data?.error || err.message || 'Could not load the forecast.');
    }
  }, [startYear, endYear, refreshForecastView, applySelectedFilters, scopeLabel]);

  // Admin-only reprocessing action — runs ARIMA + RF, then shows the
  // refreshed view. Captures the full pipeline result (never discards it)
  // and reports Random Forest / Forecasting status separately, distinct
  // from "already running" and outright failure.
  const handleRunPipeline = useCallback(async () => {
    setPipelineRunStatus('loading');
    setPipelineRunResult(null);
    setPipelineRunErrorMessage(null);

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
      await refreshForecastView();
      applySelectedFilters();
      setViewSuccessInfo({ scope: scopeLabel() });
      setViewStatus('checking');
    } catch (err) {
      if (import.meta.env.DEV) console.error('Post-pipeline refresh error:', err.response?.data?.error || err.message);
      setViewStatus('error');
      setViewErrorMessage(err.response?.data?.error || err.message || 'Pipeline completed, but the view could not be refreshed. Click View Forecast to try again.');
    }
  }, [startYear, endYear, forecastMonths, selectedBarangay, refreshForecastView, applySelectedFilters, scopeLabel]);

  /* ────────── Evaluate Model (admin) ────────── */

  // Walk-forward evaluation of ARIMA + RF via the existing
  // POST /api/tb/evaluate endpoint. Metrics arrive from the backend/ML
  // service as-is — nothing is computed or substituted in the frontend.
  // On any failure (e.g. ML service down) the error is shown INSTEAD of
  // results, so fallback models can never be presented as ARIMA/RF metrics.
  const handleRunEvaluation = useCallback(async () => {
    setEvalLoading(true);
    setEvalError(null);
    setEvalResult(null);
    try {
      const res = await API.post('/api/tb/evaluate', {});
      const evaluation = res.data?.evaluation;
      if (evaluation) {
        setEvalResult(evaluation);
      } else {
        setEvalError('Evaluation returned no results.');
      }
    } catch (err) {
      const data = err.response?.data;
      setEvalError(data?.details || data?.error || err.message);
    } finally {
      setEvalLoading(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    setStartYear('2024');
    setEndYear('2025');
    setSelectedBarangay('');
    setForecastMonths(3);
    setAppliedStartYear(null);
    setAppliedEndYear(null);
    setAppliedBarangay(null);
    setAppliedMonths(null);
    setViewStatus('idle');
    setViewErrorMessage(null);
    setViewSuccessInfo(null);
  }, []);

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
      const yr = new Date(r.month).getFullYear();
      return yr >= Number(appliedStartYear) && yr <= Number(appliedEndYear);
    });
  }, [monthlyData, appliedStartYear, appliedEndYear, appliedBarangay]);

  /** Aggregate monthly data into time-series for chart */
  const aggregatedMonthly = useMemo(() => {
    const byMonth = {};
    filteredMonthly.forEach((r) => {
      const key = r.month;
      if (!byMonth[key]) byMonth[key] = 0;
      byMonth[key] += Number(r.case_count || 0);
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => {
        const d = new Date(month);
        return {
          month,
          label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          cases: count,
        };
      });
  }, [filteredMonthly]);

  /** Total historical cases in the selected period */
  const historicalCases = useMemo(
    () => aggregatedMonthly.reduce((sum, r) => sum + r.cases, 0),
    [aggregatedMonthly]
  );

  /** Filter forecasts by barangay and aggregate by period */
  const filteredForecasts = useMemo(() => {
    if (!appliedBarangay && !appliedMonths) return [];
    let data = forecastsData;
    if (appliedBarangay) {
      data = data.filter((r) => (r.barangay_name || '') === appliedBarangay);
    }

    // Aggregate by period. forecasted_count/CI are only summed from rows
    // that actually have a value — a barangay with insufficient history has
    // forecasted_count = null (see arima_forecast.py), and treating that as
    // 0 would misrepresent "not modeled" as "predicted zero cases".
    const byPeriod = {};
    data.forEach((r) => {
      const period = r.period || r.forecast_period || '';
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
    if (appliedMonths) result = result.slice(0, appliedMonths);
    return result;
  }, [forecastsData, appliedBarangay, appliedMonths]);

  // Resolves the transient 'checking' state (set right after a successful
  // fetch) into 'success' or 'no_data' once historicalCases/filteredForecasts
  // have recomputed against the freshly-fetched data and just-applied
  // filters — these are memoized from state set in the same action, so they
  // aren't readable synchronously inside the handler that set that state.
  useEffect(() => {
    if (viewStatus !== 'checking') return;
    const hasData = historicalCases > 0 || filteredForecasts.length > 0;
    setViewStatus(hasData ? 'success' : 'no_data');
  }, [viewStatus, historicalCases, filteredForecasts]);

  /** Comparison forecasts for barangay comparison */
  const comparisonForecasts = useMemo(() => {
    if (!showCompare || !compareBarangay || !appliedMonths) return [];
    let data = forecastsData.filter((r) => (r.barangay_name || '') === compareBarangay);
    const byPeriod = {};
    data.forEach((r) => {
      const period = r.period || r.forecast_period || '';
      if (!period) return;
      if (!byPeriod[period]) {
        byPeriod[period] = { period, forecasted: 0, count: 0 };
      }
      byPeriod[period].forecasted += Number(r.forecasted_count || 0);
      byPeriod[period].count += 1;
    });
    let result = Object.values(byPeriod).sort((a, b) => a.period.localeCompare(b.period));
    if (appliedMonths) result = result.slice(0, appliedMonths);
    return result;
  }, [showCompare, compareBarangay, forecastsData, appliedMonths]);

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

  /** Metric card computations */
  const totalForecasted = useMemo(
    () => filteredForecasts.reduce((s, r) => {
      const d = new Date(r.period);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const hasCases = casesData.some((c) => {
        if (!c.date_of_diagnosis) return false;
        const dt = new Date(c.date_of_diagnosis);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` === key;
      });
      if (hasCases) return s;
      return s + r.forecasted;
    }, 0),
    [filteredForecasts, casesData]
  );

  const growthRate = useMemo(() => {
    if (historicalCases === 0 || totalForecasted === 0) return 0;
    const monthlyAvg = historicalCases / (new Set(filteredMonthly.map(r => r.month)).size || 1);
    const firstForecast = filteredForecasts.length > 0 ? filteredForecasts[0].forecasted : 0;
    const baseline = monthlyAvg || 1;
    return ((firstForecast - baseline) / baseline) * 100;
  }, [historicalCases, totalForecasted, filteredForecasts, filteredMonthly]);

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
    const points = [];
    // Build actual case counts by period
    const actualByPeriod = {};
    casesData.forEach((r) => {
      const d = r.date_of_diagnosis;
      if (!d) return;
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return;
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      if (!actualByPeriod[key]) actualByPeriod[key] = 0;
      actualByPeriod[key] += 1;
    });
    const allActualPeriods = Object.keys(actualByPeriod).sort();
    const latestActual = allActualPeriods.length > 0 ? allActualPeriods[allActualPeriods.length - 1] : null;

    // Add historical actual data
    aggregatedMonthly.forEach((r) => {
      points.push({
        label: r.label,
        month: r.month,
        Actual: r.cases,
        Forecast: null,
        ci_upper: null,
        ci_lower: null,
        isForecast: false,
      });
    });

    // Add forecast data (only for future periods, not historical)
    filteredForecasts.forEach((r) => {
      const d = new Date(r.period);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const isFuture = !latestActual || key > latestActual;
      const hasValue = isFuture && r.hasForecast;
      const comparePoint = comparisonForecasts.find((c) => {
        const cd = new Date(c.period);
        return `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, '0')}` === key;
      });
      points.push({
        label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        month: r.period,
        Actual: null,
        // No point is drawn at all for an insufficient-history period — a
        // fabricated zero would misrepresent "not modeled" as a prediction.
        Forecast: hasValue ? Math.round(r.forecasted) : null,
        CompareForecast: hasValue && comparePoint ? Math.round(comparePoint.forecasted) : null,
        ci_upper: hasValue && r.hasCI ? r.ci_upper : null,
        ci_lower: hasValue && r.hasCI ? r.ci_lower : null,
        isForecast: hasValue,
      });
    });
    return points;
  }, [aggregatedMonthly, filteredForecasts, comparisonForecasts, casesData]);

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

    let lastForecasted = null;

    return filteredForecasts.map((r, i) => {
      const pDate = new Date(r.period);
      const periodKey = isNaN(pDate.getTime()) ? r.period : `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}`;

      // Determine if this is a historical or forecast period
      const hasActual = actualByPeriod[periodKey] != null;
      const isHistorical = hasActual && periodKey <= latestActualPeriod;

      const actual = isHistorical ? actualByPeriod[periodKey] : null;
      const isInsufficient = !isHistorical && r.method === 'insufficient_data';
      const forecasted = !isHistorical && r.hasForecast ? Math.round(Number(r.forecasted)) : null;
      const ci_lower = !isHistorical && r.hasCI ? Math.round(Number(r.ci_lower)) : null;
      const ci_upper = !isHistorical && r.hasCI ? Math.round(Number(r.ci_upper)) : null;

      // Growth: first forecast compares to last actual, subsequent compare to previous forecast
      let gr = null;
      if (!isHistorical && forecasted != null) {
        const baseline = lastForecasted != null ? lastForecasted : lastActualCount;
        if (baseline > 0) {
          gr = (((forecasted - baseline) / baseline) * 100).toFixed(1);
        }
        lastForecasted = forecasted;
      }

      return {
        period: r.period,
        periodLabel: new Date(r.period).toLocaleDateString('en-US', {
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
    const forecastRows = sortedForecastTable.filter((r) => !r.isHistorical && r.forecasted != null && r.ci_lower > 0 && r.ci_upper > 0);
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
      { key: 'periodLabel', label: 'PERIOD' },
      { key: 'actual', label: 'ACTUAL' },
      { key: 'forecasted', label: 'FORECAST' },
      { key: 'confidence', label: 'CONFIDENCE RANGE (95% CI)' },
      { key: 'growthRate', label: 'GROWTH' },
      { key: 'method', label: 'MODEL' },
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
  const basisStart = monthLabel(runMetrics.dataStart);
  const basisEnd = monthLabel(runMetrics.dataEnd);
  const forecastStart = monthLabel(pipelineStatus?.config?.period);
  const usedFallback = (runMetrics.forecastMethods || []).some(m => String(m).includes('fallback') || String(m).includes('baseline'));
  const runMethods = (runMetrics.forecastMethods || []).map(String);
  const forecastMethodLabel = runMethods.length === 0 ? null
    : runMethods.every(m => m === 'arima') ? 'ARIMA'
      : runMethods.includes('arima') ? 'ARIMA for most barangays, a simpler baseline where history is short'
        : 'a simple baseline (not ARIMA) — too little history or the ML service was unavailable';

  return (
    <div className="space-y-6">

      {basisStart && basisEnd && (
        <div className="rounded-xl px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E3A5F' }}>
          <span><i className="ri-database-2-line mr-1" />Based on monthly TB data from <b>{basisStart}</b> to <b>{basisEnd}</b>{pipelineStatus?.training_months ? ` (${pipelineStatus.training_months} months)` : ''}</span>
          {forecastStart && <span><i className="ri-calendar-event-line mr-1" />Forecast starts <b>{forecastStart}</b> — the month after the latest data</span>}
          {usedFallback && <span style={{ color: '#92400E' }}><i className="ri-error-warning-line mr-1" />Some barangays use a simpler fallback forecast (too little history or the ML service was unavailable)</span>}
        </div>
      )}

      {/* ─── Header + Forecast Settings ─── */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)' }}>
        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-3.5" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div className="shrink-0">
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>TB Forecasting</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Generate tuberculosis case forecasts using historical TB records to support monitoring and planning across Pasig City.</p>
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
            {isAdmin && (
              <button
                type="button"
                onClick={handleRunEvaluation}
                disabled={evalLoading || isBusy}
                title="Walk-forward evaluation of ARIMA + Random Forest (admin)"
                className="px-5 py-2 text-xs font-semibold disabled:opacity-60"
                style={{ background: '#ffffff', color: '#0F2D52', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#EFF6FF'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#ffffff'; }}
              >
                {evalLoading
                  ? <><i className="ri-loader-4-line text-xs animate-spin mr-1" /> Evaluating...</>
                  : <><i className="ri-flask-line mr-1" />Evaluate Model</>}
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
              {ALL_YEARS.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
            </FilterSelect>
            <FilterSelect label="End" value={endYear} onChange={setEndYear}>
              {ALL_YEARS.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
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
      </div>

      {/* ─── Run Analysis Pipeline result (admin) ─── */}
      {isAdmin && pipelineRunStatus !== 'idle' && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)' }}>
          <div className="px-6 py-3.5" style={{ borderBottom: '1px solid #DBEAFE' }}>
            <h2 className="text-sm font-extrabold" style={{ color: '#0F2D52' }}>Run Analysis Pipeline</h2>
          </div>
          <div className="px-6 py-4">
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

      {/* ─── Model Evaluation (admin) ─── */}
      {isAdmin && (evalLoading || evalError || evalResult) && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)' }}>
          <div className="flex items-center justify-between px-6 py-3.5" style={{ borderBottom: '1px solid #DBEAFE' }}>
            <div>
              <h2 className="text-sm font-extrabold" style={{ color: '#0F2D52' }}>Model Evaluation</h2>
              <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>
                Walk-forward validation of the ARIMA and Random Forest models — metrics computed by the ML service, not in the browser.
              </p>
            </div>
            {evalResult?.model_version && (
              <span className="text-[11px] font-medium shrink-0" style={{ color: '#94A3B8' }}>{evalResult.model_version}</span>
            )}
          </div>

          <div className="px-6 py-4">
            {evalLoading ? (
              <div className="flex items-center gap-2 text-xs font-medium" style={{ color: '#64748B' }}>
                <i className="ri-loader-4-line animate-spin" />
                Running walk-forward evaluation — one model is trained per step, this may take a few minutes...
              </div>
            ) : evalError ? (
              <div className="rounded-lg px-4 py-3" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
                <p className="text-xs font-bold" style={{ color: '#B91C1C' }}>
                  <i className="ri-error-warning-line mr-1" />
                  Model evaluation could not be completed.
                </p>
                <p className="text-[11px] mt-1 font-mono break-words" style={{ color: '#991B1B' }}>{evalError}</p>
                <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: '#7F1D1D' }}>
                  No metrics are shown because the intended models could not be evaluated. Fallback models are never
                  reported here as ARIMA/RF results — make sure the ML service is running (port 8001), then run again.
                </p>
              </div>
            ) : evalResult ? (
              <>
                <EvaluationResults evaluation={evalResult} />
                <p className="text-[11px] mt-3" style={{ color: '#94A3B8' }}>
                  Source: POST /api/tb/evaluate (walk-forward: trains on months 1..T, predicts T+1, slides forward).
                  Results are also stored in model_metadata for provenance.
                </p>
              </>
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
        <div className="flex flex-col items-center justify-center py-24 gap-4" style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: '#F1F5F9' }}
          >
            <i className="ri-line-chart-line text-3xl" style={{ color: '#CBD5E1' }} />
          </div>
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
        <div className="flex flex-col items-center justify-center py-24 gap-4" style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: '#FEF2F2' }}
          >
            <i className="ri-error-warning-line text-3xl" style={{ color: '#EF4444' }} />
          </div>
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
        <div className="flex flex-col items-center justify-center py-24 gap-4" style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: '#F1F5F9' }}
          >
            <i className="ri-inbox-line text-3xl" style={{ color: '#CBD5E1' }} />
          </div>
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
        <div className="flex gap-6">
          {/* ─── LEFT COLUMN: KPI Cards + Charts (scrollable) ─── */}
          <div className="flex-1 min-w-0 space-y-6">

          {/* ─── 3. METRIC CARDS ─── */}
          <div className="rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15,45,82,0.12), 0 2px 8px rgba(15,45,82,0.08)' }}>
            <div className="grid grid-cols-2 lg:grid-cols-4">
              {/* Historical Cases */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-database-2-line text-sm" style={{ color: '#6B7FA3' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Historical Cases</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{historicalCases.toLocaleString()}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{appliedStartYear}\u2013{appliedEndYear} period</span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Forecasted Cases */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-line-chart-line text-sm" style={{ color: '#6B9E9E' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Forecasted Cases</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{totalForecasted.toLocaleString()}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{appliedMonths}-month horizon</span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Expected Growth Rate */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-percent-line text-sm" style={{ color: growthRate >= 0 ? '#B07070' : '#6B9E8A' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Expected Growth Rate</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <div className="flex items-end gap-2">
                  <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                    {growthRate >= 0 ? '+' : '\u2212'}{Math.abs(growthRate).toFixed(1)}%
                  </p>
                </div>
                <span className="text-[11px] font-medium mt-1" style={{ color: growthRate >= 0 ? '#B07070' : '#6B9E8A' }}>
                  {growthRate >= 0 ? 'Rising' : 'Falling'} vs baseline
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
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Model Status</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold" style={{ color: '#64748B' }}>Random Forest</span>
                    <span className="text-[11px] font-extrabold" style={{ color: MODEL_STATUS_COLORS[pipelineStatus?.rf_status] || '#94A3B8' }}>
                      {formatModelStatus(pipelineStatus?.rf_status)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-semibold shrink-0" style={{ color: '#64748B' }}>Forecasting</span>
                    <span className="text-[11px] font-extrabold text-right" style={{ color: formatForecastingStatus(forecastTier).color }}>
                      {formatForecastingStatus(forecastTier).label}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ─── 4. MAIN FORECAST GRAPH ─── */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="w-1 h-8 rounded-full" style={{ background: '#0D9488' }} />
                <div>
                  <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>Historical vs Forecasted TB Cases</h3>
                  <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>Comparison of historical tuberculosis cases and projected cases for the selected forecast period.</p>
                  {forecastTier === 'insufficient_data' && (
                    <p className="text-[10px] mt-0.5 font-medium" style={{ color: '#B91C1C' }}>
                      Insufficient Historical Data — no forecast is shown for the selected scope.
                    </p>
                  )}
                  {isBaselineTier && (
                    <p className="text-[10px] mt-0.5 font-medium" style={{ color: '#D97706' }}>
                      Baseline Forecast (not ARIMA) — fewer than 24 months of history for the selected scope.
                    </p>
                  )}
                </div>
              </div>
              {/* Inline legend */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-6 h-[3px] rounded-full" style={{ background: '#0F2D52' }} />
                  <span className="text-[11px] font-medium" style={{ color: '#64748B' }}>Actual</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-4 h-0 border-t-2" style={{ borderColor: '#0D9488', borderStyle: 'dashed' }} />
                  <span className="text-[11px] font-medium" style={{ color: '#64748B' }}>Forecast</span>
                </div>
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
                <div className="w-full" style={{ height: 360 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={forecastChartData} margin={{ top: 20, right: 25, left: 5, bottom: 0 }}>
                      <defs>
                        <linearGradient id="ciGradForecast" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0D9488" stopOpacity={0.12} />
                          <stop offset="100%" stopColor="#0D9488" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E8ECF1" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10, fill: '#94A3B8' }}
                        axisLine={{ stroke: '#E2E8F0' }}
                        tickLine={false}
                        tickMargin={8}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#94A3B8' }}
                        axisLine={{ stroke: '#E2E8F0' }}
                        tickLine={false}
                        tickMargin={4}
                        width={40}
                      />
                      <Tooltip content={<ForecastTooltip />} />

                      {/* Confidence band */}
                      <Area
                        type="monotone"
                        dataKey="ci_upper"
                        stroke="none"
                        fill="url(#ciGradForecast)"
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
                        strokeWidth={2.5}
                        dot={{ fill: '#0F2D52', r: 3, strokeWidth: 0 }}
                        activeDot={{ r: 5, strokeWidth: 2, stroke: '#ffffff' }}
                        connectNulls={false}
                        name="Actual Cases"
                      />

                      {/* Forecasted Cases line */}
                      <Line
                        type="monotone"
                        dataKey="Forecast"
                        stroke="#0D9488"
                        strokeWidth={2.5}
                        strokeDasharray="8 4"
                        dot={{ fill: '#0D9488', r: 4, strokeWidth: 2, stroke: '#ffffff' }}
                        activeDot={{ r: 6, strokeWidth: 2, stroke: '#ffffff' }}
                        connectNulls={false}
                        name="Forecasted Cases"
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
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <i className="ri-line-chart-line text-2xl" style={{ color: '#CBD5E1' }} />
                  <p className="text-xs" style={{ color: '#94A3B8' }}>No forecast chart data available.</p>
                </div>
              )}
              <ChartInsight text={forecastInsight(forecastChartData, { methodLabel: forecastMethodLabel })} />
            </div>
          </div>

          {/* ─── 5. ACTUAL VS PREDICTED GRAPH ─── */}
            <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-1 h-8 rounded-full" style={{ background: '#2563EB' }} />
                  <div>
                    <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>Actual vs Predicted Cases</h3>
                    <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>Comparison of observed TB cases and model-predicted values across historical periods.</p>
                    {!pipelineStatus && (
                      <p className="text-[10px] mt-0.5 font-medium" style={{ color: '#D97706' }}>
                        Using seasonal naive baseline — run pipeline for ML predictions.
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="w-6 h-[3px] rounded-full" style={{ background: '#2563EB' }} />
                    <span className="text-[11px] font-medium" style={{ color: '#64748B' }}>Actual</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-6 h-[3px] rounded-full" style={{ background: '#14B8A6' }} />
                    <span className="text-[11px] font-medium" style={{ color: '#64748B' }}>Predicted</span>
                  </div>
                </div>
              </div>
              <div className="px-5 pb-5">
                {avpChartData.length > 0 ? (
                  <div className="w-full" style={{ height: 340 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={avpChartData} margin={{ top: 20, right: 25, left: 5, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E8ECF1" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10, fill: '#94A3B8' }}
                          axisLine={{ stroke: '#E2E8F0' }}
                          tickLine={false}
                          tickMargin={8}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: '#94A3B8' }}
                          axisLine={{ stroke: '#E2E8F0' }}
                          tickLine={false}
                          tickMargin={4}
                          width={40}
                        />
                        <Tooltip content={<ForecastTooltip />} />
                        <Line
                          type="monotone"
                          dataKey="Actual"
                          stroke="#2563EB"
                          strokeWidth={2.5}
                          dot={{ fill: '#2563EB', r: 3, strokeWidth: 0 }}
                          activeDot={{ r: 5, strokeWidth: 2, stroke: '#ffffff' }}
                          name="Actual Cases"
                        />
                        <Line
                          type="monotone"
                          dataKey="Predicted"
                          stroke="#14B8A6"
                          strokeWidth={2.5}
                          dot={{ fill: '#14B8A6', r: 3, strokeWidth: 0 }}
                          activeDot={{ r: 5, strokeWidth: 2, stroke: '#ffffff' }}
                          name="Predicted Cases"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <i className="ri-scales-line text-2xl" style={{ color: '#CBD5E1' }} />
                    <p className="text-xs" style={{ color: '#94A3B8' }}>No comparison data available.</p>
                  </div>
                )}
                <ChartInsight text={accuracyInsight(avpChartData)} />
              </div>
            </div>

            {/* ─── 6. FORECAST DETAILS TABLE ─── */}
            <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
              <div className="px-5 py-4">
                <div className="flex items-center gap-2">
                   <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#6B7280' }}>Data</span>
                  <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>Forecast Details</h3>
                </div>
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
                        const modelLabel = row.isInsufficient ? 'Insufficient Data' : row.isBaseline ? 'Baseline Forecast' : row.method === 'arima' ? 'ARIMA' : null;
                        const modelColor = row.isInsufficient
                          ? MODEL_STATUS_COLORS.insufficient_data
                          : row.isBaseline
                            ? MODEL_STATUS_COLORS.degraded
                            : MODEL_STATUS_COLORS.success;

                        // Historical periods: show actual only. Forecast periods: show forecast + CI only.
                        const hasCI = row.ci_lower > 0 && row.ci_upper > 0;
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
                            <td className="px-5 py-4 text-xs font-bold" style={{ color: '#1E293B' }}>
                              {row.periodLabel}
                              {row.isHistorical && (
                                <span className="ml-2 text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded" style={{ background: '#E2E8F0', color: '#64748B' }}>Actual</span>
                              )}
                            </td>
                            <td className="px-5 py-4 text-xs font-medium" style={{ color: '#1E293B' }}>
                              {row.actual != null ? row.actual.toLocaleString() : '\u2014'}
                            </td>
                            <td className="px-5 py-4 text-xs font-medium" style={{ color: row.isInsufficient ? '#B91C1C' : '#1E293B' }}>
                              {row.isInsufficient
                                ? 'Insufficient Historical Data'
                                : !row.isHistorical && row.forecasted != null ? row.forecasted.toLocaleString() : '\u2014'}
                            </td>
                            <td className="px-5 py-4">
                              {showCI ? (
                                <div className="flex items-center gap-3 min-w-[160px]">
                                  <span className="text-[11px] font-medium tabular-nums" style={{ color: '#94A3B8', minWidth: 28 }}>
                                    {row.ci_lower.toLocaleString()}
                                  </span>
                                  <div className="relative flex-1 h-2 rounded-full" style={{ background: '#E2E8F0' }}
                                    title={`Forecast: ${row.forecasted.toLocaleString()} | CI: ${row.ci_lower.toLocaleString()} – ${row.ci_upper.toLocaleString()}`}
                                  >
                                    <div
                                      className="absolute top-0 h-full rounded-full"
                                      style={{
                                         background: '#C4B5C0',
                                        left: `${barLeft}%`,
                                        width: `${Math.max(2, barWidth)}%`,
                                      }}
                                    />
                                    <div
                                      className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white"
                                       style={{ background: '#6B7280', left: `${forecastPos}%`, transform: 'translate(-50%, -50%)' }}
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
                            <td className="px-5 py-4 text-xs font-bold" style={{ color: gr != null ? (gr >= 0 ? '#EF4444' : '#10B981') : '#94A3B8' }}>
                              {!row.isHistorical && gr != null ? `${gr >= 0 ? '+' : ''}${gr.toFixed(1)}%` : '\u2014'}
                            </td>
                            <td className="px-5 py-4">
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
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <i className="ri-file-list-3-line text-xl" style={{ color: '#CBD5E1' }} />
                  <p className="text-xs" style={{ color: '#94A3B8' }}>No forecast detail data available.</p>
                </div>
              )}
            </div>
          </div>
          </div>

          {/* ─── RIGHT COLUMN: Sticky NLG Insight Panel ─── */}
          <div className="w-[420px] shrink-0 hidden lg:block">
            <div className="sticky top-4">
              <AiInsightPanel
                type="forecasting"
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
    </div>
  );
}
