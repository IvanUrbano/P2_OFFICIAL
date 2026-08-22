import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from '../src/theme';

/* Map path → readable page title shown in the topbar */
const PAGE_TITLES = {
  '/dashboard': { title: 'TBInsight Dashboard', subtitle: 'Monitor tuberculosis trends across Pasig City.' },
  '/records': { title: 'TB Records', subtitle: 'Individual tuberculosis case records.' },
  '/analytics': { title: 'Analytics', subtitle: 'In-depth TB case trend analysis.' },
  '/data-integration': { title: 'Data Integration', subtitle: 'Sync and manage health system data.' },
  '/gis-map': { title: 'GIS Risk Map', subtitle: 'TB hotspot geographic distribution.' },
  '/barangays': { title: 'Barangay Watchlist', subtitle: 'Per-barangay cases, forecast, and risk.' },
  '/notifications': { title: 'Notifications', subtitle: 'Active alerts and system warnings.' },
  '/users': { title: 'Users', subtitle: 'Manage health worker accounts.' },
  '/settings': { title: 'Settings', subtitle: 'System preferences.' },
};

/**
 * Shared topbar — diagonal split: solid navy left, healthcare image right.
 */
export default function Topbar({ user }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, toggle } = useTheme();

  const page = PAGE_TITLES[location.pathname] ?? { title: 'TBInsight', subtitle: '' };

  return (
    <header
      className="sticky top-0 z-40 relative overflow-hidden"
      style={{ height: '64px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}
    >
      {/* Base navy — deep at left edge, softer toward the image */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(90deg, #070c1e 0%, #0a1128 55%, #0d1730 100%)',
        }}
      />

      {/* NASA Earth at Night — city lights on dark globe (right side, diagonal cut) */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'url(https://eoimages.gsfc.nasa.gov/images/imagerecords/79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: '65% 45%',
          backgroundRepeat: 'no-repeat',
          clipPath: 'polygon(45% 0%, 100% 0%, 100% 100%, 25% 100%)',
        }}
      />

      {/* Soft blend — the image melts into the navy instead of a hard seam */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(100deg, #070c1e 0%, rgba(7,12,30,0.88) 32%, rgba(7,12,30,0.4) 46%, transparent 60%)',
        }}
      />

      {/* Subtle blue tint over the image for theme cohesion */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(90deg, transparent 55%, rgba(0,25,70,0.32) 100%)',
        }}
      />

      {/* Bottom accent line */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[1px]"
        style={{
          background: 'linear-gradient(90deg, rgba(0,102,255,0.08) 0%, rgba(0,180,255,0.04) 40%, transparent 70%)',
        }}
      />

      {/* Content */}
      <div className="relative flex items-center justify-between gap-4 px-8 h-full">

        {/* Left — Page Titles */}
        <div className="min-w-0">
          <h1 className="text-base font-bold tracking-tight leading-tight truncate" style={{ color: '#ffffff' }}>
            {page.title}
          </h1>
          {page.subtitle && (
            <p className="text-[11px] mt-0.5 leading-relaxed truncate" style={{ color: 'rgba(148,180,220,0.6)' }}>
              {page.subtitle}
            </p>
          )}
        </div>

        {/* Right — Actions */}
        <div
          className="flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-lg"
          style={{
            background: 'rgba(7,12,30,0.55)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {/* Last sync */}
          <div
            className="hidden md:flex items-center gap-1.5 h-7 px-2 rounded-md text-[11px] font-medium whitespace-nowrap"
            style={{ color: 'rgba(120,180,255,0.8)' }}
          >
            <i className="ri-refresh-line text-xs" style={{ color: '#4D9EFF' }} />
            <span>Sync: <span style={{ color: 'rgba(255,255,255,0.8)' }}>Today</span></span>
          </div>

          {/* Theme toggle */}
          <button
            className="relative w-7 h-7 flex items-center justify-center rounded-md cursor-pointer transition-all hover:bg-white/10"
            style={{ color: '#4D9EFF' }}
            onClick={toggle}
            title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <i className={mode === 'dark' ? 'ri-sun-line text-xs' : 'ri-moon-line text-xs'} />
          </button>

          {/* Notification bell */}
          <button
            className="relative w-7 h-7 flex items-center justify-center rounded-md cursor-pointer transition-all hover:bg-white/10"
            style={{ color: '#4D9EFF' }}
            onClick={() => navigate('/notifications')}
            title="Notifications"
          >
            <i className="ri-notification-3-line text-xs" />
            <span
              className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
              style={{ background: '#4D9EFF' }}
            />
          </button>

          {/* User pill */}
          <div
            className="flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-md"
          >
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 overflow-hidden"
              style={{ background: 'rgba(77,158,255,0.15)' }}
            >
              <i className="ri-user-3-fill text-xs" style={{ color: '#4D9EFF' }} />
            </div>
            <span className="text-[11px] font-semibold hidden sm:block" style={{ color: 'rgba(255,255,255,0.8)' }}>
              {user?.username ?? 'Admin'}
            </span>
          </div>
        </div>

      </div>
    </header>
  );
}
