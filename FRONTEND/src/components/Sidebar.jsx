import { useNavigate, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  { icon: 'ri-dashboard-fill', label: 'Dashboard', path: '/dashboard' },
  { icon: 'ri-lungs-line', label: 'TB Records', path: '/records' },
  { icon: 'ri-bar-chart-box-line', label: 'Analytics', path: '/analytics' },
  { icon: 'ri-database-2-line', label: 'Data Integration', path: '/data-integration' },
  { icon: 'ri-map-2-line', label: 'GIS Map', path: '/gis-map' },
  { icon: 'ri-truck-line', label: 'Resource Prioritization', path: '/resources' },
  { icon: 'ri-notification-3-line', label: 'Notifications', path: '/notifications' },
  { icon: 'ri-team-line', label: 'Users', path: '/users' },
  { icon: 'ri-settings-3-line', label: 'Settings', path: '/settings' },
];

/**
 * Shared sidebar — used by Layout.jsx.
 * Active item is detected automatically from the current URL.
 */
export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <aside
      className="fixed left-0 top-0 h-screen w-20 flex flex-col items-center justify-between py-6 z-50"
      style={{ background: '#081018', borderRight: '1px solid rgba(0,191,255,0.10)' }}
    >
      {/* ── Logo ── */}
      <div
        className="text-2xl"
        style={{ color: '#00bfff', filter: 'drop-shadow(0 0 12px rgba(0,191,255,0.7))' }}
      >
        <i className="ri-heart-pulse-fill" />
      </div>

      {/* ── Nav items ── */}
      <nav className="flex flex-col gap-2 flex-1 justify-center">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <div key={item.label} className="relative group">
              {/* Active indicator bar */}
              {isActive && (
                <span
                  className="absolute left-0 top-1/4 h-1/2 w-[3px] rounded-r-[4px]"
                  style={{ background: '#00bfff', boxShadow: '0 0 10px #00bfff' }}
                />
              )}

              <button
                onClick={() => navigate(item.path)}
                className="w-12 h-12 flex items-center justify-center rounded-xl transition-all duration-200 cursor-pointer"
                style={{
                  color: isActive ? '#00bfff' : '#6f8a99',
                  background: isActive ? 'rgba(0,191,255,0.10)' : 'transparent',
                }}
              >
                <i className={`${item.icon} text-xl`} />
              </button>

              {/* Hover tooltip */}
              <span
                className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2
                           whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium text-white
                           opacity-0 group-hover:opacity-100
                           -translate-x-2 group-hover:translate-x-0
                           transition-all duration-200 z-50"
                style={{ background: '#111', boxShadow: '0 4px 12px rgba(0,0,0,0.6)' }}
              >
                {item.label}
              </span>
            </div>
          );
        })}
      </nav>

      {/* ── Logout button ── */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative group">
          <button
            onClick={handleLogout}
            className="w-12 h-12 flex items-center justify-center rounded-xl transition-all duration-200 cursor-pointer hover:bg-red-500/10"
            style={{ color: '#6f8a99' }}
          >
            <i className="ri-logout-box-r-line text-xl group-hover:text-red-400 transition-colors" />
          </button>

          {/* Logout tooltip */}
          <span
            className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2
                       whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium text-white
                       opacity-0 group-hover:opacity-100
                       -translate-x-2 group-hover:translate-x-0
                       transition-all duration-200 z-50"
            style={{ background: '#111', boxShadow: '0 4px 12px rgba(0,0,0,0.6)' }}
          >
            Logout
          </span>
        </div>

        {/* Version tag */}
        <span className="text-[10px] text-center" style={{ color: '#6f8a99' }}>V2.4</span>
      </div>
    </aside>
  );
}
