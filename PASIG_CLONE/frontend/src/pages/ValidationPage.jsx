import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
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

export default function ValidationPage() {
  const { t } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const batchId = searchParams.get('batchId');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!batchId) return;
    setLoading(true);
    API.post(`/api/data/validate/${batchId}`)
      .then(res => setResult(res.data))
      .catch(err => setError(err.response?.data?.error || 'Validation failed.'))
      .finally(() => setLoading(false));
  }, [batchId]);

  if (!batchId) {
    return (
      <div style={cardStyle(t)} className="p-6">
        <EmptyState icon="ri-checkbox-circle-line" title="No Batch Selected" description="Import a file first, then validate it."
          action={<button onClick={() => navigate('/import')} className="px-4 py-2 text-xs font-semibold rounded-lg" style={{ background: '#0F2D52', color: '#fff' }}>Go to Import</button>} />
      </div>
    );
  }

  if (loading) return <div className="space-y-4"><SkeletonBlock className="h-12" /><SkeletonBlock className="h-64" /></div>;

  if (error) {
    return (
      <div style={cardStyle(t)} className="p-6">
        <EmptyState icon="ri-error-warning-line" title="Validation Failed" description={error}
          action={<button onClick={() => window.location.reload()} className="px-4 py-2 text-xs font-semibold rounded-lg" style={{ background: '#0F2D52', color: '#fff' }}>Try Again</button>} />
      </div>
    );
  }

  if (!result) return null;

  const summary = result.summary || {};

  return (
    <div className="space-y-6">
      {/* Card Header */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Validation</h1>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Review imported records before synchronization.</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
        <div className="grid grid-cols-2 sm:grid-cols-4">
          {[
            { label: 'Total Records', value: summary.total || 0, color: '#3B82F6', icon: 'ri-database-2-line' },
            { label: 'Validated', value: summary.valid || 0, color: '#10B981', icon: 'ri-checkbox-circle-line' },
            { label: 'Invalid', value: summary.invalid || 0, color: '#EF4444', icon: 'ri-close-circle-line' },
            { label: 'Warnings', value: summary.warnings || 0, color: '#F97316', icon: 'ri-alert-line' },
          ].map((kpi, idx) => (
            <div key={kpi.label} className="p-4 relative">
              <div className="flex items-center gap-1.5 mb-1">
                <i className={`${kpi.icon} text-xs`} style={{ color: kpi.color }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>{kpi.label}</span>
              </div>
              <p className="text-2xl font-extrabold mt-1" style={{ color: '#0F2D52' }}>{kpi.value}</p>
              {idx < 3 && <div className="hidden sm:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-8" style={{ background: '#E2E8F0' }} />}
            </div>
          ))}
        </div>
      </div>

      {result.errors?.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
          <div className="flex items-center gap-2 mb-3 pb-2.5" style={{ borderBottom: '1px solid #F1F5F9' }}>
            <i className="ri-error-warning-line text-sm" style={{ color: '#EF4444' }} />
            <h3 className="text-sm font-bold" style={{ color: '#0F2D52' }}>Validation Issues Identified</h3>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
            {result.errors.map((err, i) => (
              <div key={i} className="p-3 rounded-lg text-xs" style={{ background: '#FEF2F2', border: '1px solid #FEE2E2' }}>
                <div className="flex items-center justify-between font-bold" style={{ color: '#991B1B' }}>
                  <span>Row #{err.row}</span>
                  <span className="text-[10px] font-semibold text-gray-500">{err.source_type}</span>
                </div>
                <p className="mt-1 text-[11px]" style={{ color: '#7F1D1D' }}>{err.errors?.join(', ')}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => navigate(`/sync?batchId=${batchId}`)}
          className="px-5 py-2.5 text-xs font-bold rounded-lg transition-colors cursor-pointer"
          style={{ background: '#0F2D52', color: '#ffffff', boxShadow: '0 4px 14px rgba(15,45,82,0.25)' }}
          onMouseEnter={e => e.currentTarget.style.background = '#174A7E'}
          onMouseLeave={e => e.currentTarget.style.background = '#0F2D52'}
        >
          Continue to Synchronization &rarr;
        </button>
      </div>
    </div>
  );
}
