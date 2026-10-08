import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import { avatarColorForRole, initialsForUsername } from '../utils/userIdentity';
import ProfilePhotoPreview from './ProfilePhotoPreview';

function preparePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return Promise.reject(new Error('Choose a JPEG, PNG, or WebP image.'));
  if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error('Choose an image smaller than 5 MB.'));
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Your browser could not process this image.');
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        if (!side) throw new Error('The selected image is empty.');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, 256, 256);
        context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
        const photo = canvas.toDataURL('image/jpeg', 0.85);
        if (photo.length > 400000) throw new Error('The processed image is too large. Choose another photo.');
        resolve(photo);
      } catch (error) { reject(error); }
      finally { URL.revokeObjectURL(objectUrl); }
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('The selected image could not be opened.')); };
    image.src = objectUrl;
  });
}

function readStoredUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
}

export default function ProfilePanel({ systemName }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [user, setUser] = useState(readStoredUser);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [photoOpen, setPhotoOpen] = useState(false);

  useEffect(() => {
    let active = true;
    API.get('/api/auth/profile')
      .then(({ data }) => { if (active) setUser(data.user); })
      .catch(() => { if (active) setError('Could not refresh your account details. Try reloading the page.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => { if (!user?.profile_photo_data) setPhotoOpen(false); }, [user?.profile_photo_data]);

  const announcePhoto = (photo) => {
    setUser((current) => ({ ...current, profile_photo_data: photo }));
    window.dispatchEvent(new CustomEvent('profile-photo-updated', { detail: { photo } }));
  };

  const uploadPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(''); setMessage(''); setSaving(true);
    try {
      const photo = await preparePhoto(file);
      const { data } = await API.put('/api/auth/profile/photo', { photo });
      announcePhoto(data.profile_photo_data);
      setMessage('Profile photo updated.');
    } catch (err) { setError(err.response?.data?.error || err.message || 'Could not upload the photo.'); }
    finally { setSaving(false); }
  };

  const removePhoto = async () => {
    setError(''); setMessage(''); setSaving(true);
    try {
      await API.delete('/api/auth/profile/photo');
      announcePhoto(null);
      setMessage('Profile photo removed.');
    } catch (err) { setError(err.response?.data?.error || 'Could not remove the photo.'); }
    finally { setSaving(false); }
  };

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
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Choose profile photo" onChange={uploadPhoto} disabled={saving} />
              <button type="button" onClick={() => inputRef.current?.click()} disabled={saving} className="rounded border border-[#0F2D52] bg-[#0F2D52] px-3 py-2 text-xs font-semibold text-white hover:bg-[#173E6D] disabled:opacity-50">{saving ? 'Saving…' : user?.profile_photo_data ? 'Change photo' : 'Upload photo'}</button>
              {user?.profile_photo_data && <button type="button" onClick={removePhoto} disabled={saving} className="rounded border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] disabled:opacity-50">Remove photo</button>}
            </div>
            <p className="mt-2 text-xs text-[#64748B]">JPEG, PNG or WebP, up to 5 MB. The image is cropped to a square.{user?.profile_photo_data ? ' Click the photo to view it.' : ''}</p>
          </div>
        </div>
        {(error || message) && <p role={error ? 'alert' : 'status'} className={`border-t border-[#E2E8F0] px-5 py-3 text-sm sm:px-6 ${error ? 'text-[#B91C1C]' : 'text-[#047857]'}`}>{error || message}</p>}
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
