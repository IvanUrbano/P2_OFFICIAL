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

const SYNC_STATUS_TABS = [
  { key: 'all', title: 'All', desc: 'All sync batches' },
  { key: 'sent', title: 'Success', desc: 'Successfully sent' },
  { key: 'failed', title: 'Failed', desc: 'Failed to send' },
];

export default function SyncHistoryPage() {
  const { t } = useTheme();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    API.get('/api/webhook/logs')
      .then(res => setLogs(Array.isArray(res.data) ? res.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const counts = {
    all: logs.length,
    sent: logs.filter(l => l.status === 'sent').length,
    failed: logs.filter(l => l.status !== 'sent').length,
  };

  const filtered = filter === 'all' ? logs : logs.filter(l => l.status === filter);

  if (loading) return <div className="space-y-4"><SkeletonBlock className="h-12" /><SkeletonBlock className="h-64" /></div>;

  return (
    <div className="space-y-5">
      {/* Card Header with Tabs */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        {/* Title Section */}
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Sync History</h1>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>View past synchronization batches.</p>
        </div>

        {/* Tabs */}
        <div>
          <div className="flex gap-0 overflow-x-auto">
            {SYNC_STATUS_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
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
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
        {filtered.length === 0 ? (
          <EmptyState icon="ri-history-line" title="No Sync History" description={filter !== 'all' ? 'No sync batches match the selected filter.' : 'Synchronization batches will appear here after transmitting records.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: '#FAFCFF', borderBottom: '1px solid #E2E8F0' }}>
                  {['Batch ID', 'Status', 'HTTP Code', 'Timestamp'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider" style={{ color: '#0F2D52' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <tr key={log.id} className="cursor-pointer hover:bg-blue-50/40 transition-colors" onClick={() => setSelected(selected === log.id ? null : log.id)} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td className="px-4 py-3 text-xs font-bold font-mono" style={{ color: '#0F2D52' }}>{log.batch_id?.slice(0, 8) || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${log.status === 'sent' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                        {log.status === 'sent' ? 'SUCCESS' : 'FAILED'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold" style={{ color: '#475569' }}>{log.response_code || '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#64748B' }}>{log.sent_at ? new Date(log.sent_at).toLocaleString() : '—'}</td>
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
