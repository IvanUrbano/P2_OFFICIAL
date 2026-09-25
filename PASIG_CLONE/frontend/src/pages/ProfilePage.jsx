import { useState } from 'react';
import { useTheme } from '../theme';

export default function ProfilePage() {
  const { t } = useTheme();
  const [storedUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  });

  const userRole = storedUser?.role || 'staff';
  const displayName = storedUser?.username ?? 'User';
  const displayEmail = storedUser?.email ?? '';
  const displayPosition = storedUser?.position ?? 'System User';
  const initials = storedUser?.username
    ? storedUser.username.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U';

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      {/* Card Header */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>My Profile</h1>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>View your account information.</p>
        </div>
      </div>

      {/* Profile Header */}
      <div className="rounded-xl p-5" style={{ background: t.cardSolid, border: `1px solid ${t.border}` }}>
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shrink-0"
            style={{ background: '#0F2D52', color: '#ffffff' }}
          >
            {initials}
          </div>
          <div>
            <h2 className="text-base font-bold" style={{ color: t.text }}>{displayName}</h2>
            <p className="text-xs" style={{ color: t.textSecondary }}>{displayEmail}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{
                  background: userRole === 'admin' ? 'rgba(37,99,235,0.1)' : 'rgba(16,185,129,0.1)',
                  color: userRole === 'admin' ? '#2563EB' : '#10B981',
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: userRole === 'admin' ? '#2563EB' : '#10B981' }} />
                {userRole}
              </span>
              <span className="text-[11px]" style={{ color: t.textMuted }}>{displayPosition}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Account Details */}
      <div className="rounded-xl p-5" style={{ background: t.cardSolid, border: `1px solid ${t.border}` }}>
        <h3 className="text-sm font-bold mb-3" style={{ color: t.text }}>Account Details</h3>
        <div className="flex flex-col gap-3">
          {[
            { label: 'Username', value: displayName, icon: 'ri-user-3-line' },
            { label: 'Email', value: displayEmail, icon: 'ri-mail-line' },
            { label: 'Position', value: displayPosition, icon: 'ri-briefcase-line' },
            { label: 'Role', value: userRole, icon: 'ri-shield-user-line' },
          ].map((field) => (
            <div key={field.label} className="flex items-center gap-3 py-2" style={{ borderBottom: `1px solid ${t.border}` }}>
              <i className={`${field.icon} text-sm`} style={{ color: t.textMuted }} />
              <div className="flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: t.textMuted }}>{field.label}</p>
                <p className="text-xs font-semibold mt-0.5" style={{ color: t.text }}>{field.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
