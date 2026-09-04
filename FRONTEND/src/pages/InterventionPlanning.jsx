import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import API from '../api/axios';

/* ─── Constants ──────────────────────────────────────────────────────── */

const BARANGAYS = [
  'Bagong Ilog', 'Bagong Katipunan', 'Bambang', 'Buting', 'Caniogan',
  'Dela Paz', 'Kalawaan', 'Kapasigan', 'Kapitolyo', 'Malinao',
  'Manggahan', 'Maybunga', 'Oranbo', 'Palatiw', 'Pinagbuhatan',
  'Pineda', 'Rosario', 'Sagad', 'San Antonio', 'San Joaquin',
  'San Jose', 'San Miguel', 'San Nicolas', 'Santa Cruz', 'Santa Lucia',
  'Santa Rosa', 'Santo Tomas', 'Santolan', 'Sumilang', 'Ugong',
];

const INTERVENTION_TYPES = [
  { key: 'screening', label: 'TB Screening Campaign', icon: 'ri-stethoscope-line' },
  { key: 'contact_tracing', label: 'Contact Tracing', icon: 'ri-user-search-line' },
  { key: 'education', label: 'Community Education', icon: 'ri-book-open-line' },
  { key: 'medicine_allocation', label: 'Medicine Allocation', icon: 'ri-medicine-bottle-line' },
  { key: 'follow_up', label: 'Follow-up Missed Treatments', icon: 'ri-calendar-check-line' },
];

const PRIORITY_STYLES = {
  high: { label: 'High', color: '#991B1B', bg: '#FEF2F2', textColor: '#991B1B' },
  medium: { label: 'Medium', color: '#92400E', bg: '#FFFBEB', textColor: '#92400E' },
  low: { label: 'Low', color: '#047857', bg: '#ECFDF5', textColor: '#047857' },
};

const STATUS_STYLES = {
  pending: { label: 'Pending', color: '#92400E', bg: '#FFFBEB', icon: 'ri-time-line' },
  in_progress: { label: 'In Progress', color: '#1E40AF', bg: '#EFF6FF', icon: 'ri-loader-4-line' },
  completed: { label: 'Completed', color: '#047857', bg: '#ECFDF5', icon: 'ri-check-double-line' },
};

const STATUS_TABS = [
  { key: 'all', title: 'All', desc: 'All interventions' },
  { key: 'pending', title: 'Pending', desc: 'Awaiting action' },
  { key: 'in_progress', title: 'In Progress', desc: 'Currently active' },
  { key: 'completed', title: 'Completed', desc: 'Finished actions' },
  { key: 'overdue', title: 'Overdue', desc: 'Past target date' },
];

/* ─── Helper Components ──────────────────────────────────────────────── */

function FilterSelect({ label, value, onChange, children }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none" style={{ color: '#94A3B8' }}>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg pr-7 py-[7px] text-[11px] font-semibold outline-none transition cursor-pointer appearance-none"
        style={{
          background: '#ffffff',
          color: '#0F2D52',
          border: '1px solid #E2E8F0',
          paddingLeft: `${(label.length * 6.5) + 24}px`,
        }}
      >
        {children}
      </select>
      <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style={{ color: '#64748B' }} />
    </div>
  );
}

import SkeletonBlock from '../../components/SkeletonBlock';

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isOverdue(targetDate, status) {
  if (!targetDate || status === 'completed') return false;
  return new Date(targetDate) < new Date();
}

/* ─── Main Component ─────────────────────────────────────────────────── */

const EMPTY_FORM = {
  title: '', description: '', intervention_type: 'screening',
  barangay_name: '', priority: 'medium', assigned_to: '',
  team: '', target_date: '', related_alert_id: null,
};

