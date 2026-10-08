import { useState, useEffect, useCallback, useMemo } from 'react';
import API from '../api/axios';
import SkeletonBlock from '../../components/SkeletonBlock';
import ProgressOverlay from '../components/ProgressOverlay';
import ModalCloseButton from '../components/ModalCloseButton';

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
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium" style={{ color: s.text }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.dot }} />
      {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown'}
    </span>
  );
}

const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }) : '—';
const formatTime = (d) => d ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' }) + ' PHT' : '';

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

  useEffect(() => {
    const initialFetch = window.setTimeout(fetchData, 0);
    return () => window.clearTimeout(initialFetch);
  }, [fetchData]);

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
      <div className="flex flex-col gap-6" aria-label="Loading data integration">
        <SkeletonBlock className="h-14 w-full rounded-lg" />
        <SkeletonBlock className="h-32 w-full rounded-lg" />
        <SkeletonBlock className="h-48 w-full rounded-lg" />
        <SkeletonBlock className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ProgressOverlay
        open={undoing}
        title={`Undoing import ${batchToUndo?.batch_id?.slice(0, 8) || ''}`}
        detail="Removing this import's cases and raw rows, then rebuilding the dashboard totals."
        tone="#DC2626"
        note="Keep this page open until the undo finishes."
      />

      {/* Page header */}
      <div className="overflow-hidden rounded-xl bg-white shadow-[0_2px_16px_rgba(15,45,82,0.07),0_1px_3px_rgba(15,45,82,0.04)]">
        <div className="flex flex-col justify-between gap-3 border-b border-[#DBEAFE] px-6 py-3.5 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-[#0F2D52]">Data Integration</h1>
            <p className="mt-0.5 text-xs text-[#94A3B8]">Monitor data received from PASIG TB-IS and processed by TBInsight.</p>
          </div>
          <button type="button" onClick={handleRefresh} disabled={refreshing}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded border border-[#0F2D52] bg-[#0F2D52] px-4 py-2 text-xs font-semibold text-white hover:bg-[#174A7E] disabled:cursor-wait disabled:opacity-70 sm:self-auto">
            <i className={`ri-refresh-line text-xs ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
          <i className="ri-error-warning-line" aria-hidden="true" /> {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="flex items-start gap-2 rounded border px-4 py-3 text-sm"
          style={notice.type === 'success'
            ? { background: 'rgba(16,185,129,0.06)', color: '#047857', border: '1px solid rgba(16,185,129,0.2)' }
            : { background: 'rgba(239,68,68,0.05)', color: '#991B1B', border: '1px solid rgba(239,68,68,0.12)' }}
        >
          <i className={notice.type === 'success' ? 'ri-check-line mt-0.5' : 'ri-error-warning-line mt-0.5'} />
          <span className="flex-1">{notice.text}</span>
          <ModalCloseButton onClick={() => setNotice(null)} label="Dismiss notice" />
        </div>
      )}

      {/* Integration KPIs */}
      <section aria-label="Integration metrics" className="overflow-hidden rounded-xl bg-white shadow-[0_4px_24px_rgba(15,45,82,0.12),0_2px_8px_rgba(15,45,82,0.08)]">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {[
            { label: 'Sync batches', value: status?.stats?.totalBatches, icon: 'ri-stack-line', color: '#6B7FA3', note: 'Webhook deliveries' },
            { label: 'Records received', value: stats?.received, icon: 'ri-download-line', color: '#6B7FA3', note: 'Sent by PASIG TB-IS' },
            { label: 'Records imported', value: stats?.accepted, icon: 'ri-check-line', color: '#6B9E8A', note: 'Added to TBInsight' },
            { label: 'Not imported', value: stats?.rejected, icon: 'ri-subtract-line', color: '#B07070', note: 'Rejected or skipped' },
            { label: 'Failed batches', value: stats?.failed, icon: 'ri-error-warning-line', color: '#B07070', note: 'Delivery or processing failed' },
          ].map((kpi, index) => (
            <div key={kpi.label} className="relative flex min-w-0 flex-col px-4 py-4 sm:px-5 sm:py-5">
              <div className="flex min-h-5 items-start gap-2">
                <i className={`${kpi.icon} shrink-0 text-sm`} style={{ color: kpi.color }} aria-hidden="true" />
                <span className="text-[10px] font-bold uppercase leading-tight tracking-wider text-[#64748B]">{kpi.label}</span>
              </div>
              <div className="my-3 h-px bg-[#E2E8F0]" />
              <p className="text-2xl font-extrabold tabular-nums text-[#0F2D52] lg:text-3xl">{kpi.value == null ? '—' : Number(kpi.value).toLocaleString()}</p>
              <span className="mt-1 text-[11px] font-medium text-[#94A3B8]">{kpi.note}</span>
              {index < 4 && <div className="absolute right-0 top-1/2 hidden h-10 w-px -translate-y-1/2 bg-[#E2E8F0] lg:block" aria-hidden="true" />}
            </div>
          ))}
        </div>
      </section>

      {/* Connection overview */}
      <section className="overflow-hidden rounded-lg border border-[#DCE4ED] bg-white">
        <div className="bg-[#0F2D52] px-5 py-3.5">
          <h2 className="text-sm font-semibold text-white">Integration overview</h2>
        </div>
        <div className="grid divide-y divide-[#E2E8F0] md:grid-cols-2 md:divide-x md:divide-y-0">
          <div className="px-5 py-5">
            <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Source connection</p>
            <div className="mt-3 flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_MAP[status?.status]?.dot || '#94A3B8' }} aria-hidden="true" />
              <p className="text-lg font-semibold text-[#0F2D52]">
                {status?.status === 'connected' ? 'Connected' : status?.status === 'standby' ? 'Standby' : status?.status === 'waiting' ? 'Waiting for data' : 'Status unavailable'}
              </p>
            </div>
            <p className="mt-1 text-sm text-[#64748B]">{status?.message || 'Connection information is unavailable.'}</p>
            <p className="mt-4 border-t border-[#E2E8F0] pt-3 text-xs text-[#64748B]">PASIG TB-IS · Secure webhook</p>
          </div>
          <div className="px-5 py-5">
            <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Last successful sync</p>
            {status?.lastSync ? (
              <>
                <p className="mt-3 text-lg font-semibold text-[#0F2D52]">{formatDate(status.lastSync.receivedAt)}</p>
                <p className="mt-1 text-sm text-[#64748B]">{formatTime(status.lastSync.receivedAt)}</p>
                <p className="mt-4 border-t border-[#E2E8F0] pt-3 text-xs text-[#64748B]">
                  Batch <span className="font-mono font-medium text-[#334155]" title={status.lastSync.batchId}>{status.lastSync.batchId?.slice(0, 8) || '—'}</span>
                </p>
              </>
            ) : <p className="mt-3 text-sm text-[#64748B]">No completed synchronization yet.</p>}
          </div>
        </div>
      </section>

      {/* Incoming webhook batches */}
      <section className="overflow-hidden rounded-lg border border-[#DCE4ED] bg-white">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[#0F2D52]">Incoming batches</h2>
            <p className="mt-0.5 text-xs text-[#64748B]">Webhook deliveries from PASIG TB-IS.</p>
          </div>
          <span className="text-xs text-[#64748B]">{webhookLogs.length} shown</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="bg-[#0F2D52]">
                {['Date', 'Source', 'Batch ID', 'Received', 'Imported', 'Status', ...(isAdmin ? ['Action'] : [])].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-white">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {webhookLogs.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="px-5 py-10 text-center text-sm text-[#64748B]">
                    No incoming batches yet. Deliveries will appear here when PASIG TB-IS sends data.
                  </td>
                </tr>
              ) : webhookLogs.map((log) => (
                <tr
                  key={log.id}
                  className="border-b border-[#E2E8F0] even:bg-[#F8FAFC] hover:bg-[#EDF4FB]"
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
                          className="rounded border border-[#FECACA] bg-white px-2.5 py-1.5 text-xs font-medium text-[#991B1B] hover:bg-[#FEF2F2]"
                          title="Delete this import and everything it added"
                        >
                          Undo import
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Undo History (admin) ── */}
      {isAdmin && undoHistory.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-[#DCE4ED] bg-white">
          <div className="px-5 py-4">
            <h2 className="text-sm font-semibold text-[#0F2D52]">Undo history</h2>
            <p className="mt-0.5 text-xs text-[#64748B]">Imports removed by an administrator.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-left">
              <thead>
                <tr className="bg-[#0F2D52]">
                  {['Undone', 'By', 'Batch ID', 'Cases Removed', 'Raw Rows Removed'].map((h) => (
                    <th key={h} scope="col" className="whitespace-nowrap px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-white">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {undoHistory.map((entry) => (
                  <tr key={entry.id} className="border-b border-[#E2E8F0] even:bg-[#F8FAFC] hover:bg-[#EDF4FB]">
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
        </section>
      )}

      {/* Synchronization history */}
      <section className="overflow-hidden rounded-lg border border-[#DCE4ED] bg-white">
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold text-[#0F2D52]">Synchronization history</h2>
          <p className="mt-0.5 text-xs text-[#64748B]">Select a batch to review its processing details.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left">
            <thead>
              <tr className="bg-[#0F2D52]">
                {['Batch ID', 'Records', 'Accepted', 'Rejected', 'Status', 'Date'].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-white">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {syncHistory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-[#64748B]">
                    No synchronization history yet.
                  </td>
                </tr>
              ) : syncHistory.map((batch) => (
                <tr
                  key={batch.id}
                  className="border-b border-[#E2E8F0] even:bg-[#F8FAFC] hover:bg-[#EDF4FB]"
                >
                  <td className="px-5 py-3 text-xs font-semibold text-[#0F2D52]">
                    <button type="button" onClick={() => setSelectedSync(batch)} className="font-mono text-[#0F2D52] underline-offset-2 hover:underline focus-visible:underline" title={batch.batchId || undefined}>
                      {batch.batchId ? batch.batchId.slice(0, 8) : 'View batch'}
                    </button>
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
      </section>

      {/* Source details */}
      <section className="overflow-hidden rounded-lg border border-[#DCE4ED] bg-white" aria-labelledby="data-route-title">
        <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-5 py-3">
          <h2 id="data-route-title" className="text-sm font-semibold text-[#0F2D52]">Data route</h2>
        </div>
        <div className="grid items-center gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.1fr)_auto_minmax(0,1.3fr)] sm:gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#64748B]">Source</p>
            <p className="mt-1 text-sm font-semibold text-[#0F2D52]">PASIG TB-IS</p>
          </div>
          <span className="text-sm text-[#94A3B8] max-sm:pl-1 sm:text-lg" aria-hidden="true"><span className="sm:hidden">↓</span><span className="hidden sm:inline">→</span></span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#64748B]">Transfer</p>
            <p className="mt-1 text-sm font-semibold text-[#0F2D52]">Verified secure webhook</p>
          </div>
          <span className="text-sm text-[#94A3B8] max-sm:pl-1 sm:text-lg" aria-hidden="true"><span className="sm:hidden">↓</span><span className="hidden sm:inline">→</span></span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#64748B]">Destination</p>
            <p className="mt-1 text-sm font-semibold text-[#0F2D52]">TBInsight records and analytics</p>
          </div>
        </div>
      </section>

      {/* ── Undo Import Confirmation ── */}
      {batchToUndo && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-[#0F2D52]/40 px-4" role="alertdialog" aria-modal="true" aria-labelledby="undo-import-title" onClick={() => !undoing && setBatchToUndo(null)}>
          <div className="relative w-full max-w-md overflow-hidden rounded-lg border border-[#DCE4ED] bg-white shadow-[0_20px_50px_rgba(15,45,82,0.2)]" onClick={(e) => e.stopPropagation()}>
            <div className="bg-[#0F2D52] px-6 py-4">
              <h3 id="undo-import-title" className="text-base font-semibold text-white">Undo import</h3>
              <p className="mt-1 text-xs text-[#B8CDE2]">Review the batch before removing its records.</p>
            </div>
            <div className="space-y-3 px-6 py-5">
              <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] pb-2">
                <span className="text-xs text-[#64748B]">Batch</span>
                <span className="break-all text-right font-mono text-xs font-medium text-[#0F2D52]">{batchToUndo.batch_id}</span>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-[#E2E8F0] pb-2">
                <span className="text-xs text-[#64748B]">Received</span>
                <span className="text-right text-xs font-medium text-[#0F2D52]">{formatDate(batchToUndo.received_at)} {formatTime(batchToUndo.received_at)}</span>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-[#E2E8F0] pb-2">
                <span className="text-xs text-[#64748B]">Records imported</span>
                <span className="text-xs font-medium text-[#0F2D52]">{(batchToUndo.records_imported || 0).toLocaleString()}</span>
              </div>
              <p className="border-l-2 border-[#B91C1C] pl-3 text-xs leading-relaxed text-[#475569]">
                This permanently deletes every case and raw row this batch added, removes its log entry, and rebuilds the dashboard totals. It cannot be undone.
                Forecasts, risk scores and alerts are not recalculated; run the prediction pipeline afterward.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#E2E8F0] px-6 py-4">
              <button type="button"
                onClick={() => setBatchToUndo(null)}
                disabled={undoing}
                className="rounded border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] disabled:opacity-60"
              >
                Cancel
              </button>
              <button type="button"
                onClick={handleUndo}
                disabled={undoing}
                className="rounded bg-[#B91C1C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#991B1B] disabled:opacity-60"
              >
                {undoing ? 'Removing...' : 'Undo import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sync Detail Modal ── */}
      {selectedSync && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-[#0F2D52]/35 px-4" role="dialog" aria-modal="true" aria-labelledby="sync-detail-title" onClick={() => setSelectedSync(null)}>
          <div className="relative w-full max-w-md overflow-hidden rounded-lg border border-[#DCE4ED] bg-white shadow-[0_20px_50px_rgba(15,45,82,0.2)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#E2E8F0] px-6 py-4">
              <h3 id="sync-detail-title" className="text-base font-semibold text-[#0F2D52]">Synchronization details</h3>
              <ModalCloseButton onClick={() => setSelectedSync(null)} />
            </div>
            <div className="space-y-3 px-6 py-5">
              {[
                { label: 'Batch ID', value: selectedSync.batchId || '—' },
                { label: 'Source', value: selectedSync.source || 'PASIG TB-IS' },
                { label: 'Received', value: `${formatDate(selectedSync.receivedAt)} ${formatTime(selectedSync.receivedAt)}` },
                { label: 'Records', value: selectedSync.records.toLocaleString() },
                { label: 'Accepted', value: selectedSync.accepted.toLocaleString() },
                { label: 'Rejected', value: selectedSync.rejected.toLocaleString() },
                { label: 'Status', value: selectedSync.status },
              ].map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] pb-2">
                  <span className="text-xs text-[#64748B]">{row.label}</span>
                  <span className="break-all text-right text-xs font-medium text-[#0F2D52]">{row.value}</span>
                </div>
              ))}
              {selectedSync.errorMessage && (
                <div className="mt-2 border-l-2 border-[#B91C1C] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">
                  <p className="mb-1 font-semibold">Processing error</p>
                  <p>{selectedSync.errorMessage}</p>
                </div>
              )}
            </div>
            <div className="flex justify-end border-t border-[#E2E8F0] px-6 py-4">
              <button type="button"
                onClick={() => setSelectedSync(null)}
                className="rounded bg-[#0F2D52] px-4 py-2 text-xs font-semibold text-white hover:bg-[#174A7E]"
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
