import { useState, useEffect } from 'react';
import API from '../api/axios';
import { useTheme } from '../theme';

const inputStyle = (t) => ({
  width: '100%',
  background: t.inputBg,
  border: `1px solid ${t.inputBorder}`,
  borderRadius: '8px',
  padding: '10px 12px',
  fontSize: '13px',
  color: t.text,
  outline: 'none',
});

const cardStyle = (t) => ({
  background: t.card,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});

const primaryBtnStyle = {
  background: '#2E6FAF',
  color: '#fff',
  borderRadius: '8px',
  padding: '9px 18px',
  fontSize: '13px',
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
};

function Message({ kind, text }) {
  if (!text) return null;
  const isError = kind === 'error';
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium"
      style={{
        background: isError ? 'rgba(239,68,68,0.07)' : 'rgba(16,185,129,0.08)',
         color: isError ? '#991B1B' : '#047857',
        border: `1px solid ${isError ? 'rgba(239,68,68,0.18)' : 'rgba(16,185,129,0.18)'}`,
      }}
    >
      <i className={isError ? 'ri-error-warning-line' : 'ri-checkbox-circle-line'} />
      <span>{text}</span>
    </div>
  );
}

function RoleBadge({ role }) {
  const isAdmin = role === 'admin';
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide"
      style={{
        background: isAdmin ? 'rgba(46,111,175,0.10)' : 'rgba(16,185,129,0.10)',
         color: isAdmin ? '#2E6FAF' : '#047857',
      }}
    >
      <i className={isAdmin ? 'ri-shield-star-line' : 'ri-user-star-line'} />
      {role}
    </span>
  );
}

