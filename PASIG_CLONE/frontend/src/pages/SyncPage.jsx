import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import API from '../api/axios';
import ProgressOverlay from '../components/ProgressOverlay';
import ModalCloseButton from '../components/ModalCloseButton';

export default function SyncPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const batchId = searchParams.get('batchId');
  const [sending, setSending] = useState(false);
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
    <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
      <div className="px-6 py-4" style={{ borderBottom: '1px solid #E2E8F0' }}>
          <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Sync to TBInsight</h1>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Synchronize validated tuberculosis records with TBInsight.</p>
      </div>

      <div className="px-5 py-4" style={{ borderBottom: '1px solid #E2E8F0' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#10B981' }} />
            <div>
              <p className="text-xs font-semibold" style={{ color: '#0F2D52' }}>TBInsight connection</p>
              <p className="text-[11px] mt-0.5" style={{ color: '#64748B' }}>Validated records are sent securely to TBInsight.</p>
            </div>
          </div>
          <span className="text-xs font-medium" style={{ color: '#047857' }}>Active</span>
        </div>
      </div>

      {!batchId && !result && (
        <div className="p-5">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: '#0F2D52' }}>No batch selected</h2>
              <p className="mt-1 text-xs leading-5" style={{ color: '#64748B' }}>
                Import and validate a batch before sending its records to TBInsight.
              </p>
            </div>
            <button
              onClick={() => navigate('/import')}
              className="px-4 py-2 text-xs font-semibold cursor-pointer"
              style={{ background: '#0F2D52', color: '#ffffff' }}
            >
              Go to Import
            </button>
          </div>
        </div>
      )}

      <ProgressOverlay
        inline
        open={sending}
        title="Syncing to TBInsight"
        detail="Sending validated records and waiting for TBInsight to import them. This can take a few minutes if TBInsight was idle."
        tone="#06B6D4"
        note="You can leave this page — the sync keeps running, and you'll get a notification when it finishes."
        borderless
      />

      {batchId && !result && !sending && (
        <div className="p-5">
          <h2 className="text-sm font-semibold" style={{ color: '#0F2D52' }}>Ready to sync</h2>
          <p className="mt-1 text-xs" style={{ color: '#64748B' }}>Only validated records in this batch will be sent.</p>
          <p className="mt-3 text-xs" style={{ color: '#64748B' }}>
            Batch ID: <span className="font-mono" style={{ color: '#334155' }}>{batchId}</span>
          </p>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={sending}
            className="mt-4 px-4 py-2 text-xs font-semibold disabled:opacity-40 cursor-pointer"
            style={{ background: '#0F2D52', color: '#ffffff' }}
          >
            {sending ? 'Syncing records…' : 'Sync validated records'}
          </button>
        </div>
      )}

      {error && !sending && (
        <div className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <i className="ri-error-warning-line text-base" style={{ color: '#B91C1C' }} />
            <h2 className="text-sm font-semibold" style={{ color: '#991B1B' }}>Synchronization failed</h2>
          </div>
          <p className="text-xs leading-5" style={{ color: '#7F1D1D' }}>{error}</p>
          <button onClick={handleSync} className="mt-4 px-4 py-2 text-xs font-semibold cursor-pointer" style={{ background: '#0F2D52', color: '#ffffff' }}>Retry sync</button>
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
        <div className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <i className={`${rejected > 0 ? 'ri-error-warning-line' : 'ri-check-line'} text-base`} style={{ color: rejected > 0 ? '#B45309' : '#047857' }} />
            <h2 className="text-sm font-semibold" style={{ color: '#0F2D52' }}>
              {result.inProgress ? 'Sync In Progress' : result.alreadySynced ? 'Already Synced' : rejected > 0 ? 'Synchronization Complete — Some Records Rejected' : 'Synchronization Complete'}
            </h2>
          </div>
          <p className="mb-4 text-xs leading-5" style={{ color: '#475569' }}>{result.message || '—'}</p>
          {hasCounts && (
            <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-4" style={{ borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0' }}>
              {stats.map(s => (
                <div key={s.label} className="py-3">
                  <dt className="text-[11px]" style={{ color: '#64748B' }}>{s.label}</dt>
                  <dd className="mt-1 text-base font-semibold" style={{ color: s.color }}>{s.value ?? '—'}</dd>
                </div>
              ))}
            </dl>
          )}
          {rejected > 0 && result.rejectedSamples?.length > 0 && (
            <div className="mt-4 border-l-2 pl-3" style={{ borderColor: '#D97706' }}>
              <p className="mb-2 text-xs font-semibold" style={{ color: '#92400E' }}>
                Rejected by TBInsight{rejected > result.rejectedSamples.length ? ` (showing first ${result.rejectedSamples.length} of ${rejected})` : ''}
              </p>
              <ul className="space-y-1">
                {result.rejectedSamples.map((e, i) => (
                  <li key={i} className="text-xs leading-5" style={{ color: '#78350F' }}>
                    <span className="font-mono">{e.source_type}{e.row != null ? ` row ${e.row}` : ''}</span>: {(e.errors || []).join('; ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button onClick={() => navigate('/sync-history')} className="mt-4 px-4 py-2 text-xs font-semibold cursor-pointer" style={{ border: '1px solid #CBD5E1', background: '#ffffff', color: '#0F2D52' }}>View sync history</button>
        </div>
        );
      })()}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/35" onClick={() => setShowConfirm(false)}>
          <div className="mx-4 w-full max-w-[400px] overflow-hidden border border-gray-200 bg-white shadow-lg" style={{ borderRadius: 5 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4" style={{ background: '#0F2D52' }}>
              <h3 className="text-sm font-semibold text-white">Confirm sync</h3>
              <ModalCloseButton onClick={() => setShowConfirm(false)} light />
            </div>
            <div className="px-5 py-4">
              <p className="text-xs leading-5" style={{ color: '#475569' }}>
                Send the validated records in this batch to TBInsight?
              </p>
              <p className="mt-2 text-[11px] leading-5" style={{ color: '#64748B' }}>
                Only validated records will be sent. This may take a few minutes.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2 text-xs font-medium cursor-pointer" style={{ border: '1px solid #CBD5E1', color: '#475569', background: '#ffffff' }}>Cancel</button>
              <button onClick={handleSync} className="px-4 py-2 text-xs font-semibold text-white cursor-pointer" style={{ background: '#0F2D52' }}>Confirm sync</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
