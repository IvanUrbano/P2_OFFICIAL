import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useState, useEffect } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import LandingPage from './pages/LandingPage';
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
import Settings from './pages/Settings';
import Reports from './pages/Reports';
import Alert from './pages/Alert';
import Profile from './pages/Profile';
import API from './api/axios';

function ProtectedRoute() {
  const [isAuthenticated, setIsAuthenticated] = useState(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        await API.get('/api/auth/profile');
        setIsAuthenticated(true);
      } catch {
        setIsAuthenticated(false);
      }
    };
    checkAuth();
  }, []);

  if (isAuthenticated === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ErrorBoundary>
        <Routes>
        <Route path="/" element={<LandingPage />} />
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
