import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import { useTheme } from '../theme';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import SkeletonBlock from '../components/SkeletonBlock';
import FilterSelect from '../components/FilterSelect';

const cardStyle = (t) => ({
  background: t.cardSolid,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});

const STATUS_TABS = [
  { key: 'all', title: 'All', desc: 'All records' },
  { key: 'valid', title: 'Valid', desc: 'Validated records' },
  { key: 'invalid', title: 'Invalid', desc: 'Failed validation' },
  { key: 'pending', title: 'Pending', desc: 'Awaiting review' },
];

const PASIG_BARANGAYS = [
  'Bagong Ilog', 'Bagong Katipunan', 'Bambang', 'Buting', 'Caniogan', 'Dela Paz',
  'Kalawaan', 'Kapasigan', 'Kapitolyo', 'Malinao', 'Manggahan', 'Maybunga',
  'Oranbo', 'Palatiw', 'Pinagbuhatan', 'Pineda', 'Rosario', 'Sagad',
  'San Antonio', 'San Joaquin', 'San Jose', 'San Miguel', 'San Nicolas',
  'Santa Cruz', 'Santa Lucia', 'Santa Rosa', 'Santo Tomas', 'Santolan',
  'Sumilang', 'Ugong',
];

const EMPTY_FORM = {
  barangay_name: '', date_of_screening: '', date_of_diagnosis: '', date_of_notification: '',
  date_started_treatment: '', date_of_outcome: '', age: '', sex: '',
  screening_facility: '', treatment_facility: '', screening_facility_other: '', treatment_facility_other: '',
  source_of_patient: '', registration_group: '', anatomical_site: '', bacteriological_status: '',
  outcome_status: '', itis_case_id: '',
};

const OUTCOME_OPTIONS = [
  'ON TREATMENT','CURED','TREATMENT COMPLETED','DIED','LOST TO FOLLOW-UP',
  'TREATMENT FAILED','NOT EVALUATED','REFUSED','EXCLUDED',
];

const STATIC_REG = ['NEW','OTHER','PREVIOUS TX OUTCOME UNKNOWN','RELAPSE','TX AFTER FAILURE','TX AFTER LOST TO FF-UP'];
const STATIC_SRC = ['COMMUNITY','OTHER PUBLIC FACILITY','PRIVATE FACILITY','PUBLIC HEALTH CENTER'];
const STATIC_ANAT = ['P','EP'];
const STATIC_BACT = ['SMEAR POSITIVE','SMEAR NEGATIVE','XPERT MTB/RIF DETECTED','XPERT MTB/RIF NOT DETECTED'];

