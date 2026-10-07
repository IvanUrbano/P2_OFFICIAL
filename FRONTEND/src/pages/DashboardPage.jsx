import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Cell, Line, LineChart,
  CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie,
} from 'recharts';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import API from '../api/axios';
import DashboardWelcomeInsightsSection from '../components/DashboardWelcomeInsightsSection';
import OutcomeStatusPanel from '../components/OutcomeStatusPanel';
import RecommendedFilters from '../components/RecommendedFilters';
import ChartInsight from '../components/ChartInsight';
import { trendInsight, riskInsight, shareInsight, outcomeInsight, forecastInsight } from '../utils/chartInsights';
import { getDashboardInsight } from '../services/insightService';
import {
  dataYears, barangayNames, scopeByBarangay, scopeMonthly, filterQuery, recommendFilters,
} from '../utils/dashboardFilters';
import { summarizeForecast, topBarangayRanking } from '../utils/dashboardForecast';
import {
  APPROVED_OUTCOMES, OUTCOME_COLORS, normalizeDisplayOutcome,
} from '../utils/outcomeStatus';

/* ─── Constants ──────────────────────────────────────────────────────── */

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

/* Alert severities that warrant the critical treatment. `severity` in the
 * alerts table is lowercase and rule-derived ('danger' | 'high' | 'warning' |
 * 'info'); 'danger' is the most severe band the alert rules emit, so it
 * belongs here — it previously fell through to the mild style because only
 * CRITICAL/HIGH were matched. */
const CRITICAL_SEVERITIES = new Set(['CRITICAL', 'DANGER', 'HIGH']);

const normName = (s) => String(s ?? '').trim().toLowerCase();

// `highlight` is the set of barangays the dashboard filter is scoped to (null = no filter):
// everything else is faded so the selected barangays stand out.
function riskStyle(feature, highlight = null) {
  const risk = feature.properties?.risk_class || 'No Data';
  const dimmed = highlight && !highlight.has(normName(feature.properties?.name));
  return {
    fillColor: GIS_RISK_COLORS[risk] || GIS_RISK_COLORS['No Data'],
    weight: highlight && !dimmed ? 1.5 : 0.5,
    opacity: 0.9,
    color: highlight && !dimmed ? '#ffffff' : 'rgba(255,255,255,0.3)',
    fillOpacity: dimmed ? 0.12 : 0.55,
  };
}

/* ─── Mini GIS Map ─── */
function MiniGisMap({ refreshKey, highlight = null }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const dataRef = useRef(null);
  const labelsRef = useRef(null);
  const geoRef = useRef(null);
  const highlightRef = useRef(highlight);

  // Re-style the existing layer when the filter changes (no refetch, no map rebuild).
  useEffect(() => {
    highlightRef.current = highlight;
    if (geoRef.current) geoRef.current.setStyle((f) => riskStyle(f, highlight));
  }, [highlight]);

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

        geoRef.current = L.geoJSON(res.data, { style: (f) => riskStyle(f, highlightRef.current), interactive: false }).addTo(map);
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
      geoRef.current = null;
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
    <div className="min-w-[120px] border border-[#CBD5E1] bg-white px-3 py-2 text-xs shadow-sm">
      {label && <div className="mb-1.5 border-b border-[#E2E8F0] pb-1 text-[11px] font-semibold text-[#334155]">{label}</div>}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0" style={{ background: entry.color || entry.stroke }} />
            <span className="text-[#475569]">{entry.name}</span>
          </div>
          <span className="font-semibold tabular-nums text-[#0F2D52]">{entry.value?.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function RiskBadge({ risk }) {
  const color = { High: '#991B1B', Moderate: '#92400E', Medium: '#92400E', Low: '#047857' }[risk] || '#64748B';
  // The level is spelled out in text as well as indicated by the dot,
  // so the classification is never communicated by colour alone.
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium"
      style={{ color }}
      title={`Risk classification: ${risk}`}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {risk}
    </span>
  );
}

function SectionCard({ title, description, action, actionTo, insight, children }) {
  const navigate = useNavigate();
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#E2E8F0] px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#0F2D52]">{title}</h3>
          {description && <p className="mt-1 text-xs leading-snug text-[#64748B]">{description}</p>}
        </div>
      </div>
      <div className="flex-1 px-5 py-5">{children}<ChartInsight text={insight} plain /></div>
      {action && (
        <div className="border-t border-[#E2E8F0] px-5 py-3">
          <button
            type="button"
            onClick={() => actionTo && navigate(actionTo)}
            className="cursor-pointer text-[12px] font-semibold text-[#047857] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#047857]"
          >
            {action} &rarr;
          </button>
        </div>
      )}
    </section>
  );
}

