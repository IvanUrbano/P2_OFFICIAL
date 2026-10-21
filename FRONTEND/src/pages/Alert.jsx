import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import timeAgo from '../utils/timeAgo';
import { MODULE_LABELS, MODULE_ROUTES } from '../utils/alertConstants';
import FilterSelect from '../components/FilterSelect';
import ModalCloseButton from '../components/ModalCloseButton';
import SkeletonBlock from '../../components/SkeletonBlock';

/* ─── Constants ──────────────────────────────────────────────────────── */

const ALERT_TYPES = [
  { key: 'all', title: 'All', desc: 'Alerts and notifications' },
  { key: 'alert', title: 'Alerts', desc: 'Conditions requiring attention' },
  { key: 'notification', title: 'Notifications', desc: 'System activity events' },
];

const SEVERITY_STYLES = {
  critical: { label: 'Critical', color: '#991B1B', bg: 'rgba(153,27,27,0.06)', border: 'rgba(153,27,27,0.15)', textBg: '#FEF2F2', textColor: '#991B1B' },
  high: { label: 'High', color: '#B91C1C', bg: 'rgba(185,28,28,0.06)', border: 'rgba(185,28,28,0.15)', textBg: '#FEF2F2', textColor: '#B91C1C' },
  medium: { label: 'Medium', color: '#92400E', bg: 'rgba(146,64,14,0.06)', border: 'rgba(146,64,14,0.15)', textBg: '#FFFBEB', textColor: '#92400E' },
  low: { label: 'Low', color: '#1E3A5F', bg: 'rgba(30,58,95,0.06)', border: 'rgba(30,58,95,0.12)', textBg: '#F1F5F9', textColor: '#1E3A5F' },
  info: { label: 'Info', color: '#6B7280', bg: 'rgba(107,114,128,0.06)', border: 'rgba(107,114,128,0.12)', textBg: '#F3F4F6', textColor: '#6B7280' },
};

const STATUS_STYLES = {
  unread: { label: 'Unread', color: '#0F2D52', bg: '#EFF6FF' },
  read: { label: 'Read', color: '#64748B', bg: '#F1F5F9' },
  resolved: { label: 'Resolved', color: '#047857', bg: '#ECFDF5' },
};

const alertTypeLabel = (value) => value
  ? String(value).replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
  : null;

const formatAlertPeriod = (value) => {
  if (!value) return null;
  if (/^\d{4}$/.test(String(value))) return String(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });
};

const formatAlertDateTime = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : `${date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })} PHT`;
};

const affectedBarangays = (alert) => Array.isArray(alert?.metadata?.affected_barangays)
  ? alert.metadata.affected_barangays.filter(Boolean)
  : [];

const alertCoverage = (alert, compact = false) => {
  if (alert.barangay_name) return alert.barangay_name;
  const names = affectedBarangays(alert);
  if (names.length === 1) return names[0];
  if (names.length > 1) return compact ? `${names[0]} +${names.length - 1} more` : `${names.length} barangays`;
  if (['high_risk_hotspot', 'case_increase', 'forecast_exceeds_threshold'].includes(alert.alert_type)) return 'Affected barangays';
  if (alert.type === 'notification') return 'Systemwide';
  if (alert.alert_type === 'low_treatment_success') return 'Citywide';
  return 'Not specified';
};

/* ─── Helper Components ──────────────────────────────────────────────── */

/* ─── Main Component ─────────────────────────────────────────────────── */

