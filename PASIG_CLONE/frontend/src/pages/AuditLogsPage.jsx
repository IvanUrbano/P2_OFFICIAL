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

const AUDIT_TABS = [
  { key: '', title: 'All', desc: 'All activities' },
  { key: 'LOGIN', title: 'Login', desc: 'Sign-in events' },
  { key: 'CREATE_USER', title: 'Create User', desc: 'New accounts' },
  { key: 'PASSWORD_RESET', title: 'Password', desc: 'Password resets' },
  { key: 'IMPORT', title: 'Import', desc: 'Data imports' },
  { key: 'SYNC', title: 'Sync', desc: 'Synchronizations' },
];

export default function AuditLogsPage() {
  const { t } = useTheme();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    API.get('/api/auth/audit-logs')
      .then(res => setLogs(Array.isArray(res.data.logs) ? res.data.logs : (Array.isArray(res.data) ? res.data : [])))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const counts = {
    '': logs.length,
    'LOGIN': logs.filter(l => l.action?.includes('LOGIN')).length,
    'CREATE_USER': logs.filter(l => l.action?.includes('CREATE_USER')).length,
    'PASSWORD_RESET': logs.filter(l => l.action?.includes('PASSWORD_RESET')).length,
    'IMPORT': logs.filter(l => l.action?.includes('IMPORT')).length,
    'SYNC': logs.filter(l => l.action?.includes('SYNC')).length,
  };

  const filtered = filter ? logs.filter(l => l.action?.includes(filter)) : logs;

  if (loading) return <div className="space-y-4"><SkeletonBlock className="h-12" /><SkeletonBlock className="h-64" /></div>;

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
                  {['User', 'Action', 'Target', 'Date'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wide" style={{ color: t.textMuted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((log) => (
                  <tr key={log.id} style={{ borderBottom: `1px solid ${t.border}` }}>
                    <td className="px-4 py-3 text-xs font-semibold" style={{ color: t.text }}>{log.username}</td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(46,111,175,0.1)', color: '#2E6FAF' }}>{log.action}</span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: t.textSecondary }}>{log.target_username || '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: t.textSecondary }}>{log.created_at ? new Date(log.created_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
