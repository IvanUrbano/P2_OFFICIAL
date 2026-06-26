import { useNavigate, useLocation } from 'react-router-dom';

/* Map path → readable page title shown in the topbar */
const PAGE_TITLES = {
  '/dashboard': { title: 'TBInsight Dashboard', subtitle: 'Monitor tuberculosis trends across Pasig City.' },
  '/records': { title: 'TB Records', subtitle: 'Individual tuberculosis case records.' },
  '/analytics': { title: 'Analytics', subtitle: 'In-depth TB case trend analysis.' },
  '/data-integration': { title: 'Data Integration', subtitle: 'Sync and manage health system data.' },
  '/gis-map': { title: 'GIS Risk Map', subtitle: 'TB hotspot geographic distribution.' },
  '/resources': { title: 'Resource Prioritization', subtitle: 'Allocate supplies to high-risk areas.' },
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

  const page = PAGE_TITLES[location.pathname] ?? { title: 'TBInsight', subtitle: '' };
  const initials = user?.username ? user.username.slice(0, 2).toUpperCase() : 'AD';

  return (
    <header
      className="sticky top-0 z-40 relative overflow-hidden"
      style={{ height: '64px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}
    >
      {/* Solid navy left half — white at diagonal, fades to dark blue leftward */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(to left, #ffffff 0%, rgba(200,215,235,0.8) 15%, rgba(15,25,50,0.95) 50%, #070c1e 100%)',
        }}
      />

      {/* NASA Earth at Night — city lights on dark globe */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'url(https://eoimages.gsfc.nasa.gov/images/imagerecords/79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: '65% 45%',
          backgroundRepeat: 'no-repeat',
          clipPath: 'polygon(37% 0%, 100% 0%, 100% 100%, 17% 100%)',
        }}
      />

      {/* Subtle blue tint for theme */}
      <div
        className="absolute inset-0"
        style={{
          background: 'rgba(0,20,60,0.15)',
          clipPath: 'polygon(37% 0%, 100% 0%, 100% 100%, 17% 100%)',
        }}
      />

      {/* Diagonal divider strip — white, brightest at top, fades going down */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(to top, rgba(255,255,255,1) 0%, rgba(255,255,255,0.0) 100%)',
          clipPath: 'polygon(36.8% 0%, 37.2% 0%, 17.2% 100%, 16.8% 100%)',
        }}
      />

      {/* Gradient seam — smooth transition from navy to image */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(100deg, #070c1e 0%, rgba(7,12,30,0.7) 22%, rgba(7,12,30,0.3) 32%, transparent 42%)',
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
            background: 'rgba(255,255,255,0.06)',
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
