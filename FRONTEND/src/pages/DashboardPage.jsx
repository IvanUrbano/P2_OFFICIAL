import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area,
} from 'recharts';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useTBData } from '../context/TBDataContext';

const chartTooltipStyle = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  color: '#0f172a',
  fontSize: '12px',
  boxShadow: '0 4px 12px rgba(0, 102, 255, 0.08)',
};

/* ─── Color maps for donut segments ─── */
const OUTCOME_COLORS = {
  Cured: '#10B981',
  Completed: '#0066FF',
  Active: '#F59E0B',
  Treatment: '#2E6FAF',
  Defaulted: '#7c3aed',
  Failed: '#ff0055',
  Died: '#EF4444',
  'Not Evaluated': '#94A3B8',
};

const AGE_COLORS = {
  '0-14': '#4FD1C5',
  '15-64': '#EF4444',
  '65+': '#2E6FAF',
};

const AGE_LABELS = {
  '0-14': '0–14 yrs',
  '15-64': '15–64 yrs',
  '65+': '65+ yrs',
};

const GENDER_COLORS = {
  Male: '#2E6FAF',
  Female: '#4FD1C5',
};

/* ─── Helper: build donut segments from a frequency map ─── */
function buildSegments(data, colorMap, { strokeWidth } = {}) {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  let cumulative = 0;
  return Object.entries(data)
    .filter(([, v]) => v > 0)
    .map(([key, val]) => {
      const pct = Math.round((val / total) * 100);
      const offset = cumulative;
      cumulative += pct;
      const seg = { color: colorMap[key] || '#94A3B8', pct, offset, label: key };
      if (strokeWidth != null) seg.w = strokeWidth;
      return seg;
    });
}

/* ─── Local sub-components ─── */
function MetricItem({ title, value, icon, color, trend, isLast }) {
  return (
    <div className="p-4 flex flex-col justify-center relative">
      {/* Subtle vertical divider, not a full box border */}
      {!isLast && (
        <div
          className="absolute right-0 top-1/2 -translate-y-1/2 w-[2px] h-12"
          style={{
            background: 'rgba(3, 33, 62, 0.3)', /* Made transparent as requested */
            boxShadow: '0 0 8px rgba(79, 209, 197, 0.4)'
          }}
        />
      )}
      <div className="flex items-center gap-2 mb-2">
        <i className={`${icon} text-lg`} style={{ color }} />
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>
          {title}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <div className="text-2xl font-bold" style={{ color: '#0f172a' }}>{value}</div>
        <div className="text-xs font-semibold" style={{ color }}>{trend}</div>
      </div>
    </div>
  );
}

function VizCard({ title, icon, iconColor, children, style = {}, className = '', headerAction }) {
  return (
    <div className="glass-card flex flex-col p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm font-bold" style={{ color: '#0f172a' }}>
          <i className={icon} style={{ color: iconColor || '#2E6FAF' }} />
          <span>{title}</span>
        </div>
        {headerAction && <div>{headerAction}</div>}
      </div>
      {children}
    </div>
  );
}

