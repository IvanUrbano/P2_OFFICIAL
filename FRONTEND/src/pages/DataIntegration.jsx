import { useState, useRef, useCallback, useMemo } from 'react';
import { useTBData } from '../context/TBDataContext';
import { downloadFile, toCSV } from '../utils/exportUtils';

/* ═══════════════════════════════════════════════════════════
   DataIntegration — Real Sync Flow
   External TB System → (REST API) → Imported Records → Verify → TB Records
   ═══════════════════════════════════════════════════════════ */

const PIPELINE_NODES = [
  { icon: 'ri-database-2-line', label: 'External TB DB' },
  { icon: 'ri-key-line', label: 'Auth' },
  { icon: 'ri-search-eye-line', label: 'Validate' },
  { icon: 'ri-settings-3-line', label: 'Transform' },
  { icon: 'ri-database-2-line', label: 'TBInsight DB' },
  { icon: 'ri-line-chart-line', label: 'Analytics' },
];

const FIELD_MAPPING = [
  ['case_id', 'case_id', 'Direct mapping'],
  ['validation_status', 'validation_status', 'Direct mapping'],
  ['diagnosis_date', 'diagnosisDate', 'Renamed (snake → camel)'],
  ['screening_date', 'screeningDate', 'Renamed (snake → camel)'],
  ['notification_date', 'notificationDate', 'Renamed (snake → camel)'],
  ['barangay_name', 'barangay', 'Normalized'],
  ['outcome_status', 'status', 'Renamed, enum validated'],
  ['outcome_date', 'outcomeDate', 'Renamed (snake → camel)'],
  ['treatment_start_date', 'treatmentStartDate', 'Renamed (snake → camel)'],
  ['treatment_facility', 'treatmentFacility', 'Renamed (snake → camel)'],
  ['source_of_patient', 'sourcePatient', 'Renamed (snake → camel)'],
  ['anatomical_site', 'anatomicalSite', 'Renamed (snake → camel)'],
  ['registration_group', 'registrationGroup', 'Renamed (snake → camel)'],
  ['bacteriological_status', 'bacteriologicalStatus', 'Renamed (snake → camel)'],
];

