import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar,
  PieChart, Pie, Cell, Legend
} from 'recharts';

// ── Mock Data ────────────────────────────────────────────────────────────────
const trendData = [
  { name: 'Jan', actual: 45, forecast: null },
  { name: 'Feb', actual: 52, forecast: null },
  { name: 'Mar', actual: 48, forecast: null },
  { name: 'Apr', actual: 61, forecast: null },
  { name: 'May', actual: 65, forecast: null },
  { name: 'Jun', actual: 59, forecast: null },
  { name: 'Jul', actual: null, forecast: 62 },
  { name: 'Aug', actual: null, forecast: 68 },
];
const barangayData = [
  { name: 'Rosario', cases: 85 },
  { name: 'Caniogan', cases: 72 },
  { name: 'Kalawaan', cases: 68 },
  { name: 'Pinagbuhatan', cases: 61 },
  { name: 'Bambang', cases: 54 },
];
const outcomeData = [
  { name: 'Completed', value: 400 },
  { name: 'Cured', value: 300 },
  { name: 'Failed', value: 50 },
  { name: 'Died', value: 20 },
  { name: 'Defaulted', value: 80 },
];
const COLORS = ['#22c55e', '#0ea5e9', '#ef4444', '#1e1b4b', '#f59e0b'];

// ── Role Badge ────────────────────────────────────────────────────────────────
function RoleBadge({ role }) {
  const isAdmin = role === 'admin';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold tracking-wide ${
        isAdmin
          ? 'bg-primary/20 text-primary-light border border-primary/30'
          : 'bg-white/10 text-white/60 border border-white/15'
      }`}
    >
      {isAdmin ? (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
        </svg>
      )}
      {isAdmin ? 'Admin' : 'Staff'}
    </span>
  );
}

// ── Create Account Modal ──────────────────────────────────────────────────────
function CreateUserModal({ onClose, onSuccess }) {
  const [form, setForm] = useState({ username: '', email: '', password: '', confirmPassword: '', role: 'staff' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) return setError('Passwords do not match.');
    if (form.password.length < 6) return setError('Password must be at least 6 characters.');
    setLoading(true);
    setError('');
    try {
      await API.post('/api/auth/register', {
        username: form.username,
        email: form.email,
        password: form.password,
        role: form.role,
      });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal Card */}
      <div
        className="relative z-10 w-full max-w-md glass-strong rounded-2xl p-8 shadow-2xl shadow-secondary/20 border border-white/15 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-secondary to-primary flex items-center justify-center shadow-lg shadow-secondary/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Create Account</h2>
              <p className="text-xs text-white/40">Add a new system user</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/50 hover:text-white transition-all cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-5 p-3 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5 ml-1">Username</label>
            <input
              type="text" name="username" value={form.username} onChange={handleChange} required
              placeholder="johndoe"
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/20 focus:outline-none focus:border-secondary/50 focus:ring-2 focus:ring-secondary/20 transition-all text-sm"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5 ml-1">Email Address</label>
            <input
              type="email" name="email" value={form.email} onChange={handleChange} required
              placeholder="user@example.com"
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/20 focus:outline-none focus:border-secondary/50 focus:ring-2 focus:ring-secondary/20 transition-all text-sm"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5 ml-1">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'} name="password" value={form.password} onChange={handleChange} required
                placeholder="Min. 6 characters"
                className="w-full pl-4 pr-10 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/20 focus:outline-none focus:border-secondary/50 focus:ring-2 focus:ring-secondary/20 transition-all text-sm"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-white/30 hover:text-white/60 transition-colors">
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5 ml-1">Confirm Password</label>
            <input
              type={showPassword ? 'text' : 'password'} name="confirmPassword" value={form.confirmPassword} onChange={handleChange} required
              placeholder="Re-enter password"
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/20 focus:outline-none focus:border-secondary/50 focus:ring-2 focus:ring-secondary/20 transition-all text-sm"
            />
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5 ml-1">Role</label>
            <div className="grid grid-cols-2 gap-3">
              {['staff', 'admin'].map((r) => (
                <label
                  key={r}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    form.role === r
                      ? 'bg-primary/15 border-primary/40 text-white'
                      : 'bg-white/5 border-white/10 text-white/50 hover:border-white/20'
                  }`}
                >
                  <input
                    type="radio" name="role" value={r}
                    checked={form.role === r} onChange={handleChange}
                    className="hidden"
                  />
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${form.role === r ? 'border-primary' : 'border-white/20'}`}>
                    {form.role === r && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold capitalize">{r}</p>
                    <p className="text-xs opacity-60">{r === 'admin' ? 'Full access' : 'Limited access'}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white text-sm font-medium transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit" disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-secondary to-primary text-white text-sm font-semibold shadow-lg shadow-secondary/25 hover:shadow-secondary/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Creating...
                </>
              ) : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Users Tab Panel ───────────────────────────────────────────────────────────
function UsersPanel({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const res = await API.get('/api/auth/users');
      setUsers(res.data.users);
    } catch {
      setErrorMsg('Failed to load users.');
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleDelete = async (id, username) => {
    if (!window.confirm(`Are you sure you want to delete "${username}"?`)) return;
    setDeletingId(id);
    setErrorMsg('');
    try {
      await API.delete(`/api/auth/users/${id}`);
      setSuccessMsg(`User "${username}" deleted successfully.`);
      setTimeout(() => setSuccessMsg(''), 3500);
      fetchUsers();
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'Failed to delete user.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateSuccess = () => {
    setShowModal(false);
    setSuccessMsg('Account created successfully!');
    setTimeout(() => setSuccessMsg(''), 3500);
    fetchUsers();
  };

  return (
    <>
      {showModal && <CreateUserModal onClose={() => setShowModal(false)} onSuccess={handleCreateSuccess} />}

      <div className="space-y-5 animate-slide-up">
        {/* Header Row */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold text-white mb-1">User Management</h2>
            <p className="text-white/50 text-sm">Manage system accounts and roles</p>
          </div>
          <button
            id="create-account-btn"
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-secondary to-primary text-white text-sm font-semibold shadow-lg shadow-secondary/25 hover:shadow-secondary/40 transition-all cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Create Account
          </button>
        </div>

        {/* Toast Messages */}
        {successMsg && (
          <div className="p-3 rounded-xl bg-success/10 border border-success/20 text-success text-sm flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {successMsg}
          </div>
        )}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            {errorMsg}
          </div>
        )}

        {/* Users Table */}
        <div className="glass rounded-2xl border border-white/10 overflow-hidden">
          {loadingUsers ? (
            <div className="flex items-center justify-center py-20">
              <svg className="w-8 h-8 animate-spin text-primary/50" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-white/30">
              <svg className="w-12 h-12 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <p className="text-sm">No users found</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs font-semibold text-white/40 uppercase tracking-wider px-6 py-4">User</th>
                  <th className="text-left text-xs font-semibold text-white/40 uppercase tracking-wider px-6 py-4 hidden sm:table-cell">Email</th>
                  <th className="text-left text-xs font-semibold text-white/40 uppercase tracking-wider px-6 py-4">Role</th>
                  <th className="text-left text-xs font-semibold text-white/40 uppercase tracking-wider px-6 py-4 hidden md:table-cell">Created</th>
                  <th className="px-6 py-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {users.map((u) => {
                  const isCurrentUser = u.id === currentUser?.id;
                  return (
                    <tr key={u.id} className="hover:bg-white/[0.03] transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/40 to-secondary/40 border border-white/10 flex items-center justify-center text-white font-bold text-sm shrink-0">
                            {u.username.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-white">{u.username}</p>
                            {isCurrentUser && <p className="text-xs text-primary-light">You</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 hidden sm:table-cell">
                        <span className="text-sm text-white/60">{u.email}</span>
                      </td>
                      <td className="px-6 py-4">
                        <RoleBadge role={u.role} />
                      </td>
                      <td className="px-6 py-4 hidden md:table-cell">
                        <span className="text-sm text-white/40">
                          {new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {!isCurrentUser && (
                          <button
                            onClick={() => handleDelete(u.id, u.username)}
                            disabled={deletingId === u.id}
                            className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-danger/10 hover:bg-danger/20 border border-danger/20 hover:border-danger/40 text-danger text-xs font-medium transition-all disabled:opacity-40 cursor-pointer"
                          >
                            {deletingId === u.id ? (
                              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            )}
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Summary */}
        {!loadingUsers && users.length > 0 && (
          <p className="text-xs text-white/30 text-center">
            {users.length} user{users.length !== 1 ? 's' : ''} total ·{' '}
            {users.filter(u => u.role === 'admin').length} admin{users.filter(u => u.role === 'admin').length !== 1 ? 's' : ''},{' '}
            {users.filter(u => u.role === 'staff').length} staff
          </p>
        )}
      </div>
    </>
  );
}

// ── Dashboard Overview Panel ──────────────────────────────────────────────────
function OverviewPanel() {
  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Overview</h2>
          <p className="text-white/50 text-sm">Last synced: Today, 08:42 AM</p>
        </div>
        <button className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary-dark transition-colors shadow-lg shadow-primary/20 flex items-center gap-2 cursor-pointer">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Export Report
        </button>
      </div>

      {/* Top Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="glass rounded-2xl p-5 border border-white/10 hover:border-primary/30 transition-colors relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <svg className="w-16 h-16 text-primary" fill="currentColor" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
          </div>
          <p className="text-sm text-white/50 font-medium mb-1 relative z-10">Total TB Cases</p>
          <h3 className="text-4xl font-bold text-white mb-2 relative z-10">320</h3>
          <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-success/20 text-success text-xs font-semibold relative z-10">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
            12% vs 2024
          </div>
        </div>
        <div className="glass rounded-2xl p-5 border border-white/10 hover:border-accent/30 transition-colors relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <svg className="w-16 h-16 text-accent" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          </div>
          <p className="text-sm text-white/50 font-medium mb-1 relative z-10">Active Cases</p>
          <h3 className="text-4xl font-bold text-accent mb-2 relative z-10">103</h3>
          <div className="inline-flex items-center gap-1 text-white/50 text-xs font-medium relative z-10">Ongoing treatment</div>
        </div>
        <div className="glass rounded-2xl p-5 border border-danger/20 hover:border-danger/40 transition-colors relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <svg className="w-16 h-16 text-danger" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L1 21h22M12 6l7.53 13H4.47M11 10v4h2v-4m-2 6v2h2v-2"/></svg>
          </div>
          <p className="text-sm text-white/50 font-medium mb-1 relative z-10">High Risk Barangays</p>
          <h3 className="text-4xl font-bold text-danger mb-2 relative z-10">14</h3>
          <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-danger/20 text-danger text-xs font-semibold relative z-10">Immediate action needed</div>
        </div>
        <div className="glass rounded-2xl p-5 border border-white/10 hover:border-success/30 transition-colors relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <svg className="w-16 h-16 text-success" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
          </div>
          <p className="text-sm text-white/50 font-medium mb-1 relative z-10">Treatment Success Rate</p>
          <h3 className="text-4xl font-bold text-white mb-2 relative z-10">84%</h3>
          <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-danger/20 text-danger text-xs font-semibold relative z-10">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
            Below WHO Target (90%)
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass rounded-2xl p-6 border border-white/10 lg:col-span-2 flex flex-col">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-white">Monthly TB Case Trends</h3>
            <p className="text-sm text-white/50">Actual cases vs ARIMA forecast for 2024</p>
          </div>
          <div className="flex-1 min-h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" tick={{fill: 'rgba(255,255,255,0.5)', fontSize: 12}} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.5)" tick={{fill: 'rgba(255,255,255,0.5)', fontSize: 12}} tickLine={false} axisLine={false} />
                <RechartsTooltip contentStyle={{ backgroundColor: 'rgba(30,27,75,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff' }} itemStyle={{ color: '#fff' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }} />
                <Line type="monotone" dataKey="actual" name="Actual Cases" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#f59e0b" strokeWidth={3} strokeDasharray="5 5" dot={{ r: 4, strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="glass rounded-2xl p-6 border border-white/10 flex flex-col">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-white">Treatment Outcomes</h3>
            <p className="text-sm text-white/50">Distribution for current year</p>
          </div>
          <div className="flex-1 min-h-[300px] w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={outcomeData} cx="50%" cy="50%" innerRadius={80} outerRadius={110} paddingAngle={5} dataKey="value" stroke="none">
                  {outcomeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <RechartsTooltip contentStyle={{ backgroundColor: 'rgba(30,27,75,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} itemStyle={{ color: '#fff' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="glass rounded-2xl p-6 border border-white/10 lg:col-span-3 flex flex-col">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-white">Cases by Barangay (Top 5)</h3>
            <p className="text-sm text-white/50">Highest concentration areas</p>
          </div>
          <div className="min-h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barangayData} margin={{ top: 5, right: 0, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" tick={{fill: 'rgba(255,255,255,0.5)', fontSize: 12}} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.5)" tick={{fill: 'rgba(255,255,255,0.5)', fontSize: 12}} tickLine={false} axisLine={false} />
                <RechartsTooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} contentStyle={{ backgroundColor: 'rgba(30,27,75,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
                <Bar dataKey="cases" name="Cases" fill="#818cf8" radius={[6,6,0,0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Alerts Section */}
      <div className="glass rounded-2xl p-6 border border-white/10">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            Latest Alerts
          </h3>
          <button className="text-sm text-primary-light hover:text-primary transition-colors font-medium cursor-pointer">View All</button>
        </div>
        <div className="space-y-3">
          <div className="bg-danger/10 border border-danger/20 rounded-xl p-4 flex gap-4 items-start">
            <div className="w-2 h-2 rounded-full bg-danger mt-1.5 animate-pulse" />
            <div>
              <h4 className="font-semibold text-danger text-sm">Manggahan — Critical Case Surge</h4>
              <p className="text-white/70 text-xs mt-1">Cases increased 34% in the past 30 days. Immediate intervention required.</p>
              <span className="text-danger/60 text-xs mt-2 block">2 hours ago</span>
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex gap-4 items-start">
            <div className="w-2 h-2 rounded-full bg-accent mt-1.5" />
            <div>
              <h4 className="font-semibold text-white text-sm">System Sync Completed</h4>
              <p className="text-white/70 text-xs mt-1">Data from 47 barangay health centers successfully synchronized.</p>
              <span className="text-white/40 text-xs mt-2 block">Today at 08:42 AM</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard Page ───────────────────────────────────────────────────────
export default function DashboardPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { navigate('/login'); return; }
    setUser(JSON.parse(stored));
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  if (!user) return null;

  const isAdmin = user.role === 'admin';

  const navTabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'records', label: 'Records' },
    { id: 'map', label: 'Map' },
    { id: 'alerts', label: 'Alerts' },
    ...(isAdmin ? [{ id: 'users', label: 'Users' }] : []),
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f0c29] via-[#302b63] to-[#24243e] text-white overflow-hidden flex flex-col">
      {/* Background Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-40 -left-40 w-80 h-80 bg-primary/20 rounded-full blur-[100px] animate-float" />
        <div className="absolute top-1/2 -right-20 w-96 h-96 bg-secondary/15 rounded-full blur-[120px] animate-float" style={{ animationDelay: '2s' }} />
      </div>

      {/* Grid Pattern */}
      <div className="fixed inset-0 opacity-[0.03] z-0 pointer-events-none" style={{ backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`, backgroundSize: '60px 60px' }} />

      {/* Top Nav */}
      <div className="relative z-20 px-6 pt-6">
        <nav className="glass-strong rounded-2xl border border-white/10 shadow-2xl shadow-primary/10">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/20">
                <span className="text-white font-bold text-lg tracking-tighter">TB</span>
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white leading-tight">TB System</h1>
                <p className="text-xs text-white/50 font-medium tracking-wide">HEALTH INSIGHT</p>
              </div>
            </div>

            {/* Nav Tabs */}
            <div className="hidden md:flex items-center gap-1 bg-white/5 p-1.5 rounded-xl border border-white/10">
              {navTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === tab.id
                      ? 'bg-primary/20 text-primary-light'
                      : 'hover:bg-white/5 text-white/70 hover:text-white'
                  }`}
                >
                  {tab.id === 'users' && (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  )}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* User Info + Logout */}
            <div className="flex items-center gap-4">
              <div className="hidden sm:block text-right">
                <p className="text-sm font-semibold text-white">{user.username}</p>
                <div className="flex justify-end mt-0.5">
                  <RoleBadge role={user.role} />
                </div>
              </div>
              <div className="w-px h-8 bg-white/10 hidden sm:block" />
              <button
                onClick={handleLogout}
                className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 hover:bg-danger/20 hover:border-danger/30 hover:text-danger flex items-center justify-center transition-all duration-300 cursor-pointer text-white/70 group"
                title="Logout"
              >
                <svg className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </nav>
      </div>

      {/* Main Content */}
      <main className="relative z-10 flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-7xl mx-auto">
          {activeTab === 'dashboard' && <OverviewPanel />}
          {activeTab === 'users' && isAdmin && <UsersPanel currentUser={user} />}
          {(activeTab === 'records' || activeTab === 'map' || activeTab === 'alerts') && (
            <div className="flex flex-col items-center justify-center py-32 text-white/30 animate-slide-up">
              <svg className="w-16 h-16 mb-4 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <p className="text-lg font-medium capitalize">{activeTab}</p>
              <p className="text-sm mt-1">This section is coming soon</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
