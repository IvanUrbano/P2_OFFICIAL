import { useState, useEffect } from 'react';
import API from '../api/axios';
import { useTheme } from '../theme';
import FilterSelect from '../components/FilterSelect';
import TablePagination from '../components/TablePagination';
import StatusBadge from '../components/StatusBadge';
import SidePanel, { primaryBtn, secondaryBtn } from '../components/SidePanel';
import { useConfirmDialog } from '../components/ConfirmDialog';

const DESCRIPTION = 'Manage health facilities used as reference data for TB records, imports, and validation.';

const FACILITY_TYPE_LABELS = {
  HC: 'Health Center',
  PC: 'Puericulture Center',
  ITC: 'Infirmary / Treatment Center',
  Floodway: 'Floodway Health Station',
};

const EMPTY_ADD = { name: '', facility_type: 'HC', barangay_name: '', address: '', ownership: '', status: 'active', notes: '' };
const EMPTY_FILTERS = { search: '', type: '', barangay: '', status: '' };

// This directory is Pasig-only: every row sits in one of the 30 barangays. External /
// reference facilities registered through the Validation queue are filtered out below,
// so no classification is ever created or displayed here.
const locationLabel = (f) => f.barangay_name || '—';

/* List view columns — same table UI as TB Records (navy header, click-to-sort). */
const LIST_COLUMNS = [
  { label: 'Facility Name', field: 'name' },
  { label: 'Barangay', field: 'barangay' },
  { label: 'Address', field: 'address' },
  { label: 'Type', field: 'type' },
  { label: 'Status', field: 'status' },
  { label: 'Action', field: null },
];

const SORT_GETTERS = {
  name: (f) => (f.name || '').toLowerCase(),
  barangay: (f) => (f.barangay_name || '').toLowerCase(),
  address: (f) => (f.address || '').toLowerCase(),
  type: (f) => (FACILITY_TYPE_LABELS[f.facility_type] || f.facility_type || '').toLowerCase(),
  status: (f) => (f.is_active !== false ? 'active' : 'inactive'),
};

/* Field / detail helpers — same look as UsersPage's panels. */
function Field({ label, required, optional, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold mb-1" style={{ color: '#475569' }}>
        {label}{required && <span style={{ color: '#DC2626' }}> *</span>}{optional && <span style={{ color: '#94A3B8', fontWeight: 500 }}> (Optional)</span>}
      </span>
      {children}
      {hint && <span className="block text-[10px] mt-1" style={{ color: '#94A3B8' }}>{hint}</span>}
    </label>
  );
}

