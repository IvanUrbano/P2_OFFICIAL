import { Navigate, Outlet } from 'react-router-dom';

export default function AdminRoute() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (!user || user.role !== 'admin') return <Navigate to="/" replace />;
  } catch {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