const inputStyle = { background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52', borderRadius: 4 };
const labelStyle = { color: '#0F2D52' };

export default function TBRecordsPage() {
  const { t } = useTheme();
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const perPage = 20;

  // Add-record form state
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formErrors, setFormErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [facilities, setFacilities] = useState([]);
  const [options, setOptions] = useState({ registration_group: [], source_of_patient: [], anatomical_site: [], bacteriological_status: [] });
  const [user, setUser] = useState(null);

  const fetchRecords = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await API.get('/api/data/records');
      setRecords(Array.isArray(res.data.records) ? res.data.records : (Array.isArray(res.data) ? res.data : []));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
    try { setUser(JSON.parse(localStorage.getItem('user') || 'null')); } catch { setUser(null); }
    API.get('/api/facilities').then(r => setFacilities(r.data || [])).catch(() => {});
    API.get('/api/data/manual-options').then(r => setOptions(r.data || {})).catch(() => {});
  }, []);

  const canAdd = user && (user.role === 'admin' || user.role === 'staff');

  const openForm = () => { setForm({ ...EMPTY_FORM }); setFormErrors([]); setResult(null); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setFormErrors([]); setResult(null); };

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const validate = () => {
    const errs = [];
    if (!form.barangay_name) errs.push('Barangay is required');
    if (!form.date_of_diagnosis) errs.push('Date of Diagnosis is required');
    if (form.age === '' || form.age === null || form.age === undefined) errs.push('Age is required');
    if (!form.sex) errs.push('Sex is required');
    if (form.date_of_outcome && form.date_of_diagnosis && form.date_of_outcome < form.date_of_diagnosis) {
      errs.push('Date of Outcome cannot be earlier than Date of Diagnosis');
    }
    if (form.date_of_outcome && form.date_started_treatment && form.date_of_outcome < form.date_started_treatment) {
      errs.push('Date of Outcome cannot be earlier than Date Started Treatment');
    }
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (errs.length) { setFormErrors(errs); return; }
    setFormErrors([]);
    setSaving(true);
    setResult(null);
    const screening = form.screening_facility === '__other__' ? form.screening_facility_other : form.screening_facility;
    const treatment = form.treatment_facility === '__other__' ? form.treatment_facility_other : form.treatment_facility;
    const payload = {
      barangay_name: form.barangay_name,
      date_of_diagnosis: form.date_of_diagnosis || null,
      date_of_screening: form.date_of_screening || null,
      date_of_notification: form.date_of_notification || null,
      date_started_treatment: form.date_started_treatment || null,
      date_of_outcome: form.date_of_outcome || null,
      age: form.age === '' ? null : Number(form.age),
      sex: form.sex || null,
      screening_facility: screening || null,
      treatment_facility: treatment || null,
      source_of_patient: form.source_of_patient || null,
      registration_group: form.registration_group || null,
      anatomical_site: form.anatomical_site || null,
      bacteriological_status: form.bacteriological_status || null,
      outcome_status: form.outcome_status || null,
      itis_case_id: form.itis_case_id || null,
    };
    try {
      const res = await API.post('/api/data/manual-entry', payload);
      setResult({ type: 'success', message: res.data.message || 'TB record created.', sync: res.data.sync });
      fetchRecords();
    } catch (err) {
      const data = err.response?.data;
      if (data?.errors) { setFormErrors(data.errors); }
      else { setFormErrors([data?.error || 'Failed to create TB record.']); }
    } finally {
      setSaving(false);
    }
  };

  const regOptions = options.registration_group?.length ? options.registration_group : STATIC_REG;
  const srcOptions = options.source_of_patient?.length ? options.source_of_patient : STATIC_SRC;
  const anatOptions = options.anatomical_site?.length ? options.anatomical_site : STATIC_ANAT;
  const bactOptions = options.bacteriological_status?.length ? options.bacteriological_status : STATIC_BACT;

  const filtered = records.filter((r) => {
    const matchSearch = !search || [r.barangay_name, r.city, r.source_type, r.sex].some(f => f?.toLowerCase().includes(search.toLowerCase()));
    const matchFilter = filter === 'all' || r.validation_status?.toLowerCase() === filter || (filter === 'valid' && r.is_valid) || (filter === 'invalid' && !r.is_valid);
    return matchSearch && matchFilter;
  });

  const counts = {
    all: records.length,
    valid: records.filter(r => r.is_valid).length,
    invalid: records.filter(r => !r.is_valid).length,
    pending: records.filter(r => r.validation_status?.toLowerCase() === 'pending').length,
  };

  const totalPages = Math.ceil(filtered.length / perPage);
  const paged = filtered.slice((page - 1) * perPage, page * perPage);

  if (loading) return <div className="space-y-4"><SkeletonBlock className="h-12" /><SkeletonBlock className="h-96" /></div>;
  if (error) return <ErrorState message={error} onRetry={fetchRecords} />;

  return (
    <div className="space-y-5">
      {/* Card Header with Tabs */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        {/* Title Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>TB Records</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>View and manage imported tuberculosis records.</p>
          </div>
          <div className="flex gap-2 shrink-0">
            {canAdd && (
              <button onClick={openForm} className="px-4 py-2 text-xs font-semibold flex items-center gap-2" style={{ background: '#16A34A', color: '#ffffff', borderRadius: 4, transition: 'background 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#15803D'; }} onMouseLeave={e => { e.currentTarget.style.background = '#16A34A'; }}>
                + Add TB Record
              </button>
            )}
            <button onClick={() => navigate('/import')} className="px-4 py-2 text-xs font-semibold flex items-center gap-2" style={{ background: '#0F2D52', color: '#ffffff', borderRadius: 4, transition: 'background 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; }} onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; }}>
              Import Data
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div className="flex gap-0 overflow-x-auto">
            {STATUS_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => { setFilter(tab.key); setPage(1); }}
                className="relative px-6 py-3 text-left transition-colors whitespace-nowrap"
                style={{ background: 'transparent' }}
              >
                <p className="text-[13px] font-bold" style={{ color: filter === tab.key ? '#0F2D52' : '#94A3B8' }}>
                  {tab.title}
                  {counts[tab.key] > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[9px] font-bold px-1.5" style={{ background: filter === tab.key ? 'rgba(15,45,82,0.08)' : '#F1F5F9', color: filter === tab.key ? '#0F2D52' : '#64748B' }}>
                      {counts[tab.key]}
                    </span>
                  )}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: filter === tab.key ? '#64748B' : '#CBD5E1' }}>
                  {tab.desc}
                </p>
                {filter === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Search Bar */}
        <div className="px-6 py-3" style={{ background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
          <div className="relative max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#94A3B8' }} />
            <input
              type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by barangay, city, sex, source..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg outline-none"
              style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' }}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: '#FAFCFF', borderBottom: '1px solid #E2E8F0' }}>
                {['Barangay', 'City', 'Source', 'Diagnosis Date', 'Sex', 'Age', 'Status', 'Record'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider" style={{ color: '#0F2D52' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr><td colSpan={8}><EmptyState icon="ri-file-list-line" title="No Records Found" description="There are no records matching your current filters." /></td></tr>
              ) : paged.map((r) => (
                <tr key={r.id} className="hover:bg-blue-50/40 transition-colors" style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: '#0F2D52' }}>{r.barangay_name || '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{r.city || '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{r.source_type}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{r.date_of_diagnosis ? new Date(r.date_of_diagnosis).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{r.sex || '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{r.age || '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.is_valid ? 'Validated' : 'Invalid'} /></td>
                  <td className="px-4 py-3"><StatusBadge status={r.record_status || 'new'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid #E2E8F0', background: '#FAFCFF' }}>
            <span className="text-[11px] font-medium" style={{ color: '#64748B' }}>Page {page} of {totalPages} ({filtered.length} records)</span>
            <div className="flex gap-1.5">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1.5 text-[11px] font-bold rounded-md disabled:opacity-40 transition-colors cursor-pointer" style={{ border: '1px solid #CBD5E1', background: '#ffffff', color: '#0F2D52' }}>Prev</button>
              <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="px-3 py-1.5 text-[11px] font-bold rounded-md disabled:opacity-40 transition-colors cursor-pointer" style={{ border: '1px solid #CBD5E1', background: '#ffffff', color: '#0F2D52' }}>Next</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Slide-over: Add TB Record ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(15,23,42,0.3)' }} onClick={closeForm}>
          <div className="w-full max-w-lg h-full overflow-y-auto" style={{ background: '#ffffff' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4" style={{ background: '#0F2D52', color: '#ffffff' }}>
              <div>
                <h2 className="text-sm font-extrabold">Add TB Record</h2>
                <p className="text-[11px] mt-0.5 opacity-70">Manually enter a new tuberculosis case record.</p>
              </div>
              <button onClick={closeForm} className="text-white/70 hover:text-white text-lg">✕</button>
            </div>

            {/* Result Banner */}
            {result && (
              <div className="mx-6 mt-4 px-4 py-3 rounded-lg text-xs font-semibold" style={{ background: result.sync?.status === 'synced' ? '#DCFCE7' : '#FEF9C3', color: result.sync?.status === 'synced' ? '#166534' : '#854D0E' }}>
                {result.message}
                {result.sync?.status === 'failed' && <span className="block text-[11px] font-normal mt-0.5 opacity-80">Sync failed — record saved. Retry from Sync page.</span>}
              </div>
            )}

            {/* Errors */}
            {formErrors.length > 0 && (
              <div className="mx-6 mt-4 px-4 py-3 rounded-lg text-xs" style={{ background: '#FEF2F2', color: '#991B1B' }}>
                <ul className="list-disc pl-4 space-y-0.5">{formErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              {/* Barangay */}
              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>Barangay *</label>
                <select value={form.barangay_name} onChange={e => setField('barangay_name', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                  <option value="">Select barangay…</option>
                  {PASIG_BARANGAYS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              {/* Dates row 1: screening + diagnosis */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Date of Screening</label>
                  <input type="date" value={form.date_of_screening} onChange={e => setField('date_of_screening', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Date of Diagnosis *</label>
                  <input type="date" value={form.date_of_diagnosis} onChange={e => setField('date_of_diagnosis', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} />
                </div>
              </div>

              {/* Dates row 2: notification + treatment start */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Date of Notification</label>
                  <input type="date" value={form.date_of_notification} onChange={e => setField('date_of_notification', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Date Started Treatment</label>
                  <input type="date" value={form.date_started_treatment} onChange={e => setField('date_started_treatment', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} />
                </div>
              </div>

              {/* Age + Sex */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Age *</label>
                  <input type="number" min="0" max="120" value={form.age} onChange={e => setField('age', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} placeholder="0–120" />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Sex *</label>
                  <select value={form.sex} onChange={e => setField('sex', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                    <option value="">Select…</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
              </div>

              {/* Screening Facility */}
              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>Screening Facility</label>
                <select value={form.screening_facility} onChange={e => setField('screening_facility', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                  <option value="">Select facility…</option>
                  {facilities.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                  <option value="__other__">Other (type below)</option>
                </select>
                {form.screening_facility === '__other__' && (
                  <input type="text" value={form.screening_facility_other} onChange={e => setField('screening_facility_other', e.target.value)} placeholder="Enter facility name" className="w-full px-3 py-2 text-xs outline-none mt-1" style={inputStyle} />
                )}
              </div>

              {/* Treatment Facility */}
              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>Treatment Facility</label>
                <select value={form.treatment_facility} onChange={e => setField('treatment_facility', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                  <option value="">Select facility…</option>
                  {facilities.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                  <option value="__other__">Other (type below)</option>
                </select>
                {form.treatment_facility === '__other__' && (
                  <input type="text" value={form.treatment_facility_other} onChange={e => setField('treatment_facility_other', e.target.value)} placeholder="Enter facility name" className="w-full px-3 py-2 text-xs outline-none mt-1" style={inputStyle} />
                )}
              </div>

              {/* Source of Patient */}
              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>Source of Patient</label>
                <select value={form.source_of_patient} onChange={e => setField('source_of_patient', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                  <option value="">Select…</option>
                  {srcOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

              {/* Registration Group + Anatomical Site */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Registration Group</label>
                  <select value={form.registration_group} onChange={e => setField('registration_group', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                    <option value="">Select…</option>
                    {regOptions.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Anatomical Site</label>
                  <select value={form.anatomical_site} onChange={e => setField('anatomical_site', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                    <option value="">Select…</option>
                    {anatOptions.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>

              {/* Bacteriological Status */}
              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>Bacteriological Status</label>
                <select value={form.bacteriological_status} onChange={e => setField('bacteriological_status', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                  <option value="">Select…</option>
                  {bactOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

              {/* Outcome Status + Date of Outcome */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Outcome Status</label>
                  <select value={form.outcome_status} onChange={e => setField('outcome_status', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                    <option value="">Select…</option>
                    {OUTCOME_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Date of Outcome</label>
                  <input type="date" value={form.date_of_outcome} onChange={e => setField('date_of_outcome', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} />
                </div>
              </div>

              {/* ITIS Case ID (optional, for MN) */}
              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>ITIS Case ID <span className="font-normal opacity-60">(optional)</span></label>
                <input type="text" value={form.itis_case_id} onChange={e => setField('itis_case_id', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} placeholder="For MN records" />
              </div>

              {/* Submit */}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 text-xs font-bold rounded-md disabled:opacity-50 transition-colors" style={{ background: '#16A34A', color: '#ffffff' }}>
                  {saving ? 'Saving…' : 'Save Record'}
                </button>
                <button type="button" onClick={closeForm} className="px-4 py-2.5 text-xs font-bold rounded-md transition-colors" style={{ border: '1px solid #CBD5E1', background: '#ffffff', color: '#0F2D52' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}