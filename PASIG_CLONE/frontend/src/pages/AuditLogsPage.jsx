import { useState, useEffect } from 'react';
import API from '../api/axios';
import { useTheme } from '../theme';
import EmptyState from '../components/EmptyState';
import SkeletonBlock from '../components/SkeletonBlock';

const cardStyle = (t) => ({
  background: t.cardSolid,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});

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
    const bits = [v.full_name, v.email].filter(Boolean);
    return bits.length ? bits.join(' · ') : 'None';
  }
  return String(v);
}

/** One-line "Old → New" summary for the Change column; null when nothing to show. */
function changeText(log) {
  const d = parseDetails(log.details);
  if (log.action === 'USER_CREATED' || log.action === 'CREATE_USER') {
    if (!d.role) return null;
    return `New account: ${d.role}${d.barangayName ? ` · ${d.barangayName}` : ''}`;
  }
  if ('old' in d || 'new' in d) return `${fmtValue(d.old)} → ${fmtValue(d.new)}`;
  // Legacy flat details from the old single UPDATE_USER event
  if ('fromRole' in d) {
    const segs = [];
    if (d.fromRole !== d.toRole) segs.push(`${d.fromRole} → ${d.toRole}`);
    if ((d.fromBarangayId ?? null) !== (d.toBarangayId ?? null)) {
      segs.push(`Barangay ${d.fromBarangayId ?? '—'} → ${d.toBarangayId ?? '—'}`);
    }
    if ((d.fromStatus ?? null) !== (d.toStatus ?? null)) segs.push(`${d.fromStatus ?? '—'} → ${d.toStatus ?? '—'}`);
    if (d.nameChanged) segs.push('Name updated');
    if (d.emailChanged) segs.push('Email updated');
    return segs.length ? segs.join(' · ') : null;
  }
  return null;
}

/** "Juan Reyes (Admin)" — role from the write-time snapshot, else the users join. */
function actorLabel(log) {
  const name = log.actor_full_name || log.username || '—';
  const role = parseDetails(log.details).actorRole || log.actor_role;
  if (!role) return name;
  return `${name} (${role.charAt(0).toUpperCase()}${role.slice(1)})`;
}

const humanize = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

export default function AuditLogsPage() {
  const { t } = useTheme();
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
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        {/* Title Section */}
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
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
      </div>

      {/* Table */}
      <div style={cardStyle(t)} className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon="ri-file-list-3-line" title="No Audit Logs" description="System activities will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.borderStrong}` }}>
                  {['Performed By', 'Action', 'User', 'Change', 'Date'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wide" style={{ color: t.textMuted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelected(log)}
                    className="cursor-pointer hover:bg-black/[0.03] transition-colors"
                    style={{ borderBottom: `1px solid ${t.border}` }}
                  >
                    <td className="px-4 py-3 text-xs font-semibold" style={{ color: t.text }}>{actorLabel(log)}</td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(46,111,175,0.1)', color: '#2E6FAF' }}>{log.action}</span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: t.textSecondary }}>{log.target_full_name || log.target_username || '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: t.textSecondary }}>{changeText(log) || '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: t.textSecondary }}>{log.created_at ? new Date(log.created_at).toLocaleString() : '—'}</td>
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
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded cursor-pointer">
                <i className="ri-close-line text-lg" />
              </button>
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
