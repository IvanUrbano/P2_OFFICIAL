import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './theme';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import TBRecordsPage from './pages/TBRecordsPage';
import DataImportPage from './pages/DataImportPage';
import ValidationPage from './pages/ValidationPage';
import SyncPage from './pages/SyncPage';
import SyncHistoryPage from './pages/SyncHistoryPage';
import UsersPage from './pages/UsersPage';
import AuditLogsPage from './pages/AuditLogsPage';
import SettingsPage from './pages/SettingsPage';
import ProfilePage from './pages/ProfilePage';

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
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
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
