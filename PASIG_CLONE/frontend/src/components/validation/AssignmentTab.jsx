import { useState, useEffect, useCallback } from 'react';
import API from '../../api/axios';
import EmptyState from '../EmptyState';
import SidePanel, { primaryBtn, secondaryBtn } from '../SidePanel';
import { fmtDate, Notice, th, thStyle, td } from './shared';
import { can } from '../../utils/permissions';
import LocationReviewPanel from './LocationReviewPanel';

const OWNERSHIP = [['public', 'Public'], ['private', 'Private']];
const CATEGORIES = [
  ['hospital', 'Hospital'], ['clinic', 'Clinic'], ['health_center', 'Health center'],
  ['laboratory', 'Laboratory'], ['treatment_center', 'Treatment center'], ['other', 'Other'],
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
 *     names, naming variants, unregistered private/external facilities). Map once to a
 *     registry facility, or register the facility first.
 */
export default function AssignmentTab({ batch, refreshKey, onChanged }) {
  const [data, setData] = useState({ locations: [], facilities: [], facilityOptions: [], barangays: [], permissions: {} });
  const canAssign = can(data, 'assignLocation');
  const canMap = can(data, 'mapFacility');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [reviewGroup, setReviewGroup] = useState(null); // location group open in Review Records
  const [facilityChoice, setFacilityChoice] = useState({}); // alias_norm -> facility id
  const [register, setRegister] = useState(null); // { facility_text, form }
  const [registerError, setRegisterError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (batch) params.set('batch', batch);
      const res = await API.get(`/api/data/validation-queue/assignment?${params}`);
      setData(res.data);
      setFacilityChoice(Object.fromEntries((res.data.facilities || []).filter(f => f.suggestion).map(f => [f.alias_norm, String(f.suggestion.id)])));
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
  const classifyOutside = (l) => {
    if (!window.confirm(`Classify all ${l.records} record(s) with City = ${l.city_text} as outside Pasig? They stay in PASIG TB-IS and are not sent to TBInsight.`)) return;
    run(`loc:${locKey(l)}`, () => API.post('/api/data/validation-queue/assignment/location', {
      barangay_text: l.barangay_text, city_text: l.city_text, action: 'outside_pasig', batch: batch || undefined,
    }));
  };

  const mapFacility = (f) => {
    const id = facilityChoice[f.alias_norm];
    if (!id) { setNotice({ type: 'error', text: 'Choose a registry facility first.' }); return; }
    run(`fac:${f.alias_norm}`, () => API.post('/api/data/validation-queue/assignment/facility', {
      facility_text: f.facility_text, action: 'map', facility_id: Number(id),
    }));
  };

  const acceptSuggestions = () => {
    const n = data.facilities.filter(f => f.suggestion).length;
    if (!window.confirm(`Map ${n} facility name(s) to their suggested registry facility?`)) return;
    run('fac:all', () => API.post('/api/data/validation-queue/assignment/facility/accept-suggestions'));
  };

  const openRegister = (f) => {
    const isHospital = /hosp|medical/i.test(f.facility_text);
    setRegisterError('');
    setRegister({
      facility_text: f.facility_text,
      form: {
        name: f.facility_text.replace(/\s*-\s*(IDOTS|MTBN|DOTS)\s*$/i, '').trim(),
        ownership: 'private',
        facility_category: isHospital ? 'hospital' : 'clinic',
        is_external: false,
        barangay_name: '',
        city: '',
      },
    });
  };

  const submitRegister = async (e) => {
    e.preventDefault();
    setRegisterError('');
    const { form } = register;
    if (!form.name.trim()) { setRegisterError('Facility name is required.'); return; }
    if (!form.is_external && !form.barangay_name) { setRegisterError('Choose the Pasig barangay, or mark the facility as outside Pasig.'); return; }
    setBusy('register');
    try {
      const res = await API.post('/api/data/validation-queue/assignment/facility', {
        facility_text: register.facility_text, action: 'register', facility: form,
      });
      setNotice({ type: 'success', text: res.data.message });
      setRegister(null);
      onChanged?.();
      load();
    } catch (err) {
      setRegisterError(err.response?.data?.error || 'Failed to register the facility.');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p className="text-xs text-center py-10" style={{ color: '#94A3B8' }}>Loading…</p>;

  const suggestedCount = data.facilities.filter(f => f.suggestion).length;
  const setForm = (patch) => setRegister(r => ({ ...r, form: { ...r.form, ...patch } }));

  return (
    <div>
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
              Facility names in the records that are not in the registry. Map each name once — every record with that name, now and in future imports, follows. Register private or external facilities that are not listed.
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
              <thead><tr>{['Facility name in records', 'Used as', 'Records', canMap ? 'Map to registry' : 'Suggested'].map(h => <th key={h} className={th} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {data.facilities.map(f => (
                  <tr key={f.alias_norm} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td className={td} style={{ color: '#0F2D52' }}>{f.facility_text}</td>
                    <td className={td} style={{ color: '#64748B' }}>{(f.fields || []).join(', ')}</td>
                    <td className={td} style={{ color: '#0F2D52' }}>{f.records.toLocaleString()}</td>
                    <td className={td}>
                      {canMap ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <select aria-label="Registry facility" value={facilityChoice[f.alias_norm] || ''} onChange={e => setFacilityChoice(c => ({ ...c, [f.alias_norm]: e.target.value }))}
                            className="px-2 py-1.5 text-[11px] rounded outline-none" style={{ ...inputStyle, maxWidth: 220 }}>
                            <option value="">Choose facility…</option>
                            {data.facilityOptions.map(o => (
                              <option key={o.id} value={o.id}>{o.name}{o.is_external ? ' (outside Pasig)' : o.barangay_name ? ` — ${o.barangay_name}` : ''}{o.ownership === 'private' ? ' · private' : ''}</option>
                            ))}
                          </select>
                          <button disabled={busy === `fac:${f.alias_norm}`} onClick={() => mapFacility(f)} className="px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50" style={primaryBtn}>Map</button>
                          <button onClick={() => openRegister(f)} className="px-2.5 py-1.5 text-[11px] font-medium" style={secondaryBtn}>Register new…</button>
                          {f.suggestion && String(facilityChoice[f.alias_norm]) === String(f.suggestion.id) && (
                            <span className="text-[10px]" style={{ color: '#94A3B8' }}>suggested</span>
                          )}
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

      {register && (
        <SidePanel
          title="Register facility"
          subtitle={`From records: ${register.facility_text}`}
          onClose={() => setRegister(null)}
          onSubmit={submitRegister}
          footer={(
            <>
              <button type="submit" disabled={busy === 'register'} className="px-4 py-2 text-xs font-semibold disabled:opacity-50" style={primaryBtn}>{busy === 'register' ? 'Saving…' : 'Register and map'}</button>
              <button type="button" onClick={() => setRegister(null)} className="px-4 py-2 text-xs font-medium" style={secondaryBtn}>Cancel</button>
            </>
          )}
        >
          {registerError && <div className="px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B', border: '1px solid rgba(239,68,68,0.12)' }}>{registerError}</div>}
          <label className="block"><Label required>Facility name</Label>
            <input className={inputClass} style={inputStyle} value={register.form.name} onChange={e => setForm({ name: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><Label>Ownership</Label>
              <select className={inputClass} style={inputStyle} value={register.form.ownership} onChange={e => setForm({ ownership: e.target.value })}>
                {OWNERSHIP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block"><Label>Type</Label>
              <select className={inputClass} style={inputStyle} value={register.form.facility_category} onChange={e => setForm({ facility_category: e.target.value })}>
                {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs" style={{ color: '#0F2D52' }}>
            <input type="checkbox" checked={register.form.is_external} onChange={e => setForm({ is_external: e.target.checked, barangay_name: '' })} />
            Located outside Pasig (external / reference facility)
          </label>
          {register.form.is_external ? (
            <label className="block"><Label>City</Label>
              <input className={inputClass} style={inputStyle} value={register.form.city} placeholder="e.g. Quezon City" onChange={e => setForm({ city: e.target.value })} />
            </label>
          ) : (
            <label className="block"><Label required>Pasig barangay</Label>
              <select className={inputClass} style={inputStyle} value={register.form.barangay_name} onChange={e => setForm({ barangay_name: e.target.value })}>
                <option value="">Select barangay…</option>
                {data.barangays.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          )}
          <p className="text-[11px] leading-relaxed" style={{ color: '#64748B' }}>
            The facility is added to the registry (shared with TBInsight), and every record listing &ldquo;{register.facility_text}&rdquo; is mapped to it. Facilities never affect who can see a record.
          </p>
        </SidePanel>
      )}
    </div>
  );
}
