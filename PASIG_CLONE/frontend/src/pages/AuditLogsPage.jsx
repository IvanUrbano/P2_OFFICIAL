import { useState, useEffect } from 'react';
import API from '../api/axios';
import ModalCloseButton from '../components/ModalCloseButton';
import EmptyState from '../components/EmptyState';
import SkeletonBlock from '../components/SkeletonBlock';

// Historical rows keep their pre-rename action names — matchers accept both so
// old entries still count under the renamed tab.
const USER_ACTIONS = [
  'USER_CREATED', 'USER_UPDATED', 'ROLE_CHANGED', 'BARANGAY_ASSIGNMENT_CHANGED',
  'CREATE_USER', 'UPDATE_USER',
];
const ACCESS_ACTIONS = ['ACTIVATE_USER', 'DEACTIVATE_USER', 'LOCK_USER', 'UNLOCK_USER'];

const AUDIT_TABS = [
  { key: '', title: 'All', desc: 'All activities', match: () => true },
  { key: 'LOGIN', title: 'Login', desc: 'Sign-in events', match: (a) => a.includes('LOGIN') },
  { key: 'USERS', title: 'Users', desc: 'Accounts & roles', match: (a) => USER_ACTIONS.includes(a) },
  { key: 'ACCESS', title: 'Access', desc: 'Activate, lock, unlock', match: (a) => a.startsWith('ACCOUNT_') || ACCESS_ACTIONS.includes(a) },
  { key: 'PASSWORD', title: 'Password', desc: 'Resets & changes', match: (a) => a.includes('PASSWORD') },
  { key: 'IMPORT', title: 'Import', desc: 'Data imports', match: (a) => a.includes('IMPORT') },
  { key: 'SYNC', title: 'Sync', desc: 'Synchronizations', match: (a) => a.includes('SYNC') },
];

function parseDetails(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return typeof raw === 'object' ? raw : {};
}

function fmtValue(v) {
  if (v === null || v === undefined || v === '') return 'None';
  if (typeof v === 'object') {
    const bits = [v.full_name, v.email, v.username].filter(Boolean);
    return bits.length ? bits.join(' · ') : 'None';
  }
  return String(v);
}

function displayChange(field, oldValue, newValue) {
  if (oldValue === newValue) return null;
  return `${field}: ${fmtValue(oldValue)} → ${fmtValue(newValue)}`;
}

function targetLabel(log) {
  const details = parseDetails(log.details);
  const affectedUser = log.target_full_name || log.target_username
    || details.targetUsername || details.newUsername || details.username;
  if (affectedUser) return affectedUser;

  const resourceId = log.resource_id || details.recordId || details.batchId || details.transfer_id;
  if (log.resource_type === 'import_batch') {
    if (details.filename) return `Import batch: ${details.filename}`;
    return resourceId ? `Import batch #${String(resourceId).slice(0, 8)}` : 'Import batch';
  }
  if (log.resource_type === 'validated_tb_cases') {
    const caseNo = details.caseNo || details.case_no;
    return caseNo ? `TB record: ${caseNo}` : resourceId ? `TB record #${resourceId}` : 'TB record';
  }
  if (log.resource_type === 'case_transfer') {
    const caseNo = details.caseNo || details.case_no;
    return caseNo ? `Referral: ${caseNo}` : resourceId ? `Referral #${resourceId}` : 'Referral';
  }
  if (log.resource_type === 'facility') {
    return details.name || details.alias || (resourceId ? `Facility #${resourceId}` : 'Health facility');
  }
  if (log.resource_type === 'validation_issues') {
    const row = details.row != null ? ` · row ${details.row}` : '';
    return `Import row${row}`;
  }
  if (log.resource_type === 'user') return log.actor_full_name || log.username || 'Your account';
  if (details.filename) return `File: ${details.filename}`;
  if (details.barangay || details.to_barangay) return details.barangay || `Barangay ${details.to_barangay}`;
  return log.resource_type ? actionLabel(log.resource_type) : 'No specific user or record';
}

