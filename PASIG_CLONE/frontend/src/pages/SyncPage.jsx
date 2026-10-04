import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import API from '../api/axios';
import { useTheme } from '../theme';
import EmptyState from '../components/EmptyState';
import ProgressOverlay from '../components/ProgressOverlay';

const cardStyle = (t) => ({
  background: t.cardSolid,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});

export default function SyncPage() {
  const { t } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const batchId = searchParams.get('batchId');
  const [sending, setSending] = useState(false);
  const [syncStartedAt, setSyncStartedAt] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const pollRef = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  };

  // The sync runs in the background on the server; follow it until it settles.
  const followSync = useCallback(() => {
    stopPolling();
    setSending(true);
    const poll = async () => {
      try {
        const { data } = await API.get(`/api/webhook/status/${batchId}`);
        setSyncStartedAt(data.startedAt);
        if (data.syncStatus === 'syncing') {
          pollRef.current = setTimeout(poll, 2000);
          return;
        }
        setSending(false);
        if (data.syncStatus === 'synced') {
          setResult({ ...(data.result || {}), message: data.result?.message || 'Synchronized with TBInsight.' });
        } else {
          setError(data.error || 'Synchronization failed.');
        }
      } catch (err) {
        // A brief network hiccup shouldn't end the wait; the sync itself keeps running.
        if (err.response?.status === 404) {
          setSending(false);
          setError('Batch not found.');
        } else {
          pollRef.current = setTimeout(poll, 4000);
        }
      }
    };
    poll();
  }, [batchId]);

  // Opening the page while this batch is already syncing (e.g. coming back to it)
  // picks the running sync up again.
  useEffect(() => {
    if (!batchId) return undefined;
    let cancelled = false;
    API.get(`/api/webhook/status/${batchId}`)
      .then(({ data }) => { if (!cancelled && data.syncStatus === 'syncing') followSync(); })
      .catch(() => {});
    return () => { cancelled = true; stopPolling(); };
  }, [batchId, followSync]);

  const handleSync = async () => {
    if (!batchId) return;
    setShowConfirm(false);
    setSending(true);
    setSyncStartedAt(null);
    setError('');
    setResult(null);
    try {
      await API.post('/api/webhook/send', { batchId });
      followSync();
    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.inProgress) {
        followSync(); // someone already started it — show that sync instead
        return;
      }
      setSending(false);
      setError(err.response?.data?.error || 'Synchronization failed.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Card Header */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Sync to TBInsight</h1>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Synchronize validated tuberculosis records with TBInsight.</p>
        </div>
      </div>

      {/* Connection Status */}
      <div className="rounded-xl p-5" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full animate-pulse" style={{ background: '#10B981' }} />
            <div>
              <p className="text-xs font-bold" style={{ color: '#0F2D52' }}>TBInsight Endpoint Connection</p>
              <p className="text-[11px] mt-0.5" style={{ color: '#64748B' }}>Connected via Secure Webhook Integration (/api/webhook/receiver)</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(16,185,129,0.1)', color: '#10B981' }}>
            Active & Ready
          </span>
        </div>
      </div>

      {!batchId && !result && (
        <div className="rounded-xl p-6" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
          <EmptyState icon="ri-server-line" title="No Batch Selected" description="Import and validate a batch first, then sync it to TBInsight."
            action={<button onClick={() => navigate('/import')} className="px-4 py-2 text-xs font-bold rounded-lg cursor-pointer" style={{ background: '#0F2D52', color: '#fff' }}>Go to Import</button>} />
        </div>
      )}

      <ProgressOverlay
        inline
        open={sending}
        title="Syncing to TBInsight"
        detail="Sending validated records and waiting for TBInsight to import them. This can take a few minutes if TBInsight was idle."
        icon="ri-server-line"
        tone="#06B6D4"
        startedAt={syncStartedAt}
        note="You can leave this page — the sync keeps running, and you'll get a notification when it finishes."
      />

      {batchId && !result && !sending && (
        <div className="rounded-xl p-6" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
          <h3 className="text-sm font-bold mb-1" style={{ color: '#0F2D52' }}>Ready to Synchronize</h3>
          <p className="text-xs mb-4" style={{ color: '#64748B' }}>Batch Reference ID: <span className="font-mono text-gray-700">{batchId}</span></p>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={sending}
            className="px-5 py-2.5 text-xs font-bold rounded-lg disabled:opacity-40 transition-colors cursor-pointer"
            style={{ background: '#10B981', color: '#ffffff', boxShadow: '0 4px 14px rgba(16,185,129,0.25)' }}
          >
            {sending ? 'Syncing Records...' : 'Sync Validated Records'}
          </button>
        </div>
      )}

      {error && !sending && (
        <div className="rounded-xl p-6" style={{ background: '#ffffff', border: '1px solid #FCA5A5', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
          <div className="flex items-center gap-3 mb-2">
            <i className="ri-error-warning-line text-xl" style={{ color: '#EF4444' }} />
            <h3 className="text-sm font-bold" style={{ color: '#991B1B' }}>Synchronization Failed</h3>
          </div>
          <p className="text-xs mb-4" style={{ color: '#7F1D1D' }}>{error}</p>
          <button onClick={handleSync} className="px-4 py-2 text-xs font-bold rounded-lg cursor-pointer" style={{ background: '#0F2D52', color: '#ffffff' }}>Retry Sync</button>
        </div>
      )}

      {result && (() => {
        const rejected = result.recordsRejected || 0;
        const hasCounts = typeof result.recordsImported === 'number';
        const stats = [
          { label: 'Sent', value: result.recordsSent, color: '#0F2D52' },
          { label: 'Imported', value: result.recordsImported, color: '#10B981' },
          { label: 'Updated', value: result.recordsUpdated, color: '#2563EB' },
          { label: 'Rejected', value: result.recordsRejected, color: rejected > 0 ? '#DC2626' : '#64748B' },
        ];
        return (
        <div className="rounded-xl p-6" style={{ background: '#ffffff', border: `1px solid ${rejected > 0 ? '#FCD34D' : '#E2E8F0'}`, boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
          <div className="flex items-center gap-3 mb-4 pb-3" style={{ borderBottom: '1px solid #F1F5F9' }}>
            <i className={`${rejected > 0 ? 'ri-error-warning-line' : 'ri-check-double-line'} text-xl`} style={{ color: rejected > 0 ? '#D97706' : '#10B981' }} />
            <h3 className="text-sm font-bold" style={{ color: '#0F2D52' }}>
              {result.inProgress ? 'Sync In Progress' : result.alreadySynced ? 'Already Synced' : rejected > 0 ? 'Synchronization Complete — Some Records Rejected' : 'Synchronization Complete'}
            </h3>
          </div>
          <p className="text-xs mb-3" style={{ color: '#0F2D52' }}>{result.message || '—'}</p>
          {hasCounts && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {stats.map(s => (
                <div key={s.label} className="p-3.5 rounded-lg" style={{ background: '#F8FAFC', border: '1px solid #F1F5F9' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>{s.label}</p>
                  <p className="text-lg font-extrabold mt-1" style={{ color: s.color }}>{s.value ?? '—'}</p>
                </div>
              ))}
            </div>
          )}
          {rejected > 0 && result.rejectedSamples?.length > 0 && (
            <div className="mt-4 rounded-lg p-3.5" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
              <p className="text-[11px] font-bold mb-2" style={{ color: '#991B1B' }}>
                Rejected by TBInsight{rejected > result.rejectedSamples.length ? ` (showing first ${result.rejectedSamples.length} of ${rejected})` : ''}
              </p>
              <ul className="space-y-1">
                {result.rejectedSamples.map((e, i) => (
                  <li key={i} className="text-[11px]" style={{ color: '#7F1D1D' }}>
                    <span className="font-mono">{e.source_type}{e.row != null ? ` row ${e.row}` : ''}</span>: {(e.errors || []).join('; ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button onClick={() => navigate('/sync-history')} className="mt-4 px-4 py-2 text-xs font-bold rounded-lg cursor-pointer" style={{ border: '1px solid #CBD5E1', background: '#ffffff', color: '#0F2D52' }}>View Sync History &rarr;</button>
        </div>
        );
      })()}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => setShowConfirm(false)}>
          <div className="bg-white border border-gray-200 shadow-xl w-full max-w-[380px] mx-4 overflow-hidden" style={{ borderRadius: '5px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100" style={{ background: '#FAFCFF' }}>
              <div className="flex items-center gap-2">
                <i className="ri-server-line text-lg" style={{ color: '#0F2D52' }} />
                <h3 className="text-sm font-bold" style={{ color: '#0F2D52' }}>Confirm Synchronization</h3>
              </div>
              <button onClick={() => setShowConfirm(false)} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded cursor-pointer">
                <i className="ri-close-line text-lg" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-xs leading-relaxed text-gray-600">
                You are about to transmit validated TB records to the central TBInsight database. Only validated records will be processed.
              </p>
            </div>
            <div className="px-5 py-3.5 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2 text-xs font-bold rounded-md cursor-pointer border border-gray-300 text-gray-600 bg-white">Cancel</button>
              <button onClick={handleSync} className="px-4 py-2 text-xs font-bold text-white bg-[#10B981] rounded-md cursor-pointer hover:bg-[#059669]">Confirm Sync</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
