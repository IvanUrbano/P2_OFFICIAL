import { useState, useEffect } from 'react';
import API from '../api/axios';
import { CASE_STATUS_OPTIONS as CASE_STATUSES, OUTCOME_OPTIONS as OUTCOMES, optionsFor, CASE_ID_RE, normalizeCaseId, CASE_ID_HINT } from '../utils/caseOptions';

// Same field set and order as Add TB Record (dropdowns share caseOptions.js).
const CASE_FIELDS = [
  { key: 'source_case_id', label: 'Case ID', type: 'caseid' },
  { key: 'case_status', label: 'Case status', type: 'status' },
  { key: 'treatment_outcome', label: 'Treatment outcome', type: 'outcome' },
  { key: 'date_of_outcome', label: 'Date of outcome', type: 'date' },
  { key: 'outcome_reason', label: 'Outcome reason', type: 'text' },
  { key: 'date_of_screening', label: 'Date of screening', type: 'date' },
  { key: 'date_started_treatment', label: 'Treatment started', type: 'date' },
  { key: 'date_of_notification', label: 'Date of notification', type: 'date' },
  { key: 'treatment_facility', label: 'Treatment facility', type: 'facility' },
  { key: 'screening_facility', label: 'Screening facility', type: 'facility' },
  { key: 'registration_group', label: 'Registration group', type: 'select' },
  { key: 'bacteriological_status', label: 'Bacteriological status', type: 'select' },
  { key: 'anatomical_site', label: 'Anatomical site', type: 'select' },
  { key: 'source_of_patient', label: 'Source of patient', type: 'select' },
];
const IDENTITY_FIELDS = [
  { key: 'last_name', label: 'Last name', type: 'text' },
  { key: 'first_name', label: 'First name', type: 'text' },
  { key: 'middle_name', label: 'Middle name', type: 'text' },
  { key: 'suffix', label: 'Suffix', type: 'text' },
  { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { key: 'sex', label: 'Sex', type: 'sex' },
];

const toInput = (type, v) => (v == null ? '' : type === 'date' ? String(v).slice(0, 10) : String(v));
const inputClass = 'w-full px-3 py-2 text-xs rounded-lg outline-none';
const inputStyle = { background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' };

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

/**
 * Edit case details — shown in the record drawer for cases the user may edit. Sends only
 * the fields that were changed; the server re-checks permission (view-only cases are
 * refused) and validates the result. Barangay and diagnosis date are not edited here.
 */
export default function CaseEditForm({ record, identityUnlocked, deidentified, facilities, onSaved, onCancel }) {
  const fields = [...CASE_FIELDS, ...(identityUnlocked ? IDENTITY_FIELDS : [])];
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(f => [f.key, toInput(f.type, record[f.key])])));
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState({});
  useEffect(() => {
    API.get('/api/data/manual-options').then(r => setOptions(r.data || {})).catch(() => {});
  }, []);

  const setValue = (k, v) => {
    // Entering a treatment start date on a DIAGNOSED case means treatment has begun: switch
    // the status to ON TREATMENT (still changeable before saving; the server does the same).
    const startsTreatment = k === 'date_started_treatment' && v && !values.date_started_treatment
      && values.case_status === 'DIAGNOSED';
    setValues(x => ({
      ...x, [k]: v,
      ...(v && k === 'case_status' ? { treatment_outcome: '' } : v && k === 'treatment_outcome' ? { case_status: '' } : {}),
      ...(startsTreatment ? { case_status: 'ON TREATMENT' } : {}),
    }));
    setTouched(x => ({ ...x, [k]: true, ...(startsTreatment ? { case_status: true } : {}) }));
  };

  const save = async (e) => {
    e.preventDefault();
    const changes = Object.fromEntries(Object.keys(touched).filter(k => !['case_status', 'treatment_outcome'].includes(k)).map(k => [k, values[k]]));
    if (touched.case_status || touched.treatment_outcome) changes.outcome_status = values.treatment_outcome || values.case_status || null;
    if (Object.keys(changes).length === 0) { onCancel(); return; }
    if (changes.source_case_id !== undefined) {
      changes.source_case_id = normalizeCaseId(changes.source_case_id);
      if (changes.source_case_id && !CASE_ID_RE.test(changes.source_case_id)) {
        setErrors([`Case ID must look like ROS-D-2025-00042 (got "${changes.source_case_id}")`]);
        return;
      }
      if (!changes.source_case_id) { setErrors(['Case ID cannot be left blank — it identifies this TB case.']); return; }
    }
    const dx = record.date_of_diagnosis ? String(record.date_of_diagnosis).slice(0, 10) : null;
    const outcomeDate = values.date_of_outcome;
    const dateErrors = [];
    if (outcomeDate && dx && outcomeDate < dx) dateErrors.push('Date of Outcome cannot be earlier than Date of Diagnosis');
    if (outcomeDate && values.date_started_treatment && outcomeDate < values.date_started_treatment) dateErrors.push('Date of Outcome cannot be earlier than Date Started Treatment');
    if (dateErrors.length) { setErrors(dateErrors); return; }
    setSaving(true);
    setErrors([]);
    try {
      const res = await API.put(`/api/data/records/${record.id}`, { changes });
      onSaved(res.data.message);
    } catch (err) {
      setErrors(err.response?.data?.errors || [err.response?.data?.error || 'Failed to save the changes.']);
    } finally {
      setSaving(false);
    }
  };

  const renderInput = (f) => {
    const common = { value: values[f.key], onChange: e => setValue(f.key, e.target.value), className: inputClass, style: inputStyle, 'aria-label': f.label };
    if (f.type === 'date') return <input type="date" {...common} />;
    if (f.type === 'sex') return (
      <FormSelect {...common}><option value="">—</option><option value="Male">Male</option><option value="Female">Female</option></FormSelect>
    );
    if (f.type === 'outcome' || f.type === 'status') return (
      <FormSelect {...common}>
        <option value="">— not set —</option>
        {[...new Set([...(f.type === 'status' ? CASE_STATUSES : OUTCOMES), values[f.key]].filter(Boolean))].map(o => <option key={o} value={o}>{o}</option>)}
      </FormSelect>
    );
    if (f.type === 'select') return (
      <FormSelect {...common}>
        <option value="">—</option>
        {[...new Set([...optionsFor(options, f.key), values[f.key]].filter(Boolean))].map(o => <option key={o} value={o}>{o}</option>)}
      </FormSelect>
    );
    if (f.type === 'caseid') return (
      <>
        <input type="text" {...common} onChange={e => setValue(f.key, e.target.value.toUpperCase())} className={`${inputClass} font-mono`} placeholder="ROS-D-2025-00042" autoComplete="off" />
        <span className="block text-[10px] mt-1" style={{ color: '#94A3B8' }}>{CASE_ID_HINT}</span>
      </>
    );
    if (f.type === 'facility') return (<><input type="text" list="case-edit-facilities" {...common} /></>);
    return <input type="text" {...common} />;
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <datalist id="case-edit-facilities">
        {(facilities || []).map(fac => <option key={fac.id} value={fac.name} />)}
      </datalist>
      {errors.length > 0 && (
        <div className="px-3 py-2 rounded text-[11px]" style={{ background: '#FEF2F2', color: '#991B1B', borderLeft: '3px solid #DC2626' }}>
          <ul className="list-disc ml-4 space-y-0.5">{errors.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      {identityUnlocked && (
        <fieldset>
          <legend className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#64748B' }}>Patient</legend>
          <div className="grid grid-cols-2 gap-3">
            {IDENTITY_FIELDS.map(f => (
              <label key={f.key} className="block">
                <span className="block text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: touched[f.key] ? '#2E6FAF' : '#94A3B8' }}>{f.label}</span>
                {renderInput(f)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset>
        <legend className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#64748B' }}>TB Case</legend>
        <div className="grid grid-cols-2 gap-3">
          {CASE_FIELDS.map(f => (
            <label key={f.key} className="block">
              <span className="block text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: touched[f.key] ? '#2E6FAF' : '#94A3B8' }}>{f.label}</span>
              {renderInput(f)}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-[10px] leading-relaxed" style={{ color: '#64748B' }}>
        {deidentified
          ? 'This is a de-identified historical record: patient name and date of birth are not shown and cannot be changed. '
          : identityUnlocked ? '' : 'Unlock names with your Records PIN to correct name, date of birth or sex. '}
        The patient&apos;s barangay and diagnosis date are changed through Validation and referrals, not here.
        Saved changes are recorded in Case History and sent to TBInsight if the case was already synced.
      </p>
      <div className="sticky bottom-0 -mx-6 px-6 pt-4 pb-6 flex justify-end gap-2" style={{ background: '#ffffff', borderTop: '1px solid rgba(15,45,82,0.08)' }}>
        <button type="button" onClick={onCancel} disabled={saving} className="px-4 py-2 text-xs font-medium" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className="px-4 py-2 text-xs font-semibold disabled:opacity-50" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