/** A readable summary of the recorded event, without exposing secrets or raw payloads. */
function changeText(log) {
  const d = parseDetails(log.details);
  if (log.action === 'USER_CREATED' || log.action === 'CREATE_USER') {
    const access = d.barangayName || (d.access === 'city-wide' ? 'City-wide access' : null);
    return `Account created${d.role ? ` · ${d.role}` : ''}${access ? ` · ${access}` : ''}`;
  }
  if (log.action === 'USER_UPDATED' && d.old && d.new) {
    const changes = [
      displayChange('Name', d.old.full_name, d.new.full_name),
      displayChange('Email', d.old.email, d.new.email),
    ].filter(Boolean);
    return changes.length ? changes.join(' · ') : 'Account details saved; no field differences recorded';
  }
  if (log.action === 'UPDATE_PROFILE') {
    const changes = [
      d.newUsername && `Username set to ${d.newUsername}`,
      d.newEmail && `Email set to ${d.newEmail}`,
    ].filter(Boolean);
    return changes.length ? changes.join(' · ') : 'Profile details updated';
  }
  if (log.action === 'ROLE_CHANGED') return `Role: ${fmtValue(d.old)} → ${fmtValue(d.new)}`;
  if (log.action === 'BARANGAY_ASSIGNMENT_CHANGED') return `Barangay: ${fmtValue(d.old)} → ${fmtValue(d.new)}`;
  if (log.action === 'ACCOUNT_ACTIVATED' || log.action === 'ACCOUNT_DEACTIVATED') {
    return `Account status: ${fmtValue(d.old)} → ${fmtValue(d.new)}`;
  }
  if (log.action === 'ACTIVATE_USER' || log.action === 'DEACTIVATE_USER') {
    return log.action === 'ACTIVATE_USER' ? 'Account activated' : 'Account deactivated';
  }
  if (['LOCK_USER', 'ACCOUNT_LOCKED', 'UNLOCK_USER', 'ACCOUNT_UNLOCKED'].includes(log.action)) {
    return ['LOCK_USER', 'ACCOUNT_LOCKED'].includes(log.action) ? 'Account locked' : 'Account unlocked';
  }
  if (log.action.includes('PASSWORD')) {
    return log.action.includes('RESET') ? 'Temporary password issued; user must change it at next sign-in' : 'Password changed';
  }
  if (log.action.includes('LOGIN')) {
    return log.result === 'SUCCESS' ? 'Sign-in successful' : `Sign-in unsuccessful${d.reason ? ` · ${d.reason}` : ''}`;
  }
  if (log.action === 'IMPORT_FILE') {
    return `${log.result === 'FAILURE' ? 'Import failed' : 'File imported'}${d.filename ? ` · ${d.filename}` : ''}${d.recordCount != null ? ` · ${d.recordCount} records` : ''}`;
  }
  if (log.action === 'IMPORT_FILE_DUPLICATE') {
    return `Duplicate file detected${d.filename ? ` · ${d.filename}` : ''}`;
  }
  if (log.action === 'VALIDATE_BATCH') {
    const counts = [
      d.valid != null && `${d.valid} passed`,
      d.invalid != null && `${d.invalid} with issues`,
      d.warnings != null && `${d.warnings} warnings`,
    ].filter(Boolean);
    return counts.length ? `Validation complete · ${counts.join(' · ')}` : 'Batch validation completed';
  }
  if (log.action === 'SYNC_BATCH') {
    if (log.result !== 'SUCCESS') return `Synchronization failed${d.status ? ` · response ${d.status}` : ''}${d.error ? ` · ${d.error}` : ''}`;
    const counts = [
      d.recordsSent != null && `${d.recordsSent} sent`,
      d.recordsImported != null && `${d.recordsImported} imported`,
      d.recordsUpdated != null && `${d.recordsUpdated} updated`,
      d.recordsRejected != null && `${d.recordsRejected} rejected`,
    ].filter(Boolean);
    return counts.length ? `Synchronization completed · ${counts.join(' · ')}` : 'Synchronization completed';
  }
  if (log.action === 'UPDATE_CASE') {
    const fields = Array.isArray(d.fields) ? d.fields.map(humanize).join(', ') : '';
    return `TB record updated${fields ? ` · Updated: ${fields}` : ''}${d.sync ? ` · Sync: ${d.sync}` : ''}`;
  }
  if (log.action === 'RESOLVE_MATCH') {
    const decision = d.resolution ? actionLabel(d.resolution) : 'decision recorded';
    return `Match resolved · ${decision}${d.candidate ? ` · Matched to ${d.candidate}` : ''}`;
  }
  if (log.action === 'RESOLVE_MATCHES_BULK') {
    const counts = Object.entries(d)
      .filter(([key, value]) => key !== 'requested' && key !== 'choice' && key !== 'failed' && typeof value === 'number')
      .map(([key, value]) => `${value} ${humanize(key).toLowerCase()}`);
    return `Bulk match decision: ${d.choice ? actionLabel(d.choice) : 'completed'} · ${d.requested ?? 0} requested${counts.length ? ` · ${counts.join(' · ')}` : ''}${d.failed ? ` · ${d.failed} failed` : ''}`;
  }
  if (log.action === 'ASSIGN_BARANGAY') {
    return `Assigned to ${d.barangay || 'a barangay'}${d.from ? ` · Previously ${d.from}` : ''}${d.sync ? ` · Sync: ${d.sync}` : ''}`;
  }
  if (log.action === 'CONFIRM_OUTSIDE_PASIG') {
    return `Marked outside Pasig${d.city ? ` · City: ${d.city}` : ''}`;
  }
  if (log.action === 'ARCHIVE_RECORD' || log.action === 'RESTORE_RECORD') {
    return log.action === 'ARCHIVE_RECORD' ? 'TB record archived' : 'TB record restored';
  }
  if (log.action === 'ARCHIVE_BATCH' || log.action === 'UNARCHIVE_BATCH' || log.action === 'DELETE_BATCH') {
    const event = log.action === 'ARCHIVE_BATCH' ? 'Import batch archived'
      : log.action === 'UNARCHIVE_BATCH' ? 'Import batch restored' : 'Import batch deleted';
    return `${event}${d.reason ? ` · Reason: ${d.reason}` : ''}`;
  }
  if (log.action.startsWith('FACILITY_')) {
    if (log.action === 'FACILITY_CREATE') {
      return `Facility added${d.name ? ` · ${d.name}` : ''}${d.barangay_name ? ` · ${d.barangay_name}` : ''}`;
    }
    if (log.action === 'FACILITY_UPDATE') {
      const changedFields = d.changed && typeof d.changed === 'object'
        ? Object.entries(d.changed).map(([key, values]) =>
          `${humanize(key)}: ${fmtValue(values.old)} → ${fmtValue(values.new)}`
        )
        : [];
      return changedFields.length
        ? `Facility updated${d.name ? ` · ${d.name}` : ''} · ${changedFields.join(' · ')}`
        : `Facility updated${d.name ? ` · ${d.name}` : ''}`;
    }
    const alias = d.alias || d.alias_norm;
    const event = log.action === 'FACILITY_ALIAS_ADD' ? 'Facility alias added'
      : log.action === 'FACILITY_ALIAS_REMOVE' ? 'Facility alias removed'
        : 'Facility alias updated';
    return `${event}${alias ? ` · ${alias}` : ''}`;
  }
  if (log.action === 'MAP_FACILITY_BULK') {
    return `Facility mapping updated${d.mapped != null ? ` · ${d.mapped} records` : ''}${Array.isArray(d.mappings) && d.mappings.length ? ` · ${d.mappings.join(', ')}` : ''}`;
  }
  if (log.action === 'FIX_DATA_ISSUE') {
    return `Import row ${d.row ?? '—'} corrected${d.caseNo ? ` · Case ${d.caseNo}` : ''}${d.possibleMatch ? ' · Needs match review' : ''}`;
  }
  if (log.action === 'EXCLUDE_DATA_ISSUE') {
    return `Import row ${d.row ?? '—'} excluded${d.note ? ` · ${d.note}` : ''}`;
  }
  if (log.action === 'RECORDS_PIN_SET') return 'Records access PIN set';
  if (log.action === 'RECORDS_PIN_UNLOCK') {
    return log.result === 'SUCCESS' ? 'Records access unlocked' : `PIN verification failed${d.reason ? ` · ${d.reason}` : ''}`;
  }
  if (log.action === 'MANUAL_ENTRY') {
    const location = d.barangay ? `Barangay ${d.barangay}` : null;
    const diagnosisDate = d.dateOfDiagnosis ? `Diagnosis date ${d.dateOfDiagnosis}` : null;
    return ['Manual record added', location, diagnosisDate].filter(Boolean).join(' · ');
  }
  if (log.action.startsWith('TRANSFER_')) {
    const move = [d.from_barangay, d.to_barangay].filter(Boolean).join(' → ');
    const event = log.action === 'TRANSFER_INITIATED'
      ? 'Referral sent'
      : log.action === 'TRANSFER_ACCEPTED' ? 'Referral accepted' : 'Referral declined';
    return [event, move, d.reason].filter(Boolean).join(' · ');
  }
  if ('old' in d || 'new' in d) return `Value: ${fmtValue(d.old)} → ${fmtValue(d.new)}`;
  // Legacy flat details from the old single UPDATE_USER event
  if ('fromRole' in d) {
    const segs = [];
    if (d.fromRole !== d.toRole) segs.push(`Role: ${d.fromRole} → ${d.toRole}`);
    if ((d.fromBarangayId ?? null) !== (d.toBarangayId ?? null)) {
      segs.push(`Barangay: ${d.fromBarangayId ?? 'None'} → ${d.toBarangayId ?? 'None'}`);
    } else if (d.fromStatus !== d.toStatus) segs.push(`Status: ${d.fromStatus ?? 'None'} → ${d.toStatus ?? 'None'}`);
    if (d.nameChanged) segs.push('Name updated');
    if (d.emailChanged) segs.push('Email updated');
    return segs.length ? segs.join(' · ') : null;
  }
  if (log.result === 'FAILURE') return 'The activity failed; no further details were recorded';
  return 'Activity completed; no change details were recorded';
}

