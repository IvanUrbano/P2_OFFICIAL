import { useState, useEffect } from 'react';
import API from '../api/axios';
import { useTheme } from '../theme';

const cardStyle = (t) => ({
  background: t.cardSolid,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});

export default function SettingsPage() {
  const { t } = useTheme();
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
    } catch (err) {
      setPwMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to change password.' });
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-extrabold" style={{ color: t.text }}>Settings</h1>
        <p className="text-sm mt-1" style={{ color: t.textSecondary }}>System information and account settings.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Info */}
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

        {/* Account */}
        <div style={cardStyle(t)} className="p-5">
          <h2 className="text-sm font-bold mb-4" style={{ color: t.text }}>Account Settings</h2>
          {user && (
            <div className="space-y-3 mb-6">
              {[{ label: 'Username', value: user.username }, { label: 'Email', value: user.email }, { label: 'Role', value: user.role }].map((item) => (
                <div key={item.label} className="flex justify-between py-2" style={{ borderBottom: `1px solid ${t.border}` }}>
                  <span className="text-xs" style={{ color: t.textSecondary }}>{item.label}</span>
                  <span className="text-xs font-semibold" style={{ color: t.text }}>{item.value}</span>
                </div>
              ))}
            </div>
          )}

          <h3 className="text-xs font-bold mb-3" style={{ color: t.text }}>Change Password</h3>
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
        </div>
      </div>
    </div>
  );
}
