import { useState, useEffect } from 'react';
import API from '../api/axios';
import { useTheme } from '../theme';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import SkeletonBlock from '../components/SkeletonBlock';
import FilterSelect from '../components/FilterSelect';
import RowMenu from '../components/RowMenu';
import ModalCloseButton from '../components/ModalCloseButton';

const cardStyle = (t) => ({
  background: t.cardSolid,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});

const EMPTY_FORM = { full_name: '', username: '', email: '', role: 'staff', barangay_id: '' };
const EMPTY_FILTERS = { search: '', role: '', barangay: '', status: '' };
const STAFF_BARANGAY_MSG = 'An assigned barangay is required for staff accounts.';
const CITY_WIDE = 'City-wide';

function Field({ label, required, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold mb-1" style={{ color: '#475569' }}>
        {label}{required && <span style={{ color: '#DC2626' }}> *</span>}
      </span>
      {children}
      {hint && <span className="block text-[10px] mt-1" style={{ color: '#94A3B8' }}>{hint}</span>}
    </label>
  );
}

function formatDateTime(value, fallback = '—') {
  if (!value) return fallback;
  const d = new Date(value);
  if (isNaN(d.getTime())) return fallback;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Locked = held by an administrator, or the automatic lockout after 5 wrong passwords.
const isAutoLocked = (u) => Boolean(u.locked_until && new Date(u.locked_until) > new Date());
const isLocked = (u) => Boolean(u.manually_locked) || isAutoLocked(u);
const lockText = (u) => (u.manually_locked
  ? `Locked by an administrator${u.locked_at ? ` on ${formatDateTime(u.locked_at)}` : ''}`
  : `Locked after repeated wrong passwords, until ${formatDateTime(u.locked_until)}`);

/* ─── Right-side panel, same look as TBInsight's side panels ─── */
function SidePanel({ title, subtitle, onClose, onSubmit, footer, footerBottom = false, children }) {
  const Shell = onSubmit ? 'form' : 'div';
  return (
    <div className="fixed inset-0 z-[1200] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: 'rgba(15,23,42,0.28)' }} />
      <Shell
        className="relative flex h-full w-full max-w-lg flex-col"
        style={{ background: '#ffffff', border: '1px solid #E2E8F0', borderRadius: 5, boxShadow: '0 12px 36px rgba(15,23,42,0.18)', animation: 'slide-in-right 0.3s ease-out both' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className="flex shrink-0 items-center justify-between px-6 py-4" style={{ background: '#0F2D52' }}>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: '#ffffff' }}>{title}</p>
            {subtitle && <p className="text-[11px] mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>{subtitle}</p>}
          </div>
          <ModalCloseButton onClick={onClose} light />
        </div>
        {/* Not flex-1: the buttons follow the content instead of being pushed to the bottom. */}
        <div className={`min-h-0 overflow-y-auto p-6 pb-4 space-y-4 ${footerBottom ? 'flex-1' : ''}`}>{children}</div>
        {footer && (
          <div className={`shrink-0 px-6 py-4 flex items-center gap-2 ${footerBottom ? 'mt-auto justify-end border-t border-gray-200' : ''}`} style={{ background: '#ffffff' }}>
            {footer}
          </div>
        )}
      </Shell>
    </div>
  );
}

const primaryBtn = { background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 };
const secondaryBtn = { background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 };

function DetailRow({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2" style={{ borderBottom: '1px solid #F1F5F9' }}>
      <dt className="text-[11px] shrink-0" style={{ color: '#94A3B8' }}>{label}</dt>
      <dd className="text-xs text-right min-w-0 break-words" style={{ color: '#0F2D52' }}>{children}</dd>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <section>
      <h3 className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: '#64748B' }}>{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

function ConfirmDialog({ title, children, confirmLabel, busyLabel, busy, danger, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/40" onClick={busy ? undefined : onCancel}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-gray-900 mb-2">{title}</h3>
        <div className="text-xs text-gray-600 mb-4 space-y-2">{children}</div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} disabled={busy} className="px-4 py-2 text-xs font-semibold text-gray-600 border border-gray-300 rounded-lg disabled:opacity-50">Cancel</button>
          <button onClick={onConfirm} disabled={busy} className={`px-4 py-2 text-xs font-semibold text-white rounded-lg disabled:opacity-50 ${danger ? 'bg-red-600' : 'bg-[#0F2D52]'}`}>{busy ? busyLabel : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { t } = useTheme();
  const [users, setUsers] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [createConfirm, setCreateConfirm] = useState(null);
  const [menu, setMenu] = useState(null); // { user, anchor }
  const [detailUser, setDetailUser] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({ full_name: '', email: '', role: 'staff', barangay_id: '' });
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // { kind: 'reset'|'deactivate'|'lock', user }
  const [busy, setBusy] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState(null);
  const [createdUser, setCreatedUser] = useState(null);
  const [passwordFor, setPasswordFor] = useState(''); // username shown with the temporary password
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const currentUserId = (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null')?.id ?? null; } catch { return null; }
  })();

  const inputStyle = { background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text };
  const inputClass = 'w-full px-3 py-2 text-xs rounded-lg outline-none';
  const readOnlyStyle = { background: '#F1F5F9', border: '1px solid #E2E8F0', color: '#64748B' };

  const barangayLabel = (id) => barangays.find((b) => b.id === Number(id))?.name || '—';
  const toId = (v) => (v === '' || v == null ? null : Number(v));
  const accessLabel = (u) => (u.role === 'admin' ? CITY_WIDE : (u.barangay_name || '—'));

  /* ── Search + filters (client-side: the account list is small) ── */
  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const activeFilterCount = Object.values(filters).filter((v) => String(v).trim() !== '').length;
  const filteredUsers = users.filter((u) => {
    const q = filters.search.trim().toLowerCase();
    if (q && ![u.full_name, u.username, u.email].some((v) => String(v || '').toLowerCase().includes(q))) return false;
    if (filters.role && u.role !== filters.role) return false;
    if (filters.barangay === 'city-wide' && u.role !== 'admin') return false;
    if (filters.barangay === 'unassigned' && !(u.role === 'staff' && !u.barangay_id)) return false;
    if (/^\d+$/.test(filters.barangay) && Number(u.barangay_id) !== Number(filters.barangay)) return false;
    if (filters.status === 'locked' && !isLocked(u)) return false;
    if ((filters.status === 'active' || filters.status === 'inactive') && (u.status || 'active') !== filters.status) return false;
    return true;
  });

  const fetchUsers = async () => {
    try {
      const res = await API.get('/api/auth/users');
      const list = res.data.users || [];
      setUsers(list);
      // Keep an open details panel in sync after an action.
      setDetailUser((d) => (d ? list.find((u) => u.id === d.id) || null : d));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    // Barangays come from the database (only those with an id can be assigned).
    API.get('/api/facilities')
      .then((res) => setBarangays((res.data.barangays || []).filter((b) => b.id != null)))
      .catch(() => setBarangays([]));
  }, []);

  const flash = (text) => { setError(''); setNotice(text); };

  /* ── Create ── */
  const closeCreate = () => { setShowCreate(false); setForm(EMPTY_FORM); setFormError(''); };

  const validateCreate = () => {
    if (!form.full_name.trim()) return 'Full name is required.';
    if (!form.username.trim()) return 'Username is required.';
    if (form.role === 'staff' && form.barangay_id === '') return STAFF_BARANGAY_MSG;
    return '';
  };

  const handleCreate = async () => {
    if (!createConfirm) return;
    setFormError('');
    setCreating(true);
    try {
      const res = await API.post('/api/auth/register', {
        full_name: createConfirm.full_name.trim(),
        username: createConfirm.username.trim(),
        email: createConfirm.email.trim() || null,
        role: createConfirm.role,
        // Admins are city-wide: never send a barangay for them.
        barangay_id: createConfirm.role === 'staff' ? toId(createConfirm.barangay_id) : null,
      });
      setCreatedUser(res.data.user);
      setPasswordFor(res.data.user?.username || createConfirm.username.trim());
      setGeneratedPassword(res.data.tempPassword);
      setCreateConfirm(null);
      closeCreate();
      fetchUsers();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create user.');
      setCreateConfirm(null);
    } finally {
      setCreating(false);
    }
  };

  /* ── Edit ── */
  const openEdit = (u) => {
    setDetailUser(null);
    setEditUser(u);
    setEditForm({ full_name: u.full_name || '', email: u.email || '', role: u.role, barangay_id: u.barangay_id ?? '' });
    setEditError('');
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    if (!editUser) return;
    setEditError('');
    if (!editForm.full_name.trim()) { setEditError('Full name is required.'); return; }
    if (editForm.role === 'staff' && editForm.barangay_id === '') {
      setEditError(editUser.role === 'admin'
        ? 'Select the barangay this account will cover before saving.'
        : STAFF_BARANGAY_MSG);
      return;
    }
    setEditSaving(true);
    try {
      await API.put(`/api/auth/users/${editUser.id}`, {
        full_name: editForm.full_name.trim(),
        email: editForm.email.trim() || null,
        role: editForm.role,
        barangay_id: editForm.role === 'staff' ? toId(editForm.barangay_id) : null,
      });
      flash(`${editForm.full_name.trim() || editUser.username} was updated.`);
      setEditUser(null);
      fetchUsers();
    } catch (err) {
      setEditError(err.response?.data?.error || 'Failed to update user.');
    } finally {
      setEditSaving(false);
    }
  };

  /* ── Account actions ── */
  const runConfirmed = async () => {
    if (!confirm) return;
    const { kind, user } = confirm;
    setBusy(true);
    try {
      if (kind === 'reset') {
        const res = await API.put(`/api/auth/users/${user.id}/password`);
        setGeneratedPassword(res.data.tempPassword);
        setCreatedUser(null);
        setPasswordFor(user.username);
        setNotice('');
      } else if (kind === 'deactivate') {
        await API.patch(`/api/auth/users/${user.id}/status`, { status: 'inactive' });
        flash(`${user.username} was deactivated and can no longer sign in.`);
      } else if (kind === 'lock') {
        await API.post(`/api/auth/users/${user.id}/lock`);
        flash(`${user.username} was locked and cannot sign in until unlocked.`);
      }
      setConfirm(null);
      fetchUsers();
    } catch (err) {
      setNotice('');
      setError(err.response?.data?.error || 'Action failed. Please try again.');
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const activate = async (u) => {
    try {
      await API.patch(`/api/auth/users/${u.id}/status`, { status: 'active' });
      flash(`${u.username} was activated.`);
      fetchUsers();
    } catch (err) { setNotice(''); setError(err.response?.data?.error || 'Failed to activate account.'); }
  };

  const unlock = async (u) => {
    try {
      await API.post(`/api/auth/users/${u.id}/unlock`);
      flash(`${u.username} was unlocked and can try signing in again.`);
      fetchUsers();
    } catch (err) { setNotice(''); setError(err.response?.data?.error || 'Failed to unlock account.'); }
  };

  const menuItems = (u) => {
    const self = u.id === currentUserId;
    const inactive = (u.status || 'active') !== 'active';
    return [
      { label: 'View details', icon: 'ri-eye-line', onClick: () => setDetailUser(u) },
      { label: 'Edit user', icon: 'ri-edit-line', onClick: () => openEdit(u) },
      { label: 'Reset password', icon: 'ri-key-2-line', onClick: () => setConfirm({ kind: 'reset', user: u }) },
      { divider: true },
      // Lock / unlock follows the current state; accounts are never deleted, so their
      // audit history always stays attached to them.
      isLocked(u)
        ? { label: 'Unlock account', icon: 'ri-lock-unlock-line', onClick: () => unlock(u) }
        : { label: 'Lock account', icon: 'ri-lock-line', danger: true, disabled: self, reason: 'You cannot lock yourself', onClick: () => setConfirm({ kind: 'lock', user: u }) },
      inactive
        ? { label: 'Activate account', icon: 'ri-user-follow-line', onClick: () => activate(u) }
        : { label: 'Deactivate account', icon: 'ri-user-unfollow-line', danger: true, disabled: self, reason: 'You cannot deactivate yourself', onClick: () => setConfirm({ kind: 'deactivate', user: u }) },
    ];
  };

  const copyToClipboard = async (text) => {
    try { await navigator.clipboard.writeText(text); } catch {
      const el = document.createElement('textarea'); el.value = text;
      document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
    }
  };

  if (loading) return <div className="space-y-4"><SkeletonBlock className="h-12" /><SkeletonBlock className="h-64" /></div>;

  const roleChangedToAdmin = editUser && editUser.role === 'staff' && editForm.role === 'admin';
  const roleChangedToStaff = editUser && editUser.role === 'admin' && editForm.role === 'staff';
  const barangayChanged = editUser && editUser.role === 'staff' && editForm.role === 'staff'
    && String(editForm.barangay_id) !== String(editUser.barangay_id ?? '');

  return (
    <div className="space-y-5">
      {/* Card Header */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Users</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Manage authorized Pasig TB-IS accounts. Staff see records from their assigned barangay; admins have city-wide access.</p>
          </div>
          <button onClick={() => { setShowCreate(true); setFormError(''); }} className="flex shrink-0 items-center gap-2 self-start px-4 py-2 text-xs font-semibold sm:self-auto" style={primaryBtn}>
            <i className="ri-add-line" />
            Create User
          </button>
        </div>

        {/* Filters — same inline bar as TBInsight's pages */}
        <div className="px-6 py-3" style={{ background: '#F8FAFC' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <i className="ri-search-line pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#94A3B8' }} />
              <input
                type="text"
                value={filters.search}
                onChange={(e) => setFilter('search', e.target.value)}
                placeholder="Search name, username or email..."
                aria-label="Search users"
                className="rounded-lg pl-7 pr-3 py-[7px] text-[11px] font-semibold outline-none transition"
                style={{ background: '#ffffff', color: '#0F2D52', border: '1px solid #E2E8F0', width: 240 }}
              />
            </div>

            <FilterSelect label="Role" value={filters.role} onChange={(v) => setFilter('role', v)}>
              <option value="">All Roles</option>
              <option value="admin">Admin</option>
              <option value="staff">Staff</option>
            </FilterSelect>

            {/* Barangays come from the database (/api/facilities). */}
            <FilterSelect label="Barangay" value={filters.barangay} onChange={(v) => setFilter('barangay', v)} selectStyle={{ maxWidth: 170 }}>
              <option value="">All Barangays</option>
              <option value="city-wide">City-wide (admins)</option>
              <option value="unassigned">Unassigned staff</option>
              {barangays.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
            </FilterSelect>

            <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilter('status', v)}>
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="locked">Locked</option>
            </FilterSelect>

            <div className="flex items-center gap-3 ml-auto">
              <span className="text-[11px]" style={{ color: '#64748B' }}>
                {activeFilterCount > 0 ? `${filteredUsers.length} of ${users.length} users` : `${users.length} user${users.length === 1 ? '' : 's'}`}
              </span>
              <button
                onClick={() => setFilters(EMPTY_FILTERS)}
                disabled={activeFilterCount === 0}
                className="px-3 py-2 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s' }}
                onMouseEnter={e => { if (activeFilterCount > 0) e.currentTarget.style.background = '#E5E7EB'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B', border: '1px solid rgba(239,68,68,0.12)' }}>{error}</div>}
      {notice && (
        <div className="px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-3" style={{ background: '#F1F5F1', color: '#526A56', border: '1px solid #DCE6DC' }}>
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Dismiss" style={{ color: '#526A56' }}><i className="ri-close-line" /></button>
        </div>
      )}

      {/* ─── Create User panel ─── */}
      {showCreate && (
        <SidePanel
          title="Create User"
          subtitle="Add an authorized Pasig TB-IS account"
          onClose={closeCreate}
          onSubmit={(e) => {
            e.preventDefault();
            const msg = validateCreate();
            if (msg) { setFormError(msg); return; }
            setFormError('');
            setCreateConfirm({ ...form });
          }}
          footer={(
            <>
              <button type="button" onClick={closeCreate} className="px-4 py-2 text-xs font-medium" style={secondaryBtn}>Cancel</button>
              <button type="submit" disabled={creating} className="px-4 py-2 text-xs font-semibold disabled:opacity-50" style={primaryBtn}>{creating ? 'Creating…' : 'Create User'}</button>
            </>
          )}
          footerBottom
        >
          {formError && <div className="px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B', border: '1px solid rgba(239,68,68,0.12)' }}>{formError}</div>}
          <Field label="Full Name" required>
            <input type="text" autoFocus value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="e.g. Juan Dela Cruz" className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Username" required hint="Letters, numbers, dot, dash or underscore. Used to sign in.">
            <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="e.g. jdelacruz" className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Email" hint="Optional.">
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Role" required>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, barangay_id: e.target.value === 'admin' ? '' : form.barangay_id })} className={inputClass} style={inputStyle}>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          {form.role === 'staff' ? (
            <Field label="Assigned Barangay" required hint="Staff see records from this barangay only.">
              <select value={form.barangay_id} onChange={(e) => setForm({ ...form, barangay_id: e.target.value })} className={inputClass} style={inputStyle}>
                <option value="" disabled>Select barangay…</option>
                {barangays.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Access" hint="Admins are not assigned to a barangay.">
              <input type="text" value="City-wide (all barangays)" disabled className={inputClass} style={readOnlyStyle} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Temporary Password" hint="Shown once after creation; must be changed at first login.">
              <input type="text" value="Automatically generated" disabled className={inputClass} style={readOnlyStyle} />
            </Field>
            <Field label="Status">
              <input type="text" value="Active" disabled className={inputClass} style={readOnlyStyle} />
            </Field>
          </div>
        </SidePanel>
      )}

      {/* ─── Users table ─── */}
      <div style={cardStyle(t)} className="overflow-hidden">
        {users.length === 0 ? (
          <EmptyState icon="ri-team-line" title="No Users" description="Create your first user account." />
        ) : filteredUsers.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-semibold" style={{ color: '#0F2D52' }}>No users match these filters</p>
            <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>Try a different search, or clear the filters to see all {users.length} accounts.</p>
            <button onClick={() => setFilters(EMPTY_FILTERS)} className="mt-3 px-3 py-1.5 text-xs font-medium" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0F2D52' }}>
                  {['Name', 'Username', 'Email', 'Role', 'Assigned Barangay', 'Status', 'Last Login', 'Created By', ''].map((h, i) => (
                    <th key={h || i} className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: '#ffffff', borderBottom: '1px solid #1E40AF', borderRight: i === 8 ? 'none' : '1px solid #1E40AF' }}>
                      {h || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u, index) => {
                  const open = menu?.user.id === u.id;
                  return (
                    <tr key={u.id} className={`${index % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'} transition-colors hover:bg-blue-50`} style={{ borderBottom: '1px solid #E2E8F0' }}>
                      <td className="px-3 py-2.5 text-[11px] font-semibold whitespace-nowrap" style={{ color: '#0F2D52', borderRight: '1px solid #E2E8F0' }}>
                        <button type="button" onClick={() => setDetailUser(u)} className="text-left hover:underline">
                          {u.full_name || <span style={{ color: '#94A3B8', fontWeight: 400 }}>—</span>}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] whitespace-nowrap" style={{ color: '#475569', borderRight: '1px solid #E2E8F0' }}>
                        {u.username}{u.id === currentUserId && <span className="ml-1.5 text-[10px]" style={{ color: '#64748B' }}>(you)</span>}
                      </td>
                      <td className="max-w-[190px] truncate px-3 py-2.5 text-[11px]" style={{ color: '#475569', borderRight: '1px solid #E2E8F0' }} title={u.email || undefined}>{u.email || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderRight: '1px solid #E2E8F0' }}><StatusBadge status={u.role} /></td>
                      <td className="px-3 py-2.5 text-[11px] whitespace-nowrap" style={{ color: u.role === 'admin' ? '#2E6FAF' : '#475569', borderRight: '1px solid #E2E8F0' }}>{accessLabel(u)}</td>
                      <td className="px-3 py-2.5" style={{ borderRight: '1px solid #E2E8F0' }}>
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <StatusBadge status={u.status || 'active'} />
                          {isLocked(u) && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold" style={{ color: '#B45309' }} title={lockText(u)}>
                              <i className="ri-lock-line text-[12px]" />locked
                            </span>
                          )}
                          {u.must_change_password && (
                            <span className="text-[9px] font-semibold" style={{ color: '#B45309' }} title="Still using a temporary password">temp password</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] whitespace-nowrap" style={{ color: '#475569', borderRight: '1px solid #E2E8F0' }}>{formatDateTime(u.last_login_at, 'Never')}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderRight: '1px solid #E2E8F0' }}>
                        {u.created_by_name ? (
                          <span className="block text-[11px]" style={{ color: '#475569' }} title={`@${u.created_by_username}`}>{u.created_by_name}</span>
                        ) : (
                          <span className="block text-[11px]" style={{ color: '#64748B' }} title="Created before account creation was recorded">Not recorded</span>
                        )}
                        <span className="block text-[10px]" style={{ color: '#94A3B8' }}>
                          {u.created_at ? new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                        </span>
                      </td>
                      <td className="w-10 px-2 py-2.5 text-right">
                        <button
                          type="button"
                          aria-label={`Actions for ${u.username}`}
                          aria-haspopup="menu"
                          aria-expanded={open}
                          onClick={(e) => setMenu(open ? null : { user: u, anchor: e.currentTarget })}
                          className="w-7 h-7 inline-flex items-center justify-center rounded"
                          style={{ color: open ? '#0F2D52' : '#64748B', background: open ? '#EEF2F7' : 'transparent' }}
                          onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = '#F1F5F9'; }}
                          onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}
                        >
                          <i className="ri-more-2-fill text-base" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {menu && <RowMenu anchor={menu.anchor} items={menuItems(menu.user)} onClose={() => setMenu(null)} />}

      {/* ─── View details panel ─── */}
      {detailUser && (
        <SidePanel
          title={detailUser.full_name || detailUser.username}
          subtitle={`@${detailUser.username}`}
          onClose={() => setDetailUser(null)}
          footer={(
            <>
              <button type="button" onClick={() => openEdit(detailUser)} className="px-4 py-2 text-xs font-semibold" style={primaryBtn}>Edit user</button>
              <button type="button" onClick={() => setDetailUser(null)} className="px-4 py-2 text-xs font-medium" style={secondaryBtn}>Close</button>
            </>
          )}
        >
          <DetailSection title="Account">
            <DetailRow label="Full name">{detailUser.full_name || '—'}</DetailRow>
            <DetailRow label="Username">{detailUser.username}</DetailRow>
            <DetailRow label="Email">{detailUser.email || '—'}</DetailRow>
            <DetailRow label="Role"><StatusBadge status={detailUser.role} /></DetailRow>
            <DetailRow label="Status"><StatusBadge status={detailUser.status || 'active'} /></DetailRow>
          </DetailSection>
          <DetailSection title="Access">
            <DetailRow label="Assigned barangay">{accessLabel(detailUser)}</DetailRow>
            <DetailRow label="Sees">
              {detailUser.role === 'admin' ? 'TB records from all barangays' : `TB records from ${detailUser.barangay_name || 'no barangay yet'}`}
            </DetailRow>
          </DetailSection>
          <DetailSection title="Sign-in">
            <DetailRow label="Last login">{formatDateTime(detailUser.last_login_at, 'Never')}</DetailRow>
            <DetailRow label="Password">{detailUser.must_change_password ? 'Temporary — must change at next login' : 'Set by user'}</DetailRow>
            <DetailRow label="Lock">
              {isLocked(detailUser)
                ? <span style={{ color: '#B45309' }}>{lockText(detailUser)}</span>
                : 'Not locked'}
            </DetailRow>
            <DetailRow label="Failed attempts">{detailUser.failed_attempts ?? 0}</DetailRow>
          </DetailSection>
          <DetailSection title="Record">
            <DetailRow label="Created by">
              {detailUser.created_by_name
                ? <>{detailUser.created_by_name} <span style={{ color: '#94A3B8' }}>@{detailUser.created_by_username}</span></>
                : <span style={{ color: '#94A3B8' }}>Not recorded</span>}
            </DetailRow>
            <DetailRow label="Created">{formatDateTime(detailUser.created_at)}</DetailRow>
            <DetailRow label="Last updated">{formatDateTime(detailUser.updated_at)}</DetailRow>
          </DetailSection>
        </SidePanel>
      )}

      {/* ─── Edit user panel ─── */}
      {editUser && (
        <SidePanel
          title="Edit User"
          subtitle={`@${editUser.username}`}
          onClose={() => setEditUser(null)}
          onSubmit={handleEdit}
          footer={(
            <>
              <button type="submit" disabled={editSaving} className="px-4 py-2 text-xs font-semibold disabled:opacity-50" style={primaryBtn}>{editSaving ? 'Saving...' : 'Save Changes'}</button>
              <button type="button" onClick={() => setEditUser(null)} disabled={editSaving} className="px-4 py-2 text-xs font-medium disabled:opacity-50" style={secondaryBtn}>Cancel</button>
            </>
          )}
        >
          {editError && <div className="px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B', border: '1px solid rgba(239,68,68,0.12)' }}>{editError}</div>}
          <Field label="Full Name" required>
            <input type="text" value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Email" hint="Optional.">
            <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Role" required>
            <select
              value={editForm.role}
              disabled={editUser.id === currentUserId}
              onChange={(e) => {
                const role = e.target.value;
                // Back to the account's original staff role: restore its barangay.
                // Admin -> staff starts empty so the admin must pick one before saving.
                const barangay_id = role === 'staff' && editUser.role === 'staff' ? (editUser.barangay_id ?? '') : '';
                setEditForm({ ...editForm, role, barangay_id });
              }}
              className={inputClass}
              style={editUser.id === currentUserId ? readOnlyStyle : inputStyle}
            >
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          {editForm.role === 'staff' ? (
            <Field label="Assigned Barangay" required>
              <select value={String(editForm.barangay_id)} onChange={(e) => setEditForm({ ...editForm, barangay_id: e.target.value })} className={inputClass} style={inputStyle}>
                <option value="" disabled>Select barangay…</option>
                {barangays.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Access">
              <input type="text" value="City-wide (all barangays)" disabled className={inputClass} style={readOnlyStyle} />
            </Field>
          )}

          {roleChangedToAdmin && (
            <p className="text-[11px] leading-relaxed px-3 py-2 rounded" style={{ background: '#F8FAFC', color: '#475569', borderLeft: '3px solid #2E6FAF' }}>
              The barangay restriction will be removed. As an admin, this account will see TB records from all barangays.
            </p>
          )}
          {roleChangedToStaff && (
            <p className="text-[11px] leading-relaxed px-3 py-2 rounded" style={{ background: '#F8FAFC', color: '#475569', borderLeft: '3px solid #B45309' }}>
              Staff accounts are limited to one barangay. Select the assigned barangay before saving.
            </p>
          )}
          {barangayChanged && editForm.barangay_id !== '' && (
            <p className="text-[11px] leading-relaxed px-3 py-2 rounded" style={{ background: '#F8FAFC', color: '#475569', borderLeft: '3px solid #2E6FAF' }}>
              Access moves from <strong>{editUser.barangay_name || 'no barangay'}</strong> to <strong>{barangayLabel(editForm.barangay_id)}</strong>.
              Only this account&apos;s access changes — existing TB records are not modified.
            </p>
          )}
        </SidePanel>
      )}

      {/* ─── Confirmations ─── */}
      {createConfirm && (
        <ConfirmDialog
          title="Create this user?"
          confirmLabel="Create User"
          busyLabel="Creating..."
          busy={creating}
          onConfirm={handleCreate}
          onCancel={() => setCreateConfirm(null)}
        >
          <div className="bg-gray-50 rounded-lg p-3 space-y-1">
            <p><span className="text-gray-500">Full name:</span> <strong>{createConfirm.full_name}</strong></p>
            <p><span className="text-gray-500">Username:</span> <strong>{createConfirm.username}</strong></p>
            <p><span className="text-gray-500">Email:</span> <strong>{createConfirm.email || '—'}</strong></p>
            <p><span className="text-gray-500">Role:</span> <strong>{createConfirm.role}</strong></p>
            <p><span className="text-gray-500">Access:</span> <strong>{createConfirm.role === 'admin' ? CITY_WIDE : barangayLabel(createConfirm.barangay_id)}</strong></p>
          </div>
          <p className="text-[11px] text-gray-500">A temporary password will be generated. The user must change it at first login.</p>
        </ConfirmDialog>
      )}

      {confirm?.kind === 'reset' && (
        <ConfirmDialog title="Reset password?" confirmLabel="Reset Password" busyLabel="Resetting..." busy={busy} onConfirm={runConfirmed} onCancel={() => setConfirm(null)}>
          <p>A new temporary password will be generated for <strong>{confirm.user.username}</strong>. Their current password stops working, and they must set a new one at their next login.</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === 'deactivate' && (
        <ConfirmDialog title="Deactivate account?" confirmLabel="Deactivate" busyLabel="Deactivating..." busy={busy} danger onConfirm={runConfirmed} onCancel={() => setConfirm(null)}>
          <p><strong>{confirm.user.username}</strong> will no longer be able to sign in. Their records, imports and history stay as they are, and you can activate the account again later.</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === 'lock' && (
        <ConfirmDialog title="Lock account?" confirmLabel="Lock" busyLabel="Locking..." busy={busy} danger onConfirm={runConfirmed} onCancel={() => setConfirm(null)}>
          <p><strong>{confirm.user.username}</strong> will not be able to sign in until an administrator unlocks the account.</p>
          <p className="text-[11px] text-gray-500">Use this as a temporary hold, for example if you suspect the password is known to someone else. To retire an account, deactivate it instead.</p>
        </ConfirmDialog>
      )}

      {generatedPassword && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-bold text-gray-900 mb-1">{createdUser ? 'User created' : 'Password reset'}</h3>
            <p className="text-[11px] text-gray-500 mb-4">Copy this password now — it is not shown again.</p>
            <div className="bg-gray-50 rounded-lg p-3 mb-3">
              <p className="text-[10px] text-gray-500">Username</p>
              <p className="text-xs font-semibold">{passwordFor}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 mb-4">
              <p className="text-[10px] text-gray-500">Temporary Password</p>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 text-sm font-mono font-bold bg-white px-3 py-2 rounded border select-all">{generatedPassword}</code>
                <button onClick={() => copyToClipboard(generatedPassword)} aria-label="Copy password" className="px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50 rounded border"><i className="ri-file-copy-line" /></button>
              </div>
            </div>
            <p className="text-[10px] text-gray-500 mb-4">Give it to the user through a secure channel. They will be asked to change it at first login.</p>
            <button onClick={() => { setGeneratedPassword(null); setCreatedUser(null); }} className="w-full py-2.5 rounded-lg font-bold text-xs text-white bg-[#0F2D52]">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
