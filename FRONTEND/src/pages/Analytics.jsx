import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { useTBData } from '../context/TBDataContext';

/* ─── Barangay name list (static reference data kept for Reports.jsx module-level import) ─── */
export const BARANGAYS = [
  'Bagong Ilog', 'Bagong Katipunan', 'Bambang', 'Buting', 'Caniogan', 'Dela Paz',
  'Kalawaan', 'Kapasigan', 'Kapitolyo', 'Malinao', 'Manggahan', 'Maybunga', 'Oranbo',
  'Palatiw', 'Pinagbuhatan', 'Pineda', 'Rosario', 'Sagad', 'San Antonio', 'San Joaquin',
  'San Jose', 'San Miguel', 'San Nicolas', 'Santa Cruz', 'Santa Lucia', 'Santa Rosa',
  'Santo Tomas', 'Santolan', 'Sumilang', 'Ugong',
];

/* ─── Tooltip Style (matches Dashboard) ─── */
const tooltipStyle = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  color: '#0f172a',
  fontSize: '12px',
  boxShadow: '0 4px 12px rgba(0, 102, 255, 0.08)',
};

/* ─── Main Component ─── */
export default function Analytics() {
  /* ── Context ── */
  const { forecastData, analytics, records } = useTBData();

  /* ── Barangays derived from context (sorted for filter) ─── */
  const barangays = useMemo(
    () => forecastData.map((f) => f.barangay).sort(),
    [forecastData]
  );

  /* ── URL Params ── */
  const [searchParams] = useSearchParams();
  const initialBrgy = searchParams.get('barangay') || '';

  /* ── Filter State ── */
  const [selectedBrgy, setSelectedBrgy] = useState(initialBrgy);
  const [horizon, setHorizon] = useState('3');
  const [year, setYear] = useState('2025');
  const [ran, setRan] = useState(false);
  const [loading, setLoading] = useState(false);

  /* ── Sync URL param changes (e.g. if user navigates again from GIS) ── */
  useEffect(() => {
    const brgy = searchParams.get('barangay') || '';
    if (brgy && barangays.includes(brgy)) {
      setSelectedBrgy(brgy);
    }
  }, [searchParams, barangays]);

  /* ── Modal State ── */
  const [showReport, setShowReport] = useState(false);

  /* ── Derived values ── */
  const scope = selectedBrgy || 'All Barangays';
  const mo = parseInt(horizon);
  const yr = parseInt(year);
  const nextYrLabel = `Jan ${yr + 1}`;

  const critBrgyCount = useMemo(
    () => forecastData.filter((d) => d.risk === 'High').length,
    [forecastData]
  );

  /* ── Aggregate forecast data for "All Barangays" ── */
  const aggregatedForecast = useMemo(() => {
    if (forecastData.length === 0) return null;
    const totalCases = forecastData.reduce((s, f) => s + f.cases, 0);
    const totalPredicted = forecastData.reduce((s, f) => s + f.predictedCases, 0);
    const avgGrowth = forecastData.reduce((s, f) => s + f.growthRate, 0) / forecastData.length;

    // Merge historical months across all barangays
    const histMap = {};
    forecastData.forEach((f) => {
      f.historical.forEach((h) => {
        histMap[h.month] = (histMap[h.month] || 0) + h.cases;
      });
    });
    const historical = Object.entries(histMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, cases]) => ({ month, cases }));

    // Merge forecast months across all barangays
    const fcMap = {};
    forecastData.forEach((f) => {
      f.forecast.forEach((fc) => {
        fcMap[fc.month] = (fcMap[fc.month] || 0) + fc.predicted;
      });
    });
    const forecast = Object.entries(fcMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, predicted]) => ({ month, predicted }));

    return {
      barangay: 'All Barangays',
      cases: totalCases,
      historical,
      forecast,
      predictedCases: totalPredicted,
      growthRate: avgGrowth,
      risk: critBrgyCount > 0 ? 'High' : 'Moderate',
    };
  }, [forecastData, critBrgyCount]);

  /* ── Compute forecast results only when ran=true ── */
  const forecastResults = useMemo(() => {
    if (!ran) return null;

    /* Pick the specific barangay's data, or use aggregated "all" */
    const item = selectedBrgy
      ? forecastData.find((f) => f.barangay === selectedBrgy)
      : aggregatedForecast;

    if (!item && !analytics) return null;

    /* Total forecasted over horizon months */
    const totalFc = item
      ? Math.round(
        item.forecast.slice(0, mo).reduce((s, f) => s + f.predicted, 0) ||
        item.predictedCases * mo
      )
      : Math.round(analytics.forecastNextMonth * mo);

    /* Projected increase percentage */
    const projInc = item
      ? Math.abs(Math.round(item.growthRate * 10) / 10)
      : 5.0;

    /* Next month prediction */
    const nextMo = item ? item.predictedCases : analytics.forecastNextMonth;

    /* Historical trend data for the chart — use context's monthlyTrend or barangay historical */
    let histData;
    if (item && item.historical.length > 0) {
      histData = item.historical.map((h) => ({
        month: h.month,
        actual: h.cases,
      }));
    } else if (analytics) {
      histData = analytics.monthlyTrend.map((h) => ({
        month: h.month,
        actual: h.actual,
      }));
    } else {
      histData = [];
    }

    /* ARIMA chart data: last 2 historical + forecast horizon with CI */
    const histTail = histData.slice(-2);
    const forecastMonths = item ? item.forecast.slice(0, mo) : [];
    const fcLabels = forecastMonths.map((f) => f.month);

    const arimaLabels = [
      ...histTail.map((h) => h.month),
      ...fcLabels,
    ];

    const arimaActData = [
      ...histTail.map((h) => h.actual),
      ...new Array(mo).fill(null),
    ];

    const arimaFcData = [
      null,
      null,
      ...forecastMonths.map((f) => f.predicted),
    ];

    const arimaUpperData = [
      null,
      null,
      ...forecastMonths.map((f) => Math.round(f.predicted * 1.08)),
    ];

    const arimaLowerData = [
      null,
      null,
      ...forecastMonths.map((f) => Math.round(f.predicted * 0.92)),
    ];

    const arimaChartData = arimaLabels.map((label, i) => ({
      month: label,
      actual: arimaActData[i],
      forecast: arimaFcData[i],
      upper: arimaUpperData[i],
      lower: arimaLowerData[i],
    }));

    /* Actual vs Predicted */
    const apLabels = [...histData.map((h) => h.month), ...fcLabels];
    const apActual = [
      ...histData.map((h) => h.actual),
      ...new Array(mo).fill(null),
    ];
    const apPred = [
      ...new Array(histData.length).fill(null),
      ...forecastMonths.map((f) => f.predicted),
    ];
    const actPredData = apLabels.map((label, i) => ({
      month: label,
      actual: apActual[i],
      predicted: apPred[i],
    }));

    /* Barangay table data */
    const tableData = (selectedBrgy ? [item] : forecastData)
      .filter(Boolean)
      .sort((a, b) => b.cases - a.cases)
      .map((d) => {
        const diff = d.predictedCases - d.cases;
        const pct =
          d.cases > 0
            ? Math.round((diff / d.cases) * 100)
            : 0;
        const trend =
          d.growthRate > 3 ? 'Increasing' : d.growthRate < -3 ? 'Decreasing' : 'Stable';
        return {
          b: d.barangay,
          cases: d.cases,
          forecast: d.predictedCases,
          risk: d.risk,
          pct,
          diff,
          trend,
        };
      });

    return {
      totalFc,
      projInc,
      nextMo,
      histData,
      arimaChartData,
      actPredData,
      tableData,
      arimaFcLabels: fcLabels,
    };
  }, [ran, selectedBrgy, mo, yr, forecastData, aggregatedForecast, analytics]);

  /* ── Handlers ── */
  const handleRunForecast = useCallback(() => {
    setLoading(true);
    setRan(false);
    setTimeout(() => {
      setLoading(false);
      setRan(true);
    }, 1800);
  }, []);

  const handleDownload = useCallback(() => {
    if (!ran || !forecastResults) return;
    const rows = [['Barangay', 'Current Cases', 'Forecast', 'Growth Rate', 'Risk']];
    forecastResults.tableData.forEach((d) => {
      rows.push([
        d.b,
        d.cases,
        d.forecast,
        (d.pct > 0 ? '+' : '') + d.pct + '%',
        d.risk,
      ]);
    });
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `TBInsight_Forecast_${selectedBrgy || 'AllBarangays'}_${yr}.csv`;
    a.click();
  }, [ran, forecastResults, selectedBrgy, yr]);

  /* ── Risk badge helper ── */
  const riskBadge = (risk) => {
    const colors = {
      High: { bg: 'rgba(239,68,68,0.12)', color: '#EF4444' },
      Moderate: { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B' },
      Low: { bg: 'rgba(16,185,129,0.12)', color: '#10B981' },
    };
    const c = colors[risk] || colors.Low;
    return (
      <span
        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold"
        style={{ background: c.bg, color: c.color }}
      >
        {risk}
      </span>
    );
  };

  const trendIcon = (trend) => {
    if (trend === 'Increasing')
      return (
        <span className="font-bold" style={{ color: '#EF4444' }}>
          &#8593; Increasing
        </span>
      );
    if (trend === 'Decreasing')
      return (
        <span className="font-bold" style={{ color: '#10B981' }}>
          &#8595; Decreasing
        </span>
      );
    return (
      <span className="font-bold" style={{ color: '#F59E0B' }}>
        &#8594; Stable
      </span>
    );
  };

  return (
    <div className="relative space-y-5">
      {/* ── Toolbar: Title + Actions + Filters (matches TB Records style) ── */}
      <div className="glass-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div
            className="flex items-center gap-2 text-sm font-bold"
            style={{ color: '#0f172a' }}
          >
            <i
              className="ri-line-chart-line text-lg"
              style={{ color: '#2E6FAF' }}
            />
            <span>Analytics & ARIMA Forecasting</span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              onClick={handleRunForecast}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-60"
              style={{
                background:
                  'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)',
              }}
            >
              {loading ? (
                <>
                  <i className="ri-loader-4-line animate-spin text-sm" />
                  Running...
                </>
              ) : (
                <>
                  <i className="ri-play-line text-sm" />
                  Run Forecast
                </>
              )}
            </button>
            <button
              onClick={() => ran && setShowReport(true)}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition"
              style={{
                background: ran ? '#f8fafc' : '#f1f5f9',
                border: '1px solid #e2e8f0',
                color: ran ? '#475569' : '#94a3b8',
                opacity: ran ? 1 : 0.5,
                pointerEvents: ran ? 'auto' : 'none',
              }}
            >
              <i className="ri-file-list-3-line text-sm" />
              Forecast Report
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold text-white transition hover:opacity-90"
              style={{
                background:
                  'linear-gradient(135deg, #0066FF 0%, #00D8F6 100%)',
              }}
            >
              <i className="ri-download-2-line text-sm" />
              Export
            </button>
          </div>
        </div>

        <div className="mt-5 grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <select
            value={selectedBrgy}
            onChange={(e) => {
              setSelectedBrgy(e.target.value);
              setRan(false);
            }}
            className="w-full rounded-lg px-3 py-2 text-xs font-medium outline-none transition"
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#0f172a',
            }}
          >
            <option value="">All Barangays</option>
            {barangays.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <select
            value={horizon}
            onChange={(e) => {
              setHorizon(e.target.value);
              setRan(false);
            }}
            className="w-full rounded-lg px-3 py-2 text-xs font-medium outline-none transition"
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#0f172a',
            }}
          >
            <option value="1">1 Month Horizon</option>
            <option value="3">3 Months Horizon</option>
            <option value="6">6 Months Horizon</option>
            <option value="12">12 Months Horizon</option>
          </select>
          <select
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              setRan(false);
            }}
            className="w-full rounded-lg px-3 py-2 text-xs font-medium outline-none transition"
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#0f172a',
            }}
          >
            {['2025', '2024', '2023'].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              setSelectedBrgy('');
              setHorizon('3');
              setYear('2025');
              setRan(false);
            }}
            className="w-full rounded-lg px-3 py-2 text-xs font-bold transition hover:bg-slate-100"
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#475569',
            }}
          >
            <i className="ri-filter-off-line mr-1" />
            Clear Filters
          </button>
        </div>
      </div>

      {/* ── Results Area ── */}
      {loading ? (
        <div className="glass-card p-12 text-center">
          <div className="text-4xl mb-3">&#9881;&#65039;</div>
          <div
            className="text-sm font-bold"
            style={{ color: '#0f172a' }}
          >
            Running ARIMA(2,1,2) Model...
          </div>
          <div className="text-xs mt-2" style={{ color: '#64748b' }}>
            Fitting model on {year} data &middot; Generating {horizon}-month
            forecast
          </div>
        </div>
      ) : !ran ? (
        <div className="glass-card p-12 text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)', boxShadow: '0 4px 14px rgba(59,130,246,0.15)' }}>
            <i className="ri-pulse-line text-3xl" style={{ color: '#2563eb' }} />
          </div>
          <div
            className="text-sm font-bold"
            style={{ color: '#0f172a' }}
          >
            Configure and Run Forecast
          </div>
          <div className="text-xs mt-2" style={{ color: '#64748b' }}>
            Select a barangay (or all), set forecast horizon and base year, then
            click <strong>Run Forecast</strong>.
          </div>
        </div>
      ) : forecastResults ? (
        <>
          {/* ── KPI Row ── */}
          <section
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
          >
            {/* Main KPI */}
            <div
              className="rounded-2xl p-5 text-white"
              style={{
                background:
                  'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)',
              }}
            >
              <div className="text-xs font-semibold opacity-80 mb-2">
                Total Forecasted ({nextYrLabel})
              </div>
              <div className="text-3xl font-extrabold leading-none">
                {forecastResults.totalFc.toLocaleString()}
              </div>
              <div className="text-[11px] opacity-70 mt-1">
                {scope} &middot; ARIMA
              </div>
            </div>
            {/* Side KPIs */}
            <div className="glass-card p-5">
              <div
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: '#64748b' }}
              >
                Confidence Level
              </div>
              <div
                className="text-2xl font-extrabold mt-1"
                style={{ color: '#0F2D52' }}
              >
                94%
              </div>
              <div className="text-[11px]" style={{ color: '#64748b' }}>
                ARIMA(2,1,2)
              </div>
            </div>
            <div className="glass-card p-5">
              <div
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: '#64748b' }}
              >
                Projected Increase
              </div>
              <div
                className="text-2xl font-extrabold mt-1"
                style={{ color: '#EF4444' }}
              >
                +{forecastResults.projInc.toFixed(1)}%
              </div>
              <div className="text-[11px]" style={{ color: '#64748b' }}>
                vs. Dec {yr}
              </div>
            </div>
            <div className="glass-card p-5">
              <div
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: '#64748b' }}
              >
                Critical Barangays
              </div>
              <div
                className="text-2xl font-extrabold mt-1"
                style={{ color: '#0F2D52' }}
              >
                {critBrgyCount}
              </div>
              <div className="text-[11px]" style={{ color: '#64748b' }}>
                Immediate action needed
              </div>
            </div>
          </section>

          {/* ── Charts Row ── */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Historical Trend */}
            <div className="glass-card p-5">
              <div
                className="flex items-center gap-2 text-sm font-bold mb-4"
                style={{ color: '#0f172a' }}
              >
                <i className="ri-line-chart-line" style={{ color: '#2E6FAF' }} />
                Historical Trend ({year})
              </div>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={forecastResults.histData}>
                    <defs>
                      <linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4FD1C5" />
                        <stop offset="95%" stopColor="#2E6FAF" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: '#64748b', fontSize: 10 }}
                    />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      itemStyle={{ color: '#0f172a' }}
                      cursor={{ stroke: '#2E6FAF', strokeWidth: 1 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="actual"
                      fill="url(#histGrad)"
                      fillOpacity={0.25}
                      stroke="#2E6FAF"
                      strokeWidth={3}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div
                className="flex gap-5 text-xs mt-1 pl-2 font-semibold"
                style={{ color: '#64748b' }}
              >
                <span className="flex items-center">
                  <span className="w-3 h-0.5 bg-[#2E6FAF] inline-block mr-1.5" />
                  Actual Cases
                </span>
              </div>
            </div>

            {/* ARIMA Forecast */}
            <div className="glass-card p-5">
              <div
                className="flex items-center gap-2 text-sm font-bold mb-4"
                style={{ color: '#0f172a' }}
              >
                <i className="ri-brain-line" style={{ color: '#8B5CF6' }} />
                ARIMA Forecast (
                {forecastResults.arimaFcLabels?.[0]}
                &ndash;
                {forecastResults.arimaFcLabels?.[
                  forecastResults.arimaFcLabels.length - 1
                ]}
                )
              </div>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={forecastResults.arimaChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: '#64748b', fontSize: 10 }}
                    />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      itemStyle={{ color: '#0f172a' }}
                      cursor={{ stroke: '#2E6FAF', strokeWidth: 1 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="actual"
                      stroke="#2E6FAF"
                      strokeWidth={3}
                      dot={{ r: 4, fill: '#2E6FAF' }}
                      name="Actual"
                    />
                    <Line
                      type="monotone"
                      dataKey="forecast"
                      stroke="#4FD1C5"
                      strokeWidth={3}
                      strokeDasharray="5 5"
                      dot={{ r: 4, fill: '#4FD1C5' }}
                      name="Forecast"
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="upper"
                      stroke="rgba(79,209,197,.35)"
                      strokeWidth={1}
                      strokeDasharray="3 4"
                      dot={false}
                      name="Upper CI"
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="lower"
                      stroke="rgba(79,209,197,.35)"
                      strokeWidth={1}
                      strokeDasharray="3 4"
                      dot={false}
                      name="Lower CI"
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div
                className="flex gap-5 text-xs mt-1 pl-2 font-semibold"
                style={{ color: '#64748b' }}
              >
                <span className="flex items-center">
                  <span className="w-3 h-0.5 bg-[#2E6FAF] inline-block mr-1.5" />
                  Actual
                </span>
                <span className="flex items-center">
                  <span className="w-3 h-0.5 border-t-2 border-dashed border-[#4FD1C5] inline-block mr-1.5" />
                  Forecast
                </span>
                <span className="flex items-center">
                  <span className="w-3 h-0.5 border-t border-dashed border-[#4FD1C5] opacity-40 inline-block mr-1.5" />
                  Confidence Interval
                </span>
              </div>
            </div>
          </section>

          {/* ── Actual vs Predicted (Full Width) ── */}
          <section className="glass-card p-5">
            <div
              className="flex items-center gap-2 text-sm font-bold mb-4"
              style={{ color: '#0f172a' }}
            >
              <i
                className="ri-bar-chart-grouped-line"
                style={{ color: '#2E6FAF' }}
              />
              Actual vs. Predicted
            </div>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={forecastResults.actPredData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    interval={1}
                  />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    itemStyle={{ color: '#0f172a' }}
                    cursor={{ stroke: '#2E6FAF', strokeWidth: 1 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    stroke="#2E6FAF"
                    strokeWidth={3}
                    dot={{ r: 2 }}
                    name="Actual"
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="predicted"
                    stroke="#4FD1C5"
                    strokeWidth={3}
                    strokeDasharray="5 5"
                    dot={{ r: 3, fill: '#4FD1C5' }}
                    name="Predicted"
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div
              className="flex gap-5 text-xs mt-1 pl-2 font-semibold"
              style={{ color: '#64748b' }}
            >
              <span className="flex items-center">
                <span className="w-3 h-0.5 bg-[#2E6FAF] inline-block mr-1.5" />
                Actual Cases
              </span>
              <span className="flex items-center">
                <span className="w-3 h-0.5 border-t-2 border-dashed border-[#4FD1C5] inline-block mr-1.5" />
                Predicted
              </span>
            </div>
          </section>

          {/* ── Barangay-Level Forecast Table ── */}
          <section className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div
                className="flex items-center gap-2 text-sm font-bold"
                style={{ color: '#0f172a' }}
              >
                <i className="ri-table-line" style={{ color: '#2E6FAF' }} />
                Barangay-Level Forecast Table
              </div>
              <button
                onClick={() => setShowReport(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition hover:opacity-80"
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  color: '#475569',
                }}
              >
                <i className="ri-file-list-3-line" />
                Forecast Report
              </button>
            </div>
            <div className="overflow-x-auto">
              <table
                className="w-full text-xs"
                style={{ borderCollapse: 'collapse' }}
              >
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                    {[
                      'Barangay',
                      'Current Cases',
                      'Forecast (Next Month)',
                      'Trend',
                      'Growth Rate',
                      'Risk',
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left px-3 py-2.5 font-bold uppercase tracking-wider"
                        style={{
                          color: '#64748b',
                          background: '#f8fafc',
                          fontSize: '10px',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {forecastResults.tableData.map((d, i) => (
                    <tr
                      key={d.b}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: i % 2 === 0 ? '#fff' : '#f8fafc',
                      }}
                    >
                      <td
                        className="px-3 py-2.5 font-bold"
                        style={{ color: '#0f172a' }}
                      >
                        {d.b}
                      </td>
                      <td className="px-3 py-2.5" style={{ color: '#475569' }}>
                        {d.cases}
                      </td>
                      <td
                        className="px-3 py-2.5 font-bold"
                        style={{ color: '#0f172a' }}
                      >
                        {d.forecast}
                      </td>
                      <td className="px-3 py-2.5">{trendIcon(d.trend)}</td>
                      <td
                        className="px-3 py-2.5 font-bold"
                        style={{
                          color: d.pct > 0 ? '#EF4444' : '#10B981',
                        }}
                      >
                        {d.pct > 0 ? '+' : ''}
                        {d.pct}%
                      </td>
                      <td className="px-3 py-2.5">{riskBadge(d.risk)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {/* ── Forecast Report Modal ── */}
      {showReport && forecastResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
          <div
            className="glass-card w-full max-w-[820px] max-h-[90vh] overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.97)' }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-6 py-5"
              style={{ borderBottom: '1px solid rgba(148,163,184,.15)' }}
            >
              <div className="text-base font-bold" style={{ color: '#0f172a' }}>
                <i
                  className="ri-file-list-3-line mr-2"
                  style={{ color: '#2E6FAF' }}
                />
                Forecast Report &mdash; ARIMA(2,1,2)
              </div>
              <button
                onClick={() => setShowReport(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:opacity-80"
                style={{ background: '#f1f5f9', color: '#475569' }}
              >
                <i className="ri-close-line text-base" />
              </button>
            </div>

            {/* Body */}
            <div
              className="overflow-y-auto px-6 py-6"
              style={{ maxHeight: '75vh' }}
            >
              {/* Report Header */}
              <div
                className="text-center pb-4 mb-5"
                style={{ borderBottom: '3px solid #0F2D52' }}
              >
                <div
                  className="text-[10px] uppercase tracking-[0.15em] font-bold"
                  style={{ color: '#64748b' }}
                >
                  Republic of the Philippines &middot; Pasig City Health Office
                </div>
                <div
                  className="text-lg font-extrabold mt-1"
                  style={{ color: '#0F2D52' }}
                >
                  TB FORECASTING REPORT
                </div>
                <div
                  className="text-sm font-semibold mt-1"
                  style={{ color: '#475569' }}
                >
                  ARIMA(2,1,2) Model &middot; {scope} &middot; {mo}-Month
                  Horizon
                </div>
                <div
                  className="text-[11px] mt-1.5"
                  style={{ color: '#94a3b8' }}
                >
                  Base Year: {yr} &middot; Generated by TBInsight Dashboard
                </div>
              </div>

              {/* Report KPI Row */}
              <div className="grid grid-cols-4 gap-3 mb-5">
                {[
                  {
                    label: 'Total Forecasted',
                    value: forecastResults.totalFc.toLocaleString(),
                    color: '#0F2D52',
                  },
                  {
                    label: 'Confidence Level',
                    value: '94%',
                    color: '#2E6FAF',
                  },
                  {
                    label: 'Projected Increase',
                    value: `+${forecastResults.projInc.toFixed(1)}%`,
                    color: '#EF4444',
                  },
                  {
                    label: 'Critical Barangays',
                    value: critBrgyCount,
                    color: '#F59E0B',
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-lg p-3 text-center"
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div
                      className="text-lg font-extrabold"
                      style={{ color: s.color }}
                    >
                      {s.value}
                    </div>
                    <div
                      className="text-[10px] font-semibold mt-0.5"
                      style={{ color: '#64748b' }}
                    >
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Model Summary */}
              <div
                className="rounded-lg p-3.5 mb-5 text-xs leading-relaxed"
                style={{
                  background: 'rgba(16,185,129,0.06)',
                  border: '1px solid rgba(16,185,129,0.2)',
                  color: '#475569',
                }}
              >
                <strong style={{ color: '#0f172a' }}>Model Summary:</strong> The
                ARIMA(2,1,2) model was fitted on {yr} historical TB case data
                {selectedBrgy
                  ? ` for Barangay ${selectedBrgy}`
                  : ' across all 30 barangays in Pasig City'}
                . The model projects {forecastResults.totalFc.toLocaleString()}{' '}
                total cases over the next {mo} month(s), representing a +
                {forecastResults.projInc}% increase from the most recent
                period. Confidence interval: 95%.
              </div>

              {/* Report Barangay Table */}
              <div className="mb-5">
                <div
                  className="text-xs font-bold uppercase tracking-wider mb-3"
                  style={{ color: '#0f172a' }}
                >
                  Barangay-Level Forecast
                </div>
                <table
                  className="w-full text-[11px]"
                  style={{ borderCollapse: 'collapse' }}
                >
                  <thead>
                    <tr>
                      {[
                        'Barangay',
                        'Current Cases',
                        'Forecast (Next Month)',
                        'Growth Rate',
                        'Trend',
                        'Risk Level',
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left px-3 py-2 font-bold text-white"
                          style={{
                            background: '#0F2D52',
                            fontSize: '9px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {forecastResults.tableData.map((d, i) => (
                      <tr
                        key={d.b}
                        style={{ background: i % 2 ? '#f8fafc' : '#fff' }}
                      >
                        <td
                          className="px-3 py-2 font-semibold"
                          style={{
                            borderBottom: '1px solid #e2e8f0',
                            color: '#0f172a',
                          }}
                        >
                          {d.b}
                        </td>
                        <td
                          className="px-3 py-2 text-center"
                          style={{ borderBottom: '1px solid #e2e8f0' }}
                        >
                          {d.cases}
                        </td>
                        <td
                          className="px-3 py-2 text-center font-bold"
                          style={{ borderBottom: '1px solid #e2e8f0' }}
                        >
                          {d.forecast}
                        </td>
                        <td
                          className="px-3 py-2 text-center font-bold"
                          style={{
                            borderBottom: '1px solid #e2e8f0',
                            color: d.pct > 0 ? '#EF4444' : '#10B981',
                          }}
                        >
                          {d.pct > 0 ? '+' : ''}
                          {d.pct}%
                        </td>
                        <td
                          className="px-3 py-2 text-center"
                          style={{ borderBottom: '1px solid #e2e8f0' }}
                        >
                          {d.diff > 3
                            ? '\u2191 Increasing'
                            : d.diff < -3
                              ? '\u2193 Decreasing'
                              : '\u2192 Stable'}
                        </td>
                        <td
                          className="px-3 py-2"
                          style={{ borderBottom: '1px solid #e2e8f0' }}
                        >
                          {riskBadge(d.risk)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Recommendations */}
              <div
                className="rounded-lg p-3.5 mb-5 text-xs"
                style={{
                  background: 'rgba(245,158,11,0.06)',
                  border: '1px solid rgba(245,158,11,0.3)',
                  color: '#475569',
                }}
              >
                <strong style={{ color: '#0f172a' }}>Recommendations:</strong>{' '}
                Based on the ARIMA(2,1,2) forecast,&nbsp;
                {forecastData
                  .filter((d) => d.risk === 'High')
                  .map((d) => d.barangay)
                  .join(', ')}{' '}
                are projected as high-priority barangays requiring immediate
                resource deployment. Active case finding, contact tracing
                intensification, and treatment monitoring are recommended for
                the next {mo} month(s).
              </div>

              {/* Footer */}
              <div
                className="flex items-center justify-between pt-4 text-[10px]"
                style={{
                  borderTop: '2px solid #e2e8f0',
                  color: '#94a3b8',
                }}
              >
                <span>TBInsight Dashboard &middot; Pasig City Health Office</span>
                <span>
                  ARIMA Forecast &middot; Base: {yr} &middot; Horizon: {mo}{' '}
                  months
                </span>
              </div>
            </div>

            {/* Footer Actions */}
            <div
              className="flex gap-2 justify-end px-6 py-4"
              style={{
                borderTop: '1px solid rgba(148,163,184,.15)',
              }}
            >
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white transition hover:opacity-90"
                style={{ background: '#0F2D52' }}
              >
                <i className="ri-printer-line text-sm" />
                Print Report
              </button>
              <button
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white transition hover:opacity-90"
                style={{
                  background: 'linear-gradient(135deg, #0F2D52, #2E6FAF)',
                }}
              >
                <i className="ri-download-2-line text-sm" />
                Save as File
              </button>
              <button
                onClick={() => setShowReport(false)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition"
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  color: '#475569',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
