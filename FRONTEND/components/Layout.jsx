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
    <div 
      className="flex h-screen relative overflow-hidden" 
      style={{ 
        background: 'linear-gradient(135deg, #F8FAFC 0%, #EEF4FB 50%, #F5F8FC 100%)', 
        color: '#0f172a' 
      }}
    >
      {/* Decorative Background Blobs */}
      <div
        className="absolute top-10 left-20 w-96 h-96 rounded-full blur-[120px] opacity-20 pointer-events-none"
        style={{ background: '#2E6FAF' }}
      />
      <div
        className="absolute bottom-10 right-10 w-80 h-80 rounded-full blur-[120px] opacity-20 pointer-events-none"
        style={{ background: '#4FD1C5' }}
      />

      {/* Fixed sidebar */}
      <Sidebar />

      {/* Scrollable page area */}
      <div className="ml-20 flex-1 flex flex-col h-screen">
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
