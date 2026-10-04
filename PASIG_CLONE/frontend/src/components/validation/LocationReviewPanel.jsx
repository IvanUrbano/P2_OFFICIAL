import { useState, useEffect, useCallback } from 'react';
import API from '../../api/axios';
import SidePanel, { primaryBtn, secondaryBtn } from '../SidePanel';
import { fmtDate, fullName, Pager, PinHint } from './shared';
import { useConfirmDialog } from '../ConfirmDialog';

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
      const params = new URLSearchParams({ barangay_text: group.barangay_text, city_text: group.city_text, page });
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
        barangay_text: group.barangay_text, city_text: group.city_text, action: 'outside_pasig', batch: batch || undefined,
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
      width="max-w-3xl"
      title="Review records"
      subtitle={`Barangay: ${group.barangay_text || '(blank)'} · City: ${group.city_text || '(blank)'} · ${total} record${total === 1 ? '' : 's'} left`}
      onClose={onClose}
      footer={<button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium" style={secondaryBtn}>Done</button>}
    >
      <p className="text-[11px] leading-relaxed px-3 py-2 rounded" style={{ background: '#F8FAFC', color: '#475569', borderLeft: '3px solid #2E6FAF' }}>
        {pasigGroup
          ? 'Assign each patient to the barangay where they live. Records in this group can belong to different barangays, so they are reviewed one at a time. The facility shown is where the patient was seen — it does not tell where they live.'
          : `These records list ${group.city_text} as the city. If they are not Pasig residents, classify them as Outside Pasig; assign a barangay only to records that are actually in Pasig.`}
        {' '}Once assigned, the record is visible to that barangay&apos;s staff.
      </p>
      <PinHint unlocked={data.identityUnlocked} />

      {data.canBulkOutsidePasig && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
          <span className="text-[11px]" style={{ color: '#92400E' }}>City {group.city_text} is outside Pasig.</span>
          <button disabled={busy === 'bulk'} onClick={bulkOutside} className="px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50" style={primaryBtn}>
            Classify all {total} as Outside Pasig
          </button>
        </div>
      )}

      {notice && (
        <div className="px-3 py-2 rounded-lg text-xs" style={{ background: notice.type === 'error' ? 'rgba(239,68,68,0.05)' : 'rgba(16,185,129,0.06)', color: notice.type === 'error' ? '#991B1B' : '#047857' }}>
          {notice.text}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-center py-8" style={{ color: '#94A3B8' }}>Loading…</p>
      ) : data.records.length === 0 ? (
        <p className="text-xs text-center py-8" style={{ color: '#047857' }}>All records in this group are resolved.</p>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #E2E8F0' }}>
          {data.records.map(r => (
            <div key={r.id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-3" style={{ borderBottom: '1px solid #F1F5F9' }}>
              <div className="flex-1 min-w-0 text-xs" style={{ color: '#0F2D52' }}>
                <p className="font-semibold">{fullName(r)} <span className="font-mono font-normal" style={{ color: '#64748B' }}>{r.case_no || ''}</span></p>
                <p className="text-[11px]" style={{ color: '#64748B' }}>
                  {r.sex || '—'}{r.age != null ? `, ${r.age}` : ''} · Dx {fmtDate(r.date_of_diagnosis)} · {r.source_type}
                </p>
                <p className="text-[10px]" style={{ color: '#94A3B8' }}>
                  Seen at {r.treatment_facility || r.screening_facility || '—'} · {r.filename || 'Import'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <select aria-label="Barangay where the patient lives" value={choice[r.id] || ''} onChange={e => setChoice(c => ({ ...c, [r.id]: e.target.value }))}
                  className="px-2 py-1.5 text-[11px] rounded outline-none" style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52', maxWidth: 170 }}>
                  <option value="">Barangay…</option>
                  {data.barangays.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <button disabled={busy === r.id} onClick={() => resolve(r, 'assign')} className="px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50" style={primaryBtn}>Assign</button>
                <button disabled={busy === r.id} onClick={() => resolve(r, 'outside_pasig')} className="px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-50" style={secondaryBtn}>Outside Pasig</button>
              </div>
            </div>
          ))}
          <Pager pagination={data.pagination} onPage={setPage} />
        </div>
      )}
    </SidePanel>
    </>
  );
}
