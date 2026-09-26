import { useState, useEffect } from 'react';
import API from '../api/axios';
import { useTheme } from '../theme';

const FACILITY_TYPE_LABELS = {
  HC: 'Health Center',
  PC: 'Puericulture Center',
  ITC: 'Infirmary / Treatment Center',
  Floodway: 'Floodway Health Station',
};

const FACILITY_TYPE_COLORS = {
  HC:       { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
  PC:       { bg: '#F0FDF4', color: '#15803D', border: '#BBF7D0' },
  ITC:      { bg: '#FFF7ED', color: '#C2410C', border: '#FED7AA' },
  Floodway: { bg: '#F5F3FF', color: '#6D28D9', border: '#DDD6FE' },
};

function TypeBadge({ type }) {
  const c = FACILITY_TYPE_COLORS[type] || { bg: '#F1F5F9', color: '#475569', border: '#E2E8F0' };
  return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
      {FACILITY_TYPE_LABELS[type] || type}
    </span>
  );
}

export default function HealthFacilitiesPage() {
  const { t } = useTheme();
  const [facilities, setFacilities] = useState([]);
  const [byBarangay, setByBarangay] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [view, setView] = useState('grouped'); // 'grouped' | 'list'

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get('/api/facilities');
        setFacilities(res.data.facilities || []);
        setByBarangay(res.data.by_barangay || {});
      } catch (err) {
        setError('Failed to load health facilities.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const q = search.trim().toLowerCase();
  const filteredFacilities = facilities.filter(f => {
    const matchesSearch = !q || f.name.toLowerCase().includes(q) || f.barangay_name.toLowerCase().includes(q) || (f.address || '').toLowerCase().includes(q);
    const matchesType = typeFilter === 'all' || f.facility_type === typeFilter;
    return matchesSearch && matchesType;
  });

  // Rebuild grouped view from filtered results
  const filteredGrouped = {};
  for (const f of filteredFacilities) {
    if (!filteredGrouped[f.barangay_name]) filteredGrouped[f.barangay_name] = [];
    filteredGrouped[f.barangay_name].push(f);
  }
  const sortedBarangays = Object.keys(filteredGrouped).sort();

  const cardStyle = {
    background: t.cardSolid,
    border: `1px solid ${t.border}`,
    borderRadius: '12px',
    boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
  };

  return (
    <div className="p-6 space-y-5" style={{ color: t.text }}>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: t.heading }}>Health Facilities</h1>
          <p className="text-[13px] mt-0.5" style={{ color: t.muted }}>
            {loading ? 'Loading…' : `${facilities.length} facilities across ${Object.keys(byBarangay).length} barangays in Pasig City`}
          </p>
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
          {[{ key: 'grouped', icon: 'ri-layout-grid-line', label: 'Grouped' }, { key: 'list', icon: 'ri-list-check', label: 'List' }].map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all"
              style={{
                background: view === v.key ? t.cardSolid : 'transparent',
                color: view === v.key ? t.heading : t.muted,
                boxShadow: view === v.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              <i className={`${v.icon} text-[13px]`} />
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-[13px]" style={{ color: t.muted }} />
          <input
            type="text"
            placeholder="Search facility or barangay…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-[13px] rounded-lg outline-none"
            style={{ background: t.cardSolid, border: `1px solid ${t.border}`, color: t.text }}
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 text-[13px] rounded-lg outline-none"
          style={{ background: t.cardSolid, border: `1px solid ${t.border}`, color: t.text }}
        >
          <option value="all">All Types</option>
          {Object.entries(FACILITY_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-lg text-[13px] flex items-center gap-2" style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' }}>
          <i className="ri-error-warning-line" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <i className="ri-loader-4-line animate-spin text-2xl" style={{ color: t.muted }} />
        </div>
      )}

      {/* No results */}
      {!loading && !error && filteredFacilities.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: t.muted }}>
          <i className="ri-hospital-line text-4xl" />
          <p className="text-[13px]">No facilities match your search.</p>
        </div>
      )}

      {/* GROUPED VIEW */}
      {!loading && !error && view === 'grouped' && filteredFacilities.length > 0 && (
        <div className="space-y-4">
          {sortedBarangays.map(brgy => (
            <div key={brgy} style={cardStyle}>
              {/* Barangay header */}
              <div className="px-5 py-3 flex items-center gap-2 border-b" style={{ borderColor: t.border }}>
                <i className="ri-map-pin-2-fill text-[14px]" style={{ color: '#0F2D52' }} />
                <span className="font-bold text-[14px]" style={{ color: t.heading }}>{brgy}</span>
                <span className="ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: t.surface, color: t.muted, border: `1px solid ${t.border}` }}>
                  {filteredGrouped[brgy].length} {filteredGrouped[brgy].length === 1 ? 'facility' : 'facilities'}
                </span>
              </div>

              {/* Facilities in this barangay */}
              <div className="divide-y" style={{ borderColor: t.border }}>
                {filteredGrouped[brgy].map((f, i) => (
                  <div key={f.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="mt-0.5">
                        <i className="ri-hospital-line text-[15px]" style={{ color: t.muted }} />
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold" style={{ color: t.text }}>{f.name}</p>
                        {f.address && (
                          <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: t.muted }}>
                            <i className="ri-map-pin-line text-[11px]" />
                            {f.address}
                          </p>
                        )}
                      </div>
                    </div>
                    <TypeBadge type={f.facility_type} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* LIST VIEW */}
      {!loading && !error && view === 'list' && filteredFacilities.length > 0 && (
        <div style={cardStyle} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ background: t.surface, borderBottom: `1px solid ${t.border}` }}>
                  <th className="text-left px-5 py-3 font-semibold text-[11px] uppercase tracking-wide" style={{ color: t.muted }}>Facility Name</th>
                  <th className="text-left px-4 py-3 font-semibold text-[11px] uppercase tracking-wide" style={{ color: t.muted }}>Barangay</th>
                  <th className="text-left px-4 py-3 font-semibold text-[11px] uppercase tracking-wide" style={{ color: t.muted }}>Address</th>
                  <th className="text-left px-4 py-3 font-semibold text-[11px] uppercase tracking-wide" style={{ color: t.muted }}>Type</th>
                </tr>
              </thead>
              <tbody>
                {filteredFacilities.map((f, i) => (
                  <tr
                    key={f.id}
                    style={{
                      borderBottom: i < filteredFacilities.length - 1 ? `1px solid ${t.border}` : 'none',
                      background: 'transparent',
                    }}
                  >
                    <td className="px-5 py-3 font-medium" style={{ color: t.text }}>{f.name}</td>
                    <td className="px-4 py-3" style={{ color: t.muted }}>
                      <span className="flex items-center gap-1">
                        <i className="ri-map-pin-line text-[11px]" />
                        {f.barangay_name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px]" style={{ color: t.muted }}>{f.address || '—'}</td>
                    <td className="px-4 py-3"><TypeBadge type={f.facility_type} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
