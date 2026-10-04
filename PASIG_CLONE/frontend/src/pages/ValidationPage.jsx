import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import API from '../api/axios';
import FilterSelect from '../components/FilterSelect';
import SkeletonBlock from '../components/SkeletonBlock';
import ProgressOverlay from '../components/ProgressOverlay';
import { primaryBtn } from '../components/SidePanel';
import ReadyTab from '../components/validation/ReadyTab';
import MatchesTab from '../components/validation/MatchesTab';
import AssignmentTab from '../components/validation/AssignmentTab';
import IssuesTab from '../components/validation/IssuesTab';

const TABS = [
  { key: 'ready', title: 'Ready', desc: 'No unresolved issues' },
  { key: 'matches', title: 'Possible Matches', desc: 'Duplicates, updates, new episodes' },
  { key: 'assignment', title: 'Needs Assignment', desc: 'Location and facility mapping' },
  { key: 'issues', title: 'Data Issues', desc: 'Missing or invalid values' },
];
const BADGE = {
  ready: { bg: '#ECFDF5', color: '#047857' },
  matches: { bg: '#FFFBEB', color: '#92400E' },
  assignment: { bg: '#EFF6FF', color: '#1E40AF' },
  issues: { bg: '#FEF2F2', color: '#991B1B' },
};

/**
 * Validation — one place to take imported records from "imported" to "ready to sync".
 *   Ready / Possible Matches / Needs Assignment / Data Issues, each with its own actions.
 * Opening /validation?batchId=… for a batch that has not been validated yet validates it
 * first (that is where Data Import sends you), then filters the tabs to that batch.
 */
