import { useState, useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useTBData } from '../context/TBDataContext';
import { downloadFile, toCSV } from '../utils/exportUtils';

/* ─── Risk level derived from priorityScore ─── */
function getRiskLevel(score) {
  if (score > 55) return 'High';
  if (score > 35) return 'Moderate';
  return 'Low';
}

const riskColors = { High: '#EF4444', Moderate: '#F59E0B', Low: '#10B981' };

const OUTCOME_COLORS = { Cured: '#10B981', Completed: '#2E6FAF', Died: '#6B7280', 'Lost to Follow-up': '#8B5CF6', Failed: '#EF4444', 'Not Evaluated': '#F59E0B' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ─── Intervention fallback by risk level ─── */
const INTERVENTIONS = {
  High: ['Increase Active Case Finding', 'Deploy Mobile TB Screening Teams', 'Intensify Contact Tracing', 'Strengthen Treatment Monitoring'],
  Moderate: ['Quarterly Community Screening', 'Health Education Campaign', 'Monitor Treatment Adherence'],
  Low: ['Maintain Regular Surveillance', 'Annual Screening Program'],
};

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

/* ─── Priority Badge ─── */
function PriorityBadge({ level }) {
  const color = riskColors[level] || '#94A3B8';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap" style={{ background: `${color}1A`, color }}>
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
      {level}
    </span>
  );
}

/* ─── Rank Badge ─── */
function RankBadge({ rank }) {
  const styles = {
    1: { background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)', color: '#fff', boxShadow: '0 2px 8px rgba(255,165,0,0.3)' },
    2: { background: 'linear-gradient(135deg, #C0C0C0 0%, #A0A0A0 100%)', color: '#fff', boxShadow: '0 2px 8px rgba(160,160,160,0.3)' },
    3: { background: 'linear-gradient(135deg, #CD7F32 0%, #B8860B 100%)', color: '#fff', boxShadow: '0 2px 8px rgba(184,134,11,0.3)' },
  };
  const s = styles[rank] || { background: '#f0f4f8', color: '#64748b' };
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-extrabold" style={s}>{rank}</span>
  );
}

