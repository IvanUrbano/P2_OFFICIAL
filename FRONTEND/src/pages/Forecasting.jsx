import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChart, Line, Area, CartesianGrid, XAxis, YAxis,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import API from '../api/axios';
import { useTheme } from '../theme';

/* ─── Constants ──────────────────────────────────────────────────────── */

const ALL_YEARS = ['2023', '2024', '2025', '2026'];

const HORIZON_OPTIONS = [
  { value: 1, label: '1 Month' },
  { value: 3, label: '3 Months' },
  { value: 6, label: '6 Months' },
  { value: 12, label: '12 Months' },
];

const RISK_COLORS = {
  Low: '#10B981',
  Moderate: '#F59E0B',
  High: '#EF4444',
  'Very High': '#DC2626',
};

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

function RiskBadge({ risk }) {
  const bg = RISK_COLORS[risk] || '#94A3B8';
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold text-white"
      style={{ backgroundColor: bg }}
    >
      {risk}
    </span>
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

/* ─── Main Forecasting Component ─────────────────────────────────────── */

export default function Forecasting() {
  const { t } = useTheme();

  /* ── Data state ── */
  const [monthlyData, setMonthlyData] = useState([]);
  const [forecastsData, setForecastsData] = useState([]);
  const [avpData, setAvpData] = useState([]);
  const [backtestData, setBacktestData] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [casesData, setCasesData] = useState([]);
  const [pipelineStatus, setPipelineStatus] = useState(null);

  /* ── Control state (user selections before clicking Run) ── */
  const [startYear, setStartYear] = useState('2024');
  const [endYear, setEndYear] = useState('2025');
  const [selectedBarangay, setSelectedBarangay] = useState('');
  const [forecastMonths, setForecastMonths] = useState(3);

  /* ── Applied state (updated only on Run Forecast) ── */
  const [appliedStartYear, setAppliedStartYear] = useState(null);
  const [appliedEndYear, setAppliedEndYear] = useState(null);
  const [appliedBarangay, setAppliedBarangay] = useState(null);
  const [appliedMonths, setAppliedMonths] = useState(null);

  /* ── UI state ── */
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterLoading, setFilterLoading] = useState(false);
  const [forecastRan, setForecastRan] = useState(false);

  /* ── Table sorting ── */
  const [sortKey, setSortKey] = useState('period');
  const [sortDir, setSortDir] = useState('asc');

  /* ────────── Data fetching ────────── */

  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [monthlyRes, forecastsRes, avpRes, barangaysRes, casesRes, pipelineRes, backtestRes] =
        await Promise.all([
          API.get('/api/tb/dashboard/monthly'),
          API.get('/api/tb/forecasts'),
          API.get('/api/tb/forecast/actual-vs-predicted'),
          API.get('/api/tb/barangays'),
          API.get('/api/tb/cases?limit=9999'),
          API.get('/api/tb/pipeline/status').catch(() => ({ data: { latest_run: null } })),
          API.get('/api/tb/forecast/backtest').catch(() => ({ data: { data: [] } })),
        ]);
      setMonthlyData(monthlyRes.data.monthly || []);
      setForecastsData(forecastsRes.data.forecasts || []);
      setAvpData(avpRes.data.data || []);
      setBarangays(barangaysRes.data.barangays || []);
      setCasesData(casesRes.data.cases || []);
      setPipelineStatus(pipelineRes.data.latest_run || null);
      setBacktestData(backtestRes.data.data || []);
    } catch (err) {
      console.error('Forecasting fetch error:', err);
      setError('Failed to load analytics data. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /* ────────── Run Forecast ────────── */

  const handleRunForecast = useCallback(async () => {
    setFilterLoading(true);
    setForecastRan(true);

    // Validate start <= end
    if (Number(startYear) > Number(endYear)) {
      setFilterLoading(false);
      return;
    }

    try {
      // Run the ARIMA pipeline
      await API.post('/api/tb/pipeline', {
        forecastHorizon: forecastMonths,
        barangays: selectedBarangay ? [selectedBarangay] : undefined,
      });

      // Re-fetch fresh data
      const [freshForecasts, freshAvp, freshPipeline] = await Promise.all([
        API.get('/api/tb/forecasts'),
        API.get('/api/tb/forecast/actual-vs-predicted'),
        API.get('/api/tb/pipeline/status').catch(() => ({ data: { latest_run: null } })),
      ]);
      setForecastsData(freshForecasts.data.forecasts || []);
      setAvpData(freshAvp.data.data || []);
      setPipelineStatus(freshPipeline.data.latest_run || null);
    } catch (err) {
      console.error('Pipeline error:', err.response?.data?.error || err.message);
    } finally {
      // Apply filters
      setAppliedStartYear(startYear);
      setAppliedEndYear(endYear);
      setAppliedBarangay(selectedBarangay);
      setAppliedMonths(forecastMonths);
      setFilterLoading(false);
    }
  }, [startYear, endYear, selectedBarangay, forecastMonths]);

  const handleReset = useCallback(() => {
    setStartYear('2024');
    setEndYear('2025');
    setSelectedBarangay('');
    setForecastMonths(3);
    setAppliedStartYear(null);
    setAppliedEndYear(null);
    setAppliedBarangay(null);
    setAppliedMonths(null);
    setForecastRan(false);
  }, []);

  /* ────────── Derived data (all behind forecastRan + applied filters) ────────── */

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

    // Aggregate by period
    const byPeriod = {};
    data.forEach((r) => {
      const period = r.period || r.forecast_period || '';
      if (!period) return;
      if (!byPeriod[period]) {
        byPeriod[period] = {
          period,
          forecasted: 0,
          actual: 0,
          ci_lower: 0,
          ci_upper: 0,
          count: 0,
          risk_class: r.risk_class || 'Low',
        };
      }
      byPeriod[period].forecasted += Number(r.forecasted_count || 0);
      byPeriod[period].actual += Number(r.actual_count || 0);
      byPeriod[period].ci_lower += Number(r.confidence_lower || 0);
      byPeriod[period].ci_upper += Number(r.confidence_upper || 0);
      byPeriod[period].count += 1;
      // Keep highest risk
      const riskOrder = { Low: 0, Moderate: 1, High: 2, 'Very High': 3 };
      const curr = riskOrder[byPeriod[period].risk_class] || 0;
      const next = riskOrder[r.risk_class] || 0;
      if (next > curr) byPeriod[period].risk_class = r.risk_class;
    });

    let result = Object.values(byPeriod).sort((a, b) => a.period.localeCompare(b.period));
    // Limit to horizon
    if (appliedMonths) result = result.slice(0, appliedMonths);
    return result;
  }, [forecastsData, appliedBarangay, appliedMonths]);

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
    () => filteredForecasts.reduce((s, r) => s + r.forecasted, 0),
    [filteredForecasts]
  );

  const growthRate = useMemo(() => {
    if (historicalCases === 0 || totalForecasted === 0) return 0;
    return ((totalForecasted - historicalCases) / historicalCases) * 100;
  }, [historicalCases, totalForecasted]);

  const riskLevel = useMemo(() => {
    if (totalForecasted > 500) return 'Very High';
    const pct = Math.abs(growthRate);
    if (pct > 20) return 'High';
    if (pct > 10) return 'Moderate';
    return 'Low';
  }, [totalForecasted, growthRate]);

  /** Chart data: historical + forecast combined */
  const forecastChartData = useMemo(() => {
    const points = [];
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
    filteredForecasts.forEach((r) => {
      const d = new Date(r.period);
      points.push({
        label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        month: r.period,
        Actual: null,
        Forecast: Math.round(r.forecasted),
        ci_upper: r.ci_upper,
        ci_lower: r.ci_lower,
        isForecast: true,
      });
    });
    return points;
  }, [aggregatedMonthly, filteredForecasts]);

  /** First forecast label for the ReferenceLine */
  const forecastStartLabel = useMemo(() => {
    const first = forecastChartData.find((r) => r.isForecast);
    return first ? first.label : null;
  }, [forecastChartData]);

  /** Table rows for forecast details */
  const forecastTableRows = useMemo(() => {
    // Compute average monthly total (total cases / distinct months)
    const distinctMonths = new Set(filteredMonthly.map((r) => r.month)).size || 1;
    const avgMonthlyTotal = historicalCases / distinctMonths;

    return filteredForecasts.map((r, i) => {
      const actual = r.actual > 0 ? r.actual : null;
      const forecasted = Math.round(r.forecasted);
      // Compute growth: compare to previous forecast period, or to avg monthly total
      let gr = null;
      if (i > 0) {
        const prevForecasted = Math.round(filteredForecasts[i - 1].forecasted);
        if (prevForecasted > 0) {
          gr = (((forecasted - prevForecasted) / prevForecasted) * 100).toFixed(1);
        }
      } else if (avgMonthlyTotal > 0) {
        gr = (((forecasted - avgMonthlyTotal) / avgMonthlyTotal) * 100).toFixed(1);
      }
      return {
        period: r.period,
        periodLabel: new Date(r.period).toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        }),
        actual,
        forecasted,
        ci_lower: Math.round(r.ci_lower),
        ci_upper: Math.round(r.ci_upper),
        growthRate: gr,
        risk_class: r.risk_class,
      };
    });
  }, [filteredForecasts, historicalCases, filteredMonthly]);

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

  /** Forecast summary text */
  const forecastSummaryParts = useMemo(() => {
    if (!filteredForecasts.length) return null;
    const barangayLabel = appliedBarangay || 'all 30 Pasig City barangays';
    const rate = Number(growthRate);
    const trendWord = rate > 0 ? 'increase' : rate < 0 ? 'decrease' : 'no significant change';

    // Find peak period
    const peak = filteredForecasts.reduce(
      (max, r) => (r.forecasted > max.forecasted ? r : max),
      filteredForecasts[0]
    );
    const peakLabel = new Date(peak.period).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });

    const riskColor = RISK_COLORS[riskLevel] || '#94A3B8';

    return {
      paragraphs: [
        'Based on the selected historical period, TB cases are projected to ',
        trendWord,
        ` during the forecast period for ${barangayLabel}. The highest projected caseload is expected in `,
        peakLabel,
        `, with an expected growth rate of `,
        `${rate >= 0 ? '+' : ''}${Math.abs(rate).toFixed(1)}%`,
        ' — a ',
        riskLevel.toLowerCase(),
        ' risk classification.',
      ],
      trendWord,
      peakLabel,
      growthRateValue: `${rate >= 0 ? '+' : ''}${Math.abs(rate).toFixed(1)}%`,
      riskLevel,
      riskColor,
    };
  }, [filteredForecasts, growthRate, riskLevel, appliedBarangay]);

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
      { key: 'risk_class', label: 'RISK' },
    ],
    []
  );

  /* ────────── Render ────────── */

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: '#FEE2E2' }}
        >
          <i className="ri-error-warning-line text-3xl" style={{ color: '#EF4444' }} />
        </div>
        <span className="text-sm font-medium" style={{ color: '#64748B' }}>{error}</span>
        <button
          onClick={loadAll}
          className="px-5 py-2.5 rounded-lg text-sm font-bold text-white transition hover:opacity-90"
          style={{ background: '#0F2D52' }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">

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
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all hover:shadow-md"
              style={{ background: '#EFF6FF', color: '#0F2D52', border: '1px solid #DBEAFE' }}
            >
              <i className="ri-refresh-line text-sm" />
              Reset
            </button>
            <button
              type="button"
              onClick={handleRunForecast}
              disabled={filterLoading}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold text-white transition-all hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
              style={{ background: '#0F2D52' }}
            >
              {filterLoading ? <i className="ri-loader-4-line text-sm animate-spin" /> : <i className="ri-play-fill text-sm" />}
              Run Forecast
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center justify-between px-6 py-3" style={{ background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Start Year */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none" style={{ color: '#94A3B8' }}>Start:</span>
              <select
                value={startYear}
                onChange={(e) => setStartYear(e.target.value)}
                className="rounded-lg pl-[42px] pr-7 py-[7px] text-[11px] font-semibold outline-none transition cursor-pointer appearance-none"
                style={{ background: '#ffffff', color: '#0F2D52', border: '1px solid #E2E8F0' }}
              >
                {ALL_YEARS.map((yr) => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
              <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style={{ color: '#64748B' }} />
            </div>

            {/* End Year */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none" style={{ color: '#94A3B8' }}>End:</span>
              <select
                value={endYear}
                onChange={(e) => setEndYear(e.target.value)}
                className="rounded-lg pl-[38px] pr-7 py-[7px] text-[11px] font-semibold outline-none transition cursor-pointer appearance-none"
                style={{ background: '#ffffff', color: '#0F2D52', border: '1px solid #E2E8F0' }}
              >
                {ALL_YEARS.map((yr) => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
              <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style={{ color: '#64748B' }} />
            </div>

            {/* Barangay */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none" style={{ color: '#94A3B8' }}>Barangay:</span>
              <select
                value={selectedBarangay}
                onChange={(e) => setSelectedBarangay(e.target.value)}
                className="rounded-lg pl-[74px] pr-7 py-[7px] text-[11px] font-semibold outline-none transition cursor-pointer appearance-none"
                style={{ background: '#ffffff', color: '#0F2D52', border: '1px solid #E2E8F0' }}
              >
                <option value="">All Pasig Barangays</option>
                {barangayNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style={{ color: '#64748B' }} />
            </div>

            {/* Forecast Horizon */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none" style={{ color: '#94A3B8' }}>Horizon:</span>
              <select
                value={forecastMonths}
                onChange={(e) => setForecastMonths(Number(e.target.value))}
                className="rounded-lg pl-[62px] pr-7 py-[7px] text-[11px] font-semibold outline-none transition cursor-pointer appearance-none"
                style={{ background: '#ffffff', color: '#0F2D52', border: '1px solid #E2E8F0' }}
              >
                {HORIZON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style={{ color: '#64748B' }} />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Content States ─── */}
      {!forecastRan ? (
        /* ─── 9. EMPTY STATE ─── */
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center"
            style={{ background: '#F1F5F9' }}
          >
            <i className="ri-line-chart-box-line text-4xl" style={{ color: '#CBD5E1' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold" style={{ color: '#475569' }}>
              No Forecast Generated
            </p>
            <p className="text-xs mt-1 max-w-sm" style={{ color: '#94A3B8' }}>
              Select a historical period, barangay, and forecast horizon, then click Run
              Forecast to generate projections.
            </p>
          </div>
        </div>
      ) : filterLoading ? (
        /* ─── 10. LOADING STATE ─── */
        <SectionSkeleton rows={4} />
      ) : historicalCases === 0 && filteredForecasts.length === 0 ? (
        /* ─── 11. ERROR / INSUFFICIENT DATA STATE ─── */
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center"
            style={{ background: '#FEE2E2' }}
          >
            <i className="ri-error-warning-line text-4xl" style={{ color: '#EF4444' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold" style={{ color: '#475569' }}>
              Unable to Generate Forecast
            </p>
            <p className="text-xs mt-1 max-w-sm" style={{ color: '#94A3B8' }}>
              Insufficient historical data for the selected parameters. Please adjust the
              settings and try again.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* ─── 3. METRIC CARDS ─── */}
          <div className="rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15,45,82,0.12), 0 2px 8px rgba(15,45,82,0.08)' }}>
            <div className="grid grid-cols-2 lg:grid-cols-4">
              {/* Historical Cases */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-database-2-line text-base" style={{ color: '#3B82F6' }} />
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
                  <i className="ri-line-chart-line text-base" style={{ color: '#0D9488' }} />
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
                  <i className={`${growthRate >= 0 ? 'ri-arrow-up-s-fill' : 'ri-arrow-down-s-fill'} text-base`} style={{ color: growthRate >= 0 ? '#EF4444' : '#10B981' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Expected Growth Rate</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <div className="flex items-end gap-2">
                  <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                    {growthRate >= 0 ? '+' : '\u2212'}{Math.abs(growthRate).toFixed(1)}%
                  </p>
                </div>
                <span className="text-[11px] font-medium mt-1" style={{ color: growthRate >= 0 ? '#EF4444' : '#10B981' }}>
                  {growthRate >= 0 ? '↑ Rising' : '↓ Falling'} vs baseline
                </span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Risk Classification */}
              <div className="flex flex-col px-5 py-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <i className="ri-shield-line text-base" style={{ color: RISK_COLORS[riskLevel] }} />
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Risk Classification</span>
                  </div>
                  <RiskBadge risk={riskLevel} />
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{riskLevel}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>Based on forecast analysis</span>
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
                        axisLine={{ stroke: t.chartGrid }}
                        tickLine={false}
                        tickMargin={8}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#94A3B8' }}
                        axisLine={{ stroke: t.chartGrid }}
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

                      {/* Forecast start marker */}
                      {forecastStartLabel && (
                        <ReferenceLine
                          x={forecastStartLabel}
                          stroke="#D97706"
                          strokeWidth={1.5}
                          strokeDasharray="6 4"
                          label={{
                            value: 'Forecast Start',
                            position: 'top',
                            fill: '#D97706',
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
                        axisLine={{ stroke: t.chartGrid }}
                        tickLine={false}
                        tickMargin={8}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#94A3B8' }}
                        axisLine={{ stroke: t.chartGrid }}
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
            </div>
          </div>

          {/* ─── 6. FORECAST DETAILS TABLE ─── */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
            <div className="px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#7C3AED' }}>Data</span>
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
                        const range = row.ci_upper - row.ci_lower;
                        const forecastPos = range > 0 ? ((row.forecasted - row.ci_lower) / range) * 100 : 50;
                        const riskColor = RISK_COLORS[row.risk_class] || '#94A3B8';
                        return (
                          <tr
                            key={`${row.period}-${i}`}
                            style={{
                              borderBottom: '1px solid #F1F5F9',
                              background: i % 2 === 0 ? '#ffffff' : '#FAFBFC',
                            }}
                            className="hover:bg-blue-50/40 transition-colors"
                          >
                            <td className="px-5 py-4 text-xs font-bold" style={{ color: '#1E293B' }}>
                              {row.periodLabel}
                            </td>
                            <td className="px-5 py-4 text-xs font-medium" style={{ color: '#1E293B' }}>
                              {row.actual != null ? row.actual.toLocaleString() : '\u2014'}
                            </td>
                            <td className="px-5 py-4 text-xs font-medium" style={{ color: '#1E293B' }}>
                              {row.forecasted.toLocaleString()}
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3 min-w-[160px]">
                                <span className="text-[11px] font-medium tabular-nums" style={{ color: '#94A3B8', minWidth: 28 }}>
                                  {row.ci_lower.toLocaleString()}
                                </span>
                                <div className="relative flex-1 h-2 rounded-full" style={{ background: '#E2E8F0' }}>
                                  <div
                                    className="absolute top-0 h-full rounded-full"
                                    style={{
                                      background: '#C4B5FD',
                                      left: '0%',
                                      width: `${Math.max(2, Math.min(100, forecastPos))}%`,
                                    }}
                                  />
                                  <div
                                    className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white"
                                    style={{ background: '#7C3AED', left: `${Math.max(0, Math.min(100, forecastPos))}%`, transform: 'translate(-50%, -50%)' }}
                                  />
                                </div>
                                <span className="text-[11px] font-medium tabular-nums" style={{ color: '#94A3B8', minWidth: 28 }}>
                                  {row.ci_upper.toLocaleString()}
                                </span>
                              </div>
                            </td>
                            <td className="px-5 py-4 text-xs font-bold" style={{ color: gr != null ? (gr >= 0 ? '#EF4444' : '#10B981') : '#94A3B8' }}>
                              {gr != null ? `${gr >= 0 ? '+' : ''}${gr.toFixed(1)}%` : '0%'}
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: riskColor }} />
                                <span className="text-xs font-semibold" style={{ color: '#1E293B' }}>{row.risk_class}</span>
                              </div>
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

          {/* ─── 7. FORECAST SUMMARY ─── */}
          {forecastSummaryParts && (
            <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
              <div className="px-5 py-4">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#EF4444' }}>Auto-Generated</span>
                  <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>Forecast Summary</h3>
                </div>
              </div>
              <div className="px-5 pb-5">
                <p className="text-sm leading-relaxed" style={{ color: '#475569' }}>
                  {forecastSummaryParts.paragraphs.map((part, i) => {
                    if (part === forecastSummaryParts.trendWord || part === forecastSummaryParts.peakLabel || part === forecastSummaryParts.growthRateValue) {
                      return <strong key={i} style={{ color: '#1E293B' }}>{part}</strong>;
                    }
                    if (part === `${forecastSummaryParts.riskLevel.toLowerCase()} risk classification.`) {
                      return <strong key={i} style={{ color: forecastSummaryParts.riskColor }}>{part}</strong>;
                    }
                    return <span key={i}>{part}</span>;
                  })}
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
                    style={{ background: '#F1F5F9', color: '#64748B' }}
                  >
                    {appliedMonths}-month forecast
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: forecastSummaryParts.riskColor }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: forecastSummaryParts.riskColor }} />
                    {forecastSummaryParts.riskLevel} risk
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
