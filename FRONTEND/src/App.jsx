import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import Layout from '../components/Layout';
import TBRecords from './pages/TBRecords';
import Analytics from './pages/Analytics';
import Forecasting from './pages/Forecasting';
import DataIntegration from './pages/DataIntegration';
import GisMap from './pages/GisMap';
import BarangayWatchlist from './pages/BarangayWatchlist';
import Notifications from './pages/Notifications';
import Users from './pages/Users';
import Settings from './pages/Settings';
import Reports from './pages/Reports';
import Alert from './pages/Alert';
import Profile from './pages/Profile';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />

        <Route element={<Layout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/records" element={<TBRecords />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/forecasting" element={<Forecasting />} />
          <Route path="/data-integration" element={<DataIntegration />} />
          <Route path="/gis-map" element={<GisMap />} />
          <Route path="/barangays" element={<BarangayWatchlist />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/users" element={<Users />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/alert" element={<Alert />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
