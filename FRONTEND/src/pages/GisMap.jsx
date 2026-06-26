import { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import 'leaflet/dist/leaflet.css';
import { useTBData } from '../context/TBDataContext';
import { downloadFile, toCSV } from '../utils/exportUtils';

const riskColors = { High: '#EF4444', Moderate: '#F59E0B', Low: '#10B981' };

const MONTHS_2025 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ─── Donut chart colors ─── */
const OUTCOME_COLORS = {
  Cured: '#10B981',
  Completed: '#2E6FAF',
  Died: '#6B7280',
  'Lost to Follow-up': '#8B5CF6',
  'Defaulted': '#8B5CF6',
  Failed: '#EF4444',
  'Not Evaluated': '#F59E0B',
};

/* ─── FlyTo component for map search ─── */
function FlyToLocation({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom || 14, { duration: 1.2 });
    }
  }, [center, zoom, map]);
  return null;
}

/* ─── Status Badge ─── */
function StatusBadge({ status }) {
  const color = riskColors[status] || '#94A3B8';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap"
      style={{ background: `${color}1A`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
      {status}
    </span>
  );
}

/* ─── Generate monthly trend data per barangay (seeded by name hash) ─── */
function generateMonthlyTrend(b) {
  const hash = b.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = Math.round(b.cases / 12);
  return MONTHS_2025.map((month, i) => {
    const variation = Math.sin(hash + i * 0.8) * (base * 0.35);
    const growth = (i / 11) * (base * 0.15);
    return { month, cases: Math.max(1, Math.round(base + variation + growth)) };
  });
}

/* ─── Custom Tooltip for bar chart ─── */
function BarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#0f172a', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
      <p style={{ fontWeight: 700, marginBottom: 2 }}>{label}</p>
      <p style={{ color: '#2E6FAF' }}>{payload[0].value} cases</p>
    </div>
  );
}