function DonutChart({ segments, size = 160 }) {
  const r = 15.91549430918954;
  const [tooltip, setTooltip] = useState(null);

  return (
    <div className="relative inline-block">
      <svg width={size} height={size} viewBox="0 0 42 42">
        {segments.map((s, i) => (
          <circle
            key={i}
            cx="21" cy="21" r={r}
            fill="transparent"
            stroke={s.color}
            strokeWidth={s.w || 8}
            strokeDasharray={`${s.pct} ${100 - s.pct}`}
            strokeDashoffset={-s.offset}
            style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
            onMouseEnter={(e) => {
              const rect = e.currentTarget.closest('svg').parentElement.getBoundingClientRect();
              setTooltip({ i, label: s.label, pct: s.pct, color: s.color, x: e.clientX - rect.left, y: e.clientY - rect.top });
            }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.closest('svg').parentElement.getBoundingClientRect();
              setTooltip(t => t ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
            }}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}
      </svg>

      {/* Hover Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 px-3 py-2 rounded-lg text-xs font-semibold shadow-lg"
          style={{
            left: tooltip.x + 8,
            top: tooltip.y - 36,
            background: '#ffffff',
            border: `1px solid ${tooltip.color}`,
            color: '#0f172a',
            boxShadow: `0 4px 12px rgba(0,0,0,0.1), 0 0 0 1px ${tooltip.color}22`,
            whiteSpace: 'nowrap'
          }}
        >
          <span style={{ color: tooltip.color }}>●</span>&nbsp;
          {tooltip.label} — <strong>{tooltip.pct}%</strong>
        </div>
      )}
    </div>
  );
}

/* ─── Page Component ─── */
export default function DashboardPage() {
  const navigate = useNavigate();
  const { analytics, alerts, forecastData, records, gisData } = useTBData();

  const [showRiskMatrix, setShowRiskMatrix] = useState(false);

  /* ── Derive chart / segment data from analytics ── */

  // Line/Area chart data: merge actual monthlyTrend + forecastTrend
  const trendData = useMemo(() => {
    const actuals = (analytics.monthlyTrend || []).map(d => ({ label: d.month, actual: d.actual }));
    const forecasts = (analytics.forecastTrend || []).map(d => ({ label: d.month, forecast: d.forecast }));
    return [...actuals, ...forecasts];
  }, [analytics.monthlyTrend, analytics.forecastTrend]);

  // Top 10 barangay bar chart
  const barangayData = useMemo(
    () => (analytics.barangayCases || []).slice(0, 10),
    [analytics.barangayCases],
  );

  // Treatment outcome donut segments
  const outcomeSegments = useMemo(
    () => buildSegments(analytics.treatmentOutcomes || {}, OUTCOME_COLORS),
    [analytics.treatmentOutcomes],
  );

  // Age donut segments
  const ageSegments = useMemo(
    () => buildSegments(analytics.ageDistribution || {}, AGE_COLORS, { strokeWidth: 6 }),
    [analytics.ageDistribution],
  );

  // Gender donut segments
  const genderSegments = useMemo(
    () => buildSegments(analytics.genderDistribution || {}, GENDER_COLORS, { strokeWidth: 10 }),
    [analytics.genderDistribution],
  );

  // Compute age label percentages for the legend
  const ageTotal = useMemo(
    () => Object.values(analytics.ageDistribution || {}).reduce((a, b) => a + b, 0),
    [analytics.ageDistribution],
  );
  const genderTotal = useMemo(
    () => Object.values(analytics.genderDistribution || {}).reduce((a, b) => a + b, 0),
    [analytics.genderDistribution],
  );

  // Forecast summary table rows derived from forecastData
  const forecastRows = useMemo(() => {
    const base = analytics.forecastNextMonth || 0;
    const avgGrowth = forecastData.length > 0
      ? forecastData.reduce((s, d) => s + (d.growthRate || 0), 0) / forecastData.length
      : 0;
    // normalise: if growthRate is already a percentage (e.g. 8.8) keep it; if decimal (0.088) scale up
    const growthPct = avgGrowth > 1 ? avgGrowth : avgGrowth * 100;
    const g = growthPct / 100;
    return [
      { period: 'Next Month', val: String(Math.round(base)), pct: `+${growthPct.toFixed(1)}%` },
      { period: '3 Months', val: String(Math.round(base * (1 + g * 2))), pct: `+${(growthPct * 2).toFixed(1)}%` },
      { period: '6 Months', val: String(Math.round(base * (1 + g * 5))), pct: `+${(growthPct * 5).toFixed(1)}%` },
    ];
  }, [analytics.forecastNextMonth, forecastData]);

  // Alert helper: map context type to visual variant
  const alertVariant = (type) => {
    if (type === 'High') return 'danger';
    return 'warning';
  };

  return (
    <div className="relative space-y-5">

      <section
        className="glass-card grid gap-0 overflow-hidden"
        style={{
          gridTemplateColumns: 'repeat(6, 1fr)'
        }}
      >

        <MetricItem
          title="Total TB Cases"
          value={analytics.totalCases ?? '—'}
          icon="ri-bar-chart-fill"
          color="#2E6FAF"
          trend="+12%"
        />

        <MetricItem
          title="Active Cases"
          value={analytics.activeCases ?? '—'}
          icon="ri-time-line"
          color="#F59E0B"
          trend="Ongoing"
        />

        <MetricItem
          title="High-Risk Areas"
          value={analytics.highRiskAreas ?? '—'}
          icon="ri-alarm-warning-line"
          color="#EF4444"
          trend="Critical"
        />

        <MetricItem
          title="Success Rate"
          value={analytics.successRate != null ? `${Math.round(analytics.successRate)}%` : '—'}
          icon="ri-checkbox-circle-line"
          color="#10B981"
          trend="Below WHO"
        />

        <MetricItem
          title="Forecast"
          value={analytics.forecastNextMonth ?? '—'}
          icon="ri-brain-line"
          color="#8B5CF6"
          trend="+8.8%"
        />

        <MetricItem
          title="Last Sync"
          value={analytics.lastSync ?? '—'}
          icon="ri-refresh-line"
          color="#4FD1C5"
          trend="Updated"
          isLast={true}
        />

      </section>

      {/* ── Row 1: Line Chart + Bar Chart + Treatment Outcomes ── */}
      <section className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
        <VizCard title="Monthly TB Case Trends — 2023–2025 with Forecast" icon="ri-line-chart-line">
          <div className="flex-1" style={{ minHeight: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>

                <defs>
                  <linearGradient
                    id="tbGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#4FD1C5" />
                    <stop offset="95%" stopColor="#2E6FAF" />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" />

                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />

                <Tooltip
                  contentStyle={chartTooltipStyle}
                  itemStyle={{ color: '#0f172a' }}
                  cursor={{ stroke: '#2E6FAF', strokeWidth: 1 }}
                />

                <Area
                  type="monotone"
                  dataKey="actual"
                  fill="url(#tbGradient)"
                  fillOpacity={0.25}
                  stroke="#2E6FAF"
                  strokeWidth={3}
                />

                <Line
                  type="monotone"
                  dataKey="forecast"
                  stroke="#4FD1C5"
                  strokeWidth={3}
                  strokeDasharray="5 5"
                />

              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-5 text-xs mt-1 pl-2 font-semibold" style={{ color: '#64748b' }}>
            <span className="flex items-center"><span className="w-3 h-0.5 bg-[#0066FF] inline-block mr-1.5" />Actual Cases</span>
            <span className="flex items-center"><span className="w-3 h-0.5 border-t-2 border-dashed border-[#00D8F6] inline-block mr-1.5" />Forecast</span>
          </div>
        </VizCard>

        <VizCard title="Cases by Barangay (Top 10)" icon="ri-bar-chart-2-line">
          <div className="flex-1" style={{ minHeight: 260 }}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={barangayData} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={72} />
                <defs>
                  <linearGradient
                    id="barGradient"
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="0"
                  >
                    <stop offset="0%" stopColor="#4FD1C5" />
                    <stop offset="100%" stopColor="#174A7E" />
                  </linearGradient>
                </defs>

                <Tooltip
                  contentStyle={chartTooltipStyle}
                  itemStyle={{ color: '#0f172a' }}
                  cursor={{ fill: 'rgba(46,111,175,0.06)' }}
                  formatter={(val) => [`${val} cases`, 'Cases']}
                />

                <Bar
                  dataKey="cases"
                  fill="url(#barGradient)"
                  radius={[12, 12, 12, 12]}
                  barSize={16}
                />              </BarChart>
            </ResponsiveContainer>
          </div>
        </VizCard>

        <VizCard title="Treatment Data Overview" icon="ri-pie-chart-2-line">
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="relative">
              <DonutChart
                segments={outcomeSegments}
                size={140}
              />

              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-2xl font-bold">
                  {analytics.totalCases ?? '—'}
                </div>
                <div className="text-xs text-slate-500">
                  Cases
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-4 w-full px-1">
              {outcomeSegments.map(s => (
                <div key={s.label} className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: '#475569' }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                  {s.label}
                </div>
              ))}
            </div>
          </div>
        </VizCard>
      </section>

      <section
        className="grid gap-5"
        style={{ gridTemplateColumns: '2fr 1fr 1fr' }}
      >
        {/* GIS MAP */}
        <VizCard
          title="GIS Hotspot Monitoring"
          icon="ri-map-pin-line"
          headerAction={
            <button
              onMouseEnter={() => setShowRiskMatrix(true)}
              onMouseLeave={() => setShowRiskMatrix(false)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
              style={{
                background: showRiskMatrix ? 'rgba(46,111,175,0.15)' : 'rgba(148,163,184,0.08)',
                border: showRiskMatrix ? '1px solid rgba(46,111,175,0.4)' : '1px solid rgba(148,163,184,0.2)',
                color: showRiskMatrix ? '#2E6FAF' : '#64748B'
              }}
            >
              <i className="ri-map-2-line" />
              Risk Matrix
            </button>
          }
        >
          <div
            className="flex-1 rounded-2xl relative overflow-hidden"
            style={{ minHeight: 260, border: '1px solid rgba(148,163,184,0.15)' }}
          >
            <MapContainer
              center={[14.5570, 121.0850]}
              zoom={13}
              style={{ height: '100%', width: '100%', minHeight: 260 }}
              zoomControl={false}
              attributionControl={false}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {gisData.map((g) => {
                const bRecords = records.filter(r => r.barangay === g.barangay);
                const male = bRecords.filter(r => r.sex === 'Male').length;
                const female = bRecords.filter(r => r.sex === 'Female').length;
                const riskColor = g.risk === 'High' ? '#EF4444' : g.risk === 'Moderate' ? '#F59E0B' : '#10B981';
                const radius = g.risk === 'High' ? 14 : g.risk === 'Moderate' ? 11 : 8;
                return (
                  <CircleMarker
                    key={g.barangay}
                    center={[g.lat, g.lng]}
                    radius={radius}
                    fillColor={riskColor}
                    fillOpacity={0.75}
                    color="#ffffff"
                    weight={2}
                  >
                    <Popup>
                      <div style={{ fontFamily: 'Inter, sans-serif', minWidth: 170 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: '#0f172a' }}>{g.barangay}</div>
                        <div style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12, display: 'inline-block', marginBottom: 6, background: `${riskColor}1A`, color: riskColor }}>
                          {g.risk} Risk
                        </div>
                        <div style={{ fontSize: 11, lineHeight: 1.8, color: '#475569' }}>
                          <div><strong>Cases:</strong> {g.cases}</div>
                          <div><strong>Active:</strong> {g.activeCases}</div>
                          <div><strong>Forecast:</strong> {g.forecast}</div>
                          <div><strong>Success Rate:</strong> {Math.round(g.successRate)}%</div>
                          <div><strong>Male:</strong> {male} · <strong>Female:</strong> {female}</div>
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>

            {/* Risk Matrix Legend */}
            {showRiskMatrix && (
              <div
                className="glass-card absolute bottom-4 left-4 z-[1000] p-4"
                style={{ width: 230 }}
              >
                <div className="font-bold uppercase tracking-wider mb-3" style={{ color: '#64748B', fontSize: 10 }}>
                  Risk Matrix
                </div>
                {[
                  { color: '#EF4444', label: 'Severe Hotspot (>100 cases)' },
                  { color: '#F59E0B', label: 'Moderate Risk (50–100)' },
                  { color: '#10B981', label: 'Low Risk Alert (<50)' }
                ].map((m) => (
                  <div key={m.label} className="flex items-center gap-2 mb-2 last:mb-0">
                    <span className="w-3 h-3 rounded-full" style={{ background: m.color }} />
                    <span className="text-xs font-medium" style={{ color: '#475569' }}>{m.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </VizCard>

        {/* AGE DISTRIBUTION */}
        <VizCard
          title="Age Distribution"
          icon="ri-user-line"
          className="items-center justify-center text-center"
        >
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <DonutChart
              segments={ageSegments}
              size={130}
            />

            <div
              className="flex justify-around w-full text-xs font-bold"
              style={{ color: '#475569' }}
            >
              {Object.entries(analytics.ageDistribution || {}).map(([key, val]) => (
                <span key={key}>
                  <i
                    className="ri-circle-fill mr-1"
                    style={{ color: AGE_COLORS[key] || '#94A3B8' }}
                  />
                  {AGE_LABELS[key] || key}
                  {ageTotal > 0 && ` (${Math.round((val / ageTotal) * 100)}%)`}
                </span>
              ))}
            </div>
          </div>
        </VizCard>

        {/* GENDER */}
        <VizCard
          title="Gender Balance"
          icon="ri-group-line"
          className="items-center justify-center text-center"
        >
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <DonutChart
              segments={genderSegments}
              size={130}
            />

            <div
              className="flex justify-around w-full text-xs font-bold"
              style={{ color: '#475569' }}
            >
              {Object.entries(analytics.genderDistribution || {}).map(([key, val]) => (
                <span key={key}>
                  <i
                    className={`${key === 'Male' ? 'ri-men-line' : 'ri-women-line'} mr-1`}
                    style={{ color: GENDER_COLORS[key] || '#94A3B8' }}
                  />
                  {key} ({genderTotal > 0 ? Math.round((val / genderTotal) * 100) : 0}%)
                </span>
              ))}
            </div>
          </div>
        </VizCard>
      </section>
      {/* ── Row 3: Alerts + Forecast Summary ── */}
      <section
        className="grid gap-5 pb-4"
        style={{ gridTemplateColumns: '2fr 1fr' }}
      >

        {/* ALERTS */}
        <div className="glass-card p-5">

          <div className="flex items-center justify-between mb-4">
            <div
              className="flex items-center gap-2 text-sm font-bold"
              style={{ color: '#0F172A' }}
            >
              <i
                className="ri-alarm-warning-line text-lg"
                style={{ color: '#EF4444' }}
              />
              Latest Alerts
            </div>

            <button
              onClick={() => navigate('/alert')}
              className="rounded-md border border-slate-200 px-3 py-1 text-xs font-semibold text-[#0A2540] transition duration-200 ease-in-out hover:border-[#2E6FAF]/40 hover:bg-[#2E6FAF]/15 hover:text-[#2E6FAF] active:scale-95"
            >
              View All
            </button>
          </div>

          <div className="space-y-3">

            {alerts.slice(0, 3).map((a) => {

              const variant = alertVariant(a.type);
              const isDanger = variant === 'danger';

              return (
                <div
                  key={a.id}
                  className="rounded-2xl p-4 transition-all hover:-translate-y-1"
                  style={{
                    background: isDanger
                      ? 'rgba(239,68,68,0.08)'
                      : 'rgba(245,158,11,0.08)',

                    border: isDanger
                      ? '1px solid rgba(239,68,68,0.20)'
                      : '1px solid rgba(245,158,11,0.20)'
                  }}
                >

                  <div className="flex gap-3">

                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background: isDanger
                          ? 'rgba(239,68,68,.15)'
                          : 'rgba(245,158,11,.15)'
                      }}
                    >
                      <i
                        className={`${a.icon || (isDanger ? 'ri-alarm-warning-line' : 'ri-error-warning-line')} text-lg`}
                        style={{
                          color: isDanger
                            ? '#EF4444'
                            : '#F59E0B'
                        }}
                      />
                    </div>

                    <div>

                      <div
                        className="text-sm font-bold"
                        style={{ color: '#0F172A' }}
                      >
                        {a.title}
                      </div>

                      <div
                        className="text-xs mt-1"
                        style={{ color: '#64748B' }}
                      >
                        {a.desc}
                      </div>

                      <div
                        className="text-[11px] font-semibold mt-2"
                        style={{ color: '#94A3B8' }}
                      >
                        {a.timestamp}
                      </div>

                    </div>

                  </div>

                </div>
              );
            })}
          </div>
        </div>

        {/* FORECAST */}
        <div className="glass-card p-5">

          <div className="flex items-center justify-between mb-4">

            <div
              className="flex items-center gap-2 text-sm font-bold"
              style={{ color: '#0F172A' }}
            >
              <i
                className="ri-brain-line text-lg"
                style={{ color: '#2E6FAF' }}
              />
              Forecast Summary
            </div>

            <button
              onClick={() => navigate('/analytics')}
              className="rounded-md border border-slate-200 px-3 py-1 text-xs font-semibold text-[#0A2540] transition duration-200 ease-in-out hover:border-[#2E6FAF]/40 hover:bg-[#2E6FAF]/15 hover:text-[#2E6FAF] active:scale-95"
            >
              View Details
            </button>

          </div>

          <table className="w-full">

            <thead>
              <tr>
                {['Period', 'Forecast', 'Trend'].map((h) => (
                  <th
                    key={h}
                    className="pb-3 text-left text-[10px] uppercase tracking-[2px]"
                    style={{
                      color: '#64748B',
                      borderBottom: '1px solid rgba(148,163,184,.15)'
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>

              {forecastRows.map((row) => (

                <tr key={row.period}>

                  <td
                    className="py-4 text-xs font-semibold"
                    style={{ color: '#475569' }}
                  >
                    {row.period}
                  </td>

                  <td
                    className="py-4 text-lg font-bold"
                    style={{ color: '#0F172A' }}
                  >
                    {row.val}
                  </td>

                  <td className="py-4">

                    <span
                      className="px-2 py-1 rounded-full text-xs font-bold"
                      style={{
                        background:
                          'rgba(239,68,68,.12)',
                        color: '#EF4444'
                      }}
                    >
                      ↑ {row.pct}
                    </span>

                  </td>

                </tr>

              ))}

            </tbody>

          </table>

          <div
            className="mt-4 pt-4"
            style={{
              borderTop:
                '1px solid rgba(148,163,184,.15)'
            }}
          >
            <div
              className="text-xs"
              style={{ color: '#64748B' }}
            >
              Predicted trend indicates continued growth in TB incidence across high-risk barangays.
            </div>
          </div>

        </div>

      </section>

    </div>
  );
}
