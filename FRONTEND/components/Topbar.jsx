import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

/* Map path → readable page title shown in the topbar */
const PAGE_TITLES = {
  '/dashboard': { title: 'Pasig City Tuberculosis Monitoring Dashboard', subtitle: 'Monitor tuberculosis trends and support resource prioritization across Pasig City.' },
  '/records': { title: 'TB Records', subtitle: 'View and manage individual tuberculosis case records.' },
  '/analytics': { title: 'Forecasting Analysis', subtitle: 'Analyze future tuberculosis trends using ARIMA forecasting models.' },
  '/data-integration': { title: 'Data Integration', subtitle: 'REST API-Based Database-to-Database Integration.' },
  '/gis-map': { title: 'GIS Hotspot Monitoring', subtitle: 'Visualize tuberculosis distribution and hotspot areas across Pasig City.' },
  '/resources': { title: 'Resource Prioritization', subtitle: 'Identify barangays requiring increased monitoring and intervention.' },
  '/reports': { title: 'Reports Center', subtitle: 'Generate analytical and forecasting reports.' },
  '/alert': { title: 'Alerts Center', subtitle: 'Monitor critical tuberculosis alerts and system notifications.' },
  '/users': { title: 'User Management', subtitle: 'Manage authorized system users.' },
  '/settings': { title: 'Settings', subtitle: 'System preferences and configuration.' },
};

/**
 * Shared topbar — used by Layout.jsx.
 * Features a user avatar dropdown with Profile, Settings, and Logout.
 */
export default function Topbar({ user }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const page = PAGE_TITLES[location.pathname] ?? { title: 'TBInsight', subtitle: '' };
  const userRole = user?.role || 'Staff';
  const initials = user?.name ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) : user?.username?.slice(0, 2).toUpperCase() ?? 'U';
  const displayName = user?.name ?? user?.username ?? 'User';
  const displayEmail = user?.email ?? '';
  const displayPosition = user?.position ?? 'Health Staff';

  /* Close dropdown on outside click */
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
      className="sticky top-0 z-40"
      style={{
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0'
      }}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-3.5">

        {/* Left — Page Titles */}
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-tight leading-none truncate" style={{ color: '#0f172a' }}>
            {page.title}
          </h1>
          {page.subtitle && (
            <p className="text-xs leading-none truncate font-medium" style={{ color: '#64748b', marginTop: '2px' }}>
              {page.subtitle}
            </p>
          )}
        </div>

        {/* Right — User Dropdown */}
        <div className="flex items-center gap-2.5 shrink-0">

          {/* Last sync pill */}
          <div
            className="hidden md:flex items-center gap-2 h-9 px-3 rounded-lg text-xs font-semibold whitespace-nowrap"
            style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}
          >
            <i className="ri-refresh-line" style={{ color: '#0066FF' }} />
            <span>Last sync: <span style={{ color: '#0066FF' }}>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</span></span>
          </div>

          {/* Notification bell */}
          <button
            className="relative w-9 h-9 flex items-center justify-center rounded-lg cursor-pointer transition-colors hover:bg-slate-50"
            style={{ background: '#e6f0ff', border: '1px solid rgba(0, 102, 255, 0.2)', color: '#0066FF' }}
            onClick={() => navigate('/alert')}
            title="Alerts"
          >
            <i className="ri-notification-3-line text-base" />
            <span
              className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
              style={{ background: '#ff0055', boxShadow: '0 0 6px #ff0055' }}
            />
          </button>

          {/* User Avatar Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2.5 pl-1 pr-3 py-1 rounded-full cursor-pointer transition-all duration-200 hover:shadow-md"
              style={{
                background: dropdownOpen ? '#f1f5f9' : 'transparent',
                border: '1px solid #e2e8f0',
              }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{
                  background: '#091124',
                  color: '#ffffff',
                  border: '2px solid #0066FF',
                }}
              >
                {initials}
              </div>
              <span className="text-sm font-bold hidden sm:block" style={{ color: '#334155' }}>
                {displayName}
              </span>
              <i
                className="ri-arrow-down-s-line text-sm transition-transform duration-200"
                style={{ color: '#94A3B8', transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0)' }}
              />
            </button>

            {/* Dropdown Menu */}
            {dropdownOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-64 rounded-xl overflow-hidden z-50"
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)',
                }}
              >
                {/* User Info Header */}
                <div className="px-4 py-3" style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                      style={{
                        background: '#091124',
                        color: '#ffffff',
                        border: '2px solid #0066FF',
                      }}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: '#0f172a' }}>{displayName}</p>
                      <p className="text-[11px] truncate" style={{ color: '#94A3B8' }}>{displayEmail}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ background: 'rgba(59,130,246,0.1)', color: '#3B82F6' }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#3B82F6' }} />
                      {userRole}
                    </span>
                    <span className="text-[10px] font-medium" style={{ color: '#94A3B8' }}>{displayPosition}</span>
                  </div>
                </div>

                {/* Menu Items */}
                <div className="py-1.5">
                  {[
                    { icon: 'ri-user-settings-line', label: 'My Profile', color: '#2E6FAF', action: () => { navigate('/profile'); setDropdownOpen(false); } },
                    { icon: 'ri-settings-3-line', label: 'Settings', color: '#64748B', action: () => { navigate('/settings'); setDropdownOpen(false); } },
                    { icon: 'ri-question-line', label: 'Help & Support', color: '#64748B', action: () => setDropdownOpen(false) },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={item.action}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-slate-50"
                      style={{ color: '#334155' }}
                    >
                      <i className={`${item.icon} text-base`} style={{ color: item.color }} />
                      {item.label}
                    </button>
                  ))}
                </div>

                {/* Logout */}
                <div className="py-1.5" style={{ borderTop: '1px solid #f1f5f9' }}>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-red-50"
                    style={{ color: '#EF4444' }}
                  >
                    <i className="ri-logout-box-r-line text-base" />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Decorative Neon Progress Strip */}
      <div
        className="h-[2px] w-full"
        style={{ background: 'linear-gradient(90deg, #0066FF 0%, #00D8F6 50%, transparent 100%)' }}
      />
    </header>
  );
}
