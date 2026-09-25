import { useState, useEffect } from 'react';
import API from '../api/axios';
import { useTheme } from '../theme';

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
    API.get('/api/auth/profile')
      .then(res => {
        const u = res.data.user;
        setProfile(u);
        setForm({ username: u.username, email: u.email });
      })
      .catch(err => {
        setProfileMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to load profile.' });
      });

    API.get('/api/health')
      .then(res => setSys({ ...res.data, version: '1.0.0' }))
      .catch(() => setSysError(true));
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
      try {
        const stored = JSON.parse(localStorage.getItem('user') || '{}');
        localStorage.setItem('user', JSON.stringify({ ...stored, ...res.data.user }));
      } catch { }
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
    if (pw.newPassword.length < 8) {
      setPwMsg({ kind: 'error', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (!/[A-Z]/.test(pw.newPassword)) {
      setPwMsg({ kind: 'error', text: 'Password must contain at least one uppercase letter.' });
      return;
    }
    if (!/[a-z]/.test(pw.newPassword)) {
      setPwMsg({ kind: 'error', text: 'Password must contain at least one lowercase letter.' });
      return;
    }
    if (!/[0-9]/.test(pw.newPassword)) {
      setPwMsg({ kind: 'error', text: 'Password must contain at least one number.' });
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

  const inputCls = "w-full rounded-lg px-3 py-2 text-[13px] outline-none";
  const inputStyle = { background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text };
  const labelCls = "block text-[11px] font-semibold mb-1";
  const labelStyle = { color: t.textSecondary };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* Profile */}
        <div className="rounded-xl p-5" style={{ background: t.cardSolid, border: `1px solid ${t.border}` }}>
          <h2 className="text-sm font-bold mb-4" style={{ color: t.text }}>Profile</h2>

          {profile ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: '#0F2D52', color: '#fff' }}>
                  {(profile.username || '?').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: t.text }}>{profile.username}</p>
                  <p className="text-xs" style={{ color: t.textSecondary }}>{profile.email}</p>
                </div>
              </div>

              <div>
                <label className={labelCls} style={labelStyle}>Username</label>
                <input
                  className={inputCls}
                  style={inputStyle}
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </div>

              <div>
                <label className={labelCls} style={labelStyle}>Email</label>
                <input
                  className={inputCls}
                  style={inputStyle}
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px]" style={{ color: t.textMuted }}>
                  {profile.role}
                  {profile.created_at && <> &middot; Joined {new Date(profile.created_at).toLocaleDateString()}</>}
                </span>
                <button
                  onClick={handleProfileSave}
                  disabled={savingProfile}
                  className="px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-50"
                  style={{ background: '#0F2D52', color: '#fff' }}
                >
                  {savingProfile ? 'Saving...' : 'Save'}
                </button>
              </div>

              {profileMsg && (
                <p className="text-xs font-medium" style={{ color: profileMsg.kind === 'error' ? '#991B1B' : '#047857' }}>
                  {profileMsg.text}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs" style={{ color: t.textMuted }}>Loading...</p>
          )}
        </div>

        {/* Security */}
        <div className="rounded-xl p-5" style={{ background: t.cardSolid, border: `1px solid ${t.border}` }}>
          <h2 className="text-sm font-bold mb-4" style={{ color: t.text }}>Security</h2>

          <div className="flex flex-col gap-3">
            <div>
              <label className={labelCls} style={labelStyle}>Current Password</label>
              <div className="relative">
                <input
                  className={inputCls}
                  style={inputStyle}
                  type={showPw ? 'text' : 'password'}
                  value={pw.currentPassword}
                  onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                  style={{ color: t.textMuted }}
                  onClick={() => setShowPw(!showPw)}
                >
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div>
              <label className={labelCls} style={labelStyle}>New Password</label>
              <input
                className={inputCls}
                style={inputStyle}
                type={showPw ? 'text' : 'password'}
                value={pw.newPassword}
                onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
              />
            </div>

            <div>
              <label className={labelCls} style={labelStyle}>Confirm New Password</label>
              <input
                className={inputCls}
                style={inputStyle}
                type={showPw ? 'text' : 'password'}
                value={pw.confirmPassword}
                onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })}
              />
            </div>

            <p className="text-[11px]" style={{ color: t.textMuted }}>
              Min 8 characters, 1 uppercase, 1 lowercase, 1 number.
            </p>

            <div className="flex items-center justify-between mt-1">
              <div>
                {pwMsg && (
                  <p className="text-xs font-medium" style={{ color: pwMsg.kind === 'error' ? '#991B1B' : '#047857' }}>
                    {pwMsg.text}
                  </p>
                )}
              </div>
              <button
                onClick={handlePasswordSave}
                disabled={savingPw}
                className="px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-50"
                style={{ background: '#0F2D52', color: '#fff' }}
              >
                {savingPw ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* System */}
      <div className="rounded-xl p-5" style={{ background: t.cardSolid, border: `1px solid ${t.border}` }}>
        <h2 className="text-sm font-bold mb-3" style={{ color: t.text }}>System</h2>

        {sysError ? (
          <p className="text-xs" style={{ color: '#991B1B' }}>Cannot reach the API server. Is the backend running?</p>
        ) : !sys ? (
          <p className="text-xs" style={{ color: t.textMuted }}>Loading...</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs" style={{ color: t.textSecondary }}>
            <div>
              <p style={{ color: t.textMuted }}>Status</p>
              <p className="font-semibold mt-0.5" style={{ color: sys.status === 'ok' ? '#047857' : '#92400E' }}>
                {sys.status === 'ok' ? 'Online' : 'Degraded'}
              </p>
            </div>
            <div>
              <p style={{ color: t.textMuted }}>Database</p>
              <p className="font-semibold mt-0.5" style={{ color: sys.database === 'connected' ? '#047857' : '#991B1B' }}>
                {sys.database === 'connected' ? 'Connected' : 'Disconnected'}
              </p>
            </div>
            <div>
              <p style={{ color: t.textMuted }}>Version</p>
              <p className="font-semibold mt-0.5">{sys.version || '\u2014'}</p>
            </div>
            <div>
              <p style={{ color: t.textMuted }}>Server Time</p>
              <p className="font-semibold mt-0.5">
                {sys.timestamp ? new Date(sys.timestamp).toLocaleTimeString() : '\u2014'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
