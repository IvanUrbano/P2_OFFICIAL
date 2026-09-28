import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, Outlet } from 'react-router-dom';
import Topbar from './Topbar';

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export default function Layout() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('user') || 'null');
      if (stored) setUser(stored);
      else navigate('/login');
    } catch {
      navigate('/login');
    }
  }, [navigate]);

  const logout = useCallback(async () => {
    try {
      const API = (await import('../src/api/axios')).default;
      await API.post('/api/auth/logout');
    } catch { /* ignore */ }
    localStorage.removeItem('user');
    sessionStorage.removeItem('csrf_token');
    navigate('/login');
  }, [navigate]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(logout, INACTIVITY_TIMEOUT_MS);
  }, [logout]);

  useEffect(() => {
    if (!user) return;
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach((e) => document.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      events.forEach((e) => document.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [user, resetTimer]);

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
