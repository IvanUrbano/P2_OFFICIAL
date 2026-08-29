import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar, Cell, Area, AreaChart,
  CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie,
} from 'recharts';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import API from '../api/axios';
import { useTheme } from '../theme';

/* ─── Constants ──────────────────────────────────────────────────────── */

const ALL_YEARS = ['2023', '2024', '2025', '2026'];

const MONTH_OPTIONS = [
  { value: '', label: 'All Months' },
  { value: '1', label: 'January' }, { value: '2', label: 'February' },
  { value: '3', label: 'March' }, { value: '4', label: 'April' },
  { value: '5', label: 'May' }, { value: '6', label: 'June' },
  { value: '7', label: 'July' }, { value: '8', label: 'August' },
  { value: '9', label: 'September' }, { value: '10', label: 'October' },
  { value: '11', label: 'November' }, { value: '12', label: 'December' },
];

const RISK_COLORS = {
  Low: '#10B981',
  Moderate: '#F59E0B',
  Medium: '#F59E0B',
  High: '#EF4444',
  'Very High': '#DC2626',
  'No Data': '#94A3B8',
};

const OUTCOME_COLORS = {
  'CURED': '#10B981',
  'TREATMENT COMPLETED': '#3B82F6',
  'ON TREATMENT': '#F59E0B',
  'FAILED': '#EF4444',
  'DIED': '#DC2626',
  'LOST TO FOLLOW-UP': '#8B5CF6',
  'EXCLUDED': '#64748B',
  'NOT EVALUATED': '#94A3B8',
};

const OUTCOME_ORDER = ['CURED', 'TREATMENT COMPLETED', 'ON TREATMENT', 'FAILED', 'DIED', 'LOST TO FOLLOW-UP', 'EXCLUDED', 'NOT EVALUATED'];

const GIS_RISK_COLORS = {
  High: '#EF4444',
  Medium: '#F97316',
  Low: '#FBBF24',
  'No Data': '#64748B',
};

const PASIG_BOUNDS = L.latLngBounds([14.48, 121.02], [14.64, 121.13]);

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
function MiniGisMap() {
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
        labelsRef.current.forEach(l => { try { map.removeLayer(l); } catch {} });
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
  }, []);

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

function MetricCard({ icon, iconColor, title, value, subtitle, linkTo, linkLabel }) {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)' }}>
      <div className="flex flex-col px-5 py-5">
        <div className="flex items-center gap-2 mb-2">
          <i className={`${icon} text-base`} style={{ color: iconColor }} />
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>{title}</span>
        </div>
        <div className="h-px mb-3" style={{ background: '#E2E8F0' }} />
        <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{value}</p>
        {subtitle && <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{subtitle}</span>}
        {linkTo && (
          <button
            onClick={() => navigate(linkTo)}
            className="flex items-center gap-1 mt-2 text-[11px] font-semibold transition hover:underline"
            style={{ color: '#0F2D52' }}
          >
            {linkLabel || 'View'} <i className="ri-arrow-right-s-line text-sm" />
          </button>
        )}
      </div>
    </div>
  );
}

function SectionCard({ title, icon, iconColor, description, action, actionTo, children }) {
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

function SkeletonBlock({ className }) {
  return <div className={`animate-pulse rounded-lg ${className}`} style={{ background: '#E2E8F0' }} />;
}

function SkeletonCard() {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
      <div className="px-5 py-4"><SkeletonBlock className="h-4 w-32" /></div>
      <div className="px-5 pb-5"><SkeletonBlock className="h-48 w-full" /></div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none" style={{ color: '#94A3B8' }}>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg pr-7 py-[7px] text-[11px] font-semibold outline-none transition cursor-pointer appearance-none"
        style={{
          background: '#ffffff',
          color: '#0F2D52',
          border: '1px solid #E2E8F0',
          paddingLeft: `${(label.length * 6.5) + 24}px`,
        }}
      >
        {children}
      </select>
      <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style={{ color: '#64748B' }} />
    </div>
  );
}

/* ─── Main Dashboard Component ──────────────────────────────────────── */

