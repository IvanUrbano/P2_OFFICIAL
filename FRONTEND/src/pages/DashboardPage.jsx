import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Cell, Area, AreaChart,
  CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie,
} from 'recharts';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import API from '../api/axios';
import DashboardWelcomeInsightsSection from '../components/DashboardWelcomeInsightsSection';
import OutcomeStatusPanel from '../components/OutcomeStatusPanel';
import ChartInsight from '../components/ChartInsight';
import { trendInsight, riskInsight, shareInsight, outcomeInsight, forecastInsight } from '../utils/chartInsights';
import { getDashboardInsight } from '../services/insightService';
import {
  APPROVED_OUTCOMES, OUTCOME_COLORS, normalizeDisplayOutcome,
} from '../utils/outcomeStatus';

/* ─── Constants ──────────────────────────────────────────────────────── */

const RISK_COLORS = {
  Low: '#10B981',
  Moderate: '#F59E0B',
  Medium: '#F59E0B',
  High: '#EF4444',
  'No Data': '#94A3B8',
  'No Assessment': '#94A3B8',
};

// Outcome categories, order and colours come from the single shared frontend
// contract (src/utils/outcomeStatus.js), which mirrors the backend's
// outcomeNormalization.js. Each page used to carry its own copy of this list.
const OUTCOME_ORDER = APPROVED_OUTCOMES;

const GIS_RISK_COLORS = {
  High: '#991B1B',
  Medium: '#B45309',
  Low: '#854D0E',
  'No Data': '#64748B',
};

const PASIG_BOUNDS = L.latLngBounds([14.48, 121.02], [14.64, 121.13]);

const RISK_PRIORITY = { High: 3, Medium: 2, Moderate: 2, Low: 1, 'No Data': 0 };

/* Alert severities that warrant the critical treatment. `severity` in the
 * alerts table is lowercase and rule-derived ('danger' | 'high' | 'warning' |
 * 'info'); 'danger' is the most severe band the alert rules emit, so it
 * belongs here — it previously fell through to the mild style because only
 * CRITICAL/HIGH were matched. */
const CRITICAL_SEVERITIES = new Set(['CRITICAL', 'DANGER', 'HIGH']);

function riskStyle(feature) {
  const risk = feature.properties?.risk_class || 'No Data';
  return {
    fillColor: GIS_RISK_COLORS[risk] || GIS_RISK_COLORS['No Data'],
    weight: 0.5,
    opacity: 0.9,
    color: 'rgba(255,255,255,0.3)',
    fillOpacity: 0.55,
  };
}

/* ─── Mini GIS Map ─── */
function MiniGisMap({ refreshKey }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const dataRef = useRef(null);
  const labelsRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [14.555, 121.075],
      zoom: 14.5,
      zoomControl: true,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      touchZoom: true,
      keyboard: true,
      boxZoom: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: 'abc',
      className: 'dark-tiles',
    }).addTo(map);

    mapRef.current = map;

    function buildLabels(features) {
      if (labelsRef.current) {
        labelsRef.current.forEach(l => {         try { map.removeLayer(l); } catch (e) { void e; } });
      }
      labelsRef.current = [];
      const zoom = map.getZoom();
      const layer = L.layerGroup();
      if (zoom < 14.5) {
        const center = [14.565, 121.075];
        const pasigLabel = L.marker(center, {
          interactive: false,
          icon: L.divIcon({
            className: 'pasig-city-label',
            html: '<div class="pasig-city-text">PASIG</div>',
            iconSize: [200, 40],
            iconAnchor: [100, 20],
          }),
        });
        layer.addLayer(pasigLabel);
      }
      for (const f of features) {
        const c = f.properties?.centroid;
        if (!c) continue;
        const showNames = zoom >= 14.5;
        const marker = L.circleMarker([c[1], c[0]], {
          radius: showNames ? 2 : 3,
          fillColor: '#ffffff',
          fillOpacity: 0.9,
          color: 'rgba(0,0,0,0.5)',
          weight: 1,
          interactive: false,
        });
        if (showNames) {
          marker.bindTooltip(f.properties.name, {
            permanent: true,
            direction: 'center',
            className: 'barangay-label',
            interactive: false,
          });
        }
        layer.addLayer(marker);
      }
      layer.addTo(map);
      labelsRef.current = [layer];
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await API.get('/api/tb/gis/geojson');
        if (cancelled || !res.data?.features) return;
        dataRef.current = res.data;

        if (res.data.outline) {
          L.geoJSON(
            { type: 'Feature', properties: {}, geometry: res.data.outline },
            { style: { fillColor: '#1a1a2e', fillOpacity: 0.85, weight: 0, opacity: 0 }, interactive: false }
          ).addTo(map);
        }

        L.geoJSON(res.data, { style: riskStyle, interactive: false }).addTo(map);
        map.fitBounds(PASIG_BOUNDS, { padding: [20, 20] });
        buildLabels(res.data.features);
      } catch {
        // Silently fail — minimap is decorative
      }
    })();

    const onZoom = () => {
      if (dataRef.current?.features) buildLabels(dataRef.current.features);
    };
    map.on('zoomend', onZoom);

    const timer = setTimeout(() => { map.invalidateSize(); }, 100);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      map.off('zoomend', onZoom);
      map.remove();
      mapRef.current = null;
      dataRef.current = null;
      labelsRef.current = null;
    };
  }, [refreshKey]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg overflow-hidden"
      style={{ height: 300, background: '#0a1128' }}
    />
  );
}

/* ─── Helper Components ──────────────────────────────────────────────── */

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2.5 rounded-lg text-xs shadow-lg" style={{ background: '#ffffff', border: '1px solid #E2E8F0', minWidth: 120 }}>
      {label && <div className="text-[10px] font-semibold mb-1.5 pb-1" style={{ color: '#64748B', borderBottom: '1px solid #F1F5F9' }}>{label}</div>}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: entry.color || entry.stroke }} />
            <span style={{ color: '#64748B' }}>{entry.name}</span>
          </div>
          <span className="font-bold" style={{ color: '#1E293B' }}>{entry.value?.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function RiskBadge({ risk }) {
  const bg = RISK_COLORS[risk] || '#94A3B8';
  // The level is always spelled out in text as well as encoded in the fill,
  // so the classification is never communicated by colour alone.
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
      style={{ backgroundColor: bg }}
      title={`Risk classification: ${risk}`}
    >
      {risk}
    </span>
  );
}

function SectionCard({ title, iconColor, description, action, actionTo, insight, children }) {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-8 rounded-full" style={{ background: iconColor || '#0F2D52' }} />
          <div>
            <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>{title}</h3>
            {description && <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>{description}</p>}
          </div>
        </div>
        {action && (
          <button
            onClick={() => actionTo && navigate(actionTo)}
            className="flex items-center gap-1 text-[11px] font-semibold transition hover:underline"
            style={{ color: '#0F2D52', transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
          >
            {action} <i className="ri-arrow-right-s-line text-sm" />
          </button>
        )}
      </div>
      <div className="px-5 pb-5">{children}<ChartInsight text={insight} /></div>
    </div>
  );
}

import SkeletonBlock from '../../components/SkeletonBlock';

function SkeletonCard() {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
      <div className="px-5 py-4"><SkeletonBlock className="h-4 w-32" /></div>
      <div className="px-5 pb-5"><SkeletonBlock className="h-48 w-full" /></div>
    </div>
  );
}

/* ─── Animated Number Hook ─── */
function useAnimatedNumber(target, duration = 600, decimals = 0) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);
  const startRef = useRef(null);
  const fromRef = useRef(0);

  useEffect(() => {
    fromRef.current = display;
    startRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const factor = Math.pow(10, decimals);
    const step = (ts) => {
      if (!startRef.current) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round((fromRef.current + (target - fromRef.current) * eased) * factor) / factor);
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration, decimals]);

  return display;
}

