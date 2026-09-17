import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import { useTheme } from '../theme';
import SkeletonBlock from '../components/SkeletonBlock';

const cardStyle = (t) => ({
  background: t.cardSolid,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});

export default function DashboardPage() {
  const { t } = useTheme();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [recentImports, setRecentImports] = useState([]);
  const [latestSync, setLatestSync] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('user') || 'null');
    if (stored) setUser(stored);

    Promise.all([
      API.get('/api/data/stats').catch(() => ({ data: {} })),
      API.get('/api/data/batches').catch(() => ({ data: [] })),
      API.get('/api/webhook/logs').catch(() => ({ data: [] })),
    ]).then(([statsRes, batchesRes, logsRes]) => {
      setStats(statsRes.data);
      setRecentImports(Array.isArray(batchesRes.data) ? batchesRes.data.slice(0, 5) : []);
      const logs = Array.isArray(logsRes.data) ? logsRes.data : [];
      setLatestSync(logs[0] || null);
    }).finally(() => setLoading(false));
  }, []);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonBlock className="h-20 w-full" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <SkeletonBlock key={i} className="h-28" />)}
        </div>
        <SkeletonBlock className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome — Card Header */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Dashboard</h1>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>
            {greeting()}, {user?.username || 'User'}. Manage and monitor tuberculosis records, validation, and data synchronization.
          </p>
        </div>
      </div>

      {/* Unified Key Metric Cards */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15,45,82,0.12), 0 2px 8px rgba(15,45,82,0.08)', border: '1px solid #E2E8F0' }}>
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {/* Total Records */}
          <div className="flex flex-col px-5 py-5 relative">
            <div className="flex items-center gap-2">
              <i className="ri-database-2-line text-sm" style={{ color: '#3B82F6' }} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Total TB Records</span>
            </div>
            <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
            <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{(stats?.total || 0).toLocaleString()}</p>
            <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>Total imported records</span>
            <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
          </div>

          {/* Validated */}
          <div className="flex flex-col px-5 py-5 relative">
            <div className="flex items-center gap-2">
              <i className="ri-checkbox-circle-line text-sm" style={{ color: '#10B981' }} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Validated Records</span>
            </div>
            <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
            <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{(stats?.validated || 0).toLocaleString()}</p>
            <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>Passed system validation</span>
            <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
          </div>

          {/* Pending Validation */}
          <div className="flex flex-col px-5 py-5 relative">
            <div className="flex items-center gap-2">
              <i className="ri-time-line text-sm" style={{ color: '#F97316' }} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Pending Validation</span>
            </div>
            <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
            <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{(stats?.pending || 0).toLocaleString()}</p>
            <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>Awaiting review</span>
            <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
          </div>

          {/* Synced */}
          <div className="flex flex-col px-5 py-5 relative">
            <div className="flex items-center gap-2">
              <i className="ri-server-line text-sm" style={{ color: '#06B6D4' }} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Synced to TBInsight</span>
            </div>
            <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
            <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{(stats?.synced || 0).toLocaleString()}</p>
            <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>Synchronized with central DB</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Imports */}
        <div style={{ background: '#ffffff', border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }} className="p-5">
          <div className="flex items-center justify-between pb-3 mb-4" style={{ borderBottom: '1px solid #F1F5F9' }}>
            <div className="flex items-center gap-2">
              <i className="ri-upload-cloud-2-line text-sm" style={{ color: '#0F2D52' }} />
              <h2 className="text-sm font-bold" style={{ color: '#0F2D52' }}>Recent Imports</h2>
            </div>
            <button onClick={() => navigate('/import')} className="text-[11px] font-semibold transition-colors cursor-pointer" style={{ color: '#2E6FAF' }}>View All</button>
          </div>
          {recentImports.length === 0 ? (
            <p className="text-xs text-center py-8" style={{ color: '#94A3B8' }}>No imports recorded yet</p>
          ) : (
            <div className="space-y-2">
              {recentImports.map((batch) => (
                <div key={batch.id} className="flex items-center justify-between py-2.5 px-3.5 rounded-lg" style={{ background: '#F8FAFC', border: '1px solid #F1F5F9' }}>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold truncate" style={{ color: '#0F2D52' }}>{batch.filename}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: '#64748B' }}>{batch.total_rows} records</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${batch.status === 'sent' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : batch.status === 'validated' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}>
                    {batch.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Latest Sync */}
        <div style={{ background: '#ffffff', border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }} className="p-5">
          <div className="flex items-center justify-between pb-3 mb-4" style={{ borderBottom: '1px solid #F1F5F9' }}>
            <div className="flex items-center gap-2">
              <i className="ri-refresh-line text-sm" style={{ color: '#0F2D52' }} />
              <h2 className="text-sm font-bold" style={{ color: '#0F2D52' }}>Latest Synchronization</h2>
            </div>
            <button onClick={() => navigate('/sync-history')} className="text-[11px] font-semibold transition-colors cursor-pointer" style={{ color: '#2E6FAF' }}>View History</button>
          </div>
          {latestSync ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: latestSync.status === 'sent' ? '#10B981' : '#EF4444' }} />
                <span className="text-xs font-bold" style={{ color: '#0F2D52' }}>{latestSync.status === 'sent' ? 'Sync Successful' : 'Sync Failed'}</span>
              </div>
              <div className="p-3 rounded-lg text-xs space-y-1.5" style={{ background: '#F8FAFC', border: '1px solid #F1F5F9', color: '#475569' }}>
                <p><span className="font-semibold text-gray-500">Date:</span> {latestSync.sent_at ? new Date(latestSync.sent_at).toLocaleString() : '—'}</p>
                <p><span className="font-semibold text-gray-500">HTTP Status:</span> {latestSync.response_code || '—'}</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-center py-8" style={{ color: '#94A3B8' }}>No synchronizations logged yet</p>
          )}
        </div>
      </div>

      {/* Pending Actions */}
      {((stats.pendingActions?.requiresValidation > 0) || (stats.pendingActions?.failedSync > 0)) && (
        <div className="rounded-xl p-5" style={{ background: '#FFFBEB', border: '1px solid #FCD34D', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
          <div className="flex items-center gap-2 mb-3">
            <i className="ri-alert-line text-sm" style={{ color: '#D97706' }} />
            <h2 className="text-sm font-bold" style={{ color: '#92400E' }}>Pending Actions</h2>
          </div>
          <div className="space-y-2">
            {stats.pendingActions?.requiresValidation > 0 && (
              <div className="flex items-center gap-2 text-xs" style={{ color: '#92400E' }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#F59E0B' }} />
                <span>{stats.pendingActions.requiresValidation} batch{stats.pendingActions.requiresValidation !== 1 ? 'es' : ''} require{stats.pendingActions.requiresValidation === 1 ? 's' : ''} validation</span>
                <button onClick={() => navigate('/import')} className="ml-2 text-[10px] font-bold underline cursor-pointer">Review</button>
              </div>
            )}
            {stats.pendingActions?.failedSync > 0 && (
              <div className="flex items-center gap-2 text-xs" style={{ color: '#92400E' }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#EF4444' }} />
                <span>{stats.pendingActions.failedSync} synchronization{stats.pendingActions.failedSync !== 1 ? 's' : ''} failed and require{stats.pendingActions.failedSync === 1 ? 's' : ''} review</span>
                <button onClick={() => navigate('/sync-history')} className="ml-2 text-[10px] font-bold underline cursor-pointer">Review</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
