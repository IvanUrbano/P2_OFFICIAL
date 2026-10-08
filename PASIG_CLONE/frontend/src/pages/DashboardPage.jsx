import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import SkeletonBlock from '../components/SkeletonBlock';
import { timeAgo } from '../utils/notifications';
import { caseIdLabel } from '../utils/caseId';

const detailCard = {
  background: '#ffffff',
  border: '1px solid #E2E8F0',
  borderRadius: '10px',
  boxShadow: '0 2px 8px rgba(15,23,42,0.04)',
};

// Muted palette for the detail section — deep, low-brightness text colors only.
const C = {
  green: '#047857',
  red: '#B91C1C',
  amber: '#B45309',
  blue: '#1E40AF',
  navy: '#0F2D52',
  brand: '#0F2D52',
  text: '#334155',
  sub: '#64748B',
  faint: '#94A3B8',
  line: '#F1F5F9',
};

/* Shared dark-blue header for dashboard detail cards. */
function CardHeader({ title, tag }) {
  return (
    <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-3" style={{ background: C.brand }}>
      <h2 className="text-[13px] font-semibold" style={{ color: '#ffffff' }}>{title}</h2>
      {tag && (
        <span className="max-w-[55%] truncate text-right text-[11px] font-medium" style={{ color: '#CBD5E1' }} title={tag}>{tag}</span>
      )}
    </div>
  );
}