import SkeletonBlock from '../../components/SkeletonBlock';

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
      <div className="border-b border-[#E2E8F0] px-5 py-4"><SkeletonBlock className="h-4 w-32" /></div>
      <div className="px-5 py-5"><SkeletonBlock className="h-48 w-full" /></div>
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
  /* ── User ── */
  const [user] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  });

  /* ── State ── */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // *All = what the server returned. The names without the suffix (monthlyData, riskData, ...)
  // are derived below and already scoped by the Recommended Filters, so every card and KPI
  // that reads them follows the filter without being changed.
  const [monthlyAll, setMonthlyAll] = useState([]);
  const [outcomesAll, setOutcomesAll] = useState([]);
  const [tsrData, setTsrData] = useState(null);
  const [cfrData, setCfrData] = useState(null);
  const [forecastsAll, setForecastsAll] = useState([]);
  const [alertsAll, setAlertsAll] = useState([]);
  // Total unresolved alerts from pagination.total — the displayed rows are a
  // capped slice, so their length is not the unresolved count.
  const [alertsTotal, setAlertsTotal] = useState(null);
  const [riskAll, setRiskAll] = useState([]);
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [demographicsAll, setDemographicsAll] = useState([]);
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

  /* ── Recommended filters ──
   * filters = { year: '2025' | '', scope: null | { mode: 'preset'|'manual', key, label, barangays } }.
   * Figures that the server computes (status counts, success rate, fatality rate, outcomes,
   * demographics, year-specific risk) are re-requested when the filter changes; everything
   * that is already barangay-by-month on the page is scoped on the client. */
  const [filters, setFilters] = useState({ year: '', scope: null });
  const filtersRef = useRef(filters);
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  const scopeNames = filters.scope ? filters.scope.barangays : null;
  const filterKey = JSON.stringify([filters.year, scopeNames]);
  const filtersActive = Boolean(filters.year || filters.scope);

  const [riskForYear, setRiskForYear] = useState(null);   // { year, rows } — risk snapshot of the chosen year
  const [scopedKey, setScopedKey] = useState(null);       // filter set the server figures currently belong to
  const scopedSeq = useRef(0);
  const requestedKey = useRef(null);
  const baseRiskFailed = useRef(false);

  const settle = useCallback((url) => API.get(url).then(
    (res) => ({ ok: true, data: res.data }),
    (err) => {
      if (import.meta.env.DEV) console.error(`Dashboard fetch failed: ${url}`, err);
      return { ok: false, data: null };
    }
  ), []);

  // Server-side figures for one filter set. A newer filter change supersedes an older
  // request, so a slow response can never overwrite the view the user is now looking at.
  const loadScoped = useCallback(async (f) => {
    const seq = ++scopedSeq.current;
    const names = f.scope ? f.scope.barangays : null;
    const key = JSON.stringify([f.year, names]);
    requestedKey.current = key;
    const yearOnly = filterQuery({ year: f.year }, { withBarangays: false });
    const full = filterQuery({ year: f.year, barangays: names });

    const [outcomesRes, demoRes, statusRes, tsrRes, cfrRes, riskRes] = await Promise.all([
      settle(`/api/tb/dashboard/outcomes${yearOnly}`),
      settle(`/api/tb/dashboard/demographics${yearOnly}`),
      // Case status counts (Diagnosed / On Treatment) for the outcomes panel
      settle(`/api/tb/dashboard/summary${full}`),
      // Cohort-based success rate: a chosen year Y reports the Y-1 treatment cohort.
      settle(`/api/tb/treatment-success-rate${full}`),
      settle(`/api/tb/case-fatality-rate${full}`),
      f.year ? settle(`/api/tb/gis/choropleth${yearOnly}`) : Promise.resolve(null),
    ]);
    if (seq !== scopedSeq.current) return null;

    setFailed((prev) => ({
      ...prev,
      outcomes: !outcomesRes.ok,
      demographics: !demoRes.ok,
      status: !statusRes.ok,
      tsr: !tsrRes.ok,
      cfr: !cfrRes.ok,
      risk: riskRes ? !riskRes.ok : baseRiskFailed.current,
    }));
    setOutcomesAll(outcomesRes.data?.outcomes || []);
    setDemographicsAll(demoRes.data?.demographics || []);
    setStatusSummary(statusRes.data?.summary || null);
    setTsrData(tsrRes.data || null);
    setCfrData(cfrRes.data || null);
    setRiskForYear(riskRes ? { year: f.year, rows: riskRes.data?.choropleth || [] } : null);
    setScopedKey(key);
    return [outcomesRes, demoRes, statusRes, tsrRes, cfrRes].some((r) => r.ok);
  }, [settle]);

  const loadAll = useCallback(async () => {
    setError(null);
    // Settle every request independently; nothing here can reject.
    const [monthlyRes, forecastsRes, alertsRes, riskRes, pipelineRes, freshRes, scopedOk] =
      await Promise.all([
        settle('/api/tb/dashboard/monthly'),
        settle('/api/tb/forecasts'),
        // Recent Alerts shows unresolved ALERTS only — not notifications
        // (e.g. "Forecast Generated") and not already-resolved alerts. The
        // response's pagination.total is the true unresolved count; the
        // rows are the newest ones (enough to scope by barangay on the client).
        settle('/api/tb/alerts?type=alert&status=unread&limit=100'),
        settle('/api/tb/gis/choropleth'),
        settle('/api/tb/pipeline/status'),
        settle('/api/tb/data-freshness'),
        loadScoped(filtersRef.current),
      ]);

    baseRiskFailed.current = !riskRes.ok;
    setFailed((prev) => ({
      ...prev,
      monthly: !monthlyRes.ok,
      forecasts: !forecastsRes.ok,
      alerts: !alertsRes.ok,
      risk: filtersRef.current.year ? prev.risk : !riskRes.ok,
      pipeline: !pipelineRes.ok,
      freshness: !freshRes.ok,
    }));

    setMonthlyAll(monthlyRes.data?.monthly || []);
    setForecastsAll(forecastsRes.data?.forecasts || []);
    setAlertsAll(alertsRes.data?.alerts || []);
    setAlertsTotal(alertsRes.data?.pagination?.total ?? null);
    setRiskAll(riskRes.data?.choropleth || []);
    setPipelineStatus(pipelineRes.data?.latest_run || null);
    setFreshness(freshRes.data || null);

    // Only a total outage is a page-level error: if nothing at all loaded
    // there is genuinely nothing to show. A partial failure keeps the page
    // and degrades the affected cards individually. (scopedOk is null when a newer
    // filter change superseded the request — not an outage.)
    const anyOk = [monthlyRes, forecastsRes, riskRes, alertsRes, freshRes].some((r) => r.ok)
      || scopedOk !== false;
    if (!anyOk) {
      setError('Dashboard data could not be retrieved. Please try again.');
    }
    setLoading(false);
  }, [settle, loadScoped]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    loadAll();
    handleGenerateDashboardInsight();
  }, [loadAll, handleGenerateDashboardInsight]);

  // A filter change re-requests only the server-side figures. The first run is skipped:
  // loadAll already requested them for the starting filter.
  useEffect(() => {
    if (requestedKey.current === filterKey) return;
    loadScoped(filtersRef.current);
  }, [filterKey, loadScoped]);

  /* ── Scoped views of the data (what the cards and KPIs below actually read) ── */
  const monthlyData = useMemo(
    () => scopeMonthly(monthlyAll, { year: filters.year, barangays: scopeNames }),
    [monthlyAll, filters.year, scopeNames]
  );
  const riskSource = filters.year && riskForYear?.year === filters.year ? riskForYear.rows : riskAll;
  const riskData = useMemo(() => scopeByBarangay(riskSource, scopeNames, 'name'), [riskSource, scopeNames]);
  const forecastsData = useMemo(() => scopeByBarangay(forecastsAll, scopeNames), [forecastsAll, scopeNames]);
  const outcomesData = useMemo(() => scopeByBarangay(outcomesAll, scopeNames), [outcomesAll, scopeNames]);
  const demographicsData = useMemo(() => scopeByBarangay(demographicsAll, scopeNames), [demographicsAll, scopeNames]);
  const alertsData = useMemo(() => scopeByBarangay(alertsAll, scopeNames), [alertsAll, scopeNames]);
  const highlightSet = useMemo(
    () => (scopeNames ? new Set(scopeNames.map(normName)) : null),
    [scopeNames]
  );

  // Suggestions come from the UNFILTERED data so they do not change as filters are applied.
  const recommendations = useMemo(
    () => recommendFilters({ monthly: monthlyAll, risk: riskAll, forecasts: forecastsAll }),
    [monthlyAll, riskAll, forecastsAll]
  );
  const yearOptions = useMemo(() => dataYears(monthlyAll), [monthlyAll]);
  const barangayOptions = useMemo(() => barangayNames(monthlyAll, riskAll), [monthlyAll, riskAll]);
  const updatingFilters = scopedKey !== null && scopedKey !== filterKey;

  const toggleRecommendation = useCallback((rec) => {
    setFilters((f) => (rec.kind === 'year'
      ? { ...f, year: f.year === rec.year ? '' : rec.year }
      : {
        ...f,
        scope: f.scope?.key === rec.key
          ? null
          : { mode: 'preset', key: rec.key, label: rec.label, barangays: rec.barangays },
      }));
  }, []);
  const changeYear = useCallback((year) => setFilters((f) => ({ ...f, year })), []);
  const changeBarangay = useCallback((name) => {
    if (name === '__group__') return;
    setFilters((f) => ({
      ...f,
      scope: name ? { mode: 'manual', key: 'manual', label: name, barangays: [name] } : null,
    }));
  }, []);
  const clearFilters = useCallback(() => setFilters({ year: '', scope: null }), []);

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

  const totalBarangays = scopeNames ? scopeNames.length : (riskData.length || 30);

  /* ── 5. Forecasted Cases ── */
  // Latest month with recorded cases (unfiltered): the forecast month is the first one after it.
  const anchorMonth = useMemo(() => monthlyAll.reduce((max, r) => (r.month > max ? r.month : max), ''), [monthlyAll]);
  const forecastSummary = useMemo(() => summarizeForecast(forecastsData, monthlyData, anchorMonth), [forecastsData, monthlyData, anchorMonth]);
  const forecastAvailable = Boolean(forecastSummary.period && forecastSummary.tier !== 'insufficient_data');
  // The overall insight panel always describes the whole city, whatever filter is applied.
  const forecastSummaryCity = useMemo(() => summarizeForecast(forecastsAll, monthlyAll, anchorMonth), [forecastsAll, monthlyAll, anchorMonth]);

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

  const cityMonitoringPeriod = useMemo(() => {
    const months = monthlyAll.map((r) => r.month).filter(Boolean).sort();
    const last = months[months.length - 1];
    if (!last) return '';
    try { return new Date(last).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); } catch { return ''; }
  }, [monthlyAll]);

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
  const topBarangays = useMemo(() => topBarangayRanking(monthlyData, riskData, 5), [monthlyData, riskData]);

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
        createdAt: a.created_at || null,
      };
    });
  }, [alertsData, now]);

  // Unresolved alerts inside the current filter (all of them when no barangay filter is on).
  const alertsCount = scopeNames ? alertsData.length : alertsTotal;

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
      {monthlyAll.length === 0 && forecastsAll.length === 0 && alertsAll.length === 0 ? (
        <div className="flex flex-col items-center justify-center border border-[#E2E8F0] bg-white px-6 py-20 text-center">
          <div className="text-center">
            <p className="text-sm font-semibold text-[#0F2D52]">{failed.monthly && failed.forecasts && failed.alerts ? 'Dashboard data could not be loaded' : 'No dashboard data yet'}</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-[#64748B]">
              {failed.monthly && failed.forecasts && failed.alerts
                ? 'Please try loading the dashboard again.'
                : 'Import TB records to see trends, risk classifications, forecasts, and alerts here.'}
            </p>
            {failed.monthly && failed.forecasts && failed.alerts && (
              <button type="button" onClick={handleRefresh} className="mt-4 text-xs font-semibold text-[#0F2D52] hover:underline">Retry</button>
            )}
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
                  {failed.monthly ? 'Could not be loaded' : `${totalCases.months} months recorded${filtersActive ? ' in this view' : ' (all-time)'}`}
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

              {/* City Risk Classification */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-alarm-warning-line text-sm" style={{ color: '#C4886A' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>City Risk Classification</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                  {failed.risk ? 'Unavailable' : highRiskCount == null ? 'N/A' : animatedHighRisk}
                </p>
                <span
                  className="text-[11px] font-medium mt-1"
                  style={{ color: '#94A3B8' }}
                  title="This represents the number of Pasig barangays classified as High Risk by the risk-classification model for the selected assessment period."
                >
                  {failed.risk
                    ? 'Risk classification could not be loaded'
                    : highRiskCount == null
                      ? 'No risk assessment available yet'
                      : `of ${totalBarangays} barangays classified as High Risk`}
                </span>
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
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }} title={forecastSummary.methodNote || undefined}>
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

          {/* ─── Recommended Filters ─── */}
          <RecommendedFilters
            recommendations={recommendations}
            filters={filters}
            yearOptions={yearOptions}
            barangayOptions={barangayOptions}
            view={{
              cases: totalCases.total,
              barangays: new Set(monthlyData.map((r) => r.barangay_name)).size,
              totalBarangays: barangayOptions.length || 30,
            }}
            updating={updatingFilters}
            onToggle={toggleRecommendation}
            onYearChange={changeYear}
            onBarangayChange={changeBarangay}
            onClear={clearFilters}
          />

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
            monitoringPeriod={cityMonitoringPeriod}
            forecastSummary={forecastSummaryCity}
          />

          {/* ─── 4. TB Cases Trend + 5. Barangay Risk Overview ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* TB Cases Trend */}
            <SectionCard
              title="TB case trend"
              insight={trendInsight(trendChartData, { valueKey: 'cases' })}
              description="Monthly tuberculosis cases based on recorded TB data."
              action="View analytics"
              actionTo="/analytics"
            >
              {failed.monthly ? (
                <p className="py-14 text-center text-xs text-[#991B1B]">Trend data could not be loaded.</p>
              ) : trendChartData.length > 0 ? (
                <div className="w-full">
                  <div className="h-[260px] w-full" role="img" aria-label="Monthly reported TB cases line chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendChartData} margin={{ top: 10, right: 15, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#E8EDF2" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} tickMargin={8} minTickGap={18} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} width={42} tickMargin={4} />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#E2E8F0', strokeWidth: 1 }} />
                      <Line type="monotone" dataKey="cases" stroke="#2E6FAF" strokeWidth={2} dot={{ r: 2.5, fill: '#2E6FAF', strokeWidth: 0 }} activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }} name="Cases" connectNulls={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  </div>
                  {missingMonthCount > 0 && (
                    <p className="mt-2 text-[11px] text-[#64748B]">
                      {missingMonthCount} month{missingMonthCount === 1 ? '' : 's'} in this span
                      have no reported records and are shown as a gap, not as zero cases.
                    </p>
                  )}
                </div>
              ) : (
                <p className="py-14 text-center text-xs text-[#64748B]">No trend data is available for this view.</p>
              )}
            </SectionCard>

            {/* Barangay Risk Overview — GIS Map */}
            <SectionCard
              title="Barangay risk overview"
              insight={riskInsight(riskData)}
              description="Current risk classification across Pasig City barangays."
              action="View GIS map"
              actionTo="/gis-map"
            >
              <div className="relative overflow-hidden border border-[#E2E8F0]">
                <MiniGisMap refreshKey={refreshCount} highlight={highlightSet} />
              </div>
              {/* Risk legend */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-[#64748B]">
                <span className="font-medium text-[#475569]">Risk level:</span>
                {[
                  { level: 'Low', color: GIS_RISK_COLORS.Low },
                  { level: 'Moderate', color: GIS_RISK_COLORS.Medium },
                  { level: 'High', color: GIS_RISK_COLORS.High },
                  { level: 'No assessment', color: GIS_RISK_COLORS['No Data'] },
                ].map((r) => (
                  <span key={r.level} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5" style={{ background: r.color }} aria-hidden="true" />
                    {r.level}
                  </span>
                ))}
              </div>
            </SectionCard>
          </div>

          {/* ─── 6. Top Priority Barangays + Treatment Outcomes ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top High-Risk Barangays */}
            <SectionCard
              title="Priority barangays"
              insight={topBarangays[0]
                ? `${topBarangays[0].name} ranks first (${topBarangays[0].risk ? `${topBarangays[0].risk} risk` : 'no risk assessment yet'}, ${Number(topBarangays[0].cases || 0).toLocaleString('en-US')} recorded cases). Barangays are ordered by risk level first, then by recorded cases.`
                : null}
              description="Ordered by risk level, then by recorded TB cases."
              action="View GIS map"
              actionTo="/gis-map"
            >
              {failed.risk && failed.monthly ? (
                <p className="py-14 text-center text-xs text-[#991B1B]">Barangay risk data could not be loaded.</p>
              ) : topBarangays.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ minWidth: 380 }}>
                    <thead>
                      <tr className="bg-[#0F2D52]">
                        {['Rank', 'Barangay', 'TB Cases', 'Risk Level'].map((h) => (
                          <th key={h} scope="col" className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-white ${h === 'TB Cases' ? 'text-right' : 'text-left'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {topBarangays.map((row) => (
                        <tr key={row.name} className="border-b border-[#E8EDF2] last:border-0">
                          <td className="px-4 py-3 text-xs tabular-nums text-[#64748B]">{row.rank}</td>
                          <td className="px-4 py-3 text-xs font-medium text-[#0F2D52]">{row.name}</td>
                          <td className="px-4 py-3 text-right text-xs tabular-nums text-[#334155]">{row.cases.toLocaleString()}</td>
                          <td className="px-4 py-3"><RiskBadge risk={row.risk || 'No Assessment'} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-14 text-center text-xs text-[#64748B]">No barangay risk data is available for this view.</p>
              )}
            </SectionCard>

            {/* Age Group Distribution */}
            <SectionCard
              title="Age distribution"
              insight={shareInsight(ageData, { nameKey: 'age_group', valueKey: 'total', noun: 'age group' })}
              description="TB cases by age group."
            >
              {failed.demographics ? (
                <p className="py-14 text-center text-xs text-[#991B1B]">Age data could not be loaded.</p>
              ) : ageData.length > 0 ? (
                <div className="space-y-3 pt-1">
                  {(() => {
                    const maxTotal = Math.max(...ageData.map(a => a.total), 1);
                    return ageData.map((item) => {
                      const pct = ((item.total / maxTotal) * 100).toFixed(0);
                      return (
                        <div key={item.age_group} className="flex items-center gap-3">
                          <span className="w-12 shrink-0 text-[11px] font-medium text-[#475569]">{item.age_group}</span>
                          <div className="h-3 flex-1 bg-[#E8EDF2]" role="img" aria-label={`${item.age_group}: ${item.total.toLocaleString()} cases`}>
                            <div className="h-full rounded-r-md bg-[#2E6FAF]" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-12 shrink-0 text-right text-[11px] font-semibold tabular-nums text-[#0F2D52]">{item.total.toLocaleString()}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : (
                <p className="py-14 text-center text-xs text-[#64748B]">No age data is available for this view.</p>
              )}
            </SectionCard>
          </div>

          {/* ─── 7. Demographics — Sex + Treatment Outcomes ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sex Distribution */}
            <SectionCard
              title="Sex distribution"
              insight={shareInsight(Object.entries(sexData).map(([name, value]) => ({ name, value })), { noun: 'sex' })}
              description="Male vs female TB case distribution."
            >
              {failed.demographics ? (
                <p className="py-14 text-center text-xs text-[#991B1B]">Sex distribution could not be loaded.</p>
              ) : (sexData.Male + sexData.Female) > 0 ? (
                <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
                  <div className="relative h-[160px] w-[160px] shrink-0" role="img" aria-label={`Male: ${sexData.Male.toLocaleString()} cases; Female: ${sexData.Female.toLocaleString()} cases`}>
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
                          paddingAngle={1}
                          dataKey="value"
                          isAnimationActive={false}
                        >
                          <Cell fill="#2E6FAF" />
                          <Cell fill="#94A3B8" />
                        </Pie>
                        <Tooltip formatter={(value) => value.toLocaleString()} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-lg font-semibold tabular-nums text-[#0F2D52]">{(sexData.Male + sexData.Female).toLocaleString()}</span>
                      <span className="text-[10px] text-[#64748B]">cases</span>
                    </div>
                  </div>
                  <div className="min-w-[170px] space-y-2">
                    {[
                      { label: 'Male', value: sexData.Male, color: '#2E6FAF' },
                      { label: 'Female', value: sexData.Female, color: '#94A3B8' },
                    ].map((item) => {
                      const total = sexData.Male + sexData.Female;
                      const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : 0;
                      return (
                        <div key={item.label} className="flex items-center gap-2 text-xs">
                          <span className="h-2.5 w-2.5 shrink-0" style={{ background: item.color }} aria-hidden="true" />
                          <span className="flex-1 text-[#475569]">{item.label}</span>
                          <span className="font-semibold tabular-nums text-[#0F2D52]">{item.value.toLocaleString()}</span>
                          <span className="w-11 text-right tabular-nums text-[#64748B]">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="py-14 text-center text-xs text-[#64748B]">No sex distribution data is available for this view.</p>
              )}
            </SectionCard>

            {/* Treatment Outcomes */}
            <SectionCard
              title="Treatment outcomes and case status"
              insight={outcomeInsight(outcomeChartData, {
                nameKey: 'outcome',
                valueKey: 'count',
                scope: filtersActive ? 'recorded outcomes in this view' : 'recorded outcomes across all years',
                note: 'The Treatment Success Rate above is measured on a single treatment-start year, so the two figures differ.',
              })}
              description="Final treatment outcomes, with cases still diagnosed or on treatment shown separately."
              action="View analytics"
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
                  plain
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
            <SectionCard
              title="Forecast summary"
              description={forecastAvailable ? `Next forecast period: ${forecastSummary.period}` : forecastSummary.tier === 'insufficient_data' ? 'Insufficient case history for a forecast.' : 'No forecast is available yet.'}
              action="View forecast"
              actionTo="/forecasting"
            >
              {failed.forecasts ? (
                <p className="py-14 text-center text-xs text-[#991B1B]">Forecast data could not be loaded.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#E2E8F0] pb-4">
                    <div>
                      <p className="text-[11px] text-[#64748B]">Forecasted TB cases</p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums text-[#0F2D52]">{forecastAvailable ? forecastSummary.total.toLocaleString() : 'N/A'}</p>
                    </div>
                    {forecastSummary.periodCount > 1 && <p className="text-[11px] text-[#64748B]">First of {forecastSummary.periodCount} forecast months</p>}
                  </div>
                  <dl className="grid grid-cols-1 gap-x-5 gap-y-3 py-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-[11px] text-[#64748B]">Method</dt>
                      <dd className="mt-0.5 text-xs font-medium text-[#0F2D52]">{forecastSummary.tierLabel || 'N/A'}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-[#64748B]">Change vs monthly average</dt>
                      <dd className="mt-0.5 text-xs font-medium tabular-nums" style={{ color: forecastAvailable ? (forecastSummary.growthRate > 0 ? '#991B1B' : '#047857') : '#0F2D52' }}>
                        {forecastAvailable ? `${forecastSummary.growthRate >= 0 ? '+' : ''}${forecastSummary.growthRate.toFixed(1)}%` : 'N/A'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-[#64748B]">Predominant barangay risk (RF)</dt>
                      <dd className="mt-0.5 text-xs font-medium text-[#0F2D52]">{forecastSummary.riskLevel === 'No Data' ? 'No assessment' : forecastSummary.riskLevel}</dd>
                    </div>
                  </dl>
                  {forecastSummary.methodNote && <p className="mb-3 text-[11px] leading-relaxed text-[#64748B]">{forecastSummary.methodNote}</p>}
                  {forecastAvailable && forecastChartData.length > 1 && (
                    <div className="border-t border-[#E2E8F0] pt-4">
                      <p className="text-[11px] font-medium text-[#475569]">Reported and forecasted cases</p>
                      <div className="mt-2 h-[170px] w-full" role="img" aria-label="Reported and forecasted TB cases line chart">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={forecastChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid vertical={false} stroke="#E8EDF2" />
                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} tickMargin={6} minTickGap={14} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} width={40} tickMargin={4} />
                            <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#E2E8F0', strokeWidth: 1 }} />
                            <Line type="monotone" dataKey="actual" stroke="#2E6FAF" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Reported" connectNulls={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="projected" stroke="#0D9488" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3, fill: '#0D9488', strokeWidth: 0 }} activeDot={{ r: 4 }} name="Forecasted" connectNulls={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-[#64748B]">
                        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#2E6FAF]" aria-hidden="true" />Reported</span>
                        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-[#0D9488]" aria-hidden="true" />Forecasted</span>
                      </div>
                      <ChartInsight text={forecastInsight(forecastChartData, { actualKey: 'actual', forecastKey: 'projected', methodLabel: forecastSummary.tierLabel })} plain />
                    </div>
                  )}
                </>
              )}
            </SectionCard>

            {/* Recent Alerts */}
            <SectionCard
              title="Recent alerts"
              description={
                failed.alerts
                  ? 'Alerts could not be loaded'
                  : alertsCount == null
                    ? 'Unresolved alerts'
                    : `${alertsCount} unresolved alert${alertsCount !== 1 ? 's' : ''}${
                        scopeNames && alertsTotal > alertsAll.length ? ` among the latest ${alertsAll.length}` : ''
                      }${alertsCount > recentAlerts.length ? ` — showing the latest ${recentAlerts.length}` : ''}`
              }
              action="View all alerts"
              actionTo="/alert"
            >
              {failed.alerts ? (
                <p className="py-14 text-center text-xs text-[#991B1B]">Alerts could not be loaded.</p>
              ) : recentAlerts.length > 0 ? (
                <ul className="divide-y divide-[#E8EDF2]">
                  {recentAlerts.map((alert, idx) => (
                    <li key={alert.id || idx} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs font-semibold leading-snug text-[#0F2D52]">{alert.title}</p>
                        <time dateTime={alert.createdAt || undefined} className="shrink-0 text-[11px] text-[#64748B]">{alert.time}</time>
                      </div>
                      {alert.message && <p className="mt-1 text-xs leading-relaxed text-[#475569]">{alert.message}</p>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                        {alert.barangay && <span className="text-[#64748B]">{alert.barangay}</span>}
                        <span className="font-medium" style={{ color: alert.isCritical ? '#991B1B' : ['WARNING', 'MEDIUM'].includes(alert.severity) ? '#92400E' : '#64748B' }}>
                          Severity: {alert.severity.charAt(0) + alert.severity.slice(1).toLowerCase()}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-14 text-center text-xs text-[#64748B]">No unresolved alerts at this time.</p>
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}
