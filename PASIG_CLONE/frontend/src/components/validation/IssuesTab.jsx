import { useState, useEffect, useCallback } from 'react';
import API from '../../api/axios';
import EmptyState from '../EmptyState';
import SidePanel, { primaryBtn, secondaryBtn } from '../SidePanel';
import { fullName, Notice, ChipFilter, Pager, FIELD_LABELS, PinHint } from './shared';
import { can } from '../../utils/permissions';

const TYPE = {
  missing_required: { label: 'Missing required value', color: '#991B1B', bg: '#FEF2F2' },
  invalid_date: { label: 'Invalid date', color: '#92400E', bg: '#FFFBEB' },
  invalid_value: { label: 'Invalid value', color: '#6D28D9', bg: '#F5F3FF' },
  incomplete: { label: 'Incomplete data', color: '#475569', bg: '#F1F5F9' },
};

const SECTIONS = [
  { title: 'Patient', fields: ['last_name', 'first_name', 'middle_name', 'suffix', 'date_of_birth', 'sex', 'age'] },
  { title: 'Location', fields: ['barangay_name', 'city'] },
  { title: 'TB case', fields: ['date_of_diagnosis', 'date_started_treatment', 'outcome_status', 'date_of_outcome', 'registration_group', 'bacteriological_status', 'anatomical_site'] },
  { title: 'Facilities', fields: ['treatment_facility', 'screening_facility'] },
];
const DATE_FIELDS = new Set(['date_of_birth', 'date_of_diagnosis', 'date_started_treatment', 'date_of_outcome']);
const NAME_FIELDS = new Set(['last_name', 'first_name', 'middle_name', 'suffix', 'date_of_birth']);
const toInput = (field, v) => (v == null ? '' : DATE_FIELDS.has(field) ? String(v).slice(0, 10) : String(v));

/**
 * Data Issues — rows that failed validation (missing required values, invalid dates,
 * invalid values, incomplete data). Correct them here — once clean they become normal
 * cases in their original batch — or exclude them with a reason.
 */
