import React, { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area,
} from 'recharts';

/* ─── Mock data ─── */
const trendData = [
  { label: 'Jan 22', actual: 68 }, { label: 'Mar 22', actual: 54 },
  { label: 'May 22', actual: 72 }, { label: 'Jul 22', actual: 60 },
  { label: 'Sep 22', actual: 80 }, { label: 'Nov 22', actual: 70 },
  { label: 'Jan 23', actual: 85 }, { label: 'Mar 23', actual: 64 },
  { label: 'May 23', actual: 90 }, { label: 'Jul 23', actual: 74 },
  { label: 'Sep 23', actual: 88 }, { label: 'Nov 23', actual: 78 },
  { label: 'Jan 24', actual: 95 }, { label: 'Mar 24', actual: 82 },
  { label: 'May 24', actual: 86 }, { label: 'Jul 24', actual: 79 },
  { label: 'Sep 24', actual: 92 }, { label: 'Nov 24', actual: 84 },
  { label: 'Jan 25', actual: 88 }, { label: 'Mar 25', actual: 91 },
  { label: 'May 25', actual: 88 },
  { label: 'Jul 25', forecast: 95 }, { label: 'Aug 25', forecast: 100 },
];

const barangayData = [
  { name: 'Rosario', cases: 89 },
  { name: 'Dela Paz', cases: 82 },
  { name: 'Santol', cases: 75 },
  { name: 'San Joaquin', cases: 74 },
  { name: 'Caniogan', cases: 70 },
  { name: 'Kapasigan', cases: 65 },
  { name: 'Bambang', cases: 62 },
  { name: 'Bagong Ilog', cases: 58 },
  { name: 'Manggahan', cases: 54 },
  { name: 'Pinagbuhatan', cases: 48 },
];

const chartTooltipStyle = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  color: '#0f172a',
  fontSize: '12px',
  boxShadow: '0 4px 12px rgba(0, 102, 255, 0.08)',
};

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
  return (
    <svg width={size} height={size} viewBox="0 0 42 42">
      {segments.map((s, i) => (
        <circle key={i} cx="21" cy="21" r={r} fill="transparent"
          stroke={s.color} strokeWidth={s.w || 8}
          strokeDasharray={`${s.pct} ${100 - s.pct}`}
          strokeDashoffset={-s.offset} />
      ))}
    </svg>
  );
}

