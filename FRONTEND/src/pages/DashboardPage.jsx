import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import React, { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area,
} from 'recharts';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useTBData } from '../context/TBDataContext';
import API from '../api/axios';

/* ─── Helpers ─── */
const COLORS = {
  blue: '#2E6FAF',
  cyan: '#4FD1C5',
  red: '#EF4444',
  green: '#10B981',
  purple: '#7c3aed',
  amber: '#F59E0B',
  gray: '#94A3B8',
  pink: '#ff0055',
  darkBlue: '#0066FF',
};

const OUTCOME_COLORS = {
  'ON TREATMENT': COLORS.amber,
  'TREATMENT COMPLETED': COLORS.darkBlue,
  'CURED': COLORS.green,
  'DIED': COLORS.red,
  'LOST TO FOLLOW-UP': COLORS.purple,
  'EXCLUDED': COLORS.gray,
};

const AGE_COLORS = {
  '0-14': COLORS.cyan,
  '15-24': COLORS.blue,
  '25-34': COLORS.red,
  '35-44': COLORS.purple,
  '45-54': COLORS.green,
  '55-64': COLORS.amber,
  '65+': COLORS.gray,
};

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Data states
  const [summary, setSummary] = useState(null);
  const [monthlyData, setMonthlyData] = useState([]);
  const [outcomesData, setOutcomesData] = useState([]);
  const [demographicsData, setDemographicsData] = useState([]);
  const [alertsData, setAlertsData] = useState([]);
  const [forecastsData, setForecastsData] = useState([]);

  const [showRiskMatrix, setShowRiskMatrix] = useState(false);

  // Fetch all dashboard data
  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [summaryRes, monthlyRes, outcomesRes, demographicsRes, alertsRes, forecastsRes] = await Promise.all([
          API.get('/api/tb/dashboard/summary'),
          API.get('/api/tb/dashboard/monthly'),
          API.get('/api/tb/dashboard/outcomes'),
          API.get('/api/tb/dashboard/demographics'),
          API.get('/api/tb/alerts'),
          API.get('/api/tb/forecasts'),
        ]);

        setSummary(summaryRes.data.summary);
        setMonthlyData(monthlyRes.data.monthly || []);
        setOutcomesData(outcomesRes.data.outcomes || []);
        setDemographicsData(demographicsRes.data.demographics || []);
        setAlertsData(alertsRes.data.alerts || []);
        setForecastsData(forecastsRes.data.forecasts || []);
      } catch (err) {
        console.error('Dashboard fetch error:', err);
        setError('Failed to load dashboard data. Make sure the backend is running.');
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  // Process monthly trend data
  const trendChartData = useMemo(() => {
    if (!monthlyData.length) return [];

    // Aggregate across all barangays per month
    const byMonth = {};
    monthlyData.forEach(r => {
      if (!byMonth[r.month]) byMonth[r.month] = 0;
      byMonth[r.month] += r.case_count;
    });

    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, cases]) => {
        const d = new Date(month);
        const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        return { label, actual: cases, month };
      });
  }, [monthlyData]);

  // Process barangay case totals (top 10)
  const barangayChartData = useMemo(() => {
    if (!monthlyData.length) return [];

    const byBarangay = {};
    monthlyData.forEach(r => {
      if (!byBarangay[r.barangay_name]) byBarangay[r.barangay_name] = 0;
      byBarangay[r.barangay_name] += r.case_count;
    });

    return Object.entries(byBarangay)
      .map(([name, cases]) => ({ name, cases }))
      .sort((a, b) => b.cases - a.cases)
      .slice(0, 10);
  }, [monthlyData]);

  // Process outcome segments
  const outcomeSegments = useMemo(() => {
    if (!outcomesData.length) return [];

    const byStatus = {};
    outcomesData.forEach(r => {
      const status = r.outcome_status || 'Unknown';
      byStatus[status] = (byStatus[status] || 0) + Number(r.total);
    });

    const total = Object.values(byStatus).reduce((s, v) => s + v, 0);
    let offset = 0;

    return Object.entries(byStatus)
      .sort(([, a], [, b]) => b - a)
      .map(([status, count]) => {
        const pct = Math.round((count / total) * 100);
        const seg = {
          color: OUTCOME_COLORS[status] || COLORS.gray,
          pct,
          offset,
          label: status,
        };
        offset += pct;
        return seg;
      });
  }, [outcomesData]);

  // Process age segments
  const ageSegments = useMemo(() => {
    if (!demographicsData.length) return [];

    const byAge = {};
    demographicsData.forEach(r => {
      const group = r.age_group || 'Unknown';
      byAge[group] = (byAge[group] || 0) + Number(r.total);
    });

    const total = Object.values(byAge).reduce((s, v) => s + v, 0);
    let offset = 0;

    // Sort: 0-14, 15-24, 25-34, 35-44, 45-54, 55-64, 65+
    const ageOrder = ['0-14', '15-24', '25-34', '35-44', '45-54', '55-64', '65+'];
    return ageOrder
      .filter(g => byAge[g])
      .map(group => {
        const pct = Math.round((byAge[group] / total) * 100);
        const seg = {
          color: AGE_COLORS[group] || COLORS.gray,
          pct,
          offset,
          w: 6,
          label: `${group} yrs`,
        };
        offset += pct;
        return seg;
      });
  }, [demographicsData]);

  // Process gender segments
  const genderSegments = useMemo(() => {
    if (!demographicsData.length) return [];

    const bySex = {};
    demographicsData.forEach(r => {
      const sex = r.sex || 'Unknown';
      bySex[sex] = (bySex[sex] || 0) + Number(r.total);
    });

    const total = Object.values(bySex).reduce((s, v) => s + v, 0);
    let offset = 0;

    return Object.entries(bySex)
      .sort(([, a], [, b]) => b - a)
      .map(([sex, count]) => {
        const pct = Math.round((count / total) * 100);
        const seg = {
          color: sex === 'Male' ? COLORS.blue : COLORS.cyan,
          pct,
          offset,
          w: 10,
          label: sex,
        };
        offset += pct;
        return seg;
      });
  }, [demographicsData]);

  // Process alerts for display
  const displayAlerts = useMemo(() => {
    return alertsData.slice(0, 3).map(a => ({
      type: a.severity === 'High' ? 'danger' : 'warning',
      icon: a.severity === 'High' ? 'ri-alarm-warning-line' : 'ri-error-warning-line',
      title: `${a.barangay_name} — ${a.alert_type}`,
      desc: a.message,
      time: a.created_at ? new Date(a.created_at).toLocaleString() : 'N/A',
    }));
  }, [alertsData]);

  // Process forecasts for table
  const forecastTable = useMemo(() => {
    if (!forecastsData.length) return [];

    // Get the latest period's forecasts, aggregate by barangay
    const latestPeriod = forecastsData.reduce((max, r) =>
      r.period > max ? r.period : max, '');

    if (!latestPeriod) return [];

    return forecastsData
      .filter(r => r.period === latestPeriod)
      .sort((a, b) => b.forecasted_count - a.forecasted_count)
      .slice(0, 5)
      .map(r => ({
        period: r.barangay_name,
        val: Math.round(r.forecasted_count),
        pct: r.incidence_per_100k ? `${Number(r.incidence_per_100k).toFixed(1)}/100k` : 'N/A',
      }));
  }, [forecastsData]);

  // Compute active cases (ON TREATMENT outcome)
  const activeCases = useMemo(() => {
    return outcomesData
      .filter(r => r.outcome_status === 'ON TREATMENT')
      .reduce((s, r) => s + Number(r.total), 0);
  }, [outcomesData]);

  // Compute high-risk count (barangays with >200 cases)
  const highRiskCount = useMemo(() => {
    const byBarangay = {};
    monthlyData.forEach(r => {
      if (!byBarangay[r.barangay_name]) byBarangay[r.barangay_name] = 0;
      byBarangay[r.barangay_name] += r.case_count;
    });
    return Object.values(byBarangay).filter(c => c > 200).length;
  }, [monthlyData]);

  // Compute success rate (CURED + TREATMENT COMPLETED / total)
  const successRate = useMemo(() => {
    const byStatus = {};
    outcomesData.forEach(r => {
      const status = r.outcome_status || 'Unknown';
      byStatus[status] = (byStatus[status] || 0) + Number(r.total);
    });
    const total = Object.values(byStatus).reduce((s, v) => s + v, 0);
    if (total === 0) return '0%';
    const success = (byStatus['CURED'] || 0) + (byStatus['TREATMENT COMPLETED'] || 0);
    return `${Math.round((success / total) * 100)}%`;
  }, [outcomesData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <i className="ri-loader-4-line animate-spin text-3xl" style={{ color: '#2E6FAF' }} />
          <p className="mt-2 text-sm" style={{ color: '#64748b' }}>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center glass-card p-8">
          <i className="ri-error-warning-line text-3xl" style={{ color: '#EF4444' }} />
          <p className="mt-2 text-sm" style={{ color: '#EF4444' }}>{error}</p>
        </div>
      </div>
    );
  }

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
          value={summary?.total_cases || 0}
          icon="ri-bar-chart-fill"
          color="#2E6FAF"
          trend={`${summary?.months_covered || 0} months`}
        />

        <MetricItem
          title="Active Cases"
          value={analytics.activeCases ?? '—'}
          value={activeCases}
          icon="ri-time-line"
          color="#F59E0B"
          trend="Ongoing"
        />

        <MetricItem
          title="High-Risk Areas"
          value={analytics.highRiskAreas ?? '—'}
          value={highRiskCount}
          icon="ri-alarm-warning-line"
          color="#EF4444"
          trend={highRiskCount > 5 ? 'Critical' : 'Moderate'}
        />

        <MetricItem
          title="Success Rate"
          value={analytics.successRate != null ? `${Math.round(analytics.successRate)}%` : '—'}
          value={successRate}
          icon="ri-checkbox-circle-line"
          color="#10B981"
          trend={parseInt(successRate) >= 85 ? 'Good' : 'Below WHO'}
        />

        <MetricItem
          title="Forecast"
          value={analytics.forecastNextMonth ?? '—'}
          value={forecastTable[0]?.val || 'N/A'}
          icon="ri-brain-line"
          color="#8B5CF6"
          trend={forecastTable[0]?.pct || ''}
        />

        <MetricItem
          title="Last Sync"
          value={analytics.lastSync ?? '—'}
          icon="ri-refresh-line"
          title="Barangays"
          value={summary?.barangays_with_cases || 0}
          icon="ri-map-pin-line"
          color="#4FD1C5"
          trend="Active"
          isLast={true}
        />

      </section>

      {/* ── Row 1: Line Chart + Bar Chart + Treatment Outcomes ── */}
      <section className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
        <VizCard title="Monthly TB Case Trends" icon="ri-line-chart-line">
          <div className="flex-1" style={{ minHeight: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendChartData}>

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

              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-5 text-xs mt-1 pl-2 font-semibold" style={{ color: '#64748b' }}>
            <span className="flex items-center"><span className="w-3 h-0.5 bg-[#0066FF] inline-block mr-1.5" />Actual Cases</span>
          </div>
        </VizCard>

        <VizCard title="Cases by Barangay (Top 10)" icon="ri-bar-chart-2-line">
          <div className="flex-1" style={{ minHeight: 260 }}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={barangayChartData} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
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
                  {summary?.total_cases || 0}
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
              <rect width="100%" height="100%" fill="transparent" />

              <path
                d="M 250 80 L 410 60 L 490 140 L 380 220 L 220 160 Z"
                fill="#EF4444"
                fillOpacity="0.15"
                stroke="#EF4444"
                strokeWidth="2"
              />

              <path
                d="M 410 60 L 600 90 L 680 230 L 490 280 L 490 140 Z"
                fill="#2E6FAF"
                fillOpacity="0.15"
                stroke="#4FD1C5"
                strokeWidth="2"
              />

              <path
                d="M 110 180 L 220 160 L 380 220 L 320 340 L 150 290 Z"
                fill="#6EE7B7"
                fillOpacity="0.15"
                stroke="#6EE7B7"
                strokeWidth="2"
              />

              <g transform="translate(350,140)">
                <circle cx="0" cy="0" r="20" fill="#EF4444" opacity="0.15" />
                <circle
                  cx="0"
                  cy="0"
                  r="10"
                  fill="#EF4444"
                  style={{
                    filter:
                      'drop-shadow(0 0 12px rgba(239,68,68,.8))'
                  }}
                />
                <circle cx="0" cy="0" r="4" fill="#ffffff" />
              </g>

              <g transform="translate(580,200)">
                <circle cx="0" cy="0" r="18" fill="#4FD1C5" opacity="0.15" />
                <circle
                  cx="0"
                  cy="0"
                  r="10"
                  fill="#4FD1C5"
                  style={{
                    filter:
                      'drop-shadow(0 0 10px rgba(79,209,197,.8))'
                  }}
                />
                <circle cx="0" cy="0" r="4" fill="#ffffff" />
              </g>

              <g transform="translate(240,240)">
                <circle cx="0" cy="0" r="18" fill="#6EE7B7" opacity="0.15" />
                <circle
                  cx="0"
                  cy="0"
                  r="10"
                  fill="#6EE7B7"
                  style={{
                    filter:
                      'drop-shadow(0 0 10px rgba(110,231,183,.8))'
                  }}
                />
                <circle cx="0" cy="0" r="4" fill="#ffffff" />
              </g>

              <text
                x="275"
                y="106"
                fill="#ffffff"
                fontSize="12"
                fontWeight="700"
              >
                SAN JOAQUIN
              </text>

              <text
                x="275"
                y="122"
                fill="#FCA5A5"
                fontSize="10"
                fontWeight="700"
              >
                142 Cases (High Cluster)
              </text>

              <text
                x="500"
                y="120"
                fill="#E2E8F0"
                fontSize="12"
                fontWeight="700"
              >
                PINAGBUHATAN
              </text>

              <text
                x="160"
                y="218"
                fill="#E2E8F0"
                fontSize="12"
                fontWeight="700"
              >
                KAPASIGAN
              </text>
            </svg>

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
              {ageSegments.map(s => (
                <span key={s.label}>
                  <i
                    className="ri-circle-fill mr-1"
                    style={{ color: s.color }}
                  />
                  {s.label}
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
              {genderSegments.map(s => (
                <span key={s.label}>
                  <i
                    className={s.label === 'Male' ? 'ri-men-line mr-1' : 'ri-women-line mr-1'}
                    style={{ color: s.color }}
                  />
                  {s.label} ({s.pct}%)
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
            {displayAlerts.length === 0 ? (
              <div className="text-center py-8 text-sm" style={{ color: '#94A3B8' }}>
                No alerts at this time
              </div>
            ) : (
              displayAlerts.map((a) => {

                const isDanger = a.type === 'danger';

                return (
                  <div
                    key={a.title}
                    className="rounded-2xl p-4 transition-all hover:-translate-y-1"
                    style={{
                      background: isDanger
                        ? 'rgba(239,68,68,0.08)'
                        : 'rgba(245,158,11,0.08)',

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
                          className={`${a.icon} text-lg`}
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
                          {a.time}
                        </div>

                      <div
                        className="text-[11px] font-semibold mt-2"
                        style={{ color: '#94A3B8' }}
                      >
                        {a.timestamp}
                      </div>

                    </div>

                  </div>
                );
              })
            )}
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
                {['Barangay', 'Forecast', 'Rate'].map((h) => (
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
              {forecastTable.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-sm" style={{ color: '#94A3B8' }}>
                    No forecast data available
                  </td>
                </tr>
              ) : (
                forecastTable.map((row) => (

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
                        {row.pct}
                      </span>

                    </td>

                  </tr>

                ))
              )}

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
              Forecast data based on historical case trends across Pasig City barangays.
            </div>
          </div>

        </div>

      </section>

    </div>
  );
}
