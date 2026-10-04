import { useState, useEffect, useCallback } from 'react';
import API from '../../api/axios';
import EmptyState from '../EmptyState';
import SidePanel, { primaryBtn, secondaryBtn } from '../SidePanel';
import { fmtDate, Notice, th, thStyle, td } from './shared';
import { can } from '../../utils/permissions';
import LocationReviewPanel from './LocationReviewPanel';
import { useConfirmDialog } from '../ConfirmDialog';

const OWNERSHIP = [['public', 'Public'], ['private', 'Private']];
const FACILITY_TYPES = [
  ['HC', 'Health Center'], ['PC', 'Puericulture Center'],
  ['ITC', 'Infirmary / Treatment Center'], ['Floodway', 'Floodway Health Station'],
];
const inputClass = 'w-full px-3 py-2 text-xs rounded-lg outline-none';
const inputStyle = { background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' };

function Label({ children, required }) {
  return <span className="block text-[11px] font-semibold mb-1" style={{ color: '#475569' }}>{children}{required && <span style={{ color: '#DC2626' }}> *</span>}</span>;
}

/**
 * Needs Assignment —
 *   Location: records whose barangay is missing, unknown or outside Pasig, grouped by the
 *     barangay/city text in the file. Assign a Pasig barangay, or confirm outside Pasig.
 *   Facilities: facility names in the records that are not mapped to the registry (unknown
 *     names, naming variants, unregistered private/external facilities). Each name is
 *     resolved three ways: match an existing registry facility, add a reference facility
 *     (always with an alias so future imports resolve too), or keep it pending.
 */
export default function AssignmentTab({ batch, refreshKey, onChanged }) {
  const [data, setData] = useState({ locations: [], facilities: [], facilityOptions: [], barangays: [], permissions: {} });
  const canAssign = can(data, 'assignLocation');
  const canMap = can(data, 'mapFacility');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [reviewGroup, setReviewGroup] = useState(null); // location group open in Review Records
  // One unknown facility name being resolved: { f, step, matchId, form, error }
  // step: 'options' (the three choices) → 'match' | 'register'
  const [resolve, setResolve] = useState(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (batch) params.set('batch', batch);
      const res = await API.get(`/api/data/validation-queue/assignment?${params}`);
      setData(res.data);
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Failed to load the assignment queue.' });
    } finally {
      setLoading(false);
    }
  }, [batch]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const run = async (key, fn) => {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fn();
      setNotice({ type: res.data.sync?.status === 'failed' ? 'error' : 'success', text: res.data.message + (res.data.sync?.status === 'failed' ? ` Re-sync failed: ${res.data.sync.message}` : '') });
      onChanged?.();
      await load();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Action failed.' });
    } finally {
      setBusy(null);
    }
  };

  const locKey = (l) => `${l.barangay_text}|${l.city_text}`;
  // Only groups whose city is clearly not Pasig can be classified in bulk; barangays are
  // always assigned record by record (Review Records).
  const nonPasigCity = (l) => !['pasig city', 'pasig', ''].includes(String(l.city_text || '').trim().toLowerCase());
  const classifyOutside = async (l) => {
    if (!(await confirm({
      title: 'Classify records outside Pasig?',
      message: `Classify all ${l.records} record(s) with City = ${l.city_text} as outside Pasig? They will stay in PASIG TB-IS and will not be sent to TBInsight.`,
      confirmLabel: 'Classify records',
      variant: 'danger',
    }))) return;
    run(`loc:${locKey(l)}`, () => API.post('/api/data/validation-queue/assignment/location', {
      barangay_text: l.barangay_text, city_text: l.city_text, action: 'outside_pasig', batch: batch || undefined,
    }));
  };

  const acceptSuggestions = async () => {
    const n = data.facilities.filter(f => f.suggestion).length;
    if (!(await confirm({
      title: 'Apply facility suggestions?',
      message: `Map ${n} unresolved facility name(s) to their suggested registry facilities?`,
      confirmLabel: 'Apply suggestions',
    }))) return;
    run('fac:all', () => API.post('/api/data/validation-queue/assignment/facility/accept-suggestions'));
  };

  // ── Resolution workflow (Match Existing Facility / Add Reference Facility / Keep Pending) ──
  // Keep Pending is purely "close this panel": the name stays in Needs Assignment.

  const openResolve = (f) => setResolve({
    f,
    step: 'options',
    matchId: f.suggestion ? String(f.suggestion.id) : '',
    form: {
      // Prefill from the source text, dropping a trailing program tag (" - IDOTS"/" - MTBN").
      name: f.facility_text.replace(/\s*-\s*(IDOTS|MTBN|DOTS)\s*$/i, '').trim(),
      ownership: 'private',
      facility_type: 'HC',
      classification: 'pasig', // 'pasig' | 'external'
      barangay_name: '',
      city: '',
      status: 'active',
    },
    error: '',
  });

  const setForm = (patch) => setResolve(r => ({ ...r, form: { ...r.form, ...patch } }));

  const runResolve = async (key, fn) => {
    setBusy(key);
    try {
      const res = await fn();
      setNotice({ type: 'success', text: res.data.message });
      setResolve(null);
      onChanged?.();
      await load();
    } catch (err) {
      // Keep the panel open and show the reason inside it.
      setResolve(r => (r ? { ...r, error: err.response?.data?.error || 'Action failed.' } : r));
    } finally {
      setBusy(null);
    }
  };

  const submitMatch = async (e) => {
    e.preventDefault();
    if (!resolve.matchId) { setResolve(r => ({ ...r, error: 'Choose a facility to match to.' })); return; }
    setResolve(r => ({ ...r, error: '' }));
    await runResolve(`fac:${resolve.f.alias_norm}`, () => API.post('/api/data/validation-queue/assignment/facility', {
      facility_text: resolve.f.facility_text,
      action: 'map',
      facility_id: Number(resolve.matchId),
    }));
  };

  const submitRegister = async (e) => {
    e.preventDefault();
    const { form } = resolve;
    const external = form.classification === 'external';
    if (!form.name.trim()) { setResolve(r => ({ ...r, error: 'Facility name is required.' })); return; }
    if (external && !form.city.trim()) { setResolve(r => ({ ...r, error: 'Add the city or municipality of the facility (e.g. Taytay, Rizal).' })); return; }
    if (!external && !form.barangay_name) { setResolve(r => ({ ...r, error: 'Choose the Pasig barangay of the facility.' })); return; }
    setResolve(r => ({ ...r, error: '' }));
    await runResolve('register', () => API.post('/api/data/validation-queue/assignment/facility', {
      facility_text: resolve.f.facility_text,
      action: 'register',
      facility: {
        name: form.name,
        ownership: form.ownership,
        facility_type: form.facility_type,
        // External / reference facilities never carry a Pasig barangay — only the city
        // they are really in (the backend enforces the same rule).
        is_external: external,
        is_reference: external,
        barangay_name: external ? '' : form.barangay_name,
        city: form.city,
        is_active: form.status === 'active',
      },
    }));
  };

  if (loading) return <p className="text-xs text-center py-10" style={{ color: '#94A3B8' }}>Loading…</p>;

  const suggestedCount = data.facilities.filter(f => f.suggestion).length;

  return (
    <div>
      {confirmDialog}
      <Notice notice={notice} onClose={() => setNotice(null)} />
      {!canAssign && !canMap && (
        <p className="mx-5 mt-4 text-[11px] px-3 py-2 rounded" style={{ background: '#F8FAFC', color: '#64748B', borderLeft: '3px solid #94A3B8' }}>
          Location and facility decisions are made by an admin. You can see what is pending — including rows you imported whose barangay could not be matched — but only an administrator can resolve them.
        </p>
      )}

      {/* ── Location ── */}
      <section className="px-5 pt-4">
        <h3 className="text-xs font-bold" style={{ color: '#0F2D52' }}>Patient location <span className="font-normal" style={{ color: '#94A3B8' }}>· {data.locations.reduce((n, l) => n + l.records, 0).toLocaleString()} records</span></h3>
        <p className="text-[11px] mt-0.5 mb-2" style={{ color: '#64748B' }}>
          Missing, unknown or non-Pasig barangays, grouped by what the file says. Records in a group can belong to different barangays, so each is reviewed and assigned on its own; the facility never decides the barangay. Clearly non-Pasig cities can be classified as Outside Pasig.
        </p>
        {data.locations.length === 0 ? (
          <p className="text-[11px] py-3" style={{ color: '#94A3B8' }}>Every record has a Pasig barangay or a confirmed outside-Pasig location.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid #E2E8F0' }}>
            <table className="w-full">
              <thead><tr>{['Barangay in file', 'City in file', 'Records', 'Diagnosed', 'Resolve'].map(h => <th key={h} className={th} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {data.locations.map(l => {
                  const k = locKey(l);
                  return (
                    <tr key={k} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td className={td} style={{ color: l.barangay_text ? '#0F2D52' : '#94A3B8' }}>{l.barangay_text || '(blank)'}</td>
                      <td className={td} style={{ color: l.city_text ? '#475569' : '#94A3B8' }}>{l.city_text || '(blank)'}</td>
                      <td className={td} style={{ color: '#0F2D52' }}>{l.records.toLocaleString()}</td>
                      <td className={`${td} whitespace-nowrap`} style={{ color: '#64748B' }}>{fmtDate(l.first_dx)}{l.last_dx && l.last_dx !== l.first_dx ? ` – ${fmtDate(l.last_dx)}` : ''}</td>
                      <td className={td}>
                        {canAssign ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button onClick={() => setReviewGroup(l)} className="px-2.5 py-1.5 text-[11px] font-semibold" style={primaryBtn}>Review Records</button>
                            {nonPasigCity(l) && (
                              <button disabled={busy === `loc:${k}`} onClick={() => classifyOutside(l)} className="px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-50" style={secondaryBtn}>Outside Pasig</button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] font-semibold" style={{ color: '#B45309' }}>
                            ⚠ Requires Administrator Review
                            <span className="block font-normal" style={{ color: '#94A3B8' }}>Barangay could not be matched.</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Facilities ── */}
      <section className="px-5 pt-6 pb-5">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
          <div>
            <h3 className="text-xs font-bold" style={{ color: '#0F2D52' }}>Facility mapping <span className="font-normal" style={{ color: '#94A3B8' }}>· {data.facilities.length} name{data.facilities.length === 1 ? '' : 's'}</span></h3>
            <p className="text-[11px] mt-0.5" style={{ color: '#64748B' }}>
              Facility names in the records that are not in the registry. Open a name to resolve it three ways: match it to a facility already listed, register a new reference facility, or keep it pending for later.
            </p>
          </div>
          {canMap && suggestedCount > 0 && (
            <button disabled={busy === 'fac:all'} onClick={acceptSuggestions} className="px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50 shrink-0" style={primaryBtn}>
              Accept all {suggestedCount} suggestions
            </button>
          )}
        </div>
        {data.facilities.length === 0 ? (
          <p className="text-[11px] py-3" style={{ color: '#94A3B8' }}>Every facility name is mapped to the registry.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid #E2E8F0' }}>
            <table className="w-full">
              <thead><tr>{['Facility name in records', 'Used as', 'Records', canMap ? 'Resolution' : 'Suggested'].map(h => <th key={h} className={th} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {data.facilities.map(f => (
                  <tr key={f.alias_norm} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td className={td} style={{ color: '#0F2D52' }}>{f.facility_text}</td>
                    <td className={td} style={{ color: '#64748B' }}>{(f.fields || []).join(', ')}</td>
                    <td className={td} style={{ color: '#0F2D52' }}>{f.records.toLocaleString()}</td>
                    <td className={td}>
                      {canMap ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button onClick={() => openResolve(f)} className="px-2.5 py-1.5 text-[11px] font-semibold" style={primaryBtn}>Resolve</button>
                          <span className="text-[10px]" style={{ color: '#94A3B8' }}>
                            {f.suggestion ? `suggested: ${f.suggestion.name}` : 'no suggestion'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[10px] font-semibold" style={{ color: '#B45309' }}>
                          ⚠ Requires Administrator Review
                          <span className="block font-normal" style={{ color: '#64748B' }}>Suggested: {f.suggestion?.name || '—'}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {reviewGroup && (
        <LocationReviewPanel
          group={reviewGroup}
          batch={batch}
          onClose={() => { setReviewGroup(null); load(); }}
          onChanged={onChanged}
        />
      )}

      {resolve && (
        <SidePanel
          title={resolve.step === 'options' ? 'Unknown facility'
            : resolve.step === 'match' ? 'Match Existing Facility' : 'Add Reference Facility'}
          subtitle={`Source value: ${resolve.f.facility_text}`}
          onClose={() => setResolve(null)}
          onSubmit={resolve.step === 'match' ? submitMatch : resolve.step === 'register' ? submitRegister : undefined}
          footer={resolve.step === 'match' ? (
            <>
              <button type="submit" disabled={busy === `fac:${resolve.f.alias_norm}`} className="px-4 py-2 text-xs font-semibold disabled:opacity-50" style={primaryBtn}>
                {busy === `fac:${resolve.f.alias_norm}` ? 'Confirming…' : 'Confirm Match'}
              </button>
              <button type="button" onClick={() => setResolve(null)} className="px-4 py-2 text-xs font-medium" style={secondaryBtn}>Cancel</button>
            </>
          ) : resolve.step === 'register' ? (
            <>
              <button type="submit" disabled={busy === 'register'} className="px-4 py-2 text-xs font-semibold disabled:opacity-50" style={primaryBtn}>
                {busy === 'register' ? 'Adding…' : 'Add Facility'}
              </button>
              <button type="button" onClick={() => setResolve(null)} className="px-4 py-2 text-xs font-medium" style={secondaryBtn}>Cancel</button>
            </>
          ) : null}
        >
          {resolve.error && (
            <div className="px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B', border: '1px solid rgba(239,68,68,0.12)' }}>{resolve.error}</div>
          )}

          {resolve.step === 'options' && (
            <>
              <div className="rounded-lg p-3 space-y-3" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                <div>
                  <p className="text-[11px] font-semibold" style={{ color: '#475569' }}>Source Value</p>
                  <p className="text-sm font-bold" style={{ color: '#0F2D52' }}>{resolve.f.facility_text}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold" style={{ color: '#475569' }}>Affected Records</p>
                  <p className="text-sm font-bold" style={{ color: '#0F2D52' }}>
                    {resolve.f.records.toLocaleString()}
                    <span className="ml-2 text-[11px] font-normal" style={{ color: '#64748B' }}>{(resolve.f.fields || []).join(', ')}</span>
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold" style={{ color: '#475569' }}>Suggested</p>
                  <p className="text-xs" style={{ color: resolve.f.suggestion ? '#0F2D52' : '#94A3B8' }}>
                    {resolve.f.suggestion ? resolve.f.suggestion.name : 'No suggestion — choose or register a facility.'}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <button type="button" onClick={() => setResolve(r => ({ ...r, step: 'match', error: '' }))}
                    className="w-full px-4 py-2.5 text-xs font-semibold" style={primaryBtn}>Match Existing Facility</button>
                  <p className="text-[11px] mt-1" style={{ color: '#64748B' }}>
                    Link this name to a facility already in the registry.
                  </p>
                </div>
                <div>
                  <button type="button" onClick={() => setResolve(r => ({ ...r, step: 'register', error: '' }))}
                    className="w-full px-4 py-2.5 text-xs font-semibold" style={secondaryBtn}>Add Reference Facility</button>
                  <p className="text-[11px] mt-1" style={{ color: '#64748B' }}>
                    Register a facility that is not listed yet — private clinics and facilities outside Pasig.
                  </p>
                </div>
                <div>
                  <button type="button" onClick={() => setResolve(null)}
                    className="w-full px-4 py-2.5 text-xs font-medium" style={secondaryBtn}>Keep Pending</button>
                  <p className="text-[11px] mt-1" style={{ color: '#64748B' }}>
                    Leave this name in Needs Assignment to decide later.
                  </p>
                </div>
              </div>
            </>
          )}

          {resolve.step === 'match' && (
            <>
              <div>
                <Label>Source Value</Label>
                <p className="text-xs px-3 py-2 rounded-lg" style={{ ...inputStyle, background: '#F8FAFC' }}>{resolve.f.facility_text}</p>
              </div>
              <label className="block"><Label required>Match to</Label>
                <select className={inputClass} style={inputStyle} value={resolve.matchId} onChange={e => setResolve(r => ({ ...r, matchId: e.target.value }))}>
                  <option value="">Choose facility…</option>
                  {data.facilityOptions.map(o => (
                    <option key={o.id} value={o.id}>{o.name}{o.is_external ? ` (outside Pasig — ${o.city || 'no city'})` : o.barangay_name ? ` — ${o.barangay_name}` : ''}{o.ownership === 'private' ? ' · private' : ''}{o.is_active === false ? ' · inactive' : ''}</option>
                  ))}
                </select>
              </label>
              <p className="text-[11px] leading-relaxed" style={{ color: '#64748B' }}>
                The spelling is saved as an alias, so every future import with this text resolves to the
                same facility automatically — and the {resolve.f.records.toLocaleString()} record(s) already
                in the system are linked now.
              </p>
              <button type="button" onClick={() => setResolve(r => ({ ...r, step: 'options', error: '' }))}
                className="text-[11px] font-semibold" style={{ color: '#64748B' }}>&larr; All options</button>
            </>
          )}

          {resolve.step === 'register' && (
            <>
              <div>
                <Label>Source Value</Label>
                <p className="text-xs px-3 py-2 rounded-lg" style={{ ...inputStyle, background: '#F8FAFC' }}>{resolve.f.facility_text}</p>
              </div>
              <label className="block"><Label required>Facility name</Label>
                <input className={inputClass} style={inputStyle} value={resolve.form.name} onChange={e => setForm({ name: e.target.value })} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><Label>Ownership</Label>
                  <select className={inputClass} style={inputStyle} value={resolve.form.ownership} onChange={e => setForm({ ownership: e.target.value })}>
                    {OWNERSHIP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="block"><Label>Type</Label>
                  <select className={inputClass} style={inputStyle} value={resolve.form.facility_type} onChange={e => setForm({ facility_type: e.target.value })}>
                    {FACILITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
              <label className="block"><Label required>Classification</Label>
                <select className={inputClass} style={inputStyle} value={resolve.form.classification}
                  onChange={e => setForm(e.target.value === 'external'
                    ? { classification: 'external', barangay_name: '' }
                    : { classification: 'pasig', city: '' })}>
                  <option value="pasig">Pasig facility</option>
                  <option value="external">External / Reference Facility (outside Pasig)</option>
                </select>
              </label>
              <label className="block"><Label>Status</Label>
                <select className={inputClass} style={inputStyle} value={resolve.form.status} onChange={e => setForm({ status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              {resolve.form.classification === 'external' ? (
                <label className="block"><Label required>City / municipality</Label>
                  <input className={inputClass} style={inputStyle} value={resolve.form.city} placeholder="e.g. Taytay, Rizal"
                    onChange={e => setForm({ city: e.target.value })} />
                </label>
              ) : (
                <label className="block"><Label required>Pasig barangay</Label>
                  <select className={inputClass} style={inputStyle} value={resolve.form.barangay_name} onChange={e => setForm({ barangay_name: e.target.value })}>
                    <option value="">Select barangay…</option>
                    {data.barangays.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </label>
              )}
              <p className="text-[11px] leading-relaxed" style={{ color: '#64748B' }}>
                {resolve.form.classification === 'external'
                  ? 'An external / reference facility is registered with the city it is really in — never with a Pasig barangay — and stays for reference only.'
                  : 'The facility is added to the registry (shared with TBInsight), so every record listing “' + resolve.f.facility_text + '” maps to it.'}
                {' '}Facilities never affect who can see a record.
              </p>
              <button type="button" onClick={() => setResolve(r => ({ ...r, step: 'options', error: '' }))}
                className="text-[11px] font-semibold" style={{ color: '#64748B' }}>&larr; All options</button>
            </>
          )}
        </SidePanel>
      )}
    </div>
  );
}
