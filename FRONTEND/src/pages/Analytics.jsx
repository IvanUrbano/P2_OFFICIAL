import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ComposedChart, Bar, Line, Area, CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import API from '../api/axios';
import { useTheme } from '../theme';

/* ─── Constants ──────────────────────────────────────────────────────── */

const COLORS = {
  blue: '#2E6FAF',
  cyan: '#4FD1C5',
  red: '#EF4444',
  green: '#10B981',
  purple: '#7c3aed',
  amber: '#F59E0B',
  gray: '#94A3B8',
  darkBlue: '#0066FF',
};

const RISK_COLORS = {
  Low: COLORS.green,
  Medium: COLORS.amber,
  High: COLORS.red,
};

/* ─── Helper Components ──────────────────────────────────────────────── */

function MetricItem({ title, value, icon, color, trend, isLast }) {
  const { t } = useTheme();
  return (
    <div className="p-4 flex flex-col justify-center relative">
      {!isLast && (
        <div
          className="absolute right-0 top-1/2 -translate-y-1/2 w-[2px] h-20"
          style={{ background: 'rgba(0,0,0,0.4)' }}
        />
      )}
      <div className="flex items-center gap-2 mb-2">
        <i className={`${icon} text-lg`} style={{ color }} />
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: t.textSecondary }}>
          {title}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <div className="text-2xl font-bold" style={{ color: t.text }}>{value}</div>
        <div className="text-xs font-semibold" style={{ color }}>{trend}</div>
      </div>
    </div>
  );
}

function VizCard({ title, icon, iconColor, children, headerAction }) {
  const { t } = useTheme();
  return (
    <div className="glass-card flex flex-col p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm font-bold" style={{ color: t.text }}>
          <i className={icon} style={{ color: iconColor || COLORS.blue }} />
          <span>{title}</span>
        </div>
        {headerAction && <div>{headerAction}</div>}
      </div>
      {children}
    </div>
  );
}

function ReportCard({ title, value, subtitle, icon, color }) {
  const { t } = useTheme();
  return (
    <div
      className="glass-card p-4 flex flex-col gap-2"
      style={{ borderLeft: `3px solid ${color || COLORS.blue}` }}
    >
      <div className="flex items-center gap-2">
        <i className={`${icon} text-base`} style={{ color: color || COLORS.blue }} />
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: t.textSecondary }}>
          {title}
        </span>
      </div>
      <div className="text-xl font-bold" style={{ color: t.text }}>{value}</div>
      {subtitle && (
        <div className="text-xs" style={{ color: t.textMuted }}>{subtitle}</div>
      )}
    </div>
  );
}

function RiskBadge({ risk }) {
  const bg = RISK_COLORS[risk] || COLORS.gray;
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: bg }}
    >
      {risk}
    </span>
  );
}

