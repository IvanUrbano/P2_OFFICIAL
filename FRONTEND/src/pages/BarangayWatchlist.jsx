import { useState, useEffect, useMemo } from 'react';
import API from '../api/axios';
import { useTheme } from '../theme';

/* ─── Heat-ramp risk colors (shared with GIS map) ─── */
const RISK_COLORS = {
  High: '#EF4444',
  Medium: '#F97316',
  Low: '#FBBF24',
  'No Data': '#64748B',
};

/* Sorting weight — High first, then score */
const SEVERITY = { High: 3, Medium: 2, Low: 1, 'No Data': 0 };

const formatMonth = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const fmt = (v) => {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
};

function RiskPill({ riskClass, riskScore }) {
  const color = RISK_COLORS[riskClass] || RISK_COLORS['No Data'];
  const isLow = riskClass === 'Low';
  return (
    <div className="flex items-center gap-2">
      <span
        className="px-2.5 py-1 rounded-full text-[11px] font-bold"
        style={{
          background: `${color}1F`,
          color: riskClass === 'No Data' ? '#64748B' : color,
          border: `1px solid ${color}40`,
        }}
      >
        {riskClass}
      </span>
      {riskClass !== 'No Data' && (
        <span className="text-xs font-semibold tabular-nums" style={{ color: isLow ? RISK_COLORS.Low : color }}>
          {fmt(riskScore)}
        </span>
      )}
    </div>
  );
}

function DeltaBadge({ delta }) {
  const { t } = useTheme();
  if (Math.abs(delta) < 0.5) {
    return (
      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md" style={{ color: t.textMuted, background: 'rgba(148,163,184,0.12)' }}>
        → 0
      </span>
    );
  }
  const up = delta > 0;
  const color = up ? '#EF4444' : '#10B981';
  return (
    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md" style={{ color, background: `${color}1F` }}>
      {up ? '▲' : '▼'} {fmt(Math.abs(delta))}
    </span>
  );
}

function TrendCell({ trend }) {
  const map = {
    Increasing: { icon: 'ri-arrow-up-line', color: '#EF4444' },
    Decreasing: { icon: 'ri-arrow-down-line', color: '#10B981' },
    Stable: { icon: 'ri-arrow-right-line', color: '#94A3B8' },
  };
  const t = map[trend] || map.Stable;
  return (
    <div className="flex items-center gap-1.5">
      <i className={t.icon} style={{ color: t.color }} />
      <span className="text-xs font-semibold" style={{ color: t.color }}>{trend}</span>
    </div>
  );
}

function MetricStrip({ list }) {
  const { t } = useTheme();
  return (
    <section className="glass-card flex divide-x divide-slate-900/10">
      {list.map((m) => (
        <div key={m.title} className="flex-1 p-5 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <i className={m.icon} style={{ color: m.color }} />
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: t.textSecondary }}>
              {m.title}
            </span>
          </div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: m.color || t.text }}>
            {m.value}
          </div>
        </div>
      ))}
    </section>
  );
}

