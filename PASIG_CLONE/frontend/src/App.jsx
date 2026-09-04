import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import CsvImportPage from './pages/CsvImportPage';
import ValidationPage from './pages/ValidationPage';
import WebhookStatusPage from './pages/WebhookStatusPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<CsvImportPage />} />
            <Route path="/validate" element={<ValidationPage />} />
            <Route path="/webhook" element={<WebhookStatusPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
