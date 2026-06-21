import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer,
  BarChart, Bar,
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
  backgroundColor: '#050e16',
  border: '1px solid rgba(0,191,255,0.18)',
  borderRadius: '10px',
  color: '#eaf8ff',
  fontSize: '12px',
};

/* ─── Local sub-components ─── */
function MetricCard({ title, value, valueColor, icon, iconBg, iconColor, trend, trendColor, sub }) {
  return (
    <div className="px-4 py-4" style={{ borderLeft: '2px solid rgba(0,191,255,0.2)' }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#6f8a99' }}>
          {title}
        </span>
        <div className="w-7 h-7 flex items-center justify-center rounded-md text-sm" style={{ background: iconBg, color: iconColor }}>
          <i className={icon} />
        </div>
      </div>
      <div className="text-2xl font-semibold mb-1.5" style={{ color: valueColor || '#eaf8ff' }}>{value}</div>
      {trend && (
        <div className="text-[11px] flex items-center gap-1" style={{ color: trendColor || '#6f8a99' }}>
          {trend}
        </div>
      )}
      {sub && <div className="text-[10px] mt-0.5">{sub}</div>}
    </div>
  );
}

function VizCard({ title, icon, iconColor, children, style = {}, className = '' }) {
  return (
    <div className={`flex flex-col rounded-xl p-5 ${className}`}
      style={{ background: '#081018', border: '1px solid rgba(0,191,255,0.08)', boxShadow: '0 0 20px rgba(0,191,255,0.03)', ...style }}>
      <div className="flex items-center gap-2 text-sm font-semibold mb-4" style={{ color: '#eaf8ff' }}>
        <i className={icon} style={{ color: iconColor || '#00bfff' }} />
        <span>{title}</span>
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
  const outcomeSegments = [
    { color: '#00ff88', pct: 35, offset: 0 },
    { color: '#006655', pct: 12, offset: 35 },
    { color: '#ff4d4d', pct: 18, offset: 47 },
    { color: '#8b5cf6', pct: 15, offset: 65 },
    { color: '#ffd166', pct: 13, offset: 80 },
    { color: '#4a6070', pct: 7, offset: 93 },
  ];

  const ageSegments = [
    { color: '#00bfff', pct: 25, offset: 0, w: 6 },
    { color: '#ff4d4d', pct: 55, offset: -25, w: 6 },
    { color: '#ffd166', pct: 20, offset: -80, w: 6 },
  ];

  const genderSegments = [
    { color: '#00bfff', pct: 58, offset: 0, w: 10 },
    { color: '#4a90a4', pct: 42, offset: -58, w: 10 },
  ];

  return (
    <div className="space-y-5">


      {/* ── Metric Cards ── */}
      <section className="grid grid-cols-6 gap-4">
        <MetricCard title="Total TB Cases" value="320" icon="ri-bar-chart-fill"
          iconBg="rgba(59,130,246,0.1)" iconColor="#00bfff"
          trend={<><i className="ri-arrow-up-line" />&nbsp;12% vs 2024</>} trendColor="#ff4d4d" />
        <MetricCard title="Active Cases" value="103" valueColor="#ffd166" icon="ri-time-line"
          iconBg="rgba(245,158,11,0.1)" iconColor="#ffd166"
          trend="Ongoing treatment" trendColor="#6f8a99" />
        <MetricCard title="High-Risk Barangays" value="14" valueColor="#ff4d4d" icon="ri-alarm-warning-line"
          iconBg="rgba(239,68,68,0.1)" iconColor="#ff4d4d"
          trend="Immediate action needed" trendColor="#ff4d4d" />
        <MetricCard title="Treatment Success" value="32%" valueColor="#00ff88" icon="ri-checkbox-circle-line"
          iconBg="rgba(16,185,129,0.1)" iconColor="#00ff88"
          trend={<><i className="ri-alert-line" />&nbsp;Below WHO Target</>} trendColor="#ff4d4d" />
        <MetricCard title="Forecasted Next Month" value="74" icon="ri-brain-line"
          iconBg="rgba(139,92,246,0.1)" iconColor="#8b5cf6"
          trend="ARIMA prediction" trendColor="#00bfff"
          sub={<span style={{ color: '#ff4d4d', fontSize: 11 }}><i className="ri-arrow-up-line" /> +8.8% projected</span>} />
        <div className="px-4 py-4" style={{ borderLeft: '2px solid rgba(0,191,255,0.2)' }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#6f8a99' }}>Last Sync</span>
            <div className="w-7 h-7 flex items-center justify-center rounded-md text-sm" style={{ background: 'rgba(59,130,246,0.1)', color: '#00bfff' }}>
              <i className="ri-refresh-line" />
            </div>
          </div>
          <div className="text-xl font-semibold mb-1" style={{ color: '#eaf8ff' }}>Jun 15</div>
          <div className="text-[11px]" style={{ color: '#6f8a99' }}>08:42 AM — 47 records</div>
          <div className="text-[11px] mt-1" style={{ color: '#00ff88' }}><i className="ri-check-line" /> Sync Successful</div>
        </div>
      </section>

      {/* ── Row 1: Line Chart + Bar Chart + Treatment Outcomes ── */}
      <section className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
        <VizCard title="Monthly TB Case Trends — 2022–2025 with Forecast" icon="ri-line-chart-line" style={{ minHeight: 340 }}>
          <div className="flex-1" style={{ minHeight: 260 }}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trendData} margin={{ top: 8, right: 16, left: -20, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,191,255,0.06)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#6f8a99', fontSize: 9 }} tickLine={false} axisLine={false} interval={3} />
                <YAxis tick={{ fill: '#6f8a99', fontSize: 9 }} tickLine={false} axisLine={false} domain={[40, 110]} />
                <RTooltip contentStyle={chartTooltipStyle} itemStyle={{ color: '#eaf8ff' }} />
                <Line type="monotone" dataKey="actual" name="Actual Cases" stroke="#00bfff" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: '#00bfff' }} />
                <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#ffd166" strokeWidth={2.5} strokeDasharray="5 4" dot={false} activeDot={{ r: 5, fill: '#ffd166' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-5 text-xs mt-1 pl-2" style={{ color: '#6f8a99' }}>
            <span><svg width="20" height="6" style={{ verticalAlign: 'middle', marginRight: 5 }}><line x1="0" y1="3" x2="20" y2="3" stroke="#00bfff" strokeWidth="2.5" /></svg>Actual Cases</span>
            <span><svg width="20" height="6" style={{ verticalAlign: 'middle', marginRight: 5 }}><line x1="0" y1="3" x2="20" y2="3" stroke="#ffd166" strokeWidth="2.5" strokeDasharray="4,3" /></svg>Forecast</span>
          </div>
        </VizCard>

        <VizCard title="Cases by Barangay (Top 10)" icon="ri-bar-chart-2-line" style={{ minHeight: 340 }}>
          <div className="flex-1" style={{ minHeight: 260 }}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={barangayData} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,191,255,0.06)" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#6f8a99', fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fill: '#6f8a99', fontSize: 9 }} tickLine={false} axisLine={false} width={72} />
                <RTooltip contentStyle={chartTooltipStyle} itemStyle={{ color: '#eaf8ff' }} cursor={{ fill: 'rgba(0,191,255,0.04)' }} />
                <Bar dataKey="cases" name="Cases" fill="#ff4d4d" fillOpacity={0.82} radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </VizCard>

        <VizCard title="Treatment Outcomes" icon="ri-pie-chart-2-line" style={{ minHeight: 340 }}>
          <div className="flex-1 flex flex-col items-center justify-center">
            <DonutChart segments={outcomeSegments} size={150} />
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 w-full px-2">
              {[
                { color: '#00ff88', label: 'Completed' },
                { color: '#006655', label: 'Died' },
                { color: '#ff4d4d', label: 'Not Evaluated' },
                { color: '#8b5cf6', label: 'Lost / Defaulted' },
                { color: '#ffd166', label: 'Cured' },
                { color: '#4a6070', label: 'Failed' },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1.5 text-[10px]" style={{ color: '#9fb3c0' }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: l.color }} />
                  {l.label}
                </div>
              ))}
            </div>
          </div>
        </VizCard>
      </section>

      {/* ── Row 2: GIS Map + Age + Gender ── */}
      <section className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
        <VizCard title="Pasig City Vector Heatmap Grid" icon="ri-map-pin-user-line">
          <div className="flex-1 rounded-lg relative overflow-hidden"
            style={{ minHeight: 260, border: '1px dashed rgba(0,191,255,0.12)', backgroundImage: 'radial-gradient(rgba(0,191,255,0.10) 1px, transparent 0)', backgroundSize: '24px 24px' }}>
            <svg className="w-full h-full absolute inset-0" viewBox="0 0 1000 380" preserveAspectRatio="xMidYMid meet">
              <rect width="100%" height="100%" fill="transparent" />
              <path className="zone-severe" d="M 250 80 L 410 60 L 490 140 L 380 220 L 220 160 Z" />
              <path className="zone-moderate" d="M 410 60 L 600 90 L 680 230 L 490 280 L 490 140 Z" />
              <path className="zone-low" d="M 110 180 L 220 160 L 380 220 L 320 340 L 150 290 Z" />
              <g transform="translate(350,140)"><circle className="map-node-ring" cx="0" cy="0" r="12" /><circle className="map-node-dot" cx="0" cy="0" r="6" /></g>
              <g transform="translate(580,200)"><circle className="map-node-ring" cx="0" cy="0" r="12" /><circle className="map-node-dot" cx="0" cy="0" r="6" /></g>
              <g transform="translate(240,240)"><circle className="map-node-ring" cx="0" cy="0" r="12" /><circle className="map-node-dot" cx="0" cy="0" r="6" /></g>
              <text className="zone-label-main" x="275" y="110">SAN JOAQUIN</text>
              <text className="zone-label-sub" x="275" y="124">142 Cases (High Cluster)</text>
              <text className="zone-label-main" x="500" y="120">PINAGBUHATAN</text>
              <text className="zone-label-main" x="160" y="218">KAPASIGAN</text>
            </svg>
            <div className="absolute bottom-3 left-3 rounded-lg p-3 text-xs z-10"
              style={{ background: '#050b11', border: '1px solid rgba(0,191,255,0.12)', boxShadow: '0 0 15px rgba(0,191,255,0.08)' }}>
              <div className="font-semibold uppercase tracking-wide mb-2" style={{ color: '#6f8a99', fontSize: 10 }}>Risk Matrix Index</div>
              {[{ color: '#ff4d4d', label: 'Severe Hotspot (>100 cases)' }, { color: '#ffd166', label: 'Moderate Risk (50–100)' }, { color: '#00bfff', label: 'Low Risk Alert (<50)' }]
                .map(m => (
                  <div key={m.label} className="flex items-center gap-2 mb-1" style={{ color: '#9fb3c0' }}>
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: m.color }} />{m.label}
                  </div>
                ))}
            </div>
          </div>
        </VizCard>

        <VizCard title="Age Distribution" icon="ri-user-line" className="items-center justify-center text-center">
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <DonutChart segments={ageSegments} size={140} />
            <div className="flex justify-around w-full text-xs" style={{ color: '#9fb3c0' }}>
              <span><i className="ri-circle-fill mr-1" style={{ color: '#00bfff' }} />0–14</span>
              <span><i className="ri-circle-fill mr-1" style={{ color: '#ff4d4d' }} />15–64</span>
              <span><i className="ri-circle-fill mr-1" style={{ color: '#ffd166' }} />65+</span>
            </div>
          </div>
        </VizCard>

        <VizCard title="Gender Balance" icon="ri-group-line" className="items-center justify-center text-center">
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <DonutChart segments={genderSegments} size={140} />
            <div className="flex justify-around w-full text-xs" style={{ color: '#9fb3c0' }}>
              <span><i className="ri-men-line mr-1" style={{ color: '#00bfff' }} />Male (58%)</span>
              <span><i className="ri-women-line mr-1" style={{ color: '#4a90a4' }} />Female (42%)</span>
            </div>
          </div>
        </VizCard>
      </section>

      {/* ── Row 3: Alerts + Forecast Summary ── */}
      <section className="grid gap-5 pb-4" style={{ gridTemplateColumns: '2fr 1fr' }}>
        {/* Latest Alerts */}
        <div className="rounded-xl p-5" style={{ background: '#081018', border: '1px solid rgba(0,191,255,0.08)' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#eaf8ff' }}>
              <i className="ri-alarm-warning-line" style={{ color: '#ff4d4d' }} />Latest Alerts
            </div>
            <button className="text-xs font-medium cursor-pointer" style={{ color: '#00bfff' }}>View All</button>
          </div>
          <div className="flex flex-col gap-2.5">
            {[
              { type: 'danger', icon: 'ri-alarm-warning-line', title: 'Manggahan — Critical Case Surge', desc: 'Cases increased 34% in the past 30 days. Immediate intervention required.', time: '2 hours ago' },
              { type: 'warning', icon: 'ri-error-warning-line', title: 'Dela Paz — Low Success Rate', desc: 'Treatment success rate dropped to 58%. Below WHO threshold.', time: '6 hours ago' },
              { type: 'warning', icon: 'ri-error-warning-line', title: 'Dela Paz — Supply Critical', desc: 'Medicine stock below 15%. Immediate resupply needed.', time: '10 hours ago' },
            ].map((a) => {
              const isDanger = a.type === 'danger';
              return (
                <div key={a.title} className="flex gap-3 items-start rounded-lg p-3"
                  style={{ background: isDanger ? 'rgba(255,77,77,0.07)' : 'rgba(255,209,102,0.06)', border: isDanger ? '1px solid rgba(255,77,77,0.2)' : '1px solid rgba(255,209,102,0.2)' }}>
                  <i className={`${a.icon} text-lg mt-0.5 shrink-0`} style={{ color: isDanger ? '#ff4d4d' : '#ffd166' }} />
                  <div>
                    <div className="text-sm font-bold mb-1" style={{ color: '#eaf8ff' }}>{a.title}</div>
                    <div className="text-xs" style={{ color: '#6f8a99' }}>{a.desc}</div>
                    <div className="text-[11px] mt-1" style={{ color: '#6f8a99' }}>{a.time}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Forecast Summary */}
        <div className="rounded-xl p-5" style={{ background: '#081018', border: '1px solid rgba(0,191,255,0.08)' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#eaf8ff' }}>
              <i className="ri-brain-line" style={{ color: '#8b5cf6' }} />Forecast Summary
            </div>
            <button className="text-xs font-medium cursor-pointer" style={{ color: '#00bfff' }}>View Details</button>
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr>
                {['Period', 'Forecast', 'Trend'].map(h => (
                  <th key={h} className="pb-2 pt-1 text-[10px] font-semibold uppercase tracking-widest"
                    style={{ color: '#6f8a99', borderBottom: '1px solid rgba(0,191,255,0.08)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { period: 'Next Month (Jul 2025)', val: '74', pct: '+8.8%' },
                { period: '3 Months (Q3 2025)', val: '223', pct: '+10.2%' },
                { period: '6 Months (H2 2025)', val: '461', pct: '+12.1%' },
              ].map(row => (
                <tr key={row.period} className="border-b" style={{ borderColor: 'rgba(0,191,255,0.05)' }}>
                  <td className="py-2.5 text-xs" style={{ color: '#eaf8ff' }}>{row.period}</td>
                  <td className="py-2.5 text-base font-bold" style={{ color: '#eaf8ff' }}>{row.val}</td>
                  <td className="py-2.5 text-xs font-semibold" style={{ color: '#ff4d4d' }}><i className="ri-arrow-up-line" /> {row.pct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