/* ─── Page Component ─── */
export default function Dashboard() {
  // Balanced neon digital healthcare pops overlaying white surfaces
  const outcomeSegments = [
    { color: '#0066FF', pct: 35, offset: 0 },   // Neon Dark Blue
    { color: '#00D8F6', pct: 12, offset: 35 },  // Neon Cyan
    { color: '#ff0055', pct: 18, offset: 47 },  // Medical Alert Magenta
    { color: '#7c3aed', pct: 15, offset: 65 },  // Tech Purple
    { color: '#f59e0b', pct: 13, offset: 80 },  // Safety Amber
    { color: '#cbd5e1', pct: 7, offset: 93 },   // Muted Gray
  ];

  const ageSegments = [
    { color: '#4FD1C5', pct: 25, offset: 0, w: 6 },
    { color: '#EF4444', pct: 55, offset: -25, w: 6 },
    { color: '#2E6FAF', pct: 20, offset: -80, w: 6 },
  ];

  const genderSegments = [
    { color: '#2E6FAF', pct: 58, offset: 0, w: 10 },
    { color: '#4FD1C5', pct: 42, offset: -58, w: 10 },
  ];

  const [showRiskMatrix, setShowRiskMatrix] = useState(false);

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
          value="320"
          icon="ri-bar-chart-fill"
          color="#2E6FAF"
          trend="+12%"
        />

        <MetricItem
          title="Active Cases"
          value="103"
          icon="ri-time-line"
          color="#F59E0B"
          trend="Ongoing"
        />

        <MetricItem
          title="High-Risk Areas"
          value="14"
          icon="ri-alarm-warning-line"
          color="#EF4444"
          trend="Critical"
        />

        <MetricItem
          title="Success Rate"
          value="32%"
          icon="ri-checkbox-circle-line"
          color="#10B981"
          trend="Below WHO"
        />

        <MetricItem
          title="Forecast"
          value="74"
          icon="ri-brain-line"
          color="#8B5CF6"
          trend="+8.8%"
        />

        <MetricItem
          title="Last Sync"
          value="08:42"
          icon="ri-refresh-line"
          color="#4FD1C5"
          trend="Updated"
          isLast={true}
        />

      </section>

      {/* ── Row 1: Line Chart + Bar Chart + Treatment Outcomes ── */}
      <section className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
        <VizCard title="Monthly TB Case Trends — 2022–2025 with Forecast" icon="ri-line-chart-line">
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

                <XAxis dataKey="label" />
                <YAxis />

                <Tooltip />

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
                <RTooltip contentStyle={chartTooltipStyle} itemStyle={{ color: '#0f172a' }} cursor={{ fill: '#f8fafc' }} />
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

                <Bar
                  dataKey="cases"
                  fill="url(#barGradient)"
                  radius={[12, 12, 12, 12]}
                  barSize={16}
                />              </BarChart>
            </ResponsiveContainer>
          </div>
        </VizCard>

        <VizCard title="Treatment Outcomes" icon="ri-pie-chart-2-line">
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="relative">
              <DonutChart
                segments={outcomeSegments}
                size={140}
              />

              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-2xl font-bold">
                  320
                </div>
                <div className="text-xs text-slate-500">
                  Cases
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-4 w-full px-1">
              {[
                { color: '#0066FF', label: 'Completed' },
                { color: '#00D8F6', label: 'Died' },
                { color: '#ff0055', label: 'Not Evaluated' },
                { color: '#7c3aed', label: 'Lost / Defaulted' },
                { color: '#f59e0b', label: 'Cured' },
                { color: '#cbd5e1', label: 'Failed' },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: '#475569' }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: l.color }} />
                  {l.label}
                </div>
              ))}
            </div>
          </div>
        </VizCard>
      </section>

      {/* ── Row 2: GIS Map + Age + Gender ── */}
      {/* ── Row 2: GIS Map + Age + Gender ── */}
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
              onClick={() => setShowRiskMatrix(v => !v)}
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
            style={{
              minHeight: 260,
              border: '1px solid rgba(255,255,255,0.15)',
              background:
                'linear-gradient(135deg, #0F2D52 0%, #174A7E 100%)'
            }}
          >
            <svg
              className="w-full h-full absolute inset-0"
              viewBox="0 0 1000 380"
              preserveAspectRatio="xMidYMid meet"
            >
              <rect width="100%" height="100%" fill="transparent" />

              {/* Severe */}
              <path
                d="M 250 80 L 410 60 L 490 140 L 380 220 L 220 160 Z"
                fill="#EF4444"
                fillOpacity="0.15"
                stroke="#EF4444"
                strokeWidth="2"
              />

              {/* Moderate */}
              <path
                d="M 410 60 L 600 90 L 680 230 L 490 280 L 490 140 Z"
                fill="#2E6FAF"
                fillOpacity="0.15"
                stroke="#4FD1C5"
                strokeWidth="2"
              />

              {/* Low */}
              <path
                d="M 110 180 L 220 160 L 380 220 L 320 340 L 150 290 Z"
                fill="#6EE7B7"
                fillOpacity="0.15"
                stroke="#6EE7B7"
                strokeWidth="2"
              />

              {/* Severe Hotspot */}
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

              {/* Moderate Hotspot */}
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

              {/* Low Hotspot */}
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

            {/* Risk Matrix Legend — toggles on button click */}
            {showRiskMatrix && (
              <div
                className="glass-card absolute bottom-4 left-4 z-10 p-4"
                style={{ width: 230 }}
              >
                <div
                  className="font-bold uppercase tracking-wider mb-3"
                  style={{ color: '#64748B', fontSize: 10 }}
                >
                  Risk Matrix
                </div>

                {[
                  { color: '#EF4444', label: 'Severe Hotspot (>100 cases)' },
                  { color: '#2E6FAF', label: 'Moderate Risk (50–100)' },
                  { color: '#6EE7B7', label: 'Low Risk Alert (<50)' }
                ].map((m) => (
                  <div key={m.label} className="flex items-center gap-2 mb-2 last:mb-0">
                    <span className="w-3 h-3 rounded-full" style={{ background: m.color }} />
                    <span className="text-xs font-medium" style={{ color: '#475569' }}>
                      {m.label}
                    </span>
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
              <span>
                <i
                  className="ri-circle-fill mr-1"
                  style={{ color: '#4FD1C5' }}
                />
                0–14
              </span>

              <span>
                <i
                  className="ri-circle-fill mr-1"
                  style={{ color: '#EF4444' }}
                />
                15–64
              </span>

              <span>
                <i
                  className="ri-circle-fill mr-1"
                  style={{ color: '#2E6FAF' }}
                />
                65+
              </span>
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
              <span>
                <i
                  className="ri-men-line mr-1"
                  style={{ color: '#2E6FAF' }}
                />
                Male (58%)
              </span>

              <span>
                <i
                  className="ri-women-line mr-1"
                  style={{ color: '#4FD1C5' }}
                />
                Female (42%)
              </span>
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
              className="text-xs font-bold hover:underline transition"
              style={{ color: '#2E6FAF' }}
            >
              View All
            </button>
          </div>

          <div className="space-y-3">

            {[
              {
                type: 'danger',
                icon: 'ri-alarm-warning-line',
                title: 'Manggahan — Critical Case Surge',
                desc: 'Cases increased 34% in the past 30 days. Immediate intervention required.',
                time: '2 hours ago'
              },
              {
                type: 'warning',
                icon: 'ri-error-warning-line',
                title: 'Dela Paz — Low Success Rate',
                desc: 'Treatment success rate dropped to 58%. Below WHO threshold.',
                time: '6 hours ago'
              },
              {
                type: 'warning',
                icon: 'ri-error-warning-line',
                title: 'Dela Paz — Supply Critical',
                desc: 'Medicine stock below 15%. Immediate resupply needed.',
                time: '10 hours ago'
              }
            ].map((a) => {

              const isDanger = a.type === 'danger';

              return (
                <div
                  key={a.title}
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
              className="text-xs font-bold hover:underline"
              style={{ color: '#2E6FAF' }}
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

              {[
                {
                  period: 'Next Month',
                  val: '74',
                  pct: '+8.8%'
                },
                {
                  period: '3 Months',
                  val: '223',
                  pct: '+10.2%'
                },
                {
                  period: '6 Months',
                  val: '461',
                  pct: '+12.1%'
                }
              ].map((row) => (

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