function actionLabel(action) {
  if (!action) return 'Activity';
  return action
    .toLowerCase()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** "Juan Reyes (Admin)" — role from the write-time snapshot, else the users join. */
function actorLabel(log) {
  const name = log.actor_full_name || log.username || 'Not recorded';
  const role = parseDetails(log.details).actorRole || log.actor_role;
  if (!role) return name;
  return `${name} (${role.charAt(0).toUpperCase()}${role.slice(1)})`;
}

const humanize = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

export default function AuditLogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    API.get('/api/auth/audit-logs')
      .then(res => setLogs(Array.isArray(res.data.logs) ? res.data.logs : (Array.isArray(res.data) ? res.data : [])))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const counts = Object.fromEntries(
    AUDIT_TABS.map(tab => [tab.key, logs.filter(l => tab.match(l.action || '')).length])
  );
  const activeTab = AUDIT_TABS.find(tab => tab.key === filter) || AUDIT_TABS[0];
  const filtered = logs.filter(l => activeTab.match(l.action || ''));

  if (loading) return <div className="space-y-4"><SkeletonBlock className="h-12" /><SkeletonBlock className="h-64" /></div>;

  const selectedDetails = selected ? parseDetails(selected.details) : {};
  const hasOldNew = selected && ('old' in selectedDetails || 'new' in selectedDetails);
  const extraDetails = selected
    ? Object.entries(selectedDetails).filter(([k]) => !['old', 'new', 'actorRole'].includes(k))
    : [];

  return (
    <div className="space-y-5">
      {/* Card Header with Tabs */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
        {/* Title Section */}
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #E2E8F0' }}>
          <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Audit Logs</h1>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Monitor important system and account activities.</p>
        </div>

        {/* Tabs */}
        <div>
          <div className="flex gap-0 overflow-x-auto">
            {AUDIT_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className="relative px-5 py-3 text-left transition-colors whitespace-nowrap"
                style={{ background: 'transparent' }}
              >
                <p className="text-[13px] font-bold" style={{ color: filter === tab.key ? '#0F2D52' : '#334155' }}>
                  {tab.title}
                  {counts[tab.key] > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[9px] font-bold px-1.5" style={{ background: filter === tab.key ? 'rgba(15,45,82,0.08)' : '#F1F5F9', color: filter === tab.key ? '#0F2D52' : '#64748B' }}>
                      {counts[tab.key]}
                    </span>
                  )}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: filter === tab.key ? '#475569' : '#64748B' }}>
                  {tab.desc}
                </p>
                {filter === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
        {filtered.length === 0 ? (
          <EmptyState icon="ri-file-list-3-line" title="No Audit Logs" description="System activities will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0F2D52' }}>
                  {['Performed By', 'Action', 'Affected user / record', 'Change', 'Date'].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: '#ffffff', borderBottom: '1px solid #1E40AF', borderRight: h === 'Date' ? 'none' : '1px solid #1E40AF' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((log, index) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelected(log)}
                    className={`${index % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'} cursor-pointer transition-colors hover:bg-blue-50`}
                    style={{ borderBottom: '1px solid #E2E8F0' }}
                  >
                    <td className="px-3 py-2.5 text-[11px] font-semibold whitespace-nowrap" style={{ color: '#0F2D52', borderRight: '1px solid #E2E8F0' }}>{actorLabel(log)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderRight: '1px solid #E2E8F0' }}>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(46,111,175,0.1)', color: '#2E6FAF' }}>{actionLabel(log.action)}</span>
                    </td>
                    <td className="max-w-[220px] px-3 py-2.5 text-[11px]" style={{ color: '#475569', borderRight: '1px solid #E2E8F0' }}>{targetLabel(log)}</td>
                    <td className="max-w-[420px] px-3 py-2.5 text-[11px] leading-5" style={{ color: '#475569', borderRight: '1px solid #E2E8F0' }}>{changeText(log)}</td>
                    <td className="px-3 py-2.5 text-[11px] whitespace-nowrap" style={{ color: '#64748B' }}>{log.created_at && !Number.isNaN(new Date(log.created_at).getTime()) ? new Date(log.created_at).toLocaleString() : 'Date not recorded'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Entry detail card */}
      {selected && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => setSelected(null)}>
          <div className="bg-white border border-gray-200 shadow-xl w-full max-w-[440px] mx-4 overflow-hidden max-h-[80vh] flex flex-col" style={{ borderRadius: '5px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0" style={{ background: '#FAFCFF' }}>
              <div className="flex items-center gap-2">
                <i className="ri-file-list-3-line text-lg" style={{ color: '#0F2D52' }} />
                <h3 className="text-sm font-bold" style={{ color: '#0F2D52' }}>Audit Entry</h3>
              </div>
              <ModalCloseButton onClick={() => setSelected(null)} />
            </div>
            <div className="p-5 overflow-y-auto space-y-3">
              <p className="text-xs" style={{ color: '#94A3B8' }}>
                {selected.created_at ? new Date(selected.created_at).toLocaleString() : '—'}
              </p>

              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold" style={{ color: '#64748B' }}>Action:</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(46,111,175,0.1)', color: '#2E6FAF' }}>{selected.action}</span>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold shrink-0" style={{ color: '#0F2D52' }}>User:</span>
                <span className="text-xs" style={{ color: '#475569' }}>{selected.target_full_name || selected.target_username || '—'}</span>
              </div>

              {hasOldNew && (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold shrink-0" style={{ color: '#0F2D52' }}>Old:</span>
                    <span className="text-xs" style={{ color: '#475569' }}>{fmtValue(selectedDetails.old)}</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold shrink-0" style={{ color: '#0F2D52' }}>New:</span>
                    <span className="text-xs" style={{ color: '#475569' }}>{fmtValue(selectedDetails.new)}</span>
                  </div>
                </>
              )}

              {extraDetails.length > 0 && !hasOldNew && (
                <div className="grid grid-cols-1 gap-1.5 p-3 rounded-lg" style={{ background: '#F8FAFC', border: '1px solid #F1F5F9' }}>
                  {extraDetails.map(([k, v]) => (
                    <div key={k} className="flex items-baseline gap-2">
                      <span className="text-[10px] font-semibold shrink-0" style={{ color: '#94A3B8' }}>{humanize(k)}:</span>
                      <span className="text-xs" style={{ color: '#475569' }}>{fmtValue(v)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold shrink-0" style={{ color: '#0F2D52' }}>Performed By:</span>
                <span className="text-xs" style={{ color: '#475569' }}>{actorLabel(selected)}</span>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold shrink-0" style={{ color: '#0F2D52' }}>IP Address:</span>
                <span className="text-xs font-mono" style={{ color: '#475569' }}>{selected.ip_address || '—'}</span>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold shrink-0" style={{ color: '#0F2D52' }}>Result:</span>
                <span className="text-xs font-bold" style={{ color: selected.result === 'FAILURE' ? '#EF4444' : '#10B981' }}>{selected.result || 'SUCCESS'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