export default function BarangayWatchlist() {
  const { t } = useTheme();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('All');
  const [sortKey, setSortKey] = useState('riskScore');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    let alive = true;
    API.get('/api/tb/barangays/watchlist')
      .then((res) => { if (alive) setData(res.data); })
      .catch(() => { if (alive) setError('Failed to load barangay watchlist.'); });
    return () => { alive = false; };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const list = data.watchlist.map((r) => ({
      ...r,
      current: Number(r.current_cases) || 0,
      prev: Number(r.prev_cases) || 0,
      forecast: Number(r.forecasted_count) || 0,
      riskScore: Number(r.risk_score) || 0,
      incidence: Number(r.incidence_per_100k) || 0,
      delta: (Number(r.forecasted_count) || 0) - (Number(r.current_cases) || 0),
    }));

    let filtered = list;
    if (riskFilter !== 'All') filtered = filtered.filter((r) => r.risk_class === riskFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter((r) => r.name.toLowerCase().includes(q));
    }

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'riskScore':
          return dir * ((SEVERITY[a.risk_class] || 0) * 1000 + a.riskScore - ((SEVERITY[b.risk_class] || 0) * 1000 + b.riskScore));
        case 'forecast':
          return dir * (a.forecast - b.forecast);
        case 'delta':
          return dir * (a.delta - b.delta);
        case 'incidence':
          return dir * (a.incidence - b.incidence);
        default:
          return dir * (a[sortKey] - b[sortKey]);
      }
    });
  }, [data, search, riskFilter, sortKey, sortDir]);

  const summary = useMemo(() => {
    if (!data) return null;
    const watch = data.watchlist.map((r) => ({ ...r, current: Number(r.current_cases) || 0, forecast: Number(r.forecasted_count) || 0 }));
    return {
      high: watch.filter((r) => r.risk_class === 'High').length,
      medium: watch.filter((r) => r.risk_class === 'Medium').length,
      cases: watch.reduce((s, r) => s + r.current, 0),
      forecast: watch.reduce((s, r) => s + r.forecast, 0),
    };
  }, [data]);

  const setSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  };

  const SortIcon = ({ k }) => {
    if (sortKey !== k) return <i className="ri-expand-up-down-line text-[10px] opacity-40" />;
    return <i className={sortDir === 'asc' ? 'ri-arrow-up-line text-[10px]' : 'ri-arrow-down-line text-[10px]'} />;
  };

  const th = (k, label, align = 'left') => (
    <th
      onClick={() => setSort(k)}
      className="cursor-pointer select-none px-4 py-3 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap"
      style={{ color: t.textSecondary, textAlign: align }}
    >
      <span className="inline-flex items-center gap-1">
        {label} <SortIcon k={k} />
      </span>
    </th>
  );

  const chips = ['All', 'High', 'Medium', 'Low', 'No Data'];

  return (
    <div className="relative space-y-5">
      {/* ── Summary strip ── */}
      {summary && (
        <MetricStrip
          list={[
            { title: 'High Risk', value: summary.high, icon: 'ri-alarm-warning-line', color: '#C4886A' },
            { title: 'Medium Risk', value: summary.medium, icon: 'ri-error-warning-line', color: '#B8956A' },
            { title: 'Cases This Month', value: fmt(summary.cases), icon: 'ri-heart-pulse-line', color: '#6B7FA3' },
            { title: 'Forecast Next Month', value: fmt(summary.forecast), icon: 'ri-arrow-right-up-line', color: '#6B9E9E' },
          ]}
        />
      )}

      {/* ── Toolbar: search + risk filter + data-as-of ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="flex items-center gap-2 px-3 h-9 rounded-lg flex-1 min-w-[220px] max-w-sm"
          style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}
        >
          <i className="ri-search-line text-sm" style={{ color: t.textMuted }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search barangay…"
            className="bg-transparent outline-none text-sm w-full"
            style={{ color: t.text }}
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {chips.map((c) => {
            const active = riskFilter === c;
            const color = c === 'All' ? t.textSecondary : (RISK_COLORS[c] || t.textMuted);
            return (
              <button
                key={c}
                onClick={() => setRiskFilter(c)}
                className="px-3 h-9 text-xs font-semibold"
                style={{
                  color: active ? '#ffffff' : '#374151',
                  background: active ? '#0F2D52' : '#F3F4F6',
                  border: `1px solid ${active ? '#0F2D52' : '#D1D5DB'}`,
                  borderRadius: 4,
                  transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s',
                }}
              >
                {c}
              </button>
            );
          })}
        </div>

        {data?.periods && (
          <div className="ml-auto text-[11px] font-medium whitespace-nowrap" style={{ color: t.textMuted }}>
            Data as of <span style={{ color: t.textSecondary }}>{formatMonth(data.periods.latest_month)}</span> · Forecast for{' '}
            <span style={{ color: t.textSecondary }}>{formatMonth(data.periods.forecast_period)}</span>
          </div>
        )}
      </div>

      {/* ── Table ── */}
      <div className="glass-card overflow-hidden">
        {error ? (
          <div className="flex flex-col items-center gap-2 py-24">
            <i className="ri-cloud-off-line text-2xl" style={{ color: '#EF4444' }} />
            <p className="text-sm font-semibold" style={{ color: t.text }}>{error}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-24">
            <i className="ri-inbox-line text-2xl" style={{ color: t.textMuted }} />
            <p className="text-sm font-semibold" style={{ color: t.textSecondary }}>
              {search || riskFilter !== 'All' ? 'No barangays match your filters.' : 'No barangay data available.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead style={{ background: t.panel }}>
                <tr>
                  {th('name', 'Barangay')}
                  {th('current', 'Current', 'right')}
                  {th('prev', 'Prev', 'right')}
                  {th('forecast', 'Forecast', 'right')}
                  {th('delta', 'Δ Next', 'right')}
                  {th('riskScore', 'Risk', 'left')}
                  {th('incidence', 'Incidence /100k', 'right')}
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-left whitespace-nowrap" style={{ color: t.textSecondary }}>
                    Trend
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.name}
                    className="transition-colors"
                    style={{
                      background: i % 2 === 1 ? t.tableStripe : 'transparent',
                    }}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-bold" style={{ color: t.text }}>{r.name}</div>
                      <div className="text-[11px]" style={{ color: t.textMuted }}>
                        Pop. {fmt(r.population)} · {fmt(r.total_cases)} all-time
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold tabular-nums text-right" style={{ color: t.text }}>
                      {fmt(r.current)}
                    </td>
                    <td className="px-4 py-3 text-sm tabular-nums text-right" style={{ color: t.textSecondary }}>
                      {fmt(r.prev)}
                    </td>
                    <td className="px-4 py-3 text-sm font-bold tabular-nums text-right" style={{ color: r.forecast > r.current ? '#EF4444' : '#10B981' }}>
                      {fmt(r.forecast)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DeltaBadge delta={r.delta} />
                    </td>
                    <td className="px-4 py-3">
                      <RiskPill riskClass={r.risk_class} riskScore={r.riskScore} />
                    </td>
                    <td className="px-4 py-3 text-sm tabular-nums text-right" style={{ color: t.textSecondary }}>
                      {fmt(r.incidence)}
                    </td>
                    <td className="px-4 py-3">
                      <TrendCell trend={r.trend_direction} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!error && (
        <p className="text-[11px]" style={{ color: t.textMuted }}>
          {rows.length} of {data?.watchlist?.length || 0} barangays · Click a column header to sort · Δ Next = forecasted − current cases
        </p>
      )}
    </div>
  );
}