function AvsPTooltip({ active, payload, label }) {
  const { t } = useTheme();
  if (!active || !payload || !payload.length) return null;

  const actual = payload.find((p) => p.dataKey === 'Actual');
  const predicted = payload.find((p) => p.dataKey === 'Predicted');
  const ciEntry = payload.find((p) => p.dataKey === 'ci_upper' || p.dataKey === 'ci_lower');

  return (
    <div
      className="px-3 py-2.5 rounded-lg text-xs font-medium shadow-lg"
      style={{
        background: t.cardSolid,
        border: `1px solid ${t.borderStrong}`,
        color: t.text,
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      }}
    >
      <div className="font-bold mb-1" style={{ color: t.text }}>{label}</div>
      {actual && (
        <div className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.blue }} />
          <span style={{ color: t.textSecondary }}>Actual:</span>
          <span className="font-semibold">{actual.value}</span>
        </div>
      )}
      {predicted && (
        <div className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.red }} />
          <span style={{ color: t.textSecondary }}>Predicted:</span>
          <span className="font-semibold">{predicted.value}</span>
        </div>
      )}
      {ciEntry && actual?.payload?.ci_lower != null && actual?.payload?.ci_upper != null && (
        <div className="flex items-center gap-2 mt-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(46,111,175,0.15)' }} />
          <span style={{ color: t.textSecondary }}>CI:</span>
          <span className="font-semibold">
            {actual.payload.ci_lower} – {actual.payload.ci_upper}
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── Main Analytics Component ───────────────────────────────────────── */

export default function Analytics() {
  const { t } = useTheme();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  /* ── Data state ── */
  const [monthlyData, setMonthlyData] = useState([]);
  const [forecastsData, setForecastsData] = useState([]);
  const [actualVsPredicted, setActualVsPredicted] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [outcomesData, setOutcomesData] = useState([]);

  /* ── Control state ── */
  const [selectedBarangays, setSelectedBarangays] = useState([]);
  const [forecastMonths, setForecastMonths] = useState(12);
  const [customMonths, setCustomMonths] = useState('');
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [pipelineResult, setPipelineResult] = useState(null);
  const [showBarangayDropdown, setShowBarangayDropdown] = useState(false);

  /* ── Table sorting ── */
  const [sortKey, setSortKey] = useState('barangay_name');
  const [sortDir, setSortDir] = useState('asc');

  /* ── Data fetching ── */
  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [monthlyRes, forecastsRes, avpRes, barangaysRes, outcomesRes] = await Promise.all([
        API.get('/api/tb/dashboard/monthly'),
        API.get('/api/tb/forecasts'),
        API.get('/api/tb/forecast/actual-vs-predicted'),
        API.get('/api/tb/barangays'),
        API.get('/api/tb/dashboard/outcomes'),
      ]);
      setMonthlyData(monthlyRes.data.monthly || []);
      setForecastsData(forecastsRes.data.forecasts || []);
      setActualVsPredicted(avpRes.data.data || []);
      setBarangays(barangaysRes.data.barangays || barangaysRes.data || []);
      setOutcomesData(outcomesRes.data.outcomes || []);
    } catch (err) {
      console.error('Analytics fetch error:', err);
      setError('Failed to load analytics data. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /* ── Run forecast pipeline ── */
  const handleRunForecast = useCallback(async () => {
    try {
      setRunningPipeline(true);
      setPipelineResult(null);
      const body = {
        forecastHorizon: forecastMonths,
        barangays: selectedBarangays.length > 0 ? selectedBarangays : undefined,
      };
      const res = await API.post('/api/tb/pipeline', body);
      setPipelineResult({ success: true, message: res.data.message || 'Pipeline completed successfully.' });
      await loadAll();
    } catch (err) {
      console.error('Pipeline error:', err);
      setPipelineResult({
        success: false,
        message: err.response?.data?.error || err.message || 'Pipeline failed.',
      });
    } finally {
      setRunningPipeline(false);
    }
  }, [forecastMonths, selectedBarangays, loadAll]);

  /* ── Barangay dropdown helpers ── */
  const barangayNames = useMemo(() => {
    return barangays.map((b) => b.barangay_name || b.name).filter(Boolean);
  }, [barangays]);

  const toggleBarangay = useCallback((name) => {
    setSelectedBarangays((prev) =>
      prev.includes(name) ? prev.filter((b) => b !== name) : [...prev, name]
    );
  }, []);

  const selectAllBarangays = useCallback(() => {
    setSelectedBarangays([...barangayNames]);
  }, [barangayNames]);

  const clearBarangays = useCallback(() => {
    setSelectedBarangays([]);
  }, []);

  /* ── Computed values ── */
  const totalCases = useMemo(() => {
    return outcomesData.reduce((sum, r) => sum + Number(r.total || 0), 0);
  }, [outcomesData]);

  const successRate = useMemo(() => {
    if (!outcomesData.length) return '0%';
    const cured = outcomesData
      .filter((r) => r.outcome_status === 'CURED')
      .reduce((s, r) => s + Number(r.total || 0), 0);
    const completed = outcomesData
      .filter((r) => r.outcome_status === 'TREATMENT COMPLETED')
      .reduce((s, r) => s + Number(r.total || 0), 0);
    if (totalCases === 0) return '0%';
    return `${Math.round(((cured + completed) / totalCases) * 100)}%`;
  }, [outcomesData, totalCases]);

  const peakMonth = useMemo(() => {
    if (!monthlyData.length) return { label: 'N/A', cases: 0 };
    const byMonth = {};
    monthlyData.forEach((r) => {
      byMonth[r.month] = (byMonth[r.month] || 0) + Number(r.case_count || 0);
    });
    const entries = Object.entries(byMonth).sort(([, a], [, b]) => b - a);
    const [month, cases] = entries[0] || ['N/A', 0];
    const d = new Date(month);
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    return { label, cases };
  }, [monthlyData]);

  const highRiskCount = useMemo(() => {
    return barangays.filter((b) => Number(b.total_cases || 0) > 200).length;
  }, [barangays]);

  /* ── Chart data: aggregate actual-vs-predicted by period ── */
  const chartData = useMemo(() => {
    if (!actualVsPredicted.length) return [];

    const filtered = selectedBarangays.length > 0
      ? actualVsPredicted.filter((r) => selectedBarangays.includes(r.barangay_name))
      : actualVsPredicted;

    const byPeriod = {};
    filtered.forEach((r) => {
      const period = r.period || r.forecast_period || '';
      if (!byPeriod[period]) {
        byPeriod[period] = { actual: 0, predicted: 0, ci_lower: 0, ci_upper: 0, count: 0 };
      }
      byPeriod[period].actual += Number(r.actual || r.actual_cases || 0);
      byPeriod[period].predicted += Number(r.predicted || r.predicted_count || 0);
      byPeriod[period].ci_lower += Number(r.ci_lower || 0);
      byPeriod[period].ci_upper += Number(r.ci_upper || 0);
      byPeriod[period].count += 1;
    });

    return Object.entries(byPeriod)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, data]) => {
        const d = new Date(period);
        const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        return {
          label,
          period,
          Actual: data.actual,
          Predicted: Math.round(data.predicted),
          ci_lower: data.ci_lower,
          ci_upper: data.ci_upper,
        };
      });
  }, [actualVsPredicted, selectedBarangays]);

  /* ── Forecast report: latest period summary ── */
  const forecastReport = useMemo(() => {
    if (!forecastsData.length) {
      return {
        totalForecast: 0,
        projectedIncrease: 0,
        avgCIWidth: 0,
        avgMAE: 0,
        highRiskBarangays: 0,
        periodLabel: 'N/A',
        barangaysCount: 0,
      };
    }

    const periods = [...new Set(forecastsData.map((r) => r.forecast_period || r.period))];
    const latestPeriod = periods.sort().pop();
    const latestRows = forecastsData.filter(
      (r) => (r.forecast_period || r.period) === latestPeriod
    );

    const totalForecast = latestRows.reduce(
      (s, r) => s + Number(r.predicted_count || r.predicted || 0), 0
    );
    const totalActual = latestRows.reduce(
      (s, r) => s + Number(r.actual || r.actual_count || 0), 0
    );
    const projectedIncrease = totalActual > 0
      ? Math.round(((totalForecast - totalActual) / totalActual) * 100)
      : 0;

    const avgCIWidth = latestRows.length > 0
      ? Math.round(
          latestRows.reduce((s, r) => {
            const upper = Number(r.ci_upper || 0);
            const lower = Number(r.ci_lower || 0);
            return s + (upper - lower);
          }, 0) / latestRows.length
        )
      : 0;

    const avgMAE = latestRows.length > 0
      ? Math.round(
          latestRows.reduce((s, r) => {
            const actual = Number(r.actual || r.actual_count || 0);
            const predicted = Number(r.predicted_count || r.predicted || 0);
            return s + Math.abs(actual - predicted);
          }, 0) / latestRows.length
        )
      : 0;

    const highRiskBarangays = latestRows.filter(
      (r) => r.risk_class === 'High'
    ).length;

    const d = new Date(latestPeriod);
    const periodLabel = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    return {
      totalForecast,
      projectedIncrease,
      avgCIWidth,
      avgMAE,
      highRiskBarangays,
      periodLabel,
      barangaysCount: latestRows.length,
    };
  }, [forecastsData]);

  /* ── Forecast table: latest period rows ── */
  const forecastTable = useMemo(() => {
    if (!forecastsData.length) return [];

    const periods = [...new Set(forecastsData.map((r) => r.forecast_period || r.period))];
    const latestPeriod = periods.sort().pop();
    const latestRows = forecastsData.filter(
      (r) => (r.forecast_period || r.period) === latestPeriod
    );

    return latestRows.map((r) => {
      const actual = Number(r.actual || r.actual_count || 0);
      const predicted = Number(r.predicted_count || r.predicted || 0);
      const population = Number(r.population || 0);
      const incidence = population > 0 ? ((predicted / population) * 100000).toFixed(1) : '0.0';
      return {
        barangay_name: r.barangay_name || 'Unknown',
        actual,
        predicted,
        difference: predicted - actual,
        ci_lower: Number(r.ci_lower || 0),
        ci_upper: Number(r.ci_upper || 0),
        risk_class: r.risk_class || 'Low',
        incidence,
      };
    });
  }, [forecastsData]);

  const sortedForecastTable = useMemo(() => {
    const sorted = [...forecastTable];
    sorted.sort((a, b) => {
      let valA = a[sortKey];
      let valB = b[sortKey];
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [forecastTable, sortKey, sortDir]);

  const handleSort = useCallback((key) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return key;
      }
      setSortDir('asc');
      return key;
    });
  }, []);

  const renderSortIcon = useCallback((key) => {
    if (sortKey !== key) return <i className="ri-arrow-up-down-line text-xs ml-1 opacity-40" />;
    return sortDir === 'asc'
      ? <i className="ri-arrow-up-line text-xs ml-1" />
      : <i className="ri-arrow-down-line text-xs ml-1" />;
  }, [sortKey, sortDir]);
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <i className="ri-error-warning-line text-4xl" style={{ color: COLORS.red }} />
        <span className="text-sm font-medium" style={{ color: t.textSecondary }}>{error}</span>
        <button
          onClick={loadAll}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
          style={{ background: COLORS.blue }}
        >
          Retry
        </button>
      </div>
    );
  }

  /* ── Main JSX ── */
  return (
    <div className="space-y-6 p-1">

      {/* ─── Section 1: Forecast Controls ─── */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <i className="ri-dashboard-3-line text-lg" style={{ color: COLORS.blue }} />
          <span className="text-sm font-bold" style={{ color: t.text }}>Forecast Controls</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

          {/* Barangay multi-select */}
          <div className="relative">
            <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: t.textSecondary }}>
              Barangays
            </label>
            <button
              type="button"
              onClick={() => setShowBarangayDropdown((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-left"
              style={{
                background: t.inputBg,
                border: `1px solid ${t.inputBorder}`,
                color: t.text,
              }}
            >
              <span>
                {selectedBarangays.length === 0
                  ? 'All Barangays'
                  : `${selectedBarangays.length} selected`}
              </span>
              <i className={`ri-arrow-${showBarangayDropdown ? 'up' : 'down'}-s-line`} style={{ color: t.textMuted }} />
            </button>
            {showBarangayDropdown && (
              <div
                className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto rounded-lg shadow-lg"
                style={{
                  background: t.cardSolid,
                  border: `1px solid ${t.borderStrong}`,
                }}
              >
                <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: t.border }}>
                  <button
                    type="button"
                    onClick={selectAllBarangays}
                    className="text-xs font-semibold hover:underline"
                    style={{ color: COLORS.blue }}
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={clearBarangays}
                    className="text-xs font-semibold hover:underline"
                    style={{ color: COLORS.red }}
                  >
                    Clear
                  </button>
                </div>
                {barangayNames.map((name) => (
                  <label
                    key={name}
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-opacity-50 text-sm"
                    style={{
                      color: t.text,
                      background: 'transparent',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = t.tableStripe; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={selectedBarangays.includes(name)}
                      onChange={() => toggleBarangay(name)}
                    />
                    <span>{name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Forecast months */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: t.textSecondary }}>
              Forecast Horizon
            </label>
            <div className="flex items-center gap-2">
              {[3, 6, 12].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setForecastMonths(m); setCustomMonths(''); }}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors"
                  style={{
                    background: forecastMonths === m && customMonths === '' ? COLORS.blue : t.inputBg,
                    color: forecastMonths === m && customMonths === '' ? '#ffffff' : t.text,
                    border: `1px solid ${forecastMonths === m && customMonths === '' ? COLORS.blue : t.inputBorder}`,
                  }}
                >
                  {m}m
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={24}
                placeholder="1–24"
                value={customMonths}
                onChange={(e) => setCustomMonths(e.target.value)}
                className="w-20 px-2 py-2 rounded-lg text-sm text-center"
                style={{
                  background: t.inputBg,
                  border: `1px solid ${t.inputBorder}`,
                  color: t.text,
                }}
              />
            </div>
          </div>

          {/* Run button + pipeline result */}
          <div className="flex flex-col justify-end gap-2">
            <button
              type="button"
              onClick={handleRunForecast}
              disabled={runningPipeline}
              className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-60"
              style={{ background: COLORS.blue }}
            >
              {runningPipeline ? (
                <>
                  <div
                    className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
                  />
                  Running Pipeline...
                </>
              ) : (
                <>
                  <i className="ri-play-circle-line" />
                  Run Forecast
                </>
              )}
            </button>
            {pipelineResult && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
                style={{
                  background: pipelineResult.success ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                  color: pipelineResult.success ? COLORS.green : COLORS.red,
                  border: `1px solid ${pipelineResult.success ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                }}
              >
                <i className={pipelineResult.success ? 'ri-check-line' : 'ri-close-circle-line'} />
                {pipelineResult.message}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Section 2: Summary Metrics ─── */}
      <div
        className="glass-card grid grid-cols-2 lg:grid-cols-4 divide-x"
        style={{ borderColor: t.border }}
      >
        <MetricItem
          title="Total TB Cases"
          value={totalCases.toLocaleString()}
          icon="ri-virus-line"
          color={COLORS.blue}
          trend={`${barangays.length} barangays`}
          isLast={false}
        />
        <MetricItem
          title="Peak Month"
          value={peakMonth.label}
          icon="ri-calendar-event-line"
          color={COLORS.red}
          trend={`${peakMonth.cases} cases`}
          isLast={false}
        />
        <MetricItem
          title="Success Rate"
          value={successRate}
          icon="ri-heart-pulse-line"
          color={COLORS.green}
          trend="Cured + Completed"
          isLast={false}
        />
        <MetricItem
          title="High-Risk Areas"
          value={highRiskCount}
          icon="ri-alarm-warning-line"
          color={COLORS.amber}
          trend=">200 cases"
          isLast
        />
      </div>

      {/* ─── Section 3: Actual vs Predicted Chart ─── */}
      <VizCard
        title="Actual vs Predicted Cases"
        icon="ri-line-chart-line"
        iconColor={COLORS.blue}
      >
        {chartData.length > 0 ? (
          <div className="w-full" style={{ height: 380 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="ciBand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.blue} stopOpacity={0.12} />
                    <stop offset="100%" stopColor={COLORS.blue} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={t.chartGrid} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: t.textMuted }}
                  axisLine={{ stroke: t.chartGrid }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: t.textMuted }}
                  axisLine={{ stroke: t.chartGrid }}
                  tickLine={false}
                />
                <Tooltip content={<AvsPTooltip />} />
                <Area
                  type="monotone"
                  dataKey="ci_upper"
                  stroke="none"
                  fill="url(#ciBand)"
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="ci_lower"
                  stroke="none"
                  fill={t.cardSolid}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="Actual"
                  fill={COLORS.blue}
                  radius={[3, 3, 0, 0]}
                  barSize={28}
                  opacity={0.85}
                />
                <Line
                  type="monotone"
                  dataKey="Predicted"
                  stroke={COLORS.red}
                  strokeWidth={2.5}
                  strokeDasharray="5 5"
                  dot={{ fill: COLORS.red, r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  formatter={(value) => {
                    const colors = { Actual: COLORS.blue, Predicted: COLORS.red };
                    return (
                      <span style={{ color: colors[value] || t.text, fontSize: 12, fontWeight: 600 }}>
                        {value}
                      </span>
                    );
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <i className="ri-bar-chart-grouped-line text-3xl" style={{ color: t.textMuted }} />
            <span className="text-sm" style={{ color: t.textMuted }}>
              No forecast data available. Run the pipeline to generate predictions.
            </span>
          </div>
        )}
      </VizCard>

      {/* ─── Section 4: Forecast Report Cards ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ReportCard
          title="Total Forecast"
          value={forecastReport.totalForecast.toLocaleString()}
          subtitle={`Across ${forecastReport.barangaysCount} barangays`}
          icon="ri-chart-line"
          color={COLORS.blue}
        />
        <ReportCard
          title="Projected Increase"
          value={`${forecastReport.projectedIncrease > 0 ? '+' : ''}${forecastReport.projectedIncrease}%`}
          subtitle="vs historical average"
          icon="ri-arrow-up-circle-line"
          color={forecastReport.projectedIncrease > 0 ? COLORS.red : COLORS.green}
        />
        <ReportCard
          title="Avg Confidence Interval"
          value={forecastReport.avgCIWidth.toLocaleString()}
          subtitle="Average CI width"
          icon="ri-git-branch-line"
          color={COLORS.cyan}
        />
        <ReportCard
          title="Model Accuracy"
          value={forecastReport.avgMAE.toLocaleString()}
          subtitle="Mean Absolute Error"
          icon="ri-bullseye-line"
          color={COLORS.green}
        />
        <ReportCard
          title="High-Risk Barangays"
          value={forecastReport.highRiskBarangays}
          subtitle="Classified as High risk"
          icon="ri-alarm-warning-line"
          color={COLORS.red}
        />
        <ReportCard
          title="Forecast Period"
          value={forecastReport.periodLabel}
          subtitle={`${forecastReport.barangaysCount} barangay forecasts`}
          icon="ri-calendar-line"
          color={COLORS.purple}
        />
      </div>

      {/* ─── Section 5: Forecast Table ─── */}
      <VizCard
        title="Barangay Forecast Details"
        icon="ri-table-line"
        iconColor={COLORS.blue}
      >
        {sortedForecastTable.length > 0 ? (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm" style={{ minWidth: 800 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.borderStrong}` }}>
                  {[
                    { key: 'barangay_name', label: 'Barangay' },
                    { key: 'actual', label: 'Actual' },
                    { key: 'predicted', label: 'Predicted' },
                    { key: 'difference', label: 'Difference' },
                    { key: 'ci_lower', label: 'CI Lower' },
                    { key: 'ci_upper', label: 'CI Upper' },
                    { key: 'risk_class', label: 'Risk' },
                    { key: 'incidence', label: 'Incidence/100k' },
                  ].map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none"
                      style={{ color: t.textSecondary }}
                    >
                      <span className="inline-flex items-center">
                        {col.label}
                        {renderSortIcon(col.key)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedForecastTable.map((row, i) => (
                  <tr
                    key={`${row.barangay_name}-${i}`}
                    style={{
                      borderBottom: `1px solid ${t.border}`,
                      background: i % 2 === 0 ? 'transparent' : t.tableStripe,
                    }}
                  >
                    <td className="px-4 py-3 font-medium" style={{ color: t.text }}>
                      {row.barangay_name}
                    </td>
                    <td className="px-4 py-3" style={{ color: t.text }}>{row.actual}</td>
                    <td className="px-4 py-3" style={{ color: t.text }}>{row.predicted}</td>
                    <td className="px-4 py-3 font-semibold" style={{ color: row.difference >= 0 ? COLORS.green : COLORS.red }}>
                      {row.difference >= 0 ? '+' : ''}{row.difference}
                    </td>
                    <td className="px-4 py-3" style={{ color: t.textMuted }}>{row.ci_lower}</td>
                    <td className="px-4 py-3" style={{ color: t.textMuted }}>{row.ci_upper}</td>
                    <td className="px-4 py-3">
                      <RiskBadge risk={row.risk_class} />
                    </td>
                    <td className="px-4 py-3" style={{ color: t.text }}>{row.incidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <i className="ri-file-list-3-line text-3xl" style={{ color: t.textMuted }} />
            <span className="text-sm" style={{ color: t.textMuted }}>
              No forecast data available for the table. Run the pipeline to generate predictions.
            </span>
          </div>
        )}
      </VizCard>
    </div>
  );
}
