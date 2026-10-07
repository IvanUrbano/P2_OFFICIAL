import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import { useTheme } from '../theme';
import ProgressOverlay from '../components/ProgressOverlay';
import ModalCloseButton from '../components/ModalCloseButton';
import { avatarColorForRole, initialsForUsername } from '../utils/userIdentity';
import {
  PreferencesCard, RoleAccessCard, SecurityOptionsCard, SyncStatusPanel,
  ModelStatusPanel, NotificationSettings, SystemInfoPanel,
} from '../components/SettingsPanels';

const TABS = [
  { key: 'general', label: 'General', desc: 'Profile, preferences and access' },
  { key: 'security', label: 'Account & Security', desc: 'Password and sign-in protection' },
  { key: 'sync', label: 'Data Synchronization', desc: 'PASIG TB-IS connection status' },
  { key: 'analytics', label: 'Analytics & Forecasting', desc: 'Model status, rules and population data' },
  { key: 'notifications', label: 'Notifications', desc: 'Alert preferences and rules' },
  { key: 'system', label: 'System Information', desc: 'Services and versions' },
];


export default function Settings() {
  const { t } = useTheme();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('general');
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ username: '', email: '' });
  const [profileMsg, setProfileMsg] = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState(false);
  const [pwMsg, setPwMsg] = useState(null);
  const [savingPw, setSavingPw] = useState(false);

  const [sys, setSys] = useState(null);
  const [sysError, setSysError] = useState(false);

  // Population Reference Data state
  const [popReferences, setPopReferences] = useState([]);
  const [popLoading, setPopLoading] = useState(false);
  const [popError, setPopError] = useState(null);
  const [showAddPop, setShowAddPop] = useState(false);
  const [popForm, setPopForm] = useState({ reference_year: '', source_organization: '', source_reference: '', notes: '' });
  const [popRecords, setPopRecords] = useState([]);
  const [popValidation, setPopValidation] = useState(null);
  const [savingPop, setSavingPop] = useState(false);
  const [validatingPop, setValidatingPop] = useState(false);
  const [popMsg, setPopMsg] = useState(null);
  const [viewingYear, setViewingYear] = useState(null);
  const [viewingData, setViewingData] = useState([]);
  const [editingRecord, setEditingRecord] = useState(null);
  const [editPopValue, setEditPopValue] = useState('');
  const [inputMethod, setInputMethod] = useState('manual'); // 'manual' | 'csv' | 'xlsx'
  const [csvFile, setCsvFile] = useState(null);
  const [xlsxFile, setXlsxFile] = useState(null);
  const csvInputRef = useRef(null);
  const xlsxInputRef = useRef(null);

  // Model & Data Maintenance — Historical Risk Snapshot Backfill (admin only)
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [historicalError, setHistoricalError] = useState(null);
  const [historicalResult, setHistoricalResult] = useState(null);
  const [showBackfillConfirm, setShowBackfillConfirm] = useState(false);
  const [lastBackfillRun, setLastBackfillRun] = useState(null);

  useEffect(() => {
    API.get('/api/auth/profile')
      .then(res => {
        const u = res.data.user;
        setProfile(u);
        setForm({ username: u.username, email: u.email });
      })
      .catch(err => {
        setProfileMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to load profile.' });
      });

    API.get('/api/health')
      .then(res => setSys({ ...res.data, version: '1.0.0' }))
      .catch(() => setSysError(true));
  }, []);

  useEffect(() => {
    const onProfileRefresh = (event) => setProfile((current) => current ? { ...current, profile_photo_data: event.detail.profile_photo_data } : current);
    window.addEventListener('tbinsight-profile-refreshed', onProfileRefresh);
    return () => window.removeEventListener('tbinsight-profile-refreshed', onProfileRefresh);
  }, []);

  const fetchPopReferences = async () => {
    setPopLoading(true);
    setPopError(null);
    try {
      const res = await API.get('/api/tb/population');
      setPopReferences(res.data.references || []);
    } catch (err) {
      setPopError(err.response?.data?.error || 'Failed to load population references.');
    } finally {
      setPopLoading(false);
    }
  };

  const handleTabChange = (key) => {
    setActiveTab(key);
    if (key === 'analytics') {
      fetchPopReferences();
      if (profile?.role === 'admin') fetchLastBackfillRun();
    }
  };

  const fetchLastBackfillRun = async () => {
    try {
      const res = await API.get('/api/tb/pipeline/status', { params: { run_type: 'pipeline_historical' } });
      setLastBackfillRun(res.data?.latest_run || null);
    } catch {
      setLastBackfillRun(null);
    }
  };

  // Historical Risk Snapshot Backfill — computes one risk-classification
  // snapshot per PAST calendar year (POST /api/tb/pipeline/historical), so
  // GIS's Year filter can show a real, distinct assessment for each year
  // instead of only the current/latest one. Rare admin recovery action, not
  // required during normal data synchronization.
  const handleRunHistoricalBackfill = async () => {
    setShowBackfillConfirm(false);
    setHistoricalLoading(true);
    setHistoricalError(null);
    setHistoricalResult(null);
    try {
      const res = await API.post('/api/tb/pipeline/historical', {});
      setHistoricalResult(res.data?.years || []);
      fetchLastBackfillRun();
    } catch (err) {
      const data = err.response?.data;
      setHistoricalError(data?.details || data?.error || err.message);
    } finally {
      setHistoricalLoading(false);
    }
  };


  const handleViewYear = async (year) => {
    setViewingYear(year);
    try {
      const res = await API.get(`/api/tb/population/${year}`);
      setViewingData(res.data.data || []);
    } catch {
      setViewingData([]);
    }
  };

  const handleInitAddPop = async () => {
    setShowAddPop(true);
    setInputMethod('manual');
    setPopMsg(null);
    setPopValidation(null);
    setCsvFile(null);
    setXlsxFile(null);
    setPopForm({ reference_year: '', source_organization: '', source_reference: '', notes: '' });

    // Barangay names come from the database (the official reference list)
    try {
      const res = await API.get('/api/tb/barangays');
      const barangays = res.data.barangays || [];
      setPopRecords(barangays.map(b => ({ barangay_name: b.name, population: '' })));
      if (barangays.length === 0) setPopMsg({ kind: 'error', text: 'No barangays found in the database.' });
    } catch {
      setPopRecords([]);
      setPopMsg({ kind: 'error', text: 'Could not load the barangay list. Please try again.' });
    }
  };

  const handlePopRecordChange = (index, value) => {
    const updated = [...popRecords];
    updated[index] = { ...updated[index], population: value };
    setPopRecords(updated);
  };

  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCsvFile(file);
    setXlsxFile(null);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      // Detect template format
      const isTemplate = lines[0] && lines[0].startsWith('TBInsight');

      if (isTemplate) {
        // Extract reference info
        for (const line of lines) {
          if (line.startsWith('Reference Year')) {
            const val = line.split(',')[1]?.trim();
            if (val && !isNaN(val) && !val.toLowerCase().includes('example')) {
              setPopForm(prev => ({ ...prev, reference_year: val }));
            }
          }
          if (line.startsWith('Source / Organization')) {
            const val = line.split(',')[1]?.trim();
            if (val && !val.startsWith('Enter')) setPopForm(prev => ({ ...prev, source_organization: val }));
          }
          if (line.startsWith('Dataset / Reference')) {
            const val = line.split(',')[1]?.trim();
            if (val && !val.startsWith('Enter')) setPopForm(prev => ({ ...prev, source_reference: val }));
          }
          if (line.startsWith('Notes')) {
            const val = line.split(',')[1]?.trim();
            if (val && !val.startsWith('Additional')) setPopForm(prev => ({ ...prev, notes: val }));
          }
        }

        // Extract barangay data: lines starting with number,barangay,population
        const records = [];
        for (const line of lines) {
          const match = line.match(/^(\d+),([^,]*),(.*)$/);
          if (match) {
            records.push({ barangay_name: match[2]?.trim(), population: match[3]?.trim() || '' });
          }
        }
        setPopRecords(records);
      } else {
        // Simple format: barangay_name,population
        const dataLines = lines.filter(l => !l.startsWith('barangay_name'));
        setPopRecords(dataLines.map(l => {
          const parts = l.split(',');
          return { barangay_name: parts[0]?.trim(), population: parts[1]?.trim() || '' };
        }));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleXlsxUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setXlsxFile(file);
    setCsvFile(null);
    setPopMsg({ kind: 'info', text: `File "${file.name}" selected. Click Validate to extract reference information and population data.` });
    e.target.value = '';
  };

  const handleValidatePop = async () => {
    setValidatingPop(true);
    try {
      await runValidatePop();
    } finally {
      setValidatingPop(false);
    }
  };

  const runValidatePop = async () => {
    setPopMsg(null);

    // For XLSX, reference info comes from the file
    if (inputMethod === 'xlsx') {
      if (!xlsxFile) {
        setPopMsg({ kind: 'error', text: 'Please select an XLSX file.' });
        return;
      }
      try {
        const formData = new FormData();
        formData.append('file', xlsxFile);
        const res = await API.post('/api/tb/population/validate', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        setPopValidation(res.data.validation);
        // Update form with extracted reference info
        if (res.data.reference_year) {
          setPopForm({
            reference_year: String(res.data.reference_year),
            source_organization: res.data.source_organization || '',
            source_reference: res.data.source_reference || '',
            notes: res.data.notes || '',
          });
        }
      } catch (err) {
        setPopMsg({ kind: 'error', text: err.response?.data?.error || 'Validation failed.' });
      }
      return;
    }

    // For CSV with file: backend extracts reference info from the CSV file
    if (inputMethod === 'csv') {
      if (!csvFile) {
        setPopMsg({ kind: 'error', text: 'Please select a CSV file.' });
        return;
      }
      try {
        const formData = new FormData();
        formData.append('file', csvFile);
        const res = await API.post('/api/tb/population/validate', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        setPopValidation(res.data.validation);
        if (res.data.reference_year) {
          setPopForm({
            reference_year: String(res.data.reference_year),
            source_organization: res.data.source_organization || '',
            source_reference: res.data.source_reference || '',
            notes: res.data.notes || '',
          });
        }
      } catch (err) {
        setPopMsg({ kind: 'error', text: err.response?.data?.error || 'Validation failed.' });
      }
      return;
    }

    // For Manual Entry
    const yearNum = parseInt(popForm.reference_year);
    if (!yearNum || yearNum < 2000 || yearNum > 2100) {
      setPopMsg({ kind: 'error', text: 'Please enter a valid reference year.' });
      return;
    }
    if (!popForm.source_organization.trim() || !popForm.source_reference.trim()) {
      setPopMsg({ kind: 'error', text: 'Source organization and source reference are required.' });
      return;
    }

    // Manual entry
    const recordsToSubmit = popRecords.filter(r => r.population && r.population.trim() !== '');
    if (recordsToSubmit.length === 0) {
      setPopMsg({ kind: 'error', text: 'At least one population value is required.' });
      return;
    }
    try {
      const res = await API.post('/api/tb/population/validate', {
        reference_year: yearNum,
        records: recordsToSubmit,
      });
      setPopValidation(res.data.validation);
    } catch (err) {
      setPopMsg({ kind: 'error', text: err.response?.data?.error || 'Validation failed.' });
    }
  };

  const handleSavePop = async () => {
    setSavingPop(true);
    setPopMsg(null);

    // For XLSX
    if (inputMethod === 'xlsx' && xlsxFile) {
      try {
        const formData = new FormData();
        formData.append('file', xlsxFile);
        const res = await API.post('/api/tb/population', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        setPopMsg({ kind: 'success', text: `Population data saved. Status: ${res.data.result.status} (${res.data.result.records_saved} records)` });
        setShowAddPop(false);
        setPopValidation(null);
        fetchPopReferences();
      } catch (err) {
        setPopMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to save population data.' });
      } finally {
        setSavingPop(false);
      }
      return;
    }

    // For CSV — reference info extracted from the file
    if (inputMethod === 'csv' && csvFile) {
      try {
        const formData = new FormData();
        formData.append('file', csvFile);
        const res = await API.post('/api/tb/population', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        setPopMsg({ kind: 'success', text: `Population data saved. Status: ${res.data.result.status} (${res.data.result.records_saved} records)` });
        setShowAddPop(false);
        setPopValidation(null);
        fetchPopReferences();
      } catch (err) {
        setPopMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to save population data.' });
      } finally {
        setSavingPop(false);
      }
      return;
    }

    // Manual entry
    const yearNum = parseInt(popForm.reference_year);
    const recordsToSubmit = popRecords.filter(r => r.population && r.population.trim() !== '');
    try {
      const res = await API.post('/api/tb/population', {
        reference_year: yearNum,
        source_organization: popForm.source_organization.trim(),
        source_reference: popForm.source_reference.trim(),
        notes: popForm.notes.trim() || null,
        records: recordsToSubmit,
      });
      setPopMsg({ kind: 'success', text: `Population data saved. Status: ${res.data.result.status} (${res.data.result.records_saved} records)` });
      setShowAddPop(false);
      setPopValidation(null);
      fetchPopReferences();
    } catch (err) {
      setPopMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to save population data.' });
    } finally {
      setSavingPop(false);
    }
  };

  const handleEditRecord = async () => {
    if (!editingRecord || !editPopValue || parseInt(editPopValue) <= 0) return;
    try {
      await API.put(`/api/tb/population/${editingRecord.id}`, { population: parseInt(editPopValue) });
      setEditingRecord(null);
      setEditPopValue('');
      if (viewingYear) handleViewYear(viewingYear);
      fetchPopReferences();
    } catch (err) {
      setPopMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to update record.' });
    }
  };

  const handleDownloadTemplate = async (format) => {
    try {
      const endpoint = format === 'xlsx' ? '/api/tb/population/template/xlsx' : '/api/tb/population/template/csv';
      const res = await API.get(endpoint, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', format === 'xlsx' ? 'TBInsight_Population_Reference_Template.xlsx' : 'population-template.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setPopMsg({ kind: 'error', text: 'Failed to download template.' });
    }
  };

  const handleProfileSave = async () => {
    if (!form.username.trim() || !form.email.trim()) {
      setProfileMsg({ kind: 'error', text: 'Username and email are required.' });
      return;
    }
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const res = await API.put('/api/auth/profile', {
        username: form.username.trim(),
        email: form.email.trim(),
      });
      setProfile(res.data.user);
      setProfileMsg({ kind: 'success', text: res.data.message });
      try {
        const stored = JSON.parse(localStorage.getItem('user') || '{}');
        localStorage.setItem('user', JSON.stringify({ ...stored, ...res.data.user }));
      } catch {
        /* localStorage refresh is non-critical */
      }
    } catch (err) {
      setProfileMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to update profile.' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSave = async () => {
    if (!pw.currentPassword || !pw.newPassword) {
      setPwMsg({ kind: 'error', text: 'All fields are required.' });
      return;
    }
    if (pw.newPassword.length < 8) {
      setPwMsg({ kind: 'error', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (!/[A-Z]/.test(pw.newPassword)) {
      setPwMsg({ kind: 'error', text: 'Password must contain at least one uppercase letter.' });
      return;
    }
    if (!/[a-z]/.test(pw.newPassword)) {
      setPwMsg({ kind: 'error', text: 'Password must contain at least one lowercase letter.' });
      return;
    }
    if (!/[0-9]/.test(pw.newPassword)) {
      setPwMsg({ kind: 'error', text: 'Password must contain at least one number.' });
      return;
    }
    if (pw.newPassword !== pw.confirmPassword) {
      setPwMsg({ kind: 'error', text: 'New passwords do not match.' });
      return;
    }
    setSavingPw(true);
    setPwMsg(null);
    try {
      const res = await API.put('/api/auth/password', {
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
      });
      setPwMsg({ kind: 'success', text: res.data.message });
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setPwMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to change password.' });
    } finally {
      setSavingPw(false);
    }
  };

  const handleSignOut = async () => {
    try { await API.post('/api/auth/logout'); } catch { /* sign out locally regardless */ }
    localStorage.removeItem('user');
    localStorage.removeItem('tbinsight_session');
    sessionStorage.removeItem('csrf_token');
    navigate('/login');
  };

  const inputCls = "w-full rounded-lg px-3 py-2 text-[13px] outline-none";
  const inputStyle = { background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text };
  const labelCls = "block text-[11px] font-semibold mb-1";
  const labelStyle = { color: t.textSecondary };
  const isAdmin = profile?.role === 'admin';
  const visibleTabs = TABS;

  return (
    <div className="space-y-6">
      <ProgressOverlay
        open={validatingPop}
        title="Validating population data"
        detail="Reading the reference information and checking each barangay's population."
      />
      <ProgressOverlay
        open={savingPop}
        title="Importing population data"
        detail="Saving the population values for each barangay."
      />
      <ProgressOverlay
        open={historicalLoading}
        title="Backfilling historical risk snapshots"
        detail="Classifying risk once for each past year so the GIS year filter has its own assessment per year."
        note="This can take several minutes. Keep this page open until it finishes."
      />
      {/* Page header + tab navigation */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Settings</h1>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>
            {visibleTabs.find(tab => tab.key === activeTab)?.desc}
          </p>
        </div>
        <div style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div className="flex gap-0 overflow-x-auto">
            {visibleTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className="relative px-6 py-3 text-left transition-colors whitespace-nowrap"
                style={{ background: 'transparent' }}
              >
                <p className="text-[13px] font-bold" style={{ color: activeTab === tab.key ? '#0F2D52' : '#94A3B8' }}>
                  {tab.label}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: activeTab === tab.key ? '#64748B' : '#CBD5E1' }}>
                  {tab.desc}
                </p>
                {activeTab === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Profile */}
          <div style={cardStyle(t)} className="p-5">
            <h2 className="text-sm font-bold mb-4" style={{ color: t.text }}>Profile</h2>
            {profile ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: avatarColorForRole(profile.role), color: '#fff' }}>
                    {profile.profile_photo_data ? <img src={profile.profile_photo_data} alt="" className="h-full w-full rounded-full object-cover" /> : initialsForUsername(profile.username)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold" style={{ color: t.text }}>{profile.username}</p>
                    {profile.email && <p className="truncate text-xs" style={{ color: t.textSecondary }}>{profile.email}</p>}
                  </div>
                </div>
                <div>
                  <label className={labelCls} style={labelStyle}>Username</label>
                  <input className={inputCls} style={inputStyle} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls} style={labelStyle}>Email</label>
                  <input className={inputCls} style={inputStyle} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[11px]" style={{ color: t.textMuted }}>
                    {profile.role}
                    {profile.created_at && <> &middot; Joined {new Date(profile.created_at).toLocaleDateString()}</>}
                  </span>
                  <button onClick={handleProfileSave} disabled={savingProfile} className="px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-50" style={{ background: '#0F2D52', color: '#fff' }}>
                    {savingProfile ? 'Saving...' : 'Save'}
                  </button>
                </div>
                {profileMsg && (
                  <p className="text-xs font-medium" style={{ color: profileMsg.kind === 'error' ? '#991B1B' : '#047857' }}>
                    {profileMsg.text}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs" style={{ color: t.textMuted }}>Loading...</p>
            )}
          </div>

          <PreferencesCard />
          <RoleAccessCard role={profile?.role} />
        </div>
      )}

      {/* Security Tab */}
      {activeTab === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div style={cardStyle(t)} className="p-5">
          <h2 className="text-sm font-bold mb-4" style={{ color: t.text }}>Change Password</h2>
          <div className="flex flex-col gap-3">
            <div>
              <label className={labelCls} style={labelStyle}>Current Password</label>
              <div className="relative">
                <input className={inputCls} style={inputStyle} type={showPw ? 'text' : 'password'} value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: t.textMuted }} onClick={() => setShowPw(!showPw)}>
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>New Password</label>
              <input className={inputCls} style={inputStyle} type={showPw ? 'text' : 'password'} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Confirm New Password</label>
              <input className={inputCls} style={inputStyle} type={showPw ? 'text' : 'password'} value={pw.confirmPassword} onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} />
            </div>
            <p className="text-[11px]" style={{ color: t.textMuted }}>Min 8 characters, 1 uppercase, 1 lowercase, 1 number.</p>
            <div className="flex items-center justify-between mt-1">
              <div>
                {pwMsg && (
                  <p className="text-xs font-medium" style={{ color: pwMsg.kind === 'error' ? '#991B1B' : '#047857' }}>
                    {pwMsg.text}
                  </p>
                )}
              </div>
              <button onClick={handlePasswordSave} disabled={savingPw} className="px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-50" style={{ background: '#0F2D52', color: '#fff' }}>
                {savingPw ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </div>
        </div>
        <SecurityOptionsCard profile={profile} onSignOut={handleSignOut} />
        </div>
      )}

      {activeTab === 'sync' && <SyncStatusPanel isAdmin={isAdmin} />}
      {activeTab === 'notifications' && <NotificationSettings />}
      {activeTab === 'system' && <SystemInfoPanel sys={sys} sysError={sysError} />}

      {/* Analytics & Forecasting: model status, read-only rules, population reference data */}
      {activeTab === 'analytics' && (
        <div className="flex flex-col gap-6">
          <ModelStatusPanel />
          {/* Info Card */}
          <div style={cardStyle(t)} className="p-5">
            <h2 className="text-sm font-bold mb-1" style={{ color: t.text }}>Population Reference Data</h2>
            <p className="text-[11px] mt-0.5" style={{ color: t.textSecondary }}>
              Population reference data are used for population-adjusted indicators such as incidence per 100,000. The 2025 reference is sourced from the existing GeoJSON. Future years are stored in the database.
            </p>

            {popMsg && (
              <p className="text-xs font-medium mt-2" style={{ color: popMsg.kind === 'error' ? '#991B1B' : '#047857' }}>
                {popMsg.text}
              </p>
            )}

            {/* Reference Years Table */}
            {popLoading ? (
              <p className="text-xs mt-3" style={{ color: t.textMuted }}>Loading...</p>
            ) : popError ? (
              <p className="text-xs mt-3" style={{ color: '#991B1B' }}>{popError}</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${t.border}` }}>
                      <th className="text-left px-3 py-2 font-bold uppercase text-[10px]" style={{ color: t.textMuted }}>Year</th>
                      <th className="text-left px-3 py-2 font-bold uppercase text-[10px]" style={{ color: t.textMuted }}>Source</th>
                      <th className="text-left px-3 py-2 font-bold uppercase text-[10px]" style={{ color: t.textMuted }}>Storage</th>
                      <th className="text-left px-3 py-2 font-bold uppercase text-[10px]" style={{ color: t.textMuted }}>Barangays</th>
                      <th className="text-left px-3 py-2 font-bold uppercase text-[10px]" style={{ color: t.textMuted }}>Status</th>
                      <th className="text-left px-3 py-2 font-bold uppercase text-[10px]" style={{ color: t.textMuted }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {popReferences.map((ref, idx) => (
                      <tr key={idx} style={{ borderBottom: `1px solid ${t.border}` }}>
                        <td className="px-3 py-2 font-semibold" style={{ color: t.text }}>{ref.reference_year}</td>
                        <td className="px-3 py-2" style={{ color: t.textSecondary }}>
                          {ref.storage_type === 'geojson' ? 'Existing GeoJSON Reference' : (ref.source_organization || '\u2014')}
                        </td>
                        <td className="px-3 py-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold"
                            style={{ background: ref.storage_type === 'geojson' ? 'rgba(59,130,246,0.1)' : 'rgba(16,185,129,0.1)', color: ref.storage_type === 'geojson' ? '#2563EB' : '#047857' }}>
                            {ref.storage_type === 'geojson' ? 'GeoJSON' : 'Database'}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-semibold" style={{ color: t.text }}>{ref.barangay_count}/30</td>
                        <td className="px-3 py-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold"
                            style={{
                              background: ref.status === 'ACTIVE' ? 'rgba(4,120,87,0.1)' : ref.status === 'INCOMPLETE' ? 'rgba(245,158,11,0.1)' : 'rgba(100,116,139,0.1)',
                              color: ref.status === 'ACTIVE' ? '#047857' : ref.status === 'INCOMPLETE' ? '#92400E' : '#475569'
                            }}>
                            {ref.status}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => handleViewYear(ref.reference_year)} className="text-[11px] font-semibold cursor-pointer" style={{ color: '#2563EB' }}>
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!isAdmin && (
              <p className="text-[11px] mt-3" style={{ color: t.textMuted }}>
                <i className="ri-lock-line" /> Population reference data can be added or edited by an Admin only.
              </p>
            )}
            {isAdmin && <div className="mt-4 flex items-center gap-2">
              <button onClick={handleInitAddPop} className="px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer" style={{ background: '#0F2D52', color: '#fff' }}>
                <i className="ri-add-line text-sm" /> Add Population Reference
              </button>
              <button onClick={() => handleDownloadTemplate('xlsx')} className="px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer" style={{ border: `1px solid ${t.border}`, color: t.text, background: 'transparent' }}>
                <i className="ri-download-line text-sm" /> Download XLSX Template
              </button>
              <button onClick={() => handleDownloadTemplate('csv')} className="px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer" style={{ border: `1px solid ${t.border}`, color: t.text, background: 'transparent' }}>
                <i className="ri-download-line text-sm" /> Download CSV Template
              </button>
            </div>}
          </div>

          {/* View Year Detail */}
          {viewingYear && (
            <div style={cardStyle(t)} className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold" style={{ color: t.text }}>{viewingYear} Population Reference</h3>
                <ModalCloseButton onClick={() => setViewingYear(null)} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${t.border}` }}>
                      <th className="text-left px-3 py-2 font-bold uppercase text-[10px]" style={{ color: t.textMuted }}>Barangay</th>
                      <th className="text-left px-3 py-2 font-bold uppercase text-[10px]" style={{ color: t.textMuted }}>Population</th>
                      {isAdmin && viewingData[0]?.storage_type === 'database' && (
                        <th className="text-left px-3 py-2 font-bold uppercase text-[10px]" style={{ color: t.textMuted }}>Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {viewingData.map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: `1px solid ${t.border}` }}>
                        <td className="px-3 py-2 font-semibold" style={{ color: t.text }}>{row.barangay_name}</td>
                        <td className="px-3 py-2" style={{ color: t.textSecondary }}>
                          {editingRecord?.barangay_name === row.barangay_name ? (
                            <div className="flex items-center gap-2">
                              <input type="number" value={editPopValue} onChange={(e) => setEditPopValue(e.target.value)}
                                className="w-24 rounded px-2 py-1 text-xs" style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }} />
                              <button onClick={handleEditRecord} className="text-[10px] font-semibold cursor-pointer" style={{ color: '#047857' }}>Save</button>
                              <button onClick={() => setEditingRecord(null)} className="text-[10px] font-semibold cursor-pointer" style={{ color: '#991B1B' }}>Cancel</button>
                            </div>
                          ) : (
                            Number(row.population).toLocaleString()
                          )}
                        </td>
                        {isAdmin && row.storage_type === 'database' && (
                          <td className="px-3 py-2">
                            {editingRecord?.barangay_name !== row.barangay_name && (
                              <button onClick={() => { setEditingRecord(row); setEditPopValue(String(row.population)); }}
                                className="text-[10px] font-semibold cursor-pointer" style={{ color: '#2563EB' }}>
                                Edit
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Add Population Reference Modal */}
          {showAddPop && (
            <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => setShowAddPop(false)}>
              <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100" style={{ background: '#FAFCFF' }}>
                  <div className="flex items-center gap-2">
                    <i className="ri-group-line text-lg" style={{ color: '#0F2D52' }} />
                    <h3 className="text-sm font-bold" style={{ color: '#0F2D52' }}>Add Population Reference</h3>
                  </div>
                  <ModalCloseButton onClick={() => setShowAddPop(false)} />
                </div>

                <div className="p-5 space-y-4">
                  {/* Input Method Tabs */}
                  <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: '#F1F5F9' }}>
                    {[
                      { key: 'manual', label: 'Manual Entry', icon: 'ri-edit-line' },
                      { key: 'csv', label: 'CSV Upload', icon: 'ri-file-text-line' },
                      { key: 'xlsx', label: 'XLSX Upload', icon: 'ri-file-excel-2-line' },
                    ].map(m => (
                      <button key={m.key} onClick={() => { setInputMethod(m.key); setPopValidation(null); setPopMsg(null); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors cursor-pointer"
                        style={{
                          background: inputMethod === m.key ? '#fff' : 'transparent',
                          color: inputMethod === m.key ? '#0F2D52' : '#64748B',
                          boxShadow: inputMethod === m.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                        }}>
                        <i className={`${m.icon} text-sm`} /> {m.label}
                      </button>
                    ))}
                  </div>

                  {/* Reference Information (Manual Entry only — CSV/XLSX extract from file) */}
                  {inputMethod === 'manual' && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[11px] font-semibold mb-1" style={{ color: '#64748B' }}>Reference Year *</label>
                          <input type="number" value={popForm.reference_year} onChange={(e) => setPopForm({ ...popForm, reference_year: e.target.value })}
                            placeholder="e.g. 2026" className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                            style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#0F2D52' }} />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold mb-1" style={{ color: '#64748B' }}>Source / Organization *</label>
                          <input type="text" value={popForm.source_organization} onChange={(e) => setPopForm({ ...popForm, source_organization: e.target.value })}
                            placeholder="e.g. DOH, PSA" className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                            style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#0F2D52' }} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[11px] font-semibold mb-1" style={{ color: '#64748B' }}>Dataset / Reference *</label>
                          <input type="text" value={popForm.source_reference} onChange={(e) => setPopForm({ ...popForm, source_reference: e.target.value })}
                            placeholder="e.g. FHSIS 2026" className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                            style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#0F2D52' }} />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold mb-1" style={{ color: '#64748B' }}>Notes</label>
                          <input type="text" value={popForm.notes} onChange={(e) => setPopForm({ ...popForm, notes: e.target.value })}
                            placeholder="Optional" className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                            style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#0F2D52' }} />
                        </div>
                      </div>
                    </>
                  )}

                  {/* CSV Info */}
                  {inputMethod === 'csv' && (
                    <div className="p-3 rounded-lg text-xs" style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', color: '#0369A1' }}>
                      <p className="font-semibold mb-1"><i className="ri-information-line" /> CSV Template</p>
                      <p>Upload the completed CSV template. Reference information (year, source, dataset, notes) will be extracted automatically from the template.</p>
                      <p className="mt-1">Download the template using the buttons above.</p>
                    </div>
                  )}

                  {/* XLSX Info */}
                  {inputMethod === 'xlsx' && (
                    <div className="p-3 rounded-lg text-xs" style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', color: '#0369A1' }}>
                      <p className="font-semibold mb-1"><i className="ri-information-line" /> XLSX Template</p>
                      <p>Upload the completed XLSX template. Reference information (year, source, dataset, notes) will be extracted automatically from the template.</p>
                      <p className="mt-1">Download the template using the buttons above.</p>
                    </div>
                  )}

                  {/* File Upload (CSV + XLSX) */}
                  {inputMethod === 'csv' && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => csvInputRef.current?.click()} className="px-3 py-1.5 text-[11px] font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                        style={{ border: '1px solid #E2E8F0', color: '#0F2D52', background: '#fff' }}>
                        <i className="ri-upload-2-line text-sm" /> Upload CSV
                      </button>
                      <input ref={csvInputRef} type="file" accept=".csv" onChange={handleCsvUpload} className="hidden" />
                      {csvFile && <span className="text-[10px]" style={{ color: '#047857' }}>{csvFile.name}</span>}
                    </div>
                  )}

                  {inputMethod === 'xlsx' && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => xlsxInputRef.current?.click()} className="px-3 py-1.5 text-[11px] font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                        style={{ border: '1px solid #E2E8F0', color: '#0F2D52', background: '#fff' }}>
                        <i className="ri-upload-2-line text-sm" /> Upload XLSX
                      </button>
                      <input ref={xlsxInputRef} type="file" accept=".xlsx,.xls" onChange={handleXlsxUpload} className="hidden" />
                      {xlsxFile && <span className="text-[10px]" style={{ color: '#047857' }}>{xlsxFile.name}</span>}
                    </div>
                  )}

                  {/* Population Entry Table (Manual Entry only) */}
                  {inputMethod === 'manual' && popRecords.length > 0 && (
                    <div className="overflow-x-auto max-h-[300px] overflow-y-auto rounded-lg" style={{ border: '1px solid #E2E8F0' }}>
                      <table className="w-full text-xs">
                        <thead className="sticky top-0">
                          <tr style={{ background: '#F8FAFC' }}>
                            <th className="text-left px-3 py-2 font-bold text-[10px] uppercase" style={{ color: '#64748B' }}>Barangay</th>
                            <th className="text-left px-3 py-2 font-bold text-[10px] uppercase" style={{ color: '#64748B' }}>Population</th>
                          </tr>
                        </thead>
                        <tbody>
                          {popRecords.map((rec, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                              <td className="px-3 py-1.5 font-medium" style={{ color: '#0F2D52' }}>{rec.barangay_name}</td>
                              <td className="px-3 py-1.5">
                                <input type="number" value={rec.population} onChange={(e) => handlePopRecordChange(idx, e.target.value)}
                                  placeholder="Enter population"
                                  className="w-32 rounded px-2 py-1 text-xs outline-none"
                                  style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#0F2D52' }} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Validation Preview */}
                  {popValidation && (
                    <div className="p-3 rounded-lg text-xs space-y-2" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                      <p className="font-semibold" style={{ color: '#0F2D52' }}>Validation Results</p>
                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <span>Expected: <strong>{popValidation.expected}</strong></span>
                        <span>Matched: <strong style={{ color: '#047857' }}>{popValidation.matched}</strong></span>
                        <span>Missing: <strong style={{ color: popValidation.missing.length > 0 ? '#92400E' : '#047857' }}>{popValidation.missing.length}</strong></span>
                        <span>Unmatched: <strong style={{ color: popValidation.unmatched.length > 0 ? '#991B1B' : '#047857' }}>{popValidation.unmatched.length}</strong></span>
                        <span>Duplicates: <strong style={{ color: popValidation.duplicates.length > 0 ? '#991B1B' : '#047857' }}>{popValidation.duplicates.length}</strong></span>
                        <span>Invalid: <strong style={{ color: popValidation.invalid.length > 0 ? '#991B1B' : '#047857' }}>{popValidation.invalid.length}</strong></span>
                      </div>
                      {popValidation.missing.length > 0 && (
                        <p className="text-[10px]" style={{ color: '#92400E' }}>Missing: {popValidation.missing.join(', ')}</p>
                      )}
                      {popValidation.unmatched.length > 0 && (
                        <p className="text-[10px]" style={{ color: '#991B1B' }}>Unmatched: {popValidation.unmatched.join(', ')}</p>
                      )}
                      {popValidation.matched === popValidation.expected && (
                        <p className="text-[10px] font-semibold" style={{ color: '#047857' }}>All {popValidation.expected} barangays matched. Dataset will be saved as ACTIVE.</p>
                      )}
                      {popValidation.matched < popValidation.expected && popValidation.matched > 0 && (
                        <p className="text-[10px] font-semibold" style={{ color: '#92400E' }}>Dataset will be saved as INCOMPLETE ({popValidation.matched}/{popValidation.expected} barangays).</p>
                      )}
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between pt-2">
                    <button onClick={() => { setShowAddPop(false); setPopValidation(null); }} className="px-4 py-2 text-xs font-semibold rounded-lg cursor-pointer" style={{ color: '#64748B' }}>
                      Cancel
                    </button>
                    <div className="flex items-center gap-2">
                      <button onClick={handleValidatePop} className="px-4 py-2 text-xs font-semibold rounded-lg cursor-pointer" style={{ border: '1px solid #E2E8F0', color: '#0F2D52', background: '#fff' }}>
                        Validate
                      </button>
                      {popValidation && (
                        <button onClick={handleSavePop} disabled={savingPop} className="px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-50 cursor-pointer" style={{ background: '#0F2D52', color: '#fff' }}>
                          {savingPop ? 'Saving...' : 'Confirm Import'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Model & Data Maintenance Tab (admin only) */}
      {activeTab === 'analytics' && isAdmin && (
        <div style={cardStyle(t)} className="p-5">
          <h2 className="text-sm font-bold mb-1" style={{ color: t.text }}>Model & Data Maintenance</h2>
          <p className="text-xs mb-4" style={{ color: t.textSecondary }}>
            Administrative operations for the forecasting and risk-classification models. These are rare
            maintenance actions, not part of normal day-to-day data synchronization.
          </p>

          <div className="rounded-lg p-4" style={{ border: `1px solid ${t.border}` }}>
            <h3 className="text-xs font-bold mb-1" style={{ color: t.text }}>Historical Risk Assessments</h3>
            <p className="text-xs mb-3" style={{ color: t.textSecondary }}>
              Generate missing year-specific barangay risk assessments from available historical TB records.
              This administrative maintenance operation is not required during normal data synchronization —
              GIS already updates automatically after each sync through the Random Forest branch.
            </p>

            {!showBackfillConfirm ? (
              <button
                onClick={() => setShowBackfillConfirm(true)}
                disabled={historicalLoading}
                className="px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-50 cursor-pointer"
                style={{ background: '#0F2D52', color: '#fff' }}
              >
                {historicalLoading
                  ? <><i className="ri-loader-4-line animate-spin mr-1" />Backfilling...</>
                  : <><i className="ri-history-line mr-1" />Backfill Historical Risk Snapshots</>}
              </button>
            ) : (
              <div className="rounded-lg p-3" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                <p className="text-xs font-medium mb-3" style={{ color: '#92400E' }}>
                  Generate missing historical risk assessments from available historical TB data? This
                  administrative operation may take some time.
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowBackfillConfirm(false)} className="px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer" style={{ color: '#64748B' }}>
                    Cancel
                  </button>
                  <button onClick={handleRunHistoricalBackfill} className="px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer" style={{ background: '#0F2D52', color: '#fff' }}>
                    Continue Backfill
                  </button>
                </div>
              </div>
            )}

            <p className="text-[11px] mt-3" style={{ color: t.textMuted }}>
              Last Backfill: {lastBackfillRun?.trained_at ? new Date(lastBackfillRun.trained_at).toLocaleString() : 'Never run'}
            </p>

            {historicalLoading && (
              <div className="flex items-center gap-2 text-xs font-medium mt-3" style={{ color: t.textSecondary }}>
                <i className="ri-loader-4-line animate-spin" />
                Computing a risk snapshot per past year — each one re-runs Random Forest training, this may take a while...
              </div>
            )}
            {historicalError && (
              <div className="rounded-lg px-3 py-2.5 mt-3" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
                <p className="text-xs font-semibold" style={{ color: '#B91C1C' }}>
                  <i className="ri-error-warning-line mr-1" />Backfill failed: {historicalError}
                </p>
                <p className="text-[11px] mt-1" style={{ color: '#991B1B' }}>
                  No existing risk assessments were deleted or changed — this only affects the new snapshots this run was trying to create.
                </p>
              </div>
            )}
            {historicalResult && (
              <div className="space-y-1.5 mt-3 pt-3" style={{ borderTop: `1px solid ${t.border}` }}>
                <p className="text-[11px] font-bold uppercase" style={{ color: t.textSecondary }}>Historical Snapshot Backfill Completed</p>
                {historicalResult.map((y) => (
                  <div key={y.year} className="flex items-center gap-2 text-xs">
                    <span className="font-bold w-12" style={{ color: '#0F2D52' }}>{y.year}</span>
                    {y.status === 'skipped' ? (
                      <span style={{ color: '#94A3B8' }}>Skipped — {y.reason}</span>
                    ) : y.status === 'error' ? (
                      <span style={{ color: '#B91C1C' }}>Failed: {y.error}</span>
                    ) : (
                      <span style={{ color: t.textSecondary }}>
                        {y.classifierMethod === 'random_forest' ? 'Random Forest' : 'Rule-based fallback'}
                        {' '}({y.trainingRows} training rows) → period {y.period}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const cardStyle = (t) => ({
  background: t.cardSolid,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});
