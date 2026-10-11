import { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import API from '../api/axios';
import { TYPE_LABEL, timeAgo, markRead, markAllRead, NOTIFICATIONS_CHANGED, announceChange } from '../utils/notifications';
import { INACTIVITY_TIMEOUT_MS } from '../utils/session';
import { avatarColorForRole, initialsForUsername } from '../utils/userIdentity';

const NAV_ITEMS = [
  { icon: 'ri-dashboard-line', label: 'Dashboard', path: '/dashboard' },
  { icon: 'ri-hospital-line', label: 'Health Facilities', path: '/facilities' },
  { icon: 'ri-stethoscope-line', label: 'TB Records', path: '/records' },
  { icon: 'ri-capsule-line', label: 'Medication Schedule', path: '/medication' },
  { icon: 'ri-upload-cloud-2-line', label: 'Data Import', path: '/import' },
  { icon: 'ri-checkbox-circle-line', label: 'Validation', path: '/validation' },
  { icon: 'ri-server-line', label: 'Sync', path: '/sync' },
  { icon: 'ri-history-line', label: 'Sync History', path: '/sync-history' },
  { icon: 'ri-team-line', label: 'Users', path: '/users', adminOnly: true },
  { icon: 'ri-file-list-3-line', label: 'Audit Logs', path: '/audit-logs', adminOnly: true },
];

const NAV_ACCENT = {
  '/dashboard': '#0EA5E9',
  '/facilities': '#3B82F6',
  '/records': '#10B981',
  '/medication': '#14B8A6',
  '/import': '#8B5CF6',
  '/validation': '#F97316',
  '/sync': '#06B6D4',
  '/sync-history': '#F59E0B',
  '/users': '#6366F1',
  '/audit-logs': '#EC4899',
};

const IMPORT_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Manila', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
});
const IMPORT_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true,
});

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
  const [bellError, setBellError] = useState(false);
  const [lastImport, setLastImport] = useState(null);

  // Last Import in the brand bar — refreshes on load and whenever a page announces
  // an import/archive/delete so the header never shows a stale timestamp.
  const fetchLastImport = useCallback(async () => {
    try {
      const res = await API.get('/api/data/last-import');
      setLastImport(res.data.lastImport || null);
    } catch {
      // header timestamp is non-critical
    }
  }, []);

  useEffect(() => {
    fetchLastImport();
    window.addEventListener('IMPORT_COMPLETED', fetchLastImport);
    return () => window.removeEventListener('IMPORT_COMPLETED', fetchLastImport);
  }, [fetchLastImport]);

  useEffect(() => {
    API.get('/api/auth/profile')
      .then(res => setUser(res.data.user))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const updatePhoto = (event) => setUser((current) => current ? { ...current, profile_photo_data: event.detail.photo } : current);
    window.addEventListener('profile-photo-updated', updatePhoto);
    return () => window.removeEventListener('profile-photo-updated', updatePhoto);
  }, []);

  // Accounts still on a system-generated temporary password must set their own
  // before using the system: keep them on Settings > Security until they do.
  useEffect(() => {
    if (user?.must_change_password && location.pathname !== '/settings') {
      navigate('/settings?tab=security&firstLogin=1', { replace: true });
    }
  }, [user, location.pathname, navigate]);

  const logout = useCallback(async () => {
    try { await API.post('/api/auth/logout'); } catch {}
    localStorage.removeItem('user');
    window.location.href = import.meta.env.VITE_MAIN_APP_URL || 'https://p2-official.vercel.app';
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

  // Poll unread count + latest notifications (every 30s, on opening the bell, and when
  // another page announces a change).
  const fetchBellData = useCallback(async () => {
    try {
      const res = await API.get('/api/auth/notifications', { params: { limit: 8 } });
      setUnreadCount(res.data.unread || 0);
      setRecentNotifs(res.data.notifications || []);
      setBellError(false);
    } catch {
      setBellError(true);
    }
  }, []);

  useEffect(() => {
    fetchBellData();
    const interval = setInterval(fetchBellData, 30000);
    window.addEventListener(NOTIFICATIONS_CHANGED, fetchBellData);
    return () => {
      clearInterval(interval);
      window.removeEventListener(NOTIFICATIONS_CHANGED, fetchBellData);
    };
  }, [fetchBellData]);

  const toggleBell = () => {
    if (!bellOpen) fetchBellData();
    setBellOpen(!bellOpen);
  };

  const openNotification = async (n) => {
    setBellOpen(false);
    if (!n.is_read) {
      setRecentNotifs(list => list.map(x => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnreadCount(c => Math.max(0, c - 1));
      try { await markRead(n.id); announceChange(); } catch { /* next poll corrects it */ }
    }
    if (n.link) navigate(n.link);
  };

  const readAll = async () => {
    setRecentNotifs(list => list.map(x => ({ ...x, is_read: true })));
    setUnreadCount(0);
    try { await markAllRead(); announceChange(); } catch { fetchBellData(); }
  };

  if (!user) return null;

  const isAdmin = user.role === 'admin';
  const initials = initialsForUsername(user.username);
  const avatarColor = avatarColorForRole(user.role);
  const displayEmail = user.email?.trim() || null;
  const assignedArea = user.barangay_name ? `Brgy. ${user.barangay_name}` : user.facility_name;
  const visibleNav = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  const formatImportTime = (iso) => {
    if (!iso) return 'Never';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${IMPORT_DATE_FORMATTER.format(d)} | ${IMPORT_TIME_FORMATTER.format(d)}`;
  };

  return (
    <div className="h-screen relative flex flex-col overflow-hidden">
      {/* ── Tier 1: Brand Bar ── */}
      <header className="sticky top-0 z-[1100] w-full shrink-0">
        <div className="flex min-w-0 items-center justify-between gap-2 px-3 sm:px-6 lg:px-8" style={{ background: '#0B1D35', minHeight: '52px' }}>
          <div className="flex items-center gap-3 cursor-pointer shrink-0" onClick={() => navigate('/facilities')}>
            <img
              src="/images/pasig-tb-is-logo.png"
              alt="Pasig City Tuberculosis Control Program logo"
              className="h-9 w-9 shrink-0 object-contain"
            />
            <div className="flex items-center gap-2.5">
              <span className="text-lg font-extrabold tracking-tight" style={{ color: '#ffffff' }}>PASIG TB-IS</span>
              {!isAdmin && (user.barangay_name || user.facility_name) && (
                <span className="text-[11px] font-semibold hidden md:inline px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.15)', color: '#10B981' }}>
                  <i className="ri-map-pin-line mr-1" style={{ fontSize: '10px' }} />
                  {(user.barangay_name ? `Brgy. ${user.barangay_name}` : user.facility_name)}
                </span>
              )}
              {isAdmin && (
                <span className="text-[11px] font-medium hidden xl:inline" style={{ color: '#64748B' }}>Tuberculosis Information System</span>
              )}
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            {/* Last Import */}
            <div className="hidden md:flex items-center gap-2">
              <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.2)' }}>
                <i className="ri-upload-2-line text-[11px]" style={{ color: '#60A5FA' }} />
              </div>
              <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>
                Last Import: <span style={{ color: '#CBD5E1' }}>{formatImportTime(lastImport)}</span>
              </span>
            </div>

            {/* Separator */}
            <div className="hidden md:block w-px h-5" style={{ background: 'rgba(255,255,255,0.1)' }} />

            {/* Notification Bell */}
            <div className="relative" ref={bellRef}>
              <button
                onClick={toggleBell}
                title="Notifications"
                className="topbar-round-button relative w-9 h-9 flex items-center justify-center rounded-full cursor-pointer transition-all hover:scale-105"
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
                    }}
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Bell Dropdown */}
              {bellOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-[340px] max-w-[calc(100vw-24px)] rounded-xl overflow-hidden z-[1200]"
                  style={{
                    background: '#ffffff',
                    border: '1px solid #E2E8F0',
                    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.08)',
                  }}
                >
                  <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <div>
                      <p className="text-xs font-bold" style={{ color: '#0F2D52' }}>Notifications</p>
                      <p className="text-[10px] mt-0.5" style={{ color: '#94A3B8' }}>
                        {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
                      </p>
                    </div>
                    {unreadCount > 0 && (
                      <button onClick={readAll} className="text-[10px] font-semibold hover:underline" style={{ color: '#2E6FAF' }}>
                        Mark all as read
                      </button>
                    )}
                  </div>

                  {bellError ? (
                    <div className="px-4 py-6 text-center" role="alert">
                      <p className="text-[11px]" style={{ color: '#991B1B' }}>Could not load notifications.</p>
                      <button onClick={fetchBellData} className="text-[11px] font-semibold mt-2 hover:underline" style={{ color: '#2E6FAF' }}>Retry</button>
                    </div>
                  ) : recentNotifs.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <p className="text-[11px] text-[#64748B]">No notifications yet.</p>
                    </div>
                  ) : (
                    <div className="max-h-80 overflow-y-auto">
                      {recentNotifs.map((n) => (
                          <button
                            type="button"
                            key={n.id}
                            className="w-full border-b border-[#E8EDF2] px-4 py-3 text-left flex items-start gap-3 hover:bg-[#FAFBFC]"
                            onClick={() => openNotification(n)}
                          >
                            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? 'bg-transparent' : 'bg-[#2E6FAF]'}`} aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[9px] font-semibold uppercase tracking-wider text-[#64748B]">{TYPE_LABEL[n.type] || 'Update'}</span>
                                <span className="shrink-0 text-[10px] text-[#94A3B8]">{timeAgo(n.created_at)}</span>
                              </div>
                              <p className={`mt-1 text-[11px] leading-snug text-[#0F2D52] ${n.is_read ? 'font-medium' : 'font-semibold'}`}>{n.title}</p>
                              {n.message && <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[#64748B]">{n.message}</p>}
                            </div>
                          </button>
                      ))}
                    </div>
                  )}

                  <div className="px-4 py-2.5 text-center" style={{ borderTop: '1px solid #E2E8F0' }}>
                    <button
                      onClick={() => { setBellOpen(false); navigate('/notifications'); }}
                      className="text-[11px] font-semibold hover:underline"
                      style={{ color: '#0F2D52' }}
                    >
                      View all notifications
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Settings */}
            <button
              onClick={() => navigate('/settings')}
              title="Settings"
              className="topbar-round-button w-9 h-9 hidden sm:flex items-center justify-center rounded-full cursor-pointer transition-all hover:scale-105"
              style={{ background: 'rgba(255,255,255,0.08)', color: '#CBD5E1' }}
            >
              <i className="ri-settings-3-line text-base" />
            </button>

            {/* Account menu */}
            <div className="relative min-w-0" ref={dropdownRef}>
              <button
                type="button"
                aria-label={`Account menu for ${user.username}`}
                aria-expanded={dropdownOpen}
                aria-haspopup="menu"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex min-w-0 max-w-[180px] items-center gap-2.5 border-l border-white/15 py-1 pl-3 text-left sm:max-w-[230px] lg:max-w-[260px]"
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: avatarColor, color: '#ffffff', border: '1px solid rgba(255,255,255,0.3)' }}>
                  {user.profile_photo_data ? <img src={user.profile_photo_data} alt="" className="h-full w-full rounded-full object-cover" /> : initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold leading-tight text-white" title={user.username}>{user.username}</p>
                  {displayEmail && <p className="mt-0.5 truncate text-[10px] leading-tight text-slate-300" title={displayEmail}>{displayEmail}</p>}
                </div>
                <i className="ri-arrow-down-s-line text-sm shrink-0 transition-transform" style={{ color: '#CBD5E1', transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 top-full z-[1200] mt-2 w-52 overflow-hidden rounded-md border border-[#DCE3EA] bg-white py-1 shadow-[0_8px_24px_rgba(11,29,53,0.12)]" role="menu" aria-label="Account actions">
                  <div className="border-b border-[#E2E8F0] px-4 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] text-[#64748B]">Role</span>
                      <span className="text-xs font-medium text-[#0F2D52]">{isAdmin ? 'Admin' : 'Staff'}</span>
                    </div>
                    {!isAdmin && assignedArea && (
                      <p className="mt-1.5 truncate text-[10px] text-[#64748B]" title={assignedArea}>{assignedArea}</p>
                    )}
                  </div>
                  <button type="button" role="menuitem" onClick={() => { navigate('/profile'); setDropdownOpen(false); }} className="block w-full px-4 py-2.5 text-left text-xs font-medium text-[#0F2D52] hover:bg-[#F1F5F9] focus-visible:bg-[#F1F5F9] focus-visible:outline-none">
                    My Profile
                  </button>
                  {isAdmin && (
                    <button type="button" role="menuitem" onClick={() => { navigate('/settings'); setDropdownOpen(false); }} className="block w-full px-4 py-2.5 text-left text-xs font-medium text-[#0F2D52] hover:bg-[#F1F5F9] focus-visible:bg-[#F1F5F9] focus-visible:outline-none">
                      Settings
                    </button>
                  )}
                  <div className="mt-1 border-t border-[#E2E8F0] pt-1">
                    <button type="button" role="menuitem" onClick={logout} className="block w-full px-4 py-2.5 text-left text-xs font-medium text-[#475569] hover:bg-[#F1F5F9] focus-visible:bg-[#F1F5F9] focus-visible:outline-none">
                      Sign Out
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
