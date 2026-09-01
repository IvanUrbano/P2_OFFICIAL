import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';

const MODULE_LABELS = {
  gis: 'GIS Hotspots',
  analytics: 'Analytics',
  forecasting: 'Forecasting',
  reports: 'Reports',
  tb_records: 'TB Records',
  data_integration: 'Data Integration',
};

const MODULE_ROUTES = {
  gis: '/gis-map',
  analytics: '/analytics',
  forecasting: '/forecasting',
  reports: '/reports',
  tb_records: '/records',
  data_integration: '/data-integration',
};

function timeAgo(dateStr) {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function SkeletonBlock({ className }) {
  return <div className={`animate-pulse rounded-lg ${className}`} style={{ background: '#E2E8F0' }} />;
}

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

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { type: 'notification', limit: 100 };
      if (filterStatus !== 'all') params.status = filterStatus;
      if (filterSource) params.source = filterSource;
      if (filterDate !== 'all') params.date = filterDate;

      const res = await API.get('/api/tb/alerts', { params });
      setNotifications(res.data.alerts || []);
    } catch (err) {
      console.error('Notifications fetch error:', err);
      setError('Alerts and notifications could not be retrieved. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterSource, filterDate]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const handleViewDetail = async (notif) => {
    setDetailLoading(true);
    try {
      const res = await API.get(`/api/tb/alerts/${notif.id}`);
      setSelectedNotif(res.data.alert);
      if (notif.status === 'unread') {
        await API.put(`/api/tb/alerts/${notif.id}/read`);
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, status: 'read' } : n));
      }
    } catch (err) {
      console.error('Detail fetch error:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const unreadCount = notifications.filter(n => n.status === 'unread').length;

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
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: 'rgba(15,45,82,0.08)', color: '#0F2D52' }}>
              {unreadCount} unread
            </span>
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
          <button onClick={fetchNotifications} className="px-3 py-1.5 text-xs font-semibold" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 }}>
            Retry
          </button>
        </div>
      )}

      {/* ─── Filter Bar ─── */}
      {!loading && !error && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium outline-none cursor-pointer"
            style={{ background: '#F8FAFC', color: '#374151', border: '1px solid #E2E8F0' }}
          >
            <option value="all">All Status</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
          </select>

          <select
            value={filterSource}
            onChange={e => setFilterSource(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium outline-none cursor-pointer"
            style={{ background: '#F8FAFC', color: '#374151', border: '1px solid #E2E8F0' }}
          >
            <option value="">All Sources</option>
            <option value="tb_records">TB Records</option>
            <option value="forecasting">Forecasting</option>
            <option value="reports">Reports</option>
            <option value="data_integration">Data Integration</option>
            <option value="analytics">Analytics</option>
            <option value="gis">GIS Hotspots</option>
          </select>

          <select
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium outline-none cursor-pointer"
            style={{ background: '#F8FAFC', color: '#374151', border: '1px solid #E2E8F0' }}
          >
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
        </div>
      )}

      {/* ─── Empty State ─── */}
      {!loading && !error && notifications.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #E2E8F0' }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#F1F5F9' }}>
            <i className="ri-notification-off-line text-2xl" style={{ color: '#CBD5E1' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-bold" style={{ color: '#475569' }}>No Notifications</p>
            <p className="text-xs mt-1 max-w-sm" style={{ color: '#94A3B8' }}>No system notifications at this time. You're all caught up!</p>
          </div>
          <button onClick={() => navigate('/alert')} className="px-3 py-1.5 text-xs font-medium" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}>
            View All Alerts & Notifications
          </button>
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
                  <button onClick={() => setSelectedNotif(null)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.1)', color: '#CBD5E1' }}>
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
                  <button
                    onClick={() => setSelectedNotif(null)}
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
    </div>
  );
}
