import { useState, useEffect, useCallback } from 'react';
import API from '../api/axios';
import StatusBadge from './StatusBadge';
import { can, accessBasis } from '../utils/permissions';
import CaseEditForm from './CaseEditForm';
import { patientName } from '../utils/patientName';
import { useConfirmDialog } from './ConfirmDialog';
import { caseIdLabel } from '../utils/caseId';
import ModalCloseButton from './ModalCloseButton';

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString() : '—');
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString() : '—');
const fullName = (r) => patientName(r);

const TRANSFER_STATUS_STYLE = {
  pending: { bg: '#FEF3C7', color: '#92400E' },
  accepted: { bg: '#DCFCE7', color: '#166534' },
  rejected: { bg: '#FEE2E2', color: '#991B1B' },
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

function FormSelect({ children, className, style, ...props }) {
  return (
    <div className="relative">
      <select {...props} className={`${className} appearance-none`} style={{ ...style, paddingRight: '2.5rem' }}>
        {children}
      </select>
      <i aria-hidden="true" className="ri-arrow-down-s-line absolute right-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: '#64748B' }} />
    </div>
  );
}

// Why the user can see this record (permissions.basis, decided by the server).
const ACCESS_NOTE = {
  referred_in: { color: '#1E40AF', bg: '#EFF6FF', text: (r) => `Referred to your barangay from ${r.barangay_name || 'another barangay'}. You can view and update it.` },
  referred_out: { color: '#92400E', bg: '#FFFBEB', text: (r) => `This patient lives in your barangay but was referred to ${r.responsible_barangay_effective}. View only — ${r.responsible_barangay_effective} now handles the case.` },
};

const transferRoute = (t) => `${t.from_barangay || t.from_facility_name || 'Unassigned'} → `;
const transferTarget = (t) => t.to_barangay || t.to_facility_name || '—';

const RECORD_TABS = [['overview', 'Overview'], ['history', 'Case History'], ['referrals', 'Referrals']];

// One history entry (case_history + case_review_history) → a line staff can read.
function describeEntry(h) {
  const f = h.changed_fields || {};
  if (h.kind === 'change') {
    if (h.change_type === 'transferred' && f.responsible_barangay) {
      return { title: 'Responsibility Changed', detail: `${f.responsible_barangay.old ?? '—'} → ${f.responsible_barangay.new ?? '—'}` };
    }
    if (h.change_type === 'status_changed' && f.outcome_status) {
      return { title: 'Outcome Changed', detail: `${f.outcome_status.old ?? 'unset'} → ${f.outcome_status.new ?? 'unset'}` };
    }
    if (h.change_type === 'created') return { title: 'Record Created', detail: h.notes || '' };
    return { title: String(h.change_type || 'change').replace(/_/g, ' '), detail: h.notes || '' };
  }
  if (h.type === 'transfer') {
    const titles = { sent: 'Referral Sent', accepted: 'Referral Accepted', rejected: 'Referral Rejected', cancelled: 'Referral Cancelled' };
    return { title: titles[h.decision] || 'Referral Updated', detail: h.notes || '' };
  }
  const statusMove = h.previous_status && h.new_status ? `${h.previous_status} → ${h.new_status}` : (h.new_status || '');
  return {
    title: `${String(h.type || 'review').replace(/_/g, ' ')} review${h.decision ? `: ${h.decision}` : ''}`,
    detail: [statusMove, h.notes].filter(Boolean).join(' · '),
  };
}

// initialMode: 'view' (default) | 'edit' (opens the edit form) | 'refer' (opens the referral form)
export default function RecordDetailDrawer({ recordId, facilities, barangays, onClose, onChanged, initialMode = 'view' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(initialMode === 'refer');
  const [tab, setTab] = useState(initialMode === 'refer' ? 'referrals' : 'overview');
  const [editing, setEditing] = useState(initialMode === 'edit');
  const [form, setForm] = useState({ to_barangay_id: '', to_facility_id: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const { confirm, confirmDialog } = useConfirmDialog();

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
  useEffect(() => {
    if (data && editing && !can(data, 'edit')) setEditing(false);
    if (data && showForm && !can(data, 'refer')) setShowForm(false);
  }, [data, editing, showForm]);

  const r = data?.record;
  const transfers = data?.transfers || [];
  const history = data?.history || [];
  const basis = accessBasis(data);
  const hasPendingTransfer = transfers.some(t => t.status === 'pending');
  const barangayOptions = (barangays || []).filter(b => b?.id != null);
  const selectedBarangay = barangayOptions.find(b => Number(b.id) === Number(form.to_barangay_id));
  const responsibleId = r?.responsible_barangay_id ?? r?.barangay_id;
  const facilitiesInTarget = (facilities || []).filter(f => form.to_barangay_id && Number(f.barangay_id) === Number(form.to_barangay_id));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.to_barangay_id) { setMsg({ type: 'error', text: 'Choose the receiving barangay.' }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const res = await API.post('/api/data/transfers', {
        validated_case_id: recordId,
        to_barangay_id: Number(form.to_barangay_id),
        to_facility_id: form.to_facility_id ? Number(form.to_facility_id) : null,
        transfer_type: 'referral',
        reason: form.notes || null,
      });
      setMsg({ type: 'success', text: res.data?.message || 'Sent. The receiving barangay needs to accept it.' });
      setShowForm(false);
      setForm({ to_barangay_id: '', to_facility_id: '', notes: '' });
      load();
      onChanged?.();
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.error || 'Failed to send.' });
    } finally {
      setSaving(false);
    }
  };

  const referralAction = async (t, action) => {
    if (action !== 'accept' && !(await confirm({
      title: action === 'reject' ? 'Reject referral?' : 'Cancel referral?',
      message: action === 'reject'
        ? 'The sending barangay will remain responsible for the case.'
        : 'The receiving barangay will no longer be asked to review this referral.',
      confirmLabel: action === 'reject' ? 'Reject referral' : 'Cancel referral',
      variant: 'danger',
    }))) return;
    setSaving(true);
    setMsg(null);
    try {
      const path = action === 'accept' ? `${t.id}/accept` : action === 'reject' ? `${t.id}/cancel?action=reject` : `${t.id}/cancel`;
      const res = await API.put(`/api/data/transfers/${path}`);
      setMsg({ type: 'success', text: res.data.message });
      load();
      onChanged?.();
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.error || `Failed to ${action}.` });
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52', borderRadius: 4 };

  return (
    <>
    {confirmDialog}
    <div className="fixed inset-0 z-[1200] flex justify-end" style={{ background: 'rgba(15,23,42,0.3)' }} onClick={onClose}>
      <div className="w-full max-w-lg h-full flex flex-col overflow-hidden" style={{ background: '#ffffff' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ background: '#0F2D52', color: '#ffffff' }}>
          <div>
            <h2 className="text-sm font-extrabold">{r ? fullName(r) : 'TB Record'}</h2>
            <p className="text-[11px] mt-0.5 opacity-70">{r ? caseIdLabel(r) : 'Loading…'}</p>
          </div>
          <ModalCloseButton onClick={onClose} light />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
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
            {ACCESS_NOTE[basis] && (
              <p className="px-3 py-2 rounded text-[11px] leading-relaxed" style={{ background: ACCESS_NOTE[basis].bg, color: ACCESS_NOTE[basis].color, borderLeft: `3px solid ${ACCESS_NOTE[basis].color}` }}>
                {ACCESS_NOTE[basis].text(r)}
              </p>
            )}

            <div className="flex gap-1 border-b" style={{ borderColor: '#E2E8F0' }}>
              {RECORD_TABS.map(([key, label]) => (
                <button key={key} onClick={() => { setTab(key); setMsg(null); }} className="relative -mb-px px-3 py-2 text-[11px] font-bold"
                  style={{ color: tab === key ? '#0F2D52' : '#94A3B8' }}>
                  {label}
                  {tab === key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0F2D52]" aria-hidden="true" />}
                </button>
              ))}
            </div>

            {tab === 'overview' && editing && (
              <CaseEditForm
                record={r}
                identityUnlocked={Boolean(data?.identityEditable)}
                deidentified={Boolean(r?.identity_deidentified)}
                facilities={facilities}
                onCancel={() => setEditing(false)}
                onSaved={(text) => { setEditing(false); setMsg({ type: 'success', text }); load(); onChanged?.(); }}
              />
            )}

            {tab === 'overview' && !editing && (
              <>
            <section>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: '#64748B' }}>Patient</p>
              <div className="grid grid-cols-2 gap-3">
                {r.source_case_id
                  ? <Field label="Case ID" value={r.source_case_id} />
                  : <Field label="Case ID" value="No Case ID — add it via Edit details" />}
                {r.case_no && <Field label="System Reference" value={r.case_no} />}
                <Field label="Date of birth" value={fmtDate(r.date_of_birth)} />
                <Field label="Age / Sex" value={`${r.age ?? '—'} / ${r.sex || '—'}`} />
                <Field label="Patient barangay" value={r.barangay_name} />
                <Field label="City" value={r.city} />
              </div>
            </section>

            <section>
              <p className="text-[11px] font-bold uppercase tracking-wider mt-1 mb-3 pt-3 border-t" style={{ color: '#64748B', borderColor: '#E2E8F0' }}>TB Case</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date of screening" value={fmtDate(r.date_of_screening)} />
                <Field label="Date of diagnosis" value={fmtDate(r.date_of_diagnosis)} />
                <Field label="Date of notification" value={fmtDate(r.date_of_notification)} />
                <Field label="Treatment started" value={fmtDate(r.date_started_treatment)} />
                <Field label="Case status" value={r.case_status ? <StatusBadge status={r.case_status} /> : '—'} />
                <Field label="Treatment outcome" value={r.treatment_outcome ? <StatusBadge status={r.treatment_outcome} /> : r.case_status ? <span className="cursor-help" title={r.case_status === 'DIAGNOSED' ? 'Diagnosed, not yet on treatment — no final outcome yet' : 'Still on treatment — no final outcome yet'}>—</span> : '—'} />
                <Field label="Source value" value={r.source_outcome_status || r.outcome_status || '—'} />
                <Field label="Date of outcome" value={fmtDate(r.date_of_outcome)} />
                <Field label="Outcome reason" value={r.outcome_reason} />
                <Field label="Registration group" value={r.registration_group} />
                <Field label="Bacteriological status" value={r.bacteriological_status} />
                <Field label="Anatomical site" value={r.anatomical_site} />
                <Field label="Source of patient" value={r.source_of_patient} />
                <Field label="Screening facility" value={r.screening_facility} />
                <Field label="Treatment facility" value={r.treatment_facility} />
                <Field label="Responsible barangay" value={r.responsible_barangay_effective || '—'} />
                <Field label="Source" value={r.source_type} />
                {r.source_record_id && (() => {
                  const [, sheet, row] = String(r.source_record_id).split(':');
                  return <Field label="Source file row" value={`${r.source_file || 'Import'} · ${sheet || r.source_type} sheet, row ${String(row || '').replace(/^R/, '')}`} />;
                })()}
              </div>
            </section>
              </>
            )}

            {tab === 'history' && (
              <section>
                <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: '#64748B' }}>Case History</p>
                {history.length === 0 ? (
                  <p className="text-xs" style={{ color: '#94A3B8' }}>No history yet. Changes to this case will appear here.</p>
                ) : (
                  <ol className="space-y-3">
                    {history.map(h => {
                      const { title, detail } = describeEntry(h);
                      return (
                        <li key={`${h.kind}-${h.id}`} className="p-3 rounded-lg text-xs" style={{ border: '1px solid #E2E8F0' }}>
                          <p className="font-bold" style={{ color: '#0F2D52' }}>{title}</p>
                          {detail && <p className="mt-0.5 font-medium" style={{ color: '#475569' }}>{detail}</p>}
                          <p className="mt-1 text-[10px]" style={{ color: '#94A3B8' }}>
                            {fmtDateTime(h.at)}{h.actor ? ` · ${h.actor}` : ''}
                          </p>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            )}

            {tab === 'referrals' && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Referral / transfer history</p>
                {!showForm && can(data, 'refer') && (
                  <button onClick={() => { setShowForm(true); setMsg(null); }} disabled={hasPendingTransfer}
                    title={hasPendingTransfer ? 'This case already has a pending referral/transfer' : ''}
                    className="px-3 py-1.5 text-[11px] font-bold rounded-md disabled:opacity-40" style={{ background: '#0F2D52', color: '#ffffff' }}>
                    Refer Case
                  </button>
                )}
              </div>

              {showForm && (
                <form onSubmit={submit} className="p-4 rounded-lg space-y-3 mb-4" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#94A3B8' }}>From Barangay</p>
                    <p className="text-xs font-medium mt-0.5" style={{ color: '#0F2D52' }}>{r.responsible_barangay_effective || '—'}</p>
                  </div>
                  <FormSelect value={form.to_barangay_id} onChange={e => setForm(f => ({ ...f, to_barangay_id: e.target.value, to_facility_id: '' }))}
                    className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} aria-label="Receiving barangay">
                    <option value="">Receiving barangay…</option>
                    {barangayOptions.filter(b => Number(b.id) !== Number(responsibleId)).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </FormSelect>
                  {form.to_barangay_id && facilitiesInTarget.length > 0 && (
                    <FormSelect value={form.to_facility_id} onChange={e => setForm(f => ({ ...f, to_facility_id: e.target.value }))}
                      className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} aria-label="Receiving facility (optional)">
                      <option value="">Facility in {selectedBarangay?.name || 'receiving barangay'} (optional)</option>
                      {facilitiesInTarget.map(fac => <option key={fac.id} value={fac.id}>{fac.name}</option>)}
                    </FormSelect>
                  )}
                  <p className="text-[10px] leading-relaxed" style={{ color: '#64748B' }}>
                    When {selectedBarangay?.name || 'the receiving barangay'} accepts, it becomes responsible for this case.
                    {r.barangay_name && ` ${r.barangay_name} keeps view-only access because the patient lives there.`}
                  </p>
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                    placeholder="Reason for referral…" aria-label="Reason" className="w-full px-3 py-2 text-xs outline-none resize-none" style={inputStyle} />
                  <div className="flex gap-2">
                    <button type="submit" disabled={saving} className="px-4 py-2 text-xs font-bold rounded-md disabled:opacity-50" style={{ background: '#047857', color: '#ffffff' }}>
                      {saving ? 'Sending…' : 'Send Referral'}
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
                        <p className="mt-1" style={{ color: '#475569' }}>
                          {transferRoute(t)}<b>{transferTarget(t)}</b>
                          {t.to_barangay && t.to_facility_name && <span style={{ color: '#94A3B8' }}> · {t.to_facility_name}</span>}
                        </p>
                        <p className="mt-1 text-[10px]" style={{ color: '#94A3B8' }}>
                          Sent {fmtDateTime(t.initiated_at || t.created_at)} by {t.initiated_by_username || '—'}
                          {t.reviewed_at ? ` · ${{ accepted: 'Accepted', rejected: 'Rejected', cancelled: 'Cancelled' }[t.status] || 'Closed'} ${fmtDateTime(t.reviewed_at)} by ${t.reviewed_by_username || '—'}` : ''}
                        </p>
                        {t.reason && <p className="mt-1 italic" style={{ color: '#64748B' }}>Reason: {t.reason}</p>}
                        {(can(t, 'accept') || can(t, 'reject') || can(t, 'cancel')) && (
                          <div className="flex gap-1 mt-2">
                            {can(t, 'accept') && <button disabled={saving} onClick={() => referralAction(t, 'accept')} className="px-2.5 py-1 text-[11px] font-semibold rounded disabled:opacity-40" style={{ background: '#0F2D52', color: '#ffffff' }}>Accept</button>}
                            {can(t, 'reject') && <button disabled={saving} onClick={() => referralAction(t, 'reject')} className="px-2.5 py-1 text-[11px] font-medium rounded disabled:opacity-40" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB' }}>Reject</button>}
                            {can(t, 'cancel') && <button disabled={saving} onClick={() => referralAction(t, 'cancel')} className="px-2.5 py-1 text-[11px] font-medium rounded disabled:opacity-40" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB' }}>Cancel referral</button>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
            )}
          </div>
        )}
        </div>
        {tab === 'overview' && !editing && !loading && !error && can(data, 'edit') && (
          <div className="shrink-0 px-6 pt-4 pb-6 flex justify-end" style={{ background: '#ffffff', borderTop: '1px solid rgba(15,45,82,0.08)' }}>
            <button type="button" onClick={() => { setEditing(true); setMsg(null); }} className="px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5"
              style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 }}>
              <i className="ri-edit-line" />Edit details
            </button>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
