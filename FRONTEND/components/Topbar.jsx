import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Logo from './Logo';

const NAV_ITEMS = [
  { icon: 'ri-pie-chart-fill', label: 'Dashboard', path: '/dashboard' },
  { icon: 'ri-stethoscope-line', label: 'TB Records', path: '/records' },
  { icon: 'ri-line-chart-line', label: 'Analytics & Forecasting', path: '/analytics' },
  { icon: 'ri-compass-3-line', label: 'GIS Hotspots', path: '/gis-map' },
  { icon: 'ri-file-text-line', label: 'Reports', path: '/reports' },
  { icon: 'ri-notification-3-line', label: 'Alerts & Notifications', path: '/alert' },
  { icon: 'ri-server-line', label: 'Data Integration', path: '/data-integration' },
  { icon: 'ri-building-2-line', label: 'Barangays', path: '/barangays' },
  { icon: 'ri-user-3-line', label: 'Users', path: '/users', adminOnly: true },
];

const NAV_ACCENT = {
  '/dashboard': '#3B82F6',
  '/records': '#10B981',
  '/analytics': '#8B5CF6',
  '/gis-map': '#F59E0B',
  '/reports': '#EC4899',
  '/alert': '#EF4444',
  '/data-integration': '#06B6D4',
  '/barangays': '#14B8A6',
  '/users': '#6366F1',
};

export default function Topbar({ user }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const storedUser = user ?? (() => {
    const s = localStorage.getItem('user');
    return s ? JSON.parse(s) : null;
  })();

  const userRole = storedUser?.role || 'Admin';
  const isAdmin = userRole === 'Admin';
  const initials = storedUser?.username
    ? storedUser.username.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'AD';
  const displayName = storedUser?.username ?? 'System Admin';
  const displayEmail = storedUser?.email ?? 'admin@pasigcity.gov.ph';
  const displayPosition = storedUser?.position ?? 'System Administrator';

  const visibleNavItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('tbinsight_session');
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
          className="flex items-center justify-between px-6 lg:px-8"
          style={{ background: '#0B1D35', minHeight: '52px' }}
        >
        {/* Left: Logo */}
        <div
          className="flex items-center gap-3 cursor-pointer shrink-0"
          onClick={() => navigate('/dashboard')}
        >
          <Logo size={30} />
          <span className="text-lg font-extrabold tracking-tight" style={{ color: '#ffffff' }}>
            TB<span style={{ color: '#60A5FA' }}>Insight</span>
          </span>
        </div>

        {/* Right: Last Synced + Icons + User */}
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
          <button
            onClick={() => navigate('/notifications')}
            title="Notifications"
            className="relative w-9 h-9 flex items-center justify-center rounded-full cursor-pointer transition-all hover:scale-105"
            style={{ background: 'rgba(255,255,255,0.08)', color: '#CBD5E1' }}
          >
            <i className="ri-notification-3-line text-base" />
            <span
              className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
              style={{ background: '#EF4444', boxShadow: '0 0 6px #EF4444' }}
            />
          </button>

          {/* Settings */}
          <button
            onClick={() => navigate('/settings')}
            className="w-9 h-9 hidden sm:flex items-center justify-center rounded-full cursor-pointer transition-all hover:scale-105"
            style={{ background: 'rgba(255,255,255,0.08)', color: '#CBD5E1' }}
          >
            <i className="ri-settings-3-line text-base" />
          </button>

          {/* User Avatar + Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2.5 cursor-pointer shrink-0 rounded-full pl-1 pr-3 py-1 transition-all hover:bg-white/5"
              style={{
                background: dropdownOpen ? 'rgba(255,255,255,0.1)' : 'transparent',
              }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                style={{ background: '#10B981', color: '#ffffff' }}
              >
                {initials}
              </div>
              <div className="hidden lg:block text-left">
                <p className="text-xs font-bold leading-tight" style={{ color: '#ffffff' }}>{displayName}</p>
                <p className="text-[9px] leading-tight" style={{ color: '#64748B' }}>{displayEmail}</p>
              </div>
              <i
                className="ri-arrow-down-s-line text-sm shrink-0 transition-transform"
                style={{ color: '#64748B', transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </button>

            {dropdownOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-60 rounded-xl overflow-hidden z-[1200]"
                style={{
                  background: '#ffffff',
                  border: '1px solid #E2E8F0',
                  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.08)',
                }}
              >
                <div className="px-4 py-3" style={{ borderBottom: '1px solid #E2E8F0' }}>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ background: '#10B981', color: '#ffffff' }}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate" style={{ color: '#0F2D52' }}>{displayName}</p>
                      <p className="text-[10px] truncate" style={{ color: '#94A3B8' }}>{displayEmail}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold"
                      style={{
                        background: isAdmin ? 'rgba(37,99,235,0.1)' : 'rgba(0,216,246,0.15)',
                        color: isAdmin ? '#2563EB' : '#00A9D8',
                      }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: isAdmin ? '#2563EB' : '#00A9D8' }} />
                      {userRole}
                    </span>
                    <span className="text-[9px] font-medium" style={{ color: '#94A3B8' }}>{displayPosition}</span>
                  </div>
                </div>

                <div className="py-1">
                  {[
                    { icon: 'ri-user-settings-line', label: 'My Profile', color: '#2563EB', action: () => { navigate('/profile'); setDropdownOpen(false); } },
                    ...(isAdmin ? [{ icon: 'ri-settings-3-line', label: 'Settings', color: '#64748B', action: () => { navigate('/settings'); setDropdownOpen(false); } }] : []),
                    { icon: 'ri-question-line', label: 'Help & Support', color: '#64748B', action: () => setDropdownOpen(false) },
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
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium transition-colors hover:bg-red-50"
                    style={{ color: '#EF4444' }}
                  >
                    <i className="ri-logout-box-r-line text-sm" />
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
