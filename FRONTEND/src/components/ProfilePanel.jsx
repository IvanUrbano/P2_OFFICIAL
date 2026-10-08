import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import { avatarColorForRole, initialsForUsername } from '../utils/userIdentity';
import ProfilePhotoPreview from './ProfilePhotoPreview';

function readStoredUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
}

export default function ProfilePanel({ systemName }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(readStoredUser);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [photoOpen, setPhotoOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const onProfileRefresh = (event) => { if (active) setUser(event.detail); };
    window.addEventListener('tbinsight-profile-refreshed', onProfileRefresh);
    API.get('/api/auth/profile')
      .then(({ data }) => { if (active) setUser(data.user); })
      .catch(() => { if (active) setError('Could not refresh your account details. Try reloading the page.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; window.removeEventListener('tbinsight-profile-refreshed', onProfileRefresh); };
  }, []);

  useEffect(() => { if (!user?.profile_photo_data) setPhotoOpen(false); }, [user?.profile_photo_data]);

  const name = user?.full_name?.trim() || user?.username || 'Your account';
  const email = user?.email?.trim();
  const role = user?.role?.toLowerCase() === 'admin' ? 'Admin' : 'Staff';
  const assignedBarangay = user?.barangay_name || user?.barangay?.name;
  const facility = user?.facility_name || user?.facility?.name;
  const scope = role === 'Admin' ? 'City-wide access' : assignedBarangay ? `Barangay ${assignedBarangay}` : facility || 'Assigned area unavailable';
  const fields = [['Username', user?.username || '—'], ['Email', email || 'Not added'], ['Role', role], ['Access scope', scope], ...(facility ? [['Facility', facility]] : [])];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 pb-6">
      <header className="rounded-lg border border-[#DCE4EC] bg-white px-5 py-4 sm:px-6">
        <h1 className="text-xl font-semibold text-[#0F2D52]">My Profile</h1>
        <p className="mt-1 text-sm text-[#64748B]">Your {systemName} account and profile photo.</p>
      </header>
      <section className="overflow-hidden rounded-lg border border-[#DCE4EC] bg-white" aria-label="Profile photo and identity">
        <div className="border-b border-[#E2E8F0] bg-[#0F2D52] px-5 py-3 sm:px-6"><h2 className="text-sm font-semibold text-white">Account identity</h2></div>
        <div className="flex flex-col gap-5 px-5 py-6 sm:flex-row sm:items-center sm:px-6">
          {user?.profile_photo_data ? (
            <button type="button" onClick={() => setPhotoOpen(true)} aria-label="View profile photo" title="View profile photo" className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-transparent text-2xl font-semibold text-white hover:border-[#0F5A9F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F5A9F]" style={{ background: avatarColorForRole(user?.role) }}>
              <img src={user.profile_photo_data} alt="" className="h-full w-full object-cover" />
            </button>
          ) : (
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full text-2xl font-semibold text-white" style={{ background: avatarColorForRole(user?.role) }}>{initialsForUsername(user?.username)}</div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-[#0F2D52]" title={name}>{name}</p>
            {email && <p className="mt-0.5 truncate text-sm text-[#64748B]" title={email}>{email}</p>}
            <p className="mt-1 text-sm text-[#475569]">{role} · {scope}</p>
            <p className="mt-3 text-xs text-[#64748B]">Profile photos are managed in Pasig TB-IS and appear here automatically.{user?.profile_photo_data ? ' Click the photo to view it.' : ''}</p>
          </div>
        </div>
        {error && <p role="alert" className="border-t border-[#E2E8F0] px-5 py-3 text-sm text-[#B91C1C] sm:px-6">{error}</p>}
      </section>
      <section className="overflow-hidden rounded-lg border border-[#DCE4EC] bg-white" aria-label="Account details">
        <div className="flex items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-4 sm:px-6">
          <div><h2 className="text-sm font-semibold text-[#0F2D52]">Account details</h2><p className="mt-0.5 text-xs text-[#64748B]">Your current account information and access.</p></div>
          <button type="button" onClick={() => navigate('/settings')} className="shrink-0 text-xs font-semibold text-[#0F5A9F] hover:underline">Account settings →</button>
        </div>
        {loading && !user ? <p className="px-5 py-6 text-sm text-[#64748B]">Loading account details…</p> : (
          <dl className="grid grid-cols-1 sm:grid-cols-2">
            {fields.map(([label, value]) => <div key={label} className="min-w-0 border-b border-[#EDF1F5] px-5 py-4 sm:px-6"><dt className="text-xs font-medium text-[#64748B]">{label}</dt><dd className="mt-1 break-words text-sm font-medium text-[#0F2D52]">{value}</dd></div>)}
          </dl>
        )}
      </section>
      {photoOpen && user?.profile_photo_data && <ProfilePhotoPreview photo={user.profile_photo_data} onClose={() => setPhotoOpen(false)} />}
    </div>
  );
}