export default function Alert() {
  const navigate = useNavigate();

  /* ── Filter state ── */
  const [filterType, setFilterType] = useState('all');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterBarangay, setFilterBarangay] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterDate, setFilterDate] = useState('all');

  /* ── Data state ── */
  const [alerts, setAlerts] = useState([]);
  const [filterOptions, setFilterOptions] = useState({ type: [], severity: [], status: [], source: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState({ critical: 0, high: 0, unread: 0, today: 0 });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  /* ── Detail modal ── */
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [resolveConfirm, setResolveConfirm] = useState(null);
  const [resolveError, setResolveError] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);
  const [barangays, setBarangays] = useState([]);
  const abortRef = useRef(null);
  const resolveCancelRef = useRef(null);

  /* ── Admin check ── */
  const isAdmin = useMemo(() => {
    const s = localStorage.getItem('user');
    return s ? JSON.parse(s)?.role === 'admin' : false;
  }, []);

  const barangayOptions = useMemo(() => [...new Set([
    ...barangays,
    ...alerts.flatMap(alert => [alert.barangay_name, ...affectedBarangays(alert)]).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b)), [barangays, alerts]);

  const handleTypeChange = useCallback((newType) => {
    setFilterType(newType);
    setPage(1);
  }, []);

  const fetchAlerts = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const params = { page, limit: 20 };
      if (filterType !== 'all') params.type = filterType;
      if (filterSeverity !== 'all') params.severity = filterSeverity;
      if (filterStatus !== 'all') params.status = filterStatus;
      if (filterBarangay) params.barangay = filterBarangay;
      if (filterSource) params.source = filterSource;
      if (filterDate !== 'all') params.date = filterDate;

      const [alertRes, countsRes, optionsRes] = await Promise.all([
        API.get('/api/tb/alerts', { params, signal: controller.signal }),
        API.get('/api/tb/alerts/counts', { signal: controller.signal }),
        API.get('/api/tb/alerts/filter-options', { signal: controller.signal }),
      ]);
      setAlerts(alertRes.data.alerts || []);
      setFilterOptions(optionsRes.data || { severity: [], status: [], source: [] });
      setPagination(alertRes.data.pagination || { total: 0, totalPages: 1 });
      setSummary(countsRes.data || { critical: 0, high: 0, unread: 0, today: 0 });
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      setError('Alerts and notifications could not be retrieved. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [page, filterType, filterSeverity, filterStatus, filterBarangay, filterSource, filterDate]);

  useEffect(() => {
    const initialFetch = window.setTimeout(fetchAlerts, 0);
    window.addEventListener('focus', fetchAlerts);
    return () => {
      window.clearTimeout(initialFetch);
      window.removeEventListener('focus', fetchAlerts);
    };
  }, [fetchAlerts]);

  useEffect(() => {
    const controller = new AbortController();
    API.get('/api/tb/barangays', { signal: controller.signal }).then(res => {
      const names = (res.data.barangays || []).map(b => b.barangay_name || b.name).filter(Boolean).sort();
      setBarangays(names);
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!selectedAlert && !resolveConfirm) return;
    if (resolveConfirm && resolvingId !== resolveConfirm.id) resolveCancelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (resolveConfirm) {
          if (resolvingId !== resolveConfirm.id) setResolveConfirm(null);
        } else {
          setSelectedAlert(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedAlert, resolveConfirm, resolvingId]);

  // Auto-evaluate alerts if stale (>24h since last evaluation)
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const staleRes = await API.get('/api/tb/alerts/stale-check', { signal: controller.signal });
        if (staleRes.data.isStale && isAdmin) {
          await API.post('/api/tb/alerts/evaluate', {}, { signal: controller.signal });
          fetchAlerts();
        }
      } catch {
        // Silently fail — manual evaluate button is still available
      }
    })();
    return () => controller.abort();
  }, [isAdmin, fetchAlerts]);

  const handleApply = useCallback(() => {
    setPage(1);
    fetchAlerts();
  }, [fetchAlerts]);

  const handleReset = useCallback(() => {
    setFilterType('all');
    setFilterSeverity('all');
    setFilterStatus('all');
    setFilterBarangay('');
    setFilterSource('');
    setFilterDate('all');
    setPage(1);
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await API.put('/api/tb/alerts/read-all');
      setAlerts(prev => prev.map(a => a.status === 'unread' ? { ...a, status: 'read', read_at: new Date().toISOString() } : a));
      setSummary(prev => ({ ...prev, unread: 0 }));
    } catch {
      // ignore
    }
  };

  const handleEvaluate = async () => {
    setEvaluating(true);
    try {
      await API.post('/api/tb/alerts/evaluate');
      await fetchAlerts();
    } catch {
      // ignore
    } finally {
      setEvaluating(false);
    }
  };

  const handleViewDetail = async (alert) => {
    const controller = new AbortController();
    setDetailLoading(true);
    try {
      const res = await API.get(`/api/tb/alerts/${alert.id}`, { signal: controller.signal });
      setSelectedAlert(res.data.alert);
      if (alert.status === 'unread') {
        await API.put(`/api/tb/alerts/${alert.id}/read`);
        setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, status: 'read', read_at: new Date().toISOString() } : a));
        setSummary(prev => ({ ...prev, unread: Math.max(0, prev.unread - 1) }));
      }
    } catch {
      // ignore
    } finally {
      setDetailLoading(false);
    }
  };

  const handleResolve = async (id) => {
    setResolvingId(id);
    setResolveError('');
    try {
      const target = alerts.find(a => a.id === id) || selectedAlert;
      await API.put(`/api/tb/alerts/${id}/resolve`, { resolved_by: 'user' });
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: 'resolved', resolved_at: new Date().toISOString() } : a));
      setSelectedAlert(prev => prev?.id === id ? { ...prev, status: 'resolved', resolved_at: new Date().toISOString() } : prev);
      if (target) {
        setSummary(prev => ({
          ...prev,
          critical: target.severity === 'critical' ? Math.max(0, prev.critical - 1) : prev.critical,
          high: target.severity === 'high' ? Math.max(0, prev.high - 1) : prev.high,
        }));
      }
      setResolveConfirm(null);
    } catch {
      setResolveError('The alert could not be resolved. Please try again.');
    } finally {
      setResolvingId(null);
    }
  };

  /* ────────── Render ────────── */

  return (
    <div className="space-y-6">

      {/* ─── Page Header + Tabs + Filters ─── */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)' }}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-3.5" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Alerts & Notifications</h1>
            <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>Monitor important TB conditions and system activities.</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {isAdmin && (
              <button
                onClick={handleEvaluate}
                disabled={evaluating}
                className="text-xs font-semibold px-4 py-2"
                style={{
                  background: evaluating ? '#E5E7EB' : '#0F2D52',
                  color: evaluating ? '#9CA3AF' : '#ffffff',
                  border: '1px solid #0F2D52',
                  borderRadius: 4,
                  transition: 'background 0.15s',
                  cursor: evaluating ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={e => { if (!evaluating) { e.currentTarget.style.background = '#174A7E'; }}}
                onMouseLeave={e => { if (!evaluating) { e.currentTarget.style.background = '#0F2D52'; }}}
              >
                <i className={`${evaluating ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'} mr-1`} />
                {evaluating ? 'Evaluating...' : 'Evaluate Alerts'}
              </button>
            )}
            {summary.unread > 0 && (
              <>
                <span className="text-[11px] font-medium" style={{ color: '#64748B' }}>
                  <i className="ri-mail-unread-line mr-1" />
                  {summary.unread} unread
                </span>
                <button
                  onClick={handleMarkAllRead}
                className="px-4 py-2 text-xs font-semibold"
                  style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}
                >
                  <i className="ri-check-double-line mr-1" />
                  Mark All Read
                </button>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div className="flex gap-0" role="tablist" aria-label="Alert type">
            {ALERT_TYPES.filter(rt => rt.key === 'all' || filterOptions.type?.includes(rt.key)).map(rt => (
              <button
                key={rt.key}
                role="tab"
                aria-selected={filterType === rt.key}
                aria-controls={`tabpanel-${rt.key}`}
                id={`tab-${rt.key}`}
                onClick={() => handleTypeChange(rt.key)}
                className="relative px-6 py-3 text-left transition-colors"
                style={{ background: 'transparent' }}
              >
                <p className="text-[13px] font-bold" style={{ color: filterType === rt.key ? '#0F2D52' : '#64748B' }}>
                  {rt.title}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: filterType === rt.key ? '#64748B' : '#CBD5E1' }}>
                  {rt.desc}
                </p>
                {filterType === rt.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="px-6 py-3" style={{ background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <FilterSelect label="Severity" value={filterSeverity} onChange={setFilterSeverity}>
              <option value="all">All Severities</option>
              {filterOptions.severity.map(value => <option key={value} value={value}>{SEVERITY_STYLES[value]?.label || value}</option>)}
            </FilterSelect>

            <FilterSelect label="Status" value={filterStatus} onChange={setFilterStatus}>
              <option value="all">All Status</option>
              {filterOptions.status.map(value => <option key={value} value={value}>{STATUS_STYLES[value]?.label || value}</option>)}
            </FilterSelect>

            <FilterSelect label="Barangay" value={filterBarangay} onChange={setFilterBarangay} selectStyle={{ maxWidth: 160 }}>
              <option value="">All Barangays</option>
              {barangayOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </FilterSelect>

            <FilterSelect label="Source" value={filterSource} onChange={setFilterSource}>
              <option value="">All Sources</option>
              {filterOptions.source.map(value => <option key={value} value={value}>{MODULE_LABELS[value] || value}</option>)}
            </FilterSelect>

            <FilterSelect label="Date" value={filterDate} onChange={setFilterDate}>
              <option value="all">All Dates</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </FilterSelect>

            <div className="flex items-center gap-1.5 ml-auto">
              <button onClick={handleReset}
                className="px-3 py-2 text-xs font-medium"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}>
                Clear
              </button>
              <button onClick={handleApply}
                className="px-4 py-2 text-xs font-semibold"
                style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
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
            <div className="flex items-center gap-3 mb-4">
              <i className="ri-loader-4-line animate-spin text-xl" style={{ color: '#0F2D52' }} />
              <p className="text-sm font-bold" style={{ color: '#0F2D52' }}>Loading alerts...</p>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="rounded-lg p-3" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <SkeletonBlock className="h-3 w-16 mb-2" />
                  <SkeletonBlock className="h-6 w-10" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl p-4" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
            <SkeletonBlock className="h-10 w-full mb-3" />
            {[1, 2, 3].map(i => (
              <SkeletonBlock key={i} className="h-14 w-full mb-2" />
            ))}
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
            <p className="text-sm font-bold" style={{ color: '#475569' }}>Unable to Load Notifications</p>
            <p className="text-xs mt-1 max-w-md" style={{ color: '#64748B' }}>{error}</p>
          </div>
          <button onClick={fetchAlerts} className="px-3 py-1.5 text-xs font-semibold" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; }} onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; }}>
            Retry
          </button>
        </div>
      )}

      {/* ─── Summary Cards ─── */}
      {!loading && !error && (
        <div className="rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15,45,82,0.12), 0 2px 8px rgba(15,45,82,0.08)' }}>
          <div className="grid grid-cols-2 lg:grid-cols-4">
            {/* Critical Alerts */}
            <div className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center gap-2">
                 <i className="ri-alarm-warning-fill text-sm" style={{ color: '#991B1B' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Critical Alerts</span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{summary.critical}</p>
              <span className="text-[11px] font-medium mt-1" style={{ color: '#64748B' }}>Require immediate attention</span>
              <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
            </div>

            {/* High-Priority */}
            <div className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center gap-2">
                <i className="ri-error-warning-line text-sm" style={{ color: '#EF4444' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>High-Priority</span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{summary.high}</p>
              <span className="text-[11px] font-medium mt-1" style={{ color: '#64748B' }}>Unresolved high-severity</span>
              <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
            </div>

            {/* Unread */}
            <div className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center gap-2">
                <i className="ri-mail-unread-line text-sm" style={{ color: '#0F2D52' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Unread</span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{summary.unread}</p>
              <span className="text-[11px] font-medium mt-1" style={{ color: '#64748B' }}>Not yet viewed</span>
              <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
            </div>

            {/* Alerts Today */}
            <div className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center gap-2">
                <i className="ri-calendar-event-line text-sm" style={{ color: '#B8956A' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Alerts Today</span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{summary.today}</p>
              <span className="text-[11px] font-medium mt-1" style={{ color: '#64748B' }}>Generated today</span>
            </div>
          </div>
        </div>
      )}

      {/* ─── Empty Filter Results ─── */}
      {!loading && !error && alerts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #E2E8F0' }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#F1F5F9' }}>
            {(filterType !== 'all' || filterSeverity !== 'all' || filterStatus !== 'all' || filterBarangay || filterSource || filterDate !== 'all')
              ? <i className="ri-search-line text-2xl" style={{ color: '#CBD5E1' }} />
              : <i className="ri-check-double-line text-2xl" style={{ color: '#10B981' }} />
            }
          </div>
          <div className="text-center">
            <p className="text-sm font-bold" style={{ color: '#475569' }}>
              {filterType !== 'all' || filterSeverity !== 'all' || filterStatus !== 'all' || filterBarangay || filterSource || filterDate !== 'all'
                ? 'No Matching Notifications'
                : 'No Active Alerts'}
            </p>
            <p className="text-xs mt-1 max-w-sm" style={{ color: '#64748B' }}>
              {filterType !== 'all' || filterSeverity !== 'all' || filterStatus !== 'all' || filterBarangay || filterSource || filterDate !== 'all'
                ? 'No alerts or notifications match the selected filters.'
                : 'There are currently no alerts requiring attention.'}
            </p>
          </div>
          {(filterType !== 'all' || filterSeverity !== 'all' || filterStatus !== 'all' || filterBarangay || filterSource || filterDate !== 'all') && (
            <button onClick={handleReset} className="px-3 py-1.5 text-xs font-semibold" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 }}>
              Clear Filters
            </button>
          )}
        </div>
      )}

      {/* ─── Alert Table ─── */}
      {!loading && !error && alerts.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left text-[11px]">
              <thead>
                <tr className="bg-[#0F2D52]">
                  {['Severity', 'Title', 'Type', 'Source', 'Barangay / Scope', 'Date', 'Status', 'Action'].map((h, idx) => (
                    <th key={h} scope="col" className={`${idx === 0 ? 'pl-6 pr-3' : 'px-3'} border-b border-[#1E40AF] py-2 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap text-white ${idx < 7 ? 'border-r border-[#1E40AF]' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {alerts.map((a, idx) => {
                  const sev = SEVERITY_STYLES[a.severity] || SEVERITY_STYLES.info;
                  const statusStyle = STATUS_STYLES[a.status] || STATUS_STYLES.unread;
                  return (
                    <tr key={a.id} className={`border-b border-[#E2E8F0] transition-colors hover:bg-[#EDF4FB] ${a.status === 'unread' ? 'bg-[#EFF6FF]' : idx % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'}`}>
                      <td className="border-r border-[#E2E8F0] py-2 pl-6 pr-3">
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: sev.textBg, color: sev.textColor }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: sev.color }} />
                          {sev.label}
                        </span>
                      </td>
                      <td className="max-w-[300px] border-r border-[#E2E8F0] px-3 py-2">
                        <span className="block truncate font-semibold text-[#0F2D52]" title={a.title || a.alert_type || 'Alert'}>{a.title || a.alert_type || 'Alert'}</span>
                        {a.message && <p className="mt-0.5 truncate text-[#64748B]" title={a.message}>{a.message}</p>}
                      </td>
                      <td className="border-r border-[#E2E8F0] px-3 py-2">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: a.type === 'notification' ? 'rgba(59,130,246,0.1)' : 'rgba(239,68,68,0.08)', color: a.type === 'notification' ? '#2563EB' : '#EF4444' }}>
                          {a.type === 'notification' ? 'Notification' : 'Alert'}
                        </span>
                      </td>
                      <td className="border-r border-[#E2E8F0] px-3 py-2 text-[#334155]">
                        {MODULE_LABELS[a.source_module] || a.source_module || '\u2014'}
                      </td>
                      <td className="border-r border-[#E2E8F0] px-3 py-2 text-[#334155]">
                        <span title={affectedBarangays(a).join(', ') || undefined}>{alertCoverage(a, true)}</span>
                      </td>
                      <td className="whitespace-nowrap border-r border-[#E2E8F0] px-3 py-2 text-[#64748B]" title={a.created_at ? new Date(a.created_at).toLocaleString() : undefined}>
                        {timeAgo(a.created_at)}
                      </td>
                      <td className="border-r border-[#E2E8F0] px-3 py-2">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: statusStyle.bg, color: statusStyle.color }}>
                          {statusStyle.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          aria-label={`View ${a.type === 'notification' ? 'notification' : 'alert'}: ${a.title || a.alert_type || 'Details'}`}
                          title="View details"
                          onClick={() => handleViewDetail(a)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-sm text-[#64748B] transition-colors hover:bg-[#E2E8F0] hover:text-[#0F2D52] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F2D52]"
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
            <div className="flex flex-col gap-3 border-t border-[#E2E8F0] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs font-semibold text-[#64748B]">
                Showing {(page - 1) * 20 + 1}\u2013{Math.min(page * 20, pagination.total)} of {pagination.total} alerts and notifications
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Previous page"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#D1D5DB] bg-[#F3F4F6] text-xs font-medium text-[#374151] hover:bg-[#E5E7EB] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ‹
                </button>
                {(() => {
                  const totalPages = pagination.totalPages;
                  const pages = [];
                  if (totalPages <= 7) {
                    for (let pageNum = 1; pageNum <= totalPages; pageNum++) pages.push(pageNum);
                  } else {
                    pages.push(1);
                    if (page > 3) pages.push('...');
                    for (let pageNum = Math.max(2, page - 1); pageNum <= Math.min(totalPages - 1, page + 1); pageNum++) pages.push(pageNum);
                    if (page < totalPages - 2) pages.push('...');
                    pages.push(totalPages);
                  }
                  return pages.map((pageNum, index) => pageNum === '...' ? (
                    <span key={`ellipsis-${index}`} className="inline-flex h-8 w-8 items-center justify-center text-xs text-[#64748B]">...</span>
                  ) : (
                    <button
                      key={pageNum}
                      type="button"
                      onClick={() => setPage(pageNum)}
                      aria-label={`Page ${pageNum}`}
                      aria-current={pageNum === page ? 'page' : undefined}
                      className={`inline-flex h-8 w-8 items-center justify-center rounded border text-xs font-semibold ${pageNum === page ? 'border-[#0F2D52] bg-[#0F2D52] text-white' : 'border-[#D1D5DB] bg-[#F3F4F6] text-[#374151] hover:bg-[#E5E7EB]'}`}
                    >
                      {pageNum}
                    </button>
                  ));
                })()}
                <button
                  type="button"
                  aria-label="Next page"
                  onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                  disabled={page >= pagination.totalPages}
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#D1D5DB] bg-[#F3F4F6] text-xs font-medium text-[#374151] hover:bg-[#E5E7EB] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ›
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Detail Modal ─── */}
      {(selectedAlert || detailLoading) && (
        <div className="fixed inset-0 z-[1100] flex justify-end" onClick={() => setSelectedAlert(null)}>
          <div className="absolute inset-0" style={{ background: 'rgba(15,23,42,0.2)', backdropFilter: 'blur(4px)' }} />
          <div
            className="relative flex h-full w-full max-w-[680px] flex-col bg-white"
            role="dialog"
            aria-modal="true"
            aria-label={selectedAlert?.title || 'Alert details'}
            style={{ animation: 'slide-in-right 0.3s ease-out both', boxShadow: '-8px 0 30px rgba(0,0,0,0.12)' }}
            onClick={e => e.stopPropagation()}
          >
            {detailLoading ? (
              <div className="p-6 space-y-4">
                <SkeletonBlock className="h-6 w-40" />
                <SkeletonBlock className="h-4 w-full" />
                <SkeletonBlock className="h-4 w-3/4" />
                <SkeletonBlock className="h-20 w-full" />
              </div>
            ) : selectedAlert && (
              <>
                {/* Header */}
                <div className="flex shrink-0 items-start justify-between gap-4 bg-[#0F2D52] px-6 py-5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#B8CDE2]">{selectedAlert.type === 'notification' ? 'Notification' : 'Alert'} details</p>
                    <h2 className="mt-1 text-lg font-semibold leading-snug text-white">{selectedAlert.title || alertTypeLabel(selectedAlert.alert_type) || 'Alert'}</h2>
                  </div>
                  <ModalCloseButton onClick={() => setSelectedAlert(null)} light />
                </div>

                <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#E2E8F0] pb-4 text-xs">
                    <span className="inline-flex items-center gap-2 font-semibold" style={{ color: (SEVERITY_STYLES[selectedAlert.severity] || SEVERITY_STYLES.info).textColor }}>
                      <span className="h-2 w-2 rounded-sm" style={{ background: (SEVERITY_STYLES[selectedAlert.severity] || SEVERITY_STYLES.info).color }} aria-hidden="true" />
                      {(SEVERITY_STYLES[selectedAlert.severity] || SEVERITY_STYLES.info).label} severity
                    </span>
                    <span className="text-[#64748B]">Status: <strong className="font-semibold text-[#334155]">{(STATUS_STYLES[selectedAlert.status] || STATUS_STYLES.unread).label}</strong></span>
                  </div>

                  {/* Detail Fields */}
                  <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                    {[
                      { label: 'Source', value: MODULE_LABELS[selectedAlert.source_module] || selectedAlert.source_module },
                      { label: 'Coverage', value: alertCoverage(selectedAlert) },
                      { label: 'Date and time', value: formatAlertDateTime(selectedAlert.created_at) },
                      { label: 'Period', value: formatAlertPeriod(selectedAlert.period) },
                      { label: 'Category', value: alertTypeLabel(selectedAlert.alert_type) },
                    ].filter(f => f.value).map(field => (
                      <div key={field.label}>
                        <dt className="text-xs text-[#64748B]">{field.label}</dt>
                        <dd className="mt-1 text-sm font-medium text-[#0F2D52]">{field.value}</dd>
                      </div>
                    ))}
                  </dl>

                  {affectedBarangays(selectedAlert).length > 1 && (
                    <section className="border-t border-[#E2E8F0] pt-4">
                      <h3 className="text-xs font-semibold text-[#64748B]">Affected barangays</h3>
                      <p className="mt-2 text-sm leading-6 text-[#334155]">{affectedBarangays(selectedAlert).join(', ')}</p>
                    </section>
                  )}

                  {/* Description */}
                  {selectedAlert.message && (
                    <section className="border-t border-[#E2E8F0] pt-5">
                      <h3 className="text-sm font-semibold text-[#0F2D52]">What happened</h3>
                      <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#475569]">{selectedAlert.message}</p>
                    </section>
                  )}

                  {/* Recommendation */}
                  {selectedAlert.recommendation && (
                    <section className="border-l-[3px] border-[#0F2D52] bg-[#F7FAFD] px-4 py-3">
                      <h3 className="text-sm font-semibold text-[#0F2D52]">Recommended action</h3>
                      <p className="mt-1 text-sm leading-6 text-[#475569]">{selectedAlert.recommendation}</p>
                    </section>
                  )}

                  {/* Resolved info */}
                  {selectedAlert.status === 'resolved' && (
                     <div className="border-t border-[#E2E8F0] pt-4 text-sm text-[#047857]">
                       <p className="font-medium">
                        Resolved {selectedAlert.resolved_at ? `on ${formatAlertDateTime(selectedAlert.resolved_at)}` : ''}
                        {selectedAlert.resolved_by ? ` by ${selectedAlert.resolved_by}` : ''}
                      </p>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[#E2E8F0] bg-white px-6 py-4">
                  {selectedAlert.status !== 'resolved' && selectedAlert.barangay_name && (
                    <button
                      type="button"
                      onClick={() => {
                        const params = new URLSearchParams({
                          alert_id: selectedAlert.id,
                          barangay: selectedAlert.barangay_name,
                        });
                        if (selectedAlert.recommendation) params.set('recommendation', selectedAlert.recommendation);
                        navigate(`/interventions?${params.toString()}`);
                        setSelectedAlert(null);
                      }}
                      className="rounded border border-[#0F766E] bg-white px-3 py-2 text-xs font-semibold text-[#0F766E] hover:bg-[#F0FDFA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F766E]"
                    >
                      Create intervention
                    </button>
                  )}
                  {selectedAlert.source_module && MODULE_ROUTES[selectedAlert.source_module] && (
                    <button
                      type="button"
                      onClick={() => { navigate(MODULE_ROUTES[selectedAlert.source_module]); setSelectedAlert(null); }}
                      className="rounded border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-semibold text-[#0F2D52] hover:bg-[#F8FAFC] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F2D52]"
                    >
                      Open {MODULE_LABELS[selectedAlert.source_module] || 'related page'} <span aria-hidden="true">→</span>
                    </button>
                  )}
                  {selectedAlert.status === 'unread' && (
                    <button
                      type="button"
                      onClick={async () => {
                        await API.put(`/api/tb/alerts/${selectedAlert.id}/read`);
                        setSelectedAlert(prev => ({ ...prev, status: 'read', read_at: new Date().toISOString() }));
                        setAlerts(prev => prev.map(a => a.id === selectedAlert.id ? { ...a, status: 'read' } : a));
                      }}
                      className="rounded border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F2D52]"
                    >
                      Mark as read
                    </button>
                  )}
                  {selectedAlert.type === 'alert' && selectedAlert.status !== 'resolved' && (
                    <button
                      type="button"
                      onClick={() => { setResolveError(''); setResolveConfirm(selectedAlert); }}
                      disabled={resolvingId === selectedAlert.id}
                      className="rounded bg-[#047857] px-3 py-2 text-xs font-semibold text-white hover:bg-[#065F46] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#047857]"
                    >
                      {resolvingId === selectedAlert.id ? <i className="ri-loader-4-line animate-spin mr-1" /> : null}
                      Resolve alert
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── Resolve Confirmation Modal ─── */}
      {resolveConfirm && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center px-4" role="alertdialog" aria-modal="true" aria-labelledby="resolve-alert-title" aria-describedby="resolve-alert-description">
          <div className="absolute inset-0 bg-[#0F2D52]/35" onClick={() => !resolvingId && setResolveConfirm(null)} />
          <div className="relative w-full max-w-[440px] overflow-hidden rounded-lg border border-[#DCE4ED] bg-white shadow-[0_20px_50px_rgba(15,45,82,0.2)]">
            <div className="border-b border-[#E2E8F0] px-6 py-4">
              <h2 id="resolve-alert-title" className="text-base font-semibold text-[#0F2D52]">Resolve alert</h2>
            </div>
            <div id="resolve-alert-description" className="px-6 py-5">
              <p className="text-sm leading-relaxed text-[#475569]">Mark this alert as resolved?</p>
              <div className="mt-4 border-l-2 border-[#C5D3E2] pl-3">
                <p className="text-sm font-semibold text-[#0F2D52]">{resolveConfirm.title || alertTypeLabel(resolveConfirm.alert_type) || 'Alert'}</p>
                {resolveConfirm.barangay_name && <p className="mt-0.5 text-xs text-[#64748B]">{resolveConfirm.barangay_name}</p>}
              </div>
              <p className="mt-4 text-xs text-[#64748B]">Its status will change to Resolved.</p>
              {resolveError && <p className="mt-3 text-xs font-medium text-[#B91C1C]" role="alert">{resolveError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-[#E2E8F0] px-6 py-4">
              <button ref={resolveCancelRef} type="button"
                onClick={() => setResolveConfirm(null)}
                disabled={resolvingId === resolveConfirm.id}
                className="rounded border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F2D52]"
              >
                Cancel
              </button>
              <button type="button"
                onClick={() => handleResolve(resolveConfirm.id)}
                disabled={resolvingId === resolveConfirm.id}
                className="rounded bg-[#047857] px-4 py-2 text-xs font-semibold text-white hover:bg-[#065F46] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#047857]"
              >
                {resolvingId === resolveConfirm.id ? <i className="ri-loader-4-line animate-spin mr-1" /> : null}
                {resolvingId === resolveConfirm.id ? 'Resolving...' : 'Resolve alert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
