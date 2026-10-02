import { useState, useEffect, useCallback } from 'react';
import API from '../api/axios';
import StatusBadge from './StatusBadge';

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString() : '—');
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString() : '—');
const fullName = (r) => (r?.last_name || r?.first_name
  ? `${r.last_name || ''}, ${r.first_name || ''}${r.middle_name ? ` ${r.middle_name}` : ''}${r.suffix ? ` ${r.suffix}` : ''}`
  : '—');

const TRANSFER_STATUS_STYLE = {
  pending: { bg: '#FEF3C7', color: '#92400E' },
  accepted: { bg: '#DBEAFE', color: '#1E40AF' },
  completed: { bg: '#DCFCE7', color: '#166534' },
  cancelled: { bg: '#F1F5F9', color: '#64748B' },
};

function Field({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#94A3B8' }}>{label}</p>
      <p className="text-xs font-medium mt-0.5" style={{ color: '#0F2D52' }}>{value ?? '—'}</p>
    </div>
  );
}

export default function RecordDetailDrawer({ recordId, facilities, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ transfer_type: 'referral', to_facility_id: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await API.get(`/api/data/records/${recordId}`);
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load record.');
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => { load(); }, [load]);

  const r = data?.record;
  const transfers = data?.transfers || [];
  const hasOpenTransfer = transfers.some(t => t.status === 'pending' || t.status === 'accepted');

  const submit = async (e) => {
    e.preventDefault();
    if (!form.to_facility_id) { setMsg({ type: 'error', text: 'Choose the receiving facility.' }); return; }
    setSaving(true);
    setMsg(null);
    try {
      await API.post('/api/data/transfers', {
        validated_case_id: recordId,
        to_facility_id: Number(form.to_facility_id),
        transfer_type: form.transfer_type,
        notes: form.notes || null,
      });
      setMsg({ type: 'success', text: `${form.transfer_type === 'referral' ? 'Referral' : 'Transfer'} sent. The receiving facility needs to accept it.` });
      setShowForm(false);
      setForm({ transfer_type: 'referral', to_facility_id: '', notes: '' });
      load();
      onChanged?.();
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.error || 'Failed to send.' });
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52', borderRadius: 4 };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(15,23,42,0.3)' }} onClick={onClose}>
      <div className="w-full max-w-lg h-full overflow-y-auto" style={{ background: '#ffffff' }} onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4" style={{ background: '#0F2D52', color: '#ffffff' }}>
          <div>
            <h2 className="text-sm font-extrabold">{r ? fullName(r) : 'TB Record'}</h2>
            <p className="text-[11px] mt-0.5 opacity-70">{r ? `${r.patient_no || '—'} · ${r.case_no || '—'}` : 'Loading…'}</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white text-lg">✕</button>
        </div>

        {loading ? (
          <p className="text-xs text-center py-10" style={{ color: '#94A3B8' }}>Loading…</p>
        ) : error ? (
          <p className="text-xs text-center py-10" style={{ color: '#991B1B' }}>{error}</p>
        ) : (
          <div className="px-6 py-5 space-y-6">
            {msg && (
              <div className="px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: msg.type === 'error' ? '#FEF2F2' : '#DCFCE7', color: msg.type === 'error' ? '#991B1B' : '#166534' }}>
                {msg.text}
              </div>
            )}

            <section>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: '#64748B' }}>Patient</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Patient #" value={r.patient_no} />
                <Field label="Case ID" value={r.case_no} />
                <Field label="Date of birth" value={fmtDate(r.date_of_birth)} />
                <Field label="Age / Sex" value={`${r.age ?? '—'} / ${r.sex || '—'}`} />
                <Field label="Barangay" value={r.barangay_name} />
                <Field label="City" value={r.city} />
              </div>
            </section>

            <section>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: '#64748B' }}>TB Case</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date of diagnosis" value={fmtDate(r.date_of_diagnosis)} />
                <Field label="Treatment started" value={fmtDate(r.date_started_treatment)} />
                <Field label="Outcome" value={r.outcome_status ? <StatusBadge status={r.outcome_status} /> : '—'} />
                <Field label="Date of outcome" value={fmtDate(r.date_of_outcome)} />
                <Field label="Registration group" value={r.registration_group} />
                <Field label="Bacteriological status" value={r.bacteriological_status} />
                <Field label="Screening facility" value={r.screening_facility} />
                <Field label="Treatment facility" value={r.treatment_facility} />
                <Field label="Currently responsible facility" value={r.current_responsible_facility_name || 'Not set'} />
                <Field label="Source / ITIS ref." value={`${r.source_type || '—'}${r.itis_case_id ? ` · ${r.itis_case_id}` : ''}`} />
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Referral / transfer history</p>
                {!showForm && (
                  <button onClick={() => { setShowForm(true); setMsg(null); }} disabled={hasOpenTransfer}
                    title={hasOpenTransfer ? 'This case already has an open referral/transfer' : ''}
                    className="px-3 py-1.5 text-[11px] font-bold rounded-md disabled:opacity-40" style={{ background: '#0F2D52', color: '#ffffff' }}>
                    Refer / Transfer
                  </button>
                )}
              </div>

              {showForm && (
                <form onSubmit={submit} className="p-4 rounded-lg space-y-3 mb-4" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <div className="flex gap-4 text-xs" style={{ color: '#0F2D52' }}>
                    {[['referral', 'Referral'], ['transfer', 'Transfer']].map(([v, l]) => (
                      <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" checked={form.transfer_type === v} onChange={() => setForm(f => ({ ...f, transfer_type: v }))} /> {l}
                      </label>
                    ))}
                  </div>
                  <select value={form.to_facility_id} onChange={e => setForm(f => ({ ...f, to_facility_id: e.target.value }))}
                    className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                    <option value="">Receiving facility…</option>
                    {(facilities || []).map(fac => <option key={fac.id} value={fac.id}>{fac.name}{fac.barangay_name ? ` (${fac.barangay_name})` : ''}</option>)}
                  </select>
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                    placeholder="Notes (reason, instructions)…" className="w-full px-3 py-2 text-xs outline-none resize-none" style={inputStyle} />
                  <div className="flex gap-2">
                    <button type="submit" disabled={saving} className="px-4 py-2 text-xs font-bold rounded-md disabled:opacity-50" style={{ background: '#16A34A', color: '#ffffff' }}>
                      {saving ? 'Sending…' : 'Send'}
                    </button>
                    <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-xs font-bold rounded-md" style={{ border: '1px solid #CBD5E1', color: '#0F2D52', background: '#ffffff' }}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {transfers.length === 0 ? (
                <p className="text-xs" style={{ color: '#94A3B8' }}>No referrals or transfers yet.</p>
              ) : (
                <ol className="space-y-3">
                  {transfers.map(t => {
                    const s = TRANSFER_STATUS_STYLE[t.status] || TRANSFER_STATUS_STYLE.cancelled;
                    return (
                      <li key={t.id} className="p-3 rounded-lg text-xs" style={{ border: '1px solid #E2E8F0' }}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold capitalize" style={{ color: '#0F2D52' }}>{t.transfer_type}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" style={{ background: s.bg, color: s.color }}>{t.status}</span>
                        </div>
                        <p className="mt-1" style={{ color: '#475569' }}>{t.from_facility_name || 'Unassigned'} → <b>{t.to_facility_name || '—'}</b></p>
                        <p className="mt-1 text-[10px]" style={{ color: '#94A3B8' }}>
                          Sent {fmtDateTime(t.initiated_at || t.created_at)} by {t.initiated_by_username || '—'}
                          {t.accepted_at ? ` · Accepted ${fmtDateTime(t.accepted_at)} by ${t.accepted_by_username || '—'}` : ''}
                          {t.completed_at ? ` · Completed ${fmtDateTime(t.completed_at)}` : ''}
                        </p>
                        {t.notes && <p className="mt-1 italic" style={{ color: '#64748B' }}>“{t.notes}”</p>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
