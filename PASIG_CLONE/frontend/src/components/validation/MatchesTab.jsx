import { useState, useEffect, useCallback } from 'react';
import API from '../../api/axios';
import EmptyState from '../EmptyState';
import { fmtDate, fullName, Notice, ChipFilter, th, thStyle, td, FIELD_LABELS, PinHint } from './shared';
import { primaryBtn, secondaryBtn } from '../SidePanel';
import { can } from '../../utils/permissions';
import ProgressOverlay from '../ProgressOverlay';
import { useConfirmDialog } from '../ConfirmDialog';

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
      setNotice({ type: 'success', text: `${r.match_candidate_case_no || 'Record'}: ${resolution.replace('_', ' ')} recorded.` });
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
    const label = resolution === 'suggested' ? 'the suggested decision' : `"${resolution.replace('_', ' ')}"`;
    if (!(await confirm({
      title: 'Apply match decision?',
      message: `Apply ${label} to ${selected.length} selected record(s)?`,
      confirmLabel: 'Apply decision',
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
        icon="ri-git-merge-line"
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
          <EmptyState icon="ri-user-search-line" title="No Possible Matches" description="Every incoming record has a confirmed Patient # and Case ID." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th} style={thStyle}>
                    <input type="checkbox" aria-label="Select all" checked={allSelected}
                      onChange={() => setSelected(allSelected ? [] : selectable.map(r => r.id))} />
                  </th>
                  {['Type', 'Incoming record', 'Existing case', 'What would change', 'Decision'].map(h => <th key={h} className={th} style={thStyle}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map(r => {
                  const cat = CATEGORY[r.category] || CATEGORY.missing_candidate;
                  const primary = PRIMARY_ACTION[r.category] || PRIMARY_ACTION.missing_candidate;
                  const c = r.candidate;
                  // "Same case" changes the existing case; it must be editable for this user.
                  const existingEditable = !c || can(c, 'edit');
                  const blocked = (resolution) => resolution === 'same_case' && !existingEditable;
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td className={td}>
                        <input type="checkbox" aria-label="Select record" disabled={!can(r, 'resolveMatch')} checked={selected.includes(r.id)}
                          onChange={() => setSelected(s => (s.includes(r.id) ? s.filter(x => x !== r.id) : [...s, r.id]))} />
                      </td>
                      <td className={td}>
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap" style={{ background: cat.bg, color: cat.color }} title={cat.hint}>{cat.label}</span>
                      </td>
                      <td className={td} style={{ color: '#0F2D52' }}>
                        <span className="font-semibold">{fullName(r)}</span>
                        <span className="block text-[10px]" style={{ color: '#64748B' }}>
                          Dx {fmtDate(r.date_of_diagnosis)} · {r.barangay_name || 'no barangay'} · {r.source_type}
                        </span>
                        <span className="block text-[10px]" style={{ color: '#94A3B8' }}>Outcome: {r.outcome_status || '—'}</span>
                      </td>
                      <td className={td} style={{ color: '#0F2D52' }}>
                        {c ? (
                          <>
                            <span className="font-mono">{c.case_no}</span>
                            <span className="block text-[10px]" style={{ color: '#64748B' }}>{c.patient_no || ''} · Dx {fmtDate(c.date_of_diagnosis)}</span>
                            <span className="block text-[10px]" style={{ color: '#94A3B8' }}>Outcome: {c.outcome_status || '—'}</span>
                          </>
                        ) : <span style={{ color: '#991B1B' }}>No longer exists</span>}
                      </td>
                      <td className={td}>
                        {r.category === 'new_episode' ? (
                          <span className="text-[11px]" style={{ color: '#64748B' }}>New case for the same patient (Patient # kept)</span>
                        ) : r.changes?.length ? (
                          <ul className="space-y-0.5">
                            {r.changes.map(ch => (
                              <li key={ch.field} className="text-[11px]" style={{ color: '#334155' }}>
                                <span style={{ color: '#64748B' }}>{FIELD_LABELS[ch.field] || ch.field}:</span>{' '}
                                <span className="line-through" style={{ color: '#94A3B8' }}>{showValue(ch.field, ch.existing)}</span>{' → '}
                                <b>{showValue(ch.field, ch.incoming)}</b>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-[11px]" style={{ color: '#94A3B8' }}>Nothing — the case stays as it is</span>
                        )}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        {can(r, 'resolveMatch') ? (
                          <div className="flex flex-col items-start gap-1">
                            <button disabled={busy || blocked(primary.resolution)} onClick={() => resolveOne(r, primary.resolution)}
                              title={blocked(primary.resolution) ? 'The existing case is view-only for you' : ''}
                              className="px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50" style={primaryBtn}>{primary.label}</button>
                            <div className="flex gap-1">
                              {ALL_ACTIONS.filter(a => a.resolution !== primary.resolution).map(a => (
                                <button key={a.resolution} disabled={busy || (!c && a.resolution !== 'different_person') || blocked(a.resolution)} onClick={() => resolveOne(r, a.resolution)}
                                  className="px-2 py-1 text-[10px] font-medium disabled:opacity-40" style={secondaryBtn}>{a.label}</button>
                              ))}
                            </div>
                            {!existingEditable && (
                              <span className="text-[10px]" style={{ color: '#B45309' }}>Existing case is view-only for you — it can&apos;t be updated from here.</span>
                            )}
                          </div>
                        ) : r.permissions?.view === false ? (
                          // Visible only because it came from this user's upload (or an
                          // unassigned row): another barangay's case, decided by them.
                          <span className="text-[10px] leading-snug inline-block text-right" style={{ maxWidth: 240, color: '#B45309' }}>
                            🔒 Assigned to {r.barangay_name || 'another barangay'} — only its barangay staff or an administrator can decide this.
                          </span>
                        ) : (
                          <span className="text-[10px]" style={{ color: '#94A3B8' }}>View only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
