import { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import API from '../api/axios';

const NAV_ITEMS = [
  { icon: 'ri-hospital-line', label: 'Health Facilities', path: '/facilities' },
  { icon: 'ri-stethoscope-line', label: 'TB Records', path: '/records' },
  { icon: 'ri-upload-cloud-2-line', label: 'Data Import', path: '/import' },
  { icon: 'ri-checkbox-circle-line', label: 'Validation', path: '/validation' },
  { icon: 'ri-server-line', label: 'Sync', path: '/sync' },
  { icon: 'ri-history-line', label: 'Sync History', path: '/sync-history' },
  { icon: 'ri-team-line', label: 'Users', path: '/users', adminOnly: true },
  { icon: 'ri-file-list-3-line', label: 'Audit Logs', path: '/audit-logs', adminOnly: true },
];

const NAV_ACCENT = {
  '/facilities': '#3B82F6',
  '/records': '#10B981',
  '/import': '#8B5CF6',
  '/validation': '#F97316',
  '/sync': '#06B6D4',
  '/sync-history': '#F59E0B',
  '/users': '#6366F1',
  '/audit-logs': '#EC4899',
};

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

export default function Layout() {
  const [user, setUser] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const dropdownRef = useRef(null);
  const timerRef = useRef(null);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [recentNotifs, setRecentNotifs] = useState([]);

  useEffect(() => {
    API.get('/api/auth/profile')
      .then(res => setUser(res.data.user))
      .catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    try { await API.post('/api/auth/logout'); } catch {}
    localStorage.removeItem('user');
    window.location.href = 'https://p2-official.vercel.app';
  }, [navigate]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(logout, INACTIVITY_TIMEOUT_MS);
  }, [logout]);

  useEffect(() => {
    if (!user) return;
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach((e) => document.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      events.forEach((e) => document.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [user, resetTimer]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setDropdownOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Poll unread count + recent notifications
  useEffect(() => {
    const fetchBellData = async () => {
      try {
        const [countRes, notifRes] = await Promise.all([
          API.get('/api/auth/notifications/unread-count'),
          API.get('/api/auth/notifications', { params: { limit: 5, status: 'unread' } }),
        ]);
        setUnreadCount(countRes.data.count || 0);
        setRecentNotifs(notifRes.data.notifications || []);
      } catch {
        // silent fail — bell is non-critical
      }
    };
    fetchBellData();
    const interval = setInterval(fetchBellData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!user) return null;

  const isAdmin = user.role === 'admin';
  const initials = user.username ? user.username.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) : 'U';
  const visibleNav = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  const formatSyncTime = () => {
    const now = new Date();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()} | ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  };

  return (
    <div className="h-screen relative flex flex-col">
      {/* ── Tier 1: Brand Bar ── */}
      <header className="sticky top-0 z-[1100] w-full shrink-0">
        <div className="flex items-center justify-between px-6 lg:px-8" style={{ background: '#0B1D35', minHeight: '52px' }}>
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/facilities')}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.15)' }}>
              <span className="text-sm font-extrabold" style={{ color: '#ffffff' }}>P2</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-lg font-extrabold tracking-tight" style={{ color: '#ffffff' }}>PASIG TB-IS</span>
              <span className="text-[11px] font-medium hidden sm:inline" style={{ color: '#64748B' }}>Tuberculosis Information System</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Last Synced */}
            <div className="hidden md:flex items-center gap-2">
              <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.2)' }}>
                <i className="ri-refresh-line text-[11px]" style={{ color: '#60A5FA' }} />
              </div>
              <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>
                Last Synced: <span style={{ color: '#CBD5E1' }}>{formatSyncTime()}</span>
              </span>
            </div>

            {/* Separator */}
            <div className="hidden md:block w-px h-5" style={{ background: 'rgba(255,255,255,0.1)' }} />

            {/* Notification Bell */}
            <div className="relative" ref={bellRef}>
              <button
                onClick={() => setBellOpen(!bellOpen)}
                title="Notifications"
                className="relative w-9 h-9 flex items-center justify-center rounded-full cursor-pointer transition-all hover:scale-105"
                style={{ background: bellOpen ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)', color: '#CBD5E1' }}
              >
                <i className="ri-notification-3-line text-base" />
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold"
                    style={{
                      background: '#EF4444',
                      color: '#ffffff',
                      padding: '0 4px',
                      boxShadow: '0 0 6px rgba(239,68,68,0.5)',
                    }}
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Bell Dropdown */}
              {bellOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-80 rounded-xl overflow-hidden z-[1200]"
                  style={{
                    background: '#ffffff',
                    border: '1px solid #E2E8F0',
                    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.08)',
                  }}
                >
                  <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <div>
                      <p className="text-xs font-bold" style={{ color: '#0F2D52' }}>Notifications</p>
                      {unreadCount > 0 && (
                        <p className="text-[10px] mt-0.5" style={{ color: '#94A3B8' }}>{unreadCount} unread</p>
                      )}
                    </div>
                    <button
                      onClick={() => setBellOpen(false)}
                      className="text-[10px] font-semibold"
                      style={{ color: '#0F2D52' }}
                    >
                      Dismiss
                    </button>
                  </div>

                  {recentNotifs.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <i className="ri-notification-off-line text-xl" style={{ color: '#CBD5E1' }} />
                      <p className="text-[11px] mt-2" style={{ color: '#94A3B8' }}>No new notifications</p>
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto">
                      {recentNotifs.map((n, idx) => {
                        const severityColors = {
                          critical: '#DC2626', high: '#EF4444', warning: '#D97706',
                          medium: '#D97706', low: '#2E6FAF', info: '#6B7280', danger: '#DC2626',
                        };
                        const dotColor = severityColors[n.severity] || '#6B7280';
                        return (
                          <div
                            key={n.id || idx}
                            className="px-4 py-3 flex items-start gap-3 cursor-pointer transition-colors hover:bg-blue-50"
                            style={{ borderBottom: '1px solid #F1F5F9' }}
                            onClick={() => setBellOpen(false)}
                          >
                            <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: dotColor }} />
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-bold truncate" style={{ color: '#0F2D52' }}>{n.title || 'Notification'}</p>
                              <p className="text-[10px] mt-0.5 line-clamp-2" style={{ color: '#64748B' }}>{n.message}</p>
                              <p className="text-[9px] mt-1" style={{ color: '#94A3B8' }}>
                                {n.created_at ? (() => {
                                  const d = new Date(n.created_at);
                                  const mins = Math.floor((new Date() - d) / 60000);
                                  if (mins < 1) return 'Just now';
                                  if (mins < 60) return `${mins}m ago`;
                                  const hrs = Math.floor(mins / 60);
                                  if (hrs < 24) return `${hrs}h ago`;
                                  return `${Math.floor(hrs / 24)}d ago`;
                                })() : ''}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="px-4 py-2.5 text-center" style={{ borderTop: '1px solid #E2E8F0' }}>
                    <button
                      onClick={() => setBellOpen(false)}
                      className="text-[11px] font-semibold"
                      style={{ color: '#0F2D52' }}
                    >
                      Dismiss All
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Settings */}
            <button
              onClick={() => navigate('/settings')}
              title="Settings"
              className="w-9 h-9 hidden sm:flex items-center justify-center rounded-full cursor-pointer transition-all hover:scale-105"
              style={{ background: 'rgba(255,255,255,0.08)', color: '#CBD5E1' }}
            >
              <i className="ri-settings-3-line text-base" />
            </button>

            {/* User Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2.5 cursor-pointer shrink-0 rounded-full pl-1 pr-3 py-1 transition-all hover:bg-white/5"
                style={{ background: dropdownOpen ? 'rgba(255,255,255,0.1)' : 'transparent' }}
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: '#10B981', color: '#ffffff' }}>
                  {initials}
                </div>
                <div className="hidden lg:block text-left">
                  <p className="text-xs font-bold leading-tight" style={{ color: '#ffffff' }}>{user.username}</p>
                  <p className="text-[9px] leading-tight" style={{ color: '#64748B' }}>{user.email}</p>
                </div>
                <i className="ri-arrow-down-s-line text-sm shrink-0 transition-transform" style={{ color: '#64748B', transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-60 rounded-xl overflow-hidden z-[1200]" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.08)' }}>
                  <div className="px-4 py-3" style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: '#10B981', color: '#ffffff' }}>
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate" style={{ color: '#0F2D52' }}>{user.username}</p>
                        <p className="text-[10px] truncate" style={{ color: '#94A3B8' }}>{user.email}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ background: isAdmin ? 'rgba(37,99,235,0.1)' : 'rgba(0,216,246,0.15)', color: isAdmin ? '#2563EB' : '#00A9D8' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: isAdmin ? '#2563EB' : '#00A9D8' }} />
                        {user.role}
                      </span>
                      <span className="text-[9px] font-medium" style={{ color: '#94A3B8' }}>{user.position || 'System Administrator'}</span>
                    </div>
                  </div>

                  <div className="py-1">
                    {[
                      { icon: 'ri-user-settings-line', label: 'My Profile', color: '#2563EB', action: () => { navigate('/profile'); setDropdownOpen(false); } },
                      ...(isAdmin ? [{ icon: 'ri-settings-3-line', label: 'Settings', color: '#64748B', action: () => { navigate('/settings'); setDropdownOpen(false); } }] : []),
                    ].map((item) => (
                      <button
                        key={item.label}
                        onClick={item.action}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium transition-colors hover:bg-blue-50"
                        style={{ color: '#334155' }}
                      >
                        <i className={`${item.icon} text-sm`} style={{ color: item.color }} />
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <div className="py-1" style={{ borderTop: '1px solid #E2E8F0' }}>
                    <button onClick={logout} className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium transition-colors hover:bg-red-50" style={{ color: '#EF4444' }}>
                      <i className="ri-logout-box-r-line text-sm" /> Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Tier 2: Navigation Tabs ── */}
        <nav className="flex items-center gap-0.5 px-6 lg:px-8 overflow-x-auto" style={{ background: '#0B1D35', borderTop: '1px solid rgba(255,255,255,0.06)', paddingBottom: '2px' }}>
          {visibleNav.map((item) => {
            const isActive = location.pathname === item.path;
            const accent = NAV_ACCENT[item.path] || '#3B82F6';
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className="relative flex items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold transition-all duration-200 cursor-pointer"
                style={{
                  padding: '10px 14px',
                  color: isActive ? '#ffffff' : 'rgba(255,255,255,0.55)',
                  background: isActive ? 'rgba(255,255,255,0.07)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = 'rgba(255,255,255,0.85)';
                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = 'rgba(255,255,255,0.55)';
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <i className={`${item.icon} text-[13px]`} style={{ color: isActive ? accent : 'inherit' }} />
                <span>{item.label}</span>
                {isActive && <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full" style={{ background: accent }} />}
              </button>
            );
          })}
        </nav>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
        <div className="px-6 lg:px-10 pt-6 pb-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
