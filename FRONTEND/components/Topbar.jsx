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
      style={{ height: '64px', borderBottom: '1px solid rgba(0,180,255,0.1)' }}
    >
      {/* Solid navy left half */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(135deg, #070c1e 0%, #0a1628 50%, #0d1f3c 100%)',
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
          clipPath: 'polygon(50% 0%, 100% 0%, 100% 100%, 30% 100%)',
        }}
      />

      {/* Subtle blue tint for theme */}
      <div
        className="absolute inset-0"
        style={{
          background: 'rgba(0,20,60,0.15)',
          clipPath: 'polygon(50% 0%, 100% 0%, 100% 100%, 30% 100%)',
        }}
      />

      {/* Diagonal divider strip — traces the exact polygon edge (50% 0% → 30% 100%) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'rgba(255,255,255,0.45)',
          clipPath: 'polygon(49.8% 0%, 50.2% 0%, 30.2% 100%, 29.8% 100%)',
        }}
      />

      {/* Gradient seam — smooth transition from navy to image */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(100deg, #070c1e 0%, #070c1e 28%, rgba(7,12,30,0.5) 42%, transparent 55%)',
        }}
      />

      {/* Bottom accent line */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[2px]"
        style={{
          background: 'linear-gradient(90deg, #0066FF 0%, #00b4ff 40%, #00D8F6 70%, transparent 100%)',
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
        <div className="flex items-center gap-2 shrink-0">

          {/* Last sync */}
          <div
            className="hidden md:flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11px] font-medium whitespace-nowrap"
            style={{ color: 'rgba(200,220,240,0.6)' }}
          >
            <i className="ri-refresh-line text-xs" style={{ color: '#00D8F6' }} />
            <span>Sync: <span style={{ color: '#00D8F6' }}>Today</span></span>
          </div>

          {/* Notification bell */}
          <button
            className="relative w-8 h-8 flex items-center justify-center rounded-md cursor-pointer transition-all hover:bg-white/10"
            style={{ color: '#00D8F6' }}
            onClick={() => navigate('/notifications')}
            title="Notifications"
          >
            <i className="ri-notification-3-line text-sm" />
            <span
              className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
              style={{ background: '#00D8F6' }}
            />
          </button>

          {/* User pill */}
          <div
            className="flex items-center gap-2 pl-1 pr-2.5 py-0.5 rounded-full"
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
              style={{
                background: 'linear-gradient(135deg, #0066FF 0%, #00b4ff 100%)',
                color: '#ffffff',
              }}
            >
              {initials}
            </div>
            <span className="text-[11px] font-medium hidden sm:block" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {user?.username ?? 'Admin'}
            </span>
          </div>

        </div>

      </div>
    </header>
  );
}