export default function DashboardPage() {
  const { t } = useTheme();
  const navigate = useNavigate();

  /* ── State ── */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [monthlyData, setMonthlyData] = useState([]);
  const [outcomesData, setOutcomesData] = useState([]);
  const [forecastsData, setForecastsData] = useState([]);
  const [alertsData, setAlertsData] = useState([]);
  const [riskData, setRiskData] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [demographicsData, setDemographicsData] = useState([]);

  /* ── Filter state ── */
  const [filterYear, setFilterYear] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterBarangay, setFilterBarangay] = useState('');
  const [appliedYear, setAppliedYear] = useState('');
  const [appliedMonth, setAppliedMonth] = useState('');
  const [appliedBarangay, setAppliedBarangay] = useState('');

  /* ── Data fetching ── */
  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [summaryRes, monthlyRes, outcomesRes, forecastsRes, alertsRes, riskRes, brgyRes, pipelineRes, demoRes] =
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
        ]);
      setSummary(summaryRes.data.summary || {});
      setMonthlyData(monthlyRes.data.monthly || []);
      setOutcomesData(outcomesRes.data.outcomes || []);
      setForecastsData(forecastsRes.data.forecasts || []);
      setAlertsData(alertsRes.data.alerts || []);
      setRiskData(riskRes.data.choropleth || []);
      setBarangays(brgyRes.data.barangays || []);
      setPipelineStatus(pipelineRes.data.latest_run || null);
      setDemographicsData(demoRes.data.demographics || []);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
      setError('Dashboard data could not be retrieved. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  /* ── Filter handlers ── */
  const handleApply = useCallback(() => {
    setAppliedYear(filterYear);
    setAppliedMonth(filterMonth);
    setAppliedBarangay(filterBarangay);
  }, [filterYear, filterMonth, filterBarangay]);

  const handleClear = useCallback(() => {
    setFilterYear(''); setFilterMonth(''); setFilterBarangay('');
    setAppliedYear(''); setAppliedMonth(''); setAppliedBarangay('');
  }, []);

  /* ── Barangay names ── */
  const barangayNames = useMemo(
    () => barangays.map((b) => b.barangay_name || b.name).filter(Boolean).sort(),
    [barangays]
  );

  /* ── Filtered monthly data ── */
  const filteredMonthly = useMemo(() => {
    return monthlyData.filter((r) => {
      if (!r.month) return false;
      const d = new Date(r.month);
      if (appliedYear && d.getFullYear() !== Number(appliedYear)) return false;
      if (appliedMonth && (d.getMonth() + 1) !== Number(appliedMonth)) return false;
      if (appliedBarangay && r.barangay_name !== appliedBarangay) return false;
      return true;
    });
  }, [monthlyData, appliedYear, appliedMonth, appliedBarangay]);

  /* ── Filtered outcomes ── */
  const filteredOutcomes = useMemo(() => {
    // Outcomes data doesn't have date/barangay in the same format, so we use it as-is
    // unless filters are applied — in that case, we derive from filteredMonthly barangays
    if (!appliedBarangay && !appliedYear && !appliedMonth) return outcomesData;
    // Filter by barangay if available
    if (appliedBarangay) {
      return outcomesData.filter((r) => !r.barangay_name || r.barangay_name === appliedBarangay);
    }
    return outcomesData;
  }, [outcomesData, appliedBarangay, appliedYear, appliedMonth]);

  /* ── 1. Total TB Cases ── */
  const totalCases = useMemo(() => {
    const uniqueMonths = new Set(filteredMonthly.map((r) => r.month)).size;
    const total = filteredMonthly.reduce((s, r) => s + Number(r.case_count || 0), 0);
    return { total, months: uniqueMonths };
  }, [filteredMonthly]);

  /* ── 2. Active Cases (ON TREATMENT) ── */
  const activeCases = useMemo(() => {
    return filteredOutcomes
      .filter((r) => (r.outcome_status || '').toUpperCase() === 'ON TREATMENT')
      .reduce((s, r) => s + Number(r.total || 0), 0);
  }, [filteredOutcomes]);

  /* ── 3. Treatment Success Rate ── */
  const successRate = useMemo(() => {
    const byStatus = {};
    filteredOutcomes.forEach((r) => {
      const st = (r.outcome_status || 'Unknown').toUpperCase();
      byStatus[st] = (byStatus[st] || 0) + Number(r.total || 0);
    });
    const total = Object.values(byStatus).reduce((s, v) => s + v, 0);
    if (total === 0) return { rate: '0.0', evaluated: 0 };
    const success = (byStatus['CURED'] || 0) + (byStatus['TREATMENT COMPLETED'] || 0);
    const evaluated = total - (byStatus['NOT EVALUATED'] || 0);
    return { rate: ((success / (evaluated || 1)) * 100).toFixed(1), evaluated };
  }, [filteredOutcomes]);

  /* ── 4. High-Risk Barangays ── */
  const highRiskCount = useMemo(() => {
    // Use choropleth data (current risk status) as primary source
    const fromChoropleth = riskData.filter((r) => {
      const rc = (r.risk_class || '').toLowerCase();
      return rc === 'high' || rc === 'very high' || rc === 'medium';
    }).length;
    if (fromChoropleth > 0) return fromChoropleth;
    // Fallback: forecasts data
    if (forecastsData.length > 0) {
      const latestPeriod = forecastsData.reduce((max, r) => {
        const p = r.period || '';
        return p > max ? p : max;
      }, '');
      const highSet = new Set();
      forecastsData.forEach((r) => {
        if (r.period !== latestPeriod) return;
        const rc = (r.risk_class || '').toLowerCase();
        if (rc === 'high' || rc === 'very high' || rc === 'medium') highSet.add(r.barangay_name);
      });
      return highSet.size;
    }
    return 0;
  }, [forecastsData, riskData]);

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

  /* ── 6. Case Fatality Rate (CFR) ── */
  const caseFatalityRate = useMemo(() => {
    const byStatus = {};
    filteredOutcomes.forEach((r) => {
      const st = (r.outcome_status || 'Unknown').toUpperCase();
      byStatus[st] = (byStatus[st] || 0) + Number(r.total || 0);
    });
    const total = Object.values(byStatus).reduce((s, v) => s + v, 0);
    const died = byStatus['DIED'] || 0;
    const evaluated = total - (byStatus['NOT EVALUATED'] || 0);
    return {
      rate: evaluated > 0 ? ((died / evaluated) * 100).toFixed(1) : '0.0',
      died,
      evaluated,
    };
  }, [filteredOutcomes]);

  /* ── 7. Month-over-Month Comparison ── */
  const monthOverMonth = useMemo(() => {
    if (filteredMonthly.length === 0) return { current: 0, previous: 0, change: 0, activeCurrent: 0, activePrevious: 0, activeChange: 0 };
    const sorted = [...filteredMonthly].sort((a, b) => a.month.localeCompare(b.month));
    const allMonths = [...new Set(sorted.map(r => r.month))].sort();
    const latestMonth = allMonths[allMonths.length - 1];
    const prevMonth = allMonths.length >= 2 ? allMonths[allMonths.length - 2] : null;

    const currentCases = sorted.filter(r => r.month === latestMonth).reduce((s, r) => s + Number(r.case_count || 0), 0);
    const previousCases = prevMonth ? sorted.filter(r => r.month === prevMonth).reduce((s, r) => s + Number(r.case_count || 0), 0) : 0;
    const change = previousCases > 0 ? ((currentCases - previousCases) / previousCases) * 100 : 0;

    return { current: currentCases, previous: previousCases, change, month: latestMonth };
  }, [filteredMonthly]);

  /* ── 8. Filtered Demographics ── */
  const filteredDemographics = useMemo(() => {
    if (!appliedBarangay) return demographicsData;
    return demographicsData.filter((r) => r.barangay_name === appliedBarangay);
  }, [demographicsData, appliedBarangay]);

  const sexData = useMemo(() => {
    const totals = { Male: 0, Female: 0 };
    filteredDemographics.forEach((r) => {
      const sex = r.sex || 'Unknown';
      if (sex in totals) totals[sex] += r.total || 0;
    });
    return totals;
  }, [filteredDemographics]);

  const ageData = useMemo(() => {
    const ageOrder = ['0-14', '15-24', '25-34', '35-44', '45-54', '55-64', '65+', 'Unknown'];
    const totals = {};
    filteredDemographics.forEach((r) => {
      const age = r.age_group || 'Unknown';
      totals[age] = (totals[age] || 0) + (r.total || 0);
    });
    return ageOrder
      .filter((age) => totals[age] > 0)
      .map((age) => ({ age_group: age, total: totals[age] }));
  }, [filteredDemographics]);

  /* ── TB Cases Trend chart data ── */
  const trendChartData = useMemo(() => {
    const byMonth = {};
    filteredMonthly.forEach((r) => {
      if (!byMonth[r.month]) byMonth[r.month] = 0;
      byMonth[r.month] += Number(r.case_count || 0);
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, cases]) => {
        const d = new Date(month);
        return { label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), cases, month };
      });
  }, [filteredMonthly]);

  /* ── Barangay Risk Overview chart data ── */
  const riskOverview = useMemo(() => {
    const counts = { Low: 0, Moderate: 0, High: 0, 'Very High': 0 };
    // Use forecasts first
    if (forecastsData.length > 0) {
      const latestPeriod = forecastsData.reduce((max, r) => (r.period > max ? r.period : max), '');
      const seen = new Set();
      forecastsData.forEach((r) => {
        if (r.period !== latestPeriod || seen.has(r.barangay_name)) return;
        seen.add(r.barangay_name);
        const rc = r.risk_class || 'Low';
        if (rc === 'Medium') counts.Moderate++;
        else if (counts[rc] !== undefined) counts[rc]++;
        else counts.Low++;
      });
    } else {
      riskData.forEach((r) => {
        const rc = r.risk_class || 'No Data';
        if (rc === 'Medium') counts.Moderate++;
        else if (rc === 'High' || rc === 'Very High') counts[rc] = (counts[rc] || 0) + 1;
        else if (rc === 'Low') counts.Low++;
      });
    }
    return [
      { level: 'Low', count: counts.Low, color: RISK_COLORS.Low },
      { level: 'Moderate', count: counts.Moderate, color: RISK_COLORS.Moderate },
      { level: 'High', count: counts.High, color: RISK_COLORS.High },
      { level: 'Very High', count: counts['Very High'], color: RISK_COLORS['Very High'] },
    ];
  }, [forecastsData, riskData]);

  /* ── Top Priority Barangays ── */
  const topBarangays = useMemo(() => {
    if (!filteredMonthly.length && !forecastsData.length) return [];
    // Combine case counts with risk scores
    const byBarangay = {};
    filteredMonthly.forEach((r) => {
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
    return Object.values(byBarangay)
      .sort((a, b) => (b.score || b.cases) - (a.score || a.cases))
      .slice(0, 5)
      .map((b, i) => ({ rank: i + 1, ...b }));
  }, [filteredMonthly, forecastsData, riskData]);

  /* ── Treatment Outcomes chart data ── */
  const outcomeChartData = useMemo(() => {
    const byStatus = {};
    filteredOutcomes.forEach((r) => {
      const st = r.outcome_status || 'Unknown';
      byStatus[st] = (byStatus[st] || 0) + Number(r.total || 0);
    });
    return OUTCOME_ORDER
      .filter((st) => byStatus[st])
      .map((st) => ({ outcome: st, count: byStatus[st], color: OUTCOME_COLORS[st] || '#94A3B8' }));
  }, [filteredOutcomes]);

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
        type: a.alert_type || 'Alert',
        title: a.alert_type || 'Alert',
        message: a.message || '',
        barangay: a.barangay_name || '',
        time: timeLabel,
      };
    });
  }, [alertsData]);

  /* ── Last Updated ── */
  const lastUpdated = useMemo(() => {
    if (pipelineStatus?.trained_at) return new Date(pipelineStatus.trained_at);
    if (summary?.latest_date) return new Date(summary.latest_date);
    return null;
  }, [pipelineStatus, summary]);

  /* ────────── Render ────────── */

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: '#FEE2E2' }}>
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
        {/* Header skeleton */}
        <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07)' }}>
          <div className="px-6 py-3.5"><SkeletonBlock className="h-5 w-48" /><SkeletonBlock className="h-3 w-96 mt-2" /></div>
          <div className="px-6 py-3 flex gap-2" style={{ background: '#F8FAFC' }}><SkeletonBlock className="h-8 w-24" /><SkeletonBlock className="h-8 w-24" /><SkeletonBlock className="h-8 w-32" /></div>
        </div>
        {/* Metrics skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl p-5" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
              <SkeletonBlock className="h-3 w-24 mb-3" />
              <SkeletonBlock className="h-8 w-16 mb-2" />
              <SkeletonBlock className="h-3 w-20" />
            </div>
          ))}
        </div>
        {/* Chart skeletons */}
        <SkeletonCard />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><SkeletonCard /><SkeletonCard /></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ─── 1. Page Header ─── */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)' }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-3.5" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Dashboard</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Monitor tuberculosis cases, trends, treatment outcomes, barangay risk levels, forecasts, and alerts across Pasig City.</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>
              <i className="ri-database-2-line mr-1" />Data Source: Centralized TB Records
            </span>
            {lastUpdated && (
              <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>
                <i className="ri-time-line mr-1" />
                Last Updated: {lastUpdated.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </span>
            )}
          </div>
        </div>

        {/* ─── 2. Global Filters ─── */}
        <div className="flex items-center justify-between px-6 py-3" style={{ background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <FilterSelect label="Year" value={filterYear} onChange={setFilterYear}>
              <option value="">All Years</option>
              {ALL_YEARS.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
            </FilterSelect>
            <FilterSelect label="Month" value={filterMonth} onChange={setFilterMonth}>
              {MONTH_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </FilterSelect>
            <FilterSelect label="Barangay" value={filterBarangay} onChange={setFilterBarangay}>
              <option value="">All Barangays</option>
              {barangayNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </FilterSelect>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={handleClear} className="px-3 py-2 text-xs font-medium" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }} onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}>
              Clear
            </button>
            <button onClick={handleApply} className="px-4 py-2 text-xs font-semibold" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }} onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}>
              Apply Filters
            </button>
          </div>
        </div>
      </div>

      {/* ─── Empty State ─── */}
      {totalCases.total === 0 && forecastsData.length === 0 && alertsData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ background: '#F1F5F9' }}>
            <i className="ri-database-2-line text-4xl" style={{ color: '#CBD5E1' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold" style={{ color: '#475569' }}>No Data Available</p>
            <p className="text-xs mt-1 max-w-sm" style={{ color: '#94A3B8' }}>No TB records match the selected filters. Try adjusting your filters and apply again.</p>
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
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{totalCases.total.toLocaleString()}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>{totalCases.months} months recorded</span>
                  {monthOverMonth.previous > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold" style={{ color: monthOverMonth.change > 0 ? '#B07070' : monthOverMonth.change < 0 ? '#6B9E8A' : '#64748B' }}>
                      <i className={`ri-arrow-${monthOverMonth.change > 0 ? 'up' : monthOverMonth.change < 0 ? 'down' : 'right'}-s-fill`} />
                      {Math.abs(monthOverMonth.change).toFixed(1)}%
                    </span>
                  )}
                </div>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Active TB Cases */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-time-line text-sm" style={{ color: '#B8956A' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Active TB Cases</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{activeCases.toLocaleString()}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>Cases currently on treatment</span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Treatment Success Rate */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-checkbox-circle-line text-sm" style={{ color: '#6B9E8A' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Success Rate</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{successRate.rate}%</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{successRate.evaluated.toLocaleString()} evaluated</span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Case Fatality Rate */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-heart-pulse-line text-sm" style={{ color: '#B07070' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Case Fatality Rate</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{caseFatalityRate.rate}%</p>
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
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{highRiskCount}/30</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>Barangays requiring attention</span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Forecasted Cases */}
              <div className="flex flex-col px-5 py-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <i className="ri-line-chart-line text-sm" style={{ color: '#6B9E9E' }} />
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Forecasted</span>
                   </div>
                  <button
                    onClick={() => navigate('/forecasting')}
                    className="flex items-center gap-1 text-[11px] font-semibold transition hover:underline"
                    style={{ color: '#0F2D52' }}
                  >
                    View Forecast <i className="ri-arrow-right-s-line text-sm" />
                  </button>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{forecastSummary.total.toLocaleString()}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>{forecastSummary.period ? `${forecastSummary.period} forecast` : 'No forecast available'}</span>
              </div>
            </div>
          </div>

          {/* ─── 4. TB Cases Trend + 5. Barangay Risk Overview ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* TB Cases Trend */}
            <SectionCard
              title="TB Cases Trend"
              icon="ri-line-chart-line"
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
                  <p className="text-xs" style={{ color: '#94A3B8' }}>No trend data available for the selected filters.</p>
                </div>
              )}
            </SectionCard>

            {/* Barangay Risk Overview — GIS Map */}
            <SectionCard
              title="Barangay Risk Overview"
              icon="ri-map-pin-line"
              iconColor="#EF4444"
              description="Current risk classification across Pasig City barangays."
              action="View GIS Hotspots"
              actionTo="/gis-map"
            >
              <div className="relative rounded-lg overflow-hidden">
                <MiniGisMap />
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
              icon="ri-list-ordered"
              iconColor="#7C3AED"
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
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <i className="ri-list-ordered text-xl" style={{ color: '#CBD5E1' }} />
                  <p className="text-xs" style={{ color: '#94A3B8' }}>No barangay risk data available.</p>
                </div>
              )}
            </SectionCard>

            {/* Age Group Distribution */}
            <SectionCard
              title="Demographics — Age Distribution"
              icon="ri-group-line"
              iconColor="#8B5CF6"
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
                            <div className="h-full rounded-md transition-all" style={{ width: `${pct}%`, background: '#8B5CF6' }} />
                          </div>
                          <span className="text-[11px] font-bold w-10 text-right shrink-0" style={{ color: '#0F2D52' }}>{item.total.toLocaleString()}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
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
              icon="ri-men-line"
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
                          <Cell fill="#EC4899" />
                        </Pie>
                        <Tooltip formatter={(value) => value.toLocaleString()} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2">
                    {[
                      { label: 'Male', value: sexData.Male, color: '#3B82F6' },
                      { label: 'Female', value: sexData.Female, color: '#EC4899' },
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
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <i className="ri-men-line text-xl" style={{ color: '#CBD5E1' }} />
                  <p className="text-xs" style={{ color: '#94A3B8' }}>No demographic data available.</p>
                </div>
              )}
            </SectionCard>

            {/* Treatment Outcomes */}
            <SectionCard
              title="Treatment Outcomes"
              icon="ri-pie-chart-2-line"
              iconColor="#10B981"
              description="Distribution of recorded TB treatment outcomes."
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
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <i className="ri-pie-chart-2-line text-xl" style={{ color: '#CBD5E1' }} />
                  <p className="text-xs" style={{ color: '#94A3B8' }}>No outcome data available.</p>
                </div>
              )}
            </SectionCard>
          </div>

          {/* ─── 8. Forecasting Summary + Recent Alerts ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Forecasting Summary */}
            <SectionCard
              title="Forecasting Summary"
              icon="ri-line-chart-line"
              iconColor="#0D9488"
              description="Latest projected TB cases based on available historical records."
              action="View Full Forecast"
              actionTo="/forecasting"
            >
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Forecasted Cases', value: forecastSummary.total.toLocaleString(), icon: 'ri-line-chart-line', color: '#0D9488' },
                  { label: 'Growth Rate', value: `${forecastSummary.growthRate >= 0 ? '+' : ''}${forecastSummary.growthRate.toFixed(1)}%`, icon: forecastSummary.growthRate >= 0 ? 'ri-arrow-up-s-fill' : 'ri-arrow-down-s-fill', color: forecastSummary.growthRate >= 0 ? '#EF4444' : '#10B981' },
                  { label: 'Risk Level', value: forecastSummary.riskLevel, icon: 'ri-shield-line', color: RISK_COLORS[forecastSummary.riskLevel] || '#94A3B8' },
                  { label: 'Forecast Period', value: forecastSummary.period || 'N/A', icon: 'ri-calendar-line', color: '#64748B' },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col p-4 rounded-lg" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <i className={`${item.icon} text-sm`} style={{ color: item.color }} />
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>{item.label}</span>
                    </div>
                    <p className="text-lg font-extrabold" style={{ color: '#0F2D52' }}>{item.value}</p>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Recent Alerts */}
            <SectionCard
              title="Recent Alerts"
              icon="ri-alarm-warning-line"
              iconColor="#EF4444"
              description={`${recentAlerts.length} unresolved alert${recentAlerts.length !== 1 ? 's' : ''}`}
              action="View All Alerts"
              actionTo="/alert"
            >
              {recentAlerts.length > 0 ? (
                <div>
                  {recentAlerts.map((alert, idx) => {
                    const isCritical = alert.severity === 'CRITICAL' || alert.severity === 'HIGH';
                    const badgeBg = isCritical ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)';
                    const badgeColor = isCritical ? '#EF4444' : '#D97706';
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
                <div className="flex flex-col items-center justify-center py-12 gap-2">
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
