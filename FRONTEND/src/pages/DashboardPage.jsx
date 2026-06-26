import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area, ComposedChart,
} from 'recharts';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useTBData } from '../context/TBDataContext';

/* ─── Constants ─── */
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

const chartTooltipStyle = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  color: '#0f172a',
  fontSize: '12px',
  boxShadow: '0 4px 12px rgba(0, 102, 255, 0.08)',
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
      {!isLast && (
        <div
          className="absolute right-0 top-1/2 -translate-y-1/2 w-[2px] h-12"
          style={{
            background: 'rgba(3, 33, 62, 0.3)',
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

function VizCard({ title, icon, iconColor, children, headerAction }) {
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
          <span style={{ color: tooltip.color }}>&#9679;</span>&nbsp;
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

  // ── Trend chart data (from context analytics.monthlyTrend + forecastTrend) ──
  const combinedChartData = useMemo(() => {
    const trend = analytics?.monthlyTrend || [];
    const forecast = analytics?.forecastTrend || [];

    const base = trend.map(m => ({ label: m.month, actual: m.actual, forecast: null }));

    // Append forecast months after actual data
    forecast.forEach(f => {
      if (!base.find(d => d.label === f.month)) {
        base.push({ label: f.month, actual: null, forecast: f.forecast });
      }
    });

    return base;
  }, [analytics]);

  // ── Barangay chart data (top 10) ──
  const barangayChartData = useMemo(() => {
    const data = analytics?.barangayCases || [];
    return data.slice(0, 10).map(b => ({ name: b.name, cases: b.cases }));
  }, [analytics]);

  // ── Donut segments ──
  const outcomeSegments = useMemo(() => {
    if (!analytics?.treatmentOutcomes) return [];
    return buildSegments(analytics.treatmentOutcomes, OUTCOME_COLORS);
  }, [analytics]);

  const ageSegments = useMemo(() => {
    if (!analytics?.ageDistribution) return [];
    return buildSegments(analytics.ageDistribution, AGE_COLORS, { strokeWidth: 6 })
      .map(s => ({ ...s, label: AGE_LABELS[s.label] || s.label }));
  }, [analytics]);

  const genderSegments = useMemo(() => {
    if (!analytics?.genderDistribution) return [];
    return buildSegments(analytics.genderDistribution, { Male: '#2E6FAF', Female: '#4FD1C5' }, { strokeWidth: 10 });
  }, [analytics]);

  // ── Forecast table (top 5 barangays) ──
  const forecastTable = useMemo(() => {
    const data = forecastData || [];
    return data
      .slice(0, 5)
      .map(f => ({
        period: f.barangay,
        val: f.predictedCases || 0,
        pct: f.risk || 'N/A',
      }));
  }, [forecastData]);

  // ── KPI values from context ──
  const totalCases = analytics?.totalCases || 0;
  const activeCases = analytics?.activeCases || 0;
  const highRiskAreas = analytics?.highRiskAreas || 0;
  const successRate = analytics?.successRate || 0;
  const barangayCount = analytics?.barangayCases?.length || 0;

  // Monthly case change percentage (last month vs previous month)
  const monthlyChangePct = useMemo(() => {
    const trend = analytics?.monthlyTrend || [];
    const withData = trend.filter(m => m.actual > 0);
    if (withData.length < 2) return null;
    const last = withData[withData.length - 1];
    const prev = withData[withData.length - 2];
    if (prev.actual === 0) return null;
    return Math.round(((last.actual - prev.actual) / prev.actual) * 100);
  }, [analytics]);

  // Forecast change %: predicted next month vs current month average
  const forecastChangePct = useMemo(() => {
    const trend = analytics?.monthlyTrend || [];
    const forecast = analytics?.forecastTrend || [];
    if (!forecast.length) return null;
    const withData = trend.filter(m => m.actual > 0);
    if (withData.length === 0) return null;
    // Average of last 3 months as baseline
    const last3 = withData.slice(-3);
    const avgRecent = last3.reduce((s, m) => s + m.actual, 0) / last3.length;
    if (avgRecent === 0) return null;
    const predicted = forecast[0]?.forecast || 0;
    return Math.round(((predicted - avgRecent) / avgRecent) * 100);
  }, [analytics]);

  // ── Alerts from context ──
  const displayAlerts = useMemo(() => {
    if (!alerts || !alerts.length) return [];
    return alerts.slice(0, 3);
  }, [alerts]);

  return (
    <div className="relative space-y-5">

      {/* ── KPI Row ── */}
      <section
        className="glass-card grid gap-0 overflow-hidden"
        style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}
      >
        <MetricItem
          title="Total TB Cases"
          value={totalCases}
          icon="ri-bar-chart-fill"
          color={monthlyChangePct > 0 ? '#EF4444' : monthlyChangePct < 0 ? '#10B981' : '#2E6FAF'}
          trend={monthlyChangePct !== null ? `${monthlyChangePct > 0 ? '+' : ''}${monthlyChangePct}% MoM` : 'No data'}
        />
        <MetricItem
          title="Active Cases"
          value={activeCases}
          icon="ri-time-line"
          color="#F59E0B"
          trend="Ongoing"
        />
        <MetricItem
          title="High-Risk Areas"
          value={highRiskAreas}
          icon="ri-alarm-warning-line"
          color="#EF4444"
          trend={highRiskAreas > 5 ? 'Critical' : 'Moderate'}
        />
        <MetricItem
          title="Success Rate"
          value={`${Math.round(successRate)}%`}
          icon="ri-checkbox-circle-line"
          color="#10B981"
          trend={successRate >= 85 ? 'Good' : 'Below WHO'}
        />
        <MetricItem
          title="Forecast"
          value={forecastData[0]?.predictedCases || 'N/A'}
          icon="ri-brain-line"
          color={forecastChangePct > 0 ? '#EF4444' : forecastChangePct < 0 ? '#10B981' : '#8B5CF6'}
          trend={forecastChangePct !== null ? `${forecastChangePct > 0 ? '+' : ''}${forecastChangePct}% vs avg` : forecastData[0]?.risk || ''}
        />
        <MetricItem
          title="Barangays"
          value={barangayCount}
          icon="ri-map-pin-line"
          color="#4FD1C5"
          trend="Active"
          isLast={true}
        />
      </section>

      {/* ── Row 1: Trend + Barangay + Outcomes ── */}
      <section className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
        {/* Monthly Trend + Forecast */}
        <VizCard title="Monthly TB Case Trends" icon="ri-line-chart-line">
          <div className="flex-1" style={{ minHeight: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={combinedChartData}>
                <defs>
                  <linearGradient id="tbGradient" x1="0" y1="0" x2="0" y2="1">
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
                  formatter={(val, name) => [val, name === 'actual' ? 'Actual Cases' : 'Forecast']}
                />
                <Area
                  type="monotone"
                  dataKey="actual"
                  fill="url(#tbGradient)"
                  fillOpacity={0.25}
                  stroke="#2E6FAF"
                  strokeWidth={3}
                  name="actual"
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="forecast"
                  stroke="#8B5CF6"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  name="forecast"
                  connectNulls={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-5 text-xs mt-1 pl-2 font-semibold" style={{ color: '#64748b' }}>
            <span className="flex items-center">
              <span className="w-3 h-0.5 bg-[#2E6FAF] inline-block mr-1.5" />
              Actual Cases
            </span>
            <span className="flex items-center">
              <span className="inline-block mr-1.5" style={{ width: 12, borderTop: '2px dashed #8B5CF6' }} />
              Forecast
            </span>
          </div>
        </VizCard>

        {/* Barangay Top 10 */}
        <VizCard title="Cases by Barangay (Top 10)" icon="ri-bar-chart-2-line">
          <div className="flex-1" style={{ minHeight: 260 }}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={barangayChartData} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={72} />
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="1" y2="0">
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
                <Bar dataKey="cases" fill="url(#barGradient)" radius={[12, 12, 12, 12]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </VizCard>

        {/* Treatment Outcomes Donut */}
        <VizCard title="Treatment Data Overview" icon="ri-pie-chart-2-line">
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="relative">
              <DonutChart segments={outcomeSegments} size={140} />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-2xl font-bold">{totalCases}</div>
                <div className="text-xs text-slate-500">Cases</div>
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

      {/* ── Row 2: GIS + Age + Gender ── */}
      <section className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
        {/* GIS Map */}
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
                          <div><strong>Male:</strong> {male} &middot; <strong>Female:</strong> {female}</div>
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>

            {/* Risk Matrix Legend */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 800 400"
              preserveAspectRatio="xMidYMid slice"
            >
              <rect width="100%" height="100%" fill="transparent" />
              <path d="M 250 80 L 410 60 L 490 140 L 380 220 L 220 160 Z" fill="#EF4444" fillOpacity="0.15" stroke="#EF4444" strokeWidth="2" />
              <path d="M 410 60 L 600 90 L 680 230 L 490 280 L 490 140 Z" fill="#2E6FAF" fillOpacity="0.15" stroke="#4FD1C5" strokeWidth="2" />
              <path d="M 110 180 L 220 160 L 380 220 L 320 340 L 150 290 Z" fill="#6EE7B7" fillOpacity="0.15" stroke="#6EE7B7" strokeWidth="2" />
              <g transform="translate(350,140)">
                <circle cx="0" cy="0" r="20" fill="#EF4444" opacity="0.15" />
                <circle cx="0" cy="0" r="10" fill="#EF4444" style={{ filter: 'drop-shadow(0 0 12px rgba(239,68,68,.8))' }} />
                <circle cx="0" cy="0" r="4" fill="#ffffff" />
              </g>
              <g transform="translate(580,200)">
                <circle cx="0" cy="0" r="18" fill="#4FD1C5" opacity="0.15" />
                <circle cx="0" cy="0" r="10" fill="#4FD1C5" style={{ filter: 'drop-shadow(0 0 10px rgba(79,209,197,.8))' }} />
                <circle cx="0" cy="0" r="4" fill="#ffffff" />
              </g>
              <g transform="translate(240,240)">
                <circle cx="0" cy="0" r="18" fill="#6EE7B7" opacity="0.15" />
                <circle cx="0" cy="0" r="10" fill="#6EE7B7" style={{ filter: 'drop-shadow(0 0 10px rgba(110,231,183,.8))' }} />
                <circle cx="0" cy="0" r="4" fill="#ffffff" />
              </g>
              <text x="275" y="106" fill="#ffffff" fontSize="12" fontWeight="700">SAN JOAQUIN</text>
              <text x="275" y="122" fill="#FCA5A5" fontSize="10" fontWeight="700">142 Cases (High Cluster)</text>
              <text x="500" y="120" fill="#E2E8F0" fontSize="12" fontWeight="700">PINAGBUHATAN</text>
              <text x="160" y="218" fill="#E2E8F0" fontSize="12" fontWeight="700">KAPASIGAN</text>
            </svg>

            {showRiskMatrix && (
              <div className="glass-card absolute bottom-4 left-4 z-[1000] p-4" style={{ width: 230 }}>
                <div className="font-bold uppercase tracking-wider mb-3" style={{ color: '#64748B', fontSize: 10 }}>
                  Risk Matrix
                </div>
                {[
                  { color: '#EF4444', label: 'Severe Hotspot (>100 cases)' },
                  { color: '#F59E0B', label: 'Moderate Risk (50-100)' },
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

        {/* Age Distribution */}
        <VizCard title="Age Distribution" icon="ri-user-line">
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <DonutChart segments={ageSegments} size={130} />
            <div className="flex justify-around w-full text-xs font-bold" style={{ color: '#475569' }}>
              {ageSegments.map(s => (
                <span key={s.label}>
                  <i className="ri-circle-fill mr-1" style={{ color: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
          </div>
        </VizCard>

        {/* Gender Balance */}
        <VizCard title="Gender Balance" icon="ri-group-line">
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <DonutChart segments={genderSegments} size={130} />
            <div className="flex justify-around w-full text-xs font-bold" style={{ color: '#475569' }}>
              {genderSegments.map(s => (
                <span key={s.label}>
                  <i className={s.label === 'Male' ? 'ri-men-line mr-1' : 'ri-women-line mr-1'} style={{ color: s.color }} />
                  {s.label} ({s.pct}%)
                </span>
              ))}
            </div>
          </div>
        </VizCard>
      </section>

      {/* ── Row 3: Alerts + Forecast ── */}
      <section className="grid gap-5 pb-4" style={{ gridTemplateColumns: '2fr 1fr' }}>
        {/* Alerts */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm font-bold" style={{ color: '#0F172A' }}>
              <i className="ri-alarm-warning-line text-lg" style={{ color: '#EF4444' }} />
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
            {displayAlerts.length === 0 ? (
              <div className="text-center py-8 text-sm" style={{ color: '#94A3B8' }}>
                No alerts at this time
              </div>
            ) : (
              displayAlerts.map((a) => {
                const isDanger = a.type === 'High' || a.type === 'danger';
                return (
                  <div
                    key={a.id || a.title}
                    className="flex gap-3 rounded-2xl p-4 transition-all hover:-translate-y-1"
                    style={{
                      background: isDanger ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                      border: isDanger ? '1px solid rgba(239,68,68,0.20)' : '1px solid rgba(245,158,11,0.20)'
                    }}
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background: isDanger ? 'rgba(239,68,68,.15)' : 'rgba(245,158,11,.15)'
                      }}
                    >
                      <i
                        className={`${a.icon || (isDanger ? 'ri-alarm-warning-line' : 'ri-error-warning-line')} text-lg`}
                        style={{ color: isDanger ? '#EF4444' : '#F59E0B' }}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-bold" style={{ color: '#0F172A' }}>{a.title}</div>
                      <div className="text-xs mt-1" style={{ color: '#64748B' }}>{a.desc}</div>
                      <div className="text-[11px] font-semibold mt-2" style={{ color: '#94A3B8' }}>
                        {a.time || a.timestamp}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Forecast Table */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm font-bold" style={{ color: '#0F172A' }}>
              <i className="ri-brain-line text-lg" style={{ color: '#2E6FAF' }} />
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
                {['Barangay', 'Forecast', 'Risk'].map((h) => (
                  <th
                    key={h}
                    className="pb-3 text-left text-[10px] uppercase tracking-[2px]"
                    style={{ color: '#64748B', borderBottom: '1px solid rgba(148,163,184,.15)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {forecastTable.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-sm" style={{ color: '#94A3B8' }}>
                    No forecast data available
                  </td>
                </tr>
              ) : (
                forecastTable.map((row) => (
                  <tr key={row.period}>
                    <td className="py-4 text-xs font-semibold" style={{ color: '#475569' }}>{row.period}</td>
                    <td className="py-4 text-lg font-bold" style={{ color: '#0F172A' }}>{row.val}</td>
                    <td className="py-4">
                      <span
                        className="px-2 py-1 rounded-full text-xs font-bold"
                        style={{
                          background: row.pct === 'High' ? 'rgba(239,68,68,.12)' : row.pct === 'Moderate' ? 'rgba(245,158,11,.12)' : 'rgba(16,185,129,.12)',
                          color: row.pct === 'High' ? '#EF4444' : row.pct === 'Moderate' ? '#F59E0B' : '#10B981'
                        }}
                      >
                        {row.pct}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(148,163,184,.15)' }}>
            <div className="text-xs" style={{ color: '#64748B' }}>
              Forecast data based on historical case trends across Pasig City barangays.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
