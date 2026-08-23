import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Logo from './Logo';

const NAV_ITEMS = [
  { icon: 'ri-dashboard-fill', label: 'Dashboard', path: '/dashboard' },
  { icon: 'ri-lungs-line', label: 'TB Records', path: '/records' },
  { icon: 'ri-bar-chart-box-line', label: 'Forecasting', path: '/analytics' },
  { icon: 'ri-database-2-line', label: 'Data Integration', path: '/data-integration' },
  { icon: 'ri-map-2-line', label: 'GIS Hotspot', path: '/gis-map' },
  { icon: 'ri-community-line', label: 'Barangays', path: '/barangays' },
  { icon: 'ri-file-chart-line', label: 'Reports', path: '/reports' },
  { icon: 'ri-alert-line', label: 'Alerts', path: '/alert' },
  { icon: 'ri-team-line', label: 'Users', path: '/users', adminOnly: true },
];

/**
 * Horizontal top navigation bar — replaces Sidebar.jsx + Topbar.jsx.
 * Pill-style nav switcher (Taskio-style) + user avatar dropdown, in TBInsight navy/cyan theme.
 */
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

  return (
    <header
      className="sticky top-0 z-50 w-full shrink-0"
      style={{ background: 'transparent', padding: '16px 40px 0' }}
    >
      <div
        className="grid grid-cols-[1fr_auto_1fr] items-center gap-4"
        style={{
          padding: '10px 0',
        }}
      >
        {/* ── Logo ── */}
        <div
          className="flex items-center gap-3 cursor-pointer shrink-0"
          onClick={() => navigate('/dashboard')}
        >
          <Logo size={36} />
          <span className="text-xl font-extrabold tracking-tight hidden sm:block" style={{ color: '#0F2D52' }}>
            TBInsight
          </span>
        </div>

        {/* ── Pill Nav Switcher ── */}
        <nav
          className="hidden lg:flex items-center justify-self-center gap-1 rounded-full overflow-x-auto"
          style={{ background: '#F1F5F9', padding: '5px 7px' }}
        >
          {visibleNavItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-full text-[12px] font-bold transition-all duration-200 cursor-pointer"
                style={{
                  padding: '7px 15px',
                  color: isActive ? '#ffffff' : '#475569',
                  background: isActive ? '#0F2D52' : 'transparent',
                  boxShadow: isActive ? '0 4px 14px rgba(37, 99, 235, 0.3)' : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = '#0F2D52';
                    e.currentTarget.style.color = '#ffffff';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = '#475569';
                  }
                }}
              >
                <i className={`${item.icon} ri-light text-[12px] opacity-80`} />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* ── Right Icons + Avatar ── */}
        <div className="flex items-center justify-self-end gap-2 shrink-0">
          <button
            onClick={() => navigate('/notifications')}
            title="Notifications"
            className="relative w-9 h-9 flex items-center justify-center rounded-full cursor-pointer transition-colors"
            style={{ background: '#EFF6FF', color: '#2563EB' }}
          >
            <i className="ri-notification-3-line text-base" />
            <span
              className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
              style={{ background: '#ff0055', boxShadow: '0 0 6px #ff0055' }}
            />
          </button>

          <button
            onClick={() => navigate('/settings')}
            className="w-9 h-9 hidden md:flex items-center justify-center rounded-full cursor-pointer transition-colors"
            style={{ background: '#EFF6FF', color: '#64748B' }}
          >
            <i className="ri-settings-3-line text-base" />
          </button>

          {/* Avatar Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1.5 cursor-pointer shrink-0 rounded-full pl-0.5 pr-2 py-0.5 transition-all"
              style={{
                background: dropdownOpen ? '#EFF6FF' : 'transparent',
                border: '1px solid',
                borderColor: dropdownOpen ? '#BFDBFE' : 'transparent',
              }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                style={{ background: '#0F2D52', color: '#ffffff', border: '2px solid #3B82F6' }}
              >
                {initials}
              </div>
              <i
                className="ri-arrow-down-s-line text-sm shrink-0 transition-transform"
                style={{ color: '#64748B', transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </button>

            {dropdownOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-60 rounded-xl overflow-hidden z-50"
                style={{
                  background: '#ffffff',
                  border: '1px solid #DBEAFE',
                  boxShadow: '0 10px 40px rgba(37, 99, 235, 0.12), 0 4px 12px rgba(0, 0, 0, 0.06)',
                }}
              >
                <div className="px-4 py-3" style={{ borderBottom: '1px solid #DBEAFE' }}>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ background: '#0F2D52', color: '#ffffff', border: '2px solid #3B82F6' }}
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
                      className="w-full flex items-center gap-3 px-4 py-2 text-xs font-medium transition-colors hover:bg-blue-50"
                      style={{ color: '#334155' }}
                    >
                      <i className={`${item.icon} text-sm`} style={{ color: item.color }} />
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="py-1" style={{ borderTop: '1px solid #DBEAFE' }}>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-2 text-xs font-medium transition-colors hover:bg-red-50"
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
    </header>
  );
}
