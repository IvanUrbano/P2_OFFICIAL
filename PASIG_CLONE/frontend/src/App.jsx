import { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './theme';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import Layout from './components/Layout';

// Lazy-loaded so each page is its own chunk instead of one bundle for the whole app.
const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const HealthFacilitiesPage = lazy(() => import('./pages/HealthFacilitiesPage'));
const TBRecordsPage = lazy(() => import('./pages/TBRecordsPage'));
const DataImportPage = lazy(() => import('./pages/DataImportPage'));
const ValidationPage = lazy(() => import('./pages/ValidationPage'));
const SyncPage = lazy(() => import('./pages/SyncPage'));
const SyncHistoryPage = lazy(() => import('./pages/SyncHistoryPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));

function PageFallback() {
  return (
    <div className="h-screen flex items-center justify-center" style={{ background: '#F8FAFC' }}>
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/facilities" element={<HealthFacilitiesPage />} />
                <Route path="/records" element={<TBRecordsPage />} />
                <Route path="/import" element={<DataImportPage />} />
                <Route path="/validation" element={<ValidationPage />} />
                <Route path="/sync" element={<SyncPage />} />
                <Route path="/sync-history" element={<SyncHistoryPage />} />
                <Route element={<AdminRoute />}>
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/audit-logs" element={<AuditLogsPage />} />
                </Route>
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="*" element={<Navigate to="/facilities" replace />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ThemeProvider>
  );
}
