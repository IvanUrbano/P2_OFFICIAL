import { useState } from 'react';

/* ─── Mock user data ─── */
const POSITIONS = [
  'System Administrator',
  'Health Program Coordinator',
  'TB Program Officer',
  'Data Analyst',
  'Health Staff',
  'Contact Tracing Officer',
  'Records Officer',
  'Community Health Worker',
];

const initialUsers = [
  { id: 1, name: 'Juliana Reyes', username: 'juliana', email: 'juliana@pasigcity.gov.ph', role: 'Admin', position: 'System Administrator', status: 'Active', dateCreated: '2024-01-15' },
  { id: 2, name: 'Mark Santos', username: 'msantos', email: 'msantos@pasigcity.gov.ph', role: 'Staff', position: 'TB Program Officer', status: 'Active', dateCreated: '2024-03-20' },
  { id: 3, name: 'Ana Cruz', username: 'acruz', email: 'acruz@pasigcity.gov.ph', role: 'Staff', position: 'Health Staff', status: 'Active', dateCreated: '2024-05-10' },
  { id: 4, name: 'Carlos Dela Cruz', username: 'cdelacruz', email: 'cdelacruz@pasigcity.gov.ph', role: 'Staff', position: 'Contact Tracing Officer', status: 'Active', dateCreated: '2024-07-05' },
  { id: 5, name: 'Maria Garcia', username: 'mgarcia', email: 'mgarcia@pasigcity.gov.ph', role: 'Staff', position: 'Data Analyst', status: 'Active', dateCreated: '2024-09-12' },
  { id: 6, name: 'Jose Ramos', username: 'jramos', email: 'jramos@pasigcity.gov.ph', role: 'Staff', position: 'Records Officer', status: 'Active', dateCreated: '2025-01-08' },
  { id: 7, name: 'Lisa Tan', username: 'ltan', email: 'ltan@pasigcity.gov.ph', role: 'Staff', position: 'Community Health Worker', status: 'Inactive', dateCreated: '2024-02-18' },
  { id: 8, name: 'Pedro Mendoza', username: 'pmendoza', email: 'pmendoza@pasigcity.gov.ph', role: 'Staff', position: 'Health Program Coordinator', status: 'Inactive', dateCreated: '2024-04-25' },
];

const roleColors = { Admin: '#8B5CF6', Staff: '#3B82F6', admin: '#8B5CF6', staff: '#3B82F6' };
const statusColors = { Active: '#10B981', Inactive: '#94A3B8' };

