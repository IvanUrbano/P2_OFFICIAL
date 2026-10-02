import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import API from '../api/axios';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import SkeletonBlock from '../components/SkeletonBlock';
import RecordDetailDrawer from '../components/RecordDetailDrawer';
import TransfersPanel from '../components/TransfersPanel';

const EMPTY_FORM = {
  last_name: '', first_name: '', middle_name: '', suffix: '', date_of_birth: '',
  barangay_name: '', date_of_screening: '', date_of_diagnosis: '', date_of_notification: '',
  date_started_treatment: '', date_of_outcome: '', sex: '',
  screening_facility: '', treatment_facility: '', screening_facility_other: '', treatment_facility_other: '',
  source_of_patient: '', registration_group: '', anatomical_site: '', bacteriological_status: '',
  outcome_status: '', itis_case_id: '',
};

const OUTCOME_OPTIONS = [
  'ON TREATMENT','CURED','TREATMENT COMPLETED','DIED','LOST TO FF-UP',
  'TREATMENT FAILED','NOT EVALUATED','REFUSED','EXCLUDED',
];

const STATIC_REG = ['NEW','OTHER','PREVIOUS TX OUTCOME UNKNOWN','RELAPSE','TX AFTER FAILURE','TX AFTER LOST TO FF-UP'];
const STATIC_SRC = ['COMMUNITY','OTHER PUBLIC FACILITY','PRIVATE FACILITY','PUBLIC HEALTH CENTER'];
const STATIC_ANAT = ['P','EP'];
const STATIC_BACT = ['SMEAR POSITIVE','SMEAR NEGATIVE','XPERT MTB/RIF DETECTED','XPERT MTB/RIF NOT DETECTED'];

const RESOLUTION_LABELS = {
  same_case: { title: 'Same case', desc: 'Update the existing case with this record' },
  new_episode: { title: 'New episode', desc: 'Same patient, new TB case (new Case ID)' },
  different_person: { title: 'Different person', desc: 'New Patient # and new Case ID' },
};

