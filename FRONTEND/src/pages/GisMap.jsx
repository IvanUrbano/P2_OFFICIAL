import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import API from '../api/axios';
import AiInsightPanel from '../components/AiInsightPanel';
import { getGisInsight } from '../services/insightService';

const RISK_COLORS = {
  High: '#EF4444',
  Medium: '#F97316',
  Low: '#FBBF24',
  'No Data': '#64748B',
};

// Canonical risk_class values (backend/DB/RF) are Low/Medium/High. The
// user-facing label for 'Medium' is "Moderate" everywhere in this page —
// never rename the underlying value, only its display text.
const RISK_LABELS = { High: 'High', Medium: 'Moderate', Low: 'Low', 'No Data': 'No Data' };
const riskLabel = (cls) => RISK_LABELS[cls] || cls || 'No Data';

// Human-readable labels for the actual 8 RF input features (see
// BACKEND/tbinsight/pipeline.js:buildFeatureRow / ML_SERVICE/rf_classifier.py:FEATURES).
// These are the model's real inputs, shown as "indicators used" — never as
// a causal "this factor caused High Risk" claim.
const RF_FEATURE_LABELS = {
  rolling_12m_incidence: 'Rolling 12-Month Incidence',
  recent_trend: 'Recent Case Trend',
  seasonality_flag: 'Seasonal Pattern',
  lag_1m: '1-Month Lag Cases',
  lag_2m: '2-Month Lag Cases',
  lag_3m: '3-Month Lag Cases',
  neighbor_risk: 'Neighbor Risk Indicator',
  historical_bias: 'Historical Forecast Error',
};
const RF_FEATURE_ORDER = [
  'rolling_12m_incidence', 'recent_trend', 'lag_1m', 'lag_2m', 'lag_3m', 'neighbor_risk', 'seasonality_flag', 'historical_bias',
];
function formatRfFeatureValue(key, value) {
  if (value == null) return 'N/A';
  switch (key) {
    case 'rolling_12m_incidence': return `${Number(value).toFixed(1)} / 100k`;
    case 'recent_trend': return `${value > 0 ? '+' : ''}${Number(value).toFixed(2)} cases/mo`;
    case 'seasonality_flag': return value ? 'Detected' : 'Not detected';
    case 'neighbor_risk': return `${Math.round(Number(value) * 100)}%`;
    case 'historical_bias': return Number(value).toFixed(1);
    default: return String(Math.round(Number(value)));
  }
}

const OUTCOME_COLORS = {
  'CURED': '#047857',
  'TREATMENT COMPLETED': '#2E6FAF',
  'ON TREATMENT': '#92400E',
  'LOST TO FF-UP': '#6B7280',
  'LOST TO FOLLOW-UP': '#6B7280',
  'DIED': '#991B1B',
  'EXCLUDED': '#64748B',
  'TREATMENT FAILED': '#991B1B',
  'FAILED': '#991B1B',
  'DEFAULTED': '#B45309',
  'NOT EVALUATED': '#94A3B8',
  'DIAGNOSED': '#0369A1',
  'SCREENED': '#0E7490',
};

const PASIG_AREA_KM2 = 31.3;

const PASIG_BOUNDS = L.latLngBounds([14.48, 121.02], [14.64, 121.13]);
const MAX_BOUNDS = L.latLngBounds([14.3, 120.85], [14.85, 121.25]);

function FilterSelect({ label, value, onChange, children, selectStyle }) {
  return (
    <div className="relative inline-flex items-center">
      <span className="absolute left-3 text-[11px] pointer-events-none whitespace-nowrap" style={{ color: '#94A3B8' }}>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="rounded-lg py-[7px] text-[11px] font-semibold outline-none transition cursor-pointer appearance-none"
        style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52', paddingLeft: `${label.length * 6.5 + 26}px`, paddingRight: '28px', maxWidth: 160, ...selectStyle }}
      >
        {children}
      </select>
      <i className="ri-arrow-down-s-line absolute right-2 text-[10px] pointer-events-none" style={{ color: '#64748B' }} />
    </div>
  );
}

function riskStyle(feature) {
  const risk = feature.properties?.risk_class || 'No Data';
  return {
    fillColor: RISK_COLORS[risk] || RISK_COLORS['No Data'],
    weight: 0.5,
    opacity: 1,
    color: 'rgba(0,0,0,0.35)',
    fillOpacity: 0.6,
  };
}

function highlightFeature(e) {
  const layer = e.target;
         layer.setStyle({ weight: 1.5, fillOpacity: 0.8, color: '#4A6FA5' });
  layer.bringToFront();
}

function resetHighlight(e, layer) {
  layer?.resetStyle(e.target);
}

function formatNum(n) {
  return n != null ? Number(n).toLocaleString() : '\u2014';
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>{label}</span>
      <span className="text-[12px] font-bold" style={{ color: '#0F2D52' }}>{value != null ? value : '\u2014'}</span>
    </div>
  );
}

function buildLabels(map, features, layerRef) {
  layerRef.current.forEach(l => { try { map.removeLayer(l); } catch { void 0; } });
  layerRef.current = [];
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
  layerRef.current = [layer];
}

