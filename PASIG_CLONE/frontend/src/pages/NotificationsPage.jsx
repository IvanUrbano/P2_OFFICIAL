import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import { TYPE_LABEL, formatNotificationDate, markRead, markUnread, markAllRead, announceChange } from '../utils/notifications';

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
    <section className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-5 sm:px-6">
        <div>
          <h1 className="text-lg font-bold text-[#0F2D52]">Notifications</h1>
          <p className="mt-1 text-xs text-[#64748B]">Updates from imports, validation, assignments and syncing.</p>
        </div>
        {unread > 0 && (
          <button type="button" onClick={readAll} className="text-xs font-semibold text-[#2E6FAF] hover:underline">
            Mark all as read
          </button>
        )}
      </header>

      <nav className="flex gap-0 overflow-x-auto border-b border-[#E2E8F0]" aria-label="Notification filter">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => { setTab(t.key); setPage(0); }}
            className="relative px-5 py-3 text-left whitespace-nowrap"
          >
            <p className="text-[13px] font-bold" style={{ color: tab === t.key ? '#0F2D52' : '#334155' }}>
              {t.title}
              {t.key === 'unread' && unread > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[9px] font-bold px-1.5" style={{ background: tab === t.key ? 'rgba(15,45,82,0.08)' : '#F1F5F9', color: tab === t.key ? '#0F2D52' : '#64748B' }}>
                  {unread}
                </span>
              )}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: tab === t.key ? '#475569' : '#64748B' }}>{t.desc}</p>
            {tab === t.key && <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />}
          </button>
        ))}
      </nav>

      {error && <p className="border-b border-[#FECACA] bg-[#FEF2F2] px-5 py-3 text-xs text-[#991B1B]" role="alert">{error}</p>}

      {loading ? (
        <p className="px-6 py-12 text-center text-xs text-[#64748B]">Loading notifications…</p>
      ) : items.length === 0 ? (
        <p className="px-6 py-12 text-center text-xs text-[#64748B]">
          {tab === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}
        </p>
      ) : (
        <div className="divide-y divide-[#E8EDF2]">
          {items.map(n => (
            <div key={n.id} className="flex gap-3 px-5 py-4 hover:bg-[#FAFBFC] sm:px-6">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? 'bg-transparent' : 'bg-[#2E6FAF]'}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
                    {TYPE_LABEL[n.type] || 'Update'}
                  </span>
                  <time dateTime={n.created_at} className="text-[11px] text-[#64748B]">
                    {formatNotificationDate(n.created_at)}
                  </time>
                </div>
                <button type="button" onClick={() => open(n)} className={`mt-1 block text-left text-[13px] text-[#0F2D52] hover:underline ${n.is_read ? 'font-medium' : 'font-semibold'}`}>
                  {n.title}
                </button>
                {n.message && <p className="mt-1 text-xs leading-relaxed text-[#64748B]">{n.message}</p>}
                <div className="mt-2 flex items-center gap-4">
                  {n.link && <button type="button" onClick={() => open(n)} className="text-[11px] font-semibold text-[#2E6FAF] hover:underline">View details</button>}
                  <button type="button" onClick={() => toggleRead(n)} className="text-[11px] text-[#64748B] hover:text-[#0F2D52] hover:underline">
                    {n.is_read ? 'Mark unread' : 'Mark read'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {pages > 1 && !loading && (
        <div className="flex items-center justify-between border-t border-[#E2E8F0] px-5 py-3 text-[11px] text-[#64748B] sm:px-6">
          <span>Page {page + 1} of {pages}</span>
          <div className="flex gap-4">
            <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)} className="disabled:opacity-40 hover:underline">Previous</button>
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)} className="disabled:opacity-40 hover:underline">Next</button>
          </div>
        </div>
      )}
    </section>
  );
}
