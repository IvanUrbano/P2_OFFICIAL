import { useState, useEffect, useCallback } from 'react';
import API from '../../api/axios';
import EmptyState from '../EmptyState';
import { fmtDate, fullName, Notice, ChipFilter, FIELD_LABELS, PinHint } from './shared';
import { primaryBtn, secondaryBtn } from '../SidePanel';
import { can } from '../../utils/permissions';
import ProgressOverlay from '../ProgressOverlay';
import { useConfirmDialog } from '../ConfirmDialog';
import { caseIdLabel } from '../../utils/caseId';

const CATEGORY = {
  duplicate: { label: 'Duplicate', color: '#475569', bg: '#F1F5F9', hint: 'Same patient, same diagnosis date, nothing new.' },
  case_update: { label: 'Existing-case update', color: '#1E40AF', bg: '#EFF6FF', hint: 'Same case with newer details.' },
  changed_outcome: { label: 'Changed outcome', color: '#92400E', bg: '#FFFBEB', hint: 'Same case; the outcome changed.' },
  new_episode: { label: 'Possible new episode', color: '#6D28D9', bg: '#F5F3FF', hint: 'Same patient, different diagnosis date.' },
  missing_candidate: { label: 'Matched case missing', color: '#991B1B', bg: '#FEF2F2', hint: 'The existing case was removed.' },
};

// The suggested decision per category, worded for what it does.
const PRIMARY_ACTION = {
  duplicate: { resolution: 'same_case', label: 'Discard duplicate' },
  case_update: { resolution: 'same_case', label: 'Update existing case' },
  changed_outcome: { resolution: 'same_case', label: 'Update outcome' },
  new_episode: { resolution: 'new_episode', label: 'Create new episode' },
  missing_candidate: { resolution: 'different_person', label: 'New patient' },
};
const ALL_ACTIONS = [
  { resolution: 'same_case', label: 'Same case' },
  { resolution: 'new_episode', label: 'New episode' },
  { resolution: 'different_person', label: 'Different person' },
];

const showValue = (field, v) => (v == null || v === '' ? '—' : field.startsWith('date_') ? fmtDate(v) : v);

/**
 * Possible Matches — incoming records that may belong to an existing patient. Each is
 * classified (duplicate / existing-case update / changed outcome / possible new episode)
 * and decided here, one at a time or in bulk.
 */