export default function GisMap() {
  const navigate = useNavigate();
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const geojsonLayerRef = useRef(null);
  const outlineLayerRef = useRef(null);
  const labelsRef = useRef([]);
  const animationIntervalRef = useRef(null);
  const [data, setData] = useState(null);
  const [monthlyByBarangay, setMonthlyByBarangay] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterBarangay, setFilterBarangay] = useState('');
  const [filterRiskLevel, setFilterRiskLevel] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedBarangayName, setSelectedBarangayName] = useState(null);
  const [barangayDetail, setBarangayDetail] = useState(null);
  const [barangayDetailLoading, setBarangayDetailLoading] = useState(false);
  const [barangayTsr, setBarangayTsr] = useState(null);
  const [barangayInterventionCount, setBarangayInterventionCount] = useState(0);
  const [hoveredBarangay, setHoveredBarangay] = useState(null);
  // Legacy weighted risk_score breakdown — hidden by default (see item 12 of
  // the GIS/RF audit follow-up): it must not be presented alongside the RF
  // classification as if it explained it, so it stays out of sight until
  // explicitly opened.
  const [showLegacyIndex, setShowLegacyIndex] = useState(false);
  const [timelineMonth, setTimelineMonth] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filterYear, setFilterYear] = useState('');
  const [availableYears, setAvailableYears] = useState([]);
  const [gisInsight, setGisInsight] = useState(null);
  const [gisInsightLoading, setGisInsightLoading] = useState(false);
  const [gisInsightError, setGisInsightError] = useState(null);
  const [pipelineRun, setPipelineRun] = useState(null);
  const [pipelineRefreshTick, setPipelineRefreshTick] = useState(0);
  const wasRunningRef = useRef(false);
  const closeButtonRef = useRef(null);

  const handleGenerateGisInsight = useCallback(async () => {
    try {
      setGisInsightLoading(true);
      setGisInsightError(null);
      const insight = await getGisInsight({ barangay: filterBarangay || undefined });
      setGisInsight(insight);
    } catch (err) {
      if (import.meta.env.DEV) console.error('GIS insight generation failed:', err);
      setGisInsightError('Unable to generate insight.');
    } finally {
      setGisInsightLoading(false);
    }
  }, [filterBarangay]);

  // Auto-focus close button when modal opens and handle Escape key
  useEffect(() => {
    if (!selectedBarangayName) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setSelectedBarangayName(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedBarangayName]);

  // Fetch available years for year filter
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await API.get('/api/tb/gis/years', { signal: controller.signal });
        setAvailableYears(res.data.years || []);
      } catch {
        // silently ignore
      }
    })();
    return () => controller.abort();
  }, []);

  // Shared fetch helpers (used by both useEffects and handleRefresh)
  const fetchGeoData = useCallback(async (signal) => {
    const params = filterYear ? { year: filterYear } : {};
    const res = await API.get('/api/tb/gis/geojson', { params, signal });
    return res.data;
  }, [filterYear]);

  const fetchMonthlyData = useCallback(async (signal) => {
    const params = filterYear ? { year: filterYear } : {};
    const res = await API.get('/api/tb/dashboard/monthly', { params, signal });
    const rows = res.data.monthly || [];
    const grouped = {};
    rows.forEach(r => {
      const name = r.barangay_name;
      if (!grouped[name]) grouped[name] = [];
      grouped[name].push({ month: r.month, case_count: r.case_count });
    });
    Object.values(grouped).forEach(arr => arr.sort((a, b) => a.month.localeCompare(b.month)));
    return grouped;
  }, [filterYear]);

  // Fetch GeoJSON data (re-fetches when year changes)
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      if (data) setRefreshing(true);
      try {
        const geoData = await fetchGeoData(controller.signal);
        setError(null); setData(geoData); setLoading(false);
      } catch (err) {
        if (err.name !== 'CanceledError' && err.name !== 'AbortError') {
          setError(err.message || 'Failed to load map data'); setLoading(false);
        }
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    })();
    return () => controller.abort();
  }, [fetchGeoData, pipelineRefreshTick]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const grouped = await fetchMonthlyData(controller.signal);
        setMonthlyByBarangay(grouped);
      } catch {
        // silently ignore
      }
    })();
    return () => controller.abort();
  }, [fetchMonthlyData]);

  // Pipeline run status: drives the "processing" banner and refreshes the map
  // automatically the moment a background run (auto-triggered by a record
  // sync) finishes. Fast poll while running, slow poll when idle.
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    const poll = async () => {
      let running = false;
      try {
        const res = await API.get('/api/tb/pipeline/status', { signal: controller.signal });
        const cur = res.data?.current_run || null;
        setPipelineRun(cur);
        running = !!(cur && cur.running);
        if (wasRunningRef.current && !running) setPipelineRefreshTick(t => t + 1);
        wasRunningRef.current = running;
      } catch {
        // silently ignore — next poll retries
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, running ? 4000 : 15000);
    };
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current, {
      center: [14.555, 121.075],
      zoom: 15.5,
      zoomControl: false,
      attributionControl: false,
      minZoom: 13,
      maxZoom: 18,
      maxBounds: MAX_BOUNDS,
      maxBoundsViscosity: 0.8,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
      subdomains: 'abc',
      className: 'dark-tiles',
    }).addTo(map);
    mapInstance.current = map;
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    requestAnimationFrame(() => { map.invalidateSize(); });
    return () => { map.remove(); mapInstance.current = null; };
  }, [loading]);

  // Filtered features based on active filters
  const filteredFeatures = React.useMemo(() => {
    if (!data?.features) return [];
    let features = data.features;
    if (filterBarangay) {
      features = features.filter(f => f.properties?.name === filterBarangay);
    }
    if (filterRiskLevel) {
      features = features.filter(f => f.properties?.risk_class === filterRiskLevel);
    }
    return features;
  }, [data, filterBarangay, filterRiskLevel]);

  // Risk ranking data (extracted from IIFE for performance)
  const riskRankingData = React.useMemo(() => {
    if (!data?.features) return null;
    const groups = { High: [], Medium: [], Low: [], 'No Data': [] };
    data.features.forEach(f => {
      const p = f.properties;
      if (!p || !p.name) return;
      const cls = p.risk_class || 'No Data';
      if (groups[cls]) groups[cls].push(p);
    });
    // Rows sort by the VISIBLE year-specific incidence (descending), with
    // total cases as tiebreak — never the legacy risk_score, which is no
    // longer displayed anywhere in this panel (kept only in the DB).
    // All Years has no incidence (null), so every row ties at 0 and the
    // fallback takes over: rows within each risk group order by total
    // cases across available years (descending), then name. No combined
    // multi-year risk score is invented to fake an all-years ranking.
    Object.keys(groups).forEach(k => {
      groups[k].sort((a, b) =>
        (b.incidence_per_100k || 0) - (a.incidence_per_100k || 0) ||
        (b.total_cases || 0) - (a.total_cases || 0) ||
        String(a.name || '').localeCompare(String(b.name || ''))
      );
    });
    const allBarangays = [...groups.High, ...groups.Medium, ...groups.Low, ...groups['No Data']];
    const mid = Math.ceil(allBarangays.length / 2);
    const leftHalf = allBarangays.slice(0, mid);
    const rightHalf = allBarangays.slice(mid);
    // Neutral, count-based section labels — no prescriptive clinical or
    // operational directives, which no approved protocol ever defined for
    // these groups. "No Assessment" (not "No Data"): case data may still
    // exist for the selected year — only the risk snapshot is missing.
    // Never rendered empty (count > 0 guard).
    const sections = [
      { key: 'High', label: `High Risk — ${groups.High.length} barangay${groups.High.length === 1 ? '' : 's'}`, color: '#EF4444', items: groups.High },
      { key: 'Medium', label: `Moderate Risk — ${groups.Medium.length} barangay${groups.Medium.length === 1 ? '' : 's'}`, color: '#F97316', items: groups.Medium },
      { key: 'Low', label: `Low Risk — ${groups.Low.length} barangay${groups.Low.length === 1 ? '' : 's'}`, color: '#FBBF24', items: groups.Low },
      ...(groups['No Data'].length > 0
        ? [{ key: 'No Data', label: `No Assessment — ${groups['No Data'].length} barangay${groups['No Data'].length === 1 ? '' : 's'}`, color: '#94A3B8', items: groups['No Data'] }]
        : []),
    ].filter(s => s.items.length > 0);
    return { groups, allBarangays, sections, leftHalf, rightHalf };
  }, [data]);

  // Modal content data (extracted from IIFE for performance)
  const modalData = React.useMemo(() => {
    if (!selectedBarangayName || barangayDetailLoading) return null;
    const geoProps = data?.features?.find(f => f.properties?.name === selectedBarangayName)?.properties || {};
    const b = barangayDetail?.barangay || {};
    const outcomes = barangayDetail?.outcomes || [];
    const demographics = barangayDetail?.demographics || [];
    const monthlyKey = Object.keys(monthlyByBarangay).find(
      k => k.toLowerCase() === selectedBarangayName?.toLowerCase()
    );
    const monthly = barangayDetail?.monthly?.length > 0
      ? barangayDetail.monthly
      : (monthlyByBarangay[monthlyKey] || monthlyByBarangay[selectedBarangayName] || []);
    const merged = { ...geoProps, ...b };
    const riskColor = RISK_COLORS[merged.risk_class] || '#64748B';
    const totalOutcomeCases = outcomes.reduce((s, o) => s + (o.total || 0), 0);
    const activeCases = outcomes.find(o => o.outcome_status === 'ON TREATMENT')?.total || 0;
    // Treatment Success Rate: the cohort-based figure fetched from
    // GET /api/tb/treatment-success-rate (see barangayTsr) — NOT computed
    // from this barangay's outcomes breakdown, which is diagnosis-date
    // filtered and a different metric under the same label.
    const successRate = barangayTsr?.successRate != null ? barangayTsr.successRate.toFixed(1) : '—';
    const trendChartData = monthly.slice(-12).map(m => ({
      label: m.month ? new Date(m.month.includes('T') ? m.month : m.month + 'T00:00:00').toLocaleString('default', { month: 'short', year: '2-digit' }) : '',
      cases: Number(m.case_count ?? 0),
    }));
    const ageGroups = {};
    demographics.forEach(d => {
      if (!ageGroups[d.age_group]) ageGroups[d.age_group] = { Male: 0, Female: 0 };
      ageGroups[d.age_group][d.sex] = (d.total || 0);
    });
    const demoChartData = Object.entries(ageGroups)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([age, counts]) => ({ name: age, Male: counts.Male, Female: counts.Female }));
    const outcomeChartData = outcomes.map(o => ({
      name: o.outcome_status?.length > 16 ? o.outcome_status.slice(0, 14) + '...' : o.outcome_status,
      value: o.total,
      color: OUTCOME_COLORS[o.outcome_status] || '#64748B',
    }));
    return { merged, riskColor, totalOutcomeCases, activeCases, successRate, trendChartData, demoChartData, outcomeChartData };
  }, [selectedBarangayName, barangayDetail, barangayDetailLoading, monthlyByBarangay, data, barangayTsr]);

  const hasActiveFilters = filterBarangay || filterRiskLevel || filterYear;

  // Assessment year of the risk snapshot. Snapshots are keyed at
  // (assessment year + 1)-01-01 and serialized as an ISO instant
  // ("2025-12-31T16:00:00.000Z" = local midnight Jan 1, 2026 in Pasig,
  // UTC+8). Shifting by +8h before reading the UTC year makes this correct
  // in any browser timezone: 2026 - 1 = 2025, the year the snapshot's
  // data actually covers. Also avoids the old `period + 'T00:00:00'`
  // concatenation, which produced an Invalid Date on ISO strings.
  const riskAssessmentYear = React.useMemo(() => {
    const p = data?.meta?.risk_assessment_period;
    if (!p) return null;
    const d = new Date(p);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getTime() + 8 * 3600 * 1000).getUTCFullYear() - 1;
  }, [data]);

  // Click-to-zoom on barangay polygon
  const handlePolygonClick = useCallback((feature, layer) => {
    if (layer.getBounds) {
      mapInstance.current?.fitBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 16, animate: true });
    }
    setSelectedBarangayName(feature.properties?.name);
  }, []);

  useEffect(() => {
    if (!mapInstance.current || !data) return;
    const map = mapInstance.current;
    if (geojsonLayerRef.current) map.removeLayer(geojsonLayerRef.current);
    if (outlineLayerRef.current) map.removeLayer(outlineLayerRef.current);
    labelsRef.current.forEach(l => { try { map.removeLayer(l); } catch { void 0; } });
    labelsRef.current = [];
    if (data.outline) {
      const outlineLayer = L.geoJSON(
        { type: 'Feature', properties: {}, geometry: data.outline },
        { style: { fillColor: '#1a1a2e', fillOpacity: 0.85, weight: 0, opacity: 0 }, interactive: false }
      ).addTo(map);
      outlineLayerRef.current = outlineLayer;
    }
    // Use filtered features for the map layer
    const filteredData = { ...data, features: filteredFeatures };
    const geojsonLayer = L.geoJSON(filteredData, {
      style: riskStyle,
      onEachFeature: (feature, layer) => {
        const p = feature.properties || {};
        const riskColor = RISK_COLORS[p.risk_class] || '#6B7280';
        const trendArrow = p.trend_direction === 'Increasing' ? '\u2191' : p.trend_direction === 'Decreasing' ? '\u2193' : '\u2192';
        // Confidence \u2014 not "Score": the legacy weighted risk_score (0-100)
        // no longer determines risk_class (RF does) and its own <=33/34-66/
        // >66 bands frequently disagree with the RF class shown above it,
        // which would misleadingly imply the score explains the class.
        // classification_confidence is RF's own predict_proba for the
        // predicted class \u2014 only shown when it actually came from RF.
        const confidenceRow = p.model_type === 'random_forest' && p.classification_confidence != null
          ? `<div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
              <span style="font-size: 10px; color: #94A3B8;">Classification Confidence</span>
              <span style="font-size: 10px; font-weight: 600; color: #0F2D52;">${Math.round(p.classification_confidence * 100)}%</span>
            </div>`
          : '';
        const tooltipHtml = `
          <div style="font-family: Inter, sans-serif; min-width: 220px; padding: 2px;">
            <div style="font-size: 13px; font-weight: 700; color: #0F2D52; margin-bottom: 4px;">${escapeHtml(p.name) || 'Unknown'}</div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
              <span style="font-size: 10px; color: #94A3B8;">Risk</span>
              <span style="font-size: 10px; font-weight: 700; color: ${riskColor};">${escapeHtml(p.risk_class) || 'No Data'}</span>
            </div>
            ${confidenceRow}
            <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
              <span style="font-size: 10px; color: #94A3B8;">Trend</span>
              <span style="font-size: 10px; font-weight: 600; color: #0F2D52;">${trendArrow} ${escapeHtml(p.trend_direction) || 'Stable'}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="font-size: 10px; color: #94A3B8;">Cases</span>
              <span style="font-size: 10px; font-weight: 600; color: #0F2D52;">${formatNum(p.total_cases)}</span>
            </div>
          </div>
        `;
        layer.bindTooltip(tooltipHtml, { className: 'barangay-tooltip', sticky: true, direction: 'top', offset: [0, -10] });
        layer.on('mouseover', (e) => { highlightFeature(e); setHoveredBarangay(p.name); });
        layer.on('mouseout', (e) => { resetHighlight(e, geojsonLayer); setHoveredBarangay(null); });
        layer.on('click', () => handlePolygonClick(feature, layer));
      },
    }).addTo(map);
    geojsonLayerRef.current = geojsonLayer;
    buildLabels(map, filteredFeatures, labelsRef);
    const onZoom = () => buildLabels(map, filteredFeatures, labelsRef);
    map.on('zoomend', onZoom);
    map.fitBounds(PASIG_BOUNDS, { padding: [40, 40] });
    return () => { map.off('zoomend', onZoom); };
  }, [data, filteredFeatures, handlePolygonClick]);

  // Linked hover: highlight polygon on map when hovering table row
  useEffect(() => {
    if (!geojsonLayerRef.current) return;
    geojsonLayerRef.current.eachLayer(layer => {
      if (!layer.feature) return;
      const name = layer.feature.properties?.name;
      if (name === hoveredBarangay) {
        layer.setStyle({ weight: 1.5, fillOpacity: 0.8, color: '#4A6FA5' });
        layer.bringToFront();
      } else {
        geojsonLayerRef.current.resetStyle(layer);
      }
    });
  }, [hoveredBarangay]);

  // Timeline animation: update polygon colors per month
  useEffect(() => {
    if (!geojsonLayerRef.current || !data?.features) return;
    if (!timelineMonth) {
      // Reset to default risk colors when not animating
      geojsonLayerRef.current.eachLayer(layer => {
        if (!layer.feature) return;
        geojsonLayerRef.current.resetStyle(layer);
      });
      return;
    }

    // Compute case count per barangay for the current timeline month
    const monthCases = {};
    Object.entries(monthlyByBarangay).forEach(([name, months]) => {
      const entry = months.find(m => m.month === timelineMonth);
      monthCases[name] = entry ? Number(entry.case_count || 0) : 0;
    });

    // Compute incidence per 100k — requires the year-matched population.
    // A missing population must never be faked with a denominator of 1
    // (that would invent an enormous incidence); such barangays are
    // excluded from the coloring below and keep their default risk color.
    const withIncidence = data.features.map(f => {
      const name = f.properties?.name;
      const pop = f.properties?.population;
      const cases = monthCases[name] || 0;
      const incidence = pop && pop > 0 ? (cases / pop) * 100000 : null;
      return { name, incidence, cases };
    });

    // Sort by incidence to compute tertiles (only barangays with a valid
    // year-matched population participate)
    const sorted = withIncidence.filter(x => x.incidence != null)
      .sort((a, b) => a.incidence - b.incidence);
    const n = sorted.length;
    const lowMax = Math.floor(n / 3);
    const medMax = Math.floor((2 * n) / 3);
    const riskMap = {};
    sorted.forEach((item, i) => {
      let riskClass;
      if (i < lowMax) riskClass = 'Low';
      else if (i < medMax) riskClass = 'Medium';
      else riskClass = 'High';
      riskMap[item.name] = { riskClass, cases: item.cases, incidence: item.incidence };
    });

    // Update polygon colors
    geojsonLayerRef.current.eachLayer(layer => {
      if (!layer.feature) return;
      const name = layer.feature.properties?.name;
      const risk = riskMap[name];
      if (!risk) return;
      const color = RISK_COLORS[risk.riskClass] || RISK_COLORS['No Data'];
      layer.setStyle({
        fillColor: color,
        weight: 0.5,
        opacity: 1,
        color: 'rgba(0,0,0,0.35)',
        fillOpacity: 0.6,
      });
    });
  }, [timelineMonth, data, monthlyByBarangay]);

  const stats = React.useMemo(() => {
    if (!filteredFeatures.length) return { classes: { High: 0, Medium: 0, Low: 0, 'No Data': 0 }, totalCases: 0, totalPop: 0, total: 0 };
    const features = filteredFeatures.map(f => f.properties);
    const classes = { High: 0, Medium: 0, Low: 0, 'No Data': 0 };
    let totalCases = 0;
    let totalPop = 0;
    for (const f of features) {
      classes[f.risk_class || 'No Data'] = (classes[f.risk_class || 'No Data'] || 0) + 1;
      totalCases += f.total_cases || 0;
      totalPop += f.population || 0;
    }
    return { classes, totalCases, totalPop, total: features.length };
  }, [filteredFeatures]);

  const barangayNames = React.useMemo(() => {
    if (!data?.features) return [];
    return data.features
      .map(f => f.properties?.name)
      .filter(Boolean)
      .sort();
  }, [data]);

  const toggleFullscreen = React.useCallback(() => {
    setIsFullscreen(prev => {
      const next = !prev;
      // Give the DOM time to resize, then tell Leaflet to recalculate
      setTimeout(() => { mapInstance.current?.invalidateSize(); }, 120);
      return next;
    });
  }, []);

  // Listen for Escape key to exit fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e) => { if (e.key === 'Escape') toggleFullscreen(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen, toggleFullscreen]);

  // Listen for gis:viewDetails custom events from map popups
  useEffect(() => {
    const onDetail = (e) => { setSelectedBarangayName(e.detail); };
    window.addEventListener('gis:viewDetails', onDetail);
    return () => window.removeEventListener('gis:viewDetails', onDetail);
  }, []);

  // Fetch barangay detail data when a barangay is selected
  useEffect(() => {
    if (!selectedBarangayName) { setBarangayDetail(null); setBarangayInterventionCount(0); setBarangayTsr(null); return; }
    const controller = new AbortController();
    (async () => {
      setBarangayDetailLoading(true);
      try {
        const [detailRes, interventionsRes, tsrRes] = await Promise.all([
          API.get(`/api/tb/dashboard/barangay/${encodeURIComponent(selectedBarangayName)}`, { signal: controller.signal }),
          API.get('/api/tb/interventions', { params: { barangay: selectedBarangayName, limit: 1 }, signal: controller.signal }),
          // Treatment Success Rate: from GET /api/tb/treatment-success-rate
          // (the cohort-based methodology). Previously computed here from
          // this barangay's outcomes breakdown (diagnosis-date filtered, no
          // cohort) — a DIFFERENT metric under the same label.
          API.get('/api/tb/treatment-success-rate', { params: { barangay: selectedBarangayName }, signal: controller.signal })
            .catch(() => ({ data: null })),
        ]);
        setBarangayDetail(detailRes.data);
        setBarangayInterventionCount(interventionsRes.data.pagination?.total || 0);
        setBarangayTsr(tsrRes.data);
      } catch (err) {
        if (err.name !== 'CanceledError' && err.name !== 'AbortError') {
          setBarangayDetail(null); setBarangayInterventionCount(0); setBarangayTsr(null);
        }
      } finally {
        if (!controller.signal.aborted) setBarangayDetailLoading(false);
      }
    })();
    return () => controller.abort();
  }, [selectedBarangayName]);

  // Build timeline data: { 'YYYY-MM': { barangayName: caseCount } }
  const timelineMonths = React.useMemo(() => {
    if (!data?.features) return [];
    const allMonths = new Set();
    Object.values(monthlyByBarangay).forEach(arr => arr.forEach(m => allMonths.add(m.month)));
    return [...allMonths].sort();
  }, [data, monthlyByBarangay]);

  // Export map as PDF via browser print
  const handleExportMap = useCallback(() => {
    window.print();
  }, []);

  // Stop animation and reset timeline when year filter changes
  useEffect(() => {
    if (animationIntervalRef.current) {
      clearInterval(animationIntervalRef.current);
      animationIntervalRef.current = null;
    }
    setIsAnimating(false);
    setTimelineMonth(null);
  }, [filterYear]);

  // Refresh map data
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [geoData, grouped] = await Promise.all([
        fetchGeoData(),
        fetchMonthlyData(),
      ]);
      setData(geoData);
      setError(null);
      setMonthlyByBarangay(grouped);
    } catch {
      // silently ignore
    } finally {
      setRefreshing(false);
    }
  }, [fetchGeoData, fetchMonthlyData]);

  // Timeline animation
  const animateTimeline = useCallback(() => {
    if (timelineMonths.length === 0) return;
    setIsAnimating(true);
    let idx = 0;
    const interval = setInterval(() => {
      if (idx >= timelineMonths.length) {
        clearInterval(interval);
        animationIntervalRef.current = null;
        setIsAnimating(false);
        setTimelineMonth(null);
        return;
      }
      setTimelineMonth(timelineMonths[idx]);
      idx++;
    }, 800);
    animationIntervalRef.current = interval;
  }, [timelineMonths]);

  // Clean up animation interval on unmount
  useEffect(() => {
    return () => {
      if (animationIntervalRef.current) {
        clearInterval(animationIntervalRef.current);
        animationIntervalRef.current = null;
      }
    };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid #DBEAFE', boxShadow: '0 4px 24px rgba(15, 45, 82, 0.10), 0 1px 4px rgba(15, 45, 82, 0.06)' }}>
          <div className="px-5 py-3.5" style={{ borderBottom: '1px solid #DBEAFE' }}>
            <div className="h-5 w-48 rounded mb-2" style={{ background: '#E2E8F0' }} />
            <div className="h-3 w-72 rounded" style={{ background: '#F1F5F9' }} />
          </div>
          <div style={{ height: 450, background: '#F1F5F9' }} className="flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#DBEAFE', borderTopColor: '#2563EB' }} />
              <p className="text-xs font-medium" style={{ color: '#94A3B8' }}>Loading map data...</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15, 45, 82, 0.12), 0 2px 8px rgba(15, 45, 82, 0.08)' }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex flex-col px-5 py-5 relative">
              <div className="h-3 w-20 rounded mb-3" style={{ background: '#E2E8F0' }} />
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <div className="h-8 w-16 rounded" style={{ background: '#F1F5F9' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center" style={{ background: '#F8FAFC', height: 'calc(100vh - 72px)', margin: '-24px', width: 'calc(100% + 48px)' }}>
        <div className="text-center">
          <i className="ri-error-warning-line text-4xl mb-2 block" style={{ color: '#EF4444' }} />
          <p style={{ color: '#EF4444' }}>Failed to load map</p>
          <p className="text-sm mt-1" style={{ color: '#94A3B8' }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">

      {/* Print-only title */}
      <div className="gis-print-title hidden">
        <h1>GIS Hotspot Mapping — TB Surveillance</h1>
        <p>Pasig City Health Department | Generated {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      {/* ── Header + Map (connected) ── */}
      <div
        className={isFullscreen ? '' : 'rounded-xl overflow-hidden'}
        style={isFullscreen
          ? { position: 'fixed', inset: 0, zIndex: 9999, background: '#0a1128' }
          : { background: 'rgba(255,255,255,0.8)', border: '1px solid #DBEAFE', boxShadow: '0 4px 24px rgba(15, 45, 82, 0.10), 0 1px 4px rgba(15, 45, 82, 0.06)' }
        }
      >
        {/* Header Toolbar — hidden in fullscreen */}
        {!isFullscreen && (
        <div className="gis-toolbar flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: '1px solid #DBEAFE' }}>
          {/* Left — Title */}
          <div className="shrink-0">
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>GIS Hotspot Mapping</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Visualize TB cases across Pasig City and identify barangays with higher TB risk.</p>
          </div>

          {/* Right — Filters + Actions */}
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterSelect label="Barangay" value={filterBarangay} onChange={(v) => { setFilterBarangay(v); setSelectedBarangayName(null); }} selectStyle={{ maxWidth: 180 }}>
              <option value="">All</option>
              {barangayNames.map((b) => <option key={b} value={b}>{b}</option>)}
            </FilterSelect>

            <FilterSelect label="Risk" value={filterRiskLevel} onChange={(v) => { setFilterRiskLevel(v); setSelectedBarangayName(null); }}>
              <option value="">All</option>
              <option value="High">High Risk</option>
              <option value="Medium">Moderate</option>
              <option value="Low">Low Risk</option>
            </FilterSelect>

            <FilterSelect label="Year" value={filterYear} onChange={(v) => { setFilterYear(v); setSelectedBarangayName(null); }}>
              <option value="">All Years</option>
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </FilterSelect>

            {/* Risk classification is a per-year snapshot: selecting a Year
                shows THAT year's own assessment (using only data through
                that year — see the admin "Backfill Historical Risk
                Snapshots" action), never a different year's data
                relabeled. "All Years" shows the latest snapshot. If a
                specific year has no snapshot computed yet, say so plainly
                instead of implying one is missing due to an error. */}
            {(() => {
              if (!filterYear) {
                return data?.meta?.risk_assessment_period ? (
                  <span
                    className="text-[10px] font-semibold px-2 py-1.5 rounded-md shrink-0"
                    style={{ background: '#F8FAFC', color: '#64748B', border: '1px solid #E2E8F0' }}
                    title="Showing the most recent risk assessment. Select a specific Year to see that year's own snapshot."
                  >
                    Risk Assessment: Latest ({riskAssessmentYear ?? '—'})
                  </span>
                ) : null;
              }
              if (data?.meta?.requested_year_has_snapshot === false) {
                return (
                  <span
                    className="text-[10px] font-semibold px-2 py-1.5 rounded-md shrink-0"
                    style={{ background: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}
                    title="An administrator can compute this from Forecasting > Backfill Historical Risk Snapshots."
                  >
                    No risk snapshot for {filterYear} yet
                  </span>
                );
              }
              return data?.meta?.risk_assessment_period ? (
                <span
                  className="text-[10px] font-semibold px-2 py-1.5 rounded-md shrink-0"
                  style={{ background: '#F8FAFC', color: '#64748B', border: '1px solid #E2E8F0' }}
                >
                  Risk Assessment for {filterYear}
                </span>
              ) : null;
            })()}

            {hasActiveFilters && (
              <button
                onClick={() => { setFilterBarangay(''); setFilterRiskLevel(''); setFilterYear(''); setSelectedBarangayName(null); }}
                aria-label="Clear all filters"
                className="text-xs font-medium px-3 py-2"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}
              >
                Clear Filters
              </button>
            )}

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refresh map data"
              className="text-xs font-semibold px-3 py-2"
              style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s', opacity: refreshing ? 0.7 : 1 }}
              onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}
            >
              <i className={`ri-refresh-line text-xs mr-1 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>

            <button
              onClick={handleExportMap}
              aria-label="Export map as PDF"
              className="text-xs font-semibold px-3.5 py-2"
              style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}
            >
              Export Map
            </button>

            <button
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              className="text-xs font-semibold w-8 h-8 flex items-center justify-center"
              style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              <i className={`${isFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'} text-sm`} />
            </button>
          </div>
        </div>
        )}

        {/* ── Pipeline status banner ──
            State comes from GET /api/tb/pipeline/status `current_run`.
            Shown while a run is active, or when the map has no risk scores. */}
        {(() => {
          if (isFullscreen) return null;
          const feats = data?.features || [];
          const noScores = feats.length > 0 && feats.every(f => !f.properties?.risk_class || f.properties.risk_class === 'No Data');
          const running = !!pipelineRun?.running;
          if (!running && !noScores) return null;

          let bg, fg, border, icon, text;
          if (running) {
            bg = '#EFF6FF'; fg = '#1E40AF'; border = '#DBEAFE';
            icon = 'ri-loader-4-line animate-spin';
            text = <>Risk classification is currently being generated
              {pipelineRun.startedAt ? ` (started ${new Date(pipelineRun.startedAt).toLocaleTimeString()})` : ''}. Please refresh shortly.</>;
          } else if (pipelineRun?.lastError || pipelineRun?.lastRunStatus === 'error') {
            bg = '#FEF2F2'; fg = '#B91C1C'; border = '#FECACA';
            icon = 'ri-error-warning-line';
            text = <>Risk classification could not be generated. An administrator may rerun the analysis pipeline.</>;
          } else if (pipelineRun?.lastRunStatus === 'no_data') {
            bg = '#F8FAFC'; fg = '#475569'; border = '#E2E8F0';
            icon = 'ri-database-2-line';
            text = <>Insufficient data are available to generate a risk classification for the selected period.</>;
          } else {
            bg = '#FFFBEB'; fg = '#B45309'; border = '#FDE68A';
            icon = 'ri-time-line';
            text = <>Risk classifications are not yet available for the current data. Risk analysis is processed
              automatically after validated records are synchronized. If processing fails, an administrator can
              rerun the analysis pipeline.</>;
          }
          return (
            <div
              className="gis-toolbar px-5 py-2.5 flex items-center gap-2 text-xs font-semibold"
              style={{ background: bg, color: fg, borderBottom: `1px solid ${border}` }}
            >
              <i className={icon} />
              <span>{text}</span>
            </div>
          );
        })()}

        {/* Map */}
        <div
          className="relative"
          style={isFullscreen
            ? { width: '100%', height: '100%' }
            : { height: '450px', minHeight: '450px' }
          }
        >
        {/* Map */}
        <div ref={mapRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#0a1128' }} />

        {/* ── Floating: Exit Fullscreen button (top-left, only in fullscreen) ── */}
        {isFullscreen && (
          <button
            onClick={toggleFullscreen}
            aria-label="Exit fullscreen"
            className="absolute top-4 left-4 z-[1001] w-8 h-8 flex items-center justify-center text-xs font-medium"
            style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}
            title="Exit Fullscreen"
          >
            <i className="ri-fullscreen-exit-line text-sm" />
          </button>
        )}

        {/* ── Floating: Barangay Count Badge (top-right) ── */}
        <div className="absolute top-4 right-4 z-[1000] flex items-center gap-2">
          {timelineMonth && (
            <div
              className="rounded-lg px-3 py-1.5"
              style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', border: '1px solid #DBEAFE', boxShadow: '0 2px 8px rgba(37, 99, 235, 0.1)' }}
            >
              <span className="text-xs font-bold" style={{ color: '#0F2D52' }}>
                {new Date(timelineMonth.includes('T') ? timelineMonth : timelineMonth + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </span>
            </div>
          )}
          {timelineMonths.length > 0 && !isFullscreen && (
            <button
              onClick={isAnimating ? () => { if (animationIntervalRef.current) { clearInterval(animationIntervalRef.current); animationIntervalRef.current = null; } setIsAnimating(false); setTimelineMonth(null); } : animateTimeline}
              aria-label={isAnimating ? 'Stop timeline animation' : 'Play timeline animation'}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{
                background: isAnimating ? '#EF4444' : 'rgba(255,255,255,0.92)',
                color: isAnimating ? '#ffffff' : '#0F2D52',
                border: `1px solid ${isAnimating ? '#EF4444' : '#DBEAFE'}`,
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 8px rgba(37, 99, 235, 0.1)',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              <i className={`${isAnimating ? 'ri-stop-line' : 'ri-play-line'} mr-1`} />
              {isAnimating ? 'Stop' : 'Animate'}
            </button>
          )}
          <div
            className="rounded-lg px-3 py-1.5"
            style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', border: '1px solid #DBEAFE', boxShadow: '0 2px 8px rgba(37, 99, 235, 0.1)' }}
          >
            <span className="text-xs font-semibold" style={{ color: '#64748B' }}>
              {stats?.total || 0} barangay{(stats?.total || 0) !== 1 ? 's' : ''} shown
            </span>
          </div>
        </div>

        {/* ── Floating: Legend (bottom-right) ── */}
        <div
          className="absolute bottom-4 right-4 z-[1000] rounded-xl p-3.5"
          style={{ background: '#ffffff', border: '1px solid #DBEAFE', minWidth: '160px' }}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color: '#64748B' }}>
            Risk Level
          </p>
          <div className="flex flex-col gap-2">
            {/* Random Forest risk_class only — the legacy weighted score's
                own <=33/34-66/>66 bands do not determine this color and
                must not be shown here as if they did. */}
            {[
              { label: 'High Risk', color: RISK_COLORS.High },
              { label: 'Moderate Risk', color: RISK_COLORS.Medium },
              { label: 'Low Risk', color: RISK_COLORS.Low },
              { label: 'No Data', color: RISK_COLORS['No Data'] },
            ].map(({ label, color }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-[11px] font-medium" style={{ color: '#475569' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        </div>
      </div>

      {/* ── Metric Cards ── */}
      {!isFullscreen && stats && (
        <div className="rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15, 45, 82, 0.12), 0 2px 8px rgba(15, 45, 82, 0.08)' }}>
          <div className="grid grid-cols-2 lg:grid-cols-4">
            {/* 1. Barangays */}
            <div className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center gap-2">
                <i className="ri-stack-line text-sm" style={{ color: '#6B7FA3' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Barangays</span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{stats.total}</p>
              <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
            </div>

            {/* 2. TB Cases */}
            <div className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center gap-2">
                <i className="ri-stethoscope-line text-sm" style={{ color: '#B8956A' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>TB Cases</span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{stats.totalCases.toLocaleString()}</p>
              <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
            </div>

            {/* 3. High-Risk Barangays */}
            <div className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center gap-2">
                <i className="ri-alarm-warning-line text-sm" style={{ color: '#C4886A' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>High-Risk Barangays</span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                {stats.total > 0 && stats.classes?.['No Data'] === stats.total ? 'N/A' : (stats.classes?.High ?? 0)}
              </p>
              <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
            </div>

            {/* 4. Case Density */}
            <div className="flex flex-col px-5 py-5">
              <div className="flex items-center gap-2">
                <i className="ri-node-tree text-sm" style={{ color: '#6B9E9E' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Case Density</span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{(stats.totalCases / PASIG_AREA_KM2).toFixed(1)}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Risk Distribution ── */}
      {!isFullscreen && riskRankingData && (() => {
        const { groups, allBarangays, sections, leftHalf, rightHalf } = riskRankingData;
        const classifiedBarangays = allBarangays.length - (groups['No Data']?.length || 0);
        const totalBarangays = allBarangays.length;
        // Dynamic case-data year range (fetched from /api/tb/gis/years —
        // never hardcoded). Null when no case years exist -> the context
        // line below is hidden rather than showing a fabricated range.
        const minYear = availableYears.length ? availableYears[availableYears.length - 1] : null;
        const maxYear = availableYears.length ? availableYears[0] : null;
        const caseYearRange = minYear && maxYear ? `${minYear}\u2013${maxYear}` : null;
        // All Years drops the per-100k column entirely (every row would be
        // N/A — 30 rows of N/A is clutter without information). A specific
        // year shows the same-year incidence normally.
        const rankCols = !filterYear
          ? '32px 150px 118px 132px 70px'
          : '32px 150px 104px 112px 96px 70px';

        return (
          <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E8ECF1', boxShadow: '0 4px 24px rgba(15,45,82,0.06)' }}>
            {/* Header */}
            <div className="px-6 py-5" style={{ borderBottom: '1px solid #F1F5F9' }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#EF4444' }}>Priority Watchlist</p>
                  <h3 className="text-lg font-extrabold" style={{ color: '#0F2D52' }}>Risk-Classified Barangays</h3>
                  <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>
                    {!filterYear
                      ? `Grouped by latest Random Forest risk classification and ordered by total cases within each group — ${totalBarangays} Pasig City barangays`
                      : `Grouped by Random Forest risk classification and ordered by ${filterYear} incidence within each group — ${totalBarangays} Pasig City barangays`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{classifiedBarangays}</span>
                  <span className="text-sm font-semibold" style={{ color: '#94A3B8' }}>/{totalBarangays}</span>
                  <p className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: '#94A3B8' }}>of Pasig Barangays</p>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-3">
                {sections.map(s => (
                  <div key={s.key} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                    <span className="text-[11px] font-semibold" style={{ color: '#64748B' }}>{s.label}</span>
                  </div>
                ))}
              </div>
              {/* All Years: risk class/confidence come from ONE snapshot while
                  case totals span all available years — state this plainly so
                  the columns are never read as a historical multi-year
                  classification. Hidden entirely when no case years exist
                  (a fabricated year range would be worse than none). */}
              {!filterYear && data?.meta?.risk_assessment_period && caseYearRange && (
                <p className="text-[9px] font-medium mt-2" style={{ color: '#94A3B8' }}>
                  All Years combines available TB records from {caseYearRange}. Risk classification and confidence are based on the latest available risk assessment ({riskAssessmentYear}). Incidence per 100,000 is available only when a specific year is selected.
                </p>
              )}
            </div>

            {/* Table — 2-Column Layout */}
            <div className="overflow-x-auto">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                {/* Helper to render a column */}
                {[leftHalf, rightHalf].map((halfItems, colIdx) => {
                  let colRank = colIdx === 0 ? 0 : leftHalf.length;
                  const halfSections = sections.map(sec => ({
                    ...sec,
                    items: sec.items.filter(item => halfItems.includes(item)),
                  })).filter(sec => sec.items.length > 0);
                  return (
                    <div key={colIdx} style={{ borderRight: colIdx === 0 ? '1px solid #E8ECF1' : 'none' }}>
                      {/* Column Header */}
                      <div className="grid items-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider" style={{ gridTemplateColumns: rankCols, background: '#0F2D52', color: '#ffffff', borderBottom: '1px solid #0F2D52' }}>
                        <span>Rank</span>
                        <span>Barangay</span>
                        <span>{!filterYear ? `Latest Risk Assessment (${riskAssessmentYear ?? '—'})` : 'Risk Class'}</span>
                        <span className="text-right">{!filterYear ? 'Latest Classification Confidence' : 'Classification Confidence'}</span>
                        {filterYear && <span className="text-right">per 100k</span>}
                        <span className="text-right">Actions</span>
                      </div>
                      {/* Grouped Rows */}
                      {halfSections.map(sec => {
                        const sectionStartRank = colRank;
                        colRank += sec.items.length;
                        return (
                        <div key={sec.key}>
                          <div className="px-4 py-2 flex items-center gap-2" style={{ background: `${sec.color}08`, borderBottom: '1px solid #F1F5F9' }}>
                            <span className="w-2 h-2 rounded-full" style={{ background: sec.color }} />
                            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: sec.color }}>{sec.label}</span>
                          </div>
                          {sec.items.map((b, localIdx) => {
                            const rank = sectionStartRank + localIdx + 1;
                            const isHovered = hoveredBarangay === b.name;
                            // Classification Confidence is RF's own
                            // predict_proba for the predicted class — shown
                            // ONLY when the classification actually came from
                            // the trained model. Never fabricated for the
                            // rule-based fallback (— means unavailable).
                            const hasRfConfidence = b.model_type === 'random_forest' && b.classification_confidence != null;
                            return (
                              <div
                                key={b.name}
                                className="grid items-center px-4 py-3 transition"
                                style={{
                                  gridTemplateColumns: rankCols,
                                  borderBottom: '1px solid #F1F5F9',
                                  background: isHovered ? `${sec.color}10` : undefined,
                                }}
                                onMouseEnter={() => setHoveredBarangay(b.name)}
                                onMouseLeave={() => setHoveredBarangay(null)}
                              >
                                <span className="text-sm font-bold" style={{ color: '#CBD5E1' }}>{String(rank).padStart(2, '0')}</span>
                                <div className="flex items-center gap-2 min-w-0 pr-1">
                                  <div className="w-1 h-7 rounded-full shrink-0" style={{ background: sec.color }} />
                                  <div className="min-w-0">
                                    <p className="text-[13px] font-bold truncate" style={{ color: '#0F2D52' }}>{b.name}</p>
                                    <p className="text-[10px] truncate" style={{ color: '#94A3B8' }}>{formatNum(b.total_cases)} total cases</p>
                                  </div>
                                </div>
                                <div className="flex items-center">
                                  {/* "No Assessment" for the No Data group: case
                                      data may exist — only the risk snapshot is
                                      missing for the selected year. */}
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap" style={{ background: `${sec.color}15`, color: sec.color, border: `1px solid ${sec.color}40` }}>{sec.key === 'No Data' ? 'No Assessment' : `${riskLabel(b.risk_class)} Risk`}</span>
                                </div>
                                <div className="text-right" title="How strongly the Random Forest model supports the assigned risk classification. This is not the probability of developing TB.">
                                  {hasRfConfidence ? (
                                    <span className="text-[13px] font-extrabold" style={{ color: sec.color }}>{Math.round(b.classification_confidence * 100)}%</span>
                                  ) : (
                                    <span className="text-[13px] font-bold" style={{ color: '#CBD5E1' }}>—</span>
                                  )}
                                </div>
                                {filterYear && (
                                  <div className="text-right">
                                    <span className="text-[13px] font-bold" style={{ color: b.incidence_per_100k != null ? '#475569' : '#94A3B8' }}>{b.incidence_per_100k != null ? formatNum(b.incidence_per_100k) : 'N/A'}</span>
                                    <p className="text-[9px] font-medium" style={{ color: '#94A3B8' }}>per 100k</p>
                                  </div>
                                )}
                                <div className="flex items-center justify-end">
                                  <button className="px-1.5 py-1 flex items-center justify-center" aria-label={`View details for ${b.name}`} style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }} onClick={() => { setSelectedBarangayName(b.name); }} onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }} onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}><i className="ri-eye-line text-xs" /></button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── NLG GIS Insight Panel ── */}
      {!isFullscreen && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E8ECF1', boxShadow: '0 4px 24px rgba(15,45,82,0.06)' }}>
            <div className="px-6 py-5">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#2563EB' }}>Map Interpretation</p>
              <h3 className="text-lg font-extrabold" style={{ color: '#0F2D52' }}>About This Map</h3>
              <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>
                The panel on the right generates a natural-language interpretation of the current risk distribution, hotspots, and case patterns shown on the map.
              </p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {[
                  { label: 'Focus', value: filterBarangay || 'All Barangays' },
                  { label: 'Year Filter', value: filterYear || 'Latest' },
                  { label: 'Risk Level Filter', value: filterRiskLevel || 'All' },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg px-3 py-2" style={{ background: '#F8FAFC', border: '1px solid #E8ECF1' }}>
                    <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>{item.label}</p>
                    <p className="text-[13px] font-bold truncate" style={{ color: '#0F2D52' }}>{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div>
            <AiInsightPanel
              type="gis"
              data={gisInsight}
              loading={gisInsightLoading}
              error={gisInsightError}
              onRetry={handleGenerateGisInsight}
              onGenerate={handleGenerateGisInsight}
            />
          </div>
        </div>
      )}

      {/* ── Barangay Side Modal (Profile + Analytics tabs) ── */}
      {selectedBarangayName && (
        <div className="fixed inset-0 z-[1200] flex justify-end bg-slate-950/20 backdrop-blur-sm">
          {/* Backdrop */}
          <div className="absolute inset-0" onClick={() => setSelectedBarangayName(null)} />
          {/* Panel */}
          <div
            className="relative w-full max-w-lg h-full overflow-y-auto bg-white"
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedBarangayName} barangay profile`}
            style={{
              boxShadow: '-8px 0 40px rgba(15, 45, 82, 0.12)',
              animation: 'slide-in-right 0.3s ease-out both',
            }}
          >
            {/* Header */}
            <div className="sticky top-0 z-10" style={{ background: '#0F2D52' }}>
              <div className="flex items-center justify-between px-6 py-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#93C5FD' }}>Barangay Profile</p>
                  <h2 className="text-base font-extrabold tracking-tight" style={{ color: '#ffffff' }}>{selectedBarangayName}</h2>
                </div>
                <button
                  ref={closeButtonRef}
                  onClick={() => setSelectedBarangayName(null)}
                  aria-label="Close modal"
                  className="inline-flex h-8 w-8 items-center justify-center shrink-0"
                  style={{ background: 'rgba(255,255,255,0.15)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, transition: 'background 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
                >
                  <i className="ri-close-line text-base" />
                </button>
              </div>
            </div>

            {/* Loading state */}
            {barangayDetailLoading && (
              <div className="flex items-center justify-center py-20">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#DBEAFE', borderTopColor: '#2563EB' }} />
                  <p className="text-xs font-medium" style={{ color: '#94A3B8' }}>Loading barangay data...</p>
                </div>
              </div>
            )}

            {/* Content */}
            {!barangayDetailLoading && modalData && (() => {
              const { merged, riskColor, totalOutcomeCases, activeCases, successRate, trendChartData, demoChartData, outcomeChartData } = modalData;

              // ── Unified View ──
              return (
                <div className="px-6 py-5 space-y-5">
                  {/* Hero + Key Metrics */}
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <div>
                        <h3 className="text-lg font-extrabold" style={{ color: '#0F2D52' }}>{merged.name || selectedBarangayName}</h3>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: `${riskColor}15`, color: riskColor }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: riskColor }} />
                          {riskLabel(merged.risk_class)}{merged.risk_class ? ' Risk' : ''}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div className="rounded-lg p-3" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                        <span className="text-[10px] font-bold uppercase" style={{ color: '#64748B' }}>Total Cases</span>
                        <p className="text-xl font-extrabold mt-1" style={{ color: '#0F2D52' }}>{formatNum(merged.total_cases)}</p>
                      </div>
                      <div className="rounded-lg p-3" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                        <span className="text-[10px] font-bold uppercase" style={{ color: '#64748B' }}>Incidence / 100k</span>
                        <p className="text-xl font-extrabold mt-1" style={{ color: '#0F2D52' }}>{formatNum(merged.incidence_per_100k)}</p>
                      </div>
                       <div className="rounded-lg p-3" style={{ background: '#F1F5F9', border: '1px solid #E2E8F0' }}>
                        <span className="text-[10px] font-bold uppercase" style={{ color: '#64748B' }}>Active Cases</span>
                        <p className="text-xl font-extrabold mt-1" style={{ color: '#2563EB' }}>{activeCases}</p>
                      </div>
                       <div className="rounded-lg p-3" style={{ background: successRate !== '—' && Number(successRate) >= 85 ? '#F1F8F1' : '#FDF8F0', border: `1px solid ${successRate !== '—' && Number(successRate) >= 85 ? '#D4EDDA' : '#F5E6CC'}` }}>
                        <span className="text-[10px] font-bold uppercase" style={{ color: '#64748B' }}>Success Rate</span>
                        <p className="text-xl font-extrabold mt-1" style={{ color: successRate !== '—' && Number(successRate) >= 85 ? '#16A34A' : '#EA580C' }}>{successRate}%</p>
                      </div>
                       <div className="rounded-lg p-3 col-span-2" style={{ background: '#F0F5F4', border: '1px solid #D1D5DB' }}>
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[10px] font-bold uppercase" style={{ color: '#64748B' }}>Active Interventions</span>
                            <p className="text-xl font-extrabold mt-1" style={{ color: '#0D9488' }}>{barangayInterventionCount}</p>
                          </div>
                          {barangayInterventionCount === 0 && (
                            <button
                              onClick={() => navigate(`/interventions?barangay=${encodeURIComponent(selectedBarangayName)}`)}
                              className="text-[10px] font-semibold px-2.5 py-1 rounded-md transition-colors"
                               style={{ background: '#E2E8F0', color: '#374151' }}
                              onMouseEnter={e => { e.currentTarget.style.background = '#99F6E4'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = '#CCFBF1'; }}
                            >
                              <i className="ri-add-line mr-0.5" />Create
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid #E2E8F0' }} />

                  {/* Cases Over Time + Month-over-Month */}
                  {trendChartData.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Cases Over Time</h4>
                      {(() => {
                        const last = trendChartData[trendChartData.length - 1]?.cases || 0;
                        const prev = trendChartData.length >= 2 ? (trendChartData[trendChartData.length - 2]?.cases || 0) : 0;
                        const delta = prev > 0 ? (((last - prev) / prev) * 100).toFixed(1) : null;
                        const isUp = last > prev;
                        return delta !== null && prev > 0 ? (
                          <div className="flex items-center gap-1.5 mb-3">
                             <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: isUp ? '#FEF2F2' : '#ECFDF5', color: isUp ? '#991B1B' : '#047857' }}>
                              <i className={`ri-arrow-${isUp ? 'up' : 'down'}-line text-[10px]`} />
                              {delta}%
                            </span>
                            <span className="text-[10px] font-medium" style={{ color: '#94A3B8' }}>vs previous month</span>
                          </div>
                        ) : null;
                      })()}
                      <div style={{ height: 180 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={trendChartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                            <defs>
                              <linearGradient id="gisAreaGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.2} />
                                <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94A3B8' }} />
                            <YAxis tick={{ fontSize: 9, fill: '#94A3B8' }} allowDecimals={false} />
                            <Tooltip
                              contentStyle={{ background: '#0F2D52', border: 'none', borderRadius: 8, color: '#fff', fontSize: 11 }}
                              labelStyle={{ color: '#94A3B8', fontSize: 10 }}
                              itemStyle={{ color: '#fff' }}
                            />
                            <Area type="monotone" dataKey="cases" stroke="#3B82F6" strokeWidth={2} fill="url(#gisAreaGrad)" name="Cases" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid #E2E8F0' }} />

                  {/* Risk Classification — the RF classifier's own output and
                      inputs. This is the authoritative classification; the
                      legacy weighted index below is a separate, optional
                      analytical view, never the explanation for this. */}
                  {merged.risk_class && (
                    <div>
                      {/* All Years shows the NEWEST snapshot only — label it as
                          such (with the assessment year) so one year's RF
                          output is never read as an all-history classification. */}
                      <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>
                        {!filterYear && data?.meta?.risk_assessment_period
                          ? `Latest Risk Assessment (${riskAssessmentYear ?? '—'})`
                          : 'Risk Classification'}
                      </h4>
                      {/* Selected year has case data but no risk snapshot —
                          contextual note inside this section (the page-level
                          yellow banner already covers it globally). */}
                      {filterYear && data?.meta?.requested_year_has_snapshot === false && (
                        <p className="text-[11px] mb-3 leading-relaxed" style={{ color: '#B45309' }}>
                          <i className="ri-error-warning-line mr-1" />
                          No risk assessment exists for {filterYear}. Case data and population information may still be available below.
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="rounded-lg p-3" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                          <span className="text-[10px] font-bold uppercase" style={{ color: '#64748B' }}>Risk Level</span>
                          <p className="text-lg font-extrabold mt-1" style={{ color: riskColor }}>
                            {/* "No Assessment" not "No Data": case data may
                                exist for this year — only the snapshot is
                                missing, and the latest one is never
                                substituted. */}
                            {filterYear && merged.risk_class === 'No Data'
                              ? 'No Assessment'
                              : riskLabel(merged.risk_class)}
                          </p>
                        </div>
                        <div className="rounded-lg p-3" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                          <span className="text-[10px] font-bold uppercase" style={{ color: '#64748B' }}>{!filterYear ? 'Latest Classification Confidence' : 'Classification Confidence'}</span>
                          <p className="text-lg font-extrabold mt-1" style={{ color: '#0F2D52' }}>
                            {merged.model_type === 'random_forest' && merged.classification_confidence != null
                              ? `${Math.round(merged.classification_confidence * 100)}%`
                              : 'N/A'}
                          </p>
                        </div>
                      </div>
                      {merged.model_type && merged.model_type !== 'random_forest' && (
                        <p className="text-[11px] mb-3 leading-relaxed" style={{ color: '#B45309' }}>
                          <i className="ri-error-warning-line mr-1" />
                          Produced by a rule-based fallback, not the trained Random Forest model — confidence is not meaningful for a rule-based result.
                        </p>
                      )}
                      {merged.rf_features && (
                        <>
                          <p className="text-[10px] font-bold uppercase mb-2" style={{ color: '#64748B' }}>Indicators Used</p>
                          <p className="text-[10px] mb-2 leading-relaxed" style={{ color: '#94A3B8' }}>
                            The values the model was given for this classification — not individually-ranked reasons.
                          </p>
                          <div className="space-y-1.5">
                            {RF_FEATURE_ORDER.filter(k => k in merged.rf_features).map(key => (
                              <div key={key} className="flex items-center justify-between text-[11px]">
                                <span className="font-semibold" style={{ color: '#475569' }}>{RF_FEATURE_LABELS[key] || key}</span>
                                <span style={{ color: '#0F2D52' }}>{formatRfFeatureValue(key, merged.rf_features[key])}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Legacy weighted risk_score — a separate analytical
                      index, hidden by default. It does NOT determine
                      risk_class above and must not be read as the reason
                      for it; its own <=33/34-66/>66 bands are internal to
                      this index only. */}
                  {merged.risk_score != null && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowLegacyIndex(v => !v)}
                        className="flex items-center gap-1.5 text-[11px] font-semibold"
                        style={{ color: '#94A3B8' }}
                      >
                        <i className={`ri-arrow-${showLegacyIndex ? 'down' : 'right'}-s-line`} />
                        Analytical Risk Index (legacy, separate from RF classification)
                      </button>
                      {showLegacyIndex && (
                        <div className="mt-3">
                          <p className="text-[10px] mb-3 leading-relaxed" style={{ color: '#94A3B8' }}>
                            A separate weighted formula kept for research/audit comparison. It does not determine the Risk Level above.
                          </p>
                          <div className="space-y-2.5">
                            {(() => {
                              const factors = [
                                { label: 'Incidence', weight: 0.45, value: merged.norm_incidence || 0 },
                                { label: 'Trend', weight: 0.25, value: merged.norm_trend || 0 },
                                { label: 'Neighbor Risk', weight: 0.20, value: merged.norm_neighbor_risk || 0 },
                                { label: 'Forecast Error', weight: 0.10, value: merged.norm_forecast_error || 0 },
                              ];
                              return factors.map(f => {
                                const pct = Math.min(f.value * 100, 100);
                                return (
                                  <div key={f.label}>
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-[11px] font-semibold" style={{ color: '#475569' }}>{f.label} <span style={{ color: '#94A3B8' }}>({Math.round(f.weight * 100)}%)</span></span>
                                      <span className="text-[10px] font-bold" style={{ color: '#64748B' }}>{pct.toFixed(0)}%</span>
                                    </div>
                                    <div className="h-2 rounded-full overflow-hidden" style={{ background: '#E2E8F0' }}>
                                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: '#94A3B8' }} />
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                            <div className="flex items-center justify-between text-[11px] pt-1">
                              <span className="font-semibold" style={{ color: '#475569' }}>Index score (0-100)</span>
                              <span className="font-bold" style={{ color: '#64748B' }}>{formatNum(merged.risk_score)}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid #E2E8F0' }} />

                  {/* Demographics Chart */}
                  {demoChartData.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Demographics</h4>
                      <div style={{ height: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={demoChartData} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis type="number" tick={{ fontSize: 9, fill: '#94A3B8' }} allowDecimals={false} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#64748B' }} width={40} />
                            <Tooltip
                              contentStyle={{ background: '#0F2D52', border: 'none', borderRadius: 8, color: '#fff', fontSize: 11 }}
                              labelStyle={{ color: '#94A3B8', fontSize: 10 }}
                            />
                            <Bar dataKey="Male" fill="#3B82F6" radius={[0, 2, 2, 0]} barSize={10} />
                             <Bar dataKey="Female" fill="#B48EAD" radius={[0, 2, 2, 0]} barSize={10} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex items-center gap-4 mt-2 justify-center">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#3B82F6' }} />
                          <span className="text-[10px] font-medium" style={{ color: '#64748B' }}>Male</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                           <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#B48EAD' }} />
                          <span className="text-[10px] font-medium" style={{ color: '#64748B' }}>Female</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid #E2E8F0' }} />

                  {/* Outcomes Donut Chart */}
                  {outcomeChartData.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Treatment Outcomes</h4>
                      <div className="flex items-center gap-4">
                        <div style={{ width: 140, height: 140 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={outcomeChartData}
                                cx="50%"
                                cy="50%"
                                innerRadius={35}
                                outerRadius={60}
                                dataKey="value"
                                stroke="none"
                              >
                                {outcomeChartData.map((entry, i) => (
                                  <Cell key={i} fill={entry.color} />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={{ background: '#0F2D52', border: 'none', borderRadius: 8, color: '#fff', fontSize: 11 }}
                                formatter={(value, name) => [`${value} cases`, name]}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="flex-1 space-y-1.5">
                          {outcomeChartData.map((o) => {
                            const pct = totalOutcomeCases > 0 ? ((o.value / totalOutcomeCases) * 100).toFixed(1) : 0;
                            return (
                              <div key={o.name} className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: o.color }} />
                                <span className="text-[10px] font-medium flex-1 truncate" style={{ color: '#475569' }}>{o.name}</span>
                                <span className="text-[10px] font-bold" style={{ color: '#0F2D52' }}>{pct}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid #E2E8F0' }} />

                  {/* Barangay Profile (compact) */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Barangay Profile</h4>
                    <div className="space-y-2.5">
                      <DetailRow label="Population" value={formatNum(merged.population)} />
                      <DetailRow label="Risk Score" value={formatNum(merged.risk_score)} />
                      <DetailRow label="Trend Direction" value={merged.trend_direction || '—'} />
                      <DetailRow label="Forecasted Cases" value={formatNum(merged.forecasted_count)} />
                    </div>
                  </div>

                  {/* Empty state */}
                  {!barangayDetail && !barangayDetailLoading && (
                    <div className="text-center py-10">
                      <i className="ri-information-line text-3xl mb-2 block" style={{ color: '#CBD5E1' }} />
                      <p className="text-xs" style={{ color: '#94A3B8' }}>No data available for this barangay.</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}