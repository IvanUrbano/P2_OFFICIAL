import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import { useTheme } from '../theme';
import SkeletonBlock from '../components/SkeletonBlock';
import { timeAgo } from '../utils/notifications';

const cardStyle = (t) => ({
  background: t.cardSolid,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});

const detailCard = {
  background: '#ffffff',
  border: '1px solid #E2E8F0',
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
};

// Muted palette for the detail section — deep, low-brightness text colors only.
const C = {
  green: '#047857',
  red: '#B91C1C',
  amber: '#B45309',
  blue: '#1E40AF',
  navy: '#0F2D52',
  text: '#334155',
  sub: '#64748B',
  faint: '#94A3B8',
  line: '#F1F5F9',
  border: '#E2E8F0',
};

export default function DashboardPage() {
  const { t } = useTheme();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('user') || 'null');
    if (stored) setUser(stored);

    // Pending referrals: staff only see the ones addressed to their barangay,
    // admins see every pending referral city-wide (same rule as the KPI).
    const refUrl = stored?.role === 'admin'
      ? '/api/data/transfers?status=pending'
      : '/api/data/transfers?status=pending&direction=incoming';

    Promise.all([
      API.get('/api/data/stats').catch(() => ({ data: {} })),
      API.get(refUrl).catch(() => ({ data: {} })),
      API.get('/api/data/recent-activity').catch(() => ({ data: {} })),
    ]).then(([statsRes, refRes, actRes]) => {
      setStats(statsRes.data);
      setReferrals(Array.isArray(refRes.data?.transfers) ? refRes.data.transfers.slice(0, 3) : []);
      setActivity(Array.isArray(actRes.data?.activity) ? actRes.data.activity : []);
    }).finally(() => setLoading(false));
  }, []);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const isAdmin = user?.role === 'admin';
  const scopeLabel = isAdmin
    ? 'City-wide'
    : user?.barangay?.name ? `Barangay ${user.barangay.name}` : 'No barangay assigned';

  const refTag = isAdmin
    ? 'CITY-WIDE'
    : user?.barangay?.name ? `BRGY: ${user.barangay.name}` : 'NO BRGY';
  const refHelper = isAdmin
    ? 'Showing all pending referrals city-wide.'
    : user?.barangay?.name
      ? 'Showing referrals assigned to your barangay.'
      : 'No barangay assigned to your account.';

  const recentImports = stats?.recentImports || [];
  const latestSync = stats?.latestSync || null;
  const pa = stats?.pendingActions || {};

  const fmtDateTime = (iso) => (iso
    ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—');

  const fmtSyncTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    const time = d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    return `${date} · ${time}`;
  };

  const timeAgoFull = (iso) => {
    if (!iso) return '';
    const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins === 1 ? '1 minute ago' : `${mins} minutes ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const importBadge = (b) => (b.sync_status === 'synced'
    ? { text: 'SYNCED', color: C.green }
    : b.status === 'validated'
      ? { text: 'VALIDATED', color: C.green }
      : b.status === 'uploaded'
        ? { text: 'PENDING REVIEW', color: C.amber }
        : { text: (b.status || '—').toUpperCase(), color: C.faint });

  // Strictly the three validation items (batch-level alerts intentionally omitted).
  const actionRows = [
    ...(isAdmin && pa.needsAssignment > 0 ? [{
      label: 'Needs assignment', n: pa.needsAssignment, icon: 'ri-error-warning-line',
      color: C.red, tab: 'assignment',
    }] : []),
    ...(pa.dataIssues > 0 ? [{
      label: 'Data issues', n: pa.dataIssues, icon: 'ri-alert-line',
      color: C.amber, tab: 'issues',
    }] : []),
    ...(pa.possibleMatches > 0 ? [{
      label: 'Possible matches', n: pa.possibleMatches, icon: 'ri-information-line',
      color: C.blue, tab: 'matches',
    }] : []),
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonBlock className="h-12 w-full" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[1,2,3,4,5].map(i => <SkeletonBlock key={i} className="h-28" />)}
        </div>
        <SkeletonBlock className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-xl font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>
          {greeting()}, {user?.username || 'User'}.
        </h1>
        <p className="text-sm mt-1" style={{ color: '#64748B' }}>
          Manage and monitor TB records, validation, referrals, and data synchronization.
          {user && (
            <span className="ml-2 font-semibold" style={{ color: '#2E6FAF' }}>
              Scope: {scopeLabel}
            </span>
          )}
        </p>
      </div>

      {/* Unified Key Metric Cards */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15,45,82,0.12), 0 2px 8px rgba(15,45,82,0.08)', border: '1px solid #E2E8F0' }}>
        <div className="grid grid-cols-2 lg:grid-cols-5">
          {/* Total Records */}
          <div className="flex flex-col px-5 py-5 relative">
            <div className="flex items-center gap-2">
              <i className="ri-database-2-line text-sm" style={{ color: '#3B82F6' }} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Total TB Records</span>
            </div>
            <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
            <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{(stats?.total || 0).toLocaleString()}</p>
            <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{isAdmin ? 'Total imported records' : 'TB records in your barangay'}</span>
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
            <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{isAdmin ? 'Passed system validation' : 'Passed validation in your barangay'}</span>
            <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
          </div>

          {/* Needs Review */}
          <div className="flex flex-col px-5 py-5 relative">
            <div className="flex items-center gap-2">
              <i className="ri-error-warning-line text-sm" style={{ color: '#F59E0B' }} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Needs Review</span>
            </div>
            <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
            <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{(stats?.needsReview || 0).toLocaleString()}</p>
            <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{isAdmin ? 'Possible matches, assignment & data issues' : 'Unresolved issues in your scope'}</span>
            <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
          </div>

          {/* Pending Referrals */}
          <div className="flex flex-col px-5 py-5 relative">
            <div className="flex items-center gap-2">
              <i className="ri-share-forward-line text-sm" style={{ color: '#8B5CF6' }} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Pending Referrals</span>
            </div>
            <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
            <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{(stats?.pendingReferrals || 0).toLocaleString()}</p>
            <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{isAdmin ? 'City-wide awaiting review' : 'Awaiting your barangay'}</span>
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
            <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{isAdmin ? 'Pasig records sent to TBInsight' : 'In-scope records sent to TBInsight'}</span>
          </div>
        </div>
      </div>

      {/* ─── Detail section: 2×2 card block + status card of the same length ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        {/* Pending Actions */}
        <div style={detailCard} className="p-5 sm:p-6 flex flex-col">
          <h2 className="text-[11px] font-bold uppercase tracking-wider pb-3" style={{ color: C.sub, borderBottom: `1px solid ${C.line}` }}>Pending Actions</h2>
          {actionRows.length === 0 ? (
            <p className="text-xs text-center py-8 flex-1" style={{ color: C.green }}>✓ No issues require attention.</p>
          ) : (
            <div className="flex-1">
              {actionRows.map((row) => (
                <button
                  key={row.tab}
                  onClick={() => navigate(`/validation?tab=${row.tab}`)}
                  className="w-full flex items-center justify-between gap-2 py-3.5 text-left cursor-pointer border-b"
                  style={{ borderColor: C.line }}
                >
                  <span className="flex items-center gap-2 text-[13px]" style={{ color: C.text }}>
                    <i className={row.icon} style={{ color: row.color }} />
                    {row.label}
                  </span>
                  <span className="text-[17px] font-extrabold tabular-nums" style={{ color: row.color }}>{row.n.toLocaleString()}</span>
                </button>
              ))}
              <p className="text-[11px] mt-3" style={{ color: C.faint }}>Each row opens the corresponding Validation tab.</p>
            </div>
          )}
          <div className="mt-auto pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
            <button onClick={() => navigate('/validation')} className="text-[12px] font-semibold cursor-pointer" style={{ color: C.green }}>View validation &rarr;</button>
          </div>
        </div>

        {/* Recent Imports */}
        <div style={detailCard} className="p-5 sm:p-6 flex flex-col">
          <h2 className="text-[11px] font-bold uppercase tracking-wider pb-3" style={{ color: C.sub, borderBottom: `1px solid ${C.line}` }}>Recent Imports</h2>
          {recentImports.length === 0 ? (
            <p className="text-xs text-center py-8 flex-1" style={{ color: C.faint }}>No imports available.</p>
          ) : (
            <div className="flex-1">
              {recentImports.slice(0, 3).map((batch, i) => {
                const badge = importBadge(batch);
                return (
                  <div key={batch.id} className={`py-3.5 ${i > 0 ? 'border-t' : ''}`} style={{ borderColor: C.line }}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[14px] font-bold truncate" style={{ color: C.navy }}>{batch.filename}</p>
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider" style={{ color: badge.color }}>{badge.text}</span>
                    </div>
                    <p className="text-[11px] mt-1" style={{ color: C.sub }}>{(batch.total_rows || 0).toLocaleString()} records{batch.username ? ` · ${batch.username}` : ''}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>{fmtDateTime(batch.created_at)}</p>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-auto pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
            <button onClick={() => navigate('/import?tab=history')} className="text-[12px] font-semibold cursor-pointer" style={{ color: C.green }}>View all imports &rarr;</button>
          </div>
        </div>

        {/* Recent Activity — spans both rows, same length as the 2×2 block */}
        <div style={detailCard} className="p-5 sm:p-6 flex flex-col lg:row-span-2 max-lg:order-last">
          <h2 className="text-[15px] font-bold pb-3" style={{ color: C.navy, borderBottom: `1px solid ${C.line}` }}>Recent Activity</h2>
          {activity.length === 0 ? (
            <p className="text-xs text-center py-8 flex-1" style={{ color: C.faint }}>No recent activity.</p>
          ) : (
            <div className="flex-1">
              {activity.map((ev) => (
                <div key={ev.id} className="py-3">
                  <div className="flex items-start gap-2.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: C.sub }} />
                    <p className="text-[13px] leading-snug" style={{ color: C.text }}>{ev.text}</p>
                  </div>
                  <p className="text-[11px] mt-1 pl-4" style={{ color: C.faint }}>{timeAgoFull(ev.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
          {isAdmin && (
            <div className="mt-auto pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
              <button onClick={() => navigate('/audit-logs')} className="text-[12px] font-semibold cursor-pointer" style={{ color: C.green }}>View Audit Logs &rarr;</button>
            </div>
          )}
        </div>

        {/* Incoming Referrals */}
        <div style={detailCard} className="p-5 sm:p-6 flex flex-col">
          <div className="flex items-center justify-between gap-2 pb-3" style={{ borderBottom: `1px solid ${C.line}` }}>
            <h2 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: C.sub }}>Incoming Referrals</h2>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.faint }}>{refTag}</span>
          </div>
          {referrals.length === 0 ? (
            <p className="text-xs text-center py-8 flex-1" style={{ color: C.green }}>✓ No pending referrals.</p>
          ) : (
            <div className="flex-1">
              {referrals.map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => navigate(`/records?view=referrals&record=${r.validated_case_id}`)}
                  className={`w-full flex items-start justify-between gap-3 py-3.5 text-left cursor-pointer ${i > 0 ? 'border-t' : ''}`}
                  style={{ borderColor: C.line }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: C.amber }} />
                      <span className="text-[14px] font-bold truncate" style={{ color: C.navy }}>{r.from_barangay || '—'} &rarr; {r.to_barangay || '—'}</span>
                    </div>
                    <p className="text-[12px] mt-1 pl-3" style={{ color: C.sub }}>{r.case_no || `#${r.validated_case_id}`}</p>
                    <p className="text-[11px] mt-0.5 pl-3" style={{ color: C.faint }}>Pending · {timeAgo(r.created_at || r.initiated_at)}</p>
                  </div>
                  <span className="shrink-0 text-[12px] font-semibold" style={{ color: C.green }}>Review &rarr;</span>
                </button>
              ))}
              <p className="text-[11px] mt-3" style={{ color: C.faint }}>{refHelper}</p>
            </div>
          )}
          <div className="mt-auto pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
            <button onClick={() => navigate('/records?view=referrals')} className="text-[12px] font-semibold cursor-pointer" style={{ color: C.green }}>View all referrals &rarr;</button>
          </div>
        </div>

        {/* Latest TBInsight Sync */}
        <div style={detailCard} className="p-5 sm:p-6 flex flex-col">
          <h2 className="text-[11px] font-bold uppercase tracking-wider pb-3" style={{ color: C.sub, borderBottom: `1px solid ${C.line}` }}>Latest TBInsight Sync</h2>
          {latestSync ? (
            latestSync.status === 'sent' ? (
              <div className="flex-1 py-4 space-y-2">
                <div className="flex items-center gap-2">
                  <i className="ri-checkbox-circle-line" style={{ color: C.green }} />
                  <span className="text-[14px] font-bold" style={{ color: C.green }}>Successful</span>
                </div>
                <p className="text-[12px]" style={{ color: C.faint }}>{fmtSyncTime(latestSync.sent_at)}</p>
                <p className="text-[15px] font-extrabold" style={{ color: C.navy }}>
                  {(latestSync.records_synced || 0).toLocaleString()} records synchronized
                </p>
              </div>
            ) : (
              <div className="flex-1 py-4 space-y-2">
                <p className="text-[12px]" style={{ color: C.faint }}>{fmtSyncTime(latestSync.sent_at)}</p>
                <p className="text-[14px] font-bold" style={{ color: C.red }}>⚠ Sync Failed</p>
                <p className="text-[12px]" style={{ color: C.sub }}>Some eligible records could not be synchronized.</p>
                <button onClick={() => navigate('/sync-history')} className="text-[12px] font-semibold cursor-pointer" style={{ color: C.green }}>View Details &rarr;</button>
              </div>
            )
          ) : (
            <p className="text-xs text-center py-8 flex-1" style={{ color: C.faint }}>No synchronizations yet</p>
          )}
          {(!latestSync || latestSync.status === 'sent') && (
            <div className="mt-auto pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
              <button onClick={() => navigate('/sync-history')} className="text-[12px] font-semibold cursor-pointer" style={{ color: C.green }}>View sync history &rarr;</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
