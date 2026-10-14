import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import API from '../api/axios';
import { patientName } from '../utils/patientName';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import SkeletonBlock from '../components/SkeletonBlock';
import RecordDetailDrawer from '../components/RecordDetailDrawer';
import IncomingReferrals from '../components/IncomingReferrals';
import RowMenu from '../components/RowMenu';
import ProgressOverlay from '../components/ProgressOverlay';
import TablePagination from '../components/TablePagination';
import FilterSelect from '../components/FilterSelect';
import { can, accessBasis } from '../utils/permissions';
import { caseIdOf, caseIdLabel, systemRefOf } from '../utils/caseId';
import { CASE_STATUS_OPTIONS, OUTCOME_OPTIONS, optionsFor, CASE_ID_RE, normalizeCaseId, CASE_ID_HINT } from '../utils/caseOptions';
import ModalCloseButton from '../components/ModalCloseButton';

const EMPTY_FORM = {
  source_case_id: '',
  last_name: '', first_name: '', middle_name: '', suffix: '', date_of_birth: '',
  barangay_name: '', date_of_screening: '', date_of_diagnosis: '', date_of_notification: '',
  date_started_treatment: '', date_of_outcome: '', sex: '',
  screening_facility: '', treatment_facility: '', screening_facility_other: '', treatment_facility_other: '',
  source_of_patient: '', registration_group: '', anatomical_site: '', bacteriological_status: '',
  case_status: '', treatment_outcome: '',
};

const RESOLUTION_LABELS = {
  same_case: { title: 'Same case', desc: 'Fill in the Case ID on the existing case (it has none yet)' },
  new_episode: { title: 'New episode', desc: 'Same patient, new TB episode with the Case ID you entered' },
  different_person: { title: 'Different person', desc: 'A different patient who happens to share the name and date of birth' },
};

