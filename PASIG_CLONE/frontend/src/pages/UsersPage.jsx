import { useState, useEffect } from 'react';
import API from '../api/axios';
import { useTheme } from '../theme';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import SkeletonBlock from '../components/SkeletonBlock';

const cardStyle = (t) => ({
  background: t.cardSolid,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});

export default function UsersPage() {
  const { t } = useTheme();
  const [users, setUsers] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', role: 'staff', facility_id: '' });
  const [formError, setFormError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [createConfirm, setCreateConfirm] = useState(null);
  const [resetConfirm, setResetConfirm] = useState(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState(null);
  const [createdUser, setCreatedUser] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({ role: 'staff', facility_id: '' });
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const facilityLabel = (id) => {
    const f = facilities.find((x) => x.id === Number(id));
    return f ? `${f.name} (${f.barangay_name})` : '—';
  };

  const fetchUsers = async () => {
    try {
      const res = await API.get('/api/auth/users');
      setUsers(res.data.users || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    API.get('/api/facilities')
      .then((res) => setFacilities(res.data.facilities || []))
      .catch(() => setFacilities([]));
  }, []);

  const handleCreate = async () => {
    if (!createConfirm) return;
    setFormError('');
    setCreating(true);
    try {
      const res = await API.post('/api/auth/register', {
        username: createConfirm.username.trim(),
        email: createConfirm.email.trim(),
        role: createConfirm.role,
        facility_id: createConfirm.facility_id === '' ? null : Number(createConfirm.facility_id),
      });
      setCreatedUser(res.data.user);
      setGeneratedPassword(res.data.tempPassword);
      setCreateConfirm(null);
      setForm({ username: '', email: '', role: 'staff', facility_id: '' });
      setShowCreate(false);
      fetchUsers();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create user.');
      setCreateConfirm(null);
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (u) => {
    setEditUser(u);
    setEditForm({ role: u.role, facility_id: u.facility_id ?? '' });
    setEditError('');
    setError('');
  };

  const handleEdit = async () => {
    if (!editUser) return;
    setEditError('');
    if (editForm.role === 'staff' && editForm.facility_id === '') {
      setEditError('A registered health facility is required for staff accounts.');
      return;
    }
    setEditSaving(true);
    try {
      await API.put(`/api/auth/users/${editUser.id}`, {
        role: editForm.role,
        facility_id: editForm.facility_id === '' ? null : Number(editForm.facility_id),
      });
      setEditUser(null);
      fetchUsers();
    } catch (err) {
      setEditError(err.response?.data?.error || 'Failed to update user.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (userId) => {
    try { await API.delete(`/api/auth/users/${userId}`); setDeleteConfirm(null); fetchUsers(); }
    catch (err) { setError(err.response?.data?.error || 'Failed to delete user.'); }
  };

  const handleResetPassword = async () => {
    if (!resetConfirm) return;
    setResetLoading(true);
    try {
      const res = await API.put(`/api/auth/users/${resetConfirm.id}/password`);
      setGeneratedPassword(res.data.tempPassword);
      setCreatedUser(res.data.user || resetConfirm);
      setResetConfirm(null);
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reset password.');
      setResetConfirm(null);
    } finally {
      setResetLoading(false);
    }
  };

  const copyToClipboard = async (text) => {
    try { await navigator.clipboard.writeText(text); } catch {
      const el = document.createElement('textarea'); el.value = text;
      document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
    }
  };

  if (loading) return <div className="space-y-4"><SkeletonBlock className="h-12" /><SkeletonBlock className="h-64" /></div>;

  return (
    <div className="space-y-5">
      {/* Card Header with Tabs */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        {/* Title Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Users</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Manage authorized Pasig TB-IS accounts.</p>
          </div>
          <button onClick={() => { setShowCreate(true); setFormError(''); }} className="px-4 py-2 text-xs font-semibold shrink-0 flex items-center gap-2" style={{ background: '#0F2D52', color: '#ffffff', borderRadius: 4, transition: 'background 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; }} onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; }}>
            Create User
          </button>
        </div>
      </div>

      {error && <div className="px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B', border: '1px solid rgba(239,68,68,0.12)' }}>{error}</div>}

      {showCreate && (
        <div style={cardStyle(t)} className="p-6">
          <h2 className="text-sm font-bold mb-4" style={{ color: t.text }}>Create New User</h2>
          {formError && <div className="mb-4 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B' }}>{formError}</div>}
          <form onSubmit={(e) => { e.preventDefault(); if (!form.username.trim() || !form.email.trim()) { setFormError('Username and email are required.'); return; } if (form.role === 'staff' && form.facility_id === '') { setFormError('A registered health facility is required for staff accounts.'); return; } setFormError(''); setCreateConfirm({ ...form }); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Username" className="px-3 py-2 text-xs rounded-lg outline-none" style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }} />
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" className="px-3 py-2 text-xs rounded-lg outline-none" style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }} />
            <div className="flex gap-2 sm:col-span-2">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="flex-1 px-3 py-2 text-xs rounded-lg outline-none" style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }}>
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
              <select value={form.facility_id} onChange={(e) => setForm({ ...form, facility_id: e.target.value })} className="flex-1 px-3 py-2 text-xs rounded-lg outline-none" style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }}>
                <option value="" disabled={form.role === 'staff'}>{form.role === 'staff' ? 'Select facility…' : 'No facility (optional)'}</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>{f.name} ({f.barangay_name})</option>
                ))}
              </select>
              <button type="submit" disabled={creating} className="px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-50" style={{ background: '#0F2D52', color: '#ffffff' }}>Create</button>
              <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-2 text-xs font-semibold rounded-lg" style={{ border: `1px solid ${t.borderStrong}`, color: t.textSecondary }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div style={cardStyle(t)} className="overflow-hidden">
        {users.length === 0 ? (
          <EmptyState icon="ri-team-line" title="No Users" description="Create your first user account." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.borderStrong}` }}>
                  {['Username', 'Email', 'Role', 'Facility', 'Created', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wide" style={{ color: t.textMuted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={{ borderBottom: `1px solid ${t.border}` }}>
                    <td className="px-4 py-3 text-xs font-semibold" style={{ color: t.text }}>{u.username}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: t.textSecondary }}>{u.email}</td>
                    <td className="px-4 py-3"><StatusBadge status={u.role} /></td>
                    <td className="px-4 py-3 text-xs" style={{ color: t.textSecondary }}>{u.facility_name || '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: t.textSecondary }}>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(u)} className="px-2 py-1 text-[10px] font-semibold rounded" style={{ color: '#2E6FAF' }}>Edit</button>
                        <button onClick={() => { setResetConfirm(u); setError(''); }} className="px-2 py-1 text-[10px] font-semibold rounded" style={{ color: '#2E6FAF' }}>Reset Password</button>
                        <button onClick={() => setDeleteConfirm(u)} className="px-2 py-1 text-[10px] font-semibold rounded" style={{ color: '#EF4444' }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {createConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Create New User?</h3>
            <div className="bg-gray-50 rounded-lg p-3 mb-4 text-xs space-y-1">
              <p><span className="text-gray-500">Username:</span> <strong>{createConfirm.username}</strong></p>
              <p><span className="text-gray-500">Email:</span> <strong>{createConfirm.email}</strong></p>
              <p><span className="text-gray-500">Role:</span> <strong>{createConfirm.role}</strong></p>
              <p><span className="text-gray-500">Facility:</span> <strong>{createConfirm.facility_id ? facilityLabel(createConfirm.facility_id) : '—'}</strong></p>
            </div>
            <p className="text-[10px] text-gray-500 text-center mb-4">A secure temporary password will be generated.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setCreateConfirm(null)} disabled={creating} className="px-4 py-2 text-xs font-semibold text-gray-600 border border-gray-300 rounded-lg disabled:opacity-50">Cancel</button>
              <button onClick={handleCreate} disabled={creating} className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2D52] rounded-lg disabled:opacity-50">{creating ? 'Creating...' : 'Create User'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Delete User?</h3>
            <p className="text-xs text-gray-600 mb-4">Are you sure you want to delete <strong>{deleteConfirm.username}</strong>? This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-xs font-semibold text-gray-600 border border-gray-300 rounded-lg">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm.id)} className="px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded-lg">Delete</button>
            </div>
          </div>
        </div>
      )}

      {resetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Reset Password?</h3>
            <p className="text-xs text-gray-600 mb-4">Generate a new temporary password for <strong>{resetConfirm.username}</strong>.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setResetConfirm(null)} disabled={resetLoading} className="px-4 py-2 text-xs font-semibold text-gray-600 border border-gray-300 rounded-lg disabled:opacity-50">Cancel</button>
              <button onClick={handleResetPassword} disabled={resetLoading} className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2D52] rounded-lg disabled:opacity-50">{resetLoading ? 'Resetting...' : 'Reset Password'}</button>
            </div>
          </div>
        </div>
      )}

      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Edit User</h3>
            <p className="text-xs text-gray-500 mb-4">Update role or health facility for <strong>{editUser.username}</strong>.</p>
            {editError && <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B', border: '1px solid rgba(239,68,68,0.12)' }}>{editError}</div>}
            <div className="space-y-3 mb-4">
              <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })} className="w-full px-3 py-2 text-xs rounded-lg outline-none" style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }}>
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
              <select value={String(editForm.facility_id)} onChange={(e) => setEditForm({ ...editForm, facility_id: e.target.value })} className="w-full px-3 py-2 text-xs rounded-lg outline-none" style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }}>
                <option value="" disabled={editForm.role === 'staff'}>{editForm.role === 'staff' ? 'Select facility…' : 'No facility'}</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>{f.name} ({f.barangay_name})</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditUser(null)} disabled={editSaving} className="px-4 py-2 text-xs font-semibold text-gray-600 border border-gray-300 rounded-lg disabled:opacity-50">Cancel</button>
              <button onClick={handleEdit} disabled={editSaving} className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2D52] rounded-lg disabled:opacity-50">{editSaving ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}

      {generatedPassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <div className="flex justify-center mb-4"><div className="w-12 h-12 rounded-full flex items-center justify-center bg-green-50"><i className="ri-check-line text-2xl text-green-600" /></div></div>
            <h3 className="text-center text-sm font-bold text-gray-900 mb-3">{createdUser ? 'User Created' : 'Password Reset'}</h3>
            <div className="bg-gray-50 rounded-lg p-3 mb-3">
              <p className="text-[10px] text-gray-500">Username</p>
              <p className="text-xs font-semibold">{createdUser?.username}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 mb-4">
              <p className="text-[10px] text-gray-500">Temporary Password</p>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 text-sm font-mono font-bold bg-white px-3 py-2 rounded border select-all">{generatedPassword}</code>
                <button onClick={() => copyToClipboard(generatedPassword)} className="px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50 rounded border"><i className="ri-file-copy-line" /></button>
              </div>
            </div>
            <p className="text-[10px] text-gray-500 text-center mb-4">Provide this password through a secure method.</p>
            <button onClick={() => { setGeneratedPassword(null); setCreatedUser(null); }} className="w-full py-2.5 rounded-lg font-bold text-xs text-white bg-[#0F2D52]">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
