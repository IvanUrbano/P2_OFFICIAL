import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useState, useEffect, Suspense, lazy } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import Layout from '../components/Layout';
import API from './api/axios';

// Lazy-loaded: each page becomes its own chunk instead of all 14 pages (plus Leaflet,
// Recharts, html2canvas, etc.) being bundled into one ~1.9MB file loaded up front.
const LandingPage = lazy(() => import('./pages/LandingPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const TBRecords = lazy(() => import('./pages/TBRecords'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Forecasting = lazy(() => import('./pages/Forecasting'));
const DataIntegration = lazy(() => import('./pages/DataIntegration'));
const GisMap = lazy(() => import('./pages/GisMap'));
const Notifications = lazy(() => import('./pages/Notifications'));
const InterventionPlanning = lazy(() => import('./pages/InterventionPlanning'));
const Settings = lazy(() => import('./pages/Settings'));
const Reports = lazy(() => import('./pages/Reports'));
const Alert = lazy(() => import('./pages/Alert'));
const Profile = lazy(() => import('./pages/Profile'));

function PageFallback() {
  return (
    <div className="h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

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
        <Suspense fallback={<PageFallback />}>
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
        </Suspense>
      </ErrorBoundary>
    </Router>
  );
}

export default App;
