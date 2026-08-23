import { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import API from '../api/axios';
import { useTheme } from '../theme';

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

const OUTCOME_COLORS = {
  'ON TREATMENT': COLORS.amber,
  'TREATMENT COMPLETED': COLORS.darkBlue,
  CURED: COLORS.green,
  DIED: COLORS.red,
  'LOST TO FOLLOW-UP': COLORS.purple,
  EXCLUDED: COLORS.gray,
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

const BAC_COLORS = [COLORS.blue, COLORS.green, COLORS.amber, COLORS.purple, COLORS.red, COLORS.gray];

const chartTooltipStyle = (t) => ({
  backgroundColor: t.cardSolid,
  border: `1px solid ${t.borderStrong}`,
  borderRadius: '8px',
  color: t.text,
  fontSize: '12px',
  boxShadow: '0 4px 12px rgba(0, 102, 255, 0.08)',
});

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
  const { t } = useTheme();
  const r = 15.91549430918954;
  const [tooltip, setTooltip] = useState(null);

  return (
    <div className="relative inline-block">
      <svg width={size} height={size} viewBox="0 0 42 42">
        {segments.map((s, i) => (
          <circle
            key={i}
            cx="21"
            cy="21"
            r={r}
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
              setTooltip(t => (t ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : null));
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
            background: t.cardSolid,
            border: `1px solid ${tooltip.color}`,
            color: t.text,
            boxShadow: `0 4px 12px rgba(0,0,0,0.1), 0 0 0 1px ${tooltip.color}22`,
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: tooltip.color }}>●</span>&nbsp;
          {tooltip.label} — <strong>{tooltip.pct}%</strong>
        </div>
      )}
    </div>
  );
}