/* ─── Analytics Modal (extracted as a proper component to follow Hooks rules) ─── */
function AnalyticsModal({ barangay, records, analytics, highRiskAreas, onClose }) {
  const d = barangay;
  if (!d) return null;

  const barangayRecords = useMemo(
    () => records.filter(r => r.barangay === d.barangay),
    [records, d.barangay]
  );

  const totalForBarangay = barangayRecords.length;

  /* Outcomes from records */
  const outcomes = useMemo(() => {
    return {
      cured: barangayRecords.filter(r => r.status === 'Cured').length,
      completed: barangayRecords.filter(r => r.status === 'Completed').length,
      died: barangayRecords.filter(r => r.status === 'Died').length,
      lostToFollowUp: barangayRecords.filter(r => r.status === 'Defaulted').length,
      failed: barangayRecords.filter(r => r.status === 'Failed').length,
      notEvaluated: barangayRecords.filter(r => r.status === 'Not Evaluated').length,
    };
  }, [barangayRecords]);

  const donutData = [
    { name: 'Cured', value: outcomes.cured },
    { name: 'Completed', value: outcomes.completed },
    { name: 'Died', value: outcomes.died },
    { name: 'Lost to Follow-up', value: outcomes.lostToFollowUp },
    { name: 'Failed', value: outcomes.failed },
    { name: 'Not Evaluated', value: outcomes.notEvaluated },
  ];

  const outcomeRows = [
    { outcome: 'Cured', count: outcomes.cured, color: '#10B981' },
    { outcome: 'Completed', count: outcomes.completed, color: '#2E6FAF' },
    { outcome: 'Died', count: outcomes.died, color: '#6B7280' },
    { outcome: 'Lost to Follow-up - Defaulted', count: outcomes.lostToFollowUp, color: '#8B5CF6' },
    { outcome: 'Failed', count: outcomes.failed, color: '#EF4444' },
    { outcome: 'Not Evaluated', count: outcomes.notEvaluated, color: '#F59E0B' },
  ];

  /* Monthly trend from actual records */
  const monthlyTrend = useMemo(() => {
    const monthMap = {};
    barangayRecords.forEach(r => {
      const y = r.diagnosisDate.slice(0, 4);
      const m = r.diagnosisDate.slice(5, 7);
      const key = `${MONTHS[parseInt(m, 10) - 1]} ${String(y).slice(2)}`;
      monthMap[key] = (monthMap[key] || 0) + 1;
    });
    /* Sort chronologically */
    const monthOrder = {};
    barangayRecords.forEach(r => {
      const y = parseInt(r.diagnosisDate.slice(0, 4), 10);
      const m = parseInt(r.diagnosisDate.slice(5, 7), 10);
      const key = `${MONTHS[m - 1]} ${String(y).slice(2)}`;
      monthOrder[key] = y * 100 + m;
    });
    return Object.entries(monthMap)
      .sort((a, b) => (monthOrder[a[0]] || 0) - (monthOrder[b[0]] || 0))
      .map(([month, cases]) => ({ month, cases }));
  }, [barangayRecords]);

  /* Gender distribution from records */
  const maleCount = barangayRecords.filter(r => r.sex === 'Male').length;
  const femaleCount = barangayRecords.filter(r => r.sex === 'Female').length;
  const malePct = totalForBarangay > 0 ? Math.round((maleCount / totalForBarangay) * 100) : 0;
  const femalePct = 100 - malePct;

  const successRate = Math.round(d.successRate);

  /* ── Export barangay analytics as CSV ── */
  const handleExportAnalytics = () => {
    const rows = [
      { Metric: 'Barangay', Value: d.barangay },
      { Metric: 'Total TB Cases', Value: totalForBarangay },
      { Metric: 'Active Cases', Value: d.active },
      { Metric: 'Priority Score', Value: Math.round(d.priorityScore) },
      { Metric: 'Risk Level', Value: d.risk },
      { Metric: 'Forecast', Value: d.forecast },
      { Metric: 'Success Rate (%)', Value: successRate },
      { Metric: 'Male', Value: maleCount },
      { Metric: 'Female', Value: femaleCount },
      ...outcomeRows.map(r => ({ Metric: r.outcome, Value: r.count })),
    ];
    const csv = toCSV(rows);
    downloadFile(csv, `TBInsight_ResourcePrio_${d.barangay}_Analytics.csv`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[92vh] overflow-hidden rounded-2xl" style={{ background: '#fff', boxShadow: '0 25px 60px rgba(0,0,0,0.25)' }}>

        {/* Header */}
        <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid #e2e8f0' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0F2D52, #2E6FAF)' }}>
              <i className="ri-hospital-line text-white text-lg" />
            </div>
            <div>
              <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>{d.barangay} — Barangay Analytics</h2>
            </div>
          </div>
          <button onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-slate-100" style={{ color: '#475569' }}>
            <i className="ri-close-line text-xl" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5" style={{ maxHeight: 'calc(92vh - 140px)' }}>

          {/* ── Dashboard-Style Metric Strip ── */}
          <section
            className="rounded-2xl grid gap-0 overflow-hidden"
            style={{ gridTemplateColumns: 'repeat(3, 1fr)', background: '#ffffff', border: '1px solid rgba(148,163,184,0.18)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
          >
            {[
              { title: 'Total TB Cases', value: totalForBarangay, icon: 'ri-bar-chart-fill', color: '#2E6FAF', trend: `+${totalForBarangay > 0 ? ((d.forecast - totalForBarangay) / totalForBarangay * 100).toFixed(0) : 0}%` },
              { title: 'Active Cases', value: d.active, icon: 'ri-time-line', color: '#F59E0B', trend: 'Ongoing' },
              { title: 'High-Risk Areas', value: highRiskAreas, icon: 'ri-alarm-warning-line', color: '#EF4444', trend: 'Critical' },
              { title: 'Success Rate', value: `${successRate}%`, icon: 'ri-checkbox-circle-line', color: '#10B981', trend: successRate < 75 ? 'Below WHO' : 'On Track' },
              { title: 'Forecast', value: d.forecast, icon: 'ri-brain-line', color: '#8B5CF6', trend: `+${totalForBarangay > 0 ? ((d.forecast - totalForBarangay) / totalForBarangay * 100).toFixed(1) : 0}%` },
              { title: 'Last Sync', value: analytics.lastSync || '—', icon: 'ri-refresh-line', color: '#4FD1C5', trend: 'Updated' },
            ].map((m, i, arr) => (
              <div key={m.title} className="p-4 flex flex-col justify-center relative">
                {i < arr.length - 1 && (
                  <div
                    className="absolute right-0 top-1/2 -translate-y-1/2 w-[2px] h-12"
                    style={{ background: 'rgba(3,33,62,0.3)', boxShadow: '0 0 8px rgba(79,209,197,0.4)' }}
                  />
                )}
                <div className="flex items-center gap-2 mb-2">
                  <i className={`${m.icon} text-lg`} style={{ color: m.color }} />
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>{m.title}</span>
                </div>
                <div className="flex items-end justify-between">
                  <div className="text-2xl font-bold" style={{ color: '#0f172a' }}>{m.value}</div>
                  <div className="text-xs font-semibold" style={{ color: m.color }}>{m.trend}</div>
                </div>
              </div>
            ))}
          </section>

          {/* ── Charts Row ── */}
          <div className="grid grid-cols-2 gap-4">
            {/* Treatment Outcomes Donut */}
            <div className="rounded-xl p-4" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <p className="text-sm font-bold mb-3" style={{ color: '#0f172a' }}>Treatment Outcomes</p>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value" strokeWidth={0}>
                    {donutData.map((entry) => (<Cell key={entry.name} fill={OUTCOME_COLORS[entry.name]} />))}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, color: '#0f172a' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
                {donutData.map(dd => (
                  <div key={dd.name} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: OUTCOME_COLORS[dd.name] }} />
                    <span className="text-[10px] font-medium" style={{ color: '#475569' }}>{dd.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Monthly Case Trend */}
            <div className="rounded-xl p-4" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <p className="text-sm font-bold mb-3" style={{ color: '#0f172a' }}>Monthly Case Trend</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyTrend} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<BarTooltip />} />
                  <Bar dataKey="cases" radius={[4, 4, 0, 0]} fill="url(#barGradient)" />
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
              <div className="grid grid-cols-3 px-4 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748b', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <span>Outcome</span>
                <span className="text-right">Count</span>
                <span className="text-right">%</span>
              </div>
              {outcomeRows.map((row, i) => {
                const pct = totalForBarangay > 0 ? Math.round((row.count / totalForBarangay) * 100) : 0;
                return (
                  <div key={row.outcome} className="grid grid-cols-3 px-4 py-2.5 text-xs" style={{ borderBottom: i < outcomeRows.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
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
              <div className="text-xl font-bold" style={{ color: '#0369a1' }}>{maleCount} <span className="text-sm font-medium">({malePct}%)</span></div>
            </div>
            <div className="rounded-xl p-4 text-center" style={{ background: '#fdf2f8', border: '1px solid #fbcfe8' }}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#be185d' }}>Female</div>
              <div className="text-xl font-bold" style={{ color: '#be185d' }}>{femaleCount} <span className="text-sm font-medium">({femalePct}%)</span></div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center justify-end gap-3" style={{ borderTop: '1px solid #e2e8f0' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold transition hover:bg-slate-100" style={{ color: '#475569', border: '1px solid #e2e8f0' }}>Close</button>
          <button onClick={handleExportAnalytics} className="px-4 py-2 rounded-lg text-sm font-bold text-white transition hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)' }}>
            <i className="ri-download-2-line mr-1" /> Export Report
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Component ─── */
export default function ResourcePrioritization() {
  const { resourceData, analytics, records } = useTBData();

  const [selectedBarangay, setSelectedBarangay] = useState(null);
  const [analyticsBarangay, setAnalyticsBarangay] = useState(null);
  const [sortKey, setSortKey] = useState('score');
  const [sortDir, setSortDir] = useState('desc');

  /* Enrich resourceData with computed risk level */
  const ranked = useMemo(() => {
    return resourceData.map(d => ({
      ...d,
      risk: getRiskLevel(d.priorityScore),
    }));
  }, [resourceData]);

  const criticalCount = useMemo(() => ranked.filter(b => b.risk === 'High').length, [ranked]);
  const moderateCount = useMemo(() => ranked.filter(b => b.risk === 'Moderate').length, [ranked]);
  const totalCases = analytics.totalCases;
  const avgScore = useMemo(() => {
    if (ranked.length === 0) return 0;
    return Math.round(ranked.reduce((a, b) => a + b.priorityScore, 0) / ranked.length);
  }, [ranked]);

  const handleSort = (key) => { setSortKey(key); setSortDir(prev => prev === 'desc' ? 'asc' : 'desc'); };

  const sorted = useMemo(() => {
    return [...ranked].sort((a, b) => {
      let aVal, bVal;
      if (sortKey === 'score') { aVal = a.priorityScore; bVal = b.priorityScore; }
      else if (sortKey === 'success') { aVal = a.successRate; bVal = b.successRate; }
      else { aVal = a[sortKey]; bVal = b[sortKey]; }
      if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [ranked, sortKey, sortDir]);

  /* ── Export full rankings table as CSV ── */
  const handleExportRankings = () => {
    const INTERVENTIONS_FLAT = {
      High: 'Increase Active Case Finding / Deploy Mobile Teams',
      Moderate: 'Quarterly Community Screening / Health Education',
      Low: 'Maintain Regular Surveillance',
    };
    const rows = sorted.map((r, i) => ({
      'Rank': r.rank || i + 1,
      'Barangay': r.barangay,
      'Priority Score': Math.round(r.priorityScore),
      'Risk Level': r.risk,
      'Total Cases': r.cases,
      'Active Cases': r.active,
      'Success Rate (%)': Math.round(r.successRate),
      'Suggested Intervention': r.interventions?.[0] || INTERVENTIONS_FLAT[r.risk] || '',
    }));
    const csv = toCSV(rows);
    const ts = new Date().toISOString().slice(0, 10);
    downloadFile(csv, `TBInsight_ResourcePrio_Rankings_${ts}.csv`);
  };

  return (
    <div className="relative space-y-5">

      {/* ── Dashboard Metric Strip ── */}
      <section
        className="rounded-2xl grid gap-0 overflow-hidden"
        style={{ gridTemplateColumns: 'repeat(6, 1fr)', background: '#ffffff', border: '1px solid rgba(148,163,184,0.18)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
      >
        {[
          { title: 'Total Barangays', value: ranked.length, icon: 'ri-map-pin-line', color: '#2E6FAF', trend: `${ranked.length} Covered` },
          { title: 'Critical Priority', value: criticalCount, icon: 'ri-alarm-warning-line', color: '#EF4444', trend: 'Immediate' },
          { title: 'Total Cases', value: totalCases, icon: 'ri-bar-chart-fill', color: '#F59E0B', trend: `${analytics.activeCases} Active` },
          { title: 'Avg Priority Score', value: avgScore, icon: 'ri-fire-line', color: '#8B5CF6', trend: '/ 100' },
          { title: 'Resources Needed', value: criticalCount + moderateCount, icon: 'ri-truck-line', color: '#10B981', trend: 'Deploy' },
          { title: 'Last Ranking', value: analytics.lastSync || '—', icon: 'ri-refresh-line', color: '#4FD1C5', trend: 'Updated' },
        ].map((m, i, arr) => (
          <div key={m.title} className="p-4 flex flex-col justify-center relative">
            {i < arr.length - 1 && (
              <div
                className="absolute right-0 top-1/2 -translate-y-1/2 w-[2px] h-12"
                style={{ background: 'rgba(3,33,62,0.3)', boxShadow: '0 0 8px rgba(79,209,197,0.4)' }}
              />
            )}
            <div className="flex items-center gap-2 mb-2">
              <i className={`${m.icon} text-lg`} style={{ color: m.color }} />
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>{m.title}</span>
            </div>
            <div className="flex items-end justify-between">
              <div className="text-2xl font-bold" style={{ color: '#0f172a' }}>{m.value}</div>
              <div className="text-xs font-semibold" style={{ color: m.color }}>{m.trend}</div>
            </div>
          </div>
        ))}
      </section>

      {/* ── Methodology Box ── */}
      <div className="glass-card p-4">
        <div className="text-xs leading-relaxed" style={{ color: '#475569' }}>
          <strong style={{ color: '#0f172a' }}>Priority Scoring Methodology:</strong>{' '}
          Composite score based on Total Cases (30%), Active Cases (25%), Forecast Growth (25%), and Treatment Success Rate Gap (20%). Higher score = higher priority for resource deployment.
        </div>
      </div>

      {/* ── Ranking Table ── */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-0">
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: '#0f172a' }}>
            <i className="ri-sort-desc text-lg" style={{ color: '#2E6FAF' }} />
            <span>Barangay Resource Prioritization Rankings</span>
          </div>
          <button onClick={handleExportRankings} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0066FF 0%, #00D8F6 100%)', color: '#fff' }}>
            <i className="ri-download-2-line text-sm" />
            Export Report
          </button>
        </div>

        <div className="mt-4 min-h-[480px] overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr>
                {[
                  { key: 'rank', label: 'Rank', sortable: false },
                  { key: 'barangay', label: 'Barangay', sortable: true },
                  { key: 'score', label: 'Priority Score', sortable: true },
                  { key: 'risk', label: 'Risk Level', sortable: true },
                  { key: 'cases', label: 'Cases', sortable: true },
                  { key: 'active', label: 'Active', sortable: true },
                  { key: 'success', label: 'Success Rate', sortable: true },
                  { key: 'intervention', label: 'Suggested Intervention', sortable: false },
                  { key: 'action', label: '', sortable: false },
                ].map(h => (
                  <th key={h.key} onClick={() => h.sortable && handleSort(h.key)} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer hover:opacity-70 transition" style={{ color: '#64748b', borderBottom: '1px solid rgba(148,163,184,.15)' }}>
                    <span className="flex items-center gap-1">
                      {h.label}
                      {h.sortable && sortKey === h.key && (<i className={`ri-arrow-${sortDir === 'asc' ? 'up' : 'down'}-s-line text-xs`} />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => {
                const rank = row.rank || i + 1;
                /* Use context-provided interventions, fall back to default list */
                const rowInterventions = row.interventions?.length > 0
                  ? row.interventions
                  : INTERVENTIONS[row.risk] || INTERVENTIONS.Low;
                const intervention = rowInterventions[i % rowInterventions.length] || rowInterventions[0];
                return (
                  <tr key={row.barangay} className="transition hover:bg-slate-50/50 cursor-pointer" style={{ borderTop: '1px solid rgba(148,163,184,.1)' }} onClick={() => setSelectedBarangay(row)}>
                    <td className="px-4 py-3"><RankBadge rank={rank} /></td>
                    <td className="px-4 py-3 font-bold" style={{ color: '#0f172a' }}>{row.barangay}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full" style={{ background: '#f1f5f9', maxWidth: 80 }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(row.priorityScore, 100)}%`, background: riskColors[row.risk] }} />
                        </div>
                        <span className="text-xs font-bold" style={{ color: '#0f172a' }}>{Math.round(row.priorityScore)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><PriorityBadge level={row.risk} /></td>
                    <td className="px-4 py-3 font-semibold" style={{ color: '#475569' }}>{row.cases}</td>
                    <td className="px-4 py-3 font-semibold" style={{ color: '#475569' }}>{row.active}</td>
                    <td className="px-4 py-3 font-semibold" style={{ color: '#10B981' }}>{Math.round(row.successRate)}%</td>
                    <td className="px-4 py-3 text-xs font-semibold" style={{ color: '#475569', maxWidth: 180 }}>{intervention}</td>
                    <td className="px-4 py-3">
                      <button className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-white transition hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)' }} onClick={e => { e.stopPropagation(); setAnalyticsBarangay(row); }}>
                        <i className="ri-bar-chart-grouped-line" /> Analytics
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Row Click Detail Modal ── */}
      {selectedBarangay && !analyticsBarangay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
          <div className="glass-card w-full max-w-2xl max-h-[90vh] overflow-hidden" style={{ background: 'rgba(255,255,255,0.97)' }}>
            <div className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between" style={{ borderBottom: '1px solid rgba(148,163,184,.15)' }}>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: '#64748b' }}>Resource Recommendation</p>
                <h2 className="mt-2 text-xl font-bold tracking-tight" style={{ color: '#0f172a' }}>{selectedBarangay.barangay}</h2>
                <div className="mt-1.5"><PriorityBadge level={getRiskLevel(selectedBarangay.priorityScore)} /></div>
              </div>
              <button onClick={() => setSelectedBarangay(null)} className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-80" style={{ background: '#f1f5f9', color: '#475569' }}>
                <i className="ri-close-line text-base" />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-6 py-6" style={{ maxHeight: '70vh' }}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Priority Score', value: Math.round(selectedBarangay.priorityScore), color: riskColors[getRiskLevel(selectedBarangay.priorityScore)] },
                  { label: 'Total Cases', value: selectedBarangay.cases, color: '#3B82F6' },
                  { label: 'Active Cases', value: selectedBarangay.active, color: '#F59E0B' },
                  { label: 'Success Rate', value: `${Math.round(selectedBarangay.successRate)}%`, color: '#10B981' },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-4 text-center" style={{ background: '#f8fafc', border: '1px solid rgba(148,163,184,0.15)' }}>
                    <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>{s.label}</div>
                    <div className="text-xl font-bold" style={{ color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl p-5" style={{ background: '#f8fafc', border: '1px solid rgba(148,163,184,0.15)' }}>
                <p className="flex items-center gap-2 text-sm font-bold mb-3" style={{ color: '#0f172a' }}><i className="ri-alert-line" style={{ color: '#F59E0B' }} />Current Situation</p>
                <div className="space-y-3 text-sm">
                  {[
                    { label: 'Trend', value: `+${selectedBarangay.cases > 0 ? ((selectedBarangay.forecast - selectedBarangay.cases) / selectedBarangay.cases * 100).toFixed(1) : 0}% increase`, color: '#EF4444' },
                    { label: 'Case Growth', value: `${selectedBarangay.forecast - selectedBarangay.cases} additional cases`, color: '#0f172a' },
                    { label: 'Forecast (Next Mo.)', value: `${selectedBarangay.forecast} cases`, color: '#8B5CF6' },
                    { label: 'Facility', value: `${selectedBarangay.barangay} Health Center`, color: '#2E6FAF' },
                  ].map(f => (
                    <div key={f.label} className="flex items-center justify-between gap-4">
                      <span style={{ color: '#64748b' }}>{f.label}</span>
                      <span className="font-semibold" style={{ color: f.color }}>{f.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl p-5" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                <p className="flex items-center gap-2 text-sm font-bold mb-3" style={{ color: '#92400E' }}><i className="ri-lightbulb-line" />Suggested Interventions</p>
                <div className="space-y-2">
                  {(selectedBarangay.interventions?.length > 0 ? selectedBarangay.interventions : INTERVENTIONS[getRiskLevel(selectedBarangay.priorityScore)] || INTERVENTIONS.Low).map((r, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: '#ffffff', border: '1px solid rgba(148,163,184,0.1)' }}>
                      <i className="ri-checkbox-circle-line text-sm" style={{ color: riskColors[getRiskLevel(selectedBarangay.priorityScore)] }} />
                      <span className="text-xs font-semibold" style={{ color: '#475569' }}>{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Analytics Modal ── */}
      {analyticsBarangay && (
        <AnalyticsModal
          barangay={analyticsBarangay}
          records={records}
          analytics={analytics}
          highRiskAreas={analytics.highRiskAreas}
          onClose={() => setAnalyticsBarangay(null)}
        />
      )}
    </div>
  );
}
