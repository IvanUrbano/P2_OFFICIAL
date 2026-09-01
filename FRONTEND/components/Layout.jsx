import { useEffect, useState } from 'react';
import { useNavigate, Outlet } from 'react-router-dom';
import Topbar from './Topbar';

/**
 * Layout wraps every protected page.
 * - Guards auth (redirects to /login if no user in localStorage)
 * - Renders Topbar (with nav) + page content via <Outlet />
 */
export default function Layout() {
  const navigate = useNavigate();
  const [user] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (!user) navigate('/login');
  }, [navigate, user]);

  if (!user) return null;

  return (
    <div className="h-screen relative flex flex-col">
      <div className="no-print"><Topbar user={user} /></div>
      <main className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
        <div className="px-6 lg:px-10 pt-6 pb-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