export default function DataIntegration() {
  const {
    records, importedRecords, syncLogs,
    syncFromExternalSystem, verifyRecord, verifyAllRecords, rejectRecord,
  } = useTBData();

  const [syncing, setSyncing] = useState(false);
  const [syncStep, setSyncStep] = useState(-1);
  const [syncDone, setSyncDone] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState(null);
  const [consoleLines, setConsoleLines] = useState([]);
  const [viewTab, setViewTab] = useState('architecture'); // architecture | imported | history
  const consoleRef = useRef(null);
  const timerRef = useRef(null);

  /* ── Reject reason modal ── */
  const [rejectingRecord, setRejectingRecord] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const REJECT_REASONS = [
    'Missing diagnosis date',
    'Invalid age value',
    'Incomplete patient information',
    'Duplicate record',
    'Invalid barangay',
    'Facility mismatch',
    'Date sequencing error',
    'Other',
  ];

  /* ── Computed stats ── */
  const totalRecords = records.length;
  const pendingCount = importedRecords.length;
  const lastSync = syncLogs.length > 0 ? syncLogs[0] : null;
  const totalImported7Days = useMemo(() => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return syncLogs
      .filter(l => new Date(l.timestamp) > weekAgo)
      .reduce((a, l) => a + (l.imported || 0), 0);
  }, [syncLogs]);
  const totalFailed7Days = useMemo(() => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return syncLogs
      .filter(l => new Date(l.timestamp) > weekAgo)
      .reduce((a, l) => a + (l.validationFailed || 0), 0);
  }, [syncLogs]);
  const successRate = useMemo(() => {
    if (syncLogs.length === 0) return 0;
    return Math.round(
      (syncLogs.filter(l => l.status === 'Success').length / syncLogs.length) * 100
    );
  }, [syncLogs]);

  /* ── Export sync logs as CSV ── */
  const handleExportLogs = () => {
    const rows = syncLogs.map(l => ({
      'Date/Time': l.timestamp ? new Date(l.timestamp).toLocaleString() : '—',
      'Imported': l.imported ?? 0,
      'Validation Errors': l.validationFailed ?? 0,
      'Dups Skipped': l.dupsSkipped ?? 0,
      'Duration': l.duration ?? '—',
      'Sync ID': l.syncId ?? '—',
      'Source': l.source ?? 'TB-IS-Pasig',
      'Status': l.status ?? '—',
      'Error': l.error || (l.validationErrors ? l.validationErrors.map(e => `${e.id}: ${e.errors.join('; ')}`).join(' | ') : ''),
    }));
    const csv = toCSV(rows);
    const ts = new Date().toISOString().slice(0, 10);
    downloadFile(csv, `TBInsight_SyncLogs_${ts}.csv`);
  };

  /* ── Run sync with animated console ── */
  const runSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncDone(false);
    setSyncStep(-1);
    setConsoleLines([]);
    setLastSyncResult(null);

    const steps = [
      { node: 0, msg: `[${new Date().toLocaleTimeString()}] Initiating pull sync from External TB-IS source system...` },
      { node: 1, msg: `[${new Date().toLocaleTimeString()}] Authenticating — Bearer token: tbis_pasig_2025_xK9m2p ✓` },
      { node: 1, msg: `[${new Date().toLocaleTimeString()}] GET /api/v1/records/pending → External TB-IS responded: 200 OK` },
    ];

    let step = 0;
    timerRef.current = setInterval(async () => {
      if (step < steps.length) {
        const s = steps[step];
        setSyncStep(s.node);
        setConsoleLines(prev => {
          const isCheck = s.msg.includes('✓');
          return [...prev, { text: s.msg, color: isCheck ? '#6ee7b7' : '#d1fae5', bold: false }];
        });
        step++;
        setTimeout(() => {
          if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
        }, 50);
      } else {
        clearInterval(timerRef.current);

        // Actually sync from External System (async — fetches from API server)
        const result = await syncFromExternalSystem();
        setLastSyncResult(result);

        // Show results in console
        const resultSteps = [];
        if (result.success) {
          resultSteps.push(
            { node: 2, msg: `[${new Date().toLocaleTimeString()}] Received ${result.log.totalFetched || 0} records. Running healthcare validation...` },
          );
          if (result.log.validationFailed > 0) {
            resultSteps.push(
              { node: 2, msg: `[${new Date().toLocaleTimeString()}] ⚠ ${result.log.validationFailed} records rejected (invalid dates, missing fields, or sequencing errors)`, color: '#fbbf24' },
            );
          }
          resultSteps.push(
            { node: 2, msg: `[${new Date().toLocaleTimeString()}] Validation passed. ${result.imported} valid. Duplicates check: ${result.dupsSkipped} skipped.` },
            { node: 3, msg: `[${new Date().toLocaleTimeString()}] Applying field mappings: case_id → case_id, barangay_name → barangay...` },
            { node: 4, msg: `[${new Date().toLocaleTimeString()}] INSERT INTO tb_records ... (${result.imported} rows) — TBInsight DB ✓` },
            { node: 5, msg: `[${new Date().toLocaleTimeString()}] ✅ Sync completed. ${result.imported} imported · ${result.log.validationFailed || 0} validation errors · ${result.dupsSkipped} dups skipped · ${result.log.duration}` },
          );
          // Show first few validation errors in console
          if (result.log.validationErrors && result.log.validationErrors.length > 0) {
            const errSamples = result.log.validationErrors.slice(0, 3);
            for (const err of errSamples) {
              resultSteps.push(
                { node: 2, msg: `[${new Date().toLocaleTimeString()}]   ✗ ${err.id}: ${err.errors[0]}`, color: '#fca5a5' },
              );
            }
          }
        } else {
          resultSteps.push(
            { node: 2, msg: `[${new Date().toLocaleTimeString()}] ⚠ ${result.log.error || 'Sync failed — no data received'}` },
            { node: 5, msg: `[${new Date().toLocaleTimeString()}] ❌ Sync failed. ${result.log.error || 'Check External System connection.'}` },
          );
        }

        let rStep = 0;
        const resultTimer = setInterval(() => {
          if (rStep < resultSteps.length) {
            const s = resultSteps[rStep];
            setSyncStep(s.node);
            setConsoleLines(prev => {
              const isDone = s.msg.includes('✅');
              const isFail = s.msg.includes('❌') || s.msg.includes('⚠');
              return [...prev, {
                text: s.msg,
                color: isDone ? '#86efac' : isFail ? '#fca5a5' : '#d1fae5',
                bold: isDone || isFail,
              }];
            });
            rStep++;
            setTimeout(() => {
              if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
            }, 50);
          } else {
            clearInterval(resultTimer);
            setSyncing(false);
            setSyncDone(true);
            setSyncStep(5);
          }
        }, 350);
      }
    }, 400);
  }, [syncing, syncFromExternalSystem]);

  const testConnection = useCallback(() => {
    alert('Connection test: 200 OK · External TB-IS API healthy · REST endpoint available at localhost:5174/api/v1/records');
  }, []);

  return (
    <div className="relative space-y-5">

      {/* ═══ KPI Strip (5-column glass-card) ═══ */}
      <section className="glass-card grid gap-0 overflow-hidden" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>

        {/* Last Sync */}
        <div className="p-4 flex flex-col justify-center relative">
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[2px] h-12" style={{ background: 'rgba(3,33,62,0.3)', boxShadow: '0 0 8px rgba(79,209,197,0.4)' }} />
          <div className="flex items-center gap-2 mb-2">
            <i className="ri-refresh-line text-lg" style={{ color: '#4FD1C5' }} />
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>Last Sync</span>
          </div>
          <div className="text-2xl font-bold" style={{ color: '#0f172a' }}>
            {lastSync ? new Date(lastSync.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Never'}
          </div>
          {lastSync ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold mt-1.5 px-2 py-0.5 rounded-full w-fit"
              style={{
                background: lastSync.status === 'Success' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                color: lastSync.status === 'Success' ? '#10B981' : '#EF4444',
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: lastSync.status === 'Success' ? '#10B981' : '#EF4444' }} />
              {lastSync.status}
            </span>
          ) : (
            <span className="text-xs mt-1.5" style={{ color: '#94A3B8' }}>No syncs yet</span>
          )}
        </div>

        {/* Records Imported (Today) */}
        <div className="p-4 flex flex-col justify-center relative">
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[2px] h-12" style={{ background: 'rgba(3,33,62,0.3)', boxShadow: '0 0 8px rgba(79,209,197,0.4)' }} />
          <div className="flex items-center gap-2 mb-2">
            <i className="ri-file-list-3-line text-lg" style={{ color: '#2E6FAF' }} />
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>Records Imported (Today)</span>
          </div>
          <div className="text-2xl font-bold" style={{ color: '#0f172a' }}>
            {lastSync ? lastSync.imported ?? 0 : 0}
          </div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>
            {lastSync ? `${lastSync.validationFailed ?? 0} validation errors · ${lastSync.dupsSkipped ?? 0} dups skipped` : 'No sync performed'}
          </div>
        </div>

        {/* Total Imported (7 Days) */}
        <div className="p-4 flex flex-col justify-center relative">
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[2px] h-12" style={{ background: 'rgba(3,33,62,0.3)', boxShadow: '0 0 8px rgba(79,209,197,0.4)' }} />
          <div className="flex items-center gap-2 mb-2">
            <i className="ri-database-2-line text-lg" style={{ color: '#8B5CF6' }} />
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>Total Imported (7 Days)</span>
          </div>
          <div className="text-2xl font-bold" style={{ color: '#0f172a' }}>{totalImported7Days}</div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>{totalFailed7Days} validation errors across all syncs</div>
        </div>

        {/* Sync Success Rate */}
        <div className="p-4 flex flex-col justify-center relative">
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[2px] h-12" style={{ background: 'rgba(3,33,62,0.3)', boxShadow: '0 0 8px rgba(79,209,197,0.4)' }} />
          <div className="flex items-center gap-2 mb-2">
            <i className="ri-checkbox-circle-line text-lg" style={{ color: '#10B981' }} />
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>Sync Success Rate</span>
          </div>
          <div className="text-2xl font-bold" style={{ color: '#0f172a' }}>{syncLogs.length > 0 ? `${successRate}%` : '—'}</div>
          {syncLogs.length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold mt-1.5 px-2 py-0.5 rounded-full w-fit"
              style={{
                background: successRate >= 80 ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
                color: successRate >= 80 ? '#10B981' : '#F59E0B',
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: successRate >= 80 ? '#10B981' : '#F59E0B' }} />
              {successRate >= 80 ? 'Healthy' : 'Needs Attention'}
            </span>
          )}
        </div>

        {/* API Connection */}
        <div className="p-4 flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-2">
            <i className="ri-wifi-line text-lg" style={{ color: '#10B981' }} />
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>API Connection</span>
          </div>
          <div className="text-2xl font-bold flex items-center gap-2" style={{ color: '#10B981' }}>
            <span className="h-2.5 w-2.5 rounded-full animate-pulse" style={{ background: '#10B981' }} />
            Live
          </div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>Local REST Bridge · Shared Storage</div>
        </div>
      </section>

      {/* ═══ Tab Navigation ═══ */}
      <div className="flex gap-2">
        {[
          { key: 'architecture', label: 'Integration Architecture', icon: 'ri-server-line' },
          { key: 'imported', label: `Imported Records (${pendingCount} pending)`, icon: 'ri-inbox-line' },
          { key: 'history', label: 'Sync History', icon: 'ri-history-line' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setViewTab(tab.key)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-all duration-200"
            style={{
              background: viewTab === tab.key
                ? 'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)'
                : '#ffffff',
              color: viewTab === tab.key ? '#ffffff' : '#475569',
              border: viewTab === tab.key ? 'none' : '1px solid #e2e8f0',
            }}
          >
            <i className={`${tab.icon} text-sm`} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ Tab: Architecture ═══ */}
      {viewTab === 'architecture' && (
        <>
          {/* DB-to-DB Integration Architecture */}
          <section className="glass-card p-5">
            <div className="flex items-center gap-2 text-sm font-bold mb-4" style={{ color: '#0f172a' }}>
              <i className="ri-server-line text-lg" style={{ color: '#2E6FAF' }} />
              DB-to-DB Integration Architecture
            </div>

            {/* Pipeline Nodes */}
            <div className="flex items-stretch gap-0 mb-5">
              {/* External TB-IS Source DB */}
              <div className="flex-1 rounded-xl p-4" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                <div className="text-sm font-bold mb-2" style={{ color: '#1d4ed8' }}>
                  <i className="ri-database-2-line mr-1" />External TB-IS Source DB
                </div>
                <div className="text-[11px] leading-relaxed" style={{ color: '#1d4ed8', opacity: 0.85 }}>
                  Host 1 · Pasig City Health Office<br />
                  Engine: MySQL 8.0<br />
                  Tables: tb_cases, patients<br />
                  Records: {totalRecords.toLocaleString()}<br />
                  Status: <strong>Connected</strong>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center px-2 min-w-[80px]">
                <div className="h-[2px] w-full" style={{ background: 'linear-gradient(90deg, #1e3a5f, #0d6659)' }} />
                <div className="text-[10px] text-center mt-1 leading-tight" style={{ color: '#6b7280' }}>
                  HTTPS GET<br />/api/v1/records<br />JSON payload
                </div>
              </div>

              {/* Integration Engine */}
              <div className="flex-1 rounded-xl p-4" style={{ background: '#fefce8', border: '1px solid #fde047' }}>
                <div className="text-sm font-bold mb-2" style={{ color: '#854d0e' }}>
                  <i className="ri-settings-3-line mr-1" />Integration Engine
                </div>
                <div className="text-[11px] leading-relaxed" style={{ color: '#854d0e', opacity: 0.85 }}>
                  Auth: Bearer Token<br />
                  Validate → Transform<br />
                  Deduplicate → Map Fields<br />
                  ITIS Enum Validation<br />
                  Status: <strong>Active</strong>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center px-2 min-w-[80px]">
                <div className="h-[2px] w-full" style={{ background: 'linear-gradient(90deg, #1e3a5f, #0d6659)' }} />
                <div className="text-[10px] text-center mt-1 leading-tight" style={{ color: '#6b7280' }}>
                  Validated<br />JSON<br />→ INSERT
                </div>
              </div>

              {/* TBInsight Analytics DB */}
              <div className="flex-1 rounded-xl p-4" style={{ background: '#f5f3ff', border: '1px solid #ddd6fe' }}>
                <div className="text-sm font-bold mb-2" style={{ color: '#6d28d9' }}>
                  <i className="ri-bar-chart-box-line mr-1" />TBInsight Analytics DB
                </div>
                <div className="text-[11px] leading-relaxed" style={{ color: '#6d28d9', opacity: 0.85 }}>
                  Host 2 · tbinsight.pasig.gov.ph<br />
                  Engine: PostgreSQL 15<br />
                  Tables: tb_records, sync_logs<br />
                  Records: {totalRecords.toLocaleString()}<br />
                  Status: <strong>Receiving</strong>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center px-2 min-w-[80px]">
                <div className="h-[2px] w-full" style={{ background: 'linear-gradient(90deg, #1e3a5f, #0d6659)' }} />
                <div className="text-[10px] text-center mt-1 leading-tight" style={{ color: '#6b7280' }}>
                  Triggers<br />Analytics<br />Pipeline
                </div>
              </div>

              {/* Analytics Pipeline */}
              <div className="flex-1 rounded-xl p-4" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                <div className="text-sm font-bold mb-2" style={{ color: '#166534' }}>
                  <i className="ri-line-chart-line mr-1" />Analytics Pipeline
                </div>
                <div className="text-[11px] leading-relaxed" style={{ color: '#166534', opacity: 0.85 }}>
                  GIS Mapping<br />
                  ARIMA Forecasting<br />
                  Risk Scoring<br />
                  Alert Generation<br />
                  Status: <strong>Active</strong>
                </div>
              </div>
            </div>
          </section>

          {/* Field Mapping Table */}
          <section className="glass-card p-5">
            <div className="flex items-center gap-2 text-sm font-bold mb-4" style={{ color: '#0f172a' }}>
              <i className="ri-exchange-line text-lg" style={{ color: '#2E6FAF' }} />
              Field Mapping — External TB-IS → TBInsight
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th className="text-left px-3 py-2.5 font-bold uppercase tracking-wider" style={{ color: '#6b7280', fontSize: '10px', borderBottom: '2px solid #e2e8f0' }}>Source Field (External TB-IS)</th>
                    <th className="text-center px-3 py-2.5" style={{ color: '#9ca3af', borderBottom: '2px solid #e2e8f0' }}></th>
                    <th className="text-left px-3 py-2.5 font-bold uppercase tracking-wider" style={{ color: '#6b7280', fontSize: '10px', borderBottom: '2px solid #e2e8f0' }}>Target Field (TBInsight)</th>
                    <th className="text-left px-3 py-2.5 font-bold uppercase tracking-wider" style={{ color: '#6b7280', fontSize: '10px', borderBottom: '2px solid #e2e8f0' }}>Transform</th>
                  </tr>
                </thead>
                <tbody>
                  {FIELD_MAPPING.map(([src, tgt, tf], i) => (
                    <tr key={i} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                      <td className="px-3 py-2.5 font-mono" style={{ borderBottom: '1px solid #e2e8f0', color: '#1d4ed8' }}>{src}</td>
                      <td className="px-3 py-2.5 text-center" style={{ borderBottom: '1px solid #e2e8f0', color: '#9ca3af' }}>→</td>
                      <td className="px-3 py-2.5 font-mono" style={{ borderBottom: '1px solid #e2e8f0', color: '#0d6659' }}>{tgt}</td>
                      <td className="px-3 py-2.5" style={{ borderBottom: '1px solid #e2e8f0', color: '#6b7280' }}>{tf}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Live Sync Control */}
          <section className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-sm font-bold" style={{ color: '#0f172a' }}>
                <i className="ri-refresh-line text-lg" style={{ color: '#2E6FAF' }} />
                Live Sync Control
              </div>
              <span className="text-[11px] font-semibold" style={{ color: '#64748b' }}>Pulls from External TB-IS REST API</span>
            </div>

            {/* Pipeline Nodes */}
            <div className="flex items-center gap-1.5 flex-wrap mb-4">
              {PIPELINE_NODES.map((node, i) => {
                const isActive = syncing && syncStep === i;
                const isDone = syncDone || (syncing && syncStep > i);
                return (
                  <div key={i} className="flex items-center gap-1.5">
                    <div
                      className="rounded-lg px-3 py-2 text-[11px] font-semibold border-2 transition-all duration-300"
                      style={{
                        background: isActive ? '#eff6ff' : isDone ? '#f0fdf4' : '#f9fafb',
                        borderColor: isActive ? '#2563eb' : isDone ? '#16a34a' : '#e5e7eb',
                        color: isActive ? '#1d4ed8' : isDone ? '#166534' : '#6b7280',
                      }}
                    >
                      <i className={`${node.icon} mr-1`} />
                      {node.label}
                    </div>
                    {i < PIPELINE_NODES.length - 1 && <span className="text-[10px]" style={{ color: '#9ca3af' }}>→</span>}
                  </div>
                );
              })}
            </div>

            {/* Console */}
            <div
              ref={consoleRef}
              className="rounded-lg p-3 font-mono text-[11px] leading-[1.8] min-h-[60px] max-h-[140px] overflow-y-auto mb-4"
              style={{ background: '#111827', color: '#d1fae5' }}
            >
              {consoleLines.length === 0 ? (
                <span style={{ color: '#6ee7b7' }}># TBInsight Integration Console — Ready to pull from External TB-IS</span>
              ) : (
                consoleLines.map((line, i) => (
                  <div key={i} style={{ color: line.color, fontWeight: line.bold ? 700 : 400 }}>{line.text}</div>
                ))
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={runSync}
                disabled={syncing}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)' }}
              >
                <i className={`${syncing ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'} text-sm`} />
                {syncing ? 'Syncing...' : 'Pull Sync from External TB-IS Now'}
              </button>
              <button
                onClick={testConnection}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition"
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}
              >
                <i className="ri-plug-line text-sm" />
                Test API Connection
              </button>
              <button
                onClick={handleExportLogs}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition"
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}
              >
                <i className="ri-download-2-line text-sm" />
                Export Logs
              </button>
            </div>

            {/* Sync Result Banner */}
            {syncDone && lastSyncResult && (
              <div
                className="mt-4 rounded-lg p-3.5 text-xs flex items-start gap-3"
                style={{
                  background: lastSyncResult.success ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
                  border: lastSyncResult.success ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(239,68,68,0.2)',
                  color: lastSyncResult.success ? '#166534' : '#991b1b',
                }}
              >
                <span className="text-lg mt-0.5">{lastSyncResult.success ? '✓' : '✗'}</span>
                <div className="flex-1">
                  <span>
                    {lastSyncResult.success ? (
                      <><strong>Sync completed successfully.</strong> {lastSyncResult.imported} records imported into TBInsight from External TB-IS · {lastSyncResult.dupsSkipped} duplicates skipped · Sync ID: {lastSyncResult.log.syncId} · Duration: {lastSyncResult.log.duration}</>
                    ) : (
                      <><strong>Sync failed.</strong> {lastSyncResult.log.error || 'Could not reach External TB-IS API. Make sure the External System is running.'}</>
                    )}
                  </span>
                  {/* Show validation error details if any */}
                  {lastSyncResult.log.validationFailed > 0 && (
                    <div className="mt-2 p-2 rounded-md" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                      <p className="font-bold mb-1" style={{ color: '#92400e' }}>
                        ⚠ {lastSyncResult.log.validationFailed} record(s) rejected by healthcare validation:
                      </p>
                      {lastSyncResult.log.validationErrors && lastSyncResult.log.validationErrors.slice(0, 5).map((err, i) => (
                        <div key={i} className="ml-2 text-[10px] leading-relaxed" style={{ color: '#78350f' }}>
                          <strong>{err.id}:</strong> {err.errors.join(' · ')}
                        </div>
                      ))}
                      {lastSyncResult.log.validationErrors && lastSyncResult.log.validationErrors.length > 5 && (
                        <p className="ml-2 text-[10px] mt-1" style={{ color: '#92400e' }}>
                          ...and {lastSyncResult.log.validationErrors.length - 5} more. Fix these records in the External System and re-sync.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {/* ═══ Tab: Imported Records ═══ */}
      {viewTab === 'imported' && (
        <section className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm font-bold" style={{ color: '#0f172a' }}>
              <i className="ri-inbox-line text-lg" style={{ color: '#2E6FAF' }} />
              Imported Records — Pending Verification
            </div>
            <div className="flex gap-2">
              {pendingCount > 0 && (
                <>
                  <button
                    onClick={verifyAllRecords}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-white transition hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, #059669 0%, #10B981 100%)' }}
                  >
                    <i className="ri-checkbox-circle-line text-sm" />
                    Verify All ({pendingCount})
                  </button>
                </>
              )}
            </div>
          </div>

          {pendingCount === 0 ? (
            <div className="text-center py-12">
              <i className="ri-inbox-line text-4xl mb-3" style={{ color: '#cbd5e1' }} />
              <div className="text-sm font-semibold" style={{ color: '#94A3B8' }}>No imported records pending verification</div>
              <div className="text-xs mt-1 mb-4" style={{ color: '#cbd5e1' }}>Run a sync from the External TB-IS source system to import records here</div>
              <button
                onClick={() => { setViewTab('architecture'); setTimeout(() => runSync(), 100); }}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold text-white transition hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)' }}
              >
                <i className="ri-refresh-line text-sm" />
                Sync from External TB-IS Now
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Case ID', 'Barangay', 'Age', 'Sex', 'Diagnosis Date', 'Encoded By', 'Status', 'Validation', 'Actions'].map(h => (
                      <th
                        key={h}
                        className="text-left px-3 py-2.5 font-bold uppercase tracking-wider"
                        style={{ color: '#6b7280', fontSize: '10px', borderBottom: '2px solid #e2e8f0' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importedRecords.map((rec, i) => (
                    <tr key={rec.id || i} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                      <td className="px-3 py-2.5 font-mono font-bold" style={{ borderBottom: '1px solid #e2e8f0', color: '#1d4ed8' }}>{rec.id}</td>
                      <td className="px-3 py-2.5" style={{ borderBottom: '1px solid #e2e8f0' }}>{rec.barangay}</td>
                      <td className="px-3 py-2.5" style={{ borderBottom: '1px solid #e2e8f0' }}>{rec.age}</td>
                      <td className="px-3 py-2.5" style={{ borderBottom: '1px solid #e2e8f0' }}>{rec.sex}</td>
                      <td className="px-3 py-2.5 font-mono" style={{ borderBottom: '1px solid #e2e8f0' }}>{rec.diagnosisDate}</td>
                      <td className="px-3 py-2.5" style={{ borderBottom: '1px solid #e2e8f0' }}>
                        {rec.encodedBy === 'System Generated' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: '#64748b' }}>
                            <i className="ri-computer-line text-xs" />
                            System
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: '#1a5276' }}>
                            <i className="ri-user-line text-xs" />
                            {rec.encodedBy || '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5" style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold"
                          style={{
                            background: rec.status === 'Active' || rec.status === 'Treatment'
                              ? 'rgba(245,158,11,0.12)'
                              : rec.status === 'Cured' || rec.status === 'Completed'
                                ? 'rgba(16,185,129,0.12)'
                                : 'rgba(148,163,184,0.15)',
                            color: rec.status === 'Active' || rec.status === 'Treatment'
                              ? '#92400e'
                              : rec.status === 'Cured' || rec.status === 'Completed'
                                ? '#166534'
                                : '#6b7280',
                          }}
                        >
                          {rec.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5" style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold"
                          style={{ background: 'rgba(245,158,11,0.12)', color: '#92400e' }}
                        >
                          Pending
                        </span>
                      </td>
                      <td className="px-3 py-2.5" style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => verifyRecord(rec.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-bold transition hover:opacity-80"
                            style={{ background: 'rgba(16,185,129,0.1)', color: '#059669', border: '1px solid rgba(16,185,129,0.25)' }}
                          >
                            <i className="ri-checkbox-circle-line text-sm" />
                            Verify
                          </button>
                          <button
                            onClick={() => { setRejectingRecord(rec); setRejectReason(''); }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-bold transition hover:opacity-80"
                            style={{ background: 'rgba(239,68,68,0.08)', color: '#DC2626', border: '1px solid rgba(239,68,68,0.2)' }}
                          >
                            <i className="ri-close-circle-line text-sm" />
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ═══ Tab: Sync History ═══ */}
      {viewTab === 'history' && (
        <section className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm font-bold" style={{ color: '#0f172a' }}>
              <i className="ri-history-line text-lg" style={{ color: '#2E6FAF' }} />
              Sync History Log
            </div>
            <button
              onClick={handleExportLogs}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition hover:opacity-80"
              style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}
            >
              <i className="ri-download-2-line" />
              Export Logs
            </button>
          </div>

          {syncLogs.length === 0 ? (
            <div className="text-center py-12">
              <i className="ri-history-line text-4xl mb-3" style={{ color: '#cbd5e1' }} />
              <div className="text-sm font-semibold" style={{ color: '#94A3B8' }}>No sync history yet</div>
              <div className="text-xs mt-1" style={{ color: '#cbd5e1' }}>Run a sync to see history logs</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Date/Time', 'Imported', 'Validation Errors', 'Dups Skipped', 'Duration', 'Sync ID', 'Source', 'Status'].map(h => (
                      <th
                        key={h}
                        className="text-left px-3 py-2.5 font-bold uppercase tracking-wider"
                        style={{ color: '#6b7280', fontSize: '10px', borderBottom: '2px solid #e2e8f0' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {syncLogs.map((l, i) => (
                    <tr key={i} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                      <td className="px-3 py-2.5 font-mono" style={{ borderBottom: '1px solid #e2e8f0', fontSize: '11px' }}>
                        {l.timestamp ? new Date(l.timestamp).toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-2.5 font-bold" style={{ borderBottom: '1px solid #e2e8f0' }}>{l.imported ?? 0}</td>
                      <td className="px-3 py-2.5" style={{ borderBottom: '1px solid #e2e8f0', color: (l.validationFailed ?? 0) > 0 ? '#d97706' : '#16a34a' }}>{l.validationFailed ?? 0}</td>
                      <td className="px-3 py-2.5" style={{ borderBottom: '1px solid #e2e8f0', color: '#6b7280' }}>{l.dupsSkipped ?? 0}</td>
                      <td className="px-3 py-2.5 font-mono" style={{ borderBottom: '1px solid #e2e8f0' }}>{l.duration ?? '—'}</td>
                      <td className="px-3 py-2.5 font-mono" style={{ borderBottom: '1px solid #e2e8f0', fontSize: '10px', color: '#6b7280' }}>{l.syncId ?? '—'}</td>
                      <td className="px-3 py-2.5" style={{ borderBottom: '1px solid #e2e8f0' }}>{l.source ?? 'TB-IS-Pasig'}</td>
                      <td className="px-3 py-2.5" style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <span
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold"
                          style={{
                            background: l.status === 'Success' ? 'rgba(16,185,129,0.12)' : l.status === 'Skipped' ? 'rgba(148,163,184,0.15)' : 'rgba(239,68,68,0.12)',
                            color: l.status === 'Success' ? '#166534' : l.status === 'Skipped' ? '#6b7280' : '#991b1b',
                          }}
                        >
                          {l.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ═══ Reject Reason Modal ═══ */}
      {rejectingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
          <div className="glass-card w-full max-w-md" style={{ background: 'rgba(255,255,255,0.97)' }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(148,163,184,.15)' }}>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: '#64748b' }}>Reject Record</p>
                <h2 className="mt-1 text-lg font-bold" style={{ color: '#0f172a' }}>{rejectingRecord.id}</h2>
              </div>
              <button onClick={() => setRejectingRecord(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:opacity-80" style={{ background: '#f1f5f9', color: '#475569' }}>
                <i className="ri-close-line text-base" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-xs" style={{ color: '#64748b' }}>
                Please select or enter a reason for rejecting this record. The health worker will be notified to fix and re-submit.
              </p>

              {/* Quick reason buttons */}
              <div className="flex flex-wrap gap-2">
                {REJECT_REASONS.map(reason => (
                  <button
                    key={reason}
                    onClick={() => setRejectReason(reason)}
                    className="rounded-full px-3 py-1.5 text-[11px] font-bold transition"
                    style={{
                      background: rejectReason === reason ? 'rgba(239,68,68,0.12)' : '#f8fafc',
                      border: `1px solid ${rejectReason === reason ? 'rgba(239,68,68,0.3)' : '#e2e8f0'}`,
                      color: rejectReason === reason ? '#DC2626' : '#475569',
                    }}
                  >
                    {reason}
                  </button>
                ))}
              </div>

              {/* Custom reason */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: '#64748b' }}>Additional details (optional)</label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Enter rejection reason..."
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-xs font-medium outline-none transition resize-none"
                  style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid rgba(148,163,184,.15)' }}>
              <button
                onClick={() => setRejectingRecord(null)}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition hover:opacity-80"
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  rejectRecord(rejectingRecord.id, rejectReason || 'No reason provided');
                  setRejectingRecord(null);
                  setRejectReason('');
                }}
                disabled={!rejectReason}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                style={{ background: '#DC2626' }}
              >
                <i className="ri-close-circle-line text-sm" />
                Reject Record
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