export default function IssuesTab({ batch, refreshKey, onChanged }) {
  const [data, setData] = useState({ issues: [], typeCounts: {}, pagination: null, identityUnlocked: false, isAdmin: false });
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [fixing, setFixing] = useState(null); // { issue, values, touched, errors, errorFields }
  const [saving, setSaving] = useState(false);
  const [excluding, setExcluding] = useState(null); // { issue, note }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page });
      if (batch) params.set('batch', batch);
      const res = await API.get(`/api/data/validation-queue/issues?${params}`);
      setData(res.data);
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Failed to load data issues.' });
    } finally {
      setLoading(false);
    }
  }, [batch, page]);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { setPage(1); }, [batch]);

  const masked = !data.identityUnlocked;
  // Historical rows: stored names/DOB are de-identified and read-only (server-enforced).
  const deidentifiedField = (issue, f) => Boolean(issue?.record?.identity_deidentified && issue.record.hidden_identity_fields?.includes(f));
  const openFix = (issue) => {
    const values = {};
    SECTIONS.forEach(s => s.fields.forEach(f => {
      // Hidden names are not pre-filled: leaving them empty keeps the stored value.
      values[f] = (masked || issue.record?.identity_deidentified) && NAME_FIELDS.has(f) ? '' : toInput(f, issue.record?.[f]);
    }));
    setFixing({ issue, values, touched: {}, errors: issue.errors || [], errorFields: issue.error_fields || [] });
  };

  const setValue = (f, v) => setFixing(x => ({ ...x, values: { ...x.values, [f]: v }, touched: { ...x.touched, [f]: true } }));

  const saveFix = async (e) => {
    e.preventDefault();
    const changes = Object.fromEntries(Object.keys(fixing.touched).map(f => [f, fixing.values[f]]));
    // An issue with nothing left to fix under the current rules can be saved as is.
    if (Object.keys(changes).length === 0 && !fixing.issue.no_remaining_errors) { setFixing(x => ({ ...x, errors: ['Change at least one field.', ...x.errors.filter(m => m !== 'Change at least one field.')] })); return; }
    setSaving(true);
    try {
      const res = await API.put(`/api/data/validation-queue/issues/${fixing.issue.id}`, { changes });
      setNotice({ type: 'success', text: res.data.message });
      setFixing(null);
      onChanged?.();
      load();
    } catch (err) {
      if (err.response?.status === 422) {
        setFixing(x => ({ ...x, errors: err.response.data.errors || [], errorFields: err.response.data.error_fields || [], touched: {} }));
        load();
      } else {
        setFixing(x => ({ ...x, errors: [err.response?.data?.error || 'Failed to save the correction.'] }));
      }
    } finally {
      setSaving(false);
    }
  };

  const saveExclude = async () => {
    if (!excluding.note.trim()) return;
    setSaving(true);
    try {
      const res = await API.post(`/api/data/validation-queue/issues/${excluding.issue.id}/exclude`, { note: excluding.note });
      setNotice({ type: 'success', text: res.data.message });
      setExcluding(null);
      onChanged?.();
      load();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Failed to exclude the record.' });
      setExcluding(null);
    } finally {
      setSaving(false);
    }
  };

  const visible = type ? data.issues.filter(i => i.issue_types.includes(type)) : data.issues;
  const chips = [
    { key: '', label: 'All', count: data.pagination?.total ?? data.issues.length },
    ...Object.keys(TYPE).filter(k => data.typeCounts[k]).map(k => ({ key: k, label: TYPE[k].label, count: data.typeCounts[k] })),
  ];

  return (
    <div>
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <div className="px-5 pt-4 space-y-3">
        <ChipFilter options={chips} value={type} onChange={setType} />
        <PinHint unlocked={!masked} />
      </div>

      <div className="mt-3">
        {loading ? (
          <p className="text-xs text-center py-10" style={{ color: '#94A3B8' }}>Loading…</p>
        ) : visible.length === 0 ? (
          <EmptyState icon="ri-file-warning-line" title="No Data Issues" description="Every imported row passed validation, or its problems were resolved." />
        ) : (
          <>
            <div className="px-5" style={{ borderTop: '1px solid rgba(15,45,82,0.06)' }}>
              {visible.map(i => (
                <article key={i.id} className="grid grid-cols-1 gap-3 py-4 md:grid-cols-[minmax(150px,0.9fr)_minmax(150px,0.8fr)_minmax(220px,1.5fr)_auto] md:items-start"
                  style={{ borderBottom: '1px solid rgba(15,45,82,0.06)' }}>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold break-words" style={{ color: '#334155' }}>{i.filename || 'Import'}</p>
                    <p className="mt-1 text-[11px]" style={{ color: '#64748B' }}>Row {i.row_number ?? '—'} <span className="mx-1">·</span> {i.source_type || '—'}</p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-xs font-medium break-words" style={{ color: '#334155' }}>{fullName(i.record)}</p>
                    <p className="mt-1 text-[11px] break-words" style={{ color: '#64748B' }}>
                      {i.permissions?.reason === 'other_barangay' && i.barangay_name
                        ? `Assigned Barangay: ${i.barangay_name}`
                        : i.record?.barangay_name || 'No barangay listed'}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mb-1.5">
                      {i.issue_types.map(t => (
                        <span key={t} className="text-[10px] font-medium" style={{ color: TYPE[t]?.color || '#475569' }}>
                          {TYPE[t]?.label || t}
                        </span>
                      ))}
                    </div>
                    {i.errors?.length > 0 ? (
                      <ul className="space-y-1 text-[11px]" style={{ color: '#475569' }}>
                        {i.errors.map((message, index) => <li key={index}>{message}</li>)}
                      </ul>
                    ) : i.no_remaining_errors ? (
                      <p className="text-[11px]" style={{ color: '#526A56' }}>No problems remain under the current rules. Review and save to add this row as a case.</p>
                    ) : (
                      <p className="text-[11px]" style={{ color: '#64748B' }}>Review this row to see the problem details.</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-start gap-2 md:justify-end">
                    {can(i, 'fix') && <button onClick={() => openFix(i)} className="px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap" style={primaryBtn}>Review &amp; Correct</button>}
                    {can(i, 'exclude') && <button onClick={() => setExcluding({ issue: i, note: '' })} className="px-3 py-1.5 text-[11px] font-medium" style={secondaryBtn}>Exclude</button>}
                    {!can(i, 'fix') && !can(i, 'exclude') && (
                      <span className="text-[11px] leading-relaxed md:max-w-[220px] md:text-right" style={{ color: '#64748B' }}>
                        {i.permissions?.reason === 'admin_required'
                          ? 'Administrator review required because the barangay could not be matched.'
                          : `Only ${i.barangay_name || 'the assigned barangay'} staff or an administrator can resolve this record.`}
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <Pager pagination={data.pagination} onPage={setPage} />
          </>
        )}
      </div>

      {fixing && (
        <SidePanel
          title="Fix data issue"
          subtitle={`${fixing.issue.filename || 'Import'} · row ${fixing.issue.row_number ?? '—'} · ${fixing.issue.source_type}`}
          onClose={() => setFixing(null)}
          onSubmit={saveFix}
          footer={(
            <>
              <button type="submit" disabled={saving} className="px-4 py-2 text-xs font-semibold disabled:opacity-50" style={primaryBtn}>{saving ? 'Checking…' : 'Save and re-validate'}</button>
              <button type="button" onClick={() => setFixing(null)} className="px-4 py-2 text-xs font-medium" style={secondaryBtn}>Cancel</button>
            </>
          )}
        >
          {fixing.errors.length > 0 && (
            <div className="px-3 py-2 rounded text-[11px]" style={{ background: '#FEF2F2', color: '#991B1B', borderLeft: '3px solid #DC2626' }}>
              <p className="font-semibold mb-0.5">To fix</p>
              <ul className="list-disc ml-4 space-y-0.5">{fixing.errors.map((m, k) => <li key={k}>{m}</li>)}</ul>
            </div>
          )}
          {masked && (
            <p className="text-[11px]" style={{ color: '#64748B' }}>
              Names and date of birth are hidden. Leave a hidden field empty to keep what the file has, or type a value to correct it.
            </p>
          )}
          {SECTIONS.map(s => (
            <fieldset key={s.title}>
              <legend className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: '#64748B' }}>{s.title}</legend>
              <div className="grid grid-cols-2 gap-3">
                {s.fields.filter(f => !(fixing.issue.record?.identity_deidentified && NAME_FIELDS.has(f))).map(f => {
                  const flagged = fixing.errorFields.includes(f);
                  const deid = deidentifiedField(fixing.issue, f);
                  const hidden = (masked || fixing.issue.record?.identity_deidentified) && NAME_FIELDS.has(f);
                  // The row's location decides which barangay owns it — an assignment
                  // decision the server also refuses for staff (admin only).
                  const locationLocked = s.title === 'Location' && !data.isAdmin;
                  return (
                    <label key={f} className={`block ${['last_name', 'first_name', 'treatment_facility', 'screening_facility'].includes(f) ? 'col-span-2 sm:col-span-1' : ''}`}>
                      <span className="block text-[11px] font-semibold mb-1" style={{ color: flagged ? '#B91C1C' : '#475569' }}>
                        {FIELD_LABELS[f]}{flagged && ' — needs fixing'}
                      </span>
                      {f === 'sex' ? (
                        <select value={fixing.values[f]} onChange={e => setValue(f, e.target.value)} disabled={locationLocked} className="w-full px-3 py-2 text-xs rounded-lg outline-none disabled:opacity-60"
                          style={{ background: '#ffffff', border: `1px solid ${flagged ? '#FCA5A5' : '#E2E8F0'}`, color: '#0F2D52' }}>
                          <option value="">—</option><option>Male</option><option>Female</option>
                        </select>
                      ) : (
                        <input
                          type={DATE_FIELDS.has(f) ? 'date' : f === 'age' ? 'number' : 'text'}
                          value={fixing.values[f]}
                          placeholder={deid ? 'De-identified' : hidden ? 'Hidden — leave empty to keep' : ''}
                          onChange={e => setValue(f, e.target.value)}
                          disabled={locationLocked || deid}
                          className="w-full px-3 py-2 text-xs rounded-lg outline-none disabled:opacity-60"
                          style={{ background: flagged ? '#FFFBFB' : '#ffffff', border: `1px solid ${flagged ? '#FCA5A5' : '#E2E8F0'}`, color: '#0F2D52' }}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
              {s.title === 'Location' && !data.isAdmin && (
                <p className="text-[10px] mt-1.5" style={{ color: '#94A3B8' }}>
                  Location is set by an administrator (Validation → Needs Assignment).
                </p>
              )}
            </fieldset>
          ))}
          <p className="text-[11px] leading-relaxed" style={{ color: '#64748B' }}>
            When everything checks out, the row becomes a case in its original batch. If the patient already exists, it moves to Possible Matches. The imported file itself is never changed.
          </p>
        </SidePanel>
      )}

      {excluding && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/40" onClick={() => !saving && setExcluding(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-900 mb-1">Exclude this row?</h3>
            <p className="text-xs text-gray-600 mb-3">It is kept for the record but will not become a case or be sent to TBInsight.</p>
            <textarea value={excluding.note} onChange={e => setExcluding(x => ({ ...x, note: e.target.value }))} rows={3} autoFocus
              placeholder="Reason (e.g. test row, duplicate of row 12, not a TB case)" aria-label="Reason for excluding"
              className="w-full px-3 py-2 text-xs rounded-lg outline-none resize-none mb-4" style={{ border: '1px solid #E2E8F0', color: '#0F2D52' }} />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setExcluding(null)} disabled={saving} className="px-4 py-2 text-xs font-semibold text-gray-600 border border-gray-300 rounded-lg disabled:opacity-50">Cancel</button>
              <button onClick={saveExclude} disabled={saving || !excluding.note.trim()} className="px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded-lg disabled:opacity-50">{saving ? 'Excluding…' : 'Exclude'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
