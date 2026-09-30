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
import TreatmentCascadeCard from '../components/TreatmentCascadeCard';
import { getDashboardInsight } from '../services/insightService';

/* ─── Constants ──────────────────────────────────────────────────────── */

const RISK_COLORS = {
  Low: '#10B981',
  Moderate: '#F59E0B',
  Medium: '#F59E0B',
  High: '#EF4444',
  'No Data': '#94A3B8',
};

const OUTCOME_COLORS = {
  'CURED': '#2a78d6',
  'TREATMENT COMPLETED': '#eb6834',
  'ON TREATMENT': '#1baf7a',
  'FAILED': '#eda100',
  'DIED': '#e87ba4',
  'LOST TO FF-UP': '#008300',
  'EXCLUDED': '#4a3aa7',
  'DIAGNOSED': '#0369A1',
  'NOT EVALUATED': '#94A3B8',
};

const OUTCOME_ORDER = [
  'CURED', 'TREATMENT COMPLETED', 'ON TREATMENT', 'FAILED',
  'DIAGNOSED', 'NOT EVALUATED', 'DIED', 'LOST TO FF-UP', 'EXCLUDED',
];

const GIS_RISK_COLORS = {
  High: '#991B1B',
  Medium: '#B45309',
  Low: '#854D0E',
  'No Data': '#64748B',
};

const PASIG_BOUNDS = L.latLngBounds([14.48, 121.02], [14.64, 121.13]);

const RISK_PRIORITY = { High: 3, Medium: 2, Moderate: 2, Low: 1, 'No Data': 0 };

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
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: bg }}>
      {risk}
    </span>
  );
}