export default function MatchesTab({ batch, refreshKey, onChanged, identityUnlocked }) {
  const [records, setRecords] = useState([]);
  const [categoryCounts, setCategoryCounts] = useState({});
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [bulkCount, setBulkCount] = useState(0); // records in a running bulk resolve
  const [notice, setNotice] = useState(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (batch) params.set('batch', batch);
      const res = await API.get(`/api/data/validation-queue/matches?${params}`);
      setRecords(res.data.records || []);
      setCategoryCounts(res.data.categoryCounts || {});
      setSelected([]);
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Failed to load possible matches.' });
    } finally {
      setLoading(false);
    }
  }, [batch]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const visible = category ? records.filter(r => r.category === category) : records;
  const selectable = visible.filter(r => can(r, 'resolveMatch'));
  const allSelected = selectable.length > 0 && selectable.every(r => selected.includes(r.id));

  const resolveOne = async (r, resolution) => {
    setBusy(true);
    setNotice(null);
    try {
      await API.post(`/api/data/records/${r.id}/resolve-match`, { resolution });
      setNotice({ type: 'success', text: `${caseIdLabel(r.candidate)}: ${resolution.replace('_', ' ')} recorded.` });
      onChanged?.();
      load();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Failed to resolve the match.' });
    } finally {
      setBusy(false);
    }
  };

  const resolveSelected = async (resolution) => {
    if (selected.length === 0) return;
    const selectedCount = selected.length;
    const label = resolution === 'suggested'
      ? 'the recommended decision'
      : ALL_ACTIONS.find(action => action.resolution === resolution)?.label || resolution.replace(/_/g, ' ');
    if (!(await confirm({
      title: 'Confirm match decisions',
      message: `Apply “${label}” to ${selectedCount} selected ${selectedCount === 1 ? 'record' : 'records'}?`,
      confirmLabel: 'Apply decision',
      headerTone: '#0F2D52',
    }))) return;
    setBusy(true);
    setBulkCount(selected.length);
    setNotice(null);
    try {
      const res = await API.post('/api/data/records/resolve-matches', { ids: selected, resolution });
      const failed = res.data.failed?.length || 0;
      setNotice({
        type: failed ? 'error' : 'success',
        text: `${res.data.resolved} resolved${failed ? `, ${failed} could not be resolved (${res.data.failed[0].error})` : ''}.`,
      });
      onChanged?.();
      load();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Failed to resolve the selected matches.' });
    } finally {
      setBusy(false);
      setBulkCount(0);
    }
  };

  const chips = [
    { key: '', label: 'All', count: records.length },
    ...Object.keys(CATEGORY).filter(k => categoryCounts[k]).map(k => ({ key: k, label: CATEGORY[k].label, count: categoryCounts[k] })),
  ];

  return (
    <div>
      <ProgressOverlay
        open={bulkCount > 0}
        title={`Resolving ${bulkCount} possible match${bulkCount === 1 ? '' : 'es'}`}
        detail="Applying the decision to each selected record."
      />
      {confirmDialog}
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <div className="px-5 pt-4 space-y-3">
        <ChipFilter options={chips} value={category} onChange={(k) => { setCategory(k); setSelected([]); }} />
        <PinHint unlocked={identityUnlocked} />
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
            <span className="text-[11px] font-semibold" style={{ color: '#0F2D52' }}>{selected.length} selected</span>
            <button disabled={busy} onClick={() => resolveSelected('suggested')} className="px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50" style={primaryBtn}>Apply suggested decision</button>
            {ALL_ACTIONS.map(a => (
              <button key={a.resolution} disabled={busy} onClick={() => resolveSelected(a.resolution)} className="px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-50" style={secondaryBtn}>{a.label}</button>
            ))}
            <button onClick={() => setSelected([])} className="text-[11px] ml-auto" style={{ color: '#64748B' }}>Clear selection</button>
          </div>
        )}
      </div>

      <div className="mt-3">
        {loading ? (
          <p className="text-xs text-center py-10" style={{ color: '#94A3B8' }}>Loading…</p>
        ) : visible.length === 0 ? (
          <EmptyState icon="ri-user-search-line" title="No Possible Matches" description="Every incoming record has a confirmed Case ID." />
        ) : (
          <div className="divide-y" style={{ borderTop: '1px solid #E2E8F0', borderColor: '#E2E8F0' }}>
            <div className="flex items-center gap-2 px-5 py-2.5" style={{ background: '#F8FAFC' }}>
              <input type="checkbox" aria-label="Select all" checked={allSelected}
                onChange={() => setSelected(allSelected ? [] : selectable.map(r => r.id))} />
              <span className="text-[11px]" style={{ color: '#64748B' }}>Select all cases you can decide</span>
            </div>
            {visible.map(r => {
              const cat = CATEGORY[r.category] || CATEGORY.missing_candidate;
              const primary = PRIMARY_ACTION[r.category] || PRIMARY_ACTION.missing_candidate;
              const c = r.candidate;
              const existingEditable = !c || can(c, 'edit');
              const blocked = (resolution) => resolution === 'same_case' && !existingEditable;
              return (
                <article key={r.id} className="px-5 py-4" style={{ borderColor: '#E2E8F0' }}>
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <input type="checkbox" aria-label="Select record" disabled={!can(r, 'resolveMatch')} checked={selected.includes(r.id)}
                      onChange={() => setSelected(s => (s.includes(r.id) ? s.filter(x => x !== r.id) : [...s, r.id]))} />
                    <span className="text-xs font-semibold" style={{ color: '#263746' }}>{cat.label}</span>
                    <span className="text-[11px]" style={{ color: '#64748B' }}>{cat.hint}</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <section className="p-3" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#64748B' }}>Incoming record</h3>
                      <p className="text-xs font-semibold" style={{ color: '#0F2D52' }}>{fullName(r)}</p>
                      <p className="mt-1 text-[11px]" style={{ color: '#475569' }}>
                        Diagnosis: {fmtDate(r.date_of_diagnosis)} <span className="mx-1">·</span> {r.barangay_name || 'No barangay'} <span className="mx-1">·</span> {r.source_type}
                      </p>
                      <p className="mt-0.5 text-[11px]" style={{ color: '#64748B' }}>Outcome: {r.outcome_status || '—'}</p>
                    </section>
                    <section className="p-3" style={{ background: '#FFFFFF', border: '1px solid #E2E8F0' }}>
                      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#64748B' }}>Existing case</h3>
                      {c ? (
                        <>
                          <p className="text-xs font-mono font-semibold" style={{ color: '#0F2D52' }}>{caseIdLabel(c)}</p>
                          <p className="mt-1 text-[11px]" style={{ color: '#475569' }}>Diagnosis: {fmtDate(c.date_of_diagnosis)}</p>
                          <p className="mt-0.5 text-[11px]" style={{ color: '#64748B' }}>Outcome: {c.outcome_status || '—'}</p>
                        </>
                      ) : <p className="text-xs" style={{ color: '#991B1B' }}>This existing case no longer exists.</p>}
                    </section>
                  </div>

                  <div className="mt-3">
                    <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#64748B' }}>What would change</h3>
                    {r.category === 'new_episode' ? (
                      <p className="text-[11px]" style={{ color: '#475569' }}>This would create a new episode for the same patient.</p>
                    ) : r.changes?.length ? (
                      <ul className="space-y-1">
                        {r.changes.map(ch => (
                          <li key={ch.field} className="text-[11px]" style={{ color: '#334155' }}>
                            <span className="font-medium">{FIELD_LABELS[ch.field] || ch.field}:</span>{' '}
                            <span style={{ color: '#64748B' }}>{showValue(ch.field, ch.existing)}</span>
                            <span className="mx-1" style={{ color: '#94A3B8' }}>→</span>
                            <span className="font-semibold">{showValue(ch.field, ch.incoming)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px]" style={{ color: '#64748B' }}>No details would change; the existing case stays as it is.</p>
                    )}
                  </div>

                  <div className="mt-3 pt-3 flex flex-wrap items-center gap-2" style={{ borderTop: '1px solid #E8EDF2' }}>
                    {can(r, 'resolveMatch') ? (
                      <>
                        <button disabled={busy || blocked(primary.resolution)} onClick={() => resolveOne(r, primary.resolution)}
                          title={blocked(primary.resolution) ? 'The existing case is view-only for you' : ''}
                          className="px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50" style={primaryBtn}>{primary.label}</button>
                        {ALL_ACTIONS.filter(a => a.resolution !== primary.resolution).map(a => (
                          <button key={a.resolution} disabled={busy || (!c && a.resolution !== 'different_person') || blocked(a.resolution)} onClick={() => resolveOne(r, a.resolution)}
                            className="px-2.5 py-1.5 text-[10px] font-medium disabled:opacity-40" style={secondaryBtn}>{a.label}</button>
                        ))}
                        {!existingEditable && (
                          <span className="basis-full text-[10px]" style={{ color: '#9A672D' }}>The existing case is view-only for you, so it cannot be updated here.</span>
                        )}
                      </>
                    ) : r.permissions?.view === false ? (
                      <span className="text-[11px]" style={{ color: '#9A672D' }}>
                        Assigned to {r.barangay_name || 'another barangay'}; only that barangay&apos;s staff or an administrator can decide.
                      </span>
                    ) : (
                      <span className="text-[11px]" style={{ color: '#64748B' }}>View only</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