function RoleBadge({ role }) {
  const color = roleColors[role] || '#94A3B8';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap"
      style={{ background: `${color}1A`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
      {role}
    </span>
  );
}

function StatusBadge({ status }) {
  const color = statusColors[status] || '#94A3B8';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap"
      style={{ background: `${color}1A`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
      {status}
    </span>
  );
}

export default function Users() {
  const [users, setUsers] = useState(initialUsers);
  const [activeTab, setActiveTab] = useState('active');
  const [showModal, setShowModal] = useState(null); // 'add' | 'edit' | 'reset' | null
  const [selectedUser, setSelectedUser] = useState(null);
  const [formData, setFormData] = useState({ name: '', username: '', email: '', role: 'Staff', position: 'Health Staff', password: '' });

  const activeUsers = users.filter(u => u.status === 'Active');
  const inactiveUsers = users.filter(u => u.status === 'Inactive');
  const displayedUsers = activeTab === 'active' ? activeUsers : inactiveUsers;

  const handleAddUser = () => {
    setFormData({ name: '', username: '', email: '', role: 'Staff', position: 'Health Staff', password: '' });
    setShowModal('add');
  };

  const handleEditUser = (user) => {
    setSelectedUser(user);
    setFormData({ name: user.name, username: user.username, email: user.email, role: user.role, position: user.position || 'Health Staff', password: '' });
    setShowModal('edit');
  };

  const handleResetPassword = (user) => {
    setSelectedUser(user);
    setShowModal('reset');
  };

  const handleDeactivate = (userId) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, status: u.status === 'Active' ? 'Inactive' : 'Active' } : u));
  };

  const handleSave = () => {
    if (showModal === 'add') {
      const newUser = {
        id: users.length + 1,
        ...formData,
        status: 'Active',
        dateCreated: new Date().toISOString().split('T')[0],
      };
      setUsers(prev => [...prev, newUser]);
    } else if (showModal === 'edit' && selectedUser) {
      setUsers(prev => prev.map(u => u.id === selectedUser.id ? { ...u, ...formData } : u));
    }
    setShowModal(null);
    setSelectedUser(null);
  };

  return (
    <div className="relative space-y-5">

      {/* ── Metric Strip ── */}
      <section
        className="rounded-2xl px-6 py-5 flex items-center"
        style={{
          background: '#ffffff',
          border: '1px solid rgba(148,163,184,0.18)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        {[
          { title: 'Total Users', value: users.length, icon: 'ri-team-line', color: '#0F2D52', tag: 'All accounts', tagColor: '#0F2D52' },
          { title: 'Active Users', value: activeUsers.length, icon: 'ri-user-follow-line', color: '#10B981', tag: 'Online', tagColor: '#10B981' },
          { title: 'Inactive Users', value: inactiveUsers.length, icon: 'ri-user-unfollow-line', color: '#94A3B8', tag: 'Disabled', tagColor: '#94A3B8' },
        ].map((c, i) => (
          <div key={c.title} className="flex items-center" style={{ flex: '1 1 0' }}>
            {i > 0 && (
              <div style={{ width: 2, height: 48, background: 'rgba(3,33,62,0.12)', marginRight: 20, borderRadius: 2 }} />
            )}
            <div className="flex items-center gap-3 min-w-0" style={{ paddingLeft: i === 0 ? 4 : 0 }}>
              <i className={`${c.icon} text-xl shrink-0`} style={{ color: c.color }} />
              <div className="min-w-0">
                <div style={{ fontSize: '.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#64748b', marginBottom: 2, lineHeight: 1 }}>
                  {c.title}
                </div>
                <div className="flex items-baseline gap-2">
                  <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>{c.value}</span>
                  <span style={{ fontSize: '.65rem', fontWeight: 700, color: c.tagColor }}>{c.tag}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* ── Action Buttons + Tabs ── */}
      <section className="glass-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: '#0f172a' }}>
            <i className="ri-team-line text-lg" style={{ color: '#2E6FAF' }} />
            <span>User Management</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddUser}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold text-white transition hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #0066FF 0%, #00D8F6 100%)' }}
            >
              <i className="ri-user-add-line text-sm" />
              Add User
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 mt-5">
          <button
            onClick={() => setActiveTab('active')}
            className="px-4 py-2 rounded-lg text-xs font-bold transition-all"
            style={{
              background: activeTab === 'active' ? 'rgba(16,185,129,0.12)' : 'rgba(148,163,184,0.08)',
              border: activeTab === 'active' ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(148,163,184,0.2)',
              color: activeTab === 'active' ? '#10B981' : '#64748B',
            }}
          >
            <i className="ri-user-follow-line mr-1" />
            Active Users ({activeUsers.length})
          </button>
          <button
            onClick={() => setActiveTab('inactive')}
            className="px-4 py-2 rounded-lg text-xs font-bold transition-all"
            style={{
              background: activeTab === 'inactive' ? 'rgba(148,163,184,0.12)' : 'rgba(148,163,184,0.08)',
              border: activeTab === 'inactive' ? '1px solid rgba(148,163,184,0.3)' : '1px solid rgba(148,163,184,0.2)',
              color: activeTab === 'inactive' ? '#64748B' : '#64748B',
            }}
          >
            <i className="ri-user-unfollow-line mr-1" />
            Inactive Users ({inactiveUsers.length})
          </button>
        </div>

        {/* User Table */}
        <div className="mt-4 min-h-[400px] overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr>
                {['Name', 'Username', 'Email', 'Role', 'Position', 'Status', 'Date Created', 'Actions'].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: '#64748b', borderBottom: '1px solid rgba(148,163,184,.15)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayedUsers.map((user) => (
                <tr
                  key={user.id}
                  style={{ borderTop: '1px solid rgba(148,163,184,.1)' }}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ background: '#091124', color: '#ffffff', border: '1px solid #0066FF' }}
                      >
                        {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <span className="font-bold" style={{ color: '#0f172a' }}>{user.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3" style={{ color: '#475569' }}>{user.username}</td>
                  <td className="px-5 py-3" style={{ color: '#475569' }}>{user.email}</td>
                  <td className="px-5 py-3"><RoleBadge role={user.role} /></td>
                  <td className="px-5 py-3 text-xs font-medium" style={{ color: '#475569' }}>{user.position || '—'}</td>
                  <td className="px-5 py-3"><StatusBadge status={user.status} /></td>
                  <td className="px-5 py-3 text-xs" style={{ color: '#94A3B8' }}>{user.dateCreated}</td>
                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditUser(user)}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition hover:opacity-80"
                        style={{ background: 'rgba(46,111,175,0.1)', border: '1px solid rgba(46,111,175,0.25)', color: '#2E6FAF' }}
                        title="Edit User"
                      >
                        <i className="ri-edit-line text-sm" />
                      </button>
                      <button
                        onClick={() => handleDeactivate(user.id)}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition hover:opacity-80"
                        style={{
                          background: user.status === 'Active' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
                          border: user.status === 'Active' ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(16,185,129,0.25)',
                          color: user.status === 'Active' ? '#EF4444' : '#10B981',
                        }}
                        title={user.status === 'Active' ? 'Deactivate' : 'Activate'}
                      >
                        <i className={`${user.status === 'Active' ? 'ri-user-unfollow-line' : 'ri-user-follow-line'} text-sm`} />
                      </button>
                      <button
                        onClick={() => handleResetPassword(user)}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition hover:opacity-80"
                        style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#F59E0B' }}
                        title="Reset Password"
                      >
                        <i className="ri-lock-password-line text-sm" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Add/Edit User Modal ── */}
      {(showModal === 'add' || showModal === 'edit') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
          <div
            className="glass-card w-full max-w-lg max-h-[90vh] overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.97)' }}
          >
            <div
              className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderBottom: '1px solid rgba(148,163,184,.15)' }}
            >
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: '#64748b' }}>
                  {showModal === 'add' ? 'Add New User' : 'Edit User'}
                </p>
                <h2 className="mt-2 text-xl font-bold tracking-tight" style={{ color: '#0f172a' }}>
                  {showModal === 'add' ? 'Create User Account' : `Edit ${selectedUser?.name}`}
                </h2>
              </div>
              <button
                onClick={() => { setShowModal(null); setSelectedUser(null); }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-80"
                style={{ background: '#f1f5f9', color: '#475569' }}
              >
                <i className="ri-close-line text-base" />
              </button>
            </div>

            <div className="space-y-4 px-6 py-6">
              {[
                { label: 'Full Name', key: 'name', placeholder: 'Enter full name' },
                { label: 'Username', key: 'username', placeholder: 'Enter username' },
                { label: 'Email', key: 'email', placeholder: 'Enter email address', type: 'email' },
              ].map((field) => (
                <div key={field.key}>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: '#64748b' }}>
                    {field.label}
                  </label>
                  <input
                    type={field.type || 'text'}
                    value={formData[field.key]}
                    onChange={(e) => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className="w-full rounded-lg px-3 py-2.5 text-xs font-medium outline-none transition focus:ring-2"
                    style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}
                  />
                </div>
              ))}

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: '#64748b' }}>Role</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2.5 text-xs font-medium outline-none transition"
                  style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}
                >
                  <option value="Staff">Staff</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: '#64748b' }}>Position</label>
                <select
                  value={formData.position}
                  onChange={(e) => setFormData(prev => ({ ...prev, position: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2.5 text-xs font-medium outline-none transition"
                  style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}
                >
                  {POSITIONS.map((pos) => (
                    <option key={pos} value={pos}>{pos}</option>
                  ))}
                </select>
              </div>

              {showModal === 'add' && (
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: '#64748b' }}>Password</label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="Enter password"
                    className="w-full rounded-lg px-3 py-2.5 text-xs font-medium outline-none transition focus:ring-2"
                    style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}
                  />
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSave}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold text-white transition hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #0066FF 0%, #00D8F6 100%)' }}
                >
                  <i className={`${showModal === 'add' ? 'ri-user-add-line' : 'ri-check-line'} text-sm`} />
                  {showModal === 'add' ? 'Create User' : 'Save Changes'}
                </button>
                <button
                  onClick={() => { setShowModal(null); setSelectedUser(null); }}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition"
                  style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}
                >
                  <i className="ri-close-line text-sm" />
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset Password Modal ── */}
      {showModal === 'reset' && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
          <div
            className="glass-card w-full max-w-md max-h-[90vh] overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.97)' }}
          >
            <div
              className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderBottom: '1px solid rgba(148,163,184,.15)' }}
            >
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: '#64748b' }}>
                  Reset Password
                </p>
                <h2 className="mt-2 text-xl font-bold tracking-tight" style={{ color: '#0f172a' }}>
                  Reset for {selectedUser.name}
                </h2>
              </div>
              <button
                onClick={() => { setShowModal(null); setSelectedUser(null); }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-80"
                style={{ background: '#f1f5f9', color: '#475569' }}
              >
                <i className="ri-close-line text-base" />
              </button>
            </div>

            <div className="space-y-4 px-6 py-6">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: '#64748b' }}>New Password</label>
                <input
                  type="password"
                  placeholder="Enter new password"
                  className="w-full rounded-lg px-3 py-2.5 text-xs font-medium outline-none transition focus:ring-2"
                  style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: '#64748b' }}>Confirm Password</label>
                <input
                  type="password"
                  placeholder="Confirm new password"
                  className="w-full rounded-lg px-3 py-2.5 text-xs font-medium outline-none transition focus:ring-2"
                  style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setShowModal(null); setSelectedUser(null); }}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold text-white transition hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #0066FF 0%, #00D8F6 100%)' }}
                >
                  <i className="ri-lock-password-line text-sm" />
                  Reset Password
                </button>
                <button
                  onClick={() => { setShowModal(null); setSelectedUser(null); }}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition"
                  style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}
                >
                  <i className="ri-close-line text-sm" />
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
