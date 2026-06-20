import { useNavigate, useLocation } from 'react-router-dom';

/* Map path → readable page title shown in the topbar */
const PAGE_TITLES = {
  '/dashboard': { title: 'TBInsight Dashboard', subtitle: 'Monitor tuberculosis trends and support resource prioritization across Pasig City.' },
  '/records': { title: 'TB Records', subtitle: 'View and manage individual tuberculosis case records.' },
  '/analytics': { title: 'Analytics', subtitle: 'In-depth analysis of TB case trends and treatment outcomes.' },
  '/data-integration': { title: 'Data Integration', subtitle: 'Sync and manage data from external health systems.' },
  '/gis-map': { title: 'GIS Map', subtitle: 'Geographic heatmap of TB hotspot barangays in Pasig City.' },
  '/resources': { title: 'Resource Prioritization', subtitle: 'Allocate medicine, staff, and supplies to high-risk areas.' },
  '/notifications': { title: 'Notifications', subtitle: 'Active alerts and system-generated warnings.' },
  '/users': { title: 'Users', subtitle: 'Manage health worker accounts and access levels.' },
  '/settings': { title: 'Settings', subtitle: 'System preferences and configuration.' },
};

/**
 * Shared topbar — used by Layout.jsx.
 * Shows current page title, search, notification bell, and user pill with logout.
 */
export default function Topbar({ user }) {
  const navigate = useNavigate();
  const location = useLocation();

  const page = PAGE_TITLES[location.pathname] ?? { title: 'TBInsight', subtitle: '' };
  const initials = user?.username ? user.username.slice(0, 2).toUpperCase() : 'TB';

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <header
      className="sticky top-0 z-40"
      style={{ background: '#030507' }}
    >
      <div className="flex items-center justify-between gap-4 px-6 py-4">

        {/* Left — page title */}
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-tight leading-tight truncate" style={{ color: '#eaf8ff' }}>
            {page.title}
          </h1>
          {page.subtitle && (
            <p className="text-xs mt-0.5 leading-relaxed truncate" style={{ color: '#6f8a99' }}>
              {page.subtitle}
            </p>
          )}
        </div>

        {/* Right — actions */}
        <div className="flex items-center gap-2.5 shrink-0">



          {/* Last sync pill */}
          <div
            className="hidden md:flex items-center gap-2 h-9 px-3 rounded-lg text-sm whitespace-nowrap"
            style={{ background: 'rgba(0,191,255,0.05)', border: '1px solid rgba(0,191,255,0.12)', color: '#9fb3c0' }}
          >
            <i className="ri-refresh-line" style={{ color: '#6f8a99' }} />
            <span>Last sync: Today 08:42 AM</span>
          </div>

          {/* Notification bell */}
          <button
            className="relative w-9 h-9 flex items-center justify-center rounded-lg cursor-pointer transition-colors hover:bg-white/5"
            style={{ background: 'rgba(0,191,255,0.05)', border: '1px solid rgba(0,191,255,0.12)', color: '#eaf8ff' }}
            onClick={() => navigate('/notifications')}
            title="Notifications"
          >
            <i className="ri-notification-3-line" />
            {/* Pulse badge */}
            <span
              className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
              style={{ background: '#ff4d4d', animation: 'pulse-dot 1.2s ease-in-out infinite' }}
            />
          </button>

          {/* User pill */}
          <div
            className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full"
            style={{ background: 'rgba(0,191,255,0.03)', border: '1px solid rgba(0,191,255,0.08)' }}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ background: 'linear-gradient(135deg,#00bfff,#00b8ff)', color: '#021014' }}
            >
              {initials}
            </div>
            <span className="text-sm font-medium hidden sm:block" style={{ color: '#9fb3c0' }}>
              {user?.username ?? 'Admin'}
            </span>
          </div>


        </div>

      </div>

      {/* gradient divider — sits directly below the content row, regardless of which side is taller */}
      <div
        className="h-px w-full"
        style={{ background: 'linear-gradient(90deg, #00bfff 0%, rgba(14,165,233,0.3) 40%, transparent 100%)' }}
      />
    </header>
  );
}
