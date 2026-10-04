import { useState, useEffect, useCallback } from 'react';
import API from '../api/axios';
import EmptyState from './EmptyState';
import { can } from '../utils/permissions';
import { primaryBtn, secondaryBtn } from './SidePanel';

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const fullName = (r) => (r?.last_name || r?.first_name ? `${r.last_name || ''}, ${r.first_name || ''}` : '—');

const STATUS_STYLE = {
  pending: { bg: '#FEF3C7', color: '#92400E', label: 'Pending' },
  accepted: { bg: '#DCFCE7', color: '#166534', label: 'Accepted' },
  rejected: { bg: '#FEE2E2', color: '#991B1B', label: 'Rejected' },
  cancelled: { bg: '#F1F5F9', color: '#64748B', label: 'Cancelled' },
};
const FILTERS = [['pending', 'Pending'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled'], ['', 'All']];

/**
 * Incoming Referrals — cases other barangays referred to the user's barangay (every
 * referral, for admins). Accepting makes this barangay responsible for the case;
 * rejecting leaves it with the sender. A pending referral shows no patient name until
 * accepted. Every button mirrors a server permission (utils/permissions.js).
 * Outgoing referrals are followed up from the case itself (record drawer).
 */
export default function IncomingReferrals({ user, onOpenRecord, onCountChange }) {
  const [referrals, setReferrals] = useState([]);
  const [myBarangay, setMyBarangay] = useState(null);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const isAdmin = user?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/data/transfers?direction=incoming');
      const list = res.data.transfers || [];
      setReferrals(list);
      setMyBarangay(res.data.barangay || null);
      onCountChange?.(list.filter(t => can(t, 'accept')).length);
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Failed to load referrals.' });
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => { load(); }, [load]);

  const act = async (t, action) => {
    if (action === 'reject' && !window.confirm(`Reject this referral? ${t.from_barangay || 'The sending barangay'} stays responsible for the case.`)) return;
    if (action === 'cancel' && !window.confirm('Cancel this referral?')) return;
    setBusy(t.id);
    setNotice(null);
    try {
      const path = action === 'accept' ? `${t.id}/accept` : action === 'reject' ? `${t.id}/cancel?action=reject` : `${t.id}/cancel`;
      const res = await API.put(`/api/data/transfers/${path}`);
      setNotice({ type: 'success', text: res.data.message });
      load();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || `Failed to ${action}.` });
    } finally {
      setBusy(null);
    }
  };

  const counts = referrals.reduce((acc, t) => ({ ...acc, [t.status]: (acc[t.status] || 0) + 1 }), {});
  const visible = status ? referrals.filter(t => t.status === status) : referrals;

  if (loading) return <p className="text-xs text-center py-10" style={{ color: '#94A3B8' }}>Loading referrals…</p>;

  return (
    <div>
      <div className="px-5 pt-4 space-y-3">
        <p className="text-[11px]" style={{ color: '#64748B' }}>
          {isAdmin
            ? 'Referrals between all barangays. Accepting moves the case to the receiving barangay.'
            : myBarangay
              ? <>Cases referred to <b style={{ color: '#0F2D52' }}>{myBarangay}</b>. Accepting makes {myBarangay} responsible for the case; the patient&apos;s home barangay keeps view-only access.</>
              : 'Your account has no assigned barangay, so no referrals can be sent to you.'}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(([key, label]) => {
            const active = status === key;
            const n = key ? counts[key] || 0 : referrals.length;
            return (
              <button key={key || 'all'} onClick={() => setStatus(key)} className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
                style={active ? { background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52' } : { background: '#ffffff', color: '#475569', border: '1px solid #E2E8F0' }}>
                {label}<span className="ml-1 opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        {notice && (
          <div className="px-3 py-2 rounded-lg text-xs" style={{ background: notice.type === 'error' ? 'rgba(239,68,68,0.05)' : 'rgba(16,185,129,0.06)', color: notice.type === 'error' ? '#991B1B' : '#047857' }}>
            {notice.text}
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon="ri-inbox-line" title={status === 'pending' ? 'No Referrals Waiting' : 'No Referrals'}
          description={status === 'pending' ? 'Nothing has been referred to your barangay that needs a decision.' : 'No referrals match this filter.'} />
      ) : (
        <div className="overflow-x-auto mt-3">
          <table className="w-full">
            <thead>
              <tr style={{ background: '#FAFCFF', borderBottom: '1px solid #E2E8F0' }}>
                {['Case', 'Patient', 'From', isAdmin ? 'To' : null, 'Reason', 'Status', 'Sent', ''].filter(Boolean).map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: '#0F2D52' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(t => {
                const s = STATUS_STYLE[t.status] || STATUS_STYLE.cancelled;
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid #F1F5F9', background: can(t, 'accept') ? '#FFFDF5' : 'transparent' }}>
                    <td className="px-4 py-3 text-xs font-mono">
                      {can(t, 'viewCase') ? (
                        <button onClick={() => onOpenRecord?.(t.validated_case_id)} className="underline" style={{ color: '#0F2D52' }}>{t.case_no || `#${t.validated_case_id}`}</button>
                      ) : (
                        <span style={{ color: '#475569' }} title="Opens after your barangay accepts the referral">{t.case_no || `#${t.validated_case_id}`}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#0F2D52' }}>
                      {t.identity_hidden
                        ? <span className="italic" style={{ color: '#94A3B8' }}>Hidden until accepted</span>
                        : <span className="font-semibold">{fullName(t)}</span>}
                      <span className="block text-[10px]" style={{ color: '#94A3B8' }}>Lives in {t.barangay_name || '—'} · Dx {fmtDate(t.date_of_diagnosis)}</span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>
                      {t.from_barangay || '—'}
                      <span className="block text-[10px] capitalize" style={{ color: '#94A3B8' }}>{t.transfer_type}</span>
                    </td>
                    {isAdmin && <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{t.to_barangay || '—'}</td>}
                    <td className="px-4 py-3 text-xs max-w-[240px]" style={{ color: '#64748B' }}>
                      {t.reason || '—'}
                      {t.to_facility_name && <span className="block text-[10px]" style={{ color: '#94A3B8' }}>Seen at {t.to_facility_name}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" style={{ background: s.bg, color: s.color }}>{s.label}</span>
                      {t.reviewed_at && (
                        <span className="block text-[10px] mt-0.5" style={{ color: '#94A3B8' }}>{t.reviewed_by_username || '—'} · {fmtDate(t.reviewed_at)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: '#64748B' }}>
                      {fmtDate(t.initiated_at || t.created_at)}
                      <span className="block text-[10px]">{t.initiated_by_username || ''}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex gap-1 justify-end">
                        {can(t, 'accept') && <button disabled={busy === t.id} onClick={() => act(t, 'accept')} className="px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40" style={primaryBtn}>Accept</button>}
                        {can(t, 'reject') && <button disabled={busy === t.id} onClick={() => act(t, 'reject')} className="px-2.5 py-1 text-[11px] font-medium disabled:opacity-40" style={secondaryBtn}>Reject</button>}
                        {can(t, 'cancel') && <button disabled={busy === t.id} onClick={() => act(t, 'cancel')} className="px-2.5 py-1 text-[11px] font-medium disabled:opacity-40" style={secondaryBtn}>Cancel</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
