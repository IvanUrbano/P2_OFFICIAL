import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import { useTheme } from '../theme';
import { INACTIVITY_TIMEOUT_MS } from '../utils/session';

const SETTINGS_TABS = [
  { key: 'general', label: 'General', desc: 'Account and system overview' },
  { key: 'rules', label: 'Import & Validation', desc: 'Case ID, validation and duplicate rules' },
  { key: 'sync', label: 'Data Synchronization', desc: 'TBInsight connection and sync status', adminOnly: true },
  { key: 'security', label: 'Security', desc: 'Password, PIN and session rules' },
  { key: 'system', label: 'System Information', desc: 'Version, status and database', adminOnly: true },
];

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Manila', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
});
const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true,
});

// Same "Fri, 3 Oct 2025 | 2:15 PM" style as the Last Import shown in the top bar.
function formatDateTime(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${DATE_FORMATTER.format(d)} | ${TIME_FORMATTER.format(d)}`;
}

function formatUptime(seconds) {
  if (seconds == null) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

const cardStyle = (t) => ({
  background: t.cardSolid,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});

function Row({ t, label, children }) {
  return (
    <div className="flex justify-between gap-4 py-2" style={{ borderBottom: `1px solid ${t.border}` }}>
      <span className="text-xs shrink-0" style={{ color: t.textSecondary }}>{label}</span>
      <span className="text-xs font-semibold text-right break-words min-w-0" style={{ color: t.text }}>{children}</span>
    </div>
  );
}

// Marks a value or card that the system controls and this page cannot change.
function Protected() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ background: '#F1F5F9', color: '#64748B' }}>
      <i className="ri-lock-line" style={{ fontSize: '10px' }} />
      Protected
    </span>
  );
}

function CardTitle({ t, children, protectedNote }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-4">
      <h2 className="text-sm font-bold" style={{ color: t.text }}>{children}</h2>
      {protectedNote && <Protected />}
    </div>
  );
}

function Notice({ kind, children }) {
  const styles = {
    error: { background: 'rgba(239,68,68,0.05)', color: '#991B1B' },
    success: { background: 'rgba(16,185,129,0.05)', color: '#047857' },
    warn: { background: 'rgba(245,158,11,0.08)', color: '#92400E', border: '1px solid rgba(245,158,11,0.25)' },
  };
  return <div className="px-3 py-2 rounded-lg text-[11px]" style={styles[kind]}>{children}</div>;
}

function LoadState({ t, loading, error, onRetry }) {
  if (loading) return <p className="text-xs" style={{ color: t.textMuted }}>Loading…</p>;
  return (
    <div role="alert">
      <p className="text-xs" style={{ color: '#991B1B' }}>{error}</p>
      <button onClick={onRetry} className="text-[11px] font-semibold mt-2 hover:underline" style={{ color: '#2E6FAF' }}>Retry</button>
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useTheme();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState(
    SETTINGS_TABS.some(tab => tab.key === new URLSearchParams(window.location.search).get('tab'))
      ? new URLSearchParams(window.location.search).get('tab') : 'general'
  );

  useEffect(() => {
    API.get('/api/auth/profile').then(res => setUser(res.data.user)).catch(() => {});
  }, []);

  const isAdmin = user?.role === 'admin';
  const visibleTabs = SETTINGS_TABS.filter(tab => !tab.adminOnly || isAdmin);
  // A link to an admin-only tab opened by someone else falls back to General.
  const currentTab = visibleTabs.some(tab => tab.key === activeTab) ? activeTab : 'general';

  // ---------- Rules (Import & Validation, Security) ----------
  const [rules, setRules] = useState(null);
  const [rulesError, setRulesError] = useState('');
  const loadRules = useCallback(() => {
    setRulesError('');
    API.get('/api/settings/rules').then(r => setRules(r.data)).catch(() => setRulesError('Could not load the system rules.'));
  }, []);
  useEffect(() => { loadRules(); }, [loadRules]);

  // ---------- Password ----------
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [savingPw, setSavingPw] = useState(false);

  const handlePasswordSave = async () => {
    if (!pw.currentPassword || !pw.newPassword) { setPwMsg({ kind: 'error', text: 'All fields are required.' }); return; }
    if (pw.newPassword.length < 8) { setPwMsg({ kind: 'error', text: 'Password must be at least 8 characters.' }); return; }
    if (!/[A-Z]/.test(pw.newPassword) || !/[a-z]/.test(pw.newPassword) || !/[0-9]/.test(pw.newPassword)) {
      setPwMsg({ kind: 'error', text: 'Password must contain an uppercase letter, a lowercase letter and a number.' }); return;
    }
    if (pw.newPassword !== pw.confirmPassword) { setPwMsg({ kind: 'error', text: 'Passwords do not match.' }); return; }
    setSavingPw(true);
    try {
      await API.put('/api/auth/password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPwMsg({ kind: 'success', text: 'Password changed successfully.' });
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
      if (user?.must_change_password) {
        // First-login change done: reload so the layout lets the user through.
        window.location.assign('/dashboard');
      }
    } catch (err) {
      setPwMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to change password.' });
    } finally {
      setSavingPw(false);
    }
  };

  // ---------- Records PIN (unlocks patient names/birth dates in TB Records) ----------
  const [hasPin, setHasPin] = useState(false);
  const [pinForm, setPinForm] = useState({ password: '', pin: '', confirm: '' });
  const [pinMsg, setPinMsg] = useState(null);
  const [savingPin, setSavingPin] = useState(false);
  useEffect(() => {
    API.get('/api/auth/pin/status').then(r => setHasPin(Boolean(r.data.hasPin))).catch(() => {});
  }, []);
  const handlePinSave = async () => {
    if (!/^\d{4,6}$/.test(pinForm.pin)) { setPinMsg({ kind: 'error', text: 'PIN must be 4 to 6 digits.' }); return; }
    if (pinForm.pin !== pinForm.confirm) { setPinMsg({ kind: 'error', text: 'PINs do not match.' }); return; }
    if (!pinForm.password) { setPinMsg({ kind: 'error', text: 'Enter your account password to confirm.' }); return; }
    setSavingPin(true);
    try {
      await API.post('/api/auth/pin', { password: pinForm.password, pin: pinForm.pin });
      setPinMsg({ kind: 'success', text: 'Records PIN saved. Use it in TB Records to show patient names.' });
      setPinForm({ password: '', pin: '', confirm: '' });
      setHasPin(true);
    } catch (err) {
      setPinMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to save PIN.' });
    } finally {
      setSavingPin(false);
    }
  };

  // ---------- Data Synchronization (admin) ----------
  const [sync, setSync] = useState(null);
  const [syncError, setSyncError] = useState('');
  const [conn, setConn] = useState(null);        // result of the last connection check
  const [testing, setTesting] = useState(false);
  const syncOpened = useRef(false);

  const loadSync = useCallback(() => {
    setSyncError('');
    API.get('/api/settings/sync').then(r => setSync(r.data)).catch(() => setSyncError('Could not load synchronization settings.'));
  }, []);

  const testConnection = useCallback(async (auto = false) => {
    setTesting(true);
    try {
      const res = await API.post('/api/settings/test-connection', { auto });
      setConn(res.data);
    } catch {
      setConn({ ok: false, state: 'error', message: 'The connection test could not be run.', checkedAt: new Date().toISOString() });
    } finally {
      setTesting(false);
    }
  }, []);

  // The first time the tab is opened, load the sync details and check the connection once
  // (the automatic check is not written to the audit log).
  useEffect(() => {
    if (currentTab !== 'sync' || !isAdmin || syncOpened.current) return;
    syncOpened.current = true;
    loadSync();
    testConnection(true);
  }, [currentTab, isAdmin, loadSync, testConnection]);

  // ---------- System Information (admin) ----------
  const [system, setSystem] = useState(null);
  const [systemError, setSystemError] = useState('');
  const loadSystem = useCallback(() => {
    setSystemError('');
    API.get('/api/settings/system').then(r => setSystem(r.data)).catch(() => setSystemError('Could not load system information.'));
  }, []);
  const systemOpened = useRef(false);
  useEffect(() => {
    if (currentTab !== 'system' || !isAdmin || systemOpened.current) return;
    systemOpened.current = true;
    loadSystem();
  }, [currentTab, isAdmin, loadSystem]);

  const inputStyle = { background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text };
  const primaryButton = { background: '#0F2D52', color: '#ffffff' };

  const connStatus = testing && !conn
    ? { dot: '#94A3B8', text: 'Checking…', color: t.textSecondary }
    : !conn
      ? { dot: '#94A3B8', text: 'Not checked', color: t.textSecondary }
      : conn.ok
        ? { dot: '#10B981', text: 'Connected', color: '#047857' }
        : { dot: '#EF4444', text: conn.state === 'unreachable' ? 'Unreachable' : 'Problem', color: '#B91C1C' };

  return (
    <div className="space-y-6">
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Settings</h1>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>
            {visibleTabs.find(tab => tab.key === currentTab)?.desc}
          </p>
        </div>
        <div style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div className="flex gap-0 overflow-x-auto">
            {visibleTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="relative px-6 py-3 text-left transition-colors whitespace-nowrap"
                style={{ background: 'transparent' }}
              >
                <p className="text-[13px] font-bold" style={{ color: currentTab === tab.key ? '#0F2D52' : '#334155' }}>
                  {tab.label}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: currentTab === tab.key ? '#475569' : '#64748B' }}>
                  {tab.desc}
                </p>
                {currentTab === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ───────── General ───────── */}
      {currentTab === 'general' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div style={cardStyle(t)} className="p-5">
            <CardTitle t={t}>Account Settings</CardTitle>
            {user && (
              <div className="space-y-3">
                {[
                  { label: 'Username', value: user.username },
                  { label: 'Email', value: user.email },
                  { label: 'Role', value: user.role },
                  ...(user.role !== 'admin' && (user.barangay_name || user.facility_name)
                    ? [{ label: 'Assigned to', value: user.barangay_name ? `Brgy. ${user.barangay_name}` : user.facility_name }]
                    : []),
                ].map((item) => (
                  <Row key={item.label} t={t} label={item.label}>{item.value}</Row>
                ))}
              </div>
            )}
          </div>
          <div style={cardStyle(t)} className="p-5">
            <CardTitle t={t} protectedNote>System</CardTitle>
            <div className="space-y-3">
              {[
                { label: 'System Name', value: 'PASIG TB-IS' },
                { label: 'Full Name', value: 'Tuberculosis Information System' },
                { label: 'Coverage', value: 'Pasig City' },
                { label: 'Time Zone', value: 'Asia/Manila (Philippine Time)' },
                { label: 'Integration', value: 'TBInsight' },
              ].map((item) => (
                <Row key={item.label} t={t} label={item.label}>{item.value}</Row>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ───────── Import & Validation ───────── */}
      {currentTab === 'rules' && (
        !rules ? (
          <div style={cardStyle(t)} className="p-5"><LoadState t={t} loading={!rulesError} error={rulesError} onRetry={loadRules} /></div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div style={cardStyle(t)} className="p-5">
              <CardTitle t={t} protectedNote>Case ID</CardTitle>
              <div className="space-y-3">
                <Row t={t} label="Format"><span className="font-mono">{rules.caseId.format}</span></Row>
                <Row t={t} label="Example"><span className="font-mono">{rules.caseId.example}</span></Row>
                <Row t={t} label="Pattern"><span className="font-mono">{rules.caseId.pattern}</span></Row>
                {rules.caseId.parts.map((p) => (
                  <Row key={p.label} t={t} label={p.label}><span className="font-medium">{p.text}</span></Row>
                ))}
              </div>
              <p className="text-[11px] leading-5 mt-3" style={{ color: t.textSecondary }}>{rules.caseId.source}</p>
            </div>

            <div style={cardStyle(t)} className="p-5">
              <CardTitle t={t} protectedNote>Duplicate Detection</CardTitle>
              <ul className="list-disc ml-4 space-y-2">
                {rules.duplicates.map((text) => (
                  <li key={text} className="text-xs leading-5" style={{ color: '#475569' }}>{text}</li>
                ))}
              </ul>
              <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${t.border}` }}>
                <button onClick={() => navigate('/validation')} className="text-[11px] font-semibold hover:underline" style={{ color: '#2E6FAF' }}>
                  Review possible matches in Validation
                </button>
              </div>
            </div>

            <div style={cardStyle(t)} className="p-5">
              <CardTitle t={t} protectedNote>Validation Requirements</CardTitle>
              <ul className="list-disc ml-4 space-y-2">
                {rules.validation.map((text) => (
                  <li key={text} className="text-xs leading-5" style={{ color: '#475569' }}>{text}</li>
                ))}
              </ul>
            </div>

            <div style={cardStyle(t)} className="p-5">
              <CardTitle t={t} protectedNote>Import Files</CardTitle>
              <div className="space-y-3">
                <Row t={t} label="Accepted types">{rules.import.fileTypes.join(', ')}</Row>
                <Row t={t} label="Maximum size">{rules.import.maxFileMb} MB</Row>
                <Row t={t} label="Sheets">{rules.import.sheets.join(' and ')}</Row>
              </div>
              <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${t.border}` }}>
                <button onClick={() => navigate('/import')} className="text-[11px] font-semibold hover:underline" style={{ color: '#2E6FAF' }}>
                  Go to Data Import
                </button>
              </div>
            </div>
          </div>
        )
      )}

      {/* ───────── Data Synchronization ───────── */}
      {currentTab === 'sync' && isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div style={cardStyle(t)} className="p-5">
            <CardTitle t={t}>TBInsight Connection</CardTitle>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3" style={{ borderBottom: `1px solid ${t.border}` }}>
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: connStatus.dot }} />
                <div>
                  <p className="text-xs font-semibold" style={{ color: '#0F2D52' }}>Connection status</p>
                  <p className="text-[11px] mt-0.5" style={{ color: '#64748B' }}>
                    {conn?.checkedAt ? `Checked ${formatDateTime(conn.checkedAt)}` : 'Not checked yet'}
                  </p>
                </div>
              </div>
              <span className="text-xs font-medium" style={{ color: connStatus.color }}>{connStatus.text}</span>
            </div>
            <div className="space-y-3 mt-3">
              <Row t={t} label="Endpoint">{sync?.endpoint?.host || '—'}</Row>
              {conn?.responseMs != null && <Row t={t} label="Response time">{conn.responseMs} ms</Row>}
            </div>
            {conn && !conn.ok && <div className="mt-3"><Notice kind="error">{conn.message}</Notice></div>}
            {conn?.ok && <div className="mt-3"><Notice kind="success">{conn.message}</Notice></div>}
            <button onClick={() => testConnection(false)} disabled={testing} className="mt-3 px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-50" style={primaryButton}>
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            <p className="text-[11px] leading-5 mt-2" style={{ color: t.textMuted }}>
              Checks that TBInsight is running and can reach its database. It does not send any records.
            </p>
          </div>

          <div style={cardStyle(t)} className="p-5">
            <CardTitle t={t}>Last Synchronization</CardTitle>
            {!sync ? (
              <LoadState t={t} loading={!syncError} error={syncError} onRetry={loadSync} />
            ) : (
              <>
                <div className="space-y-3">
                  <Row t={t} label="Last successful sync">{sync.lastSuccess ? formatDateTime(sync.lastSuccess.at) : 'Never'}</Row>
                  {sync.lastSuccess && (
                    <>
                      <Row t={t} label="Batch">{sync.lastSuccess.filename || '—'}</Row>
                      <Row t={t} label="Sent / Imported">{sync.lastSuccess.sent ?? '—'} / {sync.lastSuccess.imported ?? '—'}</Row>
                      <Row t={t} label="Updated / Rejected">{sync.lastSuccess.updated ?? '—'} / {sync.lastSuccess.rejected ?? '—'}</Row>
                    </>
                  )}
                  <Row t={t} label="Ready to sync">{sync.counts.ready} batch{sync.counts.ready === 1 ? '' : 'es'}</Row>
                  <Row t={t} label="Failed">{sync.counts.failed} batch{sync.counts.failed === 1 ? '' : 'es'}</Row>
                  {sync.counts.syncing > 0 && <Row t={t} label="In progress">{sync.counts.syncing} batch{sync.counts.syncing === 1 ? '' : 'es'}</Row>}
                </div>
                {sync.lastFailure && (!sync.lastSuccess || new Date(sync.lastFailure.at) > new Date(sync.lastSuccess.at)) && (
                  <div className="mt-3">
                    <Notice kind="error">
                      Latest sync failed ({formatDateTime(sync.lastFailure.at)}){sync.lastFailure.error ? `: ${sync.lastFailure.error}` : '.'}
                    </Notice>
                  </div>
                )}
                <button onClick={() => navigate('/sync-history')} className="mt-3 px-4 py-2 text-xs font-semibold rounded-lg" style={{ border: '1px solid #CBD5E1', background: '#ffffff', color: '#0F2D52' }}>
                  View Sync History
                </button>
              </>
            )}
          </div>

          <div style={cardStyle(t)} className="p-5 lg:col-span-2">
            <CardTitle t={t} protectedNote>Sync Security</CardTitle>
            {!sync ? (
              <p className="text-xs" style={{ color: t.textMuted }}>Loading…</p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10">
                <div className="space-y-3">
                  <Row t={t} label="Sync secret">{sync.secretConfigured ? '•••••••• Configured' : 'Not configured'}</Row>
                  <Row t={t} label="Payload signing">{sync.signing}</Row>
                  <Row t={t} label="Address">{sync.endpoint.display || '—'}</Row>
                </div>
                <div className="space-y-3">
                  <Row t={t} label="Attempts per sync">{sync.maxRetries}</Row>
                  <Row t={t} label="Timeout per attempt">{sync.timeoutSeconds} seconds</Row>
                  <Row t={t} label="Automatic sync">{sync.autoSync}</Row>
                </div>
              </div>
            )}
            <p className="text-[11px] leading-5 mt-3" style={{ color: t.textSecondary }}>
              The sync secret and the TBInsight address are set in the server configuration. They cannot be viewed or changed from this page.
            </p>
          </div>
        </div>
      )}

      {/* ───────── Security ───────── */}
      {currentTab === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div style={cardStyle(t)} className="p-5">
            <h2 className="text-sm font-bold mb-4" style={{ color: t.text }}>Change Password</h2>
            {user?.must_change_password && (
              <div className="mb-3">
                <Notice kind="warn">
                  You are signed in with a temporary password. Enter it as your current password, then choose a new one to continue.
                </Notice>
              </div>
            )}
            <div className="space-y-2">
              {[
                { key: 'currentPassword', label: 'Current Password', type: 'password' },
                { key: 'newPassword', label: 'New Password', type: 'password' },
                { key: 'confirmPassword', label: 'Confirm Password', type: 'password' },
              ].map((field) => (
                <input key={field.key} type={field.type} placeholder={field.label} value={pw[field.key]}
                  onChange={(e) => setPw({ ...pw, [field.key]: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg outline-none" style={inputStyle} />
              ))}
            </div>
            <p className="text-[11px] mt-2" style={{ color: t.textMuted }}>
              At least 8 characters, with an uppercase letter, a lowercase letter and a number.
            </p>
            {pwMsg && <div className="mt-2"><Notice kind={pwMsg.kind}>{pwMsg.text}</Notice></div>}
            <button onClick={handlePasswordSave} disabled={savingPw} className="mt-3 px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-50" style={primaryButton}>
              {savingPw ? 'Updating...' : 'Update Password'}
            </button>

            <div className="mt-8 pt-5" style={{ borderTop: `1px solid ${t.border}` }}>
              <h2 className="text-sm font-bold" style={{ color: t.text }}>{hasPin ? 'Change Records PIN' : 'Set Up Records PIN'}</h2>
              <p className="text-[11px] mt-1 mb-3" style={{ color: '#64748B' }}>
                Patient names and birth dates stay hidden until you enter this PIN in TB Records. It unlocks them for 15 minutes; 5 wrong attempts block PIN entry for 15 minutes.
              </p>
              <div className="space-y-2">
                {[
                  { key: 'pin', label: 'New PIN (4–6 digits)', numeric: true },
                  { key: 'confirm', label: 'Confirm PIN', numeric: true },
                  { key: 'password', label: 'Your account password', numeric: false },
                ].map((field) => (
                  <input key={field.key} type="password" placeholder={field.label} value={pinForm[field.key]} autoComplete="off"
                    inputMode={field.numeric ? 'numeric' : undefined} maxLength={field.numeric ? 6 : undefined}
                    onChange={(e) => setPinForm({ ...pinForm, [field.key]: field.numeric ? e.target.value.replace(/\D/g, '') : e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg outline-none" style={inputStyle} />
                ))}
              </div>
              {pinMsg && <div className="mt-2"><Notice kind={pinMsg.kind}>{pinMsg.text}</Notice></div>}
              <button onClick={handlePinSave} disabled={savingPin} className="mt-3 px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-50" style={primaryButton}>
                {savingPin ? 'Saving...' : hasPin ? 'Change PIN' : 'Save PIN'}
              </button>
            </div>
          </div>

          <div style={cardStyle(t)} className="p-5 self-start">
            <CardTitle t={t} protectedNote>Access Rules</CardTitle>
            {!rules ? (
              <LoadState t={t} loading={!rulesError} error={rulesError} onRetry={loadRules} />
            ) : (
              <div className="space-y-3">
                <Row t={t} label="Password length">At least {rules.security.password.minLength} characters</Row>
                <Row t={t} label="Password must include">{rules.security.password.rules.map(r => r.replace('At least one ', '')).join(', ')}</Row>
                <Row t={t} label="Sign-in attempts">{rules.security.login.maxAttempts} per {rules.security.login.windowMinutes} minutes</Row>
                <Row t={t} label="After repeated failures">Account locks temporarily; an administrator can unlock it</Row>
                <Row t={t} label="Automatic sign-out">After {Math.round(INACTIVITY_TIMEOUT_MS / 60000)} minutes without activity</Row>
                <Row t={t} label="Records PIN unlock">{rules.security.recordsPin.unlockMinutes} minutes</Row>
                <Row t={t} label="Wrong PIN limit">{rules.security.recordsPin.maxFailed} attempts, then {rules.security.recordsPin.lockoutMinutes} minutes locked</Row>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ───────── System Information ───────── */}
      {currentTab === 'system' && isAdmin && (
        !system ? (
          <div style={cardStyle(t)} className="p-5"><LoadState t={t} loading={!systemError} error={systemError} onRetry={loadSystem} /></div>
        ) : (
          <div className="space-y-6">
            {!system.schemaUpToDate && (
              <Notice kind="warn">
                The database is behind this version of PASIG TB-IS, so some pages will fail until it is updated. Start the server once with SKIP_MIGRATIONS=false to apply:{' '}
                {system.schema.filter(s => !s.applied).map(s => `${s.migration} (${s.label})`).join(', ')}.
              </Notice>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div style={cardStyle(t)} className="p-5">
                <CardTitle t={t}>Application</CardTitle>
                <div className="space-y-3">
                  <Row t={t} label="System">{system.name}</Row>
                  <Row t={t} label="Version">{system.version}</Row>
                  <Row t={t} label="Status">
                    <span style={{ color: '#047857' }}>Running</span>
                  </Row>
                  <Row t={t} label="Environment">{system.environment}</Row>
                  <Row t={t} label="Running for">{formatUptime(system.uptimeSeconds)}</Row>
                  <Row t={t} label="Server time">{formatDateTime(system.serverTime)}</Row>
                  <Row t={t} label="Node.js">{system.node}</Row>
                  <Row t={t} label="Patient names (operational records)">{system.patientNamesEnabled ? 'Enabled' : 'Disabled'}</Row>
                </div>
              </div>

              <div style={cardStyle(t)} className="p-5">
                <CardTitle t={t} protectedNote>Database</CardTitle>
                <div className="space-y-3">
                  <Row t={t} label="Records database">
                    <span style={{ color: system.databases.records.ok ? '#047857' : '#B91C1C' }}>
                      {system.databases.records.ok ? `Connected (${system.databases.records.ms} ms)` : 'Not reachable'}
                    </span>
                  </Row>
                  <Row t={t} label="Accounts database">
                    <span style={{ color: system.databases.accounts.ok ? '#047857' : '#B91C1C' }}>
                      {system.databases.accounts.ok ? `Connected (${system.databases.accounts.ms} ms)` : 'Not reachable'}
                    </span>
                  </Row>
                  <Row t={t} label="Startup migrations">{system.startupMigrations === 'skipped' ? 'Skipped (SKIP_MIGRATIONS=true)' : 'Run automatically'}</Row>
                  {system.schema.map((s) => (
                    <Row key={s.migration} t={t} label={`Migration ${s.migration}`}>
                      <span style={{ color: s.applied ? '#047857' : '#B91C1C' }}>{s.label}: {s.applied ? 'Applied' : 'Missing'}</span>
                    </Row>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}
