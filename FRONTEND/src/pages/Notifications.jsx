import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import timeAgo from '../utils/timeAgo';
import { MODULE_LABELS, MODULE_ROUTES } from '../utils/alertConstants';
import FilterSelect from '../components/FilterSelect';
import SkeletonBlock from '../../components/SkeletonBlock';

export default function Notifications() {
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSource, setFilterSource] = useState('');
  const [filterDate, setFilterDate] = useState('all');
  const [selectedNotif, setSelectedNotif] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const abortRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const params = { type: 'notification', page, limit: 20 };
      if (filterStatus !== 'all') params.status = filterStatus;
      if (filterSource) params.source = filterSource;
      if (filterDate !== 'all') params.date = filterDate;

      const res = await API.get('/api/tb/alerts', { params, signal: controller.signal });
      setNotifications(res.data.alerts || []);
      setPagination(res.data.pagination || { total: 0, totalPages: 1 });
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      setError('Alerts and notifications could not be retrieved. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, filterSource, filterDate]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!selectedNotif) return;
    const onKey = (e) => { if (e.key === 'Escape') setSelectedNotif(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNotif]);

  const handleViewDetail = async (notif) => {
    const controller = new AbortController();
    setDetailLoading(true);
    try {
      const res = await API.get(`/api/tb/alerts/${notif.id}`, { signal: controller.signal });
      setSelectedNotif(res.data.alert);
      if (notif.status === 'unread') {
        await API.put(`/api/tb/alerts/${notif.id}/read`);
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, status: 'read' } : n));
      }
    } catch {
      // ignore
    } finally {
      setDetailLoading(false);
    }
  };

  const unreadCount = notifications.filter(n => n.status === 'unread').length;

  const handleMarkAllRead = async () => {
    try {
      await API.put('/api/tb/alerts/read-all');
      setNotifications(prev => prev.map(n => n.status === 'unread' ? { ...n, status: 'read' } : n));
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6">

      {/* ─── Page Header ─── */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)' }}>
        <div className="flex items-center justify-between px-6 py-3.5" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Notifications</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>System notifications and activity updates.</p>
          </div>
          {unreadCount > 0 && (
            <div className="flex items-center gap-3 shrink-0">
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: 'rgba(15,45,82,0.08)', color: '#0F2D52' }}>
                {unreadCount} unread
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
            </div>
          )}
        </div>
      </div>

      {/* ─── Loading State ─── */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-xl p-4" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
              <div className="flex items-center gap-4">
                <SkeletonBlock className="w-10 h-10 rounded-full" />
                <div className="flex-1">
                  <SkeletonBlock className="h-4 w-40 mb-2" />
                  <SkeletonBlock className="h-3 w-64" />
                </div>
              </div>
            </div>
          ))}
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
            <p className="text-xs mt-1 max-w-md" style={{ color: '#94A3B8' }}>{error}</p>
          </div>
          <button onClick={fetchNotifications} className="px-3 py-1.5 text-xs font-semibold" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; }} onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; }}>
            Retry
          </button>
        </div>
      )}

      {/* ─── Filter Bar ─── */}
      {!loading && !error && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
          <FilterSelect label="Status" value={filterStatus} onChange={v => { setFilterStatus(v); setPage(1); }}>
            <option value="all">All Status</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
          </FilterSelect>

          <FilterSelect label="Source" value={filterSource} onChange={v => { setFilterSource(v); setPage(1); }}>
            <option value="">All Sources</option>
            <option value="tb_records">TB Records</option>
            <option value="forecasting">Forecasting</option>
            <option value="reports">Reports</option>
            <option value="data_integration">Data Integration</option>
            <option value="analytics">Analytics</option>
            <option value="gis">GIS Hotspots</option>
          </FilterSelect>

          <FilterSelect label="Date" value={filterDate} onChange={v => { setFilterDate(v); setPage(1); }}>
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </FilterSelect>
        </div>
      )}

      {/* ─── Empty State ─── */}
      {!loading && !error && notifications.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #E2E8F0' }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#F1F5F9' }}>
            {(filterStatus !== 'all' || filterSource || filterDate !== 'all')
              ? <i className="ri-search-line text-2xl" style={{ color: '#CBD5E1' }} />
              : <i className="ri-notification-off-line text-2xl" style={{ color: '#CBD5E1' }} />
            }
          </div>
          <div className="text-center">
            <p className="text-sm font-bold" style={{ color: '#475569' }}>
              {filterStatus !== 'all' || filterSource || filterDate !== 'all'
                ? 'No Matching Notifications'
                : 'No Notifications'}
            </p>
            <p className="text-xs mt-1 max-w-sm" style={{ color: '#94A3B8' }}>
              {filterStatus !== 'all' || filterSource || filterDate !== 'all'
                ? 'No notifications match the selected filters.'
                : 'No system notifications at this time. You\'re all caught up!'}
            </p>
          </div>
          {(filterStatus !== 'all' || filterSource || filterDate !== 'all') ? (
            <button onClick={() => { setFilterStatus('all'); setFilterSource(''); setFilterDate('all'); setPage(1); }} className="px-3 py-1.5 text-xs font-semibold" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 }}>
              Clear Filters
            </button>
          ) : (
            <button onClick={() => navigate('/alert')} className="px-3 py-1.5 text-xs font-medium" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}>
              View All Alerts & Notifications
            </button>
          )}
        </div>
      )}

      {/* ─── Notification List ─── */}
      {!loading && !error && notifications.length > 0 && (
        <div className="flex flex-col gap-3">
          {notifications.map(n => (
            <div
              key={n.id}
              className="flex items-center gap-4 rounded-xl p-4 cursor-pointer transition-all"
              style={{
                background: n.status === 'unread' ? 'rgba(15,45,82,0.02)' : '#ffffff',
                border: `1px solid ${n.status === 'unread' ? '#DBEAFE' : '#E2E8F0'}`,
                boxShadow: '0 1px 3px rgba(15,45,82,0.04)',
              }}
              onClick={() => handleViewDetail(n)}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(15,45,82,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(15,45,82,0.04)'; }}
            >
              {/* Icon */}
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(59,130,246,0.08)' }}>
                <i className="ri-notification-3-line text-base" style={{ color: '#2563EB' }} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-bold" style={{ color: '#0F2D52' }}>{n.title || 'System Notification'}</span>
                  {n.status === 'unread' && (
                    <span className="w-2 h-2 rounded-full" style={{ background: '#0F2D52' }} />
                  )}
                </div>
                <p className="text-xs" style={{ color: '#64748B' }}>{n.message}</p>
                <div className="flex items-center gap-3 mt-1.5 text-[11px]" style={{ color: '#94A3B8' }}>
                  <span className="flex items-center gap-1">
                    <i className="ri-time-line" />
                    {timeAgo(n.created_at)}
                  </span>
                  {n.source_module && (
                    <span className="flex items-center gap-1">
                      <i className="ri-folder-line" />
                      {MODULE_LABELS[n.source_module] || n.source_module}
                    </span>
                  )}
                </div>
              </div>

              {/* Arrow */}
              <i className="ri-arrow-right-s-line text-lg shrink-0" style={{ color: '#CBD5E1' }} />
            </div>
          ))}
        </div>
      )}

      {/* ─── Pagination ─── */}
      {!loading && !error && notifications.length > 0 && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
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

      {/* ─── Detail Modal ─── */}
      {(selectedNotif || detailLoading) && (
        <div className="fixed inset-0 z-[1100] flex justify-end" onClick={() => setSelectedNotif(null)}>
          <div className="absolute inset-0" style={{ background: 'rgba(15,23,42,0.2)', backdropFilter: 'blur(4px)' }} />
          <div
            className="relative w-full max-w-lg overflow-y-auto"
            style={{ background: '#ffffff', animation: 'slide-in-right 0.3s ease-out both', boxShadow: '-8px 0 30px rgba(0,0,0,0.12)' }}
            onClick={e => e.stopPropagation()}
          >
            {detailLoading ? (
              <div className="p-6 space-y-4">
                <SkeletonBlock className="h-6 w-40" />
                <SkeletonBlock className="h-4 w-full" />
                <SkeletonBlock className="h-20 w-full" />
              </div>
            ) : selectedNotif && (
              <>
                <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4" style={{ background: '#0F2D52' }}>
                  <div>
                    <p className="text-sm font-bold" style={{ color: '#ffffff' }}>{selectedNotif.title || 'Notification'}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>Notification Detail</p>
                  </div>
                  <button onClick={() => setSelectedNotif(null)} className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.15)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, transition: 'background 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}>
                    <i className="ri-close-line text-base" />
                  </button>
                </div>

                <div className="p-6 space-y-5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: 'rgba(59,130,246,0.1)', color: '#2563EB' }}>Notification</span>
                    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: selectedNotif.status === 'unread' ? '#DBEAFE' : '#F1F5F9', color: selectedNotif.status === 'unread' ? '#0F2D52' : '#64748B' }}>
                      {selectedNotif.status === 'unread' ? 'Unread' : 'Read'}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {[
                      { label: 'Source', value: MODULE_LABELS[selectedNotif.source_module] || selectedNotif.source_module },
                      { label: 'Date & Time', value: selectedNotif.created_at ? new Date(selectedNotif.created_at).toLocaleString() : 'N/A' },
                      { label: 'Type', value: selectedNotif.alert_type },
                    ].filter(f => f.value).map(field => (
                      <div key={field.label} className="flex items-start gap-3">
                        <span className="text-[11px] font-semibold w-24 shrink-0 pt-0.5" style={{ color: '#94A3B8' }}>{field.label}</span>
                        <span className="text-xs font-medium" style={{ color: '#0F2D52' }}>{field.value}</span>
                      </div>
                    ))}
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold mb-1.5" style={{ color: '#94A3B8' }}>Message</p>
                    <p className="text-xs leading-relaxed" style={{ color: '#334155' }}>{selectedNotif.message}</p>
                  </div>
                </div>

                <div className="sticky bottom-0 px-6 py-4 flex items-center gap-2" style={{ borderTop: '1px solid #E2E8F0', background: '#ffffff' }}>
                  {selectedNotif.source_module && MODULE_ROUTES[selectedNotif.source_module] && (
                    <button
                      onClick={() => { navigate(MODULE_ROUTES[selectedNotif.source_module]); setSelectedNotif(null); }}
                      className="px-3 py-1.5 text-xs font-semibold"
                      style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 }}
                    >
                      View Related Module
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