export default function ValidationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(TABS.some(t => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'ready');
  const [batch, setBatch] = useState(searchParams.get('batchId') || '');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(null);
  const [validateNotice, setValidateNotice] = useState(null);
  const [toValidate, setToValidate] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const autoValidated = useRef(false);

  const loadSummary = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (batch) params.set('batch', batch);
      const res = await API.get(`/api/data/validation-queue/summary?${params}`);
      setSummary(res.data);
      setError('');
      return res.data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load validation.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [batch]);

  const runValidation = useCallback(async (id) => {
    setValidating(id);
    setValidateNotice(null);
    try {
      const res = await API.post(`/api/data/validate/${id}`);
      const s = res.data.summary || {};
      setValidateNotice({
        type: 'success',
        text: `Validated ${s.total ?? 0} rows: ${s.valid ?? 0} passed, ${s.invalid ?? 0} with data issues${s.possibleMatches ? `, ${s.possibleMatches} possible matches` : ''}.`,
      });
      setBatch(id);
      setRefreshKey(k => k + 1);
    } catch (err) {
      setValidateNotice({ type: 'error', text: err.response?.data?.error || 'Validation failed.' });
    } finally {
      setValidating(null);
    }
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary, refreshKey]);

  // Arriving from Data Import with an unvalidated batch: validate it once — but only a
  // batch the user may validate (its uploader or an admin; the server enforces the same).
  useEffect(() => {
    if (autoValidated.current || !summary || !batch) return;
    const b = summary.batches.find(x => x.id === batch);
    if (b?.status === 'uploaded' && b?.can_validate) {
      autoValidated.current = true;
      runValidation(batch);
    }
  }, [summary, batch, runValidation]);

  // Keep the URL in step so a tab/batch can be linked to.
  useEffect(() => {
    const next = new URLSearchParams();
    if (tab !== 'ready') next.set('tab', tab);
    if (batch) next.set('batchId', batch);
    setSearchParams(next, { replace: true });
  }, [tab, batch, setSearchParams]);

  const onChanged = () => { loadSummary(); };

  if (loading && !summary) return <div className="space-y-4"><SkeletonBlock className="h-12" /><SkeletonBlock className="h-64" /></div>;

  const counts = summary?.counts || {};
  // "Validate" writes batch metadata: only the uploader's own pending batches (or every
  // batch, for an admin) are offered — the server refuses anyone else either way.
  const uploaded = (summary?.batches || []).filter(b => b.status === 'uploaded' && b.can_validate);
  const validatedBatches = (summary?.batches || []).filter(b => b.status !== 'uploaded');
  const tabCount = { ready: counts.ready, matches: counts.matches, assignment: counts.assignment, issues: counts.issues };

  return (
    <div className="space-y-5">
      {/* ─── Header + batch filter + tabs ─── */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Validation</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Resolve imported records here before they are synchronized to TBInsight.</p>
          </div>
        </div>

        {/* Filters — same inline bar as the other pages */}
        <div className="px-6 py-3 flex flex-wrap items-center gap-2" style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
          <FilterSelect label="Batch" value={batch} onChange={setBatch} selectStyle={{ maxWidth: 320 }}>
            <option value="">All batches</option>
            {validatedBatches.map(b => (
              <option key={b.id} value={b.id}>{b.filename}{b.open_items ? ` — ${b.open_items} open` : ''}</option>
            ))}
          </FilterSelect>
          {batch && (
            <button onClick={() => setBatch('')} className="px-3 py-2 text-xs font-medium" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}>Clear</button>
          )}

          {uploaded.length > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[11px]" style={{ color: '#B45309' }}>
                <i className="ri-time-line mr-1" />{uploaded.length} batch{uploaded.length === 1 ? '' : 'es'} waiting to be validated
              </span>
              <FilterSelect label="Batch" value={toValidate} onChange={setToValidate} selectStyle={{ maxWidth: 220 }}>
                <option value="">Choose…</option>
                {uploaded.map(b => <option key={b.id} value={b.id}>{b.filename} ({b.total_rows} rows)</option>)}
              </FilterSelect>
              <button disabled={!toValidate || validating} onClick={() => runValidation(toValidate)} className="px-4 py-2 text-xs font-semibold disabled:opacity-50" style={primaryBtn}>
                {validating ? 'Validating…' : 'Validate'}
              </button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-0 overflow-x-auto">
          {TABS.map(t => {
            const active = tab === t.key;
            const n = tabCount[t.key];
            return (
              <button key={t.key} onClick={() => setTab(t.key)} className="relative px-6 py-3 text-left whitespace-nowrap" style={{ background: 'transparent' }}>
                <p className="text-[13px] font-bold" style={{ color: active ? '#0F2D52' : '#94A3B8' }}>
                  {t.title}
                  {n > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[9px] font-bold px-1.5" style={{ background: BADGE[t.key].bg, color: BADGE[t.key].color }}>
                      {n.toLocaleString()}
                    </span>
                  )}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: active ? '#64748B' : '#CBD5E1' }}>
                  {t.key === 'assignment' && counts.assignmentDetail?.facilityNames > 0
                    ? `Location · ${counts.assignmentDetail.facilityNames} facility name${counts.assignmentDetail.facilityNames === 1 ? '' : 's'} to map`
                    : t.desc}
                </p>
                {active && <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />}
              </button>
            );
          })}
        </div>
      </div>

      <ProgressOverlay
        open={Boolean(validating)}
        title={`Validating ${(summary?.batches || []).find(b => b.id === validating)?.filename || 'batch'}`}
        detail="Cleaning each record, checking required fields and looking for possible patient matches. Large files can take a minute."
        icon="ri-shield-check-line"
        note="Keep this page open until validation finishes."
      />
      {validateNotice && (
        <div className="px-4 py-3 rounded-lg text-xs flex items-center justify-between gap-3"
          style={validateNotice.type === 'error'
            ? { background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' }
            : { background: '#ECFDF5', color: '#047857', border: '1px solid #A7F3D0' }}>
          <span>{validateNotice.text}</span>
          <button onClick={() => setValidateNotice(null)} aria-label="Dismiss"><i className="ri-close-line" /></button>
        </div>
      )}
      {error && <div className="px-4 py-3 rounded-lg text-xs" style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' }}>{error}</div>}

      {/* ─── Tab content ─── */}
      <div className="rounded-xl overflow-hidden pb-1" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
        {tab === 'ready' && <ReadyTab batch={batch} batches={summary?.batches} refreshKey={refreshKey} canSync={summary?.isAdmin} />}
        {tab === 'matches' && <MatchesTab batch={batch} refreshKey={refreshKey} onChanged={onChanged} identityUnlocked={summary?.identityUnlocked} />}
        {tab === 'assignment' && <AssignmentTab batch={batch} refreshKey={refreshKey} onChanged={onChanged} />}
        {tab === 'issues' && <IssuesTab batch={batch} refreshKey={refreshKey} onChanged={onChanged} />}
      </div>
    </div>
  );
}
