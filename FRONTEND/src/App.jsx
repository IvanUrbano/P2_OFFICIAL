import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Auth pages (no layout)
import LoginPage    from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

// Shared layout (Sidebar + Topbar + auth guard)
import Layout from './components/Layout';

// Protected pages
import Dashboard             from './pages/Dashboard';
import TBRecords             from './pages/TBRecords';
import Analytics             from './pages/Analytics';
import DataIntegration       from './pages/DataIntegration';
import GisMap                from './pages/GisMap';
import ResourcePrioritization from './pages/ResourcePrioritization';
import Notifications         from './pages/Notifications';
import Users                 from './pages/Users';
import Settings              from './pages/Settings';

export default function App() {
  return (
    <Router>
      <Routes>
        {/* Redirect root to login */}
        <Route path="/" element={<Navigate to="/login" replace />} />

        {/* Public routes */}
        <Route path="/login"    element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Protected routes — all wrapped inside Layout */}
        <Route element={<Layout />}>
          <Route path="/dashboard"       element={<Dashboard />} />
          <Route path="/records"         element={<TBRecords />} />
          <Route path="/analytics"       element={<Analytics />} />
          <Route path="/data-integration" element={<DataIntegration />} />
          <Route path="/gis-map"         element={<GisMap />} />
          <Route path="/resources"       element={<ResourcePrioritization />} />
          <Route path="/notifications"   element={<Notifications />} />
          <Route path="/users"           element={<Users />} />
          <Route path="/settings"        element={<Settings />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}