/* ─── Main Component ─── */
export default function GisMap() {
  const { records, gisData, analytics } = useTBData();

  const [selectedBarangay, setSelectedBarangay] = useState(null);
  const [analyticsBarangay, setAnalyticsBarangay] = useState(null);
  const [filterBarangay, setFilterBarangay] = useState('');
  const [filterYear, setFilterYear] = useState('2025');
  const [layerMode, setLayerMode] = useState('risk');
  const [flyTarget, setFlyTarget] = useState(null);
  const [showFullscreen, setShowFullscreen] = useState(false);

  /* ─── Enrich gisData with per-barangay outcomes & gender from records ─── */
  const barangayHotspots = useMemo(() => {
    return gisData.map(g => {
      const bRecords = records.filter(r => r.barangay === g.barangay);
      const male = bRecords.filter(r => r.sex === 'Male').length;
      const female = bRecords.filter(r => r.sex === 'Female').length;
      const cured = bRecords.filter(r => r.status === 'Cured').length;
      const completed = bRecords.filter(r => r.status === 'Completed').length;
      const defaulted = bRecords.filter(r => r.status === 'Defaulted').length;
      const died = bRecords.filter(r => r.status === 'Died').length;
      const failed = bRecords.filter(r => r.status === 'Failed').length;
      const notEvaluated = bRecords.filter(r => r.status === 'Not Evaluated').length;
      return {
        name: g.barangay,
        cases: g.cases,
        risk: g.risk,
        predicted: g.forecast,
        lat: g.lat,
        lng: g.lng,
        male,
        female,
        activeCases: g.activeCases,
        successRate: g.successRate,
        outcomes: { cured, completed, defaulted, died, failed, notEvaluated },
        facility: g.facility,
      };
    });
  }, [gisData, records]);

  const filtered = filterBarangay
    ? barangayHotspots.filter(b => b.name === filterBarangay)
    : barangayHotspots;

  const highRisk = barangayHotspots.filter(b => b.risk === 'High');
  const moderateRisk = barangayHotspots.filter(b => b.risk === 'Moderate');
  const lowRisk = barangayHotspots.filter(b => b.risk === 'Low');

  const pasigCenter = [14.5570, 121.0850];

  /* Circle radius and color based on layer mode */
  function getMarkerStyle(b) {
    let radius, fillColor, color;
    switch (layerMode) {
      case 'cases':
        radius = Math.max(8, Math.min(28, b.cases / 6));
        fillColor = b.cases > 100 ? '#EF4444' : b.cases > 60 ? '#F59E0B' : '#10B981';
        color = '#fff';
        break;
      case 'active':
        radius = Math.max(8, Math.min(28, b.activeCases / 2));
        fillColor = b.activeCases > 20 ? '#EF4444' : b.activeCases > 10 ? '#F59E0B' : '#10B981';
        color = '#fff';
        break;
      case 'success': {
        const rate = Math.round(b.successRate);
        radius = Math.max(10, Math.min(22, rate / 4));
        fillColor = rate >= 85 ? '#10B981' : rate >= 70 ? '#F59E0B' : '#EF4444';
        color = '#fff';
        break;
      }
      default: // risk
        radius = Math.max(10, Math.min(22, b.cases / 7));
        fillColor = riskColors[b.risk];
        color = '#fff';
    }
    return { radius, fillColor, color };
  }

  /* Handle fullscreen */
  const mapContainerClass = showFullscreen
    ? 'fixed inset-0 z-50'
    : 'relative rounded-2xl overflow-hidden';

  const mapHeight = showFullscreen ? '100vh' : '480px';

  /* ── Export: single barangay analytics report (CSV) ── */
  const handleExportBarangayReport = () => {
    const b = analyticsBarangay;
    if (!b) return;
    const rows = [
      { Metric: 'Barangay', Value: b.name },
      { Metric: 'Total Cases', Value: b.cases },
      { Metric: 'Active Cases', Value: b.activeCases },
      { Metric: 'Risk Level', Value: b.risk },
      { Metric: 'Predicted (Forecast)', Value: b.predicted },
      { Metric: 'Success Rate (%)', Value: Math.round(b.successRate) },
      { Metric: 'Male', Value: b.male },
      { Metric: 'Female', Value: b.female },
      { Metric: 'Cured', Value: b.outcomes.cured },
      { Metric: 'Completed', Value: b.outcomes.completed },
      { Metric: 'Defaulted', Value: b.outcomes.defaulted },
      { Metric: 'Died', Value: b.outcomes.died },
      { Metric: 'Failed', Value: b.outcomes.failed },
      { Metric: 'Not Evaluated', Value: b.outcomes.notEvaluated },
      { Metric: 'Facility', Value: b.facility },
    ];
    const csv = toCSV(rows);
    downloadFile(csv, `TBInsight_GIS_${b.name}_Report.csv`);
  };

  /* ── Export: full map summary (all barangays CSV) ── */
  const handleExportMap = () => {
    const rows = filtered.map(b => ({
      Barangay: b.name,
      Cases: b.cases,
      'Active Cases': b.activeCases,
      'Risk Level': b.risk,
      'Forecast': b.predicted,
      'Success Rate (%)': Math.round(b.successRate),
      Male: b.male,
      Female: b.female,
      'Cured': b.outcomes.cured,
      'Completed': b.outcomes.completed,
      'Defaulted': b.outcomes.defaulted,
      'Died': b.outcomes.died,
      'Failed': b.outcomes.failed,
      'Not Evaluated': b.outcomes.notEvaluated,
      Facility: b.facility,
    }));
    const csv = toCSV(rows);
    const ts = new Date().toISOString().slice(0, 10);
    downloadFile(csv, `TBInsight_GIS_MapSummary_${ts}.csv`);
  };

  /* ─── Analytics Modal Content ─── */
  function renderAnalyticsModal() {
    const b = analyticsBarangay;
    if (!b) return null;

    const activeCases = b.outcomes.defaulted + b.outcomes.failed + b.outcomes.notEvaluated;
    const successRate = Math.round(((b.outcomes.cured + b.outcomes.completed) / b.cases) * 100);
    const monthlyTrend = generateMonthlyTrend(b);

    /* Donut chart data */
    const donutData = [
      { name: 'Cured', value: b.outcomes.cured },
      { name: 'Completed', value: b.outcomes.completed },
      { name: 'Died', value: b.outcomes.died },
      { name: 'Lost to Follow-up', value: b.outcomes.defaulted },
      { name: 'Failed', value: b.outcomes.failed },
      { name: 'Not Evaluated', value: b.outcomes.notEvaluated },
    ];

    /* Outcome table rows */
    const outcomeRows = [
      { outcome: 'Cured', count: b.outcomes.cured, color: '#10B981' },
      { outcome: 'Completed', count: b.outcomes.completed, color: '#2E6FAF' },
      { outcome: 'Died', count: b.outcomes.died, color: '#6B7280' },
      { outcome: 'Lost to Follow-up - Defaulted', count: b.outcomes.defaulted, color: '#8B5CF6' },
      { outcome: 'Failed', count: b.outcomes.failed, color: '#EF4444' },
      { outcome: 'Not Evaluated', count: b.outcomes.notEvaluated, color: '#F59E0B' },
    ];

    const malePct = Math.round((b.male / b.cases) * 100);
    const femalePct = 100 - malePct;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
        <div
          className="w-full max-w-2xl max-h-[92vh] overflow-hidden rounded-2xl"
          style={{ background: '#fff', boxShadow: '0 25px 60px rgba(0,0,0,0.25)' }}
        >
          {/* ── Header ── */}
          <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid #e2e8f0' }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0F2D52, #2E6FAF)' }}>
                <i className="ri-hospital-line text-white text-lg" />
              </div>
              <div>
                <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>{b.name} — Barangay Analytics</h2>
              </div>
            </div>
            <button
              onClick={() => setAnalyticsBarangay(null)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-slate-100"
              style={{ color: '#475569' }}
            >
              <i className="ri-close-line text-xl" />
            </button>
          </div>

          {/* ── Scrollable Body ── */}
          <div className="overflow-y-auto px-6 py-5 space-y-5" style={{ maxHeight: 'calc(92vh - 140px)' }}>

            {/* ── KPI Row ── */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total Cases', value: b.cases, color: '#0f172a' },
                { label: 'Active Cases', value: activeCases, color: '#D97706' },
                { label: 'Success Rate', value: `${successRate}%`, color: '#10B981' },
              ].map(k => (
                <div key={k.label} className="rounded-xl p-4 text-center" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>{k.label}</div>
                  <div className="text-xl font-bold" style={{ color: k.color }}>{k.value}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Forecasted (Next Mo.)', value: b.predicted, color: '#8B5CF6' },
                { label: 'Risk Level', value: b.risk, color: riskColors[b.risk] },
                { label: 'Records in Dataset', value: b.cases, color: '#0f172a' },
              ].map(k => (
                <div key={k.label} className="rounded-xl p-4 text-center" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>{k.label}</div>
                  <div className="text-xl font-bold" style={{ color: k.color }}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* ── Charts Row: Donut + Bar ── */}
            <div className="grid grid-cols-2 gap-4">
              {/* Treatment Outcomes Donut */}
              <div className="rounded-xl p-4" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <p className="text-sm font-bold mb-3" style={{ color: '#0f172a' }}>Treatment Outcomes</p>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={2}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {donutData.map((entry) => (
                        <Cell key={entry.name} fill={OUTCOME_COLORS[entry.name]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, color: '#0f172a' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Legend */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
                  {donutData.map(d => (
                    <div key={d.name} className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: OUTCOME_COLORS[d.name] }} />
                      <span className="text-[10px] font-medium" style={{ color: '#475569' }}>{d.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Monthly Case Trend Bar Chart */}
              <div className="rounded-xl p-4" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <p className="text-sm font-bold mb-3" style={{ color: '#0f172a' }}>Monthly Case Trend (2025)</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={monthlyTrend} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<BarTooltip />} />
                    <Bar
                      dataKey="cases"
                      radius={[4, 4, 0, 0]}
                      fill="url(#barGradient)"
                    />
                    <defs>
                      <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2E6FAF" />
                        <stop offset="100%" stopColor="#0F2D52" />
                      </linearGradient>
                    </defs>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ── Outcome Breakdown Table ── */}
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e2e8f0' }}>
              <div className="px-4 py-3" style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <p className="text-sm font-bold" style={{ color: '#0f172a' }}>Outcome Breakdown</p>
              </div>
              <div>
                {/* Header */}
                <div className="grid grid-cols-3 px-4 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748b', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <span>Outcome</span>
                  <span className="text-right">Count</span>
                  <span className="text-right">%</span>
                </div>
                {/* Rows */}
                {outcomeRows.map((row, i) => {
                  const pct = b.cases > 0 ? Math.round((row.count / b.cases) * 100) : 0;
                  return (
                    <div
                      key={row.outcome}
                      className="grid grid-cols-3 px-4 py-2.5 text-xs"
                      style={{ borderBottom: i < outcomeRows.length - 1 ? '1px solid #f1f5f9' : 'none' }}
                    >
                      <span className="font-medium" style={{ color: '#0f172a' }}>{row.outcome}</span>
                      <span className="text-right font-bold" style={{ color: row.color }}>{row.count}</span>
                      <span className="text-right font-semibold" style={{ color: '#475569' }}>{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Gender Distribution ── */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-4 text-center" style={{ background: '#f0f9ff', border: '1px solid #bae6fd' }}>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#0369a1' }}>Male</div>
                <div className="text-xl font-bold" style={{ color: '#0369a1' }}>{b.male} <span className="text-sm font-medium">({malePct}%)</span></div>
              </div>
              <div className="rounded-xl p-4 text-center" style={{ background: '#fdf2f8', border: '1px solid #fbcfe8' }}>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#be185d' }}>Female</div>
                <div className="text-xl font-bold" style={{ color: '#be185d' }}>{b.female} <span className="text-sm font-medium">({femalePct}%)</span></div>
              </div>
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="px-6 py-4 flex items-center justify-end gap-3" style={{ borderTop: '1px solid #e2e8f0' }}>
            <button
              onClick={() => setAnalyticsBarangay(null)}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition hover:bg-slate-100"
              style={{ color: '#475569', border: '1px solid #e2e8f0' }}
            >
              Close
            </button>
            <button
              onClick={handleExportBarangayReport}
              className="px-4 py-2 rounded-lg text-sm font-bold text-white transition hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)' }}
            >
              <i className="ri-download-2-line mr-1" /> Export Report
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative space-y-5">

      {/* ── Filter Bar (matches HTML prototype) ── */}
      <section className="glass-card p-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-bold" style={{ color: '#0f172a' }}>
          <i className="ri-map-2-line text-lg" style={{ color: '#2E6FAF' }} />
          GIS Hotspot Map
        </div>
        <div className="flex-1" />
        <select
          value={layerMode}
          onChange={e => setLayerMode(e.target.value)}
          className="rounded-lg px-3 py-2 text-xs font-medium outline-none"
          style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}
        >
          <option value="risk">Risk Level</option>
          <option value="cases">Case Count</option>
          <option value="active">Active Cases</option>
          <option value="success">Success Rate</option>
        </select>
        <select
          value={filterBarangay}
          onChange={e => {
            setFilterBarangay(e.target.value);
            if (e.target.value) {
              const b = barangayHotspots.find(b => b.name === e.target.value);
              if (b) setFlyTarget({ center: [b.lat, b.lng], zoom: 15 });
            } else {
              setFlyTarget({ center: pasigCenter, zoom: 13 });
            }
          }}
          className="rounded-lg px-3 py-2 text-xs font-medium outline-none"
          style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a', minWidth: 160 }}
        >
          <option value="">All Barangays</option>
          {barangayHotspots.map(b => (
            <option key={b.name} value={b.name}>{b.name}</option>
          ))}
        </select>
        <select
          value={filterYear}
          onChange={e => setFilterYear(e.target.value)}
          className="rounded-lg px-3 py-2 text-xs font-medium outline-none"
          style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}
        >
          <option value="2025">2025</option>
          <option value="2024">2024</option>
          <option value="2023">2023</option>
          <option value="2022">2022</option>
        </select>
        <button
          onClick={handleExportMap}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition"
          style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}
        >
          <i className="ri-download-2-line" /> Export Map
        </button>
        <button
          onClick={() => setShowFullscreen(!showFullscreen)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)' }}
        >
          <i className={showFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'} />
          {showFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
      </section>

      {/* ── Leaflet Map ── */}
      <section className={mapContainerClass}>
        <div className="glass-card overflow-hidden" style={{ height: mapHeight, position: 'relative' }}>
          <MapContainer
            center={pasigCenter}
            zoom={13}
            style={{ height: '100%', width: '100%' }}
            zoomControl={false}
            attributionControl={false}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap contributors'
            />

            {flyTarget && <FlyToLocation center={flyTarget.center} zoom={flyTarget.zoom} />}

            {filtered.map((b) => {
              const style = getMarkerStyle(b);
              return (
                <CircleMarker
                  key={b.name}
                  center={[b.lat, b.lng]}
                  radius={style.radius}
                  fillColor={style.fillColor}
                  fillOpacity={0.8}
                  color={style.color}
                  weight={2}
                  eventHandlers={{
                    click: () => setSelectedBarangay(b),
                  }}
                >
                  <Popup>
                    <div style={{ fontFamily: 'Inter, sans-serif', minWidth: 180 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: '#0f172a' }}>{b.name}</div>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12,
                          background: `${riskColors[b.risk]}1A`, color: riskColors[b.risk]
                        }}>
                          {b.risk} Risk
                        </span>
                      </div>
                      <div style={{ fontSize: 11, lineHeight: 1.8, color: '#475569' }}>
                        <div><strong>Total Cases:</strong> {b.cases}</div>
                        <div><strong>Forecasted:</strong> {b.predicted}</div>
                        <div><strong>Cured:</strong> {b.outcomes.cured} · <strong>Completed:</strong> {b.outcomes.completed}</div>
                        <div><strong>Defaulted:</strong> {b.outcomes.defaulted} · <strong>Died:</strong> {b.outcomes.died}</div>
                        <div><strong>Facility:</strong> {b.facility}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <button
                          onClick={() => setAnalyticsBarangay(b)}
                          style={{
                            flex: 1, padding: '6px 12px', fontSize: 11, fontWeight: 700,
                            background: 'linear-gradient(135deg, #0F2D52, #2E6FAF)', color: '#fff',
                            border: 'none', borderRadius: 6, cursor: 'pointer'
                          }}
                        >
                          View Analytics
                        </button>
                        <button
                          onClick={() => setSelectedBarangay(b)}
                          style={{
                            padding: '6px 12px', fontSize: 11, fontWeight: 700,
                            background: '#f8fafc', color: '#475569',
                            border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer'
                          }}
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>

          {/* Legend overlay */}
          <div
            className="absolute bottom-4 left-4 z-[1000] p-3 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)', border: '1px solid rgba(0,0,0,0.08)', width: 180 }}
          >
            <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#64748b' }}>
              {layerMode === 'risk' ? 'Risk Level' : layerMode === 'cases' ? 'Case Count' : layerMode === 'active' ? 'Active Cases' : 'Success Rate'}
            </div>
            {layerMode === 'risk' && (
              <div className="space-y-1.5">
                {[
                  { color: '#EF4444', label: 'High Risk (>80 cases)' },
                  { color: '#F59E0B', label: 'Moderate (50–80)' },
                  { color: '#10B981', label: 'Low Risk (<50)' },
                ].map(m => (
                  <div key={m.label} className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: m.color }} />
                    <span className="text-[10px] font-medium" style={{ color: '#475569' }}>{m.label}</span>
                  </div>
                ))}
              </div>
            )}
            {layerMode === 'cases' && (
              <div className="space-y-1.5">
                {[
                  { color: '#EF4444', label: '> 100 cases' },
                  { color: '#F59E0B', label: '60 – 100 cases' },
                  { color: '#10B981', label: '< 60 cases' },
                ].map(m => (
                  <div key={m.label} className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: m.color }} />
                    <span className="text-[10px] font-medium" style={{ color: '#475569' }}>{m.label}</span>
                  </div>
                ))}
              </div>
            )}
            {layerMode === 'active' && (
              <div className="space-y-1.5">
                {[
                  { color: '#EF4444', label: '> 20 active' },
                  { color: '#F59E0B', label: '10 – 20 active' },
                  { color: '#10B981', label: '< 10 active' },
                ].map(m => (
                  <div key={m.label} className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: m.color }} />
                    <span className="text-[10px] font-medium" style={{ color: '#475569' }}>{m.label}</span>
                  </div>
                ))}
              </div>
            )}
            {layerMode === 'success' && (
              <div className="space-y-1.5">
                {[
                  { color: '#10B981', label: '≥ 85% success' },
                  { color: '#F59E0B', label: '70 – 84%' },
                  { color: '#EF4444', label: '< 70%' },
                ].map(m => (
                  <div key={m.label} className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: m.color }} />
                    <span className="text-[10px] font-medium" style={{ color: '#475569' }}>{m.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Year badge */}
          <div
            className="absolute top-4 left-4 z-[1000] px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)', border: '1px solid rgba(0,0,0,0.08)', fontSize: 11, fontWeight: 700, color: '#0f172a' }}
          >
            <i className="ri-calendar-line mr-1" style={{ color: '#2E6FAF' }} /> {filterYear}
          </div>

          {/* Stats badge */}
          <div
            className="absolute top-4 right-4 z-[1000] px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)', border: '1px solid rgba(0,0,0,0.08)', fontSize: 11, fontWeight: 700, color: '#0f172a' }}
          >
            {filtered.length} barangay{filtered.length !== 1 ? 's' : ''} shown
          </div>
        </div>
      </section>

      {/* ── Summary Stats Row ── */}
      <section className="grid gap-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {[
          { title: 'Total Cases', value: analytics.totalCases, icon: 'ri-map-pin-line', color: '#3B82F6' },
          { title: 'Active Cases', value: analytics.activeCases, icon: 'ri-alarm-warning-line', color: '#EF4444' },
          { title: 'High Risk Areas', value: analytics.highRiskAreas, icon: 'ri-error-warning-line', color: '#F59E0B' },
          { title: 'Success Rate', value: `${Math.round(analytics.successRate)}%`, icon: 'ri-shield-check-line', color: '#10B981' },
        ].map(c => (
          <div key={c.title} className="glass-card p-4 flex items-center gap-3 hover:-translate-y-0.5 transition-all duration-300">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${c.color}1A` }}>
              <i className={`${c.icon} text-lg`} style={{ color: c.color }} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>{c.title}</div>
              <div className="text-xl font-bold" style={{ color: '#0f172a' }}>{c.value}</div>
            </div>
          </div>
        ))}
      </section>

      {/* ── High Risk Barangay Cards (matches HTML prototype) ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold" style={{ color: '#0f172a' }}>
            <i className="ri-alarm-warning-line mr-1" style={{ color: '#EF4444' }} />
            High Risk Barangays — Immediate Action Required
          </h3>
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {highRisk.map(b => {
            const active = b.outcomes.defaulted + b.outcomes.failed + b.outcomes.notEvaluated;
            return (
              <div
                key={b.name}
                className="glass-card p-4 cursor-pointer hover:-translate-y-0.5 transition-all duration-300"
                onClick={() => setSelectedBarangay(b)}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="text-sm font-bold" style={{ color: '#0f172a' }}>{b.name}</div>
                  <StatusBadge status={b.risk} />
                </div>
                <div className="text-[11px] leading-relaxed" style={{ color: '#475569' }}>
                  <div className="flex justify-between"><span>Cases:</span> <strong>{b.cases}</strong></div>
                  <div className="flex justify-between"><span>Active:</span> <strong style={{ color: '#D97706' }}>{active}</strong></div>
                  <div className="flex justify-between"><span>Success Rate:</span> <strong style={{ color: '#10B981' }}>{Math.round(b.successRate)}%</strong></div>
                  <div className="flex justify-between"><span>Forecast:</span> <strong style={{ color: '#8B5CF6' }}>{b.predicted}</strong></div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    className="flex-1 rounded-lg px-2 py-1.5 text-[10px] font-bold text-white transition hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)' }}
                    onClick={e => { e.stopPropagation(); setAnalyticsBarangay(b); }}
                  >
                    View Analytics
                  </button>
                  <button
                    className="rounded-lg px-2 py-1.5 text-[10px] font-bold transition"
                    style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}
                    onClick={e => { e.stopPropagation(); setSelectedBarangay(b); }}
                  >
                    Details
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Barangay Detail Modal ── */}
      {selectedBarangay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
          <div
            className="glass-card w-full max-w-3xl max-h-[90vh] overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.97)' }}
          >
            <div
              className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderBottom: '1px solid rgba(148,163,184,.15)' }}
            >
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: '#64748b' }}>
                  Barangay Profile
                </p>
                <h2 className="mt-2 text-xl font-bold tracking-tight" style={{ color: '#0f172a' }}>
                  {selectedBarangay.name}
                </h2>
                <div className="mt-1.5"><StatusBadge status={selectedBarangay.risk} /></div>
              </div>
              <button
                onClick={() => setSelectedBarangay(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-80"
                style={{ background: '#f1f5f9', color: '#475569' }}
              >
                <i className="ri-close-line text-base" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-6 py-6" style={{ maxHeight: '70vh' }}>
              {/* Info Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: 'Total Cases', value: selectedBarangay.cases, color: '#3B82F6' },
                  { label: 'Active Cases', value: selectedBarangay.outcomes.defaulted + selectedBarangay.outcomes.failed + selectedBarangay.outcomes.notEvaluated, color: '#D97706' },
                  { label: 'Treatment Success Rate', value: `${Math.round(selectedBarangay.successRate)}%`, color: '#10B981' },
                  { label: 'Forecasted (Next Mo.)', value: selectedBarangay.predicted, color: '#8B5CF6' },
                  { label: 'Risk Level', value: selectedBarangay.risk, color: riskColors[selectedBarangay.risk] },
                  { label: 'Facility', value: selectedBarangay.facility, color: '#2E6FAF' },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-4" style={{ background: '#f8fafc', border: '1px solid rgba(148,163,184,0.15)' }}>
                    <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>{s.label}</div>
                    <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Treatment Outcomes */}
              <div className="rounded-xl p-5" style={{ background: '#f8fafc', border: '1px solid rgba(148,163,184,0.15)' }}>
                <p className="flex items-center gap-2 text-sm font-bold mb-3" style={{ color: '#0f172a' }}>
                  <i className="ri-heart-pulse-line" style={{ color: '#2E6FAF' }} />
                  Treatment Outcomes
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: 'Cured', value: selectedBarangay.outcomes.cured, color: '#10B981' },
                    { label: 'Completed', value: selectedBarangay.outcomes.completed, color: '#2E6FAF' },
                    { label: 'Defaulted', value: selectedBarangay.outcomes.defaulted, color: '#8B5CF6' },
                    { label: 'Died', value: selectedBarangay.outcomes.died, color: '#EF4444' },
                    { label: 'Failed', value: selectedBarangay.outcomes.failed, color: '#FF0055' },
                    { label: 'Not Evaluated', value: selectedBarangay.outcomes.notEvaluated, color: '#94A3B8' },
                  ].map(o => (
                    <div key={o.label} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: '#ffffff', border: '1px solid rgba(148,163,184,0.1)' }}>
                      <span className="text-xs font-semibold" style={{ color: '#475569' }}>{o.label}</span>
                      <span className="text-sm font-bold" style={{ color: o.color }}>{o.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommended Interventions */}
              <div className="rounded-xl p-5" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                <p className="flex items-center gap-2 text-sm font-bold mb-2" style={{ color: '#92400E' }}>
                  <i className="ri-lightbulb-line" />
                  Recommended Interventions
                </p>
                <ul className="text-[11px] leading-relaxed ml-5 list-disc" style={{ color: '#92400E' }}>
                  {selectedBarangay.risk === 'High' && (
                    <>
                      <li>Deploy additional contact tracing teams</li>
                      <li>Increase active case finding campaigns</li>
                      <li>Strengthen treatment monitoring and adherence support</li>
                      <li>Monthly community screening drives</li>
                    </>
                  )}
                  {selectedBarangay.risk === 'Moderate' && (
                    <>
                      <li>Regular quarterly screening programs</li>
                      <li>Monitor treatment adherence closely</li>
                      <li>Community health education campaigns</li>
                    </>
                  )}
                  {selectedBarangay.risk === 'Low' && (
                    <>
                      <li>Maintain current surveillance level</li>
                      <li>Annual screening programs</li>
                    </>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Barangay Analytics Modal ── */}
      {analyticsBarangay && renderAnalyticsModal()}
    </div>
  );
}