export default function Settings() {
  const { t } = useTheme();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ username: '', email: '' });
  const [profileMsg, setProfileMsg] = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState(false);
  const [pwMsg, setPwMsg] = useState(null);
  const [savingPw, setSavingPw] = useState(false);

  const [sys, setSys] = useState(null);
  const [sysError, setSysError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get('/api/auth/profile');
        const u = res.data.user;
        setProfile(u);
        setForm({ username: u.username, email: u.email });
      } catch (err) {
        setProfileMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to load profile.' });
      }
    })();

    // System info — non-fatal if unreachable
    (async () => {
      try {
        const [health, root] = await Promise.all([
          API.get('/api/health'),
          API.get('/'),
        ]);
        setSys({ ...health.data, version: root.data.version });
      } catch {
        setSysError(true);
      }
    })();
  }, []);

  const handleProfileSave = async () => {
    if (!form.username.trim() || !form.email.trim()) {
      setProfileMsg({ kind: 'error', text: 'Username and email are required.' });
      return;
    }
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const res = await API.put('/api/auth/profile', {
        username: form.username.trim(),
        email: form.email.trim(),
      });
      setProfile(res.data.user);
      setProfileMsg({ kind: 'success', text: res.data.message });
      // Keep the topbar user pill in sync
      try {
        const stored = JSON.parse(localStorage.getItem('user') || '{}');
        localStorage.setItem('user', JSON.stringify({ ...stored, ...res.data.user }));
      } catch { /* ignore localStorage issues */ }
    } catch (err) {
      setProfileMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to update profile.' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSave = async () => {
    if (!pw.currentPassword || !pw.newPassword) {
      setPwMsg({ kind: 'error', text: 'All fields are required.' });
      return;
    }
    if (pw.newPassword.length < 6) {
      setPwMsg({ kind: 'error', text: 'New password must be at least 6 characters.' });
      return;
    }
    if (pw.newPassword !== pw.confirmPassword) {
      setPwMsg({ kind: 'error', text: 'New passwords do not match.' });
      return;
    }
    setSavingPw(true);
    setPwMsg(null);
    try {
      const res = await API.put('/api/auth/password', {
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
      });
      setPwMsg({ kind: 'success', text: res.data.message });
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setPwMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to change password.' });
    } finally {
      setSavingPw(false);
    }
  };

  const initials = (profile?.username || '?').slice(0, 2).toUpperCase();
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">

        {/* ─── Profile ─── */}
        <div style={cardStyle(t)} className="p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ background: 'rgba(46,111,175,0.10)' }}>
              <i className="ri-user-3-line" style={{ color: '#2E6FAF' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: t.text }}>Profile</h2>
              <p className="text-[11px]" style={{ color: t.textSecondary }}>Your account details</p>
            </div>
          </div>

          {profile ? (
            <div className="flex flex-col gap-4">
              {/* Identity row */}
              <div className="flex items-center gap-3 pb-4 border-b" style={{ borderColor: t.border }}>
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: 'linear-gradient(135deg, #2E6FAF, #4FD1C5)', color: '#fff' }}
                >
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold truncate" style={{ color: t.text }}>{profile.username}</span>
                    <RoleBadge role={profile.role} />
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: t.textSecondary }}>{profile.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-wide" style={{ color: t.textSecondary }}>Username</label>
                  <input
                    style={inputStyle(t)}
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-wide" style={{ color: t.textSecondary }}>Email</label>
                  <input
                    style={inputStyle(t)}
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[11px]" style={{ color: t.textMuted }}>
                  <i className="ri-calendar-line mr-1" />Member since {memberSince}
                </span>
                <button
                  style={{ ...primaryBtnStyle, opacity: savingProfile ? 0.6 : 1 }}
                  onClick={handleProfileSave}
                  disabled={savingProfile}
                >
                  {savingProfile ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-40">
              <i className="ri-loader-4-line animate-spin text-2xl" style={{ color: '#2E6FAF' }} />
            </div>
          )}
          <div className="mt-4"><Message kind={profileMsg?.kind} text={profileMsg?.text} /></div>
        </div>

        {/* ─── Security ─── */}
        <div style={cardStyle(t)} className="p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ background: 'rgba(46,111,175,0.10)' }}>
              <i className="ri-lock-2-line" style={{ color: '#2E6FAF' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: t.text }}>Security</h2>
              <p className="text-[11px]" style={{ color: t.textSecondary }}>Change your password</p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-wide" style={{ color: t.textSecondary }}>Current Password</label>
              <div className="relative">
                <input
                  style={inputStyle(t)}
                  type={showPw ? 'text' : 'password'}
                  value={pw.currentPassword}
                  onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
                />
                <i
                  className={`${showPw ? 'ri-eye-off-line' : 'ri-eye-line'} absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer`}
                  style={{ color: t.textMuted }}
                  onClick={() => setShowPw(!showPw)}
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-wide" style={{ color: t.textSecondary }}>New Password</label>
              <input
                style={inputStyle(t)}
                type={showPw ? 'text' : 'password'}
                value={pw.newPassword}
                onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-wide" style={{ color: t.textSecondary }}>Confirm New Password</label>
              <input
                style={inputStyle(t)}
                type={showPw ? 'text' : 'password'}
                value={pw.confirmPassword}
                onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })}
              />
            </div>
            <p className="text-[11px]" style={{ color: t.textMuted }}>Minimum 6 characters. You will need to log in again on your next visit if changed.</p>

            <div className="flex justify-end">
              <button
                style={{ ...primaryBtnStyle, opacity: savingPw ? 0.6 : 1 }}
                onClick={handlePasswordSave}
                disabled={savingPw}
              >
                {savingPw ? 'Updating…' : 'Update Password'}
              </button>
            </div>
          </div>
          <div className="mt-4"><Message kind={pwMsg?.kind} text={pwMsg?.text} /></div>
        </div>
      </div>

      {/* ─── System ─── */}
      <div style={cardStyle(t)} className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ background: 'rgba(46,111,175,0.10)' }}>
            <i className="ri-server-line" style={{ color: '#2E6FAF' }} />
          </div>
          <div>
            <h2 className="text-sm font-bold" style={{ color: t.text }}>System</h2>
            <p className="text-[11px]" style={{ color: t.textSecondary }}>Backend health and version</p>
          </div>
        </div>

        {sysError ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium"
             style={{ background: 'rgba(153,27,27,0.05)', color: '#991B1B', border: '1px solid rgba(153,27,27,0.12)' }}>
            <i className="ri-error-warning-line" />
            <span>Cannot reach the API server. Is the backend running?</span>
          </div>
        ) : !sys ? (
          <div className="flex items-center justify-center h-24">
            <i className="ri-loader-4-line animate-spin text-2xl" style={{ color: '#2E6FAF' }} />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                icon: 'ri-heart-pulse-line',
                label: 'API Status',
                value: sys.status === 'ok' ? 'Online' : 'Degraded',
                 color: sys.status === 'ok' ? '#047857' : '#92400E',
                bg: sys.status === 'ok' ? 'rgba(16,185,129,0.08)' : 'rgba(217,119,6,0.08)',
              },
              {
                icon: 'ri-database-2-line',
                label: 'Database',
                value: sys.database === 'connected' ? 'Connected' : 'Disconnected',
                 color: sys.database === 'connected' ? '#047857' : '#991B1B',
                bg: sys.database === 'connected' ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
              },
              { icon: 'ri-version-line', label: 'API Version', value: sys.version || '—', color: '#2E6FAF', bg: 'rgba(46,111,175,0.08)' },
              {
                icon: 'ri-time-line',
                label: 'Server Time',
                value: sys.timestamp ? new Date(sys.timestamp).toLocaleTimeString() : '—',
                color: '#475569',
                bg: 'rgba(71,85,105,0.08)',
              },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-3 rounded-xl p-3" style={{ background: s.bg }}>
                <i className={`${s.icon} text-lg shrink-0`} style={{ color: s.color }} />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: t.textMuted }}>{s.label}</p>
                  <p className="text-sm font-bold truncate" style={{ color: s.color }}>{s.value}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
