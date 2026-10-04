import { useState, useEffect, useCallback, useMemo } from 'react';
import API from '../api/axios';
import SkeletonBlock from '../../components/SkeletonBlock';
import ProgressOverlay from '../components/ProgressOverlay';

const STATUS_MAP = {
  connected: { bg: '#ECFDF5', text: '#047857', dot: '#10B981' },
  waiting: { bg: '#FFFBEB', text: '#92400E', dot: '#F59E0B' },
  standby: { bg: '#FFF7ED', text: '#9A3412', dot: '#F97316' },
  successful: { bg: '#ECFDF5', text: '#047857', dot: '#10B981' },
  failed: { bg: '#FEF2F2', text: '#991B1B', dot: '#EF4444' },
  processed: { bg: '#ECFDF5', text: '#047857', dot: '#10B981' },
};

function SyncStatusBadge({ status }) {
  const s = STATUS_MAP[status] || { bg: '#F1F5F9', text: '#64748B', dot: '#94A3B8' };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap" style={{ background: s.bg, color: s.text }}>
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
      {status?.charAt(0).toUpperCase() + status?.slice(1)}
    </span>
  );
}

const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const formatTime = (d) => d ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';

export default function DataIntegrationPage() {
  const [status, setStatus] = useState(null);
  const [syncHistory, setSyncHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [webhookLogs, setWebhookLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedSync, setSelectedSync] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [batchToUndo, setBatchToUndo] = useState(null);
  const [undoing, setUndoing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [undoHistory, setUndoHistory] = useState([]);

  const isAdmin = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}')?.role === 'admin';
    } catch {
      return false;
    }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, historyRes, statsRes, webhookRes, undoRes] = await Promise.all([
        API.get('/api/tb/integration/status').catch(() => ({ data: {} })),
        API.get('/api/tb/integration/sync-history').catch(() => ({ data: { batches: [] } })),
        API.get('/api/tb/integration/stats').catch(() => ({ data: {} })),
        API.get('/api/tb/webhook-logs').catch(() => ({ data: { logs: [] } })),
        isAdmin
          ? API.get('/api/tb/integration/undo-history').catch(() => ({ data: { entries: [] } }))
          : Promise.resolve({ data: { entries: [] } }),
      ]);
      setStatus(statusRes.data);
      setSyncHistory(historyRes.data.batches || []);
      setStats(statsRes.data);
      setWebhookLogs(webhookRes.data.logs || []);
      setUndoHistory(undoRes.data.entries || []);
    } catch {
      setError('Unable to load integration status.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAdmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => { setRefreshing(true); setError(''); fetchData(); };

  const handleUndo = async () => {
    if (!batchToUndo?.batch_id) return;
    setUndoing(true);
    try {
      const res = await API.delete(`/api/tb/integration/batches/${batchToUndo.batch_id}`);
      const d = res.data.deleted || {};
      setNotice({
        type: 'success',
        text: `Import ${batchToUndo.batch_id.slice(0, 8)} undone: ${(d.cases || 0).toLocaleString()} cases and ${(d.rawRows || 0).toLocaleString()} raw rows removed, dashboard totals rebuilt. Re-run the prediction pipeline to refresh forecasts and risk scores.`,
      });
      setBatchToUndo(null);
      await fetchData();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.error || 'Unable to undo this import.' });
      setBatchToUndo(null);
    } finally {
      setUndoing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <SkeletonBlock className="h-20 w-full rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <SkeletonBlock className="h-36 rounded-xl" />
          <SkeletonBlock className="h-36 rounded-xl" />
        </div>
        <SkeletonBlock className="h-28 rounded-xl" />
        <SkeletonBlock className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <ProgressOverlay
        open={undoing}
        title={`Undoing import ${batchToUndo?.batch_id?.slice(0, 8) || ''}`}
        detail="Removing this import's cases and raw rows, then rebuilding the dashboard totals."
        icon="ri-arrow-go-back-line"
        tone="#DC2626"
        note="Keep this page open until the undo finishes."
      />

      {/* ── Page Header ── */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff' }}>
        <div className="flex flex-col gap-3 px-6 py-2 sm:flex-row sm:items-center sm:justify-between" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Data Integration</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Monitor the connection and synchronization of tuberculosis data from PASIG TB-IS.</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-4 py-2 text-xs font-semibold rounded flex items-center gap-1.5 transition"
            style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
            onMouseEnter={(e) => { if (!refreshing) { e.currentTarget.style.background = '#E5E7EB'; e.currentTarget.style.borderColor = '#9CA3AF'; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#F3F4F6'; e.currentTarget.style.borderColor = '#D1D5DB'; }}
          >
            <i className={`ri-refresh-line text-sm ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Status
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl text-xs flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B', border: '1px solid rgba(239,68,68,0.12)' }}>
          <i className="ri-error-warning-line" /> {error}
        </div>
      )}

      {notice && (
        <div
          className="px-4 py-3 rounded-xl text-xs flex items-start gap-2"
          style={notice.type === 'success'
            ? { background: 'rgba(16,185,129,0.06)', color: '#047857', border: '1px solid rgba(16,185,129,0.2)' }
            : { background: 'rgba(239,68,68,0.05)', color: '#991B1B', border: '1px solid rgba(239,68,68,0.12)' }}
        >
          <i className={notice.type === 'success' ? 'ri-check-line mt-0.5' : 'ri-error-warning-line mt-0.5'} />
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss"><i className="ri-close-line" /></button>
        </div>
      )}

      {/* ── Connection + Last Sync ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Connection Status */}
        <div className="rounded-xl p-5" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-8 rounded-full" style={{ background: '#3B82F6' }} />
            <h2 className="text-sm font-bold" style={{ color: '#1E293B' }}>PASIG TB-IS Connection</h2>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_MAP[status?.status]?.dot || '#94A3B8' }} />
            <span className="text-sm font-bold" style={{ color: '#0F2D52' }}>
              {status?.status === 'connected' ? 'Connected' : status?.status === 'standby' ? 'Standby' : status?.status === 'waiting' ? 'Waiting for Data' : 'Unknown'}
            </span>
          </div>
          <div className="space-y-2.5">
            {[
              { label: 'Source', value: 'PASIG TB-IS' },
              { label: 'Integration', value: 'REST API / Secure Webhook' },
              { label: 'Status', value: status?.message || '—' },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4">
                <span className="text-xs" style={{ color: '#94A3B8' }}>{row.label}</span>
                <span className="text-xs font-semibold text-right" style={{ color: '#0F2D52' }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Last Synchronization */}
        <div className="rounded-xl p-5" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-8 rounded-full" style={{ background: '#10B981' }} />
            <h2 className="text-sm font-bold" style={{ color: '#1E293B' }}>Last Synchronization</h2>
          </div>
          {status?.lastSync ? (
            <div className="space-y-3">
              <div>
                <p className="text-2xl font-extrabold" style={{ color: '#0F2D52' }}>{formatDate(status.lastSync.receivedAt)}</p>
                <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>{formatTime(status.lastSync.receivedAt)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: '#ECFDF5', color: '#047857' }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#10B981' }} />
                  Successful
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs" style={{ color: '#94A3B8' }}>Batch</span>
                <span className="text-xs font-semibold" style={{ color: '#0F2D52' }}>{status.lastSync.batchId?.slice(0, 8) || '—'}</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8">
              <i className="ri-inbox-line text-2xl mb-2" style={{ color: '#CBD5E1' }} />
              <p className="text-xs text-center" style={{ color: '#94A3B8' }}>No synchronization has been completed yet.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── KPI Cards (shared container with dividers) ── */}
      <div className="rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15, 45, 82, 0.12), 0 2px 8px rgba(15, 45, 82, 0.08)' }}>
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Records Received', value: stats?.received || 0, icon: 'ri-download-line', iconColor: '#6B7FA3' },
            { label: 'Records Accepted', value: stats?.accepted || 0, icon: 'ri-check-line', iconColor: '#6B9E8A' },
            { label: 'Records Rejected', value: stats?.rejected || 0, icon: 'ri-close-line', iconColor: '#B07070' },
            { label: 'Failed Batches', value: stats?.failed || 0, icon: 'ri-error-warning-line', iconColor: '#8B7BA3' },
          ].map((kpi, i) => (
            <div key={kpi.label} className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center gap-2">
                <i className={`${kpi.icon} text-sm`} style={{ color: kpi.iconColor }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>{kpi.label}</span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{kpi.value.toLocaleString()}</p>
              {i < 3 && <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />}
            </div>
          ))}
        </div>
      </div>

      {/* ── Webhook Integration ── */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff' }}>
        <div className="px-6 py-4" style={{ background: '#0F2D52' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold" style={{ color: '#ffffff' }}>Webhook Integration</h2>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)' }}>
              {webhookLogs.length} log{webhookLogs.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                {['Date', 'Source', 'Batch ID', 'Received', 'Imported', 'Status', ...(isAdmin ? ['Action'] : [])].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: '#64748B' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {webhookLogs.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="px-5 py-16 text-center">
                    <i className="ri-webhook-line text-xl mb-2 block" style={{ color: '#CBD5E1' }} />
                    <p className="text-xs" style={{ color: '#94A3B8' }}>No webhook logs available. Webhooks will appear here once the Pasig Clone system sends data.</p>
                  </td>
                </tr>
              ) : webhookLogs.map((log, idx) => (
                <tr
                  key={log.id}
                  style={{ borderBottom: '1px solid #F1F5F9', background: idx % 2 === 0 ? '#ffffff' : '#FAFBFC' }}
                >
                  <td className="px-5 py-3 text-xs" style={{ color: '#94A3B8' }}>
                    <div>{formatDate(log.received_at)}</div>
                    <div className="text-[10px]">{formatTime(log.received_at)}</div>
                  </td>
                  <td className="px-5 py-3 text-xs font-semibold" style={{ color: '#0F2D52' }}>{log.source || '—'}</td>
                  <td className="px-5 py-3 text-xs font-mono" style={{ color: '#64748B' }}>{log.batch_id ? log.batch_id.slice(0, 8) : '—'}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: '#64748B' }}>{(log.records_received || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-xs font-semibold" style={{ color: '#047857' }}>{(log.records_imported || 0).toLocaleString()}</td>
                  <td className="px-5 py-3"><SyncStatusBadge status={log.status} /></td>
                  {isAdmin && (
                    <td className="px-5 py-3">
                      {log.batch_id && (
                        <button
                          onClick={() => setBatchToUndo(log)}
                          className="px-3 py-1.5 text-[11px] font-semibold flex items-center gap-1.5 transition"
                          style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', borderRadius: 4 }}
                          title="Delete this import and everything it added"
                        >
                          <i className="ri-arrow-go-back-line text-xs" /> Undo import
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

      {/* ── Undo History (admin) ── */}
      {isAdmin && undoHistory.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff' }}>
          <div className="px-6 py-4" style={{ background: '#0F2D52' }}>
            <h2 className="text-sm font-bold" style={{ color: '#ffffff' }}>Undo History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                  {['Undone', 'By', 'Batch ID', 'Cases Removed', 'Raw Rows Removed'].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: '#64748B' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {undoHistory.map((entry, idx) => (
                  <tr key={entry.id} style={{ borderBottom: '1px solid #F1F5F9', background: idx % 2 === 0 ? '#ffffff' : '#FAFBFC' }}>
                    <td className="px-5 py-3 text-xs" style={{ color: '#94A3B8' }}>
                      <div>{formatDate(entry.created_at)}</div>
                      <div className="text-[10px]">{formatTime(entry.created_at)}</div>
                    </td>
                    <td className="px-5 py-3 text-xs font-semibold" style={{ color: '#0F2D52' }}>{entry.username}</td>
                    <td className="px-5 py-3 text-xs font-mono" style={{ color: '#64748B' }} title={entry.batch_id}>{entry.batch_id?.slice(0, 8) || '—'}</td>
                    <td className="px-5 py-3 text-xs font-semibold" style={{ color: '#991B1B' }}>{(entry.details?.deleted?.cases || 0).toLocaleString()}</td>
                    <td className="px-5 py-3 text-xs" style={{ color: '#64748B' }}>{(entry.details?.deleted?.rawRows || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Recent Synchronization Table ── */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff' }}>
        {/* Table Header */}
        <div className="px-6 py-4" style={{ background: '#0F2D52' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold" style={{ color: '#ffffff' }}>Recent Synchronization</h2>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                {['Batch ID', 'Records', 'Accepted', 'Rejected', 'Status', 'Date'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: '#64748B' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {syncHistory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center">
                    <i className="ri-inbox-line text-xl mb-2 block" style={{ color: '#CBD5E1' }} />
                    <p className="text-xs" style={{ color: '#94A3B8' }}>No synchronization history available.</p>
                  </td>
                </tr>
              ) : syncHistory.map((batch, idx) => (
                <tr
                  key={batch.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedSync(batch)}
                  style={{ borderBottom: '1px solid #F1F5F9', background: idx % 2 === 0 ? '#ffffff' : '#FAFBFC' }}
                >
                  <td className="px-5 py-3 text-xs font-semibold" style={{ color: '#0F2D52' }}>
                    {batch.batchId ? batch.batchId.slice(0, 8) : '—'}
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: '#64748B' }}>{batch.records.toLocaleString()}</td>
                  <td className="px-5 py-3 text-xs font-semibold" style={{ color: '#047857' }}>{batch.accepted.toLocaleString()}</td>
                  <td className="px-5 py-3 text-xs font-semibold" style={{ color: batch.rejected > 0 ? '#991B1B' : '#64748B' }}>
                    {batch.rejected.toLocaleString()}
                  </td>
                  <td className="px-5 py-3"><SyncStatusBadge status={batch.status} /></td>
                  <td className="px-5 py-3 text-xs" style={{ color: '#94A3B8' }}>{formatDate(batch.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Data Source Info ── */}
      <div className="rounded-xl p-5" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-8 rounded-full" style={{ background: '#64748B' }} />
          <h2 className="text-sm font-bold" style={{ color: '#1E293B' }}>Data Source</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Source System', value: 'PASIG TB-IS', sub: 'Tuberculosis Information System' },
            { label: 'Integration Method', value: 'REST API / Secure Webhook', sub: 'HMAC-SHA256 Verification' },
            { label: 'Destination', value: 'TBInsight PostgreSQL Database', sub: 'TB Records & Analytics' },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold" style={{ color: '#0F2D52' }}>{item.label}</p>
                <p className="text-[10px] mt-0.5" style={{ color: '#94A3B8' }}>{item.sub}</p>
              </div>
              <span className="text-xs font-semibold text-right" style={{ color: '#0F2D52' }}>{item.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Undo Import Confirmation ── */}
      {batchToUndo && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center" style={{ background: 'rgba(15, 45, 82, 0.35)' }} onClick={() => !undoing && setBatchToUndo(null)}>
          <div className="relative w-full max-w-md mx-4 rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 20px 60px rgba(15, 45, 82, 0.25)' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4" style={{ background: '#991B1B' }}>
              <h3 className="text-sm font-bold" style={{ color: '#ffffff' }}>Undo this import?</h3>
            </div>
            <div className="px-6 py-5 space-y-3">
              <div className="flex items-center justify-between gap-4" style={{ borderBottom: '1px solid #F1F5F9' }}>
                <span className="text-xs" style={{ color: '#94A3B8' }}>Batch</span>
                <span className="text-xs font-mono font-semibold" style={{ color: '#0F2D52' }}>{batchToUndo.batch_id}</span>
              </div>
              <div className="flex items-center justify-between gap-4" style={{ borderBottom: '1px solid #F1F5F9' }}>
                <span className="text-xs" style={{ color: '#94A3B8' }}>Received</span>
                <span className="text-xs font-semibold" style={{ color: '#0F2D52' }}>{formatDate(batchToUndo.received_at)} {formatTime(batchToUndo.received_at)}</span>
              </div>
              <div className="flex items-center justify-between gap-4" style={{ borderBottom: '1px solid #F1F5F9' }}>
                <span className="text-xs" style={{ color: '#94A3B8' }}>Records imported</span>
                <span className="text-xs font-semibold" style={{ color: '#0F2D52' }}>{(batchToUndo.records_imported || 0).toLocaleString()}</span>
              </div>
              <p className="text-xs leading-relaxed pt-1" style={{ color: '#64748B' }}>
                This permanently deletes every case and raw row this batch added, removes its log entry, and rebuilds the dashboard totals. It cannot be undone.
                Forecasts, risk scores and alerts are not recalculated; run the prediction pipeline afterward.
              </p>
            </div>
            <div className="px-6 py-4 flex gap-3" style={{ borderTop: '1px solid #E2E8F0' }}>
              <button
                onClick={() => setBatchToUndo(null)}
                disabled={undoing}
                className="flex-1 py-2.5 text-xs font-semibold"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}
              >
                Cancel
              </button>
              <button
                onClick={handleUndo}
                disabled={undoing}
                className="flex-1 py-2.5 text-xs font-semibold"
                style={{ background: '#DC2626', color: '#ffffff', borderRadius: 4, opacity: undoing ? 0.7 : 1 }}
              >
                {undoing ? 'Deleting...' : 'Delete import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sync Detail Modal ── */}
      {selectedSync && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center" style={{ background: 'rgba(15, 45, 82, 0.2)' }} onClick={() => setSelectedSync(null)}>
          <div className="relative w-full max-w-md mx-4 rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 20px 60px rgba(15, 45, 82, 0.25)' }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="px-6 py-4 flex items-center justify-between" style={{ background: '#0F2D52' }}>
              <h3 className="text-sm font-bold" style={{ color: '#ffffff' }}>Synchronization Details</h3>
              <button onClick={() => setSelectedSync(null)} className="w-8 h-8 rounded flex items-center justify-center transition" style={{ background: 'rgba(255,255,255,0.15)' }}>
                <i className="ri-close-line text-sm" style={{ color: '#ffffff' }} />
              </button>
            </div>
            {/* Content */}
            <div className="px-6 py-5 space-y-3">
              {[
                { label: 'Batch ID', value: selectedSync.batchId || '—' },
                { label: 'Source', value: selectedSync.source || 'PASIG TB-IS' },
                { label: 'Received', value: `${formatDate(selectedSync.receivedAt)} ${formatTime(selectedSync.receivedAt)}` },
                { label: 'Records', value: selectedSync.records.toLocaleString() },
                { label: 'Accepted', value: selectedSync.accepted.toLocaleString() },
                { label: 'Rejected', value: selectedSync.rejected.toLocaleString() },
                { label: 'Status', value: selectedSync.status },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4" style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <span className="text-xs" style={{ color: '#94A3B8' }}>{row.label}</span>
                  <span className="text-xs font-semibold text-right" style={{ color: '#0F2D52' }}>{row.value}</span>
                </div>
              ))}
              {selectedSync.errorMessage && (
                <div className="mt-2 p-3 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B', border: '1px solid rgba(239,68,68,0.1)' }}>
                  <p className="font-semibold mb-1">Error</p>
                  <p>{selectedSync.errorMessage}</p>
                </div>
              )}
            </div>
            {/* Footer */}
            <div className="px-6 py-4" style={{ borderTop: '1px solid #E2E8F0' }}>
              <button
                onClick={() => setSelectedSync(null)}
                className="w-full py-2.5 text-xs font-semibold rounded transition"
                style={{ background: '#0F2D52', color: '#ffffff', borderRadius: 4, transition: 'background 0.15s' }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#174A7E'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#0F2D52'}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
