import { useState } from 'react';

/**
 * Profile page — displays and allows editing of user profile information.
 */
export default function Profile() {
  const [storedUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  });

  const userRole = storedUser?.role || 'Admin';
  const displayName = storedUser?.username ?? 'System Admin';
  const displayEmail = storedUser?.email ?? 'admin@pasigcity.gov.ph';
  const displayPosition = storedUser?.position ?? 'System Administrator';
  const facility = storedUser?.facility
    ? storedUser.facility.name + (storedUser.facility.barangay_name ? ` (${storedUser.facility.barangay_name})` : '')
    : null;
  const initials = storedUser?.username
    ? storedUser.username.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'AD';

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      {/* Profile Header */}
      <div
        className="rounded-2xl p-6"
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px rgba(15, 45, 82, 0.06)',
        }}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold shrink-0"
            style={{ background: '#0F2D52', color: '#ffffff', border: '3px solid #0066FF' }}
          >
            {initials}
          </div>
          <div>
            <h2 className="text-lg font-bold" style={{ color: '#0F2D52' }}>{displayName}</h2>
            <p className="text-sm" style={{ color: '#94A3B8' }}>{displayEmail}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                style={{
                  background: userRole === 'Admin' ? 'rgba(0,102,255,0.1)' : 'rgba(0,216,246,0.15)',
                  color: userRole === 'Admin' ? '#0066FF' : '#00A9D8',
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: userRole === 'Admin' ? '#0066FF' : '#00A9D8' }} />
                {userRole}
              </span>
              <span className="text-xs" style={{ color: '#94A3B8' }}>{displayPosition}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Profile Details */}
      <div
        className="rounded-2xl p-6"
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px rgba(15, 45, 82, 0.06)',
        }}
      >
        <h3 className="text-sm font-bold mb-4" style={{ color: '#0F2D52' }}>Account Details</h3>
        <div className="flex flex-col gap-4">
          {[
            { label: 'Username', value: displayName, icon: 'ri-user-3-line' },
            { label: 'Email', value: displayEmail, icon: 'ri-mail-line' },
            { label: 'Position', value: displayPosition, icon: 'ri-briefcase-line' },
            { label: 'Role', value: userRole, icon: 'ri-shield-user-line' },
            { label: 'Facility', value: facility ?? '—', icon: 'ri-hospital-line' },
          ].map((field) => (
            <div key={field.label} className="flex items-center gap-3 py-2" style={{ borderBottom: '1px solid #f1f5f9' }}>
              <i className={`${field.icon} text-base`} style={{ color: '#94A3B8' }} />
              <div className="flex-1">
                <p className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>{field.label}</p>
                <p className="text-sm font-semibold" style={{ color: '#0F2D52' }}>{field.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
