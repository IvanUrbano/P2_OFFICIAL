import { useState, useEffect } from 'react';

/* ─── Helper: relative time from offset minutes ─── */
function relativeTime(minutesAgo) {
  const d = new Date(Date.now() - minutesAgo * 60 * 1000);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  if (isToday) return `Today, ${time}`;
  if (isYesterday) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

/* ─── Activity log data with real-time relative dates ─── */
const ACTIVITY_LOG = [
  { action: 'Logged in', detail: 'Signed in from Chrome on Windows', offsetMin: 15, icon: 'ri-login-box-line', color: '#10B981' },
  { action: 'Generated report', detail: `Monthly TB Case Summary — ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`, offsetMin: 60, icon: 'ri-file-chart-line', color: '#2E6FAF' },
  { action: 'Updated alert', detail: 'Dismissed "Medicine Supply Low" alert', offsetMin: 60 * 16, icon: 'ri-alarm-warning-line', color: '#F59E0B' },
  { action: 'Viewed analytics', detail: 'Opened San Joaquin barangay analytics', offsetMin: 60 * 18, icon: 'ri-bar-chart-grouped-line', color: '#8B5CF6' },
  { action: 'Exported data', detail: 'Downloaded GIS hotspot report as CSV', offsetMin: 60 * 24 + 60, icon: 'ri-download-2-line', color: '#0066FF' },
  { action: 'Logged in', detail: 'Signed in from Chrome on Windows', offsetMin: 60 * 24 + 120, icon: 'ri-login-box-line', color: '#10B981' },
].map(item => ({ ...item, time: relativeTime(item.offsetMin) }));

/* ─── Modern input style helper ─── */
const inputStyle = {
  background: '#fff',
  border: '1.5px solid #e2e8f0',
  color: '#0f172a',
  borderRadius: '10px',
  fontSize: '13px',
  fontWeight: 500,
  transition: 'all 0.2s',
};

const inputFocusClass = 'focus:border-[#2E6FAF] focus:ring-2 focus:ring-[#2E6FAF]/10 focus:outline-none';

export default function MyProfile() {
  const [user, setUser] = useState(null);
  const [editing, setEditing] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');

  const [form, setForm] = useState({ name: '', email: '', position: '' });
  const [passwordForm, setPasswordForm] = useState({ current: '', newPass: '', confirm: '' });

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) {
      const u = JSON.parse(stored);
      setUser(u);
      setForm({
        name: u.name || u.username || 'User',
        email: u.email || '',
        position: u.position || 'Health Staff',
      });
    }
  }, []);

  if (!user) return null;

  const initials = user.username ? user.username.slice(0, 2).toUpperCase() : 'U';

  const handleSave = () => { setEditing(false); setSaved(true); setTimeout(() => setSaved(false), 2500); };
  const handlePasswordChange = () => { setShowPasswordModal(false); setPasswordForm({ current: '', newPass: '', confirm: '' }); setSaved(true); setTimeout(() => setSaved(false), 2500); };

  const TABS = [
    { key: 'profile', label: 'Personal Info', icon: 'ri-user-settings-line' },
    { key: 'security', label: 'Security', icon: 'ri-shield-keyhole-line' },
    { key: 'activity', label: 'Activity Log', icon: 'ri-history-line' },
  ];

  return (
    <div className="relative space-y-5">

      {/* ── Saved Toast ── */}
      {saved && (
        <div className="fixed top-20 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-bold text-white shadow-2xl animate-[slideUp_0.3s_ease]" style={{ background: 'linear-gradient(135deg, #10B981, #059669)' }}>
          <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center"><i className="ri-check-line text-xs" /></div>
          Changes saved successfully
        </div>
      )}

      {/* ── Profile Header ── */}
      <section className="rounded-3xl overflow-hidden bg-white shadow-sm" style={{ border: '1px solid rgba(148,163,184,0.12)' }}>
        {/* Banner */}
        <div className="h-32 relative" style={{ background: 'linear-gradient(135deg, #0F2D52 0%, #1e4d7b 100%)' }}>
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 70% 50%, rgba(79,209,197,0.18) 0%, transparent 65%)' }} />
        </div>

        {/* Info */}
        <div className="px-6 pb-6 relative">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-12">
            {/* Avatar */}
            <div className="relative shrink-0">
              <div
                className="w-24 h-24 rounded-full flex items-center justify-center text-2xl font-extrabold shadow-lg relative z-10"
                style={{ background: 'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)', color: '#fff', border: '4px solid #fff' }}
              >
                {initials}
              </div>
              {/* Online dot */}
              <div className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-white flex items-center justify-center z-20">
                <div className="w-3 h-3 rounded-full" style={{ background: '#10B981', boxShadow: '0 0 6px rgba(16,185,129,0.5)' }} />
              </div>
            </div>

            {/* Name + Meta */}
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-extrabold tracking-tight" style={{ color: '#0f172a' }}>{form.name}</h2>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
                  style={{
                    background: 'rgba(46,111,175,0.1)',
                    color: '#2E6FAF',
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#2E6FAF' }} />
                  {user.role}
                </span>
              </div>
              <p className="text-sm mt-1 font-medium" style={{ color: '#64748b' }}>{user.email || 'admin@pasigcity.gov.ph'}</p>
              <p className="text-xs mt-0.5 font-medium" style={{ color: '#94A3B8' }}>{form.position}</p>
            </div>

            {/* Action */}
            <div className="shrink-0">
              {!editing ? (
                <button
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold text-white transition-all hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
                  style={{ background: 'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)', boxShadow: '0 4px 14px rgba(15,45,82,0.25)' }}
                >
                  <i className="ri-edit-line text-sm" />
                  Edit Profile
                </button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={handleSave} className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold text-white transition-all hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]" style={{ background: 'linear-gradient(135deg, #10B981, #059669)', boxShadow: '0 4px 14px rgba(16,185,129,0.25)' }}>
                    <i className="ri-check-line text-sm" /> Save
                  </button>
                  <button onClick={() => setEditing(false)} className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold transition-all hover:bg-slate-100 active:scale-[0.98]" style={{ background: '#f1f5f9', color: '#475569' }}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Tabs ── */}
      <div className="flex gap-1 p-1 rounded-2xl w-fit" style={{ background: '#f1f5f9' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200"
            style={activeTab === tab.key ? { background: '#fff', color: '#0f172a', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' } : { color: '#94A3B8' }}
          >
            <i className={`${tab.icon} text-sm`} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Personal Info Tab ── */}
      {activeTab === 'profile' && (
        <section className="rounded-3xl p-6 bg-white shadow-sm" style={{ border: '1px solid rgba(148,163,184,0.12)' }}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(46,111,175,0.1)' }}>
              <i className="ri-user-settings-line text-base" style={{ color: '#2E6FAF' }} />
            </div>
            <span className="text-sm font-bold" style={{ color: '#0f172a' }}>Personal Information</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            {[
              { label: 'Full Name', key: 'name', placeholder: 'Enter full name', icon: 'ri-user-line' },
              { label: 'Email Address', key: 'email', placeholder: 'Enter email', type: 'email', icon: 'ri-mail-line' },
              { label: 'Position', key: 'position', placeholder: 'Enter position', icon: 'ri-briefcase-line' },
            ].map((field) => (
              <div key={field.key}>
                <label className="text-[11px] font-bold uppercase tracking-wider block mb-2" style={{ color: '#64748b' }}>{field.label}</label>
                {editing ? (
                  <div className="relative">
                    <i className={`${field.icon} absolute left-3 top-1/2 -translate-y-1/2 text-sm`} style={{ color: '#94A3B8' }} />
                    <input
                      type={field.type || 'text'}
                      value={form[field.key]}
                      onChange={(e) => setForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className={`w-full pl-9 pr-4 py-3 rounded-xl text-sm font-medium outline-none transition-all ${inputFocusClass}`}
                      style={inputStyle}
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: '#f8fafc', border: '1.5px solid #f1f5f9' }}>
                    <i className={`${field.icon} text-sm`} style={{ color: '#cbd5e1' }} />
                    <span className="text-sm font-medium" style={{ color: '#334155' }}>{form[field.key] || '—'}</span>
                  </div>
                )}
              </div>
            ))}

            {/* Read-only fields */}
            {[
              { label: 'Username', value: user.username, icon: 'ri-at-line' },
              { label: 'Role', value: user.role, icon: 'ri-shield-user-line' },
            ].map((field) => (
              <div key={field.label}>
                <label className="text-[11px] font-bold uppercase tracking-wider block mb-2" style={{ color: '#64748b' }}>{field.label}</label>
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: '#f8fafc', border: '1.5px solid #f1f5f9' }}>
                  <i className={`${field.icon} text-sm`} style={{ color: '#cbd5e1' }} />
                  <span className="text-sm font-medium" style={{ color: '#94A3B8' }}>{field.value}</span>
                  <i className="ri-lock-line text-xs ml-auto" style={{ color: '#cbd5e1' }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Security Tab ── */}
      {activeTab === 'security' && (
        <div className="space-y-5">
          {/* Password */}
          <section className="rounded-3xl p-6 bg-white shadow-sm" style={{ border: '1px solid rgba(148,163,184,0.12)' }}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(46,111,175,0.1)' }}>
                  <i className="ri-lock-password-line text-base" style={{ color: '#2E6FAF' }} />
                </div>
                <span className="text-sm font-bold" style={{ color: '#0f172a' }}>Password</span>
              </div>
              <button
                onClick={() => setShowPasswordModal(true)}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all hover:shadow-md active:scale-[0.98]"
                style={{ background: '#f1f5f9', color: '#475569' }}
              >
                <i className="ri-edit-line text-sm" />
                Change Password
              </button>
            </div>
            <div className="rounded-xl px-5 py-4 flex items-center gap-4" style={{ background: 'linear-gradient(135deg, #f0fdf4, #ecfdf5)', border: '1.5px solid #bbf7d0' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.15)' }}>
                <i className="ri-shield-check-line text-lg" style={{ color: '#10B981' }} />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: '#065f46' }}>Password is secure</p>
                <p className="text-xs mt-0.5" style={{ color: '#6b7280' }}>Last changed 30 days ago</p>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ── Activity Log Tab ── */}
      {activeTab === 'activity' && (
        <section className="rounded-3xl p-6 bg-white shadow-sm" style={{ border: '1px solid rgba(148,163,184,0.12)' }}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(46,111,175,0.1)' }}>
              <i className="ri-history-line text-base" style={{ color: '#2E6FAF' }} />
            </div>
            <span className="text-sm font-bold" style={{ color: '#0f172a' }}>Recent Activity</span>
          </div>

          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[15px] top-3 bottom-3 w-[2px] rounded-full" style={{ background: '#f1f5f9' }} />

            <div className="space-y-1">
              {ACTIVITY_LOG.map((entry, i) => (
                <div key={i} className="flex items-start gap-4 py-3 relative group">
                  {/* Timeline dot */}
                  <div
                    className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 relative z-10 transition-transform group-hover:scale-110"
                    style={{ background: `${entry.color}12`, border: `2px solid ${entry.color}25` }}
                  >
                    <i className={`${entry.icon} text-xs`} style={{ color: entry.color }} />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-sm font-bold" style={{ color: '#0f172a' }}>{entry.action}</p>
                    <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>{entry.detail}</p>
                  </div>
                  <span className="text-[11px] font-semibold shrink-0 pt-1" style={{ color: '#94A3B8' }}>{entry.time}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Change Password Modal ── */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-3xl overflow-hidden bg-white shadow-2xl" style={{ border: '1px solid rgba(148,163,184,0.12)' }}>
            {/* Modal Header */}
            <div className="px-6 pt-6 pb-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(46,111,175,0.1)' }}>
                    <i className="ri-lock-password-line text-lg" style={{ color: '#2E6FAF' }} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Security</p>
                    <h2 className="text-lg font-extrabold" style={{ color: '#0f172a' }}>Change Password</h2>
                  </div>
                </div>
                <button
                  onClick={() => { setShowPasswordModal(false); setPasswordForm({ current: '', newPass: '', confirm: '' }); }}
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:bg-slate-100 active:scale-95"
                  style={{ color: '#94A3B8' }}
                >
                  <i className="ri-close-line text-lg" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="px-6 pb-6 space-y-4">
              {[
                { label: 'Current Password', key: 'current', placeholder: 'Enter current password', icon: 'ri-lock-line' },
                { label: 'New Password', key: 'newPass', placeholder: 'Enter new password', icon: 'ri-lock-password-line' },
                { label: 'Confirm New Password', key: 'confirm', placeholder: 'Confirm new password', icon: 'ri-lock-password-line' },
              ].map((field) => (
                <div key={field.key}>
                  <label className="text-[11px] font-bold uppercase tracking-wider block mb-2" style={{ color: '#64748b' }}>{field.label}</label>
                  <div className="relative">
                    <i className={`${field.icon} absolute left-3.5 top-1/2 -translate-y-1/2 text-sm`} style={{ color: '#94A3B8' }} />
                    <input
                      type="password"
                      value={passwordForm[field.key]}
                      onChange={(e) => setPasswordForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className={`w-full pl-10 pr-4 py-3 rounded-xl text-sm font-medium outline-none transition-all ${inputFocusClass}`}
                      style={inputStyle}
                    />
                  </div>
                </div>
              ))}

              <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: 'linear-gradient(135deg, #eff6ff, #e0f2fe)', border: '1.5px solid #bae6fd' }}>
                <i className="ri-information-line text-sm shrink-0" style={{ color: '#0284C7' }} />
                <p className="text-[11px] leading-relaxed" style={{ color: '#0369A1' }}>
                  Must be 8+ characters with uppercase, lowercase, and a number.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handlePasswordChange}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl py-3 text-xs font-bold text-white transition-all hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
                  style={{ background: 'linear-gradient(135deg, #0F2D52, #2E6FAF)', boxShadow: '0 4px 14px rgba(15,45,82,0.25)' }}
                >
                  <i className="ri-lock-password-line text-sm" />
                  Update Password
                </button>
                <button
                  onClick={() => { setShowPasswordModal(false); setPasswordForm({ current: '', newPass: '', confirm: '' }); }}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl py-3 text-xs font-bold transition-all hover:bg-slate-50 active:scale-[0.98]"
                  style={{ background: '#f1f5f9', color: '#475569' }}
                >
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
