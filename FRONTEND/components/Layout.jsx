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
    <div className="h-screen relative overflow-hidden flex flex-col" style={{ background: 'linear-gradient(180deg, #B8D4FF 0%, #D6E8FF 10%, #EEF4FF 30%, #F4F6FA 55%)' }}>
      <Topbar user={user} />
      <main className="flex-1 px-10 py-6 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
