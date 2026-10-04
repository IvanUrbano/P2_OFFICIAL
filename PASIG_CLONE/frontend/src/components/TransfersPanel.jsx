import { useState, useEffect, useCallback } from 'react';
import API from '../api/axios';
import EmptyState from './EmptyState';

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString() : '—');
const fullName = (r) => (r?.last_name || r?.first_name ? `${r.last_name || ''}, ${r.first_name || ''}` : '—');

const STATUS_STYLE = {
  pending: { bg: '#FEF3C7', color: '#92400E' },
  accepted: { bg: '#DBEAFE', color: '#1E40AF' },
  completed: { bg: '#DCFCE7', color: '#166534' },
  cancelled: { bg: '#F1F5F9', color: '#64748B' },
};

/**
 * Referrals/transfers involving the user's facility (all of them for admins).
 * The receiving facility accepts, then completes; the sender (or an admin) can cancel.
 * Permissions are enforced by the server — buttons here only mirror them.
 */
export default function TransfersPanel({ user, onOpenRecord, onCountChange }) {
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const isAdmin = user?.role === 'admin';
  const myFacility = user?.facility_id ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/data/transfers');
      const list = res.data.transfers || [];
      setTransfers(list);
      onCountChange?.(list.filter(t => t.status === 'pending' && (isAdmin || t.to_facility_id === myFacility)).length);
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Failed to load transfers.' });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, myFacility, onCountChange]);

  useEffect(() => { load(); }, [load]);

  const act = async (t, action) => {
    if (action === 'cancel' && !window.confirm('Cancel this referral/transfer?')) return;
    setBusy(t.id);
    setNotice(null);
    try {
      const res = await API.put(`/api/data/transfers/${t.id}/${action}`);
      setNotice({ type: 'success', text: res.data.message });
      load();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || `Failed to ${action}.` });
    } finally {
      setBusy(null);
    }
  };

  const isReceiver = (t) => isAdmin || (myFacility != null && t.to_facility_id === myFacility);
  const isSender = (t) => isAdmin || t.initiated_by_user_id === user?.id;

  if (loading) return <p className="text-xs text-center py-10" style={{ color: '#94A3B8' }}>Loading transfers…</p>;

  return (
    <div>
      {notice && (
        <div className="mx-4 mt-4 px-4 py-2 rounded-lg text-xs font-semibold" style={{ background: notice.type === 'error' ? '#FEF2F2' : '#DCFCE7', color: notice.type === 'error' ? '#991B1B' : '#166534' }}>
          {notice.text}
        </div>
      )}
      {transfers.length === 0 ? (
        <EmptyState icon="ri-arrow-left-right-line" title="No Referrals or Transfers" description="Open a record and use Refer / Transfer to send a patient to another facility." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: '#FAFCFF', borderBottom: '1px solid #E2E8F0' }}>
                {['Case', 'Patient', 'Type', 'From → To', 'Status', 'Sent', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: '#0F2D52' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transfers.map(t => {
                const s = STATUS_STYLE[t.status] || STATUS_STYLE.cancelled;
                const incoming = myFacility != null && t.to_facility_id === myFacility;
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td className="px-4 py-3 text-xs font-mono">
                      <button onClick={() => onOpenRecord?.(t.validated_case_id)} className="underline" style={{ color: '#0F2D52' }}>{t.case_no || `#${t.validated_case_id}`}</button>
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold" style={{ color: '#0F2D52' }}>{fullName(t)}</td>
                    <td className="px-4 py-3 text-xs capitalize" style={{ color: '#475569' }}>
                      {t.transfer_type}{!isAdmin && <span className="ml-1 text-[10px]" style={{ color: '#94A3B8' }}>({incoming ? 'incoming' : 'outgoing'})</span>}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{t.from_facility_name || 'Unassigned'} → <b>{t.to_facility_name || '—'}</b></td>
                    <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" style={{ background: s.bg, color: s.color }}>{t.status}</span></td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: '#64748B' }}>{fmtDate(t.initiated_at || t.created_at)}<br /><span className="text-[10px]">{t.initiated_by_username || ''}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {t.status === 'pending' && isReceiver(t) && (
                          <button disabled={busy === t.id} onClick={() => act(t, 'accept')} className="px-2 py-1 text-[11px] font-bold rounded disabled:opacity-40" style={{ background: '#0F2D52', color: '#fff' }}>Accept</button>
                        )}
                        {t.status === 'accepted' && isReceiver(t) && (
                          <button disabled={busy === t.id} onClick={() => act(t, 'complete')} className="px-2 py-1 text-[11px] font-bold rounded disabled:opacity-40" style={{ background: '#16A34A', color: '#fff' }}>Complete</button>
                        )}
                        {['pending', 'accepted'].includes(t.status) && isSender(t) && (
                          <button disabled={busy === t.id} onClick={() => act(t, 'cancel')} className="px-2 py-1 text-[11px] font-bold rounded disabled:opacity-40" style={{ border: '1px solid #CBD5E1', color: '#0F2D52' }}>Cancel</button>
                        )}
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