function SectionCard({ title, iconColor, description, action, actionTo, children }) {
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
      <div className="px-5 pb-5">{children}</div>
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
  const [lastUpdatedDate, setLastUpdatedDate] = useState(null);
  const [monthlyData, setMonthlyData] = useState([]);
  const [outcomesData, setOutcomesData] = useState([]);
  const [tsrData, setTsrData] = useState(null);
  const [cfrData, setCfrData] = useState(null);
  const [forecastsData, setForecastsData] = useState([]);
  const [alertsData, setAlertsData] = useState([]);
  const [riskData, setRiskData] = useState([]);
  const [riskYear, setRiskYear] = useState(null);
  const [barangays, setBarangays] = useState([]);
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [demographicsData, setDemographicsData] = useState([]);
  const [cascadeData, setCascadeData] = useState(null);

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

  /* ── Data fetching ── */
  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [summaryRes, monthlyRes, outcomesRes, forecastsRes, alertsRes, riskRes, brgyRes, pipelineRes, demoRes, cascadeRes, tsrRes, cfrRes] =
        await Promise.all([
          API.get('/api/tb/dashboard/summary'),
          API.get('/api/tb/dashboard/monthly'),
          API.get('/api/tb/dashboard/outcomes'),
          API.get('/api/tb/forecasts'),
          API.get('/api/tb/alerts').catch(() => ({ data: { alerts: [] } })),
          API.get('/api/tb/gis/choropleth').catch(() => ({ data: { choropleth: [] } })),
          API.get('/api/tb/barangays').catch(() => ({ data: { barangays: [] } })),
          API.get('/api/tb/pipeline/status').catch(() => ({ data: { latest_run: null } })),
          API.get('/api/tb/dashboard/demographics').catch(() => ({ data: { demographics: [] } })),
          API.get('/api/tb/treatment-cascade').catch(() => ({ data: null })),
          // Unfiltered (no year/barangay) — Dashboard is an overview page —
          // which defaults to the current-year Y-1 cohort, the same default
          // /dashboard/metrics used before this endpoint existed.
          API.get('/api/tb/treatment-success-rate').catch(() => ({ data: null })),
          API.get('/api/tb/case-fatality-rate').catch(() => ({ data: null })),
        ]);
      setLastUpdatedDate(summaryRes.data.summary?.latest_date || null);
      setMonthlyData(monthlyRes.data.monthly || []);
      setOutcomesData(outcomesRes.data.outcomes || []);
      setForecastsData(forecastsRes.data.forecasts || []);
      setAlertsData(alertsRes.data.alerts || []);
      setRiskData(riskRes.data.choropleth || []);
      setRiskYear(riskRes.data.year || null);
      setBarangays(brgyRes.data.barangays || []);
      setPipelineStatus(pipelineRes.data.latest_run || null);
      setDemographicsData(demoRes.data.demographics || []);
      setCascadeData(cascadeRes.data || null);
      setTsrData(tsrRes.data || null);
      setCfrData(cfrRes.data || null);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Dashboard fetch error:', err);
      setError('Dashboard data could not be retrieved. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    loadAll();
    handleGenerateDashboardInsight();
  }, [loadAll, handleGenerateDashboardInsight]);

  /* ── Refresh handler ── */
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshCount((c) => c + 1);
    await Promise.all([
      loadAll(),
      handleGenerateDashboardInsight(),
    ]);
    setRefreshing(false);
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
   * metric that disagreed with the AI-generated insight text on this same
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

  /* ── 5. Forecasted Cases ── */
  const forecastSummary = useMemo(() => {
    if (!forecastsData.length) return { total: 0, period: '', growthRate: 0, riskLevel: 'N/A' };
    const latestPeriod = forecastsData.reduce((max, r) => (r.period > max ? r.period : max), '');
    if (!latestPeriod) return { total: 0, period: '', growthRate: 0, riskLevel: 'N/A' };
    const latest = forecastsData.filter((r) => r.period === latestPeriod);
    const total = latest.reduce((s, r) => s + Math.round(Number(r.forecasted_count || 0)), 0);

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

    // Risk level: majority across barangays
    const riskCounts = {};
    latest.forEach((r) => {
      const rc = r.risk_class || 'Low';
      riskCounts[rc] = (riskCounts[rc] || 0) + 1;
    });
    let majorityRisk = 'Low';
    let maxCount = 0;
    for (const [cls, cnt] of Object.entries(riskCounts)) {
      if (cnt > maxCount) { maxCount = cnt; majorityRisk = cls; }
    }

    const periodLabel = new Date(latestPeriod).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return { total, period: periodLabel, growthRate, riskLevel: majorityRisk };
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
    const byPeriod = {};
    forecastsData.forEach((r) => {
      if (!r.period) return;
      byPeriod[r.period] = (byPeriod[r.period] || 0) + Math.round(Number(r.forecasted_count || 0));
    });
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

  /* ── TB Cases Trend chart data ── */
  const trendChartData = useMemo(() => {
    const byMonth = {};
    monthlyData.forEach((r) => {
      if (!byMonth[r.month]) byMonth[r.month] = 0;
      byMonth[r.month] += Number(r.case_count || 0);
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, cases]) => {
        const d = new Date(month);
        return { label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), cases, month };
      });
  }, [monthlyData]);

  /* ── Top Priority Barangays ── */
  const topBarangays = useMemo(() => {
    if (!monthlyData.length && !forecastsData.length) return [];
    // Combine case counts with risk scores
    const byBarangay = {};
    monthlyData.forEach((r) => {
      if (!r.barangay_name) return;
      if (!byBarangay[r.barangay_name]) byBarangay[r.barangay_name] = { name: r.barangay_name, cases: 0 };
      byBarangay[r.barangay_name].cases += Number(r.case_count || 0);
    });
    // Add risk from choropleth (current risk status) first
    riskData.forEach((r) => {
      if (!byBarangay[r.name]) byBarangay[r.name] = { name: r.name, cases: 0 };
      byBarangay[r.name].risk = r.risk_class || 'No Data';
      byBarangay[r.name].score = Number(r.risk_score || 0);
    });
    // Also try forecasts for latest historical period risk (more recent than choropleth)
    if (forecastsData.length > 0) {
      forecastsData.forEach((r) => {
        if (!byBarangay[r.barangay_name]) byBarangay[r.barangay_name] = { name: r.barangay_name, cases: 0 };
        // Only update risk if the forecast period has a risk_class
        if (r.risk_class && (!byBarangay[r.barangay_name].risk || byBarangay[r.barangay_name].risk === 'No Data')) {
          byBarangay[r.barangay_name].risk = r.risk_class;
        }
      });
    }
    // Fallback: if no barangay has a meaningful risk class OR all have the same class, compute from monthly + population
    const riskValues = Object.values(byBarangay).map((b) => b.risk).filter(Boolean);
    const uniqueRisks = new Set(riskValues);
    const hasMeaningfulRisk = uniqueRisks.size > 1 && !uniqueRisks.has('No Data');
    if (!hasMeaningfulRisk && barangays.length > 0) {
      const popMap = {};
      barangays.forEach((b) => { popMap[b.barangay_name || b.name] = b.population || 0; });
      const entries = Object.values(byBarangay).map((b) => {
        const pop = popMap[b.name] || 1;
        return { name: b.name, incidence: (b.cases / pop) * 100000 };
      });
      entries.sort((a, b) => a.incidence - b.incidence);
      const n = entries.length;
      if (n > 0) {
        const lowMax = Math.floor(n / 3);
        const medMax = Math.floor((2 * n) / 3);
        const riskMap = {};
        entries.forEach((e, i) => {
          riskMap[e.name] = i < lowMax ? 'Low' : i < medMax ? 'Medium' : 'High';
        });
        const maxInc = entries[n - 1].incidence || 1;
        Object.values(byBarangay).forEach((b) => {
          const inc = ((b.cases || 0) / ((popMap[b.name] || 1))) * 100000;
          b.risk = riskMap[b.name] || 'Low';
          b.score = Math.round((inc / maxInc) * 100 * 100) / 100;
        });
      }
    }
    return Object.values(byBarangay)
      .sort((a, b) => {
        const rpA = RISK_PRIORITY[a.risk] ?? 0;
        const rpB = RISK_PRIORITY[b.risk] ?? 0;
        if (rpB !== rpA) return rpB - rpA;
        return (b.score || b.cases) - (a.score || a.cases);
      })
      .slice(0, 5)
      .map((b, i) => ({ rank: i + 1, ...b }));
  }, [monthlyData, forecastsData, riskData, barangays]);

  /* ── Treatment Outcomes chart data ── */
  const outcomeChartData = useMemo(() => {
    const byStatus = {};
    outcomesData.forEach((r) => {
      const raw = (r.outcome_status || 'Unknown').toUpperCase();
      // Map DB variants to source-aligned display form
      const st = raw === 'TREATMENT FAILED' ? 'FAILED'
        : raw === 'LOST TO FOLLOW-UP' ? 'LOST TO FF-UP'
        : raw;
      if (!OUTCOME_ORDER.includes(st)) return; // exclude SCREENED etc.
      byStatus[st] = (byStatus[st] || 0) + Number(r.total || 0);
    });
    return OUTCOME_ORDER
      .filter((st) => byStatus[st])
      .map((st) => ({ outcome: st, count: byStatus[st], color: OUTCOME_COLORS[st] || '#94A3B8' }));
  }, [outcomesData]);

  /* ── Recent Alerts ── */
  const recentAlerts = useMemo(() => {
    return alertsData.slice(0, 5).map((a) => {
      const severity = (a.severity || 'Medium').toUpperCase();
      const createdAt = a.created_at ? new Date(a.created_at) : null;
      let timeLabel = '';
      if (createdAt) {
        const now = new Date();
        const diffMs = now - createdAt;
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
        type: a.type || 'alert',
        title: a.title || a.alert_type || 'Alert',
        message: a.message || '',
        barangay: a.barangay_name || '',
        time: timeLabel,
      };
    });
  }, [alertsData]);

  /* ── Last Updated ── */
  const lastUpdated = useMemo(() => {
    if (pipelineStatus?.trained_at) return new Date(pipelineStatus.trained_at);
    if (lastUpdatedDate) return new Date(lastUpdatedDate);
    return null;
  }, [pipelineStatus, lastUpdatedDate]);

  /* ── Relative time since last update ──
   * `now` is state updated on an interval (not Date.now() called directly
   * during render, which is an impure render call) so the "X ago" label
   * actually advances over time instead of freezing at first render. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const lastUpdatedRelative = useMemo(() => {
    if (!lastUpdated) return '';
    const diffMs = now - lastUpdated.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 30) return `${diffDays} days ago`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}mo ago`;
  }, [lastUpdated, now]);

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
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{animatedTotalCases.toLocaleString()}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{totalCases.months} months recorded (all-time)</span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* New Cases (latest recorded month) */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-calendar-check-line text-sm" style={{ color: '#B8956A' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>New Cases</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{animatedNewCases.toLocaleString()}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>{monitoringPeriodLabel || 'No data yet'}</span>
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
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{successRate.rate == null ? 'N/A' : `${animatedSuccessRate}%`}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>
                  {successRate.evaluated.toLocaleString()} patients{successRate.cohortYear ? ` (${successRate.cohortYear} cohort)` : ''}
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
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{caseFatalityRate.rate == null ? 'N/A' : `${animatedFatalityRate}%`}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{caseFatalityRate.died} deaths / {caseFatalityRate.evaluated} evaluated</span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* High-Risk Barangays */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-alarm-warning-line text-sm" style={{ color: '#C4886A' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>High-Risk</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{highRiskCount == null ? 'N/A' : `${animatedHighRisk}/30`}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>
                  Barangays requiring attention{riskYear ? ` (${riskYear} assessment)` : ''}
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
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{animatedForecasted.toLocaleString()}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{forecastSummary.period ? `${forecastSummary.period} forecast` : 'No forecast available'}</span>
              </div>
            </div>
          </div>

          {/* ─── Welcome + NLG Overall Insights Section ─── */}
          <DashboardWelcomeInsightsSection
            user={user}
            lastUpdated={lastUpdated}
            lastUpdatedRelative={lastUpdatedRelative}
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
              iconColor="#6B7FA3"
              description="Monthly tuberculosis cases based on recorded TB data."
              action="View Analytics"
              actionTo="/analytics"
            >
              {trendChartData.length > 0 ? (
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
                      <Area type="monotone" dataKey="cases" stroke="#2563EB" strokeWidth={2.5} fill="url(#trendGrad)" dot={{ fill: '#2563EB', r: 3.5, strokeWidth: 2, stroke: '#ffffff' }} activeDot={{ r: 5, strokeWidth: 2, stroke: '#ffffff' }} name="Cases" />
                    </AreaChart>
                  </ResponsiveContainer>
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
              iconColor="#6B7280"
              description="Barangays with the highest recorded TB burden and risk classification."
              action="View GIS Hotspots"
              actionTo="/gis-map"
            >
              {topBarangays.length > 0 ? (
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
                          <td className="px-4 py-3"><RiskBadge risk={row.risk || 'Low'} /></td>
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
              iconColor="#6B7280"
              description="TB cases by age group."
            >
              {ageData.length > 0 ? (
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

          {/* ─── Treatment Cascade (shared backend calculation) ─── */}
          <TreatmentCascadeCard data={cascadeData} loading={loading} />

          {/* ─── 7. Demographics — Sex + Treatment Outcomes ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sex Distribution */}
            <SectionCard
              title="Demographics — Sex Distribution"
              iconColor="#3B82F6"
              description="Male vs female TB case distribution."
            >
              {(sexData.Male + sexData.Female) > 0 ? (
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
              title="Case Status / Outcome Distribution"
              iconColor="#10B981"
              description="Distribution of reported TB records by the Outcome/Status values recorded in the source data."
              action="View Analytics"
              actionTo="/analytics"
            >
              {outcomeChartData.length > 0 ? (
                <div className="flex items-center justify-center gap-6">
                  <div className="w-[180px] h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={outcomeChartData.map(e => ({ name: e.outcome, value: e.count }))}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={80}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {outcomeChartData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => value.toLocaleString()} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1.5">
                    {outcomeChartData.map((entry) => (
                      <div key={entry.outcome} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: entry.color }} />
                        <span className="text-[10px] font-medium" style={{ color: '#64748B' }}>
                          {entry.outcome?.length > 16 ? entry.outcome.slice(0, 14) + '...' : entry.outcome}
                        </span>
                        <span className="text-[10px] font-bold" style={{ color: '#0F2D52' }}>{entry.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <i className="ri-pie-chart-2-line text-xl" style={{ color: '#CBD5E1' }} />
                  <p className="text-xs" style={{ color: '#94A3B8' }}>No outcome data available.</p>
                </div>
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
                    <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>Forecasted TB cases for the next quarter</p>
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
                    { label: 'Forecasted Cases', value: forecastSummary.total.toLocaleString(), valueColor: '#0F2D52' },
                    { label: 'Growth Rate', value: `${forecastSummary.growthRate >= 0 ? '+' : ''}${forecastSummary.growthRate.toFixed(1)}%`, valueColor: forecastSummary.growthRate >= 0 ? '#EF4444' : '#10B981' },
                    { label: 'Risk Level', value: forecastSummary.riskLevel, valueColor: RISK_COLORS[forecastSummary.riskLevel] || '#0D9488' },
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
                  </div>
                )}
              </div>
            </div>

            {/* Recent Alerts */}
            <SectionCard
              title="Recent Alerts"
              iconColor="#EF4444"
              description={`${recentAlerts.length} unresolved alert${recentAlerts.length !== 1 ? 's' : ''}`}
              action="View All Alerts"
              actionTo="/alert"
            >
              {recentAlerts.length > 0 ? (
                <div>
                  {recentAlerts.map((alert, idx) => {
                    const isCritical = alert.severity === 'CRITICAL' || alert.severity === 'HIGH';
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
                          <span className="text-[12px] font-bold" style={{ color: '#1E293B' }}>{alert.barangay}</span>
                          <span className="text-[12px] font-medium" style={{ color: '#64748B' }}> {alert.message || `reached ${alert.severity.toLowerCase()} threshold`}</span>
                        </div>

                        {/* Severity badge */}
                        <span
                          className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded shrink-0"
                          style={{ background: badgeBg, color: badgeColor }}
                        >
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
