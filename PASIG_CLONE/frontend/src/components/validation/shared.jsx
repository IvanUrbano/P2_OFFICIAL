import { patientName } from '../../utils/patientName';
/* Small pieces shared by the Validation tabs. */

export const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const fullName = (r) => patientName(r);

export const FIELD_LABELS = {
  last_name: 'Last name', first_name: 'First name', middle_name: 'Middle name', suffix: 'Suffix',
  date_of_birth: 'Date of birth', sex: 'Sex', age: 'Age', date_of_diagnosis: 'Date of diagnosis',
  date_started_treatment: 'Treatment started', date_of_outcome: 'Date of outcome', outcome_status: 'Outcome',
  barangay_name: 'Barangay', city: 'City', treatment_facility: 'Treatment facility',
  screening_facility: 'Screening facility', registration_group: 'Registration group',
  bacteriological_status: 'Bacteriological status', anatomical_site: 'Anatomical site', itis_case_id: 'ITIS case no.',
};

export function Notice({ notice, onClose }) {
  if (!notice) return null;
  const err = notice.type === 'error';
  return (
    <div className="mx-5 mt-4 px-3 py-2 rounded-lg text-xs flex items-start justify-between gap-3"
      style={{ background: err ? 'rgba(239,68,68,0.05)' : 'rgba(16,185,129,0.06)', color: err ? '#991B1B' : '#047857', border: `1px solid ${err ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.18)'}` }}>
      <span>{notice.text}</span>
      {onClose && <button onClick={onClose} aria-label="Dismiss" style={{ color: 'inherit' }}><i className="ri-close-line" /></button>}
    </div>
  );
}

/* Pill filter row: [All 12] [Duplicate 3] ... */
export function ChipFilter({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button key={o.key || 'all'} type="button" onClick={() => onChange(o.key)}
            className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
            style={active
              ? { background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52' }
              : { background: '#ffffff', color: '#475569', border: '1px solid #E2E8F0' }}>
            {o.label}{o.count != null && <span className="ml-1 opacity-70">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Pager({ pagination, onPage }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, totalPages, total } = pagination;
  const btn = { background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 };
  return (
    <div className="flex items-center justify-between px-5 py-3 text-[11px]" style={{ borderTop: '1px solid #F1F5F9', color: '#64748B' }}>
      <span>Page {page} of {totalPages} · {total.toLocaleString()} records</span>
      <div className="flex gap-1.5">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="px-2.5 py-1 disabled:opacity-40" style={btn}>Previous</button>
        <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="px-2.5 py-1 disabled:opacity-40" style={btn}>Next</button>
      </div>
    </div>
  );
}

export const th = 'px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide whitespace-nowrap';
export const thStyle = { color: '#64748B', background: '#FAFCFF', borderBottom: '1px solid #E2E8F0' };
export const td = 'px-4 py-3 text-xs align-top';

export function PinHint({ unlocked }) {
  if (unlocked) return null;
  return (
    <p className="text-[11px] px-3 py-2 rounded" style={{ background: '#F8FAFC', color: '#64748B', borderLeft: '3px solid #94A3B8' }}>
      Patient names are hidden. Unlock them with your Records PIN on the TB Records page to compare names.
    </p>
  );
}