/* ─── Main Dashboard Component ──────────────────────────────────────── */

export default function DashboardPage() {
  const navigate = useNavigate();

  /* ── User ── */
  const [user] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  });

  /* ── State ── */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [monthlyData, setMonthlyData] = useState([]);
  const [outcomesData, setOutcomesData] = useState([]);
  const [tsrData, setTsrData] = useState(null);
  const [cfrData, setCfrData] = useState(null);
  const [forecastsData, setForecastsData] = useState([]);
  const [alertsData, setAlertsData] = useState([]);
  // Total unresolved alerts from pagination.total — the displayed rows are a
  // capped slice, so their length is not the unresolved count.
  const [alertsTotal, setAlertsTotal] = useState(null);
  const [riskData, setRiskData] = useState([]);
  const [riskYear, setRiskYear] = useState(null);
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [demographicsData, setDemographicsData] = useState([]);
  const [statusSummary, setStatusSummary] = useState(null); // diagnosed / on treatment counts
  // Freshness metadata from GET /api/tb/data-freshness: Last Synced and Last
  // Model Run are distinct timestamps and are kept distinct.
  const [freshness, setFreshness] = useState(null);

  /* ── Relative time ──
   * `now` is state updated on an interval (not Date.now() called directly
   * during render, which is an impure render call) so the "X ago" label
   * actually advances over time instead of freezing at first render. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  /* ── Refresh state ── */
  const [refreshing, setRefreshing] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);

  /* ── NLG Dashboard Insight state ── */
  const [dashboardInsight, setDashboardInsight] = useState(null);
  const [dashboardInsightLoading, setDashboardInsightLoading] = useState(false);
  const [dashboardInsightError, setDashboardInsightError] = useState(null);

  const handleGenerateDashboardInsight = useCallback(async () => {
    try {
      setDashboardInsightLoading(true);
      setDashboardInsightError(null);
      const insight = await getDashboardInsight();
      setDashboardInsight(insight);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Dashboard insight failed:', err);
      setDashboardInsightError('Unable to generate dashboard insight.');
    } finally {
      setDashboardInsightLoading(false);
    }
  }, []);

  /* ── Per-endpoint failure tracking ──
   * A failed request and a successful-but-empty request are NOT the same
   * state, and one failing endpoint must not blank the rest of the page.
   * Previously summary/monthly/outcomes/forecasts were awaited bare inside a
   * Promise.all, so a single forecast outage replaced the entire Dashboard —
   * KPIs, RF risk, alerts and all — with one error screen; and the endpoints
   * that *were* caught fell back to empty arrays, which rendered as
   * "no data available" rather than "could not be loaded".
   * `failed` records which metrics are unavailable because the request
   * failed, so each card can say so instead of implying zero. */
  const [failed, setFailed] = useState({});

  const loadAll = useCallback(async () => {
    setError(null);
    // Settle every request independently; nothing here can reject.
    const get = (url) => API.get(url).then(
      (res) => ({ ok: true, data: res.data }),
      (err) => {
        if (import.meta.env.DEV) console.error(`Dashboard fetch failed: ${url}`, err);
        return { ok: false, data: null };
      }
    );

    const [monthlyRes, outcomesRes, forecastsRes, alertsRes, riskRes,
      pipelineRes, demoRes, statusRes, tsrRes, cfrRes, freshRes] =
      await Promise.all([
        get('/api/tb/dashboard/monthly'),
        get('/api/tb/dashboard/outcomes'),
        get('/api/tb/forecasts'),
        // Recent Alerts shows unresolved ALERTS only — not notifications
        // (e.g. "Forecast Generated") and not already-resolved alerts. The
        // response's pagination.total is the true unresolved count; the
        // returned rows are just the newest few that are displayed.
        get('/api/tb/alerts?type=alert&status=unread&limit=5'),
        get('/api/tb/gis/choropleth'),
        get('/api/tb/pipeline/status'),
        get('/api/tb/dashboard/demographics'),
        // Case status counts (Diagnosed / On Treatment) for the outcomes panel
        get('/api/tb/dashboard/summary'),
        // Unfiltered (no year/barangay) — the Dashboard is an overview page —
        // which defaults to the current-year Y-1 cohort.
        get('/api/tb/treatment-success-rate'),
        get('/api/tb/case-fatality-rate'),
        get('/api/tb/data-freshness'),
      ]);

    setFailed({
      monthly: !monthlyRes.ok,
      outcomes: !outcomesRes.ok,
      forecasts: !forecastsRes.ok,
      alerts: !alertsRes.ok,
      risk: !riskRes.ok,
      pipeline: !pipelineRes.ok,
      demographics: !demoRes.ok,
      status: !statusRes.ok,
      tsr: !tsrRes.ok,
      cfr: !cfrRes.ok,
      freshness: !freshRes.ok,
    });

    setMonthlyData(monthlyRes.data?.monthly || []);
    setOutcomesData(outcomesRes.data?.outcomes || []);
    setForecastsData(forecastsRes.data?.forecasts || []);
    setAlertsData(alertsRes.data?.alerts || []);
    setAlertsTotal(alertsRes.data?.pagination?.total ?? null);
    setRiskData(riskRes.data?.choropleth || []);
    setRiskYear(riskRes.data?.year ?? null);
    setPipelineStatus(pipelineRes.data?.latest_run || null);
    setDemographicsData(demoRes.data?.demographics || []);
    setStatusSummary(statusRes.data?.summary || null);
    setTsrData(tsrRes.data || null);
    setCfrData(cfrRes.data || null);
    setFreshness(freshRes.data || null);

    // Only a total outage is a page-level error: if nothing at all loaded
    // there is genuinely nothing to show. A partial failure keeps the page
    // and degrades the affected cards individually.
    const anyOk = [monthlyRes, outcomesRes, forecastsRes, riskRes,
      alertsRes, demoRes, statusRes, tsrRes, cfrRes, freshRes].some((r) => r.ok);
    if (!anyOk) {
      setError('Dashboard data could not be retrieved. Please try again.');
    }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    loadAll();
    handleGenerateDashboardInsight();
  }, [loadAll, handleGenerateDashboardInsight]);

  /* ── Refresh handler ──
   * Refresh means exactly one thing: refetch the Dashboard's data (all GETs).
   * It never runs the pipeline, retrains or reruns ARIMA or Random Forest,
   * rebuilds historical snapshots, triggers webhook synchronisation, or writes
   * any record — every endpoint in loadAll and in the insight fetch is a read.
   *
   * The in-flight ref short-circuits a second invocation before the
   * `refreshing` state has propagated, so a rapid double-click cannot fire two
   * full rounds of requests (the disabled button alone is a render-time
   * guard, not a concurrency one). */
  const refreshInFlight = useRef(false);
  const handleRefresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    setRefreshCount((c) => c + 1);
    try {
      await Promise.all([
        loadAll(),
        handleGenerateDashboardInsight(),
      ]);
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [loadAll, handleGenerateDashboardInsight]);

  /* ── 1. Total TB Cases ── */
  const totalCases = useMemo(() => {
    const uniqueMonths = new Set(monthlyData.map((r) => r.month)).size;
    const total = monthlyData.reduce((s, r) => s + Number(r.case_count || 0), 0);
    return { total, months: uniqueMonths };
  }, [monthlyData]);

  /* ── 2. New Cases (latest recorded month) ──
   * Replaces the former "Active TB Cases" tile (unbounded ON TREATMENT
   * count, and later a 9-month treatment-window variant) — both approaches
   * could show a misleading 0 on a dataset whose most recent case predates
   * the window. This instead reuses monthOverMonth (below), which finds
   * whichever month actually has the latest data, not literal wall-clock
   * "this month" — so it can never go stale just because today's calendar
   * date has moved past the data. */

  /* ── 3. Treatment Success Rate (TSR) ──
   * From GET /api/tb/treatment-success-rate — the cohort-based methodology
   * (Cured+Completed / patients whose treatment started in year Y-1). This
   * used to be computed here client-side from the current outcomes
   * breakdown (diagnosis-date filtered, no cohort), which is a DIFFERENT
   * metric that disagreed with the NLG-generated insight text on this same
   * page, which already used the correct cohort formula. Never 0 when the
   * cohort is empty — the API returns null, rendered as N/A below. */
  const successRate = useMemo(() => ({
    rate: tsrData?.successRate != null ? tsrData.successRate.toFixed(1) : null,
    evaluated: tsrData?.cohortTotal ?? 0,
    cohortYear: tsrData?.cohortYear ?? null,
  }), [tsrData]);

  /* ── 4. High-Risk Barangays ──
   * Sourced ONLY from the persisted, RF-authoritative risk_class
   * (choropleth = barangay_risk_scores). A previous version of this
   * fell through to a forecast-derived count and then to a client-side
   * tertile computed from raw case counts (using `population || 1` when
   * population was unknown) whenever the real count was 0 — treating a
   * legitimate "zero High-risk barangays" result as if it were missing
   * data and inventing a different number instead. That is exactly the
   * kind of fabricated classification this dashboard must not produce:
   * 0 is a valid answer, and "no classification exists yet" must show
   * N/A, never silently substitute an unrelated calculation.
   */
  const hasRiskData = riskData.some((r) => (r.risk_class || '').toLowerCase() !== 'no data' && r.risk_class);
  const highRiskCount = useMemo(() => {
    if (!hasRiskData) return null;
    return riskData.filter((r) => (r.risk_class || '').toLowerCase() === 'high').length;
  }, [riskData, hasRiskData]);

  /* ── Assessed-barangay denominator ──
   * The "N / M" denominator is the number of barangays that actually carry a
   * persisted classification in the latest snapshot — not a hardcoded 30.
   * /gis/choropleth LEFT JOINs every reference barangay and COALESCEs a
   * missing classification to 'No Data', so a snapshot that skipped a
   * barangay would otherwise be reported as though all 30 were assessed. */
  const assessedCount = useMemo(
    () => riskData.filter((r) => r.risk_class && (r.risk_class || '').toLowerCase() !== 'no data').length,
    [riskData]
  );
  const noAssessmentCount = useMemo(
    () => riskData.filter((r) => !r.risk_class || (r.risk_class || '').toLowerCase() === 'no data').length,
    [riskData]
  );

  /* ── 5. Forecasted Cases ── */
  const forecastSummary = useMemo(() => {
    if (!forecastsData.length) return { total: 0, period: '', growthRate: 0, riskLevel: 'N/A', tier: null, tierLabel: null, periodCount: 0 };
    const latestPeriod = forecastsData.reduce((max, r) => (r.period > max ? r.period : max), '');
    if (!latestPeriod) return { total: 0, period: '', growthRate: 0, riskLevel: 'N/A', tier: null, tierLabel: null, periodCount: 0 };
    const latest = forecastsData.filter((r) => r.period === latestPeriod);
    // Sum the raw per-barangay values and round ONCE, matching the Dashboard
    // NLG (dashboardInsight.js). Rounding each barangay first and then summing
    // accumulates the per-row rounding error, which made this KPI disagree
    // with the forecast figure in the insight text on the same page (427 vs
    // 429 on the live dataset).
    const total = Math.round(latest.reduce((s, r) => s + Number(r.forecasted_count || 0), 0));

    // Growth rate: first forecast value vs historical monthly average (aligned with Forecasting page)
    const byMonth = {};
    monthlyData.forEach((r) => {
      if (!byMonth[r.month]) byMonth[r.month] = 0;
      byMonth[r.month] += Number(r.case_count || 0);
    });
    const historicalMonths = Object.keys(byMonth).length || 1;
    const historicalTotal = Object.values(byMonth).reduce((s, v) => s + v, 0);
    const monthlyAvg = historicalTotal / historicalMonths;
    const firstForecast = latest.length > 0 ? latest.reduce((s, r) => s + Number(r.forecasted_count || 0), 0) : 0;
    const baseline = monthlyAvg || 1;
    const growthRate = ((firstForecast - baseline) / baseline) * 100;

    // Predominant Random Forest risk class among the barangays in this
    // forecast period. This is NOT produced by the forecast: risk_class on a
    // model_predictions row is a denormalized copy of the RF classification
    // in barangay_risk_scores (see storeResults in scoring.js). It is
    // labelled explicitly as an RF class in the card so the forecast is never
    // read as having assigned it. Barangays with no classification are
    // counted as such instead of defaulting to 'Low'.
    const riskCounts = {};
    latest.forEach((r) => {
      const rc = r.risk_class || 'No Data';
      riskCounts[rc] = (riskCounts[rc] || 0) + 1;
    });
    let majorityRisk = 'No Data';
    let maxCount = 0;
    for (const [cls, cnt] of Object.entries(riskCounts)) {
      if (cnt > maxCount) { maxCount = cnt; majorityRisk = cls; }
    }

    // Forecast tier, from the per-row `method` the pipeline persisted. The
    // established convention (same as the Forecasting page): 'arima' is an
    // ARIMA Forecast, 'insufficient_data' means no forecast was produced, and
    // anything else is a Baseline Forecast — never relabelled ARIMA.
    const methods = [...new Set(latest.map((r) => r.method).filter(Boolean))];
    const usable = latest.filter((r) => r.method !== 'insufficient_data');
    const tier = methods.length === 0
      ? null
      : usable.length === 0
        ? 'insufficient_data'
        : usable.some((r) => r.method && r.method !== 'arima') ? 'baseline' : 'arima';
    const tierLabel = tier === 'insufficient_data'
      ? 'Insufficient Historical Data'
      : tier === 'baseline' ? 'Baseline Forecast'
      : tier === 'arima' ? 'ARIMA Forecast' : null;

    const periodCount = new Set(forecastsData.map((r) => r.period).filter(Boolean)).size;
    const periodLabel = new Date(latestPeriod).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return { total, period: periodLabel, growthRate, riskLevel: majorityRisk, tier, tierLabel, periodCount };
  }, [forecastsData, monthlyData]);

  /* ── Forecast mini chart data (actual vs projected) ── */
  const forecastChartData = useMemo(() => {
    // Historical: aggregate monthlyData by month (last 12 months)
    const byMonth = {};
    monthlyData.forEach((r) => {
      if (!r.month) return;
      byMonth[r.month] = (byMonth[r.month] || 0) + Number(r.case_count || 0);
    });
    const histEntries = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, cases]) => {
        const d = new Date(month);
        const hasMultipleYears = Object.keys(byMonth).some((m) => m.slice(0, 4) !== month.slice(0, 4));
        return { label: d.toLocaleDateString('en-US', hasMultipleYears ? { month: 'short', year: '2-digit' } : { month: 'short' }), actual: cases, projected: null, month };
      });

    // Forecast: aggregate forecastsData by period
    // Accumulate raw values and round once per period — same rule as the
    // Forecasted KPI and the Dashboard NLG, so the mini chart cannot disagree
    // with the number printed above it.
    const byPeriod = {};
    forecastsData.forEach((r) => {
      if (!r.period) return;
      byPeriod[r.period] = (byPeriod[r.period] || 0) + Number(r.forecasted_count || 0);
    });
    Object.keys(byPeriod).forEach((k) => { byPeriod[k] = Math.round(byPeriod[k]); });
    const fcEntries = Object.entries(byPeriod)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, cases]) => {
        const d = new Date(period);
        const allPeriods = [...Object.keys(byMonth), ...Object.keys(byPeriod)];
        const hasMultipleYears = allPeriods.some((m) => m.slice(0, 4) !== period.slice(0, 4));
        return { label: d.toLocaleDateString('en-US', hasMultipleYears ? { month: 'short', year: '2-digit' } : { month: 'short' }), actual: null, projected: cases, month: period };
      });

    // Merge: keep all historical, add forecast entries that don't overlap
    const histMonths = new Set(histEntries.map((e) => e.month));
    const merged = [
      ...histEntries,
      ...fcEntries.filter((e) => !histMonths.has(e.month)),
    ];
    return merged;
  }, [monthlyData, forecastsData]);

  /* ── 6. Case Fatality Rate (CFR) ──
   * From GET /api/tb/case-fatality-rate — the single shared calculation
   * (see caseFatalityRate.js): DIED / evaluated terminal outcomes (CURED +
   * TREATMENT COMPLETED + DIED + TREATMENT FAILED + LOST TO FOLLOW-UP) × 100,
   * excluding ON TREATMENT and NOT EVALUATED. Previously computed here
   * client-side with a different "evaluated" definition (total minus only
   * NOT EVALUATED, which left ON TREATMENT in the denominator) and coerced
   * an empty denominator to '0.0' instead of N/A. Never 0% when the
   * denominator is empty — the API returns null, rendered as N/A below. */
  const caseFatalityRate = useMemo(() => ({
    rate: cfrData?.rate != null ? cfrData.rate.toFixed(1) : null,
    died: cfrData?.died ?? 0,
    evaluated: cfrData?.evaluated ?? 0,
  }), [cfrData]);

  /* ── 7. Month-over-Month Comparison ── */
  const monthOverMonth = useMemo(() => {
    if (monthlyData.length === 0) return { current: 0, previous: 0, change: 0 };
    const sorted = [...monthlyData].sort((a, b) => a.month.localeCompare(b.month));
    const allMonths = [...new Set(sorted.map(r => r.month))].sort();
    const latestMonth = allMonths[allMonths.length - 1];
    const prevMonth = allMonths.length >= 2 ? allMonths[allMonths.length - 2] : null;

    const currentCases = sorted.filter(r => r.month === latestMonth).reduce((s, r) => s + Number(r.case_count || 0), 0);
    const previousCases = prevMonth ? sorted.filter(r => r.month === prevMonth).reduce((s, r) => s + Number(r.case_count || 0), 0) : 0;
    const change = previousCases > 0 ? ((currentCases - previousCases) / previousCases) * 100 : 0;

    return { current: currentCases, previous: previousCases, change, month: latestMonth };
  }, [monthlyData]);

  /* ── Monitoring period label — the latest month actually covered by
   * imported data, not a hardcoded placeholder. Used by the hero card's
   * "Monitoring Period" field and footer. */
  const monitoringPeriodLabel = useMemo(() => {
    if (!monthOverMonth.month) return '';
    try {
      return new Date(monthOverMonth.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } catch {
      return '';
    }
  }, [monthOverMonth.month]);

  const sexData = useMemo(() => {
    const totals = { Male: 0, Female: 0 };
    demographicsData.forEach((r) => {
      const sex = r.sex || 'Unknown';
      if (sex in totals) totals[sex] += r.total || 0;
    });
    return totals;
  }, [demographicsData]);

  const ageData = useMemo(() => {
    const ageOrder = ['0-14', '15-24', '25-34', '35-44', '45-54', '55-64', '65+', 'Unknown'];
    const totals = {};
    demographicsData.forEach((r) => {
      const age = r.age_group || 'Unknown';
      totals[age] = (totals[age] || 0) + (r.total || 0);
    });
    return ageOrder
      .filter((age) => totals[age] > 0)
      .map((age) => ({ age_group: age, total: totals[age] }));
  }, [demographicsData]);

  /* ── TB Cases Trend chart data ──
   * Months with no row in the data are emitted explicitly with `cases: null`
   * rather than being left out. Previously only months that appear in the
   * result set were plotted, so a calendar month carrying no records was
   * silently collapsed and the area was drawn straight through it, implying
   * continuous reporting. The live dataset has exactly one such month
   * (December 2022), between an isolated late-2022 record and the start of
   * 2023 reporting. `connectNulls={false}` on the series leaves a visible
   * break there: a month with no data is NOT a month with zero cases.
   *
   * A real zero — a month present in the data with a count of 0 — still
   * plots as 0 and is not turned into a gap. */
  const trendChartData = useMemo(() => {
    const byMonth = {};
    monthlyData.forEach((r) => {
      if (!r.month) return;
      byMonth[r.month] = (byMonth[r.month] || 0) + Number(r.case_count || 0);
    });
    const keys = Object.keys(byMonth).sort();
    if (keys.length === 0) return [];

    // Walk the calendar from the first to the last observed month.
    //
    // Month identity is taken from the LOCAL interpretation of the timestamp,
    // which is what the rest of this page already does (see
    // monitoringPeriodLabel). `month` arrives as a Postgres DATE serialized
    // with the backend's UTC offset — e.g. a PHT backend sends 2025-12-01 as
    // "2025-11-30T16:00:00.000Z" — so reading UTC parts here would label that
    // bucket November and shift every month by one. Keyed as "YYYY-M" on
    // local parts, the sequence and the labels agree with the DATE_TRUNC
    // month the database actually grouped by.
    const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;
    const observed = new Map(
      keys.map((k) => [monthKey(new Date(k)), { key: k, cases: byMonth[k] }])
    );

    const first = new Date(keys[0]);
    const last = new Date(keys[keys.length - 1]);
    const cursor = new Date(first.getFullYear(), first.getMonth(), 1);
    const endStamp = new Date(last.getFullYear(), last.getMonth(), 1).getTime();

    const out = [];
    let guard = 0;
    while (cursor.getTime() <= endStamp && guard < 1200) {
      guard += 1;
      const hit = observed.get(monthKey(cursor));
      out.push({
        label: cursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        cases: hit ? hit.cases : null,
        missing: !hit,
        month: hit ? hit.key : new Date(cursor).toISOString(),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return out;
  }, [monthlyData]);

  // Count of calendar months inside the reporting span that carry no records
  // at all — surfaced in the chart caption so the gap is stated, not just drawn.
  const missingMonthCount = useMemo(
    () => trendChartData.filter((d) => d.missing).length,
    [trendChartData]
  );

  /* ── Top Priority Barangays ──
   * Risk class comes ONLY from the persisted Random Forest classification in
   * barangay_risk_scores (via /gis/choropleth). Two earlier sources were
   * removed:
   *
   *  1. A client-side tertile fallback that ranked barangays by
   *     (cases / (population || 1)) × 100,000 and assigned Low/Medium/High
   *     from the resulting thirds. It triggered whenever any barangay had no
   *     classification, so a single unassessed barangay caused fabricated
   *     risk classes for all of them — and `population || 1` invented a
   *     population of 1 for any barangay whose population was unknown,
   *     producing an incidence in the millions. Risk classification must come
   *     from the model; "not assessed" is not a licence to compute a
   *     different number and present it the same way.
   *  2. model_predictions.risk_class, read from the forecast rows. That column
   *     is only ever a denormalized copy of the same barangay_risk_scores row
   *     (see storeResults in scoring.js), so it was never a second opinion —
   *     just a less complete copy with no rows for historical snapshot years.
   *     Reading risk out of the forecast table also blurs the line the
   *     architecture keeps between ARIMA forecasting and RF classification.
   *
   * Barangays with no classification are shown as "No Assessment", never as
   * Low Risk, and sort last. */
  const topBarangays = useMemo(() => {
    if (!monthlyData.length && !riskData.length) return [];
    const byBarangay = {};
    monthlyData.forEach((r) => {
      if (!r.barangay_name) return;
      if (!byBarangay[r.barangay_name]) byBarangay[r.barangay_name] = { name: r.barangay_name, cases: 0 };
      byBarangay[r.barangay_name].cases += Number(r.case_count || 0);
    });
    riskData.forEach((r) => {
      if (!byBarangay[r.name]) byBarangay[r.name] = { name: r.name, cases: 0 };
      const cls = r.risk_class && (r.risk_class || '').toLowerCase() !== 'no data'
        ? r.risk_class
        : null;
      byBarangay[r.name].risk = cls;
      byBarangay[r.name].score = Number(r.risk_score || 0);
    });
    return Object.values(byBarangay)
      .sort((a, b) => {
        const rpA = RISK_PRIORITY[a.risk] ?? 0;
        const rpB = RISK_PRIORITY[b.risk] ?? 0;
        if (rpB !== rpA) return rpB - rpA;
        return (b.score || b.cases) - (a.score || a.cases);
      })
      .slice(0, 5)
      .map((b, i) => ({ rank: i + 1, ...b }));
  }, [monthlyData, riskData]);

  /* ── Treatment Outcomes chart data ── */
  const outcomeChart = useMemo(() => {
    // The API already returns the source-aligned label, but the same shared
    // mapping is applied here so the chart cannot show a legacy form if an
    // unmapped value ever reaches it. Values outside the 9 verified categories
    // (e.g. SCREENED) are counted separately and reported in the caption rather
    // than drawn as a category or silently dropped.
    const byStatus = {};
    let excluded = 0;
    outcomesData.forEach((r) => {
      const st = normalizeDisplayOutcome(r.outcome_status);
      if (!st) { excluded += Number(r.total || 0); return; }
      byStatus[st] = (byStatus[st] || 0) + Number(r.total || 0);
    });
    const data = OUTCOME_ORDER
      .filter((st) => byStatus[st])
      .map((st) => ({ outcome: st, count: byStatus[st], color: OUTCOME_COLORS[st] || '#94A3B8' }));
    return { data, excluded, chartTotal: data.reduce((t, d) => t + d.count, 0) };
  }, [outcomesData]);

  const outcomeChartData = outcomeChart.data;

  /* ── Recent Alerts ──
   * Reads persisted alert rows only — the Dashboard never evaluates or
   * generates alerts by being loaded or refreshed (all of loadAll is GETs).
   * The request already restricts this to unresolved alerts of type 'alert',
   * so resolved rows and notifications ("Forecast Generated") no longer
   * appear here as if they were open alerts.
   *
   * `severity` in the alerts table is lowercase and rule-derived
   * ('danger' | 'high' | 'warning' | 'info'), so 'danger' — the most severe
   * band the alert rules emit — is classed as critical here. It previously
   * fell through to the non-critical style because only 'CRITICAL'/'HIGH'
   * were matched, which rendered the strongest alert in the mildest colour. */
  const recentAlerts = useMemo(() => {
    return alertsData.slice(0, 5).map((a) => {
      const severity = (a.severity || 'Medium').toUpperCase();
      const createdAt = a.created_at ? new Date(a.created_at) : null;
      let timeLabel = '';
      if (createdAt) {
        const diffMs = now - createdAt.getTime();
        const diffHrs = diffMs / (1000 * 60 * 60);
        if (diffHrs < 1) {
          const mins = Math.floor(diffMs / (1000 * 60));
          timeLabel = mins < 1 ? 'Just now' : `${mins}m ago`;
        } else if (diffHrs < 24) {
          timeLabel = createdAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        } else if (diffHrs < 48) {
          timeLabel = 'Yday';
        } else {
          timeLabel = createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
      }
      return {
        id: a.id,
        severity,
        isCritical: CRITICAL_SEVERITIES.has(severity),
        type: a.type || 'alert',
        title: a.title || a.alert_type || 'Alert',
        message: a.message || '',
        barangay: a.barangay_name || '',
        time: timeLabel,
      };
    });
  }, [alertsData, now]);

  /* ── Freshness timestamps ──
   * Last Synced and Last Model Run are DIFFERENT things and are kept apart.
   * This used to be a single "Last Updated" value that took the model
   * pipeline's trained_at and, failing that, fell back to the newest
   * date_of_diagnosis — a clinical date describing data coverage, not a
   * system timestamp, presented under a freshness label. */
  const lastSynced = useMemo(
    () => (freshness?.lastSynced ? new Date(freshness.lastSynced) : null),
    [freshness]
  );
  const lastModelRun = useMemo(() => {
    if (freshness?.lastModelRun) return new Date(freshness.lastModelRun);
    if (pipelineStatus?.trained_at) return new Date(pipelineStatus.trained_at);
    return null;
  }, [freshness, pipelineStatus]);

  // Always derived from a real stored timestamp — never a fixed string.
  const relativeTime = useCallback((date) => {
    if (!date) return '';
    const diffMins = Math.floor((now - date.getTime()) / 60000);
    if (diffMins < 0) return 'Just now';
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 30) return `${diffDays} days ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
  }, [now]);

  const lastSyncedRelative = useMemo(() => relativeTime(lastSynced), [relativeTime, lastSynced]);
  const lastModelRunRelative = useMemo(() => relativeTime(lastModelRun), [relativeTime, lastModelRun]);

  /* ── Animated KPI numbers ── */
  const animatedTotalCases = useAnimatedNumber(totalCases.total);
  const animatedNewCases = useAnimatedNumber(monthOverMonth.current);
  const animatedSuccessRate = useAnimatedNumber(Number(successRate.rate), 600, 1);
  const animatedFatalityRate = useAnimatedNumber(Number(caseFatalityRate.rate), 600, 1);
  const animatedHighRisk = useAnimatedNumber(highRiskCount ?? 0);
  const animatedForecasted = useAnimatedNumber(forecastSummary.total);

  /* ────────── Render ────────── */

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: '#FEF2F2' }}>
          <i className="ri-error-warning-line text-3xl" style={{ color: '#EF4444' }} />
        </div>
        <p className="text-sm font-medium" style={{ color: '#64748B' }}>{error}</p>
        <button onClick={loadAll} className="px-5 py-2.5 text-xs font-semibold" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }} onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}>
          Retry
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Metrics skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl p-5" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
              <SkeletonBlock className="h-3 w-24 mb-3" />
              <SkeletonBlock className="h-8 w-16 mb-2" />
              <SkeletonBlock className="h-3 w-20" />
            </div>
          ))}
        </div>
        {/* Welcome & Insights Section skeleton */}
        <div className="flex flex-col md:flex-row gap-5">
          <div className="w-full md:w-[58%] lg:w-[67%] rounded-2xl p-6" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
            <SkeletonBlock className="h-7 w-64 mb-3" />
            <SkeletonBlock className="h-4 w-96 mb-6" />
            <div className="grid grid-cols-2 gap-4 pt-4" style={{ borderTop: '1px solid #F1F5F9' }}>
              <div><SkeletonBlock className="h-3 w-24 mb-2" /><SkeletonBlock className="h-5 w-36" /></div>
              <div><SkeletonBlock className="h-3 w-24 mb-2" /><SkeletonBlock className="h-5 w-40" /></div>
            </div>
          </div>
          <div className="w-full md:w-[42%] lg:w-[33%] rounded-2xl p-6" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
            <SkeletonBlock className="h-5 w-44 mb-4" />
            <SkeletonBlock className="h-16 w-full mb-4" />
            <SkeletonBlock className="h-4 w-32" />
          </div>
        </div>
        {/* Chart skeletons */}
        <SkeletonCard />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><SkeletonCard /><SkeletonCard /></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 relative">

      {/* ─── Refresh Overlay ─── */}
      {refreshing && (
        <div className="absolute inset-0 z-50 flex items-start justify-center pt-32 rounded-xl" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(1px)' }}>
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
            <i className="ri-refresh-line text-sm animate-spin" style={{ color: '#0F2D52' }} />
            <span className="text-xs font-semibold" style={{ color: '#0F2D52' }}>Refreshing data...</span>
          </div>
        </div>
      )}


      {/* ─── Empty State ─── */}
      {totalCases.total === 0 && forecastsData.length === 0 && alertsData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ background: '#F1F5F9' }}>
            <i className="ri-database-2-line text-4xl" style={{ color: '#CBD5E1' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold" style={{ color: '#475569' }}>No Data Available</p>
            <p className="text-xs mt-1 max-w-sm" style={{ color: '#94A3B8' }}>No TB records found in the database. Import TB records to populate the dashboard.</p>
          </div>
        </div>
      ) : (
        <>
          {/* ─── 3. Key Metric Cards ─── */}
          <div className="rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15,45,82,0.12), 0 2px 8px rgba(15,45,82,0.08)' }}>
            <div className="grid grid-cols-2 lg:grid-cols-6">
              {/* Total TB Cases */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-database-2-line text-sm" style={{ color: '#6B7FA3' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Total TB Cases</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                  {failed.monthly ? 'Unavailable' : animatedTotalCases.toLocaleString()}
                </p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>
                  {failed.monthly ? 'Could not be loaded' : `${totalCases.months} months recorded (all-time)`}
                </span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* New Cases (latest recorded month) */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-calendar-check-line text-sm" style={{ color: '#B8956A' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>New Cases</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                  {failed.monthly ? 'Unavailable' : animatedNewCases.toLocaleString()}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>
                    {failed.monthly ? 'Could not be loaded' : (monitoringPeriodLabel || 'No data yet')}
                  </span>
                  {monthOverMonth.previous > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold" style={{ color: monthOverMonth.change > 0 ? '#B07070' : monthOverMonth.change < 0 ? '#6B9E8A' : '#64748B' }}>
                      <i className={`ri-arrow-${monthOverMonth.change > 0 ? 'up' : monthOverMonth.change < 0 ? 'down' : 'right'}-s-fill`} />
                      {Math.abs(monthOverMonth.change).toFixed(1)}%
                    </span>
                  )}
                </div>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Treatment Success Rate */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-checkbox-circle-line text-sm" style={{ color: '#6B9E8A' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Treatment Success Rate</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                  {failed.tsr ? 'Unavailable' : successRate.rate == null ? 'N/A' : `${animatedSuccessRate}%`}
                </p>
                <span
                  className="text-[11px] font-medium mt-1"
                  style={{ color: '#94A3B8' }}
                  title="Treatment Success Rate based on the previous-year treatment cohort: (Cured + Treatment Completed) divided by all patients whose treatment started in that year."
                >
                  {failed.tsr
                    ? 'Could not be loaded'
                    : successRate.rate == null
                      ? 'No previous-year treatment cohort'
                      : `${successRate.evaluated.toLocaleString()} patients${successRate.cohortYear ? ` (${successRate.cohortYear} cohort)` : ''}`}
                </span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Case Fatality Rate */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-heart-pulse-line text-sm" style={{ color: '#B07070' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Case Fatality Rate</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                  {failed.cfr ? 'Unavailable' : caseFatalityRate.rate == null ? 'N/A' : `${animatedFatalityRate}%`}
                </p>
                <span
                  className="text-[11px] font-medium mt-1"
                  style={{ color: '#94A3B8' }}
                  title="Deaths among evaluated terminal outcomes (Cured, Treatment Completed, Died, Failed, Lost to FF-UP). On Treatment and Not Evaluated are excluded."
                >
                  {failed.cfr
                    ? 'Could not be loaded'
                    : caseFatalityRate.rate == null
                      ? 'No evaluated terminal outcomes'
                      : `${caseFatalityRate.died} deaths / ${caseFatalityRate.evaluated.toLocaleString()} evaluated`}
                </span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* High-Risk Barangays */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-alarm-warning-line text-sm" style={{ color: '#C4886A' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>High-Risk</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                  {failed.risk ? 'Unavailable' : highRiskCount == null ? 'N/A' : `${animatedHighRisk}/${assessedCount}`}
                </p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>
                  {failed.risk
                    ? 'Risk classification could not be loaded'
                    : highRiskCount == null
                      ? 'No risk assessment available yet'
                      : `Of ${assessedCount} assessed barangays${riskYear ? ` (${riskYear} assessment)` : ''}`}
                </span>
                {!failed.risk && noAssessmentCount > 0 && (
                  <span className="text-[10px] font-medium" style={{ color: '#B07070' }}>
                    {noAssessmentCount} not assessed
                  </span>
                )}
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Forecasted Cases */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-line-chart-line text-sm" style={{ color: '#6B9E9E' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Forecasted</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                  {failed.forecasts || forecastSummary.tier === 'insufficient_data' || !forecastSummary.period
                    ? 'N/A'
                    : animatedForecasted.toLocaleString()}
                </p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>
                  {failed.forecasts
                    ? 'Forecast could not be loaded'
                    : forecastSummary.tier === 'insufficient_data'
                      ? 'Insufficient Historical Data'
                      : forecastSummary.period
                        ? `${forecastSummary.period}${forecastSummary.tierLabel ? ` — ${forecastSummary.tierLabel}` : ''}`
                        : 'No forecast available'}
                </span>
              </div>
            </div>
          </div>

          {/* ─── Welcome + NLG Overall Insights Section ─── */}
          <DashboardWelcomeInsightsSection
            user={user}
            lastSynced={lastSynced}
            lastSyncedRelative={lastSyncedRelative}
            lastModelRun={lastModelRun}
            lastModelRunRelative={lastModelRunRelative}
            syncSource={freshness?.syncSource || null}
            dataSource={freshness?.dataSource || null}
            freshnessUnavailable={!!failed.freshness}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            insightData={dashboardInsight}
            insightLoading={dashboardInsightLoading}
            insightError={dashboardInsightError}
            onRetryInsight={handleGenerateDashboardInsight}
            monitoringPeriod={monitoringPeriodLabel}
            forecastSummary={forecastSummary}
          />

          {/* ─── 4. TB Cases Trend + 5. Barangay Risk Overview ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* TB Cases Trend */}
            <SectionCard
              title="TB Cases Trend"
              insight={trendInsight(trendChartData, { valueKey: 'cases' })}
              iconColor="#6B7FA3"
              description="Monthly tuberculosis cases based on recorded TB data."
              action="View Analytics"
              actionTo="/analytics"
            >
              {failed.monthly ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <i className="ri-cloud-off-line text-2xl" style={{ color: '#B07070' }} />
                  <p className="text-xs" style={{ color: '#B07070' }}>Trend data could not be loaded.</p>
                </div>
              ) : trendChartData.length > 0 ? (
                <div className="w-full" style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendChartData} margin={{ top: 10, right: 15, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2563EB" stopOpacity={0.08} />
                          <stop offset="100%" stopColor="#2563EB" stopOpacity={0.01} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E8ECF1" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickMargin={6} />
                      <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={40} tickMargin={4} />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#E2E8F0', strokeWidth: 1 }} />
                      <Area type="monotone" dataKey="cases" stroke="#2563EB" strokeWidth={2.5} fill="url(#trendGrad)" dot={{ fill: '#2563EB', r: 3.5, strokeWidth: 2, stroke: '#ffffff' }} activeDot={{ r: 5, strokeWidth: 2, stroke: '#ffffff' }} name="Cases" connectNulls={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                  {missingMonthCount > 0 && (
                    <p className="text-[10px] mt-1" style={{ color: '#94A3B8' }}>
                      {missingMonthCount} month{missingMonthCount === 1 ? '' : 's'} in this span
                      have no reported records and are shown as a gap, not as zero cases.
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <i className="ri-line-chart-line text-2xl" style={{ color: '#CBD5E1' }} />
                  <p className="text-xs" style={{ color: '#94A3B8' }}>No trend data available.</p>
                </div>
              )}
            </SectionCard>

            {/* Barangay Risk Overview — GIS Map */}
            <SectionCard
              title="Barangay Risk Overview"
              insight={riskInsight(riskData)}
              iconColor="#EF4444"
              description="Current risk classification across Pasig City barangays."
              action="View GIS Hotspots"
              actionTo="/gis-map"
            >
              <div className="relative rounded-lg overflow-hidden">
                <MiniGisMap refreshKey={refreshCount} />
              </div>
              {/* Risk legend */}
              <div className="flex items-center justify-center gap-4 mt-3">
                {[
                  { level: 'Low', color: GIS_RISK_COLORS.Low },
                  { level: 'Moderate', color: GIS_RISK_COLORS.Medium },
                  { level: 'High', color: GIS_RISK_COLORS.High },
                ].map((r) => (
                  <div key={r.level} className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: '#64748B' }}>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />
                    {r.level}
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          {/* ─── 6. Top Priority Barangays + Treatment Outcomes ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top High-Risk Barangays */}
            <SectionCard
              title="Top High-Risk Barangays"
              insight={topBarangays[0]
                ? `${topBarangays[0].name} ranks first (${topBarangays[0].risk ? `${topBarangays[0].risk} risk` : 'no risk assessment yet'}, ${Number(topBarangays[0].cases || 0).toLocaleString('en-US')} recorded cases). Barangays are ordered by risk level first, then by case burden.`
                : null}
              iconColor="#6B7280"
              description="Barangays with the highest recorded TB burden and risk classification."
              action="View GIS Hotspots"
              actionTo="/gis-map"
            >
              {failed.risk && failed.monthly ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <i className="ri-cloud-off-line text-xl" style={{ color: '#B07070' }} />
                  <p className="text-xs" style={{ color: '#B07070' }}>Barangay risk data could not be loaded.</p>
                </div>
              ) : topBarangays.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ minWidth: 380 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#0F2D52' }}>
                        {['Rank', 'Barangay', 'TB Cases', 'Risk Level'].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: '#ffffff' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {topBarangays.map((row, i) => (
                        <tr key={row.name} style={{ borderBottom: '1px solid #F1F5F9', background: i % 2 === 0 ? '#ffffff' : '#FAFBFC' }}>
                          <td className="px-4 py-3 text-xs font-bold" style={{ color: '#0F2D52' }}>{row.rank}</td>
                          <td className="px-4 py-3 text-xs font-semibold" style={{ color: '#1E293B' }}>{row.name}</td>
                          <td className="px-4 py-3 text-xs font-bold tabular-nums" style={{ color: '#1E293B' }}>{row.cases.toLocaleString()}</td>
                          <td className="px-4 py-3"><RiskBadge risk={row.risk || 'No Assessment'} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <i className="ri-list-ordered text-xl" style={{ color: '#CBD5E1' }} />
                  <p className="text-xs" style={{ color: '#94A3B8' }}>No barangay risk data available.</p>
                </div>
              )}
            </SectionCard>

            {/* Age Group Distribution */}
            <SectionCard
              title="Demographics — Age Distribution"
              insight={shareInsight(ageData, { nameKey: 'age_group', valueKey: 'total', noun: 'age group' })}
              iconColor="#6B7280"
              description="TB cases by age group."
            >
              {failed.demographics ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <i className="ri-cloud-off-line text-xl" style={{ color: '#B07070' }} />
                  <p className="text-xs" style={{ color: '#B07070' }}>Demographic data could not be loaded.</p>
                </div>
              ) : ageData.length > 0 ? (
                <div className="space-y-3 pt-1">
                  {(() => {
                    const maxTotal = Math.max(...ageData.map(a => a.total), 1);
                    return ageData.map((item) => {
                      const pct = ((item.total / maxTotal) * 100).toFixed(0);
                      return (
                        <div key={item.age_group} className="flex items-center gap-3">
                          <span className="text-[11px] font-semibold w-10 shrink-0" style={{ color: '#64748B' }}>{item.age_group}</span>
                          <div className="flex-1 h-5 rounded-md" style={{ background: '#E2E8F0' }}>
                            <div className="h-full rounded-md transition-all" style={{ width: `${pct}%`, background: '#6B7280' }} />
                          </div>
                          <span className="text-[11px] font-bold w-10 text-right shrink-0" style={{ color: '#0F2D52' }}>{item.total.toLocaleString()}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <i className="ri-group-line text-xl" style={{ color: '#CBD5E1' }} />
                  <p className="text-xs" style={{ color: '#94A3B8' }}>No age data available.</p>
                </div>
              )}
            </SectionCard>
          </div>

          {/* ─── 7. Demographics — Sex + Treatment Outcomes ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sex Distribution */}
            <SectionCard
              title="Demographics — Sex Distribution"
              insight={shareInsight(Object.entries(sexData).map(([name, value]) => ({ name, value })), { noun: 'sex' })}
              iconColor="#3B82F6"
              description="Male vs female TB case distribution."
            >
              {failed.demographics ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <i className="ri-cloud-off-line text-xl" style={{ color: '#B07070' }} />
                  <p className="text-xs" style={{ color: '#B07070' }}>Demographic data could not be loaded.</p>
                </div>
              ) : (sexData.Male + sexData.Female) > 0 ? (
                <div className="flex items-center justify-center gap-6">
                  <div className="w-[160px] h-[160px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Male', value: sexData.Male },
                            { name: 'Female', value: sexData.Female },
                          ]}
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={70}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          <Cell fill="#3B82F6" />
                           <Cell fill="#B48EAD" />
                        </Pie>
                        <Tooltip formatter={(value) => value.toLocaleString()} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2">
                    {[
                      { label: 'Male', value: sexData.Male, color: '#3B82F6' },
                       { label: 'Female', value: sexData.Female, color: '#B48EAD' },
                    ].map((item) => {
                      const total = sexData.Male + sexData.Female;
                      const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : 0;
                      return (
                        <div key={item.label} className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: item.color }} />
                          <span className="text-xs font-semibold" style={{ color: '#475569' }}>{item.label}</span>
                          <span className="text-xs font-bold" style={{ color: '#0F2D52' }}>{item.value.toLocaleString()}</span>
                          <span className="text-[10px]" style={{ color: '#94A3B8' }}>({pct}%)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <i className="ri-men-line text-xl" style={{ color: '#CBD5E1' }} />
                  <p className="text-xs" style={{ color: '#94A3B8' }}>No demographic data available.</p>
                </div>
              )}
            </SectionCard>

            {/* Treatment Outcomes */}
            <SectionCard
              title="Treatment Outcomes & Case Status"
              insight={outcomeInsight(outcomeChartData, { nameKey: 'outcome', valueKey: 'count' })}
              iconColor="#10B981"
              description="Final treatment outcomes, with cases still diagnosed or on treatment shown separately."
              action="View Analytics"
              actionTo="/analytics"
            >
              {failed.outcomes ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <i className="ri-cloud-off-line text-xl" style={{ color: '#B07070' }} />
                  <p className="text-xs" style={{ color: '#B07070' }}>Outcome data could not be loaded.</p>
                </div>
              ) : (
                <OutcomeStatusPanel
                  outcomes={Object.fromEntries(outcomeChartData.map((e) => [e.outcome, e.count]))}
                  diagnosed={statusSummary?.diagnosed_count || 0}
                  onTreatment={statusSummary?.on_treatment_count || 0}
                />
              )}
              {outcomeChart.excluded > 0 && (
                <p className="text-[10px] mt-3" style={{ color: '#94A3B8' }}>
                  Showing {outcomeChart.chartTotal.toLocaleString()} of {totalCases.total.toLocaleString()} records.
                  {' '}{outcomeChart.excluded.toLocaleString()} record{outcomeChart.excluded === 1 ? '' : 's'} carry a
                  source value without a final treatment outcome and are not charted.
                </p>
              )}
            </SectionCard>
          </div>

          {/* ─── 8. Forecasting Summary + Recent Alerts ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Forecasting Summary */}
            <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-1 h-8 rounded-full" style={{ background: '#0D9488' }} />
                  <div>
                    <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>Forecasting Summary</h3>
                    <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>
                      {forecastSummary.period
                        ? `Forecasted TB cases for ${forecastSummary.period}${
                            forecastSummary.periodCount > 1 ? ` (latest of ${forecastSummary.periodCount} forecast periods)` : ''
                          }`
                        : 'Forecasted TB cases for the next forecast period'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => navigate('/forecasting')}
                  className="flex items-center gap-1 text-[11px] font-semibold transition hover:underline"
                  style={{ color: '#0F2D52' }}
                >
                  View Full Forecast <i className="ri-arrow-right-s-line text-sm" />
                </button>
              </div>

              {/* Content — same wrapper as SectionCard */}
              <div className="px-5 pb-5">
                {/* Key-value list */}
                <div>
                  {[
                    { label: 'Forecasted Cases', value: forecastSummary.period ? forecastSummary.total.toLocaleString() : 'N/A', valueColor: '#0F2D52' },
                    { label: 'Forecast Method', value: forecastSummary.tierLabel || 'N/A', valueColor: '#0F2D52' },
                    { label: 'Growth Rate vs Historical Monthly Average', value: forecastSummary.period ? `${forecastSummary.growthRate >= 0 ? '+' : ''}${forecastSummary.growthRate.toFixed(1)}%` : 'N/A', valueColor: forecastSummary.growthRate >= 0 ? '#EF4444' : '#10B981' },
                    // Labelled as the Random Forest class, because that is what it is:
                    // a copy of the RF classification, not an output of the forecast.
                    { label: 'Predominant RF Risk Class', value: forecastSummary.riskLevel === 'No Data' ? 'No Assessment' : forecastSummary.riskLevel, valueColor: RISK_COLORS[forecastSummary.riskLevel] || '#64748B' },
                    { label: 'Forecast Period', value: forecastSummary.period || 'N/A', valueColor: '#0F2D52' },
                  ].map((item, i, arr) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between py-3.5"
                      style={{ borderBottom: i < arr.length - 1 ? '1px solid #F1F5F9' : 'none' }}
                    >
                      <span className="text-[11px] font-medium" style={{ color: '#64748B' }}>{item.label}</span>
                      <span className="text-[13px] font-bold" style={{ color: item.valueColor }}>{item.value}</span>
                    </div>
                  ))}
                </div>

                {/* Mini trend chart */}
                {forecastChartData.length > 1 && (
                  <div className="mt-3">
                    <div className="w-full" style={{ height: 140 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={forecastChartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="fcActualGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#2563EB" stopOpacity={0.1} />
                              <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="fcProjGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#0D9488" stopOpacity={0.1} />
                              <stop offset="100%" stopColor="#0D9488" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E8ECF1" />
                          <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickMargin={4} />
                          <YAxis tick={{ fontSize: 9, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={35} tickMargin={2} />
                          <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#E2E8F0', strokeWidth: 1 }} />
                          <Area type="monotone" dataKey="actual" stroke="#2563EB" strokeWidth={2} fill="url(#fcActualGrad)" dot={false} name="Actual" connectNulls={false} />
                          <Area type="monotone" dataKey="projected" stroke="#0D9488" strokeWidth={2} strokeDasharray="5 3" fill="url(#fcProjGrad)" dot={false} name="Forecasted" connectNulls={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    {/* Legend */}
                    <div className="flex items-center justify-center gap-4 mt-1">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium" style={{ color: '#64748B' }}>
                        <span className="w-3 h-0.5 rounded" style={{ background: '#2563EB' }} />
                        Actual
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] font-medium" style={{ color: '#64748B' }}>
                        <span className="w-3 h-[2px] rounded" style={{ background: 'repeating-linear-gradient(to right, #0D9488 0px, #0D9488 3px, transparent 3px, transparent 5px)' }} />
                        Forecasted
                      </div>
                    </div>
                    <ChartInsight text={forecastInsight(forecastChartData, { actualKey: 'actual', forecastKey: 'projected', methodLabel: forecastSummary.tierLabel })} />
                  </div>
                )}
              </div>
            </div>

            {/* Recent Alerts */}
            <SectionCard
              title="Recent Alerts"
              iconColor="#EF4444"
              description={
                failed.alerts
                  ? 'Alerts could not be loaded'
                  : alertsTotal == null
                    ? 'Unresolved alerts'
                    : `${alertsTotal} unresolved alert${alertsTotal !== 1 ? 's' : ''}${
                        alertsTotal > recentAlerts.length ? ` — showing the latest ${recentAlerts.length}` : ''
                      }`
              }
              action="View All Alerts"
              actionTo="/alert"
            >
              {failed.alerts ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <i className="ri-cloud-off-line text-xl" style={{ color: '#B07070' }} />
                  <p className="text-xs" style={{ color: '#B07070' }}>Alerts could not be loaded.</p>
                </div>
              ) : recentAlerts.length > 0 ? (
                <div>
                  {recentAlerts.map((alert, idx) => {
                    const isCritical = alert.isCritical;
                    const badgeBg = isCritical ? 'rgba(153,27,27,0.08)' : 'rgba(146,64,14,0.08)';
                    const badgeColor = isCritical ? '#991B1B' : '#92400E';
                    return (
                      <div
                        key={alert.id || idx}
                        className="flex items-center gap-4 py-3.5"
                        style={{
                          borderBottom: idx < recentAlerts.length - 1 ? '1px solid #F1F5F9' : 'none',
                        }}
                      >
                        {/* Time */}
                        <span className="text-[11px] font-semibold w-16 shrink-0 text-center" style={{ color: '#94A3B8' }}>
                          {alert.time}
                        </span>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <span className="text-[12px] font-bold" style={{ color: '#1E293B' }}>
                            {alert.barangay || alert.title}
                          </span>
                          {alert.message && (
                            <span className="text-[12px] font-medium" style={{ color: '#64748B' }}> {alert.message}</span>
                          )}
                        </div>

                        {/* Severity badge */}
                        <span
                          className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded shrink-0 inline-flex items-center gap-1"
                          style={{ background: badgeBg, color: badgeColor }}
                          title={`Severity: ${alert.severity}`}
                        >
                          <i
                            className={isCritical ? 'ri-error-warning-fill' : 'ri-information-fill'}
                            aria-hidden="true"
                          />
                          {alert.severity}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <i className="ri-alarm-line text-xl" style={{ color: '#CBD5E1' }} />
                  <p className="text-xs" style={{ color: '#94A3B8' }}>No alerts at this time.</p>
                </div>
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}