function CardFooter({ label, onClick }) {
  return (
    <div className="mt-auto border-t border-[#E2E8F0] px-5 py-3">
      <button type="button" onClick={onClick} className="text-[12px] font-semibold text-[#0F2D52] hover:underline focus-visible:underline">
        {label} <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

export default function DashboardPage() {
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
    ? 'City-wide'
    : user?.barangay?.name ? `Brgy. ${user.barangay.name}` : 'No barangay';
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
    ? { text: 'Synced', color: C.green }
    : b.status === 'validated'
      ? { text: 'Validated', color: C.green }
      : b.status === 'uploaded'
        ? { text: 'Pending review', color: C.amber }
        : { text: b.status || 'Unknown', color: C.sub });

  // Strictly the three validation items (batch-level alerts intentionally omitted).
  const actionRows = [
    ...(isAdmin && pa.needsAssignment > 0 ? [{
      label: 'Needs assignment', detail: 'Records waiting for a barangay or facility', n: pa.needsAssignment,
      color: C.red, tab: 'assignment',
    }] : []),
    ...(pa.dataIssues > 0 ? [{
      label: 'Data issues', detail: 'Records that need correction', n: pa.dataIssues,
      color: C.amber, tab: 'issues',
    }] : []),
    ...(pa.possibleMatches > 0 ? [{
      label: 'Possible matches', detail: 'Potential duplicate records to review', n: pa.possibleMatches,
      color: C.blue, tab: 'matches',
    }] : []),
    // Not part of Needs Review: one mapping per facility name covers all its records.
    ...(isAdmin && pa.facilityNamesToMap > 0 ? [{
      label: `Facility names to map (${(pa.facilityRecordsToMap || 0).toLocaleString()} records)`,
      detail: 'Facility names need mapping', n: pa.facilityNamesToMap, color: C.sub, tab: 'assignment',
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
              <i className="ri-database-2-line text-sm" style={{ color: '#2E6FAF' }} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Total TB Records</span>
            </div>
            <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
            <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{(stats?.total || 0).toLocaleString()}</p>
            <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>All records, Pasig and Non-Pasig</span>
            <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
          </div>

          {/* Validated */}
          <div className="flex flex-col px-5 py-5 relative">
            <div className="flex items-center gap-2">
              <i className="ri-checkbox-circle-line text-sm" style={{ color: '#047857' }} />
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
              <i className="ri-error-warning-line text-sm" style={{ color: '#B45309' }} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Needs Review</span>
            </div>
            <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
            <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{(stats?.needsReview || 0).toLocaleString()}</p>
            <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }} title="Possible matches · Needs assignment · Data issues">
              {stats?.needsReviewBreakdown
                ? `${stats.needsReviewBreakdown.possibleMatches.toLocaleString()} matches · ${stats.needsReviewBreakdown.needsAssignment.toLocaleString()} assignment · ${stats.needsReviewBreakdown.dataIssues.toLocaleString()} issues`
                : (isAdmin ? 'Possible matches, assignment & data issues' : 'Unresolved issues in your scope')}
            </span>
            <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
          </div>

          {/* Pending Referrals */}
          <div className="flex flex-col px-5 py-5 relative">
            <div className="flex items-center gap-2">
              <i className="ri-share-forward-line text-sm" style={{ color: '#6D28D9' }} />
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
              <i className="ri-server-line text-sm" style={{ color: '#0E7490' }} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Synced to TBInsight</span>
            </div>
            <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
            <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{(stats?.synced || 0).toLocaleString()}</p>
            <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{isAdmin ? 'Pasig records sent to TBInsight' : 'In-scope records sent to TBInsight'}</span>
          </div>
        </div>
      </div>

      {/* Operational details */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-6 lg:items-stretch">
        {/* Pending Actions */}
        <section style={detailCard} className="flex min-w-0 flex-col overflow-hidden lg:col-span-2">
          <CardHeader title="Pending Actions" />
          <div className="flex-1 px-5 py-3">
            {actionRows.length === 0 ? (
              <p className="py-5 text-[13px]" style={{ color: C.green }}>Nothing needs review right now.</p>
            ) : (
              <div>
                {actionRows.map((row) => (
                  <button
                    type="button"
                    key={row.tab}
                    onClick={() => navigate(`/validation?tab=${row.tab}`)}
                    className="flex w-full items-center justify-between gap-3 border-b border-[#E8EDF2] py-3.5 text-left last:border-b-0 hover:bg-[#F8FAFC] focus-visible:bg-[#F8FAFC] focus-visible:outline-none"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold" style={{ color: C.navy }}>{row.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-4" style={{ color: C.sub }}>{row.detail}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-[17px] font-semibold tabular-nums" style={{ color: row.color }}>
                      {row.n.toLocaleString()} <i className="ri-arrow-right-s-line text-sm text-[#94A3B8]" aria-hidden="true" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <CardFooter label="View validation" onClick={() => navigate('/validation')} />
        </section>

        {/* Recent Imports */}
        <section style={detailCard} className="flex min-w-0 flex-col overflow-hidden lg:col-span-2">
          <CardHeader title="Recent Imports" />
          <div className="flex-1 px-5 py-3">
            {recentImports.length === 0 ? (
              <p className="py-5 text-[13px]" style={{ color: C.sub }}>No imports yet.</p>
            ) : (
              <div>
                {recentImports.slice(0, 3).map((batch, i) => {
                  const badge = importBadge(batch);
                  return (
                    <div key={batch.id} className={`py-3.5 ${i > 0 ? 'border-t border-[#E8EDF2]' : ''}`}>
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <p className="min-w-0 truncate text-[13px] font-semibold" style={{ color: C.navy }} title={batch.filename}>{batch.filename || 'Unnamed import'}</p>
                        <span className="shrink-0 text-[11px] font-semibold" style={{ color: badge.color }}>{badge.text}</span>
                      </div>
                      <p className="text-[11px] mt-1" style={{ color: C.sub }}>{(batch.total_rows || 0).toLocaleString()} records{batch.username ? ` · ${batch.username}` : ''}</p>
                      <p className="mt-0.5 text-[11px]" style={{ color: C.faint }}>{fmtDateTime(batch.created_at)}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <CardFooter label="View all imports" onClick={() => navigate('/import?tab=history')} />
        </section>

        {/* Recent Activity */}
        <section style={detailCard} className="flex min-w-0 flex-col overflow-hidden lg:col-span-2">
          <CardHeader title="Recent Activity" tag={activity.length > 5 ? 'Latest 5' : null} />
          <div className="flex-1 px-5 py-3">
            {activity.length === 0 ? (
              <p className="py-5 text-[13px]" style={{ color: C.sub }}>No recent activity.</p>
            ) : (
              <div>
                {activity.slice(0, 5).map((ev, i) => (
                  <div key={ev.id} className={`py-3 ${i > 0 ? 'border-t border-[#E8EDF2]' : ''}`}>
                    <p className="text-[13px] leading-snug" style={{ color: C.text }}>{ev.text}</p>
                    <p className="mt-1 text-[11px]" style={{ color: C.faint }}>{timeAgoFull(ev.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          {isAdmin && <CardFooter label="View audit logs" onClick={() => navigate('/audit-logs')} />}
        </section>

        {/* Incoming Referrals */}
        <section style={detailCard} className="flex min-w-0 flex-col overflow-hidden lg:col-span-3">
          <CardHeader title="Incoming Referrals" tag={refTag} />
          <div className="flex-1 px-5 py-3">
            {referrals.length === 0 ? (
              <div className="py-5">
                <p className="text-[13px] font-medium" style={{ color: C.green }}>No referrals waiting for review.</p>
                <p className="mt-1 text-[11px]" style={{ color: C.sub }}>{refHelper}</p>
              </div>
            ) : (
              <div>
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
                      <p className="text-[12px] mt-1 pl-3" style={{ color: C.sub }}>{caseIdLabel(r)}</p>
                      <p className="text-[11px] mt-0.5 pl-3" style={{ color: C.faint }}>Pending · {timeAgo(r.created_at || r.initiated_at)}</p>
                    </div>
                    <span className="shrink-0 text-[12px] font-semibold" style={{ color: C.green }}>Review &rarr;</span>
                  </button>
                ))}
                <p className="text-[11px] mt-3" style={{ color: C.faint }}>{refHelper}</p>
              </div>
            )}
          </div>
          <CardFooter label="View all referrals" onClick={() => navigate('/records?view=referrals')} />
        </section>

        {/* Latest TBInsight Sync */}
        <section style={detailCard} className="flex min-w-0 flex-col overflow-hidden lg:col-span-3">
          <CardHeader title="Latest TBInsight Sync" />
          <div className="flex-1 px-5 py-4">
            {latestSync ? (
              latestSync.status === 'sent' ? (
                <div>
                  <div className="flex items-center gap-2">
                    <i className="ri-checkbox-circle-line" style={{ color: C.green }} />
                    <span className="text-[13px] font-semibold" style={{ color: C.green }}>Successful</span>
                  </div>
                  <p className="mt-2 text-[15px] font-semibold" style={{ color: C.navy }}>
                    {(latestSync.records_synced || 0).toLocaleString()} records sent to TBInsight
                  </p>
                  <p className="mt-1 text-[11px]" style={{ color: C.sub }}>{fmtSyncTime(latestSync.sent_at)}</p>
                </div>
              ) : (
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: C.red }}>Sync failed</p>
                  <p className="mt-2 text-[12px]" style={{ color: C.sub }}>Some eligible records could not be sent to TBInsight.</p>
                  <p className="mt-1 text-[11px]" style={{ color: C.sub }}>{fmtSyncTime(latestSync.sent_at)}</p>
                </div>
              )
            ) : (
              <p className="py-3 text-[13px]" style={{ color: C.sub }}>No synchronizations yet.</p>
            )}
          </div>
          <CardFooter label="View sync history" onClick={() => navigate('/sync-history')} />
        </section>
      </div>
    </div>
  );
}