export default function Analytics() {
  const { t } = useTheme();
  const [error, setError] = useState(null);
  const [monthlyData, setMonthlyData] = useState([]);
  const [demographicsData, setDemographicsData] = useState([]);
  const [outcomesData, setOutcomesData] = useState([]);
  const [bacteriologicalData, setBacteriologicalData] = useState([]);
  const [forecastsData, setForecastsData] = useState([]);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [monthlyRes, demographicsRes, outcomesRes, bacteriologicalRes, forecastsRes] = await Promise.all([
          API.get('/api/tb/dashboard/monthly'),
          API.get('/api/tb/dashboard/demographics'),
          API.get('/api/tb/dashboard/outcomes'),
          API.get('/api/tb/dashboard/bacteriological'),
          API.get('/api/tb/forecasts'),
        ]);
        setMonthlyData(monthlyRes.data.monthly || []);
        setDemographicsData(demographicsRes.data.demographics || []);
        setOutcomesData(outcomesRes.data.outcomes || []);
        setBacteriologicalData(bacteriologicalRes.data.bacteriological || []);
        setForecastsData(forecastsRes.data.forecasts || []);
      } catch (err) {
        console.error('Analytics fetch error:', err);
        setError('Failed to load analytics data. Make sure the backend is running.');
      }
    };
    fetchAll();
  }, []);

  const trendChartData = useMemo(() => {
    if (!monthlyData.length) return [];
    const byMonth = {};
    monthlyData.forEach(r => {
      byMonth[r.month] = (byMonth[r.month] || 0) + Number(r.case_count);
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, cases]) => {
        const d = new Date(month);
        const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        return { label, actual: cases, month };
      });
  }, [monthlyData]);

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
        const seg = { color: OUTCOME_COLORS[status] || COLORS.gray, pct, offset, label: status };
        offset += pct;
        return seg;
      });
  }, [outcomesData]);

  const ageSegments = useMemo(() => {
    if (!demographicsData.length) return [];
    const byAge = {};
    demographicsData.forEach(r => {
      const group = r.age_group || 'Unknown';
      byAge[group] = (byAge[group] || 0) + Number(r.total);
    });
    const total = Object.values(byAge).reduce((s, v) => s + v, 0);
    let offset = 0;
    const ageOrder = ['0-14', '15-24', '25-34', '35-44', '45-54', '55-64', '65+'];
    return ageOrder
      .filter(g => byAge[g])
      .map(group => {
        const pct = Math.round((byAge[group] / total) * 100);
        const seg = { color: AGE_COLORS[group] || COLORS.gray, pct, offset, w: 6, label: `${group} yrs` };
        offset += pct;
        return seg;
      });
  }, [demographicsData]);

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
        const seg = { color: sex === 'Male' ? COLORS.blue : COLORS.cyan, pct, offset, w: 10, label: sex };
        offset += pct;
        return seg;
      });
  }, [demographicsData]);

  const bacSegments = useMemo(() => {
    if (!bacteriologicalData.length) return [];
    const byStatus = {};
    bacteriologicalData.forEach(r => {
      const status = r.bacteriological_status || 'Unknown';
      byStatus[status] = (byStatus[status] || 0) + Number(r.total);
    });
    const total = Object.values(byStatus).reduce((s, v) => s + v, 0);
    let offset = 0;
    return Object.entries(byStatus)
      .sort(([, a], [, b]) => b - a)
      .map(([status, count], i) => {
        const pct = Math.round((count / total) * 100);
        const seg = { color: BAC_COLORS[i % BAC_COLORS.length], pct, offset, label: status };
        offset += pct;
        return seg;
      });
  }, [bacteriologicalData]);

  const forecastTable = useMemo(() => {
    if (!forecastsData.length) return [];
    const latestPeriod = forecastsData.reduce((max, r) => (r.period > max ? r.period : max), '');
    if (!latestPeriod) return [];
    return forecastsData
      .filter(r => r.period === latestPeriod)
      .sort((a, b) => Number(b.forecasted_count) - Number(a.forecasted_count))
      .slice(0, 5)
      .map(r => ({
        period: r.barangay_name,
        val: Math.round(Number(r.forecasted_count)),
        pct: r.incidence_per_100k ? `${Number(r.incidence_per_100k).toFixed(1)}/100k` : 'N/A',
      }));
  }, [forecastsData]);

  const topBarangays = useMemo(() => {
    if (!monthlyData.length) return [];
    const byBarangay = {};
    monthlyData.forEach(r => {
      byBarangay[r.barangay_name] = (byBarangay[r.barangay_name] || 0) + Number(r.case_count);
    });
    const list = Object.entries(byBarangay)
      .map(([name, cases]) => ({ name, cases }))
      .sort((a, b) => b.cases - a.cases)
      .slice(0, 6);
    const max = list[0]?.cases || 1;
    return list.map(b => ({ ...b, pct: Math.round((b.cases / max) * 100) }));
  }, [monthlyData]);

  const totalCases = useMemo(() => {
    return outcomesData.reduce((s, r) => s + Number(r.total), 0);
  }, [outcomesData]);

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

  const peakMonth = useMemo(() => {
    if (!trendChartData.length) return null;
    return trendChartData.reduce((max, r) => (r.actual > max.actual ? r : max));
  }, [trendChartData]);

  const highRiskCount = useMemo(() => {
    const byBarangay = {};
    monthlyData.forEach(r => {
      byBarangay[r.barangay_name] = (byBarangay[r.barangay_name] || 0) + Number(r.case_count);
    });
    return Object.values(byBarangay).filter(c => c > 200).length;
  }, [monthlyData]);

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

      <section className="grid gap-0" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <MetricItem
          title="Total TB Cases"
          value={totalCases}
          icon="ri-bar-chart-fill"
          color="#2E6FAF"
          trend="All time"
        />
        <MetricItem
          title="Peak Month"
          value={peakMonth?.label || 'N/A'}
          icon="ri-line-chart-line"
          color="#F59E0B"
          trend={peakMonth ? `${peakMonth.actual} cases` : ''}
        />
        <MetricItem
          title="Success Rate"
          value={successRate}
          icon="ri-checkbox-circle-line"
          color="#10B981"
          trend={parseInt(successRate) >= 85 ? 'Good' : 'Below WHO'}
        />
        <MetricItem
          title="High-Risk Areas"
          value={highRiskCount}
          icon="ri-alarm-warning-line"
          color="#EF4444"
          trend={highRiskCount > 5 ? 'Critical' : 'Moderate'}
          isLast={true}
        />
      </section>

      <section className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <VizCard title="Monthly TB Case Trends" icon="ri-line-chart-line">
          <div className="flex-1" style={{ minHeight: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendChartData}>
                <defs>
                  <linearGradient id="anaGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4FD1C5" />
                    <stop offset="95%" stopColor="#2E6FAF" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={t.chartGrid} />
                <XAxis dataKey="label" tick={{ fill: t.textSecondary, fontSize: 10 }} />
                <YAxis tick={{ fill: t.textSecondary, fontSize: 10 }} />
                <Tooltip
                  contentStyle={chartTooltipStyle(t)}
                  itemStyle={{ color: t.text }}
                  cursor={{ stroke: '#2E6FAF', strokeWidth: 1 }}
                />
                <Area
                  type="monotone"
                  dataKey="actual"
                  fill="url(#anaGradient)"
                  fillOpacity={0.25}
                  stroke="#2E6FAF"
                  strokeWidth={3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-5 text-xs mt-1 pl-2 font-semibold" style={{ color: t.textSecondary }}>
            <span className="flex items-center"><span className="w-3 h-0.5 bg-[#0066FF] inline-block mr-1.5" />Actual Cases</span>
          </div>
        </VizCard>

        <VizCard title="Treatment Outcome" icon="ri-pie-chart-2-line">
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
                <div key={s.label} className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: t.textSecondary }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                  {s.label}
                </div>
              ))}
            </div>
          </div>
        </VizCard>
      </section>

      <section className="grid gap-5" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <VizCard title="Age Distribution" icon="ri-user-line">
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <DonutChart segments={ageSegments} size={130} />
            <div className="flex justify-around w-full text-xs font-bold" style={{ color: t.textSecondary }}>
              {ageSegments.map(s => (
                <span key={s.label}>
                  <i className="ri-circle-fill mr-1" style={{ color: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
          </div>
        </VizCard>

        <VizCard title="Gender Balance" icon="ri-group-line">
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <DonutChart segments={genderSegments} size={130} />
            <div className="flex justify-around w-full text-xs font-bold" style={{ color: t.textSecondary }}>
              {genderSegments.map(s => (
                <span key={s.label}>
                  <i className={s.label === 'Male' ? 'ri-men-line mr-1' : 'ri-women-line mr-1'} style={{ color: s.color }} />
                  {s.label} ({s.pct}%)
                </span>
              ))}
            </div>
          </div>
        </VizCard>

        <VizCard title="Bacteriological Status" icon="ri-microscope-line">
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <DonutChart segments={bacSegments} size={130} />
            <div className="grid grid-cols-1 gap-y-1.5 w-full px-1">
              {bacSegments.map(s => (
                <div key={s.label} className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: t.textSecondary }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="truncate">{s.label}</span>
                  <span className="ml-auto">({s.pct}%)</span>
                </div>
              ))}
            </div>
          </div>
        </VizCard>
      </section>

      <section className="grid gap-5 pb-4" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm font-bold" style={{ color: t.text }}>
              <i className="ri-brain-line text-lg" style={{ color: '#2E6FAF' }} />
              Forecast Summary
            </div>
            <span className="text-xs font-bold" style={{ color: t.textMuted }}>Latest period</span>
          </div>

          <table className="w-full">
            <thead>
              <tr>
                {['Barangay', 'Forecast', 'Rate'].map((h) => (
                  <th
                    key={h}
                    className="pb-3 text-left text-[10px] uppercase tracking-[2px]"
                    style={{ color: t.textSecondary, borderBottom: '1px solid rgba(148,163,184,.15)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {forecastTable.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-sm" style={{ color: t.textMuted }}>
                    No forecast data available
                  </td>
                </tr>
              ) : (
                forecastTable.map((row) => (
                  <tr key={row.period}>
                    <td className="py-4 text-xs font-semibold" style={{ color: t.textSecondary }}>{row.period}</td>
                    <td className="py-4 text-lg font-bold" style={{ color: t.text }}>{row.val}</td>
                    <td className="py-4">
                      <span
                        className="px-2 py-1 rounded-full text-xs font-bold"
                        style={{ background: 'rgba(239,68,68,.12)', color: '#EF4444' }}
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
            <div className="text-xs" style={{ color: t.textSecondary }}>
              Forecast data based on historical case trends across Pasig City barangays.
            </div>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm font-bold" style={{ color: t.text }}>
              <i className="ri-bar-chart-2-line text-lg" style={{ color: '#2E6FAF' }} />
              Top Barangays
            </div>
            <span className="text-xs font-bold" style={{ color: t.textMuted }}>By case load</span>
          </div>

          <div className="space-y-3">
            {topBarangays.length === 0 ? (
              <div className="text-center py-8 text-sm" style={{ color: t.textMuted }}>
                No case data available
              </div>
            ) : (
              topBarangays.map(b => (
                <div key={b.name}>
                  <div className="flex items-center justify-between text-xs font-semibold mb-1">
                    <span style={{ color: t.textSecondary }}>{b.name}</span>
                    <span style={{ color: t.text }}>{b.cases}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(148,163,184,.15)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${b.pct}%`, background: 'linear-gradient(90deg, #4FD1C5, #2E6FAF)' }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

    </div>
  );
}
