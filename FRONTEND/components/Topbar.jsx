import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Logo from './Logo';
import API from '../src/api/axios';
import { avatarColorForRole, initialsForUsername } from '../src/utils/userIdentity';
import { getPrefs, onPrefsChange } from '../src/utils/preferences';

const NAV_ITEMS = [
  { icon: 'ri-pie-chart-fill', label: 'Dashboard', path: '/dashboard' },
  { icon: 'ri-stethoscope-line', label: 'TB Records', path: '/records' },
  { icon: 'ri-line-chart-line', label: 'Analytics', path: '/analytics' },
  { icon: 'ri-line-chart-line', label: 'Forecasting', path: '/forecasting' },
  { icon: 'ri-compass-3-line', label: 'GIS Hotspots', path: '/gis-map' },
  { icon: 'ri-file-text-line', label: 'Reports', path: '/reports' },
  { icon: 'ri-notification-3-line', label: 'Alerts & Notifications', path: '/alert' },
  { icon: 'ri-server-line', label: 'Data Integration', path: '/data-integration' },
  { icon: 'ri-first-aid-kit-line', label: 'Interventions', path: '/interventions' },
];

const NAV_ACCENT = {
  '/dashboard': '#3B82F6',
  '/records': '#10B981',
  '/analytics': '#8B5CF6',
  '/forecasting': '#F97316',
  '/gis-map': '#F59E0B',
  '/reports': '#EC4899',
  '/alert': '#EF4444',
  '/data-integration': '#06B6D4',
  '/interventions': '#14B8A6',
};

