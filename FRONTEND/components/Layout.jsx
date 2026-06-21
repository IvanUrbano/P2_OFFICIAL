import { useEffect, useState } from 'react';
import { useNavigate, Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

/**
 * Layout wraps every protected page.
 * - Guards auth (redirects to /login if no user in localStorage)
 * - Renders Sidebar + Topbar + page content via <Outlet />
 *
 * Usage in App.jsx:
 *   <Route element={<Layout />}>
 *     <Route path="/dashboard" element={<Dashboard />} />
 *     ...
 *   </Route>
 */
export default function Layout() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) {
      navigate('/login');
      return;
    }
    setUser(JSON.parse(stored));
  }, [navigate]);

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Fixed sidebar */}
      <Sidebar />

      {/* Scrollable page area */}
      <div className="ml-20 flex-1 flex flex-col min-h-screen">
        {/* Sticky topbar */}
        <Topbar user={user} />

        {/* Page content */}
        <main className="flex-1 px-6 py-6 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