export default function InterventionPlanning() {
  const [searchParams, setSearchParams] = useSearchParams();

  /* ── Filter state ── */
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterBarangay, setFilterBarangay] = useState('');
  const [filterType, setFilterType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  /* ── Data state ── */
  const [interventions, setInterventions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState({ total: 0, pending: 0, in_progress: 0, completed: 0, overdue: 0 });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  /* ── Modal state ── */
  const [selectedIntervention, setSelectedIntervention] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [saving, setSaving] = useState(false);

  /* ── Form state ── */
  const [form, setForm] = useState(EMPTY_FORM);

  /* ── Debounce search ── */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  /* ── Pre-fill from URL params (e.g. from Alert page) ── */
  useEffect(() => {
    const alertId = searchParams.get('alert_id');
    const barangay = searchParams.get('barangay');
    const recommendation = searchParams.get('recommendation');
    if (alertId || barangay) {
      const typeGuess = recommendation?.toLowerCase().includes('screen') ? 'screening'
        : recommendation?.toLowerCase().includes('trac') ? 'contact_tracing'
        : recommendation?.toLowerCase().includes('educ') ? 'education'
        : recommendation?.toLowerCase().includes('medic') ? 'medicine_allocation'
        : recommendation?.toLowerCase().includes('follow') ? 'follow_up'
        : 'screening';
      setForm(f => ({
        ...f,
        barangay_name: barangay || f.barangay_name,
        intervention_type: typeGuess,
        related_alert_id: alertId ? Number(alertId) : null,
        title: recommendation ? recommendation.slice(0, 80) : f.title,
        description: recommendation || f.description,
      }));
      setShowCreateModal(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleStatusChange = useCallback((newStatus) => {
    setFilterStatus(newStatus);
    setPage(1);
  }, []);

  /* ── Fetch ── */

  const fetchInterventions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, limit: 20 };
      if (filterStatus !== 'all') params.status = filterStatus;
      if (filterPriority !== 'all') params.priority = filterPriority;
      if (filterBarangay) params.barangay = filterBarangay;
      if (filterType) params.type = filterType;
      if (debouncedSearch) params.search = debouncedSearch;

      const [listRes, countsRes] = await Promise.all([
        API.get('/api/tb/interventions', { params }),
        API.get('/api/tb/interventions/counts'),
      ]);

      setInterventions(listRes.data.interventions || []);
      setPagination(listRes.data.pagination || { total: 0, totalPages: 1 });
      setSummary(countsRes.data || { total: 0, pending: 0, in_progress: 0, completed: 0, overdue: 0 });
    } catch (err) {
      console.error('Interventions fetch error:', err);
      setError('Interventions could not be retrieved. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, filterPriority, filterBarangay, filterType, debouncedSearch]);

  useEffect(() => { fetchInterventions(); }, [fetchInterventions]);

  /* ── Handlers ── */

  const handleApply = useCallback(() => {
    setPage(1);
  }, []);

  const handleReset = useCallback(() => {
    setFilterStatus('all');
    setFilterPriority('all');
    setFilterBarangay('');
    setFilterType('');
    setSearchQuery('');
    setPage(1);
  }, []);

  const handleViewDetail = async (intervention) => {
    setDetailLoading(true);
    try {
      const res = await API.get(`/api/tb/interventions/${intervention.id}`);
      setSelectedIntervention(res.data.intervention);
    } catch (err) {
      console.error('Detail fetch error:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!form.title || !form.intervention_type || !form.barangay_name) return;
    setSaving(true);
    try {
      const storedUser = localStorage.getItem('user');
      const username = storedUser ? JSON.parse(storedUser).username : null;
      const payload = { ...form, created_by: username };
      if (form.related_alert_id) payload.related_alert_id = form.related_alert_id;
      const res = await API.post('/api/tb/interventions', payload);
      if (res.data.id) {
        setShowCreateModal(false);
        setForm(EMPTY_FORM);
        await fetchInterventions();
      }
    } catch (err) {
      console.error('Create error:', err);
      const msg = err.response?.data?.error || 'Failed to create intervention. Please try again.';
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedIntervention) return;
    setSaving(true);
    try {
      await API.put(`/api/tb/interventions/${selectedIntervention.id}`, form);
      setShowEditModal(false);
      setSelectedIntervention(null);
      setForm(EMPTY_FORM);
      await fetchInterventions();
    } catch (err) {
      console.error('Update error:', err);
      const msg = err.response?.data?.error || 'Failed to update intervention. Please try again.';
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusUpdate = async (id, newStatus) => {
    try {
      await API.put(`/api/tb/interventions/${id}`, { status: newStatus });
      setInterventions(prev => prev.map(i => i.id === id ? { ...i, status: newStatus, completed_at: newStatus === 'completed' ? new Date().toISOString() : i.completed_at } : i));
      setSelectedIntervention(prev => prev?.id === id ? { ...prev, status: newStatus, completed_at: newStatus === 'completed' ? new Date().toISOString() : prev.completed_at } : prev);
      // Refresh counts
      const countsRes = await API.get('/api/tb/interventions/counts');
      setSummary(countsRes.data || { total: 0, pending: 0, in_progress: 0, completed: 0, overdue: 0 });
    } catch (err) {
      console.error('Status update error:', err);
      alert('Failed to update status. Please try again.');
    }
  };

  const handleDelete = async (id) => {
    try {
      await API.delete(`/api/tb/interventions/${id}`);
      setInterventions(prev => prev.filter(i => i.id !== id));
      setSelectedIntervention(null);
      setDeleteConfirm(null);
      const countsRes = await API.get('/api/tb/interventions/counts');
      setSummary(countsRes.data || { total: 0, pending: 0, in_progress: 0, completed: 0, overdue: 0 });
    } catch (err) {
      console.error('Delete error:', err);
      alert('Failed to delete intervention. Please try again.');
    }
  };

  const openEditModal = () => {
    if (!selectedIntervention) return;
    setForm({
      title: selectedIntervention.title || '',
      description: selectedIntervention.description || '',
      intervention_type: selectedIntervention.intervention_type || 'screening',
      barangay_name: selectedIntervention.barangay_name || '',
      priority: selectedIntervention.priority || 'medium',
      assigned_to: selectedIntervention.assigned_to || '',
      team: selectedIntervention.team || '',
      target_date: selectedIntervention.target_date ? selectedIntervention.target_date.slice(0, 10) : '',
    });
    setShowEditModal(true);
  };

  const storedUser = (() => {
    const s = localStorage.getItem('user');
    return s ? JSON.parse(s) : null;
  })();

  const getTypeInfo = (key) => INTERVENTION_TYPES.find(t => t.key === key) || INTERVENTION_TYPES[0];

  /* ────────── Render ────────── */

  return (
    <div className="space-y-6">

      {/* ─── Page Header + Tabs + Filters ─── */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)' }}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-3.5" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Intervention & Action Planning</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Create and manage TB interventions for Pasig City barangays.</p>
          </div>
          <button
            onClick={() => { setForm(EMPTY_FORM); setShowCreateModal(true); }}
            className="px-4 py-2 text-xs font-semibold shrink-0"
            style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; }}
          >
            <i className="ri-add-line mr-1" />
            New Intervention
          </button>
        </div>

        {/* Tabs */}
        <div style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div className="flex gap-0 overflow-x-auto">
            {STATUS_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => handleStatusChange(tab.key)}
                className="relative px-6 py-3 text-left transition-colors whitespace-nowrap"
                style={{ background: 'transparent' }}
              >
                <p className="text-[13px] font-bold" style={{ color: filterStatus === tab.key ? '#0F2D52' : '#94A3B8' }}>
                  {tab.title}
                  {tab.key === 'pending' && summary.pending > 0 && (
                     <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[9px] font-bold px-1.5" style={{ background: '#FFFBEB', color: '#92400E' }}>
                      {summary.pending}
                    </span>
                  )}
                  {tab.key === 'in_progress' && summary.in_progress > 0 && (
                     <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[9px] font-bold px-1.5" style={{ background: '#EFF6FF', color: '#1E40AF' }}>
                      {summary.in_progress}
                    </span>
                  )}
                  {tab.key === 'completed' && summary.completed > 0 && (
                     <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[9px] font-bold px-1.5" style={{ background: '#ECFDF5', color: '#047857' }}>
                      {summary.completed}
                    </span>
                  )}
                  {tab.key === 'overdue' && summary.overdue > 0 && (
                     <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[9px] font-bold px-1.5" style={{ background: '#FEF2F2', color: '#991B1B' }}>
                      {summary.overdue}
                    </span>
                  )}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: filterStatus === tab.key ? '#64748B' : '#CBD5E1' }}>
                  {tab.desc}
                </p>
                {filterStatus === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="px-6 py-3" style={{ background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <FilterSelect label="Priority" value={filterPriority} onChange={setFilterPriority}>
              <option value="all">All Priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </FilterSelect>

            <FilterSelect label="Barangay" value={filterBarangay} onChange={setFilterBarangay}>
              <option value="">All Barangays</option>
              {BARANGAYS.map(b => <option key={b} value={b}>{b}</option>)}
            </FilterSelect>

            <FilterSelect label="Type" value={filterType} onChange={setFilterType}>
              <option value="">All Types</option>
              {INTERVENTION_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </FilterSelect>

            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="rounded-lg px-3 py-[7px] text-[11px] font-semibold outline-none transition"
                style={{ background: '#ffffff', color: '#0F2D52', border: '1px solid #E2E8F0', width: 160 }}
              />
            </div>

            <div className="flex items-center gap-1.5 ml-auto">
              <button onClick={handleReset}
                className="px-3 py-2 text-xs font-medium"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}>
                Clear
              </button>
              <button onClick={handleApply}
                className="px-4 py-2 text-xs font-semibold"
                style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}>
                {loading ? 'Loading...' : 'Apply Filters'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Loading State ─── */}
      {loading && (
        <div className="space-y-4">
          <div className="rounded-xl p-6" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="rounded-lg p-3" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <SkeletonBlock className="h-3 w-16 mb-2" />
                  <SkeletonBlock className="h-6 w-10" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl p-4" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
            {[1, 2, 3].map(i => <SkeletonBlock key={i} className="h-14 w-full mb-2" />)}
          </div>
        </div>
      )}

      {/* ─── Error State ─── */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-4" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #E2E8F0' }}>
           <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#FEF2F2' }}>
            <i className="ri-error-warning-line text-2xl" style={{ color: '#EF4444' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-bold" style={{ color: '#475569' }}>Unable to Load Interventions</p>
            <p className="text-xs mt-1 max-w-md" style={{ color: '#94A3B8' }}>{error}</p>
          </div>
          <button onClick={fetchInterventions} className="px-3 py-1.5 text-xs font-semibold" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 }}>
            Retry
          </button>
        </div>
      )}

      {/* ─── Summary Cards ─── */}
      {!loading && !error && (
        <div className="rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15,45,82,0.12), 0 2px 8px rgba(15,45,82,0.08)' }}>
          <div className="grid grid-cols-2 lg:grid-cols-5">
            {[
              { icon: 'ri-task-line', label: 'Total', value: summary.total, color: '#0F2D52', subtitle: 'All interventions' },
               { icon: 'ri-time-line', label: 'Pending', value: summary.pending, color: '#92400E', subtitle: 'Awaiting action' },
              { icon: 'ri-loader-4-line', label: 'In Progress', value: summary.in_progress, color: '#2563EB', subtitle: 'Currently active' },
               { icon: 'ri-check-double-line', label: 'Completed', value: summary.completed, color: '#047857', subtitle: summary.total > 0 ? `${Math.round((summary.completed / summary.total) * 100)}% completion` : 'No data' },
               { icon: 'ri-alarm-warning-line', label: 'Overdue', value: summary.overdue, color: '#991B1B', subtitle: 'Past target date' },
            ].map((card, idx) => (
              <div key={card.label} className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className={`${card.icon} text-sm`} style={{ color: card.color }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>{card.label}</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{card.value}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{card.subtitle}</span>
                {idx < 4 && <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Empty State ─── */}
      {!loading && !error && interventions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #E2E8F0' }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#F1F5F9' }}>
            <i className="ri-first-aid-kit-line text-2xl" style={{ color: '#CBD5E1' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-bold" style={{ color: '#475569' }}>No Interventions Found</p>
            <p className="text-xs mt-1 max-w-sm" style={{ color: '#94A3B8' }}>
              {filterStatus !== 'all' || filterPriority !== 'all' || filterBarangay || filterType || searchQuery
                ? 'No interventions match the selected filters.'
                : 'Create your first intervention to start tracking TB response actions.'}
            </p>
          </div>
          {(filterStatus !== 'all' || filterPriority !== 'all' || filterBarangay || filterType || searchQuery) ? (
            <button onClick={handleReset} className="px-3 py-1.5 text-xs font-semibold" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 }}>
              Clear Filters
            </button>
          ) : (
            <button onClick={() => { setForm(EMPTY_FORM); setShowCreateModal(true); }} className="px-3 py-1.5 text-xs font-semibold" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 }}>
              <i className="ri-add-line mr-1" />
              New Intervention
            </button>
          )}
        </div>
      )}

      {/* ─── Intervention Table ─── */}
      {!loading && !error && interventions.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#0F2D52' }}>
                  {['Priority', 'Title', 'Type', 'Barangay', 'Assigned To', 'Target Date', 'Status', 'Action'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: '#ffffff' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {interventions.map((item) => {
                  const pri = PRIORITY_STYLES[item.priority] || PRIORITY_STYLES.medium;
                  const sts = STATUS_STYLES[item.status] || STATUS_STYLES.pending;
                  const typeInfo = getTypeInfo(item.intervention_type);
                  const overdue = isOverdue(item.target_date, item.status);
                  return (
                    <tr key={item.id} onClick={() => handleViewDetail(item)} className="cursor-pointer" style={{ borderBottom: '1px solid #F1F5F9', background: overdue ? 'rgba(220,38,38,0.02)' : '#ffffff' }}>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: pri.bg, color: pri.textColor }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: pri.color }} />
                          {pri.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-semibold" style={{ color: '#0F2D52' }}>{item.title}</span>
                        {item.description && <p className="text-[11px] mt-0.5 max-w-xs truncate" style={{ color: '#64748B' }}>{item.description}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: '#64748B' }}>
                          <i className={`${typeInfo.icon} text-sm`} style={{ color: '#94A3B8' }} />
                          {typeInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[11px] font-medium" style={{ color: '#64748B' }}>
                        {item.barangay_name}
                      </td>
                      <td className="px-4 py-3 text-[11px] font-medium" style={{ color: '#64748B' }}>
                        {item.assigned_to || '\u2014'}
                      </td>
                      <td className="px-4 py-3">
                         <span className="text-[11px] font-medium" style={{ color: overdue ? '#991B1B' : '#94A3B8' }}>
                          {overdue && <i className="ri-alarm-warning-line mr-1" />}
                          {formatDate(item.target_date)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: sts.bg, color: sts.color }}>
                          <i className={`${sts.icon} text-[10px]`} />
                          {overdue && item.status !== 'completed' ? 'Overdue' : sts.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          aria-label="View intervention"
                          onClick={() => handleViewDetail(item)}
                          className="inline-flex items-center justify-center h-6 w-6 text-sm"
                          style={{ color: '#64748B', borderRadius: 4, transition: 'color 0.15s' }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#0F2D52'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#64748B'; }}
                        >
                          <i className="ri-eye-line" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid #F1F5F9' }}>
              <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>
                Showing {(page - 1) * 20 + 1}\u2013{Math.min(page * 20, pagination.total)} of {pagination.total}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2.5 py-1 text-[11px] font-semibold rounded"
                  style={{ background: page === 1 ? '#F3F4F6' : '#0F2D52', color: page === 1 ? '#CBD5E1' : '#ffffff', cursor: page === 1 ? 'not-allowed' : 'pointer' }}
                >
                  Prev
                </button>
                <span className="text-[11px] font-medium px-2" style={{ color: '#64748B' }}>
                  {page} / {pagination.totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                  disabled={page >= pagination.totalPages}
                  className="px-2.5 py-1 text-[11px] font-semibold rounded"
                  style={{ background: page >= pagination.totalPages ? '#F3F4F6' : '#0F2D52', color: page >= pagination.totalPages ? '#CBD5E1' : '#ffffff', cursor: page >= pagination.totalPages ? 'not-allowed' : 'pointer' }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Detail Side Panel ─── */}
      {(selectedIntervention || detailLoading) && (
        <div className="fixed inset-0 z-[1100] flex justify-end" onClick={() => setSelectedIntervention(null)}>
          <div className="absolute inset-0" style={{ background: 'rgba(15,23,42,0.2)', backdropFilter: 'blur(4px)' }} />
          <div
            className="relative w-full max-w-lg flex flex-col"
            style={{ background: '#ffffff', animation: 'slide-in-right 0.3s ease-out both', boxShadow: '-8px 0 30px rgba(0,0,0,0.12)' }}
            onClick={e => e.stopPropagation()}
          >
            {detailLoading ? (
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <SkeletonBlock className="h-6 w-40" />
                <SkeletonBlock className="h-4 w-full" />
                <SkeletonBlock className="h-4 w-3/4" />
                <SkeletonBlock className="h-20 w-full" />
              </div>
            ) : selectedIntervention && (
              <>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ background: '#0F2D52' }}>
                  <div>
                    <p className="text-sm font-bold" style={{ color: '#ffffff' }}>{selectedIntervention.title}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>Intervention Detail</p>
                  </div>
                  <button onClick={() => setSelectedIntervention(null)} className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.15)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, transition: 'background 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}>
                    <i className="ri-close-line text-base" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                  {/* Badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {(() => {
                      const pri = PRIORITY_STYLES[selectedIntervention.priority] || PRIORITY_STYLES.medium;
                      const sts = STATUS_STYLES[selectedIntervention.status] || STATUS_STYLES.pending;
                      const overdue = isOverdue(selectedIntervention.target_date, selectedIntervention.status);
                      return (
                        <>
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: pri.bg, color: pri.textColor }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: pri.color }} />
                            {pri.label} Priority
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: sts.bg, color: sts.color }}>
                            <i className={`${sts.icon} text-[10px]`} />
                            {overdue && selectedIntervention.status !== 'completed' ? 'Overdue' : sts.label}
                          </span>
                        </>
                      );
                    })()}
                  </div>

                  {/* Detail Fields */}
                  <div className="space-y-3">
                    {[
                      { label: 'Type', value: getTypeInfo(selectedIntervention.intervention_type).label },
                      { label: 'Barangay', value: selectedIntervention.barangay_name },
                      { label: 'Assigned To', value: selectedIntervention.assigned_to },
                      { label: 'Team', value: selectedIntervention.team },
                      { label: 'Target Date', value: formatDate(selectedIntervention.target_date) },
                      { label: 'Created', value: formatDate(selectedIntervention.created_at) },
                      { label: 'Completed', value: selectedIntervention.completed_at ? formatDate(selectedIntervention.completed_at) : null },
                    ].filter(f => f.value).map(field => (
                      <div key={field.label} className="flex items-start gap-3">
                        <span className="text-[11px] font-semibold w-28 shrink-0 pt-0.5" style={{ color: '#94A3B8' }}>{field.label}</span>
                        <span className="text-xs font-medium" style={{ color: '#0F2D52' }}>{field.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Description */}
                  {selectedIntervention.description && (
                    <div>
                      <p className="text-[11px] font-semibold mb-1.5" style={{ color: '#94A3B8' }}>Description</p>
                      <p className="text-xs leading-relaxed" style={{ color: '#334155' }}>{selectedIntervention.description}</p>
                    </div>
                  )}

                  {/* Linked Alert */}
                  {selectedIntervention.related_alert_id && (
                     <div className="rounded-lg p-3 flex items-center gap-3" style={{ background: '#F1F5F9', border: '1px solid #E2E8F0' }}>
                      <i className="ri-alarm-warning-line text-lg" style={{ color: '#2563EB' }} />
                      <div>
                        <p className="text-[11px] font-bold" style={{ color: '#1E40AF' }}>Linked to Alert #{selectedIntervention.related_alert_id}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: '#3B82F6' }}>This intervention was created from a system alert.</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="shrink-0 px-6 py-4 flex items-center gap-2 flex-wrap" style={{ borderTop: '1px solid #E2E8F0', background: '#ffffff' }}>
                  {selectedIntervention.status === 'pending' && (
                    <button
                      onClick={() => handleStatusUpdate(selectedIntervention.id, 'in_progress')}
                      className="px-3 py-1.5 text-xs font-semibold"
                      style={{ background: '#2563EB', color: '#ffffff', border: '1px solid #2563EB', borderRadius: 4, transition: 'background 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#1D4ED8'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#2563EB'; }}
                    >
                      <i className="ri-play-line mr-1" />
                      Start
                    </button>
                  )}
                  {selectedIntervention.status === 'in_progress' && (
                    <button
                      onClick={() => handleStatusUpdate(selectedIntervention.id, 'completed')}
                      className="px-3 py-1.5 text-xs font-semibold"
                       style={{ background: '#047857', color: '#ffffff', border: '1px solid #047857', borderRadius: 4, transition: 'background 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#047857'; }}
                       onMouseLeave={e => { e.currentTarget.style.background = '#047857'; }}
                    >
                      <i className="ri-check-line mr-1" />
                      Complete
                    </button>
                  )}
                  <button
                    onClick={openEditModal}
                    className="px-3 py-1.5 text-xs font-medium"
                    style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}
                  >
                    <i className="ri-edit-line mr-1" />
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(selectedIntervention)}
                    className="px-3 py-1.5 text-xs font-medium"
                     style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', borderRadius: 4 }}
                  >
                    <i className="ri-delete-bin-line mr-1" />
                    Delete
                  </button>
                  <button
                    onClick={() => setSelectedIntervention(null)}
                    className="ml-auto px-3 py-1.5 text-xs font-medium"
                    style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── Create / Edit Side Panel ─── */}
      {(showCreateModal || showEditModal) && (
        <div className="fixed inset-0 z-[1200] flex justify-end" onClick={() => { setShowCreateModal(false); setShowEditModal(false); }}>
          <div className="absolute inset-0" style={{ background: 'rgba(15,23,42,0.2)', backdropFilter: 'blur(4px)' }} />
          <div
            className="relative w-full max-w-lg flex flex-col"
            style={{ background: '#ffffff', animation: 'slide-in-right 0.3s ease-out both', boxShadow: '-8px 0 30px rgba(0,0,0,0.12)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Panel Header */}
            <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ background: '#0F2D52' }}>
              <div>
                <p className="text-sm font-bold" style={{ color: '#ffffff' }}>{showEditModal ? 'Edit Intervention' : 'New Intervention'}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>{showEditModal ? 'Update intervention details' : 'Create a new TB intervention'}</p>
              </div>
              <button onClick={() => { setShowCreateModal(false); setShowEditModal(false); }} className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.15)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, transition: 'background 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}>
                <i className="ri-close-line text-base" />
              </button>
            </div>

            {/* Form Fields */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Linked Alert Banner */}
              {form.related_alert_id && (
                 <div className="rounded-lg p-3 flex items-center gap-3" style={{ background: '#F1F5F9', border: '1px solid #E2E8F0' }}>
                  <i className="ri-alarm-warning-line text-lg" style={{ color: '#2563EB' }} />
                  <div className="flex-1">
                    <p className="text-[11px] font-bold" style={{ color: '#1E40AF' }}>Linked from Alert #{form.related_alert_id}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: '#3B82F6' }}>This intervention is created from a system alert.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, related_alert_id: null }))}
                    className="text-[10px] font-semibold px-2 py-1 rounded"
                     style={{ background: '#E2E8F0', color: '#374151' }}
                  >
                    Unlink
                  </button>
                </div>
              )}
              {/* Title */}
              <div>
                <label className="text-[11px] font-semibold block mb-1.5" style={{ color: '#94A3B8' }}>Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. TB Screening Campaign"
                  className="w-full rounded-lg px-3 py-2 text-xs outline-none"
                  style={{ border: '1px solid #E2E8F0', color: '#0F2D52' }}
                />
              </div>

              {/* Type + Barangay */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold block mb-1.5" style={{ color: '#94A3B8' }}>Type *</label>
                  <select
                    value={form.intervention_type}
                    onChange={e => setForm(f => ({ ...f, intervention_type: e.target.value }))}
                    className="w-full rounded-lg px-3 py-2 text-xs outline-none cursor-pointer"
                    style={{ border: '1px solid #E2E8F0', color: '#0F2D52' }}
                  >
                    {INTERVENTION_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold block mb-1.5" style={{ color: '#94A3B8' }}>Barangay *</label>
                  <select
                    value={form.barangay_name}
                    onChange={e => setForm(f => ({ ...f, barangay_name: e.target.value }))}
                    className="w-full rounded-lg px-3 py-2 text-xs outline-none cursor-pointer"
                    style={{ border: '1px solid #E2E8F0', color: '#0F2D52' }}
                  >
                    <option value="">Select Barangay</option>
                    {BARANGAYS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>

              {/* Priority */}
              <div>
                <label className="text-[11px] font-semibold block mb-1.5" style={{ color: '#94A3B8' }}>Priority</label>
                <select
                  value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-xs outline-none cursor-pointer"
                  style={{ border: '1px solid #E2E8F0', color: '#0F2D52' }}
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              {/* Assigned To + Team */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold block mb-1.5" style={{ color: '#94A3B8' }}>Assigned To</label>
                  <input
                    type="text"
                    value={form.assigned_to}
                    onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
                    placeholder="Officer name"
                    className="w-full rounded-lg px-3 py-2 text-xs outline-none"
                    style={{ border: '1px solid #E2E8F0', color: '#0F2D52' }}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold block mb-1.5" style={{ color: '#94A3B8' }}>Team</label>
                  <input
                    type="text"
                    value={form.team}
                    onChange={e => setForm(f => ({ ...f, team: e.target.value }))}
                    placeholder="Team name"
                    className="w-full rounded-lg px-3 py-2 text-xs outline-none"
                    style={{ border: '1px solid #E2E8F0', color: '#0F2D52' }}
                  />
                </div>
              </div>

              {/* Target Date */}
              <div>
                <label className="text-[11px] font-semibold block mb-1.5" style={{ color: '#94A3B8' }}>Target Date</label>
                <input
                  type="date"
                  value={form.target_date}
                  onChange={e => setForm(f => ({ ...f, target_date: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-xs outline-none"
                  style={{ border: '1px solid #E2E8F0', color: '#0F2D52' }}
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-[11px] font-semibold block mb-1.5" style={{ color: '#94A3B8' }}>Description / Reason</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Describe the intervention and why it's needed..."
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-xs outline-none resize-none"
                  style={{ border: '1px solid #E2E8F0', color: '#0F2D52' }}
                />
              </div>
            </div>

            {/* Panel Footer */}
            <div className="shrink-0 px-6 py-4 flex items-center gap-2" style={{ borderTop: '1px solid #E2E8F0', background: '#ffffff' }}>
              <button
                onClick={showEditModal ? handleUpdate : handleCreate}
                className="px-4 py-2 text-xs font-semibold"
                style={{
                  background: '#0F2D52',
                  color: '#ffffff',
                  border: '1px solid #0F2D52', borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {saving ? 'Saving...' : showEditModal ? 'Update' : 'Create'}
              </button>
              <button
                onClick={() => { setShowCreateModal(false); setShowEditModal(false); }}
                className="px-3 py-1.5 text-xs font-medium"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Delete Confirmation Modal ─── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center" onClick={() => setDeleteConfirm(null)}>
          <div className="absolute inset-0" style={{ background: 'rgba(15,23,42,0.3)', backdropFilter: 'blur(4px)' }} />
          <div
            className="relative w-full max-w-sm rounded-xl p-6"
            style={{ background: '#ffffff', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
               <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: '#FEF2F2' }}>
                 <i className="ri-delete-bin-line text-lg" style={{ color: '#991B1B' }} />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: '#0F2D52' }}>Delete Intervention?</p>
                <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-xs mb-5" style={{ color: '#64748B' }}>
              Are you sure you want to delete <span className="font-semibold" style={{ color: '#0F2D52' }}>"{deleteConfirm.title}"</span>?
            </p>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1.5 text-xs font-medium"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm.id)}
                className="px-4 py-1.5 text-xs font-semibold"
                 style={{ background: '#991B1B', color: '#ffffff', border: '1px solid #991B1B', borderRadius: 4, transition: 'background 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#B91C1C'; }}
                 onMouseLeave={e => { e.currentTarget.style.background = '#991B1B'; }}
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