const inputStyle = { background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52', borderRadius: 4 };
const labelStyle = { color: '#0F2D52' };

function fullName(r) {
  if (!r || (!r.last_name && !r.first_name)) return '—';
  return `${r.last_name || ''}, ${r.first_name || ''}${r.middle_name ? ` ${r.middle_name}` : ''}${r.suffix ? ` ${r.suffix}` : ''}`;
}

function fmtDate(v) {
  return v ? new Date(v).toLocaleDateString() : '—';
}

// Same rule as the server: completed years from date of birth to date of diagnosis.
function computeAge(dob, dx) {
  if (!dob || !dx) return null;
  const [by, bm, bd] = dob.split('-').map(Number);
  const [y, m, d] = dx.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age < 0 ? null : age;
}

function unassignedReason(r, barangays) {
  if (!r.barangay_name) return 'No barangay';
  if (!barangays.some(b => b.toLowerCase() === String(r.barangay_name).toLowerCase())) return 'Unknown barangay';
  return `Non-Pasig city (${r.city})`;
}

export default function TBRecordsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState(null);
  const isAdmin = user?.role === 'admin';

  const [view, setView] = useState(['matches', 'unassigned'].includes(searchParams.get('view')) ? searchParams.get('view') : 'all');
  const [records, setRecords] = useState([]);
  const [counts, setCounts] = useState({ all: 0, matches: 0, unassigned: null });
  const [pagination, setPagination] = useState({ page: 1, totalPages: 0, total: 0 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [rowBusy, setRowBusy] = useState(null);
  const [assignChoice, setAssignChoice] = useState({});
  const [selected, setSelected] = useState([]);
  const [detailId, setDetailId] = useState(null);
  const [transferCount, setTransferCount] = useState(0);
  // Records PIN: patient names/DOB are hidden by the server until unlocked
  const [pinStatus, setPinStatus] = useState({ hasPin: false, unlocked: false, unlockedUntil: null });
  const [pinInput, setPinInput] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinMsg, setPinMsg] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  // Add-record form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formErrors, setFormErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [possibleMatch, setPossibleMatch] = useState(null);
  const [facilities, setFacilities] = useState([]);
  const [PASIG_BARANGAYS, setPasigBarangays] = useState([]);
  const [options, setOptions] = useState({ registration_group: [], source_of_patient: [], anatomical_site: [], bacteriological_status: [] });

  const fetchRecords = async () => {
    if (view === 'transfers') { setLoading(false); return; } // TransfersPanel loads its own data
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page, limit: view === 'matches' ? 200 : 50, view });
      if (search) params.set('search', search);
      const res = await API.get(`/api/data/records?${params}`);
      setRecords(res.data.records || []);
      setSelected([]);
      setCounts(res.data.counts || {});
      setPagination(res.data.pagination || { page: 1, totalPages: 0, total: 0 });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    try { setUser(JSON.parse(localStorage.getItem('user') || 'null')); } catch { setUser(null); }
    // Facilities and the official barangay list both come from the database
    API.get('/api/facilities').then(r => {
      setFacilities(r.data?.facilities || []);
      setPasigBarangays((r.data?.barangays || []).map(b => b.name));
    }).catch(() => {});
    API.get('/api/data/manual-options').then(r => setOptions(r.data || {})).catch(() => {});
  }, []);

  useEffect(() => { fetchRecords(); }, [view, page, search]);

  const loadPinStatus = () => API.get('/api/auth/pin/status').then(r => setPinStatus(r.data)).catch(() => {});
  useEffect(() => { loadPinStatus(); }, []);

  // When the unlock expires, refresh so names are hidden again
  useEffect(() => {
    if (!pinStatus.unlocked || !pinStatus.unlockedUntil) return undefined;
    const ms = new Date(pinStatus.unlockedUntil).getTime() - Date.now();
    const t = setTimeout(() => { loadPinStatus(); fetchRecords(); }, Math.max(ms, 0) + 500);
    return () => clearTimeout(t);
  }, [pinStatus.unlocked, pinStatus.unlockedUntil]);

  const unlockNames = async (e) => {
    e.preventDefault();
    setPinBusy(true);
    setPinMsg('');
    try {
      const res = await API.post('/api/auth/pin/verify', { pin: pinInput });
      setPinStatus(s => ({ ...s, unlocked: true, unlockedUntil: res.data.unlockedUntil }));
      setPinInput('');
      fetchRecords();
    } catch (err) {
      setPinMsg(err.response?.data?.error || 'Could not unlock.');
    } finally {
      setPinBusy(false);
    }
  };

  const lockNames = async () => {
    await API.post('/api/auth/pin/lock').catch(() => {});
    setPinStatus(s => ({ ...s, unlocked: false, unlockedUntil: null }));
    fetchRecords();
  };

  // Transfers tab badge: referrals/transfers waiting for this user's facility to accept
  useEffect(() => {
    if (!user) return;
    API.get('/api/data/transfers?status=pending')
      .then(res => setTransferCount((res.data.transfers || [])
        .filter(t => user.role === 'admin' || t.to_facility_id === user.facility_id).length))
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const switchView = (v) => { setView(v); setPage(1); setNotice(null); };

  const resolve = async (record, resolution) => {
    setRowBusy(record.id);
    setNotice(null);
    try {
      const res = await API.post(`/api/data/records/${record.id}/resolve-match`, { resolution });
      setNotice({ type: 'success', text: `${RESOLUTION_LABELS[resolution].title}: record linked to ${res.data.caseNo}.` });
      fetchRecords();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Failed to resolve match.' });
    } finally {
      setRowBusy(null);
    }
  };

  const toggleSelected = (id) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  const allOnPageSelected = records.length > 0 && records.every(r => selected.includes(r.id));
  const toggleAllOnPage = () => setSelected(allOnPageSelected ? [] : records.map(r => r.id));

  const bulkResolve = async (resolution) => {
    if (selected.length === 0) return;
    const label = resolution === 'suggested' ? 'their suggested option' : `"${RESOLUTION_LABELS[resolution].title}"`;
    if (!window.confirm(`Apply ${label} to ${selected.length} selected match${selected.length === 1 ? '' : 'es'}?`)) return;
    setBulkBusy(true);
    setNotice(null);
    try {
      const res = await API.post('/api/data/records/resolve-matches', { ids: selected, resolution });
      const { resolved, counts, failed } = res.data;
      const parts = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${RESOLUTION_LABELS[k].title.toLowerCase()}`);
      setNotice({
        type: failed.length ? 'error' : 'success',
        text: `Resolved ${resolved} match${resolved === 1 ? '' : 'es'}${parts.length ? ` (${parts.join(', ')})` : ''}.`
          + (failed.length ? ` ${failed.length} could not be resolved: ${[...new Set(failed.map(f => f.error))].join(' ')}` : ''),
      });
      fetchRecords();
    } catch (err) {
      setNotice({
        type: 'error',
        text: err.response?.data?.error
          || (err.response?.status === 404
            ? 'The server does not have this feature yet — restart the PASIG backend (npm run dev) and try again.'
            : `Failed to resolve the selected matches${err.response?.status ? ` (HTTP ${err.response.status})` : ' (server not reachable)'}.`),
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const assign = async (record) => {
    const barangay = assignChoice[record.id];
    if (!barangay) return;
    setRowBusy(record.id);
    setNotice(null);
    try {
      const res = await API.patch(`/api/data/records/${record.id}/assign`, { barangay_name: barangay });
      const s = res.data.sync?.status;
      setNotice({
        type: s === 'failed' ? 'error' : 'success',
        text: `${res.data.message}${s === 'synced' ? ' Sent to TBInsight.' : s === 'failed' ? ` Sync failed: ${res.data.sync.message}` : ' It will be sent with its batch.'}`,
      });
      fetchRecords();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Failed to assign barangay.' });
    } finally {
      setRowBusy(null);
    }
  };

  // ── Add record ──
  const canAdd = user && (user.role === 'admin' || user.role === 'staff');
  const openForm = () => { setForm({ ...EMPTY_FORM }); setFormErrors([]); setResult(null); setPossibleMatch(null); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setFormErrors([]); setResult(null); setPossibleMatch(null); };
  const setField = (k, v) => { setForm(f => ({ ...f, [k]: v })); setPossibleMatch(null); };
  const age = computeAge(form.date_of_birth, form.date_of_diagnosis);

  const validate = () => {
    const errs = [];
    if (!form.last_name.trim()) errs.push('Last name is required');
    if (!form.first_name.trim()) errs.push('First name is required');
    if (!form.date_of_birth) errs.push('Date of birth is required');
    if (!form.barangay_name) errs.push('Barangay is required');
    if (!form.date_of_diagnosis) errs.push('Date of Diagnosis is required');
    if (!form.sex) errs.push('Sex is required');
    if (form.date_of_birth && form.date_of_diagnosis && form.date_of_birth > form.date_of_diagnosis) {
      errs.push('Date of birth cannot be after the date of diagnosis');
    }
    if (form.date_of_outcome && form.date_of_diagnosis && form.date_of_outcome < form.date_of_diagnosis) {
      errs.push('Date of Outcome cannot be earlier than Date of Diagnosis');
    }
    if (form.date_of_outcome && form.date_started_treatment && form.date_of_outcome < form.date_started_treatment) {
      errs.push('Date of Outcome cannot be earlier than Date Started Treatment');
    }
    return errs;
  };

  const submit = async (matchResolution) => {
    const errs = validate();
    if (errs.length) { setFormErrors(errs); return; }
    setFormErrors([]);
    setSaving(true);
    setResult(null);
    const screening = form.screening_facility === '__other__' ? form.screening_facility_other : form.screening_facility;
    const treatment = form.treatment_facility === '__other__' ? form.treatment_facility_other : form.treatment_facility;
    const payload = {
      last_name: form.last_name.trim(),
      first_name: form.first_name.trim(),
      middle_name: form.middle_name.trim() || null,
      suffix: form.suffix.trim() || null,
      date_of_birth: form.date_of_birth,
      barangay_name: form.barangay_name,
      date_of_diagnosis: form.date_of_diagnosis || null,
      date_of_screening: form.date_of_screening || null,
      date_of_notification: form.date_of_notification || null,
      date_started_treatment: form.date_started_treatment || null,
      date_of_outcome: form.date_of_outcome || null,
      sex: form.sex || null,
      screening_facility: screening || null,
      treatment_facility: treatment || null,
      source_of_patient: form.source_of_patient || null,
      registration_group: form.registration_group || null,
      anatomical_site: form.anatomical_site || null,
      bacteriological_status: form.bacteriological_status || null,
      outcome_status: form.outcome_status || null,
      itis_case_id: form.itis_case_id || null,
      ...(matchResolution ? { match_resolution: matchResolution } : {}),
    };
    try {
      const res = await API.post('/api/data/manual-entry', payload);
      setPossibleMatch(null);
      setResult({ message: res.data.message, sync: res.data.sync });
      setForm({ ...EMPTY_FORM });
      fetchRecords();
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 409 && data?.possibleMatch) setPossibleMatch(data.possibleMatch);
      else if (data?.errors) setFormErrors(data.errors);
      else setFormErrors([data?.error || 'Failed to create TB record.']);
    } finally {
      setSaving(false);
    }
  };

  const regOptions = options.registration_group?.length ? options.registration_group : STATIC_REG;
  const srcOptions = options.source_of_patient?.length ? options.source_of_patient : STATIC_SRC;
  const anatOptions = options.anatomical_site?.length ? options.anatomical_site : STATIC_ANAT;
  const bactOptions = options.bacteriological_status?.length ? options.bacteriological_status : STATIC_BACT;
  const facilityList = Array.isArray(facilities) ? facilities : [];

  const tabs = [
    { key: 'all', title: 'All Records', desc: 'Cases with Patient # and Case ID', count: counts.all },
    { key: 'matches', title: 'Possible Matches', desc: 'May be an existing patient — review', count: counts.matches },
    ...(isAdmin ? [{ key: 'unassigned', title: 'Needs Assignment', desc: 'Missing or non-Pasig barangay', count: counts.unassigned }] : []),
    { key: 'transfers', title: 'Transfers', desc: 'Referrals & transfers between facilities', count: transferCount },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>TB Records</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>
              {isAdmin ? 'All patients city-wide.' : 'Patients living in your barangay or treated at your facility.'}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            {canAdd && (
              <button onClick={openForm} className="px-4 py-2 text-xs font-semibold" style={{ background: '#16A34A', color: '#ffffff', borderRadius: 4 }}>
                + Add TB Record
              </button>
            )}
            <button onClick={() => navigate('/import')} className="px-4 py-2 text-xs font-semibold" style={{ background: '#0F2D52', color: '#ffffff', borderRadius: 4 }}>
              Import Data
            </button>
          </div>
        </div>

        <div style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div className="flex gap-0 overflow-x-auto">
            {tabs.map(tab => (
              <button key={tab.key} onClick={() => switchView(tab.key)} className="relative px-6 py-3 text-left whitespace-nowrap" style={{ background: 'transparent' }}>
                <p className="text-[13px] font-bold" style={{ color: view === tab.key ? '#0F2D52' : '#94A3B8' }}>
                  {tab.title}
                  {tab.count > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[9px] font-bold px-1.5"
                      style={{ background: tab.key === 'all' ? '#F1F5F9' : '#FEF3C7', color: tab.key === 'all' ? '#64748B' : '#92400E' }}>
                      {tab.count}
                    </span>
                  )}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: view === tab.key ? '#64748B' : '#CBD5E1' }}>{tab.desc}</p>
                {view === tab.key && <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />}
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 py-3" style={{ background: '#F8FAFC' }}>
          <div className="relative max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#94A3B8' }} />
            <input type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              placeholder={pinStatus.unlocked ? 'Search name, Patient #, Case ID, barangay...' : 'Search Patient #, Case ID, barangay (unlock to search names)'}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg outline-none" style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' }} />
          </div>
        </div>
      </div>

      {/* Records PIN: names and birth dates are hidden until unlocked */}
      {pinStatus.unlocked ? (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-lg text-xs" style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46' }}>
          <i className="ri-lock-unlock-line" />
          <span>Patient names are visible until <b>{new Date(pinStatus.unlockedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b>.</span>
          <button onClick={lockNames} className="ml-auto px-3 py-1 text-[11px] font-bold rounded" style={{ border: '1px solid #6EE7B7', background: '#ffffff', color: '#065F46' }}>Lock now</button>
        </div>
      ) : (
        <form onSubmit={unlockNames} className="flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-lg text-xs" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#334155' }}>
          <i className="ri-lock-line" />
          <span>Patient names and birth dates are hidden for privacy.</span>
          {pinStatus.hasPin ? (
            <div className="flex items-center gap-2 ml-auto">
              <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pinInput}
                onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))} placeholder="PIN"
                className="w-24 px-2 py-1 text-xs outline-none tracking-widest" style={{ border: '1px solid #CBD5E1', borderRadius: 4 }} />
              <button type="submit" disabled={pinBusy || pinInput.length < 4} className="px-3 py-1 text-[11px] font-bold rounded disabled:opacity-40" style={{ background: '#0F2D52', color: '#ffffff' }}>
                {pinBusy ? 'Checking…' : 'Show names'}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => navigate('/settings?tab=security')} className="ml-auto text-[11px] font-bold underline" style={{ color: '#0F2D52' }}>
              Set up your records PIN to view names
            </button>
          )}
          {pinMsg && <span className="w-full text-[11px] font-semibold" style={{ color: '#B91C1C' }}>{pinMsg}</span>}
        </form>
      )}

      {notice && (
        <div className="px-4 py-3 rounded-lg text-xs font-semibold" style={{ background: notice.type === 'error' ? '#FEF2F2' : '#DCFCE7', color: notice.type === 'error' ? '#991B1B' : '#166534' }}>
          {notice.text}
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
        {view === 'transfers' ? (
          <TransfersPanel user={user} onOpenRecord={setDetailId} onCountChange={setTransferCount} />
        ) : loading ? (
          <div className="p-4 space-y-3"><SkeletonBlock className="h-10" /><SkeletonBlock className="h-64" /></div>
        ) : error ? (
          <ErrorState message={error} onRetry={fetchRecords} />
        ) : records.length === 0 ? (
          <EmptyState icon="ri-file-list-line"
            title={view === 'matches' ? 'No Possible Matches' : view === 'unassigned' ? 'Nothing Needs Assignment' : 'No Records Found'}
            description={view === 'matches' ? 'Every record has a confirmed Patient # and Case ID.' : view === 'unassigned' ? 'All records have a Pasig barangay.' : 'There are no records matching your search.'} />
        ) : view === 'matches' ? (
          <div className="divide-y" style={{ borderColor: '#F1F5F9' }}>
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 px-5 py-3" style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
              <label className="flex items-center gap-2 text-[11px] font-bold cursor-pointer mr-2" style={{ color: '#0F2D52' }}>
                <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} className="w-4 h-4 cursor-pointer" />
                Select all on this page ({records.length})
              </label>
              <span className="text-[11px]" style={{ color: '#64748B' }}>{selected.length} selected</span>
              <div className="flex flex-wrap gap-1.5 ml-auto">
                <button disabled={!selected.length || bulkBusy} onClick={() => bulkResolve('suggested')}
                  className="px-3 py-1.5 text-[11px] font-bold rounded-md disabled:opacity-40" style={{ background: '#0F2D52', color: '#ffffff' }}>
                  {bulkBusy ? 'Applying…' : 'Apply suggested'}
                </button>
                {Object.entries(RESOLUTION_LABELS).map(([key, l]) => (
                  <button key={key} disabled={!selected.length || bulkBusy} onClick={() => bulkResolve(key)} title={l.desc}
                    className="px-3 py-1.5 text-[11px] font-bold rounded-md disabled:opacity-40"
                    style={{ background: '#ffffff', color: '#0F2D52', border: '1px solid #CBD5E1' }}>
                    {l.title}
                  </button>
                ))}
              </div>
            </div>
            {records.map(r => (
              <div key={r.id} className="p-5 flex gap-3" style={selected.includes(r.id) ? { background: '#F0F7FF' } : undefined}>
                <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSelected(r.id)}
                  className="w-4 h-4 mt-1 shrink-0 cursor-pointer" aria-label={`Select ${fullName(r)}`} />
                <div className="flex-1 min-w-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#92400E' }}>New record</p>
                    <p className="text-sm font-bold" style={{ color: '#0F2D52' }}>{fullName(r)}</p>
                    <p className="text-[11px] mt-1" style={{ color: '#475569' }}>
                      Born {fmtDate(r.date_of_birth)} · Diagnosed {fmtDate(r.date_of_diagnosis)} · {r.barangay_name || 'No barangay'} · {r.outcome_status || 'No outcome'}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#64748B' }}>
                      Existing case {r.candidate ? `${r.candidate.case_no} · ${r.candidate.patient_no || ''}` : r.match_candidate_case_no}
                    </p>
                    {r.candidate ? (
                      <>
                        <p className="text-sm font-bold" style={{ color: '#0F2D52' }}>{fullName(r.candidate)}</p>
                        <p className="text-[11px] mt-1" style={{ color: '#475569' }}>
                          Born {fmtDate(r.candidate.date_of_birth)} · Diagnosed {fmtDate(r.candidate.date_of_diagnosis)} · {r.candidate.barangay_name || '—'} · {r.candidate.outcome_status || 'No outcome'}
                        </p>
                      </>
                    ) : (
                      <p className="text-[11px]" style={{ color: '#991B1B' }}>The matched case no longer exists — choose Different person.</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {Object.entries(RESOLUTION_LABELS).map(([key, l]) => (
                    <button key={key} disabled={rowBusy === r.id} onClick={() => resolve(r, key)} title={l.desc}
                      className="px-3 py-1.5 text-[11px] font-bold rounded-md disabled:opacity-50"
                      style={r.match_suggestion === key
                        ? { background: '#0F2D52', color: '#ffffff' }
                        : { background: '#ffffff', color: '#0F2D52', border: '1px solid #CBD5E1' }}>
                      {l.title}{r.match_suggestion === key ? ' (suggested)' : ''}
                    </button>
                  ))}
                  <span className="text-[10px]" style={{ color: '#94A3B8' }}>Matched on last name + first name + date of birth</span>
                </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: '#FAFCFF', borderBottom: '1px solid #E2E8F0' }}>
                  {['Patient #', 'Case ID', 'Name', 'Barangay', 'Diagnosis', 'Sex', 'Age', view === 'unassigned' ? 'Reason' : 'Outcome', view === 'unassigned' ? 'Assign Barangay' : 'Source', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: '#0F2D52' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id} className="hover:bg-blue-50/40" style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td className="px-4 py-3 text-xs font-mono font-bold whitespace-nowrap" style={{ color: '#0F2D52' }}>{r.patient_no || '—'}</td>
                    <td className="px-4 py-3 text-xs font-mono whitespace-nowrap" style={{ color: '#0F2D52' }}>{r.case_no || '—'}</td>
                    <td className="px-4 py-3 text-xs font-semibold" style={{ color: '#0F2D52' }}>{fullName(r)}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{r.barangay_name || '—'}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: '#475569' }}>{fmtDate(r.date_of_diagnosis)}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{r.sex || '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{r.age ?? '—'}</td>
                    {view === 'unassigned' ? (
                      <>
                        <td className="px-4 py-3 text-xs" style={{ color: '#92400E' }}>{unassignedReason(r, PASIG_BARANGAYS)}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <select value={assignChoice[r.id] || ''} onChange={e => setAssignChoice(c => ({ ...c, [r.id]: e.target.value }))}
                              className="px-2 py-1 text-[11px] outline-none" style={inputStyle}>
                              <option value="">Select…</option>
                              {PASIG_BARANGAYS.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                            <button disabled={!assignChoice[r.id] || rowBusy === r.id} onClick={() => assign(r)}
                              className="px-2 py-1 text-[11px] font-bold rounded disabled:opacity-40" style={{ background: '#0F2D52', color: '#ffffff' }}>
                              Save
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3"><StatusBadge status={r.outcome_status || '—'} /></td>
                        <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{r.source_type}</td>
                      </>
                    )}
                    <td className="px-4 py-3">
                      <button onClick={() => setDetailId(r.id)} className="px-2 py-1 text-[11px] font-bold rounded" style={{ color: '#2E6FAF' }}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid #E2E8F0', background: '#FAFCFF' }}>
            <span className="text-[11px] font-medium" style={{ color: '#64748B' }}>Page {pagination.page} of {pagination.totalPages} ({pagination.total} records)</span>
            <div className="flex gap-1.5">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-[11px] font-bold rounded-md disabled:opacity-40" style={{ border: '1px solid #CBD5E1', background: '#ffffff', color: '#0F2D52' }}>Prev</button>
              <button onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page >= pagination.totalPages} className="px-3 py-1.5 text-[11px] font-bold rounded-md disabled:opacity-40" style={{ border: '1px solid #CBD5E1', background: '#ffffff', color: '#0F2D52' }}>Next</button>
            </div>
          </div>
        )}
      </div>

      {detailId && (
        <RecordDetailDrawer recordId={detailId} facilities={facilities} onClose={() => setDetailId(null)} />
      )}

      {/* ── Slide-over: Add TB Record ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(15,23,42,0.3)' }} onClick={closeForm}>
          <div className="w-full max-w-lg h-full overflow-y-auto" style={{ background: '#ffffff' }} onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4" style={{ background: '#0F2D52', color: '#ffffff' }}>
              <div>
                <h2 className="text-sm font-extrabold">Add TB Record</h2>
                <p className="text-[11px] mt-0.5 opacity-70">Patient # and Case ID are assigned automatically.</p>
              </div>
              <button onClick={closeForm} className="text-white/70 hover:text-white text-lg">✕</button>
            </div>

            {result && (
              <div className="mx-6 mt-4 px-4 py-3 rounded-lg text-xs font-semibold" style={{ background: result.sync?.status === 'synced' ? '#DCFCE7' : '#FEF9C3', color: result.sync?.status === 'synced' ? '#166534' : '#854D0E' }}>
                {result.message}
                {result.sync?.status === 'failed' && <span className="block text-[11px] font-normal mt-0.5 opacity-80">Sync failed — record saved. Retry from Sync page.</span>}
              </div>
            )}

            {possibleMatch && (
              <div className="mx-6 mt-4 p-4 rounded-lg text-xs" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                <p className="font-bold mb-1" style={{ color: '#92400E' }}>This may be an existing patient</p>
                <p style={{ color: '#475569' }}>
                  Same name and date of birth as case <b>{possibleMatch.case_no}</b> (Patient {possibleMatch.patient_no}), diagnosed {possibleMatch.date_of_diagnosis || '—'}
                  {possibleMatch.barangay_name ? `, ${possibleMatch.barangay_name}` : ''}{possibleMatch.outcome_status ? `, ${possibleMatch.outcome_status}` : ''}.
                </p>
                <div className="flex flex-col gap-1.5 mt-3">
                  {Object.entries(RESOLUTION_LABELS).map(([key, l]) => (
                    <button key={key} type="button" disabled={saving} onClick={() => submit(key)}
                      className="px-3 py-2 text-left rounded-md disabled:opacity-50"
                      style={possibleMatch.suggestion === key ? { background: '#0F2D52', color: '#ffffff' } : { background: '#ffffff', color: '#0F2D52', border: '1px solid #CBD5E1' }}>
                      <span className="font-bold text-[11px]">{l.title}{possibleMatch.suggestion === key ? ' (suggested)' : ''}</span>
                      <span className="block text-[10px] opacity-80">{l.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {formErrors.length > 0 && (
              <div className="mx-6 mt-4 px-4 py-3 rounded-lg text-xs" style={{ background: '#FEF2F2', color: '#991B1B' }}>
                <ul className="list-disc pl-4 space-y-0.5">{formErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}

            <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="px-6 py-5 space-y-4">
              {/* Patient */}
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Patient</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Last Name *</label>
                  <input type="text" value={form.last_name} onChange={e => setField('last_name', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>First Name *</label>
                  <input type="text" value={form.first_name} onChange={e => setField('first_name', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Middle Name</label>
                  <input type="text" value={form.middle_name} onChange={e => setField('middle_name', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Suffix</label>
                  <input type="text" value={form.suffix} onChange={e => setField('suffix', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} placeholder="Jr., III" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Date of Birth *</label>
                  <input type="date" value={form.date_of_birth} onChange={e => setField('date_of_birth', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Sex *</label>
                  <select value={form.sex} onChange={e => setField('sex', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                    <option value="">Select…</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Age</label>
                  <div className="w-full px-3 py-2 text-xs" style={{ ...inputStyle, background: '#F8FAFC', color: '#64748B' }}>
                    {age !== null ? `${age} yrs` : 'Auto'}
                  </div>
                </div>
              </div>
              <p className="text-[10px] -mt-2" style={{ color: '#94A3B8' }}>Age is calculated from date of birth and date of diagnosis.</p>

              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>Barangay *</label>
                <select value={form.barangay_name} onChange={e => setField('barangay_name', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                  <option value="">Select barangay…</option>
                  {PASIG_BARANGAYS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              {/* Case */}
              <p className="text-[10px] font-bold uppercase tracking-wider pt-2" style={{ color: '#64748B' }}>TB Case</p>
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

              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>Screening Facility</label>
                <select value={form.screening_facility} onChange={e => setField('screening_facility', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                  <option value="">Select facility…</option>
                  {facilityList.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                  <option value="__other__">Other (type below)</option>
                </select>
                {form.screening_facility === '__other__' && (
                  <input type="text" value={form.screening_facility_other} onChange={e => setField('screening_facility_other', e.target.value)} placeholder="Enter facility name" className="w-full px-3 py-2 text-xs outline-none mt-1" style={inputStyle} />
                )}
              </div>

              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>Treatment Facility</label>
                <select value={form.treatment_facility} onChange={e => setField('treatment_facility', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                  <option value="">Select facility…</option>
                  {facilityList.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                  <option value="__other__">Other (type below)</option>
                </select>
                {form.treatment_facility === '__other__' && (
                  <input type="text" value={form.treatment_facility_other} onChange={e => setField('treatment_facility_other', e.target.value)} placeholder="Enter facility name" className="w-full px-3 py-2 text-xs outline-none mt-1" style={inputStyle} />
                )}
              </div>

              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>Source of Patient</label>
                <select value={form.source_of_patient} onChange={e => setField('source_of_patient', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                  <option value="">Select…</option>
                  {srcOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

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

              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>Bacteriological Status</label>
                <select value={form.bacteriological_status} onChange={e => setField('bacteriological_status', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                  <option value="">Select…</option>
                  {bactOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

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

              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>ITIS Case ID <span className="font-normal opacity-60">(optional, reference only)</span></label>
                <input type="text" value={form.itis_case_id} onChange={e => setField('itis_case_id', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} placeholder="For MN records" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving || !!possibleMatch} className="flex-1 px-4 py-2.5 text-xs font-bold rounded-md disabled:opacity-50" style={{ background: '#16A34A', color: '#ffffff' }}>
                  {saving ? 'Saving…' : possibleMatch ? 'Choose an option above' : 'Save Record'}
                </button>
                <button type="button" onClick={closeForm} className="px-4 py-2.5 text-xs font-bold rounded-md" style={{ border: '1px solid #CBD5E1', background: '#ffffff', color: '#0F2D52' }}>
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
