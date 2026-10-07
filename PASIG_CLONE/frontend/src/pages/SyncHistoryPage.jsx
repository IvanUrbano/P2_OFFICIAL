import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import EmptyState from '../components/EmptyState';
import SkeletonBlock from '../components/SkeletonBlock';
import ModalCloseButton from '../components/ModalCloseButton';
import StatusBadge from '../components/StatusBadge';
import { caseIdLabel } from '../utils/caseId';

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

const SYNC_STATUS_TABS = [
  { key: 'all', title: 'All', desc: 'All sync batches' },
  { key: 'sent', title: 'Successful', desc: 'Sent successfully' },
  { key: 'failed', title: 'Failed', desc: 'Could not be sent' },
];

export default function SyncHistoryPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('all');
  const [rejections, setRejections] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    API.get('/api/webhook/logs')
      .then(res => setLogs(Array.isArray(res.data) ? res.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
    // Admin-only list; only asked for by admins (this app's API client signs the user
    // out on a 403, so a staff user must never trigger one).
    let role = null;
    try { role = JSON.parse(localStorage.getItem('user') || 'null')?.role; } catch { /* not signed in */ }
    if (role === 'admin') {
      API.get('/api/webhook/rejections')
        .then(res => setRejections(res.data.rejections || []))
        .catch(() => {});
    }
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
      {rejections.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #FECACA' }}>
          <div className="px-5 py-3.5 flex items-start gap-3" style={{ background: '#FEF2F2', borderBottom: '1px solid #FECACA' }}>
            <i className="ri-error-warning-line text-lg mt-0.5" style={{ color: '#DC2626' }} />
            <div>
              <h2 className="text-sm font-bold" style={{ color: '#991B1B' }}>
                {rejections.length} record{rejections.length === 1 ? '' : 's'} not accepted by TBInsight
              </h2>
              <p className="text-[11px] mt-0.5" style={{ color: '#7F1D1D' }}>
                These records were sent but TBInsight rejected them, so they are missing from its maps and forecasts.
                Open a record and fix it — saving re-sends it, and it leaves this list once TBInsight accepts it.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0F2D52' }}>
                  {['Case ID', 'Barangay', 'Record type', 'Why it was rejected', 'Rejected at', 'Action'].map((h, index) => (
                    <th key={h || index} className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: '#ffffff', borderBottom: '1px solid #1E40AF', borderRight: index === 5 ? 'none' : '1px solid #1E40AF' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                  {rejections.map((r, index) => (
                    <tr key={r.id} className={index % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'} style={{ borderBottom: '1px solid #E2E8F0' }}>
                      <td className="px-3 py-2.5 text-[11px] font-bold font-mono whitespace-nowrap" style={{ color: '#0F2D52', borderRight: '1px solid #E2E8F0' }}>{caseIdLabel(r)}</td>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color: '#475569', borderRight: '1px solid #E2E8F0' }}>{r.barangay_name || '—'}</td>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color: '#475569', borderRight: '1px solid #E2E8F0' }}>{r.source_type || '—'}</td>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color: '#991B1B', borderRight: '1px solid #E2E8F0' }}>{r.reason}</td>
                      <td className="px-3 py-2.5 text-[11px] whitespace-nowrap" style={{ color: '#64748B', borderRight: '1px solid #E2E8F0' }}>{formatDateTime(r.rejected_at)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => navigate(`/records?record=${r.id}`)} className="px-2.5 py-1 text-[11px] font-semibold rounded cursor-pointer" style={{ color: '#2E6FAF', border: '1px solid #BFDBFE' }}>
                        Open record
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Card Header with Tabs */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
        {/* Title Section */}
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #E2E8F0' }}>
          <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Sync History</h1>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Check when records were sent and whether TBInsight received them successfully.</p>
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
      {/* Table */}
        {filtered.length === 0 ? (
          <EmptyState icon="ri-history-line" title="No Sync History" description={filter !== 'all' ? 'No sync batches match the selected filter.' : 'Synchronization batches will appear here after transmitting records.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0F2D52' }}>
                  {['Batch / file', 'Status', 'Started by', 'Date and time', 'Details'].map((h, index) => (
                    <th key={h || index} className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: '#ffffff', borderBottom: '1px solid #1E40AF', borderRight: index === 4 ? 'none' : '1px solid #1E40AF' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((log, index) => (
                  <tr key={log.id} className={`${index % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'}`} style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <td className="px-2 py-2" style={{ borderRight: '1px solid #E2E8F0' }}>
                      <span className="block text-[11px] font-bold font-mono whitespace-nowrap" style={{ color: '#0F2D52' }} title={log.batch_id || undefined}>{log.batch_id?.slice(0, 8) || '—'}</span>
                      <span className="block max-w-[180px] truncate text-[10px]" style={{ color: '#64748B' }} title={log.filename || undefined}>{log.filename || 'Batch details unavailable'}</span>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap" style={{ borderRight: '1px solid #E2E8F0' }}>
                      <StatusBadge status={log.status === 'sent' ? 'Sent' : 'Failed'} />
                    </td>
                    <td className="px-2 py-2 text-[11px]" style={{ color: '#475569', borderRight: '1px solid #E2E8F0' }}>{log.username || '—'}</td>
                    <td className="px-2 py-2 text-[11px] whitespace-nowrap" style={{ color: '#64748B', borderRight: '1px solid #E2E8F0' }}>{formatDateTime(log.initiated_at || log.sent_at)}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelected(log)}
                        className="px-2 py-1 text-[10px] font-semibold cursor-pointer"
                        style={{ color: '#0F2D52', border: '1px solid #CBD5E1', background: '#ffffff' }}
                      >
                        View details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40" onClick={() => setSelected(null)}>
          <div className="mx-4 flex max-h-[80vh] w-full max-w-[440px] flex-col overflow-hidden border border-gray-200 bg-white shadow-xl" style={{ borderRadius: 5 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: '#0F2D52' }}>Sync details</h2>
                <p className="mt-0.5 text-[11px]" style={{ color: '#64748B' }}>
                  {selected.status === 'sent' ? 'This batch was sent successfully.' : 'This batch could not be sent.'}
                </p>
              </div>
              <ModalCloseButton onClick={() => setSelected(null)} />
            </div>
            <dl className="space-y-3 overflow-y-auto p-5">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#64748B' }}>File</dt>
                <dd className="mt-0.5 break-words text-xs" style={{ color: '#334155' }}>{selected.filename || 'Not available'}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#64748B' }}>Batch ID</dt>
                <dd className="mt-0.5 break-all font-mono text-xs" style={{ color: '#334155' }}>{selected.batch_id || '—'}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#64748B' }}>Status</dt>
                <dd className="mt-1"><StatusBadge status={selected.status === 'sent' ? 'Sent' : 'Failed'} /></dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#64748B' }}>Started by</dt>
                <dd className="mt-0.5 text-xs" style={{ color: '#334155' }}>{selected.username || '—'}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#64748B' }}>Date and time</dt>
                <dd className="mt-0.5 text-xs" style={{ color: '#334155' }}>{formatDateTime(selected.initiated_at || selected.sent_at)}</dd>
              </div>
              {selected.response_code != null && (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#64748B' }}>TBInsight response code</dt>
                  <dd className="mt-0.5 text-xs" style={{ color: '#334155' }}>{selected.response_code} <span style={{ color: '#64748B' }}>(technical status from the receiving service)</span></dd>
                </div>
              )}
              {selected.error_message && (
                <div className="border-l-2 pl-3" style={{ borderColor: '#DC2626' }}>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#991B1B' }}>What went wrong</dt>
                  <dd className="mt-0.5 break-words text-xs leading-5" style={{ color: '#7F1D1D' }}>{selected.error_message}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
