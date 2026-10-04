import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import { SEVERITY_COLOR, TYPE_ICON, timeAgo, markRead, markUnread, markAllRead, announceChange } from '../utils/notifications';

const TABS = [
  { key: 'unread', title: 'Unread', desc: 'Still needs your attention' },
  { key: 'all', title: 'All', desc: 'Everything sent to you' },
];
const PAGE_SIZE = 20;

/** Full list of the signed-in user's notifications (the bell shows only the latest few). */
export default function NotificationsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('unread');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await API.get('/api/auth/notifications', {
        params: { status: tab === 'unread' ? 'unread' : undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      });
      setItems(res.data.notifications || []);
      setTotal(res.data.total || 0);
      setUnread(res.data.unread || 0);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  }, [tab, page]);

  useEffect(() => { load(); }, [load]);

  const toggleRead = async (n) => {
    try {
      await (n.is_read ? markUnread(n.id) : markRead(n.id));
      announceChange();
      load();
    } catch {
      setError('Failed to update the notification.');
    }
  };

  const open = async (n) => {
    if (!n.is_read) {
      try { await markRead(n.id); announceChange(); } catch { /* ignore */ }
    }
    if (n.link) navigate(n.link); else load();
  };

  const readAll = async () => {
    try { await markAllRead(); announceChange(); setPage(0); load(); } catch { setError('Failed to update notifications.'); }
  };

  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-5">
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Notifications</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Referrals, validation results, sync status and account changes that concern you.</p>
          </div>
          {unread > 0 && (
            <button onClick={readAll} className="px-3 py-1.5 text-xs font-semibold" style={{ background: '#ffffff', color: '#0F2D52', border: '1px solid #CBD5E1', borderRadius: 4 }}>
              Mark all as read
            </button>
          )}
        </div>
        <div className="flex gap-0 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setPage(0); }} className="relative px-5 py-3 text-left whitespace-nowrap">
              <p className="text-[13px] font-bold" style={{ color: tab === t.key ? '#0F2D52' : '#94A3B8' }}>
                {t.title}
                {t.key === 'unread' && unread > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[9px] font-bold px-1.5" style={{ background: tab === t.key ? 'rgba(15,45,82,0.08)' : '#F1F5F9', color: tab === t.key ? '#0F2D52' : '#64748B' }}>
                    {unread}
                  </span>
                )}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: tab === t.key ? '#64748B' : '#CBD5E1' }}>{t.desc}</p>
              {tab === t.key && <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B' }}>{error}</div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
        {loading ? (
          <p className="text-xs text-center py-10" style={{ color: '#94A3B8' }}>Loading…</p>
        ) : items.length === 0 ? (
          <div className="py-12 text-center">
            <i className="ri-notification-off-line text-2xl" style={{ color: '#CBD5E1' }} />
            <p className="text-xs mt-2" style={{ color: '#94A3B8' }}>{tab === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}</p>
          </div>
        ) : (
          <>
            {items.map(n => {
              const color = SEVERITY_COLOR[n.severity] || SEVERITY_COLOR.info;
              return (
                <div key={n.id} className="flex items-start gap-3 px-5 py-3.5" style={{ borderBottom: '1px solid #F1F5F9', background: n.is_read ? '#ffffff' : '#F5F9FF' }}>
                  <i className={`${TYPE_ICON[n.type] || 'ri-notification-3-line'} text-base mt-0.5 shrink-0`} style={{ color }} />
                  <button type="button" onClick={() => open(n)} className="min-w-0 flex-1 text-left">
                    <p className={`text-xs ${n.is_read ? 'font-medium' : 'font-bold'}`} style={{ color: '#0F2D52' }}>{n.title}</p>
                    {n.message && <p className="text-[11px] mt-0.5" style={{ color: '#64748B' }}>{n.message}</p>}
                    <p className="text-[10px] mt-1" style={{ color: '#94A3B8' }}>
                      {timeAgo(n.created_at)}
                      {n.link && <span className="ml-2" style={{ color: '#2E6FAF' }}>Open →</span>}
                    </p>
                  </button>
                  <button type="button" onClick={() => toggleRead(n)} className="text-[10px] font-semibold shrink-0 hover:underline" style={{ color: '#64748B' }}>
                    {n.is_read ? 'Mark unread' : 'Mark read'}
                  </button>
                </div>
              );
            })}
            {pages > 1 && (
              <div className="flex items-center justify-between px-5 py-2.5 text-[11px]" style={{ color: '#64748B' }}>
                <span>Page {page + 1} of {pages}</span>
                <div className="flex gap-1.5">
                  <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-2.5 py-1 rounded disabled:opacity-40" style={{ border: '1px solid #E2E8F0' }}>Previous</button>
                  <button disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)} className="px-2.5 py-1 rounded disabled:opacity-40" style={{ border: '1px solid #E2E8F0' }}>Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