const inputStyle = { background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52', borderRadius: 4 };
const labelStyle = { color: '#0F2D52' };

const fullName = (r) => patientName(r);

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

/* Table columns — same table UI as Health Facilities: navy header, click-to-sort.
   `field` maps to the whitelisted sort keys on GET /records (null = not sortable). */
const RECORD_COLUMNS = [
  { label: 'Case ID', field: 'case' },
  { label: 'Name', field: 'patient' },
  { label: 'Barangay', field: 'barangay' },
  { label: 'Diagnosis', field: 'date' },
  { label: 'Sex', field: 'sex' },
  { label: 'Age', field: 'age' },
  { label: 'Facility (Screening)', field: 'facility' },
  { label: 'Bacteriologic Status', field: 'bact' },
  { label: 'Case Status', field: 'status' },
  { label: 'Treatment Outcome', field: 'outcome' },
  { label: 'Source', field: 'source' },
  { label: 'Access', field: null },
  { label: '', field: null },
];

const SOURCE_STYLES = {
  DSTB: { background: '#EAF1F8', color: '#526B85' },
  MN: { background: '#F0EDF3', color: '#695C74' },
  MANUAL: { background: '#F1F3F5', color: '#475569' },
};


// Returning patient marker: the registration group says previously treated (Relapse,
// treatment after failure / lost to follow-up, previous outcome unknown) and/or another
// episode of the same Patient # is on file.
function ReturningBadge({ record }) {
  const others = Number(record.other_episodes) || 0;
  if (!record.treatment_history && others === 0) return null;
  const label = record.treatment_history || 'Returning patient';
  const episodes = others > 0 ? ` · ${others + 1} episodes` : '';
  return (
    <span className="block mt-0.5 w-fit max-w-full truncate text-[10px] font-bold px-1.5 py-[1px] rounded"
      style={{ background: '#F5F3FF', color: '#6D28D9' }}
      title={others > 0 ? `${label}. ${others} other TB episode${others > 1 ? 's' : ''} of this patient on file.` : `${label}. No earlier episode is recorded in this system.`}>
      {label}{episodes}
    </span>
  );
}

export default function TBRecordsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState(null);
  const isAdmin = user?.role === 'admin';

  // Possible Matches and Needs Assignment moved to the Validation page.
  // Incoming Referrals keeps legacy ?view=transfers links; archived cases have their own list.
  const initialView = searchParams.get('view');
  const [view, setView] = useState(['referrals', 'transfers'].includes(initialView) ? 'referrals' : ['archived', 'previously_treated'].includes(initialView) ? initialView : 'all');
  useEffect(() => {
    const old = searchParams.get('view');
    if (old === 'matches') navigate('/validation?tab=matches', { replace: true });
    if (old === 'unassigned') navigate('/validation?tab=assignment', { replace: true });
  }, [searchParams, navigate]);
  const [records, setRecords] = useState([]);
  const [counts, setCounts] = useState({ all: 0, matches: 0, unassigned: null, archived: 0, previously_treated: 0 });
  const [pagination, setPagination] = useState({ page: 1, totalPages: 0, total: 0 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState({ field: 'id', dir: 'desc' });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [barangayFilter, setBarangayFilter] = useState('');
  const [caseStatusFilter, setCaseStatusFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const hasActiveFilters = Boolean(searchInput || barangayFilter || caseStatusFilter || outcomeFilter);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [restoring, setRestoring] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [detailMode, setDetailMode] = useState('view'); // 'view' | 'edit' | 'refer'
  const [rowMenu, setRowMenu] = useState(null); // { record, anchor }
  const openDetail = (id, mode = 'view') => { setDetailMode(mode); setDetailId(id); };
  // Notification links: ?view=referrals opens Incoming Referrals, ?record=<id> opens that case.
  useEffect(() => {
    if (['referrals', 'transfers'].includes(searchParams.get('view'))) setView('referrals');
    else if (['archived', 'previously_treated'].includes(searchParams.get('view'))) setView(searchParams.get('view'));
    const recordId = Number(searchParams.get('record'));
    if (Number.isInteger(recordId) && recordId > 0) {
      setView('all');
      openDetail(recordId, 'view');
    }
  }, [searchParams]);
  const [referralCount, setReferralCount] = useState(0);
  // Records PIN: patient names/DOB are hidden by the server until unlocked
  const [pinStatus, setPinStatus] = useState({ hasPin: false, unlocked: false, unlockedUntil: null });
  const [pinInput, setPinInput] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinMsg, setPinMsg] = useState('');

  // Add-record form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formErrors, setFormErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [possibleMatch, setPossibleMatch] = useState(null);
  const [facilities, setFacilities] = useState([]);
  const [PASIG_BARANGAYS, setPasigBarangays] = useState([]);
  const [barangayRefs, setBarangayRefs] = useState([]);
  const [options, setOptions] = useState({ registration_group: [], source_of_patient: [], anatomical_site: [], bacteriological_status: [] });

  const fetchRecords = async () => {
    if (view === 'referrals') { setLoading(false); return; } // IncomingReferrals loads its own data
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page, limit: pageSize, view });
      if (search) params.set('search', search);
      if (barangayFilter) params.set('barangay', barangayFilter);
      if (caseStatusFilter) params.set('status', caseStatusFilter);
      if (outcomeFilter) params.set('outcome', outcomeFilter);
      params.set('sort', sort.field);
      params.set('dir', sort.dir);
      const res = await API.get(`/api/data/records?${params}`);
      setRecords(res.data.records || []);
      setCounts(res.data.counts || {});
      setPagination(res.data.pagination || { page: 1, totalPages: 0, total: 0 });
      if (res.data.pagination?.total > 0 && page > res.data.pagination.totalPages) {
        setPage(res.data.pagination.totalPages);
      }
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
      setBarangayRefs(r.data?.barangays || []);
    }).catch(() => {});
    API.get('/api/data/manual-options').then(r => setOptions(r.data || {})).catch(() => {});
  }, []);

  useEffect(() => { fetchRecords(); }, [view, page, pageSize, search, barangayFilter, caseStatusFilter, outcomeFilter, sort]);

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
      const res = await API.post('/api/auth/pin/verify', { pin: pinInput }, { skipAuthRedirect: true });
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

  // Incoming Referrals badge: referrals this user may accept (server-decided permission)
  useEffect(() => {
    if (!user) return;
    API.get('/api/data/transfers?direction=incoming&status=pending')
      .then(res => setReferralCount((res.data.transfers || []).filter(t => can(t, 'accept')).length))
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Row ⋮ menu — every item mirrors a server permission (utils/permissions.js); the API
  // refuses the same actions on view-only cases.
  const viewOnlyReason = (r) => (accessBasis(r) === 'referred_out'
    ? `Referred to ${r.responsible_barangay} — they handle this case`
    : 'View only for your account');
  const archiveRecord = async () => {
    if (!archiveTarget || archiving) return;
    const record = archiveTarget;
    setArchiving(true);
    try {
      await API.patch(`/api/data/records/${record.id}/archive`);
      setArchiveTarget(null);
      setNotice({ type: 'success', text: `${caseIdLabel(record)} archived.` });
      fetchRecords();
    } catch (err) {
      setArchiveError(err.response?.data?.error || 'Failed to archive the record.');
    } finally {
      setArchiving(false);
    }
  };
  const restoreRecord = async (record) => {
    if (!isAdmin || restoring !== null) return;
    setRestoring(record.id);
    setNotice(null);
    try {
      const res = await API.patch(`/api/data/records/${record.id}/restore`);
      setNotice({ type: 'success', text: res.data.message || `${caseIdLabel(record)} restored.` });
      await fetchRecords();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Failed to restore the record.' });
    } finally {
      setRestoring(null);
    }
  };
  const rowMenuItems = (r) => r.is_archived
    ? [
      { label: 'View details', icon: 'ri-eye-line', onClick: () => openDetail(r.id) },
      ...(isAdmin ? [
        { divider: true },
        { label: 'Restore', icon: 'ri-arrow-go-back-line', onClick: () => restoreRecord(r) },
      ] : []),
    ]
    : [
      { label: 'View details', icon: 'ri-eye-line', onClick: () => openDetail(r.id) },
      { label: 'Edit details', icon: 'ri-edit-line', disabled: !can(r, 'edit'), reason: viewOnlyReason(r), onClick: () => openDetail(r.id, 'edit') },
      { label: 'Refer case', icon: 'ri-share-forward-line', disabled: !can(r, 'refer'), reason: can(r, 'edit') ? 'Not available for this case' : viewOnlyReason(r), onClick: () => openDetail(r.id, 'refer') },
      { divider: true },
      { label: 'Archive', icon: 'ri-archive-line', danger: true, disabled: !can(r, 'archive'), reason: viewOnlyReason(r), onClick: () => { setArchiveError(''); setArchiveTarget(r); } },
    ];

  const switchView = (v) => {
    setView(v);
    setPage(1);
    setNotice(null);
    if (v === 'archived') {
      setSearchInput('');
      setSearch('');
      setBarangayFilter('');
      setCaseStatusFilter('');
      setOutcomeFilter('');
    }
  };

  // Server-side sort (the list is paginated, so ordering happens in SQL). A newly
  // clicked column starts ascending; clicking the active one toggles it.
  const handleSort = (field) => {
    setSort(s => ({ field, dir: s.field === field ? (s.dir === 'asc' ? 'desc' : 'asc') : 'asc' }));
    setPage(1);
  };


  // ── Add record ──
  const canAdd = user && (user.role === 'admin' || user.role === 'staff');
  const openForm = () => { setForm({ ...EMPTY_FORM }); setFormErrors([]); setResult(null); setPossibleMatch(null); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setFormErrors([]); setResult(null); setPossibleMatch(null); };
  const setField = (k, v) => { setForm(f => ({ ...f, [k]: v })); setPossibleMatch(null); };
  const age = computeAge(form.date_of_birth, form.date_of_diagnosis);

  const validate = () => {
    const errs = [];
    const caseId = normalizeCaseId(form.source_case_id);
    if (!caseId) errs.push('Case ID is required — enter the Case ID from DSTB/MN');
    else if (!CASE_ID_RE.test(caseId)) errs.push(`Case ID must look like ROS-D-2025-00042 (got "${form.source_case_id.trim()}")`);
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
      source_case_id: normalizeCaseId(form.source_case_id),
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
      outcome_status: form.treatment_outcome || form.case_status || null,
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
      else if (err.response?.status === 409 && data?.code === 'DUPLICATE_CASE_ID') {
        setFormErrors([`${data.error}${data.existingCase?.date_of_diagnosis ? ` (diagnosed ${data.existingCase.date_of_diagnosis})` : ''}`]);
      }
      else setFormErrors([data?.error || 'Failed to create TB record.']);
    } finally {
      setSaving(false);
    }
  };

  const regOptions = optionsFor(options, 'registration_group');
  const srcOptions = optionsFor(options, 'source_of_patient');
  const anatOptions = optionsFor(options, 'anatomical_site');
  const bactOptions = optionsFor(options, 'bacteriological_status');
  const facilityList = Array.isArray(facilities) ? facilities : [];

  const tabs = [
    { key: 'all', title: 'All Records', desc: 'Validated cases with their Case ID', count: counts.all },
    { key: 'previously_treated', title: 'Previously Treated', desc: 'Relapse and other returning patients', count: counts.previously_treated },
    { key: 'archived', title: 'Archived Cases', desc: 'Stored cases removed from active lists', count: counts.archived },
    { key: 'referrals', title: 'Incoming Referrals', desc: isAdmin ? 'Referrals between barangays' : 'Cases referred to your barangay', count: referralCount },
  ];

  return (
    <div className="space-y-5">
      <ProgressOverlay
        open={archiving}
        title={`Archiving ${caseIdLabel(archiveTarget)}`}
        detail="Hiding the record from lists and analysis. It is kept for the record."
        tone="#D97706"
      />
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>TB Records</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>
              {isAdmin ? 'View and manage TB cases city-wide.' : 'View and manage TB cases assigned to your barangay.'}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            {canAdd && (
              <button onClick={openForm} className="px-4 py-2 text-xs font-semibold" style={{ background: '#047857', color: '#ffffff', borderRadius: 4 }}>
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
                <p className="text-[13px] font-bold" style={{ color: view === tab.key ? '#0F2D52' : '#334155' }}>
                  {tab.title}
                  {tab.count > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[9px] font-bold px-1.5"
                      style={{ background: tab.key === 'all' ? '#F1F5F9' : '#FEF3C7', color: tab.key === 'all' ? '#64748B' : '#92400E' }}>
                      {tab.count}
                    </span>
                  )}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: view === tab.key ? '#475569' : '#64748B' }}>{tab.desc}</p>
                {view === tab.key && <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />}
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 py-3 flex flex-wrap gap-3 items-center" style={{ background: '#F8FAFC' }}>
          <div className="relative max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#94A3B8' }} />
            <input type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              placeholder={pinStatus.unlocked ? 'Search name, Case ID, barangay...' : 'Search Case ID, barangay (unlock to search names)'}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg outline-none" style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' }} />
          </div>
          <FilterSelect label="Barangay" value={barangayFilter} onChange={value => { setBarangayFilter(value); setPage(1); }} selectStyle={{ maxWidth: 170 }}>
            <option value="">All Barangays</option>
            {PASIG_BARANGAYS.map(barangay => <option key={barangay} value={barangay}>{barangay}</option>)}
          </FilterSelect>
          <FilterSelect label="Case Status" value={caseStatusFilter} onChange={value => { setCaseStatusFilter(value); setPage(1); }}>
            <option value="">All statuses</option>
            {CASE_STATUS_OPTIONS.map(status => <option key={status} value={status}>{status}</option>)}
          </FilterSelect>
          <FilterSelect label="Treatment Outcome" value={outcomeFilter} onChange={value => { setOutcomeFilter(value); setPage(1); }}>
            <option value="">All outcomes</option>
            {OUTCOME_OPTIONS.map(outcome => <option key={outcome} value={outcome}>{outcome}</option>)}
          </FilterSelect>
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              setSearch('');
              setBarangayFilter('');
              setCaseStatusFilter('');
              setOutcomeFilter('');
              setPage(1);
            }}
            disabled={!hasActiveFilters}
            className="ml-auto px-3 py-2 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Records PIN: names and birth dates are hidden until unlocked */}
      {pinStatus.unlocked ? (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-lg text-xs" style={{ background: '#F1F5F1', border: '1px solid #D4DED3', color: '#526653' }}>
          <i className="ri-lock-unlock-line" />
          <span>Patient names are visible until <b>{new Date(pinStatus.unlockedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b>.</span>
          <button onClick={lockNames} className="ml-auto px-3 py-1 text-[11px] font-semibold rounded" style={{ border: '1px solid #C8D5C6', background: '#ffffff', color: '#526653' }}>Lock now</button>
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
        {view === 'all' && (counts.matches > 0 || counts.unassigned > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-[11px]" style={{ background: '#FFFBEB', borderBottom: '1px solid #FDE68A', color: '#92400E' }}>
            <span>
              {[counts.matches > 0 && `${counts.matches} possible match${counts.matches === 1 ? '' : 'es'}`,
                counts.unassigned > 0 && `${counts.unassigned} record${counts.unassigned === 1 ? '' : 's'} needing assignment`].filter(Boolean).join(' and ')}
              {' '}{counts.matches + (counts.unassigned || 0) === 1 ? 'is' : 'are'} waiting to be resolved in Validation.{counts.matches > 0 ? ' Possible matches are not listed here until decided.' : ''}
            </span>
            <button onClick={() => navigate(counts.matches > 0 ? '/validation?tab=matches' : '/validation?tab=assignment')}
              className="px-2.5 py-1 font-semibold" style={{ background: '#92400E', color: '#ffffff', borderRadius: 4 }}>Open Validation</button>
          </div>
        )}
        {view === 'referrals' ? (
          <IncomingReferrals user={user} onOpenRecord={(id) => openDetail(id)} onCountChange={setReferralCount} />
        ) : loading ? (
          <div className="p-4 space-y-3"><SkeletonBlock className="h-10" /><SkeletonBlock className="h-64" /></div>
        ) : error ? (
          <ErrorState message={error} onRetry={fetchRecords} />
        ) : records.length === 0 ? (
          <EmptyState icon="ri-file-list-line"
            title={view === 'archived' ? 'No Archived Cases' : view === 'previously_treated' ? 'No Previously Treated Patients' : 'No Records Found'}
            description={view === 'archived' ? 'There are no archived cases matching your search.'
              : view === 'previously_treated' ? 'No relapse or other returning patients match your search.'
              : 'There are no records matching your search.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-left" style={{ borderCollapse: 'collapse' }}>
              <colgroup>
                {[11, 15, 8, 7, 4, 3, 10, 10, 7, 9, 5, 7, 4].map((width, index) => (
                  <col key={RECORD_COLUMNS[index].label} style={{ width: `${width}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr style={{ background: '#0F2D52' }}>
                  {RECORD_COLUMNS.map(({ label, field }, idx) => {
                    const isActive = field && sort.field === field;
                    return (
                      <th
                        key={label}
                        className={`${idx === 0 ? 'pl-3' : 'px-1.5'} py-2 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${field ? 'cursor-pointer select-none' : ''}`}
                        style={{
                          color: isActive ? '#93C5FD' : '#ffffff',
                          borderBottom: '1px solid #1E40AF',
                          borderRight: idx < RECORD_COLUMNS.length - 1 ? '1px solid #1E40AF' : 'none',
                          transition: 'color 0.15s',
                        }}
                        onClick={field ? () => handleSort(field) : undefined}
                        onMouseEnter={(e) => { if (field && !isActive) e.currentTarget.style.color = '#CBD5E1'; }}
                        onMouseLeave={(e) => { if (field && !isActive) e.currentTarget.style.color = '#ffffff'; }}
                      >
                        <span className="inline-flex items-center gap-1">
                          {label || <span className="sr-only">Actions</span>}
                          {field && (
                            <span className="inline-flex flex-col leading-none" style={{ gap: '1px' }}>
                              <i className="ri-arrow-up-s-line" style={{ fontSize: '8px', lineHeight: '8px', color: isActive && sort.dir === 'asc' ? '#93C5FD' : 'rgba(255,255,255,0.25)' }} />
                              <i className="ri-arrow-down-s-line" style={{ fontSize: '8px', lineHeight: '8px', color: isActive && sort.dir === 'desc' ? '#93C5FD' : 'rgba(255,255,255,0.25)' }} />
                            </span>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={r.id} className={`hover:bg-blue-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'}`} style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <td className="pl-3 pr-1.5 py-2.5 text-[11px] font-mono font-bold whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: '#0F2D52', borderRight: '1px solid #E2E8F0' }} title={caseIdOf(r) || undefined}>{caseIdOf(r) || <span className="font-normal italic" style={{ color: '#94A3B8' }}>No Case ID</span>}{!caseIdOf(r) && systemRefOf(r) && <span className="block text-[10px] font-normal not-italic" style={{ color: '#94A3B8' }}>System Reference {systemRefOf(r)}</span>}</td>
                    <td className="px-1.5 py-2.5 text-[11px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: '#0F2D52', borderRight: '1px solid #E2E8F0' }} title={fullName(r)}>{fullName(r)}<ReturningBadge record={r} /></td>
                    <td className="px-1.5 py-2.5 text-[11px]" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>
                      {r.barangay_name || '—'}
                      {/* Responsibility moved by an accepted referral (patient barangay itself never changes) */}
                      {r.responsible_barangay && r.responsible_barangay !== r.barangay_name && (
                        <span className="block text-[10px] mt-0.5" style={{ color: accessBasis(r) === 'referred_out' ? '#B45309' : '#2E6FAF' }}>
                          {accessBasis(r) === 'referred_in'
                            ? 'Referred to your barangay'
                            : `Referred to ${r.responsible_barangay}${!can(r, 'edit') ? ' · view only' : ''}`}
                        </span>
                      )}
                    </td>
                    <td className="px-1.5 py-2.5 text-[11px] whitespace-nowrap" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{fmtDate(r.date_of_diagnosis)}</td>
                    <td className="px-1.5 py-2.5 text-[11px]" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{r.sex || '—'}</td>
                    <td className="px-1.5 py-2.5 text-[11px]" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{r.age ?? '—'}</td>
                    <td className="px-1.5 py-2.5 text-[11px] whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }} title={r.screening_facility || undefined}>{r.screening_facility || '—'}</td>
                    <td className="px-1.5 py-2.5 text-[11px] whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }} title={r.bacteriological_status || undefined}>{r.bacteriological_status || '—'}</td>
                    <td className="px-1.5 py-2.5" style={{ borderRight: '1px solid #E2E8F0' }}><StatusBadge status={r.case_status || '—'} /></td>
                    <td className="px-1.5 py-2.5" style={{ borderRight: '1px solid #E2E8F0' }}>{r.treatment_outcome ? <StatusBadge status={r.treatment_outcome} /> : r.case_status ? <span className="text-[11px] cursor-help" style={{ color: '#94A3B8' }} title={r.case_status === 'DIAGNOSED' ? 'Diagnosed, not yet on treatment — no final outcome yet' : 'Still on treatment — no final outcome yet'}>—</span> : <StatusBadge status="—" />}</td>
                    <td className="px-1.5 py-2.5" style={{ borderRight: '1px solid #E2E8F0' }}>
                      <span className="inline-flex px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full whitespace-nowrap"
                        style={SOURCE_STYLES[r.source_type] || SOURCE_STYLES.MANUAL}>
                        {r.source_type || '—'}
                      </span>
                    </td>
                    <td className="px-1.5 py-2.5 whitespace-nowrap" style={{ borderRight: '1px solid #E2E8F0' }}>
                      {/* From the server's permission decision — the API also refuses edits on view-only cases. */}
                      {can(r, 'edit') ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ background: '#EAF1EA', color: '#526A56' }}
                          title={accessBasis(r) === 'referred_in' ? 'Referred to your barangay — you handle this case' : 'Your barangay handles this case'}>
                          <i className="ri-edit-line" />Editable
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ background: '#F1F3F5', color: '#647080' }}
                          title={accessBasis(r) === 'referred_out'
                            ? `Your resident, referred to ${r.responsible_barangay}. ${r.responsible_barangay} handles this case.`
                            : 'You can view this case but not change it.'}>
                          <i className="ri-eye-line" />View only
                        </span>
                      )}
                    </td>
                    <td className="px-1.5 py-2.5 text-center">
                      <div className="flex items-center justify-center">
                        <button
                          type="button"
                          aria-label={`More actions for ${caseIdLabel(r)}`}
                          aria-haspopup="menu"
                          onClick={(e) => setRowMenu(rowMenu?.record.id === r.id ? null : { record: r, anchor: e.currentTarget })}
                          className="inline-flex items-center justify-center h-6 w-6 rounded"
                          style={{ color: rowMenu?.record.id === r.id ? '#0F2D52' : '#64748B', background: rowMenu?.record.id === r.id ? '#EEF2F7' : 'transparent', transition: 'color 0.15s' }}
                        >
                          <i className="ri-more-2-fill text-sm" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {['all', 'archived'].includes(view) && !loading && !error && (
          <TablePagination
            page={pagination.page}
            pageSize={pageSize}
            total={pagination.total}
            itemName={view === 'archived' ? 'archived cases' : 'records'}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        )}
      </div>

      {rowMenu && <RowMenu anchor={rowMenu.anchor} items={rowMenuItems(rowMenu.record)} onClose={() => setRowMenu(null)} />}
      {archiveTarget && (
        <div className="fixed inset-0 z-[1400] flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => { if (!archiving) setArchiveTarget(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="archive-dialog-title" className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 id="archive-dialog-title" className="text-sm font-bold" style={{ color: '#0F2D52' }}>Archive record?</h2>
            <p className="mt-2 text-xs leading-relaxed" style={{ color: '#475569' }}>
              {caseIdLabel(archiveTarget)} will be removed from active lists and analysis. Its history will be kept.
            </p>
            {archiveError && <p role="alert" className="mt-3 rounded px-3 py-2 text-xs" style={{ background: '#FEF2F2', color: '#991B1B' }}>{archiveError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={archiving} onClick={() => setArchiveTarget(null)} className="px-4 py-2 text-xs font-medium disabled:opacity-50" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}>
                Cancel
              </button>
              <button type="button" disabled={archiving} onClick={archiveRecord} className="px-4 py-2 text-xs font-semibold disabled:opacity-50" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 }}>
                {archiving ? 'Archiving…' : 'Archive record'}
              </button>
            </div>
          </div>
        </div>
      )}
      {detailId && (
        <RecordDetailDrawer key={`${detailId}-${detailMode}`} recordId={detailId} initialMode={detailMode} facilities={facilities} barangays={barangayRefs} onClose={() => setDetailId(null)} onChanged={fetchRecords} onOpenRecord={(id) => openDetail(id)} />
      )}

      {/* ── Slide-over: Add TB Record ── */}
      {showForm && (
        <div className="fixed inset-0 z-[1200] flex justify-end" style={{ background: 'rgba(15,23,42,0.3)' }} onClick={closeForm}>
          <div className="w-full max-w-lg h-full flex flex-col overflow-hidden" style={{ background: '#ffffff' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ background: '#0F2D52', color: '#ffffff' }}>
              <div>
                <h2 className="text-sm font-extrabold">Add TB Record</h2>
                <p className="text-[11px] mt-0.5 opacity-70">Enter the Case ID from DSTB/MN — it is never generated.</p>
              </div>
              <ModalCloseButton onClick={closeForm} light />
            </div>

            <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto">
            {result && (
              <div className="mx-6 mt-4 px-4 py-3 rounded-lg text-xs font-semibold" style={{ background: result.sync?.status === 'failed' ? '#FEF9C3' : '#DCFCE7', color: result.sync?.status === 'failed' ? '#854D0E' : '#166534' }}>
                {result.message}
                {result.sync?.status === 'syncing' && (
                  <span className="flex items-center gap-1.5 text-[11px] font-normal mt-0.5 opacity-80">
                    <i className="ri-loader-4-line animate-spin" /> {result.sync.message}
                  </span>
                )}
                {result.sync?.status === 'failed' && <span className="block text-[11px] font-normal mt-0.5 opacity-80">Sync failed — record saved. Retry from Sync page.</span>}
              </div>
            )}

            {possibleMatch && (
              <div className="mx-6 mt-4 p-4 rounded-lg text-xs" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                <p className="font-bold mb-1" style={{ color: '#92400E' }}>This may be an existing patient</p>
                <p style={{ color: '#475569' }}>
                  Same name and date of birth as case <b>{possibleMatch.case_id || 'No Case ID'}</b>, diagnosed {possibleMatch.date_of_diagnosis || '—'}
                  {possibleMatch.barangay_name ? `, ${possibleMatch.barangay_name}` : ''}{possibleMatch.outcome_status ? `, ${possibleMatch.outcome_status}` : ''}.
                </p>
                <p className="mt-1" style={{ color: '#475569' }}>
                  {possibleMatch.new_case_id ? <>You entered a different Case ID (<b>{possibleMatch.new_case_id}</b>), so this is likely a returning patient with a new episode.</> : null}
                </p>
                <div className="flex flex-col gap-1.5 mt-3">
                  {Object.entries(RESOLUTION_LABELS).filter(([key]) => key !== 'same_case' || possibleMatch.has_case_id === false).map(([key, l]) => (
                    <button key={key} type="button" disabled={saving || (key === 'same_case' && possibleMatch.canUpdateExisting === false)} onClick={() => submit(key)}
                      title={key === 'same_case' && possibleMatch.canUpdateExisting === false ? 'The existing case is view-only for you' : ''}
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

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>Case ID *</label>
                <input type="text" value={form.source_case_id} onChange={e => setField('source_case_id', e.target.value.toUpperCase())} className="w-full px-3 py-2 text-xs outline-none font-mono" style={inputStyle} placeholder="ROS-D-2025-00042" autoComplete="off" />
                <p className="text-[10px] mt-1" style={{ color: '#94A3B8' }}>{CASE_ID_HINT}. One Case ID per TB episode — a returning patient gets a new one.</p>
              </div>

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
                  <FormSelect value={form.sex} onChange={e => setField('sex', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                    <option value="">Select…</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </FormSelect>
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
                <FormSelect value={form.barangay_name} onChange={e => setField('barangay_name', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                  <option value="">Select barangay…</option>
                  {PASIG_BARANGAYS.map(b => <option key={b} value={b}>{b}</option>)}
                </FormSelect>
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
                <FormSelect value={form.screening_facility} onChange={e => setField('screening_facility', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                  <option value="">Select facility…</option>
                  {facilityList.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                  <option value="__other__">Other (type below)</option>
                </FormSelect>
                {form.screening_facility === '__other__' && (
                  <input type="text" value={form.screening_facility_other} onChange={e => setField('screening_facility_other', e.target.value)} placeholder="Enter facility name" className="w-full px-3 py-2 text-xs outline-none mt-1" style={inputStyle} />
                )}
              </div>

              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>Treatment Facility</label>
                <FormSelect value={form.treatment_facility} onChange={e => setField('treatment_facility', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                  <option value="">Select facility…</option>
                  {facilityList.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                  <option value="__other__">Other (type below)</option>
                </FormSelect>
                {form.treatment_facility === '__other__' && (
                  <input type="text" value={form.treatment_facility_other} onChange={e => setField('treatment_facility_other', e.target.value)} placeholder="Enter facility name" className="w-full px-3 py-2 text-xs outline-none mt-1" style={inputStyle} />
                )}
              </div>

              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>Source of Patient</label>
                <FormSelect value={form.source_of_patient} onChange={e => setField('source_of_patient', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                  <option value="">Select…</option>
                  {srcOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </FormSelect>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Registration Group</label>
                  <FormSelect value={form.registration_group} onChange={e => setField('registration_group', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                    <option value="">Select…</option>
                    {regOptions.map(v => <option key={v} value={v}>{v}</option>)}
                  </FormSelect>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Anatomical Site</label>
                  <FormSelect value={form.anatomical_site} onChange={e => setField('anatomical_site', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                    <option value="">Select…</option>
                    {anatOptions.map(v => <option key={v} value={v}>{v}</option>)}
                  </FormSelect>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1" style={labelStyle}>Bacteriological Status</label>
                <FormSelect value={form.bacteriological_status} onChange={e => setField('bacteriological_status', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                  <option value="">Select…</option>
                  {bactOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </FormSelect>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Case Status</label>
                  <FormSelect value={form.case_status} onChange={e => setForm(f => ({ ...f, case_status: e.target.value, treatment_outcome: '' }))} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                    <option value="">Select…</option>
                    {CASE_STATUS_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                  </FormSelect>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Treatment Outcome</label>
                  <FormSelect value={form.treatment_outcome} onChange={e => setForm(f => ({ ...f, treatment_outcome: e.target.value, case_status: '' }))} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle}>
                    <option value="">Select…</option>
                    {OUTCOME_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                  </FormSelect>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={labelStyle}>Date of Outcome</label>
                  <input type="date" value={form.date_of_outcome} onChange={e => setField('date_of_outcome', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} />
                </div>
              </div>

            </div>
              </div>
              <div className="shrink-0 px-6 pt-4 pb-6 flex items-center justify-end gap-2" style={{ background: '#ffffff', borderTop: '1px solid rgba(15,45,82,0.08)' }}>
                <button type="button" onClick={closeForm} className="px-4 py-2.5 text-xs font-medium" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}>
                  Cancel
                </button>
                <button type="submit" disabled={saving || !!possibleMatch} className="px-4 py-2.5 text-xs font-bold disabled:opacity-50" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 }}>
                  {saving ? <><i className="ri-loader-4-line animate-spin mr-1" />Saving…</> : possibleMatch ? 'Choose an option above' : 'Save Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
