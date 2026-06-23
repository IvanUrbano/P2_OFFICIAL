import { useNavigate, useLocation } from 'react-router-dom';

/* Map path → readable page title shown in the topbar */
const PAGE_TITLES = {
  '/dashboard': { title: 'Pasig City Tuberculosis Monitoring Dashboard', subtitle: 'Monitor tuberculosis trends and support resource prioritization across Pasig City.' },
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
 * Bridges the Dark Sidebar and the White Dashboard seamlessly.
 */
export default function Topbar({ user }) {
  const navigate = useNavigate();
  const location = useLocation();

  const page = PAGE_TITLES[location.pathname] ?? { title: 'TBInsight', subtitle: '' };
  const initials = user?.username ? user.username.slice(0, 2).toUpperCase() : 'AD';

  return (
    <header
      className="sticky top-0 z-40"
      style={{
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0'
      }}
    >
      <div className="flex items-center justify-between gap-4 px-6 py-4">

        {/* Left — Clinical Slate Page Titles */}
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-tight leading-tight truncate" style={{ color: '#0f172a' }}>
            {page.title}
          </h1>
          {page.subtitle && (
            <p className="text-xs mt-0.5 leading-relaxed truncate font-medium" style={{ color: '#64748b' }}>
              {page.subtitle}
            </p>
          )}
        </div>

        {/* Right — Actions with Electric/Neon Blue Accents */}
        <div className="flex items-center gap-2.5 shrink-0">

          {/* Last sync pill — Minimal white with subtle neon text pop */}
          <div
            className="hidden md:flex items-center gap-2 h-9 px-3 rounded-lg text-xs font-semibold whitespace-nowrap"
            style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}
          >
            <i className="ri-refresh-line" style={{ color: '#0066FF' }} />
            <span>Last sync: <span style={{ color: '#0066FF' }}>Today 08:42 AM</span></span>
          </div>

          {/* Notification bell — Vibrant interactive accent */}
          <button
            className="relative w-9 h-9 flex items-center justify-center rounded-lg cursor-pointer transition-colors hover:bg-slate-50"
            style={{ background: '#e6f0ff', border: '1px solid rgba(0, 102, 255, 0.2)', color: '#0066FF' }}
            onClick={() => navigate('/notifications')}
            title="Notifications"
          >
            <i className="ri-notification-3-line text-base" />
            {/* Pulse badge */}
            <span
              className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
              style={{ background: '#ff0055', boxShadow: '0 0 6px #ff0055' }}
            />
          </button>

          {/* User pill — Ties directly into the Sidebar's unique Dark Navy color */}
          <div
            className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full"
            style={{ background: '#f1f5f9', border: '1px solid #e2e8f0' }}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{
                background: '#091124', /* Matches the unique dark blue sidebar */
                color: '#ffffff',
                border: '1px solid #0066FF' /* Neon blue ring contrast */
              }}
            >
              {initials}
            </div>
            <span className="text-xs font-bold hidden sm:block" style={{ color: '#334155' }}>
              {user?.username ?? 'System Admin'}
            </span>
          </div>

        </div>

      </div>

      {/* Decorative Neon Progress Strip (Optional styling accent) */}
      <div
        className="h-[2px] w-full"
        style={{ background: 'linear-gradient(90deg, #0066FF 0%, #00D8F6 50%, transparent 100%)' }}
      />
    </header>
  );
}