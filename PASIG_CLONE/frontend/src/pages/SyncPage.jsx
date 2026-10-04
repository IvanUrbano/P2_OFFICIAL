import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import API from '../api/axios';
import { useTheme } from '../theme';
import EmptyState from '../components/EmptyState';

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
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSync = async () => {
    if (!batchId) return;
    setShowConfirm(false);
    setSending(true);
    setError('');
    try {
      const res = await API.post('/api/webhook/send', { batchId });
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Synchronization failed.');
    } finally {
      setSending(false);
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

      {batchId && !result && (
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

      {error && (
        <div className="rounded-xl p-6" style={{ background: '#ffffff', border: '1px solid #FCA5A5', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
          <div className="flex items-center gap-3 mb-2">
            <i className="ri-error-warning-line text-xl" style={{ color: '#EF4444' }} />
            <h3 className="text-sm font-bold" style={{ color: '#991B1B' }}>Synchronization Failed</h3>
          </div>
          <p className="text-xs mb-4" style={{ color: '#7F1D1D' }}>{error}</p>
          <button onClick={handleSync} className="px-4 py-2 text-xs font-bold rounded-lg cursor-pointer" style={{ background: '#0F2D52', color: '#ffffff' }}>Retry Sync</button>
        </div>
      )}

      {result && (
        <div className="rounded-xl p-6" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
          <div className="flex items-center gap-3 mb-4 pb-3" style={{ borderBottom: '1px solid #F1F5F9' }}>
            <i className="ri-check-double-line text-xl" style={{ color: '#10B981' }} />
            <h3 className="text-sm font-bold" style={{ color: '#0F2D52' }}>Synchronization Complete</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-lg" style={{ background: '#F8FAFC', border: '1px solid #F1F5F9' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Status</p>
              <p className="text-xs font-bold mt-1" style={{ color: '#10B981' }}>{result.status || 'Sent'}</p>
            </div>
            <div className="p-3.5 rounded-lg" style={{ background: '#F8FAFC', border: '1px solid #F1F5F9' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Message</p>
              <p className="text-xs mt-1" style={{ color: '#0F2D52' }}>{result.message || '—'}</p>
            </div>
          </div>
          <button onClick={() => navigate('/sync-history')} className="mt-4 px-4 py-2 text-xs font-bold rounded-lg cursor-pointer" style={{ border: '1px solid #CBD5E1', background: '#ffffff', color: '#0F2D52' }}>View Sync History &rarr;</button>
        </div>
      )}

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
