import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import { useTheme } from '../theme';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import SkeletonBlock from '../components/SkeletonBlock';
import FilterSelect from '../components/FilterSelect';

const cardStyle = (t) => ({
  background: t.cardSolid,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});

const STATUS_TABS = [
  { key: 'all', title: 'All', desc: 'All records' },
  { key: 'valid', title: 'Valid', desc: 'Validated records' },
  { key: 'invalid', title: 'Invalid', desc: 'Failed validation' },
  { key: 'pending', title: 'Pending', desc: 'Awaiting review' },
];

export default function TBRecordsPage() {
  const { t } = useTheme();
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const perPage = 20;

  const fetchRecords = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await API.get('/api/data/records');
      setRecords(Array.isArray(res.data.records) ? res.data.records : (Array.isArray(res.data) ? res.data : []));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRecords(); }, []);

  const filtered = records.filter((r) => {
    const matchSearch = !search || [r.barangay_name, r.city, r.source_type, r.sex].some(f => f?.toLowerCase().includes(search.toLowerCase()));
    const matchFilter = filter === 'all' || r.validation_status?.toLowerCase() === filter || (filter === 'valid' && r.is_valid) || (filter === 'invalid' && !r.is_valid);
    return matchSearch && matchFilter;
  });

  const counts = {
    all: records.length,
    valid: records.filter(r => r.is_valid).length,
    invalid: records.filter(r => !r.is_valid).length,
    pending: records.filter(r => r.validation_status?.toLowerCase() === 'pending').length,
  };

  const totalPages = Math.ceil(filtered.length / perPage);
  const paged = filtered.slice((page - 1) * perPage, page * perPage);

  if (loading) return <div className="space-y-4"><SkeletonBlock className="h-12" /><SkeletonBlock className="h-96" /></div>;
  if (error) return <ErrorState message={error} onRetry={fetchRecords} />;

  return (
    <div className="space-y-5">
      {/* Card Header with Tabs */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        {/* Title Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>TB Records</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>View and manage imported tuberculosis records.</p>
          </div>
          <button onClick={() => navigate('/import')} className="px-4 py-2 text-xs font-semibold shrink-0 flex items-center gap-2" style={{ background: '#0F2D52', color: '#ffffff', borderRadius: 4, transition: 'background 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; }} onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; }}>
            Import Data
          </button>
        </div>

        {/* Tabs */}
        <div style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div className="flex gap-0 overflow-x-auto">
            {STATUS_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => { setFilter(tab.key); setPage(1); }}
                className="relative px-6 py-3 text-left transition-colors whitespace-nowrap"
                style={{ background: 'transparent' }}
              >
                <p className="text-[13px] font-bold" style={{ color: filter === tab.key ? '#0F2D52' : '#94A3B8' }}>
                  {tab.title}
                  {counts[tab.key] > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[9px] font-bold px-1.5" style={{ background: filter === tab.key ? 'rgba(15,45,82,0.08)' : '#F1F5F9', color: filter === tab.key ? '#0F2D52' : '#64748B' }}>
                      {counts[tab.key]}
                    </span>
                  )}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: filter === tab.key ? '#64748B' : '#CBD5E1' }}>
                  {tab.desc}
                </p>
                {filter === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Search Bar */}
        <div className="px-6 py-3" style={{ background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
          <div className="relative max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#94A3B8' }} />
            <input
              type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by barangay, city, sex, source..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg outline-none"
              style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' }}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: '#FAFCFF', borderBottom: '1px solid #E2E8F0' }}>
                {['Barangay', 'City', 'Source', 'Diagnosis Date', 'Sex', 'Age', 'Status', 'Record'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider" style={{ color: '#0F2D52' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr><td colSpan={8}><EmptyState icon="ri-file-list-line" title="No Records Found" description="There are no records matching your current filters." /></td></tr>
              ) : paged.map((r) => (
                <tr key={r.id} className="hover:bg-blue-50/40 transition-colors" style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: '#0F2D52' }}>{r.barangay_name || '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{r.city || '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{r.source_type}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{r.date_of_diagnosis ? new Date(r.date_of_diagnosis).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{r.sex || '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{r.age || '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.is_valid ? 'Validated' : 'Invalid'} /></td>
                  <td className="px-4 py-3"><StatusBadge status={r.record_status || 'new'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid #E2E8F0', background: '#FAFCFF' }}>
            <span className="text-[11px] font-medium" style={{ color: '#64748B' }}>Page {page} of {totalPages} ({filtered.length} records)</span>
            <div className="flex gap-1.5">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1.5 text-[11px] font-bold rounded-md disabled:opacity-40 transition-colors cursor-pointer" style={{ border: '1px solid #CBD5E1', background: '#ffffff', color: '#0F2D52' }}>Prev</button>
              <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="px-3 py-1.5 text-[11px] font-bold rounded-md disabled:opacity-40 transition-colors cursor-pointer" style={{ border: '1px solid #CBD5E1', background: '#ffffff', color: '#0F2D52' }}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
