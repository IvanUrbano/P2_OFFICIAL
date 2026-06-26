import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Logo from './Logo';

const NAV_ITEMS = [
  { icon: 'ri-dashboard-fill', label: 'Dashboard', path: '/dashboard' },
  { icon: 'ri-lungs-line', label: 'TB Records', path: '/records' },
  { icon: 'ri-bar-chart-box-line', label: 'Forecasting', path: '/analytics' },
  { icon: 'ri-database-2-line', label: 'Data Integration', path: '/data-integration' },
  { icon: 'ri-map-2-line', label: 'GIS Hotspot', path: '/gis-map' },
  { icon: 'ri-truck-line', label: 'Resources', path: '/resources' },
  { icon: 'ri-file-chart-line', label: 'Reports', path: '/reports' },
  { icon: 'ri-alert-line', label: 'Alerts', path: '/alert' },
  { icon: 'ri-team-line', label: 'Users', path: '/users' },
  { icon: 'ri-settings-3-line', label: 'Settings', path: '/settings' },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  const storedUser = localStorage.getItem('user');
  const user = storedUser ? JSON.parse(storedUser) : null;

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('tbinsight_session');
    navigate('/login');
  };

  return (
    <aside
      className="fixed left-0 top-0 h-screen w-[72px] flex flex-col items-center justify-between py-5 z-50 transition-all duration-300"
      style={{
        background: 'linear-gradient(180deg, #0F2D52 0%, #091a30 100%)',
        borderRight: '1px solid rgba(0, 102, 255, 0.1)',
        boxShadow: '2px 0 20px rgba(0, 0, 0, 0.15)',
      }}
    >
      {/* ── Logo ── */}
      <div
        className="relative group cursor-pointer flex items-center justify-center"
        onClick={() => navigate('/dashboard')}
      >
        <Logo size={40} />
      </div>

      {/* ── Nav items ── */}
      <nav className="flex flex-col gap-1.5 flex-1 justify-center w-full items-center mt-3">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <div key={item.label} className="relative group flex items-center justify-center w-full">
              {/* Active indicator pill */}
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-[3px] rounded-r-full transition-all duration-300"
                  style={{
                    background: 'linear-gradient(180deg, #0066FF, #00D8F6)',
                    boxShadow: '0 0 10px rgba(0, 216, 246, 0.5)',
                  }}
                />
              )}

              <button
                onClick={() => navigate(item.path)}
                className="w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200 cursor-pointer"
                style={{
                  color: isActive ? '#00D8F6' : 'rgba(255,255,255,0.35)',
                  background: isActive ? 'rgba(0, 216, 246, 0.1)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                    e.currentTarget.style.color = 'rgba(255,255,255,0.8)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'rgba(255,255,255,0.35)';
                  }
                }}
              >
                <i className={`${item.icon} text-lg`} />
              </button>

              {/* Hover tooltip */}
              <span
                className="pointer-events-none absolute left-[60px] top-1/2 -translate-y-1/2
                           whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold text-slate-200
                           opacity-0 group-hover:opacity-100
                           translate-x-1 group-hover:translate-x-0
                           transition-all duration-200 z-50"
                style={{
                  background: '#0f172a',
                  border: '1px solid rgba(255,255,255,0.08)',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                }}
              >
                {item.label}
              </span>
            </div>
          );
        })}
      </nav>

      {/* ── Bottom Section ── */}
      <div className="flex flex-col items-center gap-3 mt-3">
        {/* Divider */}
        <div className="w-8 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />

        {/* Logout */}
        <div className="relative group">
          <button
            onClick={handleLogout}
            className="w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200 cursor-pointer"
            style={{ color: 'rgba(255,255,255,0.35)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(239,68,68,0.15)';
              e.currentTarget.style.color = '#EF4444';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'rgba(255,255,255,0.35)';
            }}
          >
            <i className="ri-logout-box-r-line text-lg" />
          </button>

          {/* Logout tooltip */}
          <span
            className="pointer-events-none absolute left-[60px] top-1/2 -translate-y-1/2
                       whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold text-rose-400
                       opacity-0 group-hover:opacity-100
                       translate-x-1 group-hover:translate-x-0
                       transition-all duration-200 z-50"
            style={{
              background: '#0f172a',
              border: '1px solid rgba(239,68,68,0.2)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}
          >
            Sign Out
          </span>
        </div>

        {/* Version tag */}
        <div
          className="px-2 py-0.5 rounded text-[8px] font-bold tracking-wider uppercase"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.25)' }}
        >
          V2.4
        </div>
      </div>
    </aside>
  );
}
