import { useState, useEffect, useCallback } from 'react';
import API from '../../api/axios';
import SidePanel, { primaryBtn, secondaryBtn } from '../SidePanel';
import { fmtDate, fullName, Pager, PinHint } from './shared';
import { useConfirmDialog } from '../ConfirmDialog';
import { caseIdLabel } from '../../utils/caseId';

const isPasigCity = (c) => ['pasig city', 'pasig', ''].includes(String(c ?? '').trim().toLowerCase());

/**
 * Review Records — one location group (same barangay/city text in the file), reviewed
 * record by record. Each record gets its own barangay; nothing is assigned in bulk, and
 * the facility shown is context only — it never fills in the barangay. Records that are
 * clearly not Pasig residents can be classified as Outside Pasig.
 */
export default function LocationReviewPanel({ group, batch, onClose, onChanged }) {
  const [data, setData] = useState({ records: [], barangays: [], pagination: null, identityUnlocked: false, canBulkOutsidePasig: false });
  const [page, setPage] = useState(1);
  const [choice, setChoice] = useState({}); // record id -> barangay id
  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        barangay_text: group.barangay_text,
        city_text: group.city_text,
        barangay_key: group.barangay_key ?? group.barangay_text,
        city_key: group.city_key ?? group.city_text,
        page,
      });
      if (batch) params.set('batch', batch);
      const res = await API.get(`/api/data/validation-queue/assignment/location/records?${params}`);
      setData(res.data);
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Failed to load records.' });
    } finally {
      setLoading(false);
    }
  }, [group, batch, page]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (r, action) => {
    if (action === 'assign' && !choice[r.id]) { setNotice({ type: 'error', text: 'Choose the barangay where this patient lives.' }); return; }
    if (action === 'outside_pasig' && !(await confirm({
      title: 'Classify patient outside Pasig?',
      message: 'The record will stay in PASIG TB-IS and will not be sent to TBInsight.',
      confirmLabel: 'Classify outside Pasig',
      variant: 'danger',
    }))) return;
    setBusy(r.id);
    setNotice(null);
    try {
      const res = await API.post(`/api/data/validation-queue/assignment/location/records/${r.id}`,
        action === 'assign' ? { action, barangay_id: Number(choice[r.id]) } : { action });
      const failed = res.data.sync?.status === 'failed';
      setNotice({ type: failed ? 'error' : 'success', text: res.data.message + (failed ? ` Re-sync failed: ${res.data.sync.message}` : '') });
      onChanged?.();
      load();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Failed to update the record.' });
    } finally {
      setBusy(null);
    }
  };

  const bulkOutside = async () => {
    const n = data.pagination?.total ?? 0;
    if (!(await confirm({
      title: 'Classify records outside Pasig?',
      message: `Classify all ${n} record(s) with City = ${group.city_text} as outside Pasig?`,
      confirmLabel: 'Classify records',
      variant: 'danger',
    }))) return;
    setBusy('bulk');
    try {
      const res = await API.post('/api/data/validation-queue/assignment/location', {
        barangay_text: group.barangay_text, city_text: group.city_text,
        barangay_key: group.barangay_key, city_key: group.city_key,
        action: 'outside_pasig', batch: batch || undefined,
      });
      setNotice({ type: 'success', text: res.data.message });
      onChanged?.();
      load();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Failed to classify the records.' });
    } finally {
      setBusy(null);
    }
  };

  const total = data.pagination?.total ?? 0;
  const pasigGroup = isPasigCity(group.city_text);

  return (
    <>
    {confirmDialog}
    <SidePanel
      width="max-w-4xl"
      title="Review patient locations"
      subtitle={`${total.toLocaleString()} record${total === 1 ? '' : 's'} left to review`}
      onClose={onClose}
      footer={<button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium" style={secondaryBtn}>Done</button>}
      footerDivider
    >
      <div className="flex flex-wrap gap-x-8 gap-y-2 px-3 py-2.5 text-[11px]" style={{ background: '#F5F8FB', border: '1px solid #E8EDF2', color: '#475569' }}>
        <p><span className="font-semibold" style={{ color: '#64748B' }}>Barangay in file:</span> {group.barangay_text || 'Not provided'}</p>
        <p><span className="font-semibold" style={{ color: '#64748B' }}>City in file:</span> {group.city_text || 'Not provided'}</p>
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: '#64748B' }}>
        {pasigGroup
          ? 'Choose the barangay where each patient lives. The facility is where the patient was seen; it does not determine their barangay.'
          : `These records list ${group.city_text || 'an unrecognized city'} as the city. Assign a barangay only if the patient lives in Pasig; otherwise, choose Outside Pasig.`}
        {' '}After assignment, the record is visible to staff in that barangay.
      </p>
      <PinHint unlocked={data.identityUnlocked} />

      {data.canBulkOutsidePasig && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" style={{ background: '#F8F6F1', border: '1px solid #E8E1D5' }}>
          <span className="text-[11px]" style={{ color: '#6B5B43' }}>The city listed for this group is {group.city_text}.</span>
          <button disabled={busy === 'bulk'} onClick={bulkOutside} className="px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50" style={primaryBtn}>
            {busy === 'bulk' ? 'Updating…' : `Mark all ${total} as Outside Pasig`}
          </button>
        </div>
      )}

      {notice && (
        <div className="px-3 py-2 text-xs" style={notice.type === 'error'
          ? { background: '#FBF3F2', color: '#8F3A34', border: '1px solid #EAD5D2' }
          : { background: '#F1F5F1', color: '#526A56', border: '1px solid #D5E0D5' }}>
          {notice.text}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-center py-8" style={{ color: '#94A3B8' }}>Loading…</p>
      ) : data.records.length === 0 ? (
        <p className="text-xs py-5" style={{ color: '#526A56' }}>All records in this group have been reviewed.</p>
      ) : (
        <div style={{ borderTop: '1px solid rgba(15,45,82,0.06)' }}>
          {data.records.map(r => (
            <article key={r.id} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(250px,300px)] gap-4 py-4" style={{ borderBottom: '1px solid rgba(15,45,82,0.06)' }}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p className="text-xs font-semibold" style={{ color: '#263746' }}>{fullName(r)}</p>
                  <span className="text-[11px] font-mono" style={{ color: '#64748B' }}>{caseIdLabel(r)}</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
                  <div><dt className="inline" style={{ color: '#94A3B8' }}>Sex / age: </dt><dd className="inline" style={{ color: '#475569' }}>{r.sex || '—'}{r.age != null ? ` / ${r.age}` : ''}</dd></div>
                  <div><dt className="inline" style={{ color: '#94A3B8' }}>Diagnosis: </dt><dd className="inline" style={{ color: '#475569' }}>{fmtDate(r.date_of_diagnosis)}</dd></div>
                  <div><dt className="inline" style={{ color: '#94A3B8' }}>Record type: </dt><dd className="inline" style={{ color: '#475569' }}>{r.source_type || '—'}</dd></div>
                </dl>
                <p className="mt-1.5 text-[10px] break-words" style={{ color: '#64748B' }}>
                  Seen at {r.treatment_facility || r.screening_facility || 'Not provided'}
                </p>
              </div>
              <div className="flex flex-col items-start gap-2">
                <label className="w-full">
                  <span className="mb-1 block text-[10px] font-medium" style={{ color: '#64748B' }}>Barangay where the patient lives</span>
                  <select aria-label={`Barangay where ${fullName(r)} lives`} value={choice[r.id] || ''} onChange={e => setChoice(c => ({ ...c, [r.id]: e.target.value }))}
                    className="w-full px-2.5 py-2 text-[11px] outline-none" style={{ background: '#ffffff', border: '1px solid #D7DEE6', color: '#334155' }}>
                    <option value="">Select barangay</option>
                    {data.barangays.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button disabled={busy === r.id} onClick={() => resolve(r, 'assign')} className="px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50" style={primaryBtn}>
                    {busy === r.id ? 'Saving…' : 'Assign barangay'}
                  </button>
                  <button disabled={busy === r.id} onClick={() => resolve(r, 'outside_pasig')} className="px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-50" style={secondaryBtn}>Outside Pasig</button>
                </div>
              </div>
            </article>
          ))}
          <Pager pagination={data.pagination} onPage={setPage} />
        </div>
      )}
    </SidePanel>
    </>
  );
}