function formatDateTime(value, fallback = '—') {
  if (!value) return fallback;
  const d = new Date(value);
  if (isNaN(d.getTime())) return fallback;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const capitalize = (v) => (v ? v[0].toUpperCase() + v.slice(1) : '—');

const inputStyle = { background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' };
const inputClass = 'w-full px-3 py-2 text-xs rounded-lg outline-none';

/* Select with the app's standard chevron — the native browser arrow is hidden so every
   dropdown in the panel looks the same (same pattern as FilterSelect). */
function Select({ value, onChange, children, ...rest }) {
  return (
    <span className="relative block">
      <select
        value={value}
        onChange={onChange}
        className="w-full pl-3 pr-8 py-2 text-xs rounded-lg outline-none appearance-none cursor-pointer"
        style={inputStyle}
        {...rest}
      >
        {children}
      </select>
      <i className="ri-arrow-down-s-line absolute right-2.5 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: '#64748B' }} />
    </span>
  );
}

export default function HealthFacilitiesPage() {
  const { t } = useTheme();
  const [facilities, setFacilities] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [view, setView] = useState('grouped'); // 'grouped' | 'list'
  // List-view column sorting (client-side; only the table below uses it).
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detail, setDetail] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD);
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState(null);
  const [aliases, setAliases] = useState([]);
  const [aliasSuggestions, setAliasSuggestions] = useState([]);
  const [aliasLoading, setAliasLoading] = useState(false);
  const [aliasError, setAliasError] = useState('');
  const [addingAlias, setAddingAlias] = useState(false);
  const [editingAlias, setEditingAlias] = useState(null);
  const [newAlias, setNewAlias] = useState('');
  const [aliasBusy, setAliasBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  // Facility permissions come from the server (GET /api/facilities → permissions) —
  // the same matrix the backend enforces. Until it lands, every write control is
  // hidden (view-only), never shown by default.
  const [perms, setPerms] = useState(null);

  const canAdd = perms?.add === true;
  const canEdit = perms?.edit === true;
  const canManageAliases = perms?.aliases === true;

  // Field/Select styling lives at module level (inputStyle / inputClass / Select).

  const load = async () => {
    try {
      const params = new URLSearchParams({ status: 'all' });
      const res = await API.get(`/api/facilities?${params}`);
      setFacilities(res.data.facilities || []);
      setBarangays(res.data.barangays || []);
      setPerms(res.data.permissions || null);
      setError('');
    } catch (err) {
      setError('Failed to load health facilities.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Aliases (and the unresolved imported names that suggest this facility) reload
  // whenever the opened facility changes — and after save, which replaces `detail`
  // (a rename parks the old name as a new alias).
  useEffect(() => {
    setAliases([]);
    setAliasSuggestions([]);
    setAddingAlias(false);
    setEditingAlias(null);
    setNewAlias('');
    setAliasError('');
    setEditing(false);
    setEditError('');
    if (!detail) return undefined;
    let cancelled = false;
    setAliasLoading(true);
    API.get(`/api/facilities/${detail.id}/aliases`)
      .then((res) => { if (!cancelled) setAliases(res.data.aliases || []); })
      .catch(() => { if (!cancelled) setAliases([]); })
      .finally(() => { if (!cancelled) setAliasLoading(false); });
    // Best effort: the alias list above must never wait on this. The suggestions
    // endpoint is admin-only, so staff never ask for it.
    if (perms?.aliases) {
      API.get(`/api/facilities/${detail.id}/alias-suggestions`)
        .then((res) => { if (!cancelled) setAliasSuggestions(res.data.suggestions || []) })
        .catch(() => { if (!cancelled) setAliasSuggestions([]); });
    }
    return () => { cancelled = true; };
  }, [detail, perms?.aliases]);

  // Suggestions shrink as aliases are created (the names they cover now resolve),
  // so reload them after every successful alias save or removal.
  const reloadSuggestions = (id) => {
    if (!perms?.aliases) return;
    API.get(`/api/facilities/${id}/alias-suggestions`)
      .then((res) => setAliasSuggestions(res.data.suggestions || []))
      .catch(() => {});
  };

  const setFilter = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };
  // '' is the default "All Statuses" — only a chosen filter counts as active (the
  // default once hid every inactive facility, and Clear reset back to that same
  // hidden state).
  const activeFilterCount = (filters.search ? 1 : 0) + (filters.type ? 1 : 0) + (filters.barangay ? 1 : 0) + (filters.status ? 1 : 0);

  const q = filters.search.trim().toLowerCase();
  const filteredFacilities = facilities.filter(f => {
    // Pasig-only directory: external/reference facilities (registered via the
    // Validation queue) never appear here.
    if (f.is_external === true || f.is_reference === true) return false;
    // Name, barangay, address, type (+ its label) and notes.
    const matchesSearch = !q
      || f.name.toLowerCase().includes(q)
      || (f.barangay_name || '').toLowerCase().includes(q)
      || (f.address || '').toLowerCase().includes(q)
      || (f.facility_type || '').toLowerCase().includes(q)
      || (FACILITY_TYPE_LABELS[f.facility_type] || '').toLowerCase().includes(q)
      || (f.notes || '').toLowerCase().includes(q);
    const matchesType = !filters.type || f.facility_type === filters.type;
    const matchesBarangay = !filters.barangay || (f.barangay_name || '') === filters.barangay;
    const active = f.is_active !== false;
    const matchesStatus = filters.status === '' || (filters.status === 'active' ? active : !active);
    return matchesSearch && matchesType && matchesBarangay && matchesStatus;
  });

  // Rebuild grouped view from filtered results
  const filteredGrouped = {};
  for (const f of filteredFacilities) {
    const key = locationLabel(f);
    if (!filteredGrouped[key]) filteredGrouped[key] = [];
    filteredGrouped[key].push(f);
  }
  const sortedBarangays = Object.keys(filteredGrouped).sort();

  // Clicking a sortable header toggles its direction; a new header starts ascending.
  const handleSort = (field) => {
    if (sortField === field) setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDirection('asc'); }
  };
  const listRows = [...filteredFacilities].sort((a, b) => {
    const get = SORT_GETTERS[sortField];
    if (!get) return 0;
    const cmp = String(get(a)).localeCompare(String(get(b)));
    return sortDirection === 'asc' ? cmp : -cmp;
  });
  const totalListPages = Math.max(1, Math.ceil(listRows.length / pageSize));
  const currentListPage = Math.min(page, totalListPages);
  const visibleListRows = listRows.slice((currentListPage - 1) * pageSize, currentListPage * pageSize);

  const cardStyle = {
    background: t.cardSolid,
    border: `1px solid ${t.border}`,
    borderRadius: '12px',
    boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
  };

  const submitAdd = async (e) => {
    e.preventDefault();
    const name = addForm.name.trim();
    if (!name) { setFormError('Facility name is required.'); return; }
    if (!addForm.barangay_name) { setFormError('Barangay is required.'); return; }
    setFormError('');
    setCreating(true);
    try {
      await API.post('/api/facilities', {
        name,
        facility_type: addForm.facility_type,
        status: addForm.status,
        barangay_name: addForm.barangay_name,
        address: addForm.address.trim(),
        ownership: addForm.ownership,
        notes: addForm.notes.trim(),
      });
      setShowAdd(false);
      setAddForm(EMPTY_ADD);
      setNotice('Facility added.');
      await load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to add facility.');
    } finally {
      setCreating(false);
    }
  };

  // Saves one alias (new, edited, or adopted from a suggestion). `editNorm` set
  // means rename an existing key; empty means create. Reloads the suggestions too —
  // a name that just got an alias now resolves on its own.
  const saveAlias = async (text, editNorm = null) => {
    const trimmed = text.trim();
    if (!trimmed) { setAliasError('Alias is required.'); return false; }
    setAliasError('');
    setAliasBusy(true);
    try {
      const res = editNorm
        ? await API.put(`/api/facilities/${detail.id}/aliases/${encodeURIComponent(editNorm)}`, { alias_text: trimmed })
        : await API.post(`/api/facilities/${detail.id}/aliases`, { alias_text: trimmed });
      setAliases(res.data.aliases || []);
      setNewAlias('');
      setAddingAlias(false);
      setEditingAlias(null);
      reloadSuggestions(detail.id);
      return true;
    } catch (err) {
      setAliasError(err.response?.data?.error || 'Failed to save alias.');
      return false;
    } finally {
      setAliasBusy(false);
    }
  };

  const submitAlias = async (e) => {
    e.preventDefault();
    await saveAlias(newAlias, editingAlias);
  };

  const removeAlias = async (a) => {
    if (!(await confirm({
      title: 'Remove facility alias?',
      message: 'Historical records using this text may no longer resolve to this facility.',
      confirmLabel: 'Remove alias',
      variant: 'danger',
    }))) return;
    setAliasError('');
    setAliasBusy(true);
    try {
      const res = await API.delete(`/api/facilities/${detail.id}/aliases/${encodeURIComponent(a.alias_norm)}`);
      setAliases(res.data.aliases || []);
      reloadSuggestions(detail.id);
    } catch (err) {
      setAliasError(err.response?.data?.error || 'Failed to remove alias.');
    } finally {
      setAliasBusy(false);
    }
  };

  // Add all suggestions this facility currently has (looped, not batched — each is a
  // tiny request and this only runs on demand). Partial failure leaves the rest listed.
  const addAllSuggestions = async () => {
    setAliasError('');
    setAliasBusy(true);
    try {
      for (const s of [...aliasSuggestions]) {
        const res = await API.post(`/api/facilities/${detail.id}/aliases`, { alias_text: s.alias_text })
          .then(r => r, err => { setAliasError(err.response?.data?.error || 'Failed to save alias.'); return null; });
        if (res) setAliases(res.data.aliases || []);
      }
      reloadSuggestions(detail.id);
    } finally {
      setAliasBusy(false);
    }
  };

  const openEdit = () => {
    setEditForm({
      name: detail.name,
      facility_type: detail.facility_type || 'HC',
      barangay_name: detail.barangay_name || '',
      address: detail.address || '',
      ownership: detail.ownership || '',
      notes: detail.notes || '',
      status: detail.is_active !== false ? 'active' : 'inactive',
    });
    setEditError('');
    setEditing(true);
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    const name = editForm.name.trim();
    if (!name) { setEditError('Facility name is required.'); return; }
    if (!editForm.barangay_name) { setEditError('Barangay is required.'); return; }
    setEditError('');
    setSavingEdit(true);
    try {
      const res = await API.put(`/api/facilities/${detail.id}`, {
        name,
        facility_type: editForm.facility_type,
        status: editForm.status,
        barangay_name: editForm.barangay_name,
        address: editForm.address.trim(),
        ownership: editForm.ownership,
        notes: editForm.notes.trim(),
      });
      const updated = res.data.facility || {};
      setDetail((d) => (d ? { ...d, ...updated } : d));
      setEditing(false);
      setNotice('Facility updated.');
      await load();
    } catch (err) {
      setEditError(err.response?.data?.error || 'Failed to update facility.');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="space-y-5" style={{ color: t.text }}>
      {confirmDialog}

      {/* Header card — same shell as TBInsight's pages */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Health Facilities</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>{DESCRIPTION}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* View toggle */}
            <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              {[{ key: 'grouped', icon: 'ri-layout-grid-line', label: 'Grouped' }, { key: 'list', icon: 'ri-list-check', label: 'List' }].map(v => (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold transition-all"
                  style={{
                    background: view === v.key ? '#ffffff' : 'transparent',
                    color: view === v.key ? '#0F2D52' : '#64748B',
                    boxShadow: view === v.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  <i className={`${v.icon} text-[13px]`} />
                  {v.label}
                </button>
              ))}
            </div>

            {canAdd && (
              <button
                onClick={() => { setShowAdd(true); setFormError(''); }}
                className="px-4 py-2 text-xs font-semibold shrink-0 flex items-center gap-2"
                style={{ background: '#0F2D52', color: '#ffffff', borderRadius: 4, transition: 'background 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; }}
              >
                <i className="ri-add-line" />
                Add Facility
              </button>
            )}
          </div>
        </div>

        {/* Filters — same inline bar as TBInsight's pages */}
        <div className="px-6 py-3" style={{ background: '#F8FAFC' }}>
          <div className="flex items-center gap-2 flex-wrap">
<div className="relative">
              <i className="ri-search-line pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#94A3B8' }} />
              <input
                type="text"
                value={filters.search}
                onChange={(e) => setFilter('search', e.target.value)}
                placeholder="Search name, barangay, type or notes..."
                aria-label="Search facilities"
                className="rounded-lg pl-7 pr-3 py-[7px] text-[11px] font-semibold outline-none transition"
                style={{ background: '#ffffff', color: '#0F2D52', border: '1px solid #E2E8F0', width: 240 }}
              />
            </div>
            <FilterSelect label="Type" value={filters.type} onChange={(v) => setFilter('type', v)}>
              <option value="">All Types</option>
              {Object.entries(FACILITY_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </FilterSelect>

            <FilterSelect label="Barangay" value={filters.barangay} onChange={(v) => setFilter('barangay', v)} selectStyle={{ maxWidth: 170 }}>
              <option value="">All Barangays</option>
              {barangays.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </FilterSelect>

            <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilter('status', v)}>
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </FilterSelect>

            <div className="flex items-center gap-3 ml-auto">
              <span className="text-[11px]" style={{ color: '#64748B' }}>
                {activeFilterCount > 0 ? `${filteredFacilities.length} of ${facilities.length} facilities` : `${facilities.length} facilit${facilities.length === 1 ? 'y' : 'ies'}`}
              </span>
              <button
                onClick={() => setFilters(EMPTY_FILTERS)}
                disabled={activeFilterCount === 0}
                className="px-3 py-2 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s' }}
                onMouseEnter={e => { if (activeFilterCount > 0) e.currentTarget.style.background = '#E5E7EB'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B', border: '1px solid rgba(239,68,68,0.12)' }}>{error}</div>}
      {notice && (
        <div className="px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-3" style={{ background: 'rgba(16,185,129,0.06)', color: '#047857', border: '1px solid rgba(16,185,129,0.18)' }}>
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Dismiss" style={{ color: '#047857' }}><i className="ri-close-line" /></button>
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

      {/* GROUPED VIEW — responsive card grid, one card per facility (screenshot layout) */}
      {!loading && !error && view === 'grouped' && filteredFacilities.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
          {sortedBarangays.flatMap(brgy => filteredGrouped[brgy].map(f => {
            const active = f.is_active !== false;
            return (
              <div
                key={f.id}
                className="rounded-lg overflow-hidden flex flex-col cursor-default transition-all hover:border-[#CBD5E1] hover:shadow-sm"
                style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}
              >
                <div className="px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 min-w-0 text-[11px] truncate" style={{ color: '#64748B' }}>
                      <i className="ri-map-pin-line text-[13px] shrink-0" aria-hidden="true" />
                      {brgy}
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0 text-[11px] font-semibold" style={{ color: active ? '#15803D' : '#64748B' }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: active ? '#16A34A' : '#94A3B8' }} />
                      {active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-[15px] font-bold leading-snug line-clamp-2 mt-3" style={{ color: '#0F2D52' }}>{f.name}</p>
                  <p className="text-[12px] leading-relaxed line-clamp-2 mt-1" style={{ color: f.address ? '#64748B' : '#94A3B8' }}>
                    {f.address || 'No address provided'}
                  </p>
                </div>
                <div className="mt-auto" style={{ borderTop: '1px solid #F1F5F9' }}>
                  <div className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-[11px] min-w-0 truncate" style={{ color: '#64748B' }}>
                      {FACILITY_TYPE_LABELS[f.facility_type] || f.facility_type || '—'}
                    </span>
                    <button
                      onClick={() => setDetail(f)}
                      className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold transition-colors"
                      style={{ color: '#0F2D52' }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#2563EB'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#0F2D52'; }}
                    >View details <i className="ri-arrow-right-line text-xs" aria-hidden="true" /></button>
                  </div>
                </div>
              </div>
            );
          }))}
        </div>
      )}

      {/* LIST VIEW — same table UI as TB Records: navy sortable header, zebra rows, eye action */}
      {!loading && !error && view === 'list' && filteredFacilities.length > 0 && (
        <div style={cardStyle} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0F2D52' }}>
                  {LIST_COLUMNS.map(({ label, field }, idx) => {
                    const isActive = field && sortField === field;
                    return (
                      <th
                        key={label}
                        className={`${idx === 0 ? 'pl-6' : 'px-3'} pr-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${field ? 'cursor-pointer select-none' : ''}`}
                        style={{
                          color: isActive ? '#93C5FD' : '#ffffff',
                          borderBottom: '1px solid #1E40AF',
                          borderRight: idx < LIST_COLUMNS.length - 1 ? '1px solid #1E40AF' : 'none',
                          transition: 'color 0.15s',
                        }}
                        onClick={field ? () => handleSort(field) : undefined}
                        onMouseEnter={(e) => { if (field && !isActive) e.currentTarget.style.color = '#CBD5E1'; }}
                        onMouseLeave={(e) => { if (field && !isActive) e.currentTarget.style.color = '#ffffff'; }}
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          {field && (
                            <span className="inline-flex flex-col leading-none" style={{ gap: '1px' }}>
                              <i className="ri-arrow-up-s-line" style={{ fontSize: '8px', lineHeight: '8px', color: isActive && sortDirection === 'asc' ? '#93C5FD' : 'rgba(255,255,255,0.25)' }} />
                              <i className="ri-arrow-down-s-line" style={{ fontSize: '8px', lineHeight: '8px', color: isActive && sortDirection === 'desc' ? '#93C5FD' : 'rgba(255,255,255,0.25)' }} />
                            </span>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleListRows.map((f, i) => (
                  <tr
                    key={f.id}
                    className={`hover:bg-blue-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'}`}
                    style={{ borderBottom: '1px solid #E2E8F0' }}
                  >
                    <td className="pl-6 pr-3 py-2" style={{ borderRight: '1px solid #E2E8F0' }}>
                      <span className="font-bold" style={{ color: '#0F2D52' }}>{f.name}</span>
                    </td>
                    <td className="px-3 py-2" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{locationLabel(f)}</td>
                    <td className="px-3 py-2 max-w-[220px] whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }} title={f.address || undefined}>{f.address || '—'}</td>
                    <td className="px-3 py-2 text-sm" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{FACILITY_TYPE_LABELS[f.facility_type] || f.facility_type || '—'}</td>
                    <td className="px-3 py-2" style={{ borderRight: '1px solid #E2E8F0' }}><StatusBadge status={f.is_active !== false ? 'Active' : 'Inactive'} /></td>
                    <td className="px-3 py-2 text-center">
                      <button
                        aria-label={`View ${f.name}`}
                        onClick={() => setDetail(f)}
                        className="inline-flex items-center justify-center h-6 w-6 text-sm"
                        style={{ color: '#64748B', borderRadius: 4, transition: 'color 0.15s' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#0F2D52'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = '#64748B'; }}
                      >
                        <i className="ri-eye-line" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={currentListPage}
            pageSize={pageSize}
            total={listRows.length}
            itemName="facilities"
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        </div>
      )}

      {/* ─── View details / inline edit panel ─── */}
      {detail && (
        <SidePanel
          title={detail.name}
          subtitle={detail.barangay_name || '—'}
          footerDivider
          badge={(
            <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide" style={{ background: detail.is_active !== false ? '#16A34A' : '#64748B', color: '#ffffff' }}>
              {detail.is_active !== false ? 'Active' : 'Inactive'}
            </span>
          )}
          onClose={() => { setDetail(null); setEditing(false); }}
          onSubmit={editing ? saveEdit : undefined}
          footer={editing ? (
            <>
              <button type="button" onClick={() => setEditing(false)} disabled={savingEdit} className="px-4 py-2 text-xs font-medium disabled:opacity-50" style={secondaryBtn}>Cancel</button>
              <button type="submit" disabled={savingEdit} className="px-4 py-2 text-xs font-semibold disabled:opacity-50" style={primaryBtn}>{savingEdit ? 'Saving…' : 'Save Changes'}</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setDetail(null)} className="px-4 py-2 text-xs font-medium" style={secondaryBtn}>Close</button>
              {canEdit && (
                <button type="button" onClick={openEdit} className="px-4 py-2 text-xs font-semibold" style={primaryBtn}>
                  <i className="ri-edit-line" /> Edit Facility
                </button>
              )}
            </>
          )}
        >
          {editing && editForm ? (
            <>
              {editError && <div className="px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B', border: '1px solid rgba(239,68,68,0.12)' }}>{editError}</div>}
              <Field label="Facility Name" required>
                <input type="text" autoFocus value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Facility Type" required>
                <Select value={editForm.facility_type} onChange={(e) => setEditForm({ ...editForm, facility_type: e.target.value })}>
                  {Object.entries(FACILITY_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Barangay" required>
                <Select value={editForm.barangay_name} onChange={(e) => setEditForm({ ...editForm, barangay_name: e.target.value })}>
                  <option value="">Select barangay…</option>
                  {barangays.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                </Select>
              </Field>
              <Field label="Address" optional>
                <input type="text" value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Ownership" optional>
                <Select value={editForm.ownership} onChange={(e) => setEditForm({ ...editForm, ownership: e.target.value })}>
                  <option value="">Not specified</option>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </Select>
              </Field>
              <Field label="Notes" optional>
                <textarea rows={3} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} className={`${inputClass} resize-none`} style={inputStyle} />
              </Field>
              <Field label="Status" required>
                <Select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </Field>
            </>
          ) : (
            <>
              <section>
                <h3 className="text-xs font-bold mb-3" style={{ color: '#0F2D52' }}>Facility details</h3>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <div>
                    <dt className="text-[11px] mb-1" style={{ color: '#94A3B8' }}>Facility type</dt>
                    <dd className="text-xs font-semibold" style={{ color: '#334155' }}>{FACILITY_TYPE_LABELS[detail.facility_type] || detail.facility_type || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] mb-1" style={{ color: '#94A3B8' }}>Ownership</dt>
                    <dd className="text-xs font-semibold" style={{ color: '#334155' }}>{capitalize(detail.ownership)}</dd>
                  </div>
                </dl>
              </section>

              <section className="pt-4" style={{ borderTop: '1px solid #E2E8F0' }}>
                <h3 className="text-xs font-bold mb-3" style={{ color: '#0F2D52' }}>Location</h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-[11px] mb-1" style={{ color: '#94A3B8' }}>Barangay</p>
                    <p className="text-xs font-semibold" style={{ color: '#334155' }}>{detail.barangay_name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[11px] mb-1" style={{ color: '#94A3B8' }}>Address</p>
                    <p className="text-xs leading-relaxed" style={{ color: detail.address ? '#334155' : '#94A3B8' }}>{detail.address || 'No address provided'}</p>
                  </div>
                </div>
              </section>

              <section className="pt-4" style={{ borderTop: '1px solid #E2E8F0' }}>
                <h3 className="text-xs font-bold mb-2" style={{ color: '#0F2D52' }}>Notes</h3>
                <p className="text-xs leading-relaxed" style={{ color: detail.notes ? '#334155' : '#94A3B8' }}>
                  {detail.notes || 'No additional notes'}
                </p>
              </section>

              <section className="pt-4" style={{ borderTop: '1px solid #E2E8F0' }}>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="text-xs font-bold" style={{ color: '#0F2D52' }}>Facility aliases</h3>
                  {canManageAliases && !addingAlias && (
                    <button type="button" onClick={() => { setAddingAlias(true); setAliasError(''); }} className="text-[11px] font-semibold" style={{ color: '#2E6FAF' }}>
                      Add alias
                    </button>
                  )}
                </div>
                {aliasError && (
                  <div className="px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B', border: '1px solid rgba(239,68,68,0.12)' }}>{aliasError}</div>
                )}
                {aliasLoading ? (
                  <p className="text-xs" style={{ color: '#94A3B8' }}>Loading aliases…</p>
                ) : aliases.length === 0 ? (
                  <p className="text-xs" style={{ color: '#94A3B8' }}>No aliases yet. Other spellings of this name will appear here.</p>
                ) : (
                  <ul>
                    {aliases.map((a) => (
                      <li key={a.alias_norm} className="flex items-center justify-between gap-3 py-2" style={{ borderBottom: '1px solid #F1F5F9' }}>
                        {canManageAliases && editingAlias === a.alias_norm ? (
                          <form onSubmit={submitAlias} className="flex items-center gap-2 w-full">
                            <input
                              autoFocus
                              value={newAlias}
                              onChange={(e) => setNewAlias(e.target.value)}
                              aria-label="Edit alias"
                              className={`${inputClass} flex-1`}
                              style={inputStyle}
                            />
                            <button type="submit" disabled={aliasBusy} className="px-3 py-1.5 text-[11px] font-semibold shrink-0 disabled:opacity-50" style={{ background: '#0F2D52', color: '#ffffff', borderRadius: 4 }}>{aliasBusy ? 'Saving…' : 'Save'}</button>
                            <button type="button" onClick={() => { setEditingAlias(null); setNewAlias(''); setAliasError(''); }} disabled={aliasBusy} className="px-3 py-1.5 text-[11px] shrink-0 disabled:opacity-50" style={secondaryBtn}>Cancel</button>
                          </form>
                        ) : (
                          <>
                            <span className="text-xs break-words" style={{ color: '#334155' }}>{a.alias_text}</span>
                            {canManageAliases && (
                              <span className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => { setEditingAlias(a.alias_norm); setNewAlias(a.alias_text); setAddingAlias(false); setAliasError(''); }}
                                  disabled={aliasBusy}
                                  aria-label={`Edit alias ${a.alias_text}`}
                                  className="text-[12px] leading-none disabled:opacity-50"
                                  style={{ color: '#94A3B8' }}
                                  onMouseEnter={(e) => { e.currentTarget.style.color = '#0F2D52'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; }}
                                >
                                  <i className="ri-pencil-line" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeAlias(a)}
                                  disabled={aliasBusy}
                                  aria-label={`Remove alias ${a.alias_text}`}
                                  className="text-[13px] leading-none disabled:opacity-50"
                                  style={{ color: '#94A3B8' }}
                                  onMouseEnter={(e) => { e.currentTarget.style.color = '#DC2626'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; }}
                                >
                                  <i className="ri-close-line" />
                                </button>
                              </span>
                            )}
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canManageAliases && addingAlias && (
                  <form onSubmit={submitAlias} className="flex items-center gap-2 mt-2">
                    <input
                      autoFocus
                      value={newAlias}
                      onChange={(e) => setNewAlias(e.target.value)}
                      placeholder="e.g. Bagong Ilog Health Center"
                      aria-label="New alias"
                      className={`${inputClass} flex-1`}
                      style={inputStyle}
                    />
                    <button type="submit" disabled={aliasBusy} className="px-3 py-2 text-[11px] font-semibold shrink-0 disabled:opacity-50" style={{ background: '#0F2D52', color: '#ffffff', borderRadius: 4 }}>{aliasBusy ? 'Adding…' : 'Add'}</button>
                    <button type="button" onClick={() => { setAddingAlias(false); setNewAlias(''); setAliasError(''); }} disabled={aliasBusy} className="px-3 py-2 text-[11px] shrink-0 disabled:opacity-50" style={secondaryBtn}>Cancel</button>
                  </form>
                )}
                {aliasSuggestions.length > 0 && (
                  <div className="mt-4 pt-4" style={{ borderTop: '1px solid #E2E8F0' }}>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-[11px] font-bold" style={{ color: '#0F2D52' }}>Found in imported records</p>
                      {canManageAliases && (
                        <button type="button" onClick={addAllSuggestions} disabled={aliasBusy} className="text-[11px] font-bold shrink-0 disabled:opacity-50" style={{ color: '#0F2D52' }}>
                          {aliasBusy ? 'Adding…' : `Add all (${aliasSuggestions.length})`}
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] mb-2" style={{ color: '#94A3B8' }}>
                      Unresolved facility names in imported data that look like this facility. Adding one links those records to it — the text itself is never changed.
                    </p>
                    <ul className="space-y-1.5">
                      {aliasSuggestions.map((s) => (
                        <li key={s.alias_text} className="flex items-start justify-between gap-3">
                          <span className="text-xs break-words" style={{ color: '#0F2D52' }}>
                            {s.alias_text}
                            <span className="ml-1.5 text-[10px]" style={{ color: '#94A3B8' }}>({s.records.toLocaleString()} record{s.records === 1 ? '' : 's'})</span>
                          </span>
                          {canManageAliases && (
                            <button
                              type="button"
                              onClick={() => saveAlias(s.alias_text)}
                              disabled={aliasBusy}
                              aria-label={`Add alias ${s.alias_text}`}
                              className="text-[11px] font-bold shrink-0 disabled:opacity-50"
                              style={{ color: '#0F2D52' }}
                            >
                              Add
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              <section className="grid grid-cols-2 gap-6 pt-4" style={{ borderTop: '1px solid #E2E8F0' }}>
                <div>
                  <p className="text-[10px] mb-1" style={{ color: '#94A3B8' }}>Created</p>
                  <p className="text-[11px]" style={{ color: '#64748B' }}>{formatDateTime(detail.created_at)}</p>
                </div>
                <div>
                  <p className="text-[10px] mb-1" style={{ color: '#94A3B8' }}>Last updated</p>
                  <p className="text-[11px]" style={{ color: '#64748B' }}>{formatDateTime(detail.updated_at)}</p>
                </div>
              </section>
            </>
          )}
        </SidePanel>
      )}

      {/* ─── Add facility panel ─── */}
      {showAdd && (
        <SidePanel
          title="Add Facility"
          subtitle="Add a reference facility for TB records, imports and validation"
          footerDivider
          onClose={() => { setShowAdd(false); setFormError(''); }}
          onSubmit={submitAdd}
          footer={(
            <>
              <button type="button" onClick={() => { setShowAdd(false); setFormError(''); }} disabled={creating} className="px-4 py-2 text-xs font-medium disabled:opacity-50" style={secondaryBtn}>Cancel</button>
              <button type="submit" disabled={creating} className="px-4 py-2 text-xs font-semibold disabled:opacity-50" style={primaryBtn}>{creating ? 'Adding...' : 'Add Facility'}</button>
            </>
          )}
        >
          {formError && <div className="px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B', border: '1px solid rgba(239,68,68,0.12)' }}>{formError}</div>}
          <Field label="Facility Name" required>
            <input type="text" autoFocus value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="e.g. Pasig City Health Center" className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Facility Type" required>
            <Select value={addForm.facility_type} onChange={(e) => setAddForm({ ...addForm, facility_type: e.target.value })}>
              {Object.entries(FACILITY_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="Barangay" required>
            <Select value={addForm.barangay_name} onChange={(e) => setAddForm({ ...addForm, barangay_name: e.target.value })}>
              <option value="">Select barangay…</option>
              {barangays.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="Status" required>
            <Select value={addForm.status} onChange={(e) => setAddForm({ ...addForm, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
          <Field label="Address" optional>
            <input type="text" value={addForm.address} onChange={(e) => setAddForm({ ...addForm, address: e.target.value })} placeholder="Street / landmark" className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Ownership" optional>
            <Select value={addForm.ownership} onChange={(e) => setAddForm({ ...addForm, ownership: e.target.value })}>
              <option value="">Not specified</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </Select>
          </Field>
          <Field label="Notes" optional>
            <textarea rows={3} value={addForm.notes} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })} placeholder="Other details about this facility" className={`${inputClass} resize-none`} style={inputStyle} />
          </Field>
        </SidePanel>
      )}
    </div>
  );
}
