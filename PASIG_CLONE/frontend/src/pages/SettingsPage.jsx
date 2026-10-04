import { useState, useEffect } from 'react';
import API from '../api/axios';
import { useTheme } from '../theme';

const SETTINGS_TABS = [
  { key: 'general', label: 'General', desc: 'System information and account settings' },
  { key: 'security', label: 'Security', desc: 'Password and security settings' },
];

export default function SettingsPage() {
  const { t } = useTheme();
  const [activeTab, setActiveTab] = useState(
    ['general', 'security'].includes(new URLSearchParams(window.location.search).get('tab'))
      ? new URLSearchParams(window.location.search).get('tab') : 'general'
  );
  // Records PIN (unlocks patient names/birth dates in TB Records)
  const [hasPin, setHasPin] = useState(false);
  const [pinForm, setPinForm] = useState({ password: '', pin: '', confirm: '' });
  const [pinMsg, setPinMsg] = useState(null);
  const [savingPin, setSavingPin] = useState(false);
  useEffect(() => {
    API.get('/api/auth/pin/status').then(r => setHasPin(Boolean(r.data.hasPin))).catch(() => {});
  }, []);
  const handlePinSave = async () => {
    if (!/^\d{4,6}$/.test(pinForm.pin)) { setPinMsg({ kind: 'error', text: 'PIN must be 4 to 6 digits.' }); return; }
    if (pinForm.pin !== pinForm.confirm) { setPinMsg({ kind: 'error', text: 'PINs do not match.' }); return; }
    if (!pinForm.password) { setPinMsg({ kind: 'error', text: 'Enter your account password to confirm.' }); return; }
    setSavingPin(true);
    try {
      await API.post('/api/auth/pin', { password: pinForm.password, pin: pinForm.pin });
      setPinMsg({ kind: 'success', text: 'Records PIN saved. Use it in TB Records to show patient names.' });
      setPinForm({ password: '', pin: '', confirm: '' });
      setHasPin(true);
    } catch (err) {
      setPinMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to save PIN.' });
    } finally {
      setSavingPin(false);
    }
  };
  const [user, setUser] = useState(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    API.get('/api/auth/profile').then(res => setUser(res.data.user)).catch(() => {});
  }, []);

  const handlePasswordSave = async () => {
    if (!pw.currentPassword || !pw.newPassword) { setPwMsg({ kind: 'error', text: 'All fields are required.' }); return; }
    if (pw.newPassword.length < 8) { setPwMsg({ kind: 'error', text: 'Password must be at least 8 characters.' }); return; }
    if (pw.newPassword !== pw.confirmPassword) { setPwMsg({ kind: 'error', text: 'Passwords do not match.' }); return; }
    setSavingPw(true);
    try {
      await API.put('/api/auth/password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPwMsg({ kind: 'success', text: 'Password changed successfully.' });
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
      if (user?.must_change_password) {
        // First-login change done: reload so the layout lets the user through.
        window.location.assign('/dashboard');
      }
    } catch (err) {
      setPwMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to change password.' });
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Settings</h1>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>
            {SETTINGS_TABS.find(tab => tab.key === activeTab)?.desc}
          </p>
        </div>
        <div style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div className="flex gap-0 overflow-x-auto">
            {SETTINGS_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="relative px-6 py-3 text-left transition-colors whitespace-nowrap"
                style={{ background: 'transparent' }}
              >
                <p className="text-[13px] font-bold" style={{ color: activeTab === tab.key ? '#0F2D52' : '#94A3B8' }}>
                  {tab.label}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: activeTab === tab.key ? '#64748B' : '#CBD5E1' }}>
                  {tab.desc}
                </p>
                {activeTab === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeTab === 'general' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div style={cardStyle(t)} className="p-5">
            <h2 className="text-sm font-bold mb-4" style={{ color: t.text }}>System Information</h2>
            <div className="space-y-3">
              {[{ label: 'System Name', value: 'PASIG TB-IS' }, { label: 'Version', value: '1.0' }, { label: 'Integration', value: 'Connected to TBInsight' }].map((item) => (
                <div key={item.label} className="flex justify-between py-2" style={{ borderBottom: `1px solid ${t.border}` }}>
                  <span className="text-xs" style={{ color: t.textSecondary }}>{item.label}</span>
                  <span className="text-xs font-semibold" style={{ color: t.text }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={cardStyle(t)} className="p-5">
            <h2 className="text-sm font-bold mb-4" style={{ color: t.text }}>Account Settings</h2>
            {user && (
              <div className="space-y-3">
                {[{ label: 'Username', value: user.username }, { label: 'Email', value: user.email }, { label: 'Role', value: user.role }].map((item) => (
                  <div key={item.label} className="flex justify-between py-2" style={{ borderBottom: `1px solid ${t.border}` }}>
                    <span className="text-xs" style={{ color: t.textSecondary }}>{item.label}</span>
                    <span className="text-xs font-semibold" style={{ color: t.text }}>{item.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'security' && (
        <div style={cardStyle(t)} className="p-5 max-w-lg">
          <h2 className="text-sm font-bold mb-4" style={{ color: t.text }}>Change Password</h2>
          {user?.must_change_password && (
            <div className="mb-3 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(245,158,11,0.08)', color: '#92400E', border: '1px solid rgba(245,158,11,0.25)' }}>
              You are signed in with a temporary password. Enter it as your current password, then choose a new one to continue.
            </div>
          )}
          <div className="space-y-2">
            {[
              { key: 'currentPassword', label: 'Current Password', type: 'password' },
              { key: 'newPassword', label: 'New Password', type: 'password' },
              { key: 'confirmPassword', label: 'Confirm Password', type: 'password' },
            ].map((field) => (
              <input key={field.key} type={field.type} placeholder={field.label} value={pw[field.key]}
                onChange={(e) => setPw({ ...pw, [field.key]: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg outline-none" style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }} />
            ))}
          </div>
          {pwMsg && (
            <div className="mt-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: pwMsg.kind === 'error' ? 'rgba(239,68,68,0.05)' : 'rgba(16,185,129,0.05)', color: pwMsg.kind === 'error' ? '#991B1B' : '#047857' }}>
              {pwMsg.text}
            </div>
          )}
          <button onClick={handlePasswordSave} disabled={savingPw} className="mt-3 px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-50" style={{ background: '#0F2D52', color: '#ffffff' }}>
            {savingPw ? 'Updating...' : 'Update Password'}
          </button>

          <div className="mt-8 pt-5" style={{ borderTop: `1px solid ${t.border}` }}>
            <h2 className="text-sm font-bold" style={{ color: t.text }}>{hasPin ? 'Change Records PIN' : 'Set Up Records PIN'}</h2>
            <p className="text-[11px] mt-1 mb-3" style={{ color: '#64748B' }}>
              Patient names and birth dates stay hidden until you enter this PIN in TB Records. It unlocks them for 15 minutes; 5 wrong attempts block PIN entry for 15 minutes.
            </p>
            <div className="space-y-2">
              {[
                { key: 'pin', label: 'New PIN (4–6 digits)', numeric: true },
                { key: 'confirm', label: 'Confirm PIN', numeric: true },
                { key: 'password', label: 'Your account password', numeric: false },
              ].map((field) => (
                <input key={field.key} type="password" placeholder={field.label} value={pinForm[field.key]} autoComplete="off"
                  inputMode={field.numeric ? 'numeric' : undefined} maxLength={field.numeric ? 6 : undefined}
                  onChange={(e) => setPinForm({ ...pinForm, [field.key]: field.numeric ? e.target.value.replace(/\D/g, '') : e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg outline-none" style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }} />
              ))}
            </div>
            {pinMsg && (
              <div className="mt-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: pinMsg.kind === 'error' ? 'rgba(239,68,68,0.05)' : 'rgba(16,185,129,0.05)', color: pinMsg.kind === 'error' ? '#991B1B' : '#047857' }}>
                {pinMsg.text}
              </div>
            )}
            <button onClick={handlePinSave} disabled={savingPin} className="mt-3 px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-50" style={{ background: '#0F2D52', color: '#ffffff' }}>
              {savingPin ? 'Saving...' : hasPin ? 'Change PIN' : 'Save PIN'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const cardStyle = (t) => ({
  background: t.cardSolid,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});