export default function Topbar({ user }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showBellCount, setShowBellCount] = useState(() => getPrefs().bellCount);
  useEffect(() => onPrefsChange(() => setShowBellCount(getPrefs().bellCount)), []);
  const [recentNotifs, setRecentNotifs] = useState([]);

  const storedUser = user ?? (() => {
    const s = localStorage.getItem('user');
    return s ? JSON.parse(s) : null;
  })();

  const userRole = storedUser?.role || 'admin';
  const isAdmin = userRole.toLowerCase() === 'admin';
  const initials = initialsForUsername(storedUser?.username);
  const avatarColor = avatarColorForRole(userRole);
  const displayName = storedUser?.username ?? 'System Admin';
  const displayEmail = storedUser?.email?.trim() || null;
  // Staff accounts are assigned to a barangay (login returns it as `barangay`); older
  // accounts may only have a facility.
  const staffBarangay = storedUser?.barangay?.name || storedUser?.barangay_name || null;
  const displayFacility = staffBarangay
    ? `Brgy. ${staffBarangay}`
    : storedUser?.facility?.name || storedUser?.facility_name || null;

  const visibleNavItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
      if (bellRef.current && !bellRef.current.contains(e.target)) {
        setBellOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Poll unread count + recent notifications
  useEffect(() => {
    const fetchBellData = async () => {
      try {
        const [countRes, notifRes] = await Promise.all([
          API.get('/api/tb/alerts/unread-count'),
          API.get('/api/tb/alerts', { params: { limit: 5, status: 'unread' } }),
        ]);
        setUnreadCount(countRes.data.count || 0);
        setRecentNotifs(notifRes.data.alerts || []);
      } catch {
        // silent fail — bell is non-critical
      }
    };
    fetchBellData();
    const interval = setInterval(fetchBellData, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    try {
      await API.post('/api/auth/logout');
    } catch { /* ignore */ }
    localStorage.removeItem('user');
    localStorage.removeItem('tbinsight_session');
    sessionStorage.removeItem('csrf_token');
    navigate('/login');
  };

  const formatSyncTime = () => {
    const now = new Date();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()} | ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  };

  return (
    <>
      <header className="sticky top-0 z-[1100] w-full shrink-0">
        {/* ── Tier 1: Logo + User Bar ── */}
        <div
          className="flex min-w-0 items-center justify-between gap-2 px-3 sm:px-6 lg:px-8"
          style={{ background: '#0B1D35', minHeight: '52px' }}
        >
          {/* Left: Logo */}
          <div
            className="flex items-center gap-3 cursor-pointer shrink-0"
            onClick={() => navigate('/dashboard')}
          >
            <Logo variant="icon" width={36} />
            <div className="flex items-center gap-2.5">
              <span className="text-lg font-extrabold tracking-tight" style={{ color: '#ffffff' }}>
                TBInsight
              </span>
              <span className="hidden text-[11px] font-medium xl:inline" style={{ color: '#64748B' }}>
                Pasig City TB Surveillance
              </span>
            </div>
          </div>

          {/* Right: Last Synced + Icons + User */}
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
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
                {showBellCount && unreadCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold"
                    style={{
                      background: '#EF4444',
                      color: '#ffffff',
                      padding: '0 4px',
                      boxShadow: '0 0 6px rgba(239,68,68,0.5)',
                      animation: 'bell-pulse 2s ease-in-out infinite',
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
                      onClick={() => { navigate('/alert'); setBellOpen(false); }}
                      className="text-[10px] font-semibold"
                      style={{ color: '#0F2D52' }}
                    >
                      View All
                    </button>
                  </div>

                  {recentNotifs.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <i className="ri-notification-off-line text-xl" style={{ color: '#CBD5E1' }} />
                      <p className="text-[11px] mt-2" style={{ color: '#94A3B8' }}>No new notifications</p>
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto">
                      {recentNotifs.map(n => {
                        const severityColors = {
                          critical: '#DC2626', high: '#EF4444', warning: '#D97706',
                          medium: '#D97706', low: '#2E6FAF', info: '#6B7280', danger: '#DC2626',
                        };
                        const dotColor = severityColors[n.severity] || '#6B7280';
                        const isAlert = n.type === 'alert';
                        return (
                          <div
                            key={n.id}
                            className="px-4 py-3 flex items-start gap-3 cursor-pointer transition-colors hover:bg-blue-50"
                            style={{ borderBottom: '1px solid #F1F5F9' }}
                            onClick={() => { navigate('/alert'); setBellOpen(false); }}
                          >
                            <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: dotColor }} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <p className="text-[11px] font-bold truncate" style={{ color: '#0F2D52' }}>{n.title || n.alert_type || 'Notification'}</p>
                                <span
                                  className="shrink-0 inline-flex items-center rounded px-1 py-px text-[8px] font-bold uppercase"
                                  style={{
                                    background: isAlert ? 'rgba(239,68,68,0.1)' : 'rgba(59,130,246,0.1)',
                                    color: isAlert ? '#EF4444' : '#2563EB',
                                  }}
                                >
                                  {isAlert ? 'Alert' : 'Notif'}
                                </span>
                              </div>
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
                      onClick={() => { navigate('/alert'); setBellOpen(false); }}
                      className="text-[11px] font-semibold"
                      style={{ color: '#0F2D52' }}
                    >
                      View All Notifications
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Settings */}
            <button
              onClick={() => navigate('/settings')}
              className="w-9 h-9 hidden sm:flex items-center justify-center rounded-full cursor-pointer transition-all hover:scale-105"
              style={{ background: 'rgba(255,255,255,0.08)', color: '#CBD5E1' }}
            >
              <i className="ri-settings-3-line text-base" />
            </button>

            {/* Account menu */}
            <div className="relative min-w-0" ref={dropdownRef}>
              <button
                type="button"
                aria-label={`Account menu for ${displayName}`}
                aria-expanded={dropdownOpen}
                aria-haspopup="menu"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex min-w-0 max-w-[180px] items-center gap-2.5 border-l border-white/15 py-1 pl-3 text-left sm:max-w-[230px] lg:max-w-[260px]"
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                  style={{ background: avatarColor, color: '#ffffff', border: '1px solid rgba(255,255,255,0.3)' }}
                >
                  {storedUser?.profile_photo_data ? <img src={storedUser.profile_photo_data} alt="" className="h-full w-full rounded-full object-cover" /> : initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold leading-tight text-white" title={displayName}>{displayName}</p>
                  {displayEmail && <p className="mt-0.5 truncate text-[10px] leading-tight text-slate-300" title={displayEmail}>{displayEmail}</p>}
                </div>
                <i
                  className="ri-arrow-down-s-line text-sm shrink-0 transition-transform"
                  style={{ color: '#CBD5E1', transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </button>

              {dropdownOpen && (
                <div
                  className="absolute right-0 top-full z-[1200] mt-2 w-52 overflow-hidden rounded-md border border-[#DCE3EA] bg-white py-1 shadow-[0_8px_24px_rgba(11,29,53,0.12)]"
                  role="menu"
                  aria-label="Account actions"
                >
                  <div className="border-b border-[#E2E8F0] px-4 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] text-[#64748B]">Role</span>
                      <span className="text-xs font-medium text-[#0F2D52]">{isAdmin ? 'Admin' : 'Staff'}</span>
                    </div>
                    {!isAdmin && displayFacility && (
                      <p className="mt-1.5 truncate text-[10px] text-[#64748B]" title={displayFacility}>{displayFacility}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { navigate('/profile'); setDropdownOpen(false); }}
                    className="block w-full px-4 py-2.5 text-left text-xs font-medium text-[#0F2D52] hover:bg-[#F1F5F9] focus-visible:bg-[#F1F5F9] focus-visible:outline-none"
                  >
                    My Profile
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { navigate('/settings'); setDropdownOpen(false); }}
                      className="block w-full px-4 py-2.5 text-left text-xs font-medium text-[#0F2D52] hover:bg-[#F1F5F9] focus-visible:bg-[#F1F5F9] focus-visible:outline-none"
                    >
                      Settings
                    </button>
                  )}
                  <div className="mt-1 border-t border-[#E2E8F0] pt-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleLogout}
                      className="block w-full px-4 py-2.5 text-left text-xs font-medium text-[#475569] hover:bg-[#F1F5F9] focus-visible:bg-[#F1F5F9] focus-visible:outline-none"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Tier 2: Navigation Bar ── */}
        <nav
          className="flex items-center gap-0.5 px-6 lg:px-8 overflow-x-auto"
          style={{
            background: '#0B1D35',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            paddingBottom: '2px',
          }}
        >
          {visibleNavItems.map((item) => {
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
                <i
                  className={`${item.icon} text-[13px]`}
                  style={{ color: isActive ? accent : 'inherit' }}
                />
                <span>{item.label}</span>
                {/* Active indicator line */}
                {isActive && (
                  <div
                    className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full"
                    style={{ background: accent }}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </header>

    </>
  );
}
