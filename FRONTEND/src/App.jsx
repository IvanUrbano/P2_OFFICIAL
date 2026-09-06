import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import ErrorBoundary from '../components/ErrorBoundary';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import Layout from '../components/Layout';
import TBRecords from './pages/TBRecords';
import Analytics from './pages/Analytics';
import Forecasting from './pages/Forecasting';
import DataIntegration from './pages/DataIntegration';
import GisMap from './pages/GisMap';
import Notifications from './pages/Notifications';
import InterventionPlanning from './pages/InterventionPlanning';
import Users from './pages/Users';
import Settings from './pages/Settings';
import Reports from './pages/Reports';
import Alert from './pages/Alert';
import Profile from './pages/Profile';

function ProtectedRoute() {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function App() {
  return (
    <Router>
      <ErrorBoundary>
        <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/records" element={<TBRecords />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/forecasting" element={<Forecasting />} />
            <Route path="/data-integration" element={<DataIntegration />} />
            <Route path="/gis-map" element={<GisMap />} />
            <Route path="/interventions" element={<InterventionPlanning />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/users" element={<Users />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/alert" element={<Alert />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>
        </Routes>
      </ErrorBoundary>
    </Router>
  );
}

export default App;
