import { useEffect, useState } from 'react';
import API from '../api/axios';
import { useTheme } from '../theme';
import { LANDING_PAGES, getPrefs, setPrefs } from '../utils/preferences';
import { thresholdSourceNote, fmtCut, THRESHOLDS_DISCLAIMER } from '../utils/thresholds';

/* Presentational building blocks shared by the Settings sections. */

const when = value => (value
  ? new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '—');

const TONES = {
  good: { bg: 'rgba(4,120,87,0.1)', fg: '#047857' },
  warn: { bg: 'rgba(245,158,11,0.12)', fg: '#92400E' },
  bad: { bg: 'rgba(220,38,38,0.1)', fg: '#B91C1C' },
  info: { bg: 'rgba(59,130,246,0.1)', fg: '#2563EB' },
  muted: { bg: 'rgba(100,116,139,0.1)', fg: '#475569' },
};

export function Pill({ tone = 'muted', children }) {
  const c = TONES[tone] || TONES.muted;
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap" style={{ background: c.bg, color: c.fg }}>
      {children}
    </span>
  );
}

export function Card({ title, subtitle, badge, children, className = '' }) {
  const { t } = useTheme();
  return (
    <div className={`p-5 ${className}`} style={{ background: t.cardSolid, border: `1px solid ${t.border}`, borderRadius: 12, boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-bold" style={{ color: t.text }}>{title}</h2>
          {subtitle && <p className="text-[11px] mt-0.5" style={{ color: t.textSecondary }}>{subtitle}</p>}
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

export function Row({ label, children, note }) {
  const { t } = useTheme();
  return (
    <div className="flex items-start justify-between gap-4 py-2" style={{ borderBottom: `1px solid ${t.border}` }}>
      <div className="min-w-0">
        <span className="text-xs" style={{ color: t.textSecondary }}>{label}</span>
        {note && <p className="text-[10px] mt-0.5" style={{ color: t.textMuted }}>{note}</p>}
      </div>
      <span className="text-xs font-semibold text-right" style={{ color: t.text }}>{children}</span>
    </div>
  );
}

function ReadOnlyBadge({ text = 'Read-only' }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded" style={{ background: 'rgba(100,116,139,0.1)', color: '#475569' }}>
      <i className="ri-lock-line" /> {text}
    </span>
  );
}

/** Small hook: load once, expose {data, error, loading}. */
function useLoad(loader) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    loader()
      .then(data => { if (alive) setState({ data, error: null, loading: false }); })
      .catch(err => { if (alive) setState({ data: null, error: err, loading: false }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

/* ─── General ───────────────────────────────────────────────────────── */

const ROLE_ACCESS = [
  ['View dashboards, GIS map, forecasts, alerts and reports', true, true],
  ['Edit own profile and change own password', true, true],
  ['Add or edit population reference data', true, false],
  ['Run the prediction pipeline and risk snapshot backfill', true, false],
  ['Manage user accounts', true, false],
];

export function PreferencesCard() {
  const { t } = useTheme();
  const [prefs, setLocal] = useState(getPrefs);
  const update = patch => setLocal(setPrefs(patch));
  return (
    <Card title="Display Preferences" subtitle="Saved in this browser only; they do not follow you to another device.">
      <div className="py-2" style={{ borderBottom: `1px solid ${t.border}` }}>
        <label className="block text-[11px] font-semibold mb-1" style={{ color: t.textSecondary }} htmlFor="pref-landing">Open this page after signing in</label>
        <select
          id="pref-landing"
          value={prefs.landingPage}
          onChange={e => update({ landingPage: e.target.value })}
          className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
          style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }}
        >
          {LANDING_PAGES.map(p => <option key={p.path} value={p.path}>{p.label}</option>)}
        </select>
      </div>
      <p className="text-[10px] mt-2" style={{ color: t.textMuted }}>Notification preferences are under the Notifications section.</p>
    </Card>
  );
}

export function RoleAccessCard({ role }) {
  const { t } = useTheme();
  const isAdmin = role === 'admin';
  return (
    <Card
      title="Role & Access"
      subtitle="What each role can do in TBInsight."
      badge={<Pill tone={isAdmin ? 'info' : 'muted'}>{isAdmin ? 'Admin' : 'Staff'}</Pill>}
    >
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: `1px solid ${t.border}` }}>
            <th className="text-left py-2 font-bold uppercase text-[10px]" style={{ color: t.textMuted }}>Capability</th>
            <th className="text-center py-2 font-bold uppercase text-[10px] w-16" style={{ color: t.textMuted }}>Admin</th>
            <th className="text-center py-2 font-bold uppercase text-[10px] w-16" style={{ color: t.textMuted }}>Staff</th>
          </tr>
        </thead>
        <tbody>
          {ROLE_ACCESS.map(([label, admin, staff]) => (
            <tr key={label} style={{ borderBottom: `1px solid ${t.border}` }}>
              <td className="py-2 pr-2" style={{ color: t.text }}>{label}</td>
              {[admin, staff].map((ok, i) => (
                <td key={i} className="py-2 text-center">
                  <i className={ok ? 'ri-check-line' : 'ri-subtract-line'} style={{ color: ok ? '#047857' : '#CBD5E1' }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ─── Account & Security ────────────────────────────────────────────── */

export function SecurityOptionsCard({ profile, onSignOut }) {
  return (
    <Card title="Security Options" subtitle="How access to TBInsight is protected." badge={<ReadOnlyBadge />}>
      <Row label="Sign-in method">Username/email and password</Row>
      <Row label="Session" note="Held in a secure browser cookie">Signed in as {profile?.role || '—'}</Row>
      <Row label="Failed sign-in limit" note="Repeated failures temporarily lock sign-in">5 attempts per 15 minutes</Row>
      <Row label="Password requirements">8+ chars, upper, lower, number</Row>
      <div className="pt-3">
        <button onClick={onSignOut} className="px-4 py-2 text-xs font-semibold rounded-lg cursor-pointer" style={{ border: '1px solid #FCA5A5', color: '#B91C1C', background: 'transparent' }}>
          <i className="ri-logout-box-r-line mr-1" /> Sign out of this browser
        </button>
      </div>
    </Card>
  );
}

/* ─── Data Synchronization ──────────────────────────────────────────── */

export function SyncStatusPanel({ isAdmin }) {
  const { t } = useTheme();
  const fresh = useLoad(() => API.get('/api/tb/data-freshness').then(r => r.data));
  const logs = useLoad(() => API.get('/api/tb/webhook-logs').then(r => r.data.logs || []));

  const f = fresh.data;
  const lastLog = logs.data?.[0];
  const lastOk = logs.data?.find(l => l.status === 'processed');
  let connection;
  if (logs.loading || fresh.loading) connection = { tone: 'muted', text: 'Checking…' };
  else if (!lastLog) connection = { tone: 'warn', text: 'No deliveries logged' };
  else if (lastLog.status === 'failed') connection = { tone: 'bad', text: 'Last delivery failed' };
  else connection = { tone: 'good', text: 'Receiving data' };

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="PASIG TB-IS Connection"
        subtitle="TBInsight receives validated case records pushed from PASIG TB-IS. Nothing is pulled or changed from here."
        badge={<Pill tone={connection.tone}>{connection.text}</Pill>}
      >
        {fresh.error ? (
          <p className="text-xs" style={{ color: '#991B1B' }}>Could not load synchronization status.</p>
        ) : (
          <>
            <Row label="Data source">{f?.dataSource || 'PASIG TB-IS'}</Row>
            <Row label="Last successful sync" note={f?.syncSource === 'import' ? 'No delivery logged; this is the newest record import time' : undefined}>{when(f?.lastSynced)}</Row>
            <Row label="Most recent diagnosis in data" note="Clinical date, not a sync time">{f?.latestCaseDate ? new Date(f.latestCaseDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</Row>
            <Row label="Last delivery attempt">{lastLog ? when(lastLog.received_at) : '—'}</Row>
            <Row label="Last processed delivery">{lastOk ? `${lastOk.records_imported ?? 0} of ${lastOk.records_received ?? 0} records` : '—'}</Row>
          </>
        )}
      </Card>

      <Card title="Recent Deliveries" subtitle="Latest 8 deliveries from PASIG TB-IS.">
        {logs.loading ? (
          <p className="text-xs" style={{ color: t.textMuted }}>Loading…</p>
        ) : !logs.data?.length ? (
          <p className="text-xs" style={{ color: t.textMuted }}>No deliveries have been received yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.border}` }}>
                  {['Received', 'Status', 'Records', ...(isAdmin ? ['Detail'] : [])].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-bold uppercase text-[10px]" style={{ color: t.textMuted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.data.slice(0, 8).map(l => (
                  <tr key={l.id} style={{ borderBottom: `1px solid ${t.border}` }}>
                    <td className="px-3 py-2" style={{ color: t.text }}>{when(l.received_at)}</td>
                    <td className="px-3 py-2"><Pill tone={l.status === 'processed' ? 'good' : l.status === 'failed' ? 'bad' : 'warn'}>{l.status}</Pill></td>
                    <td className="px-3 py-2" style={{ color: t.textSecondary }}>{l.records_imported ?? 0} / {l.records_received ?? 0}</td>
                    {isAdmin && <td className="px-3 py-2" style={{ color: t.textSecondary }}>{l.error_message || '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10px] mt-3" style={{ color: t.textMuted }}>
          Sync is started from PASIG TB-IS (Settings → Data Synchronization there). Connection secrets are managed there and are not shown in TBInsight.
        </p>
      </Card>
    </div>
  );
}

/* ─── Analytics & Forecasting ───────────────────────────────────────── */

const RF_FEATURES = ['12-month incidence', 'Recent trend', 'Seasonality', 'Cases 1, 2 and 3 months earlier', 'Neighbouring-barangay risk'];

export function ModelStatusPanel() {
  const { t } = useTheme();
  const status = useLoad(() => API.get('/api/tb/pipeline/status').then(r => r.data));
  const ml = useLoad(() => API.get('/api/tb/ml/health').then(r => r.data).catch(() => ({ ml_service: 'unreachable' })));

  const run = status.data?.latest_run;
  const current = status.data?.current_run;
  const m = run?.metrics || {};
  const cfg = run?.config || {};
  const th = cfg.thresholds;
  const ok = s => (s === 'success' ? 'good' : s ? 'warn' : 'muted');
  const methods = (m.forecastMethods || []).map(x => (x === 'arima' ? 'ARIMA' : String(x).replace(/_/g, ' '))).join(', ');
  const running = current && (current.running || current.status === 'running');

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Model Status"
        subtitle="Latest full prediction pipeline run."
        badge={running ? <Pill tone="info">Running</Pill> : <ReadOnlyBadge />}
      >
        {status.error ? (
          <p className="text-xs" style={{ color: '#991B1B' }}>Could not load model status.</p>
        ) : !run && !status.loading ? (
          <p className="text-xs" style={{ color: t.textMuted }}>The prediction pipeline has not run yet.</p>
        ) : (
          <>
            <Row label="ML service">
              <Pill tone={ml.data?.ml_service === 'healthy' ? 'good' : ml.loading ? 'muted' : 'bad'}>
                {ml.loading ? 'Checking…' : ml.data?.ml_service === 'healthy' ? 'Healthy' : 'Unreachable'}
              </Pill>
            </Row>
            <Row label="Model version">{run?.model_version || '—'}</Row>
            <Row label="Last run">{when(run?.trained_at)}</Row>
            <Row label="Risk classifier (Random Forest)"><Pill tone={ok(run?.rf_status)}>{run?.rf_status || 'unknown'}</Pill></Row>
            <Row label="Forecaster (ARIMA)"><Pill tone={ok(run?.arima_status)}>{run?.arima_status || 'unknown'}</Pill></Row>
            <Row label="Case data used">{m.dataStart && m.dataEnd ? `${String(m.dataStart).slice(0, 7)} to ${String(m.dataEnd).slice(0, 7)} (${run.training_months} months)` : '—'}</Row>
            <Row label="Risk assessment period">{m.assessment_period ? String(m.assessment_period).slice(0, 7) : '—'}</Row>
            <Row label="Forecast horizon">{m.forecastHorizon ? `${m.forecastHorizon} month${m.forecastHorizon === 1 ? '' : 's'}` : '—'}</Row>
            {methods && <Row label="Forecast methods used">{methods}</Row>}
          </>
        )}
      </Card>

      <Card
        title="Risk Thresholds & Model Rules"
        subtitle="Fixed by the system. They are recalculated by the pipeline and cannot be edited here."
        badge={<ReadOnlyBadge />}
      >
        {th ? (
          <div className="grid grid-cols-3 gap-3 mb-3">
            {[
              ['Low', `Up to ${fmtCut(th.low_max)}`, '#047857'],
              ['Medium', `${fmtCut(th.low_max)} to ${fmtCut(th.med_max)}`, '#B45309'],
              ['High', `Above ${fmtCut(th.med_max)}`, '#B91C1C'],
            ].map(([label, range, color]) => (
              <div key={label} className="rounded-lg px-3 py-2" style={{ background: t.inputBg, border: `1px solid ${t.border}` }}>
                <p className="text-[10px] font-bold uppercase" style={{ color }}>{label}</p>
                <p className="text-xs font-semibold mt-0.5" style={{ color: t.text }}>{range}</p>
                <p className="text-[10px]" style={{ color: t.textMuted }}>cases per 100,000</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs mb-3" style={{ color: t.textMuted }}>No risk cut points are stored for the latest run.</p>
        )}
        {th && <p className="text-[11px] mb-3" style={{ color: t.textSecondary }}>{thresholdSourceNote(cfg.thresholdSource, cfg.thresholdPercentiles)}. {THRESHOLDS_DISCLAIMER}</p>}
        <Row label="Risk classification" note="The Random Forest class decides the map colour and High/Medium/Low counts">Random Forest</Row>
        <Row label="Model inputs">{RF_FEATURES.join('; ')}</Row>
        <Row label="Neighbouring barangays" note="Barangays within 50 m of each other">Shared borders</Row>
        <Row label="Alert rules" note="Evaluated after each pipeline run">Escalation, High risk, Surge (&gt;30% rise)</Row>
      </Card>
    </div>
  );
}

/* ─── Notifications ─────────────────────────────────────────────────── */

export function NotificationSettings() {
  const { t } = useTheme();
  const [prefs, setLocal] = useState(getPrefs);
  const counts = useLoad(() => API.get('/api/tb/alerts/counts').then(r => r.data).catch(() => null));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      <Card title="Notification Preferences" subtitle="Saved in this browser only.">
        <label className="flex items-center justify-between gap-4 py-2 cursor-pointer">
          <span>
            <span className="block text-xs font-semibold" style={{ color: t.text }}>Show unread count on the bell</span>
            <span className="block text-[10px] mt-0.5" style={{ color: t.textMuted }}>The number badge in the top bar. Alerts still appear in the list.</span>
          </span>
          <input
            type="checkbox"
            checked={prefs.bellCount}
            onChange={e => setLocal(setPrefs({ bellCount: e.target.checked }))}
            className="h-4 w-4 accent-[#0F2D52]"
          />
        </label>
        <p className="text-[10px] mt-2" style={{ color: t.textMuted }}>The bell refreshes every 30 seconds. Read and resolve alerts on the Alerts &amp; Notifications page.</p>
      </Card>

      <Card title="Alert Rules" subtitle="Alerts are created automatically after each prediction pipeline run." badge={<ReadOnlyBadge />}>
        <Row label="Escalation" note="A barangay moves from Medium to High risk">Automatic</Row>
        <Row label="High risk" note="A barangay is classified High risk">Automatic</Row>
        <Row label="Surge" note="Cases rise by more than 30%">Automatic</Row>
        {counts.data && (
          <p className="text-[10px] mt-3" style={{ color: t.textMuted }}>
            Open now: {counts.data.critical ?? 0} critical, {counts.data.high ?? 0} high severity, {counts.data.unread ?? 0} unread.
          </p>
        )}
      </Card>
    </div>
  );
}

/* ─── System Information ────────────────────────────────────────────── */

export function SystemInfoPanel({ sys, sysError }) {
  const status = useLoad(() => API.get('/api/tb/pipeline/status').then(r => r.data));
  const fresh = useLoad(() => API.get('/api/tb/data-freshness').then(r => r.data));
  const ml = useLoad(() => API.get('/api/tb/ml/health').then(r => r.data).catch(() => ({ ml_service: 'unreachable' })));
  const run = status.data?.latest_run;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      <Card title="Services" subtitle="Live connection checks.">
        {sysError ? (
          <p className="text-xs" style={{ color: '#991B1B' }}>Cannot reach the API server. Is the backend running?</p>
        ) : !sys ? (
          <p className="text-xs">Loading…</p>
        ) : (
          <>
            <Row label="API server"><Pill tone={sys.status === 'ok' ? 'good' : 'warn'}>{sys.status === 'ok' ? 'Online' : 'Degraded'}</Pill></Row>
            <Row label="Database"><Pill tone={sys.database === 'connected' ? 'good' : 'bad'}>{sys.database === 'connected' ? 'Connected' : 'Disconnected'}</Pill></Row>
            <Row label="ML service"><Pill tone={ml.data?.ml_service === 'healthy' ? 'good' : ml.loading ? 'muted' : 'bad'}>{ml.loading ? 'Checking…' : ml.data?.ml_service === 'healthy' ? 'Healthy' : 'Unreachable'}</Pill></Row>
            <Row label="Server time">{sys.timestamp ? new Date(sys.timestamp).toLocaleTimeString() : '—'}</Row>
          </>
        )}
      </Card>

      <Card title="Application" subtitle="TBInsight — GIS-based TB priority mapping and resource-prioritization system." badge={<ReadOnlyBadge />}>
        <Row label="Application version">{sys?.version || '—'}</Row>
        <Row label="Model version">{run?.model_version || '—'}</Row>
        <Row label="Data source">{fresh.data?.dataSource || 'PASIG TB-IS'}</Row>
        <Row label="Coverage">Pasig City · 30 barangays</Row>
        <Row label="Last model run">{when(fresh.data?.lastModelRun)}</Row>
        <Row label="Last data sync">{when(fresh.data?.lastSynced)}</Row>
      </Card>
    </div>
  );
}
