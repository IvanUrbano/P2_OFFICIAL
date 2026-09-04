import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import axios from '../api/axios';

const NAV_ITEMS = [
  { label: 'Import', path: '/', icon: 'ri-upload-cloud-2-line' },
  { label: 'Validate', path: '/validate', icon: 'ri-checkbox-circle-line' },
  { label: 'Webhook', path: '/webhook', icon: 'ri-send-plane-line' },
];

export default function Layout() {
  const [user, setUser] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get('/api/auth/profile')
      .then(res => setUser(res.data.user))
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    try {
      await axios.post('/api/auth/logout');
    } catch {}
    localStorage.removeItem('token');
    navigate('/login');
  };

  const initials = user ? (user.username?.[0] || 'U').toUpperCase() : 'U';

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Tier 1: Logo + User Bar */}
      <header className="bg-[#1a5276] text-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
            <span className="text-sm font-bold">P2</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Pasig TB-DOTS</h1>
            <p className="text-xs text-white/60">Data Integration System</p>
          </div>
        </div>

        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2 hover:bg-white/10 rounded-lg px-3 py-1.5 transition-colors"
          >
            <div className="w-7 h-7 bg-white/20 rounded-full flex items-center justify-center text-xs font-semibold">
              {initials}
            </div>
            <span className="text-sm hidden sm:inline">{user?.username || 'User'}</span>
            <i className="ri-arrow-down-s-line text-white/60" />
          </button>

          {showDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
              <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg shadow-lg border z-50 py-1">
                <div className="px-4 py-2 border-b">
                  <p className="text-sm font-medium text-gray-900">{user?.username}</p>
                  <p className="text-xs text-gray-500">{user?.email}</p>
                  <span className="inline-block mt-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{user?.role}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <i className="ri-logout-box-r-line" />
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Tier 2: Nav Items */}
      <nav className="bg-white border-b px-6 flex gap-1">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`
            }
          >
            <i className={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Page Content */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-6 lg:px-10 pt-6 pb-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
