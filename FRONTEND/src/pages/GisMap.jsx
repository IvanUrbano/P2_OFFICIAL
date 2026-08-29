import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import API from '../api/axios';

const RISK_COLORS = {
  High: '#EF4444',
  Medium: '#F97316',
  Low: '#FBBF24',
  'No Data': '#64748B',
};

const PASIG_BOUNDS = L.latLngBounds([14.48, 121.02], [14.64, 121.13]);
const MAX_BOUNDS = L.latLngBounds([14.3, 120.85], [14.85, 121.25]);

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
  layer.setStyle({ weight: 1.5, fillOpacity: 0.8, color: '#00bfff' });
  layer.bringToFront();
}

function resetHighlight(e, layer) {
  layer?.resetStyle(e.target);
}

function formatNum(n) {
  return n != null ? Number(n).toLocaleString() : '\u2014';
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>{label}</span>
      <span className="text-[12px] font-bold" style={{ color: '#0F2D52' }}>{value || '\u2014'}</span>
    </div>
  );
}

function buildLabels(map, features, layerRef) {
  layerRef.current.forEach(l => { try { map.removeLayer(l); } catch {} });
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

function SectionHeader({ icon, iconColor, title, right }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded flex items-center justify-center" style={{ background: `${iconColor}15` }}>
          <i className={`${icon} text-xs`} style={{ color: iconColor }} />
        </div>
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>
          {title}
        </span>
      </div>
      {right}
    </div>
  );
}

export default function GisMap() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const geojsonLayerRef = useRef(null);
  const outlineLayerRef = useRef(null);
  const labelsRef = useRef([]);
  const [data, setData] = useState(null);
  const [monthlyByBarangay, setMonthlyByBarangay] = useState({});
  const [error, setError] = useState(null);
  const [filterBarangay, setFilterBarangay] = useState('');
  const [filterRiskLevel, setFilterRiskLevel] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedBarangayName, setSelectedBarangayName] = useState(null);
  const [barangayDetail, setBarangayDetail] = useState(null);
  const [barangayDetailLoading, setBarangayDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await API.get('/api/tb/gis/geojson');
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load map data');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await API.get('/api/tb/dashboard/monthly');
        const rows = res.data.monthly || [];
        const grouped = {};
        rows.forEach(r => {
          const name = r.barangay_name;
          if (!grouped[name]) grouped[name] = [];
          grouped[name].push({ month: r.month, case_count: r.case_count });
        });
        Object.values(grouped).forEach(arr => arr.sort((a, b) => a.month.localeCompare(b.month)));
        if (!cancelled) setMonthlyByBarangay(grouped);
      } catch {}
    })();
    return () => { cancelled = true; };
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
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map);
    mapInstance.current = map;
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    requestAnimationFrame(() => { map.invalidateSize(); });
    return () => { map.remove(); mapInstance.current = null; };
  }, []);

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

  const hasActiveFilters = filterBarangay || filterRiskLevel;

  useEffect(() => {
    if (!mapInstance.current || !data) return;
    const map = mapInstance.current;
    if (geojsonLayerRef.current) map.removeLayer(geojsonLayerRef.current);
    if (outlineLayerRef.current) map.removeLayer(outlineLayerRef.current);
    labelsRef.current.forEach(l => { try { map.removeLayer(l); } catch {} });
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
        const popupContent = `
          <div style="font-family: Inter, sans-serif; min-width: 230px;">
            <!-- Header -->
            <div style="margin-bottom: 10px;">
              <div style="font-size: 15px; font-weight: 700; color: #ffffff;">${p.name || 'Unknown'}</div>
              <span style="display: inline-block; margin-top: 4px; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; background: ${riskColor}22; color: ${riskColor}; text-transform: uppercase; letter-spacing: 0.5px;">${p.risk_class || 'No Data'} Risk</span>
            </div>
            <!-- Divider -->
            <div style="height: 1px; background: rgba(255,255,255,0.08); margin-bottom: 10px;"></div>
            <!-- Stats -->
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; color: #94a3b8;">Risk Score</span>
                <span style="font-size: 12px; font-weight: 600; color: #ffffff;">${formatNum(p.risk_score)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; color: #94a3b8;">Incidence / 100k</span>
                <span style="font-size: 12px; font-weight: 600; color: #ffffff;">${formatNum(p.incidence_per_100k)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; color: #94a3b8;">Trend</span>
                <span style="font-size: 12px; font-weight: 600; color: #ffffff;">${trendArrow} ${p.trend_direction || 'Stable'}</span>
              </div>
            </div>
            <!-- Divider -->
            <div style="height: 1px; background: rgba(255,255,255,0.08); margin: 10px 0;"></div>
            <!-- Forecasted & Cases -->
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; color: #94a3b8;">Forecasted Cases</span>
                <span style="font-size: 12px; font-weight: 600; color: #ffffff;">${formatNum(p.forecasted_count)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; color: #94a3b8;">Total Cases</span>
                <span style="font-size: 12px; font-weight: 600; color: #ffffff;">${formatNum(p.total_cases)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; color: #94a3b8;">Population</span>
                <span style="font-size: 12px; font-weight: 600; color: #ffffff;">${formatNum(p.population)}</span>
              </div>
            </div>
            <!-- Divider -->
            <div style="height: 1px; background: rgba(255,255,255,0.08); margin: 10px 0;"></div>
            <!-- Action Buttons -->
            <div style="display: flex; gap: 8px;">
              <button onclick="window.dispatchEvent(new CustomEvent('gis:viewAnalytics', { detail: '${p.name || ''}' }))" style="flex: 1; padding: 8px 0; font-size: 11px; font-weight: 700; border: none; border-radius: 8px; cursor: pointer; background: #0F2D52; color: #ffffff; transition: opacity 0.15s;" onmouseenter="this.style.opacity='0.85'" onmouseleave="this.style.opacity='1'">View Analytics</button>
              <button onclick="window.dispatchEvent(new CustomEvent('gis:viewDetails', { detail: '${p.name || ''}' }))" style="flex: 1; padding: 8px 0; font-size: 11px; font-weight: 700; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; cursor: pointer; background: transparent; color: #ffffff; transition: background 0.15s;" onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='transparent'">Details</button>
            </div>
          </div>
        `;
        layer.bindPopup(popupContent, { className: 'tb-popup', maxWidth: 300, closeButton: true });
        layer.on('mouseover', highlightFeature);
        layer.on('mouseout', (e) => resetHighlight(e, geojsonLayer));
      },
    }).addTo(map);
    geojsonLayerRef.current = geojsonLayer;
    buildLabels(map, filteredFeatures, labelsRef);
    const onZoom = () => buildLabels(map, filteredFeatures, labelsRef);
    map.on('zoomend', onZoom);
    map.fitBounds(PASIG_BOUNDS, { padding: [40, 40] });
    return () => { map.off('zoomend', onZoom); };
  }, [data, filteredFeatures]);
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

  const topRisk = React.useMemo(() => {
    return filteredFeatures
      .map(f => f.properties)
      .sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0))
      .slice(0, 8);
  }, [filteredFeatures]);

  const riskDist = React.useMemo(() => {
    if (!filteredFeatures.length) return [];
    const maxScore = Math.max(...filteredFeatures.map(f => f.properties?.risk_score || 0), 1);
    return filteredFeatures
      .map(f => f.properties)
      .sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0))
      .slice(0, 15)
      .map(f => ({
        name: f.name,
        score: f.risk_score || 0,
        pct: ((f.risk_score || 0) / maxScore) * 100,
        risk_class: f.risk_class || 'No Data',
      }));
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
    if (!selectedBarangayName) { setBarangayDetail(null); return; }
    let cancelled = false;
    (async () => {
      setBarangayDetailLoading(true);
      try {
        const res = await API.get(`/api/tb/dashboard/barangay/${encodeURIComponent(selectedBarangayName)}`);
        if (!cancelled) setBarangayDetail(res.data);
      } catch {
        if (!cancelled) setBarangayDetail(null);
      } finally {
        if (!cancelled) setBarangayDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedBarangayName]);

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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: '1px solid #DBEAFE' }}>
          {/* Left — Title */}
          <div className="shrink-0">
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>GIS Hotspot Mapping</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Visualize TB cases across Pasig City and identify barangays with higher TB risk.</p>
          </div>

          {/* Right — Filters + Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none" style={{ color: '#94A3B8' }}>Barangay:</span>
              <select
                value={filterBarangay}
                onChange={(e) => setFilterBarangay(e.target.value)}
                className="rounded-lg pl-[74px] pr-7 py-[7px] text-[11px] font-semibold outline-none transition cursor-pointer appearance-none"
                style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' }}
              >
                <option value="">All</option>
                {barangayNames.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style={{ color: '#64748B' }} />
            </div>

            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none" style={{ color: '#94A3B8' }}>Risk:</span>
              <select
                value={filterRiskLevel}
                onChange={(e) => setFilterRiskLevel(e.target.value)}
                className="rounded-lg pl-[38px] pr-7 py-[7px] text-[11px] font-semibold outline-none transition cursor-pointer appearance-none"
                style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' }}
              >
                <option value="">All</option>
                <option value="High">High Risk</option>
                <option value="Medium">Moderate</option>
                <option value="Low">Low Risk</option>
              </select>
              <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style={{ color: '#64748B' }} />
            </div>

            {hasActiveFilters && (
              <button
                onClick={() => { setFilterBarangay(''); setFilterRiskLevel(''); }}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition hover:opacity-80"
                style={{ color: '#EF4444' }}
              >
                <i className="ri-close-circle-line text-sm" />
                Clear Filters
              </button>
            )}

            <button
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition hover:opacity-80"
              style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#0F2D52' }}
            >
              <i className="ri-download-2-line text-sm" style={{ color: '#2563EB' }} />
              Export Map
            </button>

            <button
              onClick={toggleFullscreen}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition hover:opacity-80"
              style={{ background: '#0F2D52', color: '#ffffff' }}
            >
              <i className={`ri-${isFullscreen ? 'fullscreen-exit' : 'fullscreen'}-line text-sm`} />
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
          </div>
        </div>
        )}

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
            className="absolute top-4 left-4 z-[1001] flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition hover:opacity-80"
            style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', border: '1px solid #DBEAFE', boxShadow: '0 2px 8px rgba(37, 99, 235, 0.1)', color: '#0F2D52' }}
          >
            <i className="ri-fullscreen-exit-line text-sm" style={{ color: '#2563EB' }} />
            Exit Fullscreen
          </button>
        )}

        {/* ── Floating: Barangay Count Badge (top-right) ── */}
        <div
          className="absolute top-4 right-4 z-[1000] rounded-lg px-3 py-1.5"
          style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', border: '1px solid #DBEAFE', boxShadow: '0 2px 8px rgba(37, 99, 235, 0.1)' }}
        >
          <span className="text-xs font-semibold" style={{ color: '#64748B' }}>
            {stats?.total || 0} barangay{(stats?.total || 0) !== 1 ? 's' : ''} shown
          </span>
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
            {[
              { label: 'High Risk (>80 cases)', color: '#EF4444' },
              { label: 'Moderate (50-80)', color: '#F97316' },
              { label: 'Low Risk (<50)', color: '#10B981' },
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
                <i className="ri-stack-line text-base" style={{ color: '#3B82F6' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Barangays</span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{stats.total}</p>
              <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
            </div>

            {/* 2. TB Cases */}
            <div className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center gap-2">
                <i className="ri-stethoscope-line text-base" style={{ color: '#F59E0B' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>TB Cases</span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{stats.totalCases.toLocaleString()}</p>
              <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
            </div>

            {/* 3. High-Risk Barangays */}
            <div className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center gap-2">
                <i className="ri-alarm-warning-line text-base" style={{ color: '#DC2626' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>High-Risk Barangays</span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{stats.classes?.High || 0}</p>
              <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
            </div>

            {/* 4. Case Density */}
            <div className="flex flex-col px-5 py-5">
              <div className="flex items-center gap-2">
                <i className="ri-node-tree text-base" style={{ color: '#2563EB' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Case Density</span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{(stats.totalCases / 31.3).toFixed(1)}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Risk Distribution ── */}
      {!isFullscreen && data?.features && (() => {
        const groups = { High: [], Medium: [], Low: [], 'No Data': [] };
        data.features.forEach(f => {
          const p = f.properties;
          if (!p || !p.name) return;
          const cls = p.risk_class || 'No Data';
          if (groups[cls]) groups[cls].push(p);
        });
        Object.keys(groups).forEach(k => {
          groups[k].sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0));
        });

        const allBarangays = [...groups.High, ...groups.Medium, ...groups.Low, ...groups['No Data']];
        const maxScore = Math.max(...allBarangays.map(b => b.risk_score || 0), 1);

        const sections = [
          { key: 'High', label: 'High Risk', subtitle: 'Immediate Action Required', color: '#EF4444', items: groups.High },
          { key: 'Medium', label: 'Moderate Risk', subtitle: 'Close Monitoring Recommended', color: '#F97316', items: groups.Medium },
          { key: 'Low', label: 'Low Risk', subtitle: 'Routine Surveillance', color: '#FBBF24', items: groups.Low },
        ].filter(s => s.items.length > 0);

        let globalRank = 0;

        return (
          <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E8ECF1', boxShadow: '0 4px 24px rgba(15,45,82,0.06)' }}>
            {/* Header */}
            <div className="px-6 py-5" style={{ borderBottom: '1px solid #F1F5F9' }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#EF4444' }}>Priority Watchlist</p>
                  <h3 className="text-lg font-extrabold" style={{ color: '#0F2D52' }}>Risk-Ranked Barangays</h3>
                  <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>Grouped by risk classification — {allBarangays.length} Pasig City barangays</p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{allBarangays.length}</span>
                  <span className="text-sm font-semibold" style={{ color: '#94A3B8' }}>/30</span>
                  <p className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: '#94A3B8' }}>of Pasig Barangays</p>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-3">
                {sections.map(s => (
                  <div key={s.key} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                    <span className="text-[11px] font-semibold" style={{ color: '#64748B' }}>{s.label} ({s.items.length})</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              {/* Column Headers */}
              <div className="grid items-center px-6 py-2.5 text-[10px] font-bold uppercase tracking-wider" style={{ gridTemplateColumns: '32px 140px 900px 60px 80px auto', background:'#0F2D52', color: '#ffffff', borderBottom: '1px solid #0F2D52' }}>
                <span>Rank</span>
                <span>Barangay</span>
                <span></span>
                <span className="text-right">Score</span>
                <span className="text-right">per 100k</span>
                <span className="text-right">Actions</span>
              </div>

              {/* Grouped Rows */}
              {sections.map(sec => (
                <div key={sec.key}>
                  <div className="px-6 py-2.5 flex items-center gap-2" style={{ background: `${sec.color}08`, borderBottom: '1px solid #F1F5F9' }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: sec.color }} />
                    <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: sec.color }}>{sec.label}</span>
                    <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>— {sec.subtitle}</span>
                    <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: `${sec.color}15`, color: sec.color }}>{sec.items.length}</span>
                  </div>
                  {sec.items.map((b) => {
                    globalRank++;
                    const pct = Math.max(((b.risk_score || 0) / maxScore) * 100, 4);
                    return (
                      <div key={b.name} className="grid items-center px-6 py-3.5 transition hover:bg-slate-50/60" style={{ gridTemplateColumns: '32px 140px 900px 60px 80px auto', borderBottom: '1px solid #F1F5F9' }}>
                        <span className="text-sm font-bold" style={{ color: '#CBD5E1' }}>{String(globalRank).padStart(2, '0')}</span>
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          <div className="w-1 h-8 rounded-full shrink-0" style={{ background: sec.color }} />
                          <div className="min-w-0">
                            <p className="text-sm font-bold truncate" style={{ color: '#0F2D52' }}>{b.name}</p>
                            <p className="text-[11px] truncate" style={{ color: '#94A3B8' }}>{formatNum(b.total_cases)} active cases</p>
                          </div>
                        </div>
                        <div className="px-2">
                          <div className="h-2 rounded-full w-full" style={{ background: '#F1F5F9' }}>
                            <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: sec.color }} />
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-extrabold" style={{ color: sec.color }}>{formatNum(b.risk_score)}</span>
                          <p className="text-[10px] font-medium" style={{ color: '#94A3B8' }}>score</p>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold" style={{ color: '#475569' }}>{formatNum(b.incidence_per_100k)}</span>
                          <p className="text-[10px] font-medium" style={{ color: '#94A3B8' }}>per 100k</p>
                        </div>
                        <div className="flex items-center gap-1.5 justify-end">
                          <button className="px-3 py-1.5 text-[11px] font-bold rounded-lg transition hover:opacity-80" style={{ background: '#0F2D52', color: '#ffffff' }} onClick={() => window.dispatchEvent(new CustomEvent('gis:viewAnalytics', { detail: b.name }))}>Analytics</button>
                          <button className="px-3 py-1.5 text-[11px] font-bold rounded-lg transition hover:bg-slate-100" style={{ color: '#0F2D52', border: '1px solid #E2E8F0' }} onClick={() => setSelectedBarangayName(b.name)}>Details</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Barangay Detail Side Modal ── */}
      {selectedBarangayName && (
        <div className="fixed inset-0 z-[1200] flex justify-end bg-slate-950/20 backdrop-blur-sm">
          {/* Backdrop */}
          <div className="absolute inset-0" onClick={() => setSelectedBarangayName(null)} />
          {/* Panel */}
          <div
            className="relative w-full max-w-lg h-full overflow-y-auto bg-white"
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
                  onClick={() => setSelectedBarangayName(null)}
                  aria-label="Close modal"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:opacity-80"
                  style={{ color: '#93C5FD' }}
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
            {!barangayDetailLoading && (() => {
              // Merge GeoJSON properties with API detail
              const geoProps = data?.features?.find(f => f.properties?.name === selectedBarangayName)?.properties || {};
              const b = barangayDetail?.barangay || {};
              const outcomes = barangayDetail?.outcomes || [];
              const demographics = barangayDetail?.demographics || [];
              const monthly = barangayDetail?.monthly || [];
              const merged = { ...geoProps, ...b };

              const riskColor = RISK_COLORS[merged.risk_class] || '#64748B';
              const totalOutcomeCases = outcomes.reduce((s, o) => s + (o.total || 0), 0);

              // Outcome colors
              const outcomeColors = {
                'CURED': '#10B981',
                'TREATMENT COMPLETED': '#22C55E',
                'ON TREATMENT': '#3B82F6',
                'LOST TO FOLLOW-UP': '#F97316',
                'DIED': '#EF4444',
                'EXCLUDED': '#64748B',
                'FAILED': '#EF4444',
                'DEFAULTED': '#F97316',
              };

              // Demographics summary
              const totalMale = demographics.filter(d => d.sex === 'Male').reduce((s, d) => s + (d.total || 0), 0);
              const totalFemale = demographics.filter(d => d.sex === 'Female').reduce((s, d) => s + (d.total || 0), 0);

              return (
                <div className="px-6 py-5 space-y-6">
                  {/* Hero: Barangay name + Risk badge */}
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: `${riskColor}15`, border: `1px solid ${riskColor}30` }}
                      >
                        <i className="ri-building-2-line text-xl" style={{ color: riskColor }} />
                      </div>
                      <div>
                        <h3 className="text-lg font-extrabold" style={{ color: '#0F2D52' }}>{merged.name || selectedBarangayName}</h3>
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                          style={{ background: `${riskColor}15`, color: riskColor }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: riskColor }} />
                          {merged.risk_class || 'No Data'} Risk
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid #E2E8F0' }} />

                  {/* Section: Barangay Profile */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>
                      <i className="ri-information-line mr-1" style={{ color: '#2563EB' }} />
                      Barangay Profile
                    </h4>
                    <div className="space-y-2.5">
                      <DetailRow label="Population" value={formatNum(merged.population)} />
                      <DetailRow label="Total Cases" value={formatNum(merged.total_cases)} />
                      <DetailRow label="Incidence / 100k" value={formatNum(merged.incidence_per_100k)} />
                      <DetailRow label="Risk Score" value={formatNum(merged.risk_score)} />
                      <DetailRow label="Trend Direction" value={merged.trend_direction || '—'} />
                      <DetailRow label="Forecasted Cases" value={formatNum(merged.forecasted_count)} />
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid #E2E8F0' }} />

                  {/* Section: Demographics */}
                  {demographics.length > 0 && (
                    <>
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>
                          <i className="ri-team-line mr-1" style={{ color: '#2563EB' }} />
                          Demographics
                        </h4>
                        {/* Gender split summary */}
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          <div className="rounded-xl p-3" style={{ background: '#EFF6FF', border: '1px solid #DBEAFE' }}>
                            <div className="flex items-center gap-2 mb-1">
                              <i className="ri-men-line text-sm" style={{ color: '#2563EB' }} />
                              <span className="text-[10px] font-bold uppercase" style={{ color: '#64748B' }}>Male</span>
                            </div>
                            <p className="text-xl font-extrabold" style={{ color: '#0F2D52' }}>{totalMale}</p>
                          </div>
                          <div className="rounded-xl p-3" style={{ background: '#FDF2F8', border: '1px solid #FBCFE8' }}>
                            <div className="flex items-center gap-2 mb-1">
                              <i className="ri-women-line text-sm" style={{ color: '#EC4899' }} />
                              <span className="text-[10px] font-bold uppercase" style={{ color: '#64748B' }}>Female</span>
                            </div>
                            <p className="text-xl font-extrabold" style={{ color: '#0F2D52' }}>{totalFemale}</p>
                          </div>
                        </div>
                        {/* Age group breakdown */}
                        <div className="space-y-2">
                          {(() => {
                            const ageGroups = {};
                            demographics.forEach(d => {
                              if (!ageGroups[d.age_group]) ageGroups[d.age_group] = { Male: 0, Female: 0 };
                              ageGroups[d.age_group][d.sex] = (d.total || 0);
                            });
                            const maxAgeCount = Math.max(...Object.values(ageGroups).map(v => v.Male + v.Female), 1);
                            return Object.entries(ageGroups).sort((a, b) => a[0].localeCompare(b[0])).map(([age, counts]) => {
                              const total = counts.Male + counts.Female;
                              const pct = (total / maxAgeCount) * 100;
                              return (
                                <div key={age}>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[11px] font-semibold" style={{ color: '#475569' }}>{age}</span>
                                    <span className="text-[11px] font-bold" style={{ color: '#0F2D52' }}>{total}</span>
                                  </div>
                                  <div className="flex h-2 rounded-full overflow-hidden" style={{ background: '#E2E8F0' }}>
                                    <div style={{ width: `${(counts.Male / total) * pct}%`, background: '#3B82F6' }} />
                                    <div style={{ width: `${(counts.Female / total) * pct}%`, background: '#EC4899' }} />
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>
                      <div style={{ borderTop: '1px solid #E2E8F0' }} />
                    </>
                  )}

                  {/* Section: Treatment Outcomes */}
                  {outcomes.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>
                        <i className="ri-thermometer-line mr-1" style={{ color: '#2563EB' }} />
                        Treatment Outcomes
                      </h4>
                      {/* Outcome summary cards */}
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        {outcomes.slice(0, 6).map((o) => {
                          const color = outcomeColors[o.outcome_status] || '#64748B';
                          const pct = totalOutcomeCases > 0 ? ((o.total / totalOutcomeCases) * 100).toFixed(1) : 0;
                          return (
                            <div key={o.outcome_status} className="rounded-lg p-2.5 text-center" style={{ background: `${color}08`, border: `1px solid ${color}20` }}>
                              <p className="text-lg font-extrabold" style={{ color }}>{o.total}</p>
                              <p className="text-[9px] font-bold uppercase leading-tight mt-0.5" style={{ color: '#64748B' }}>
                                {o.outcome_status?.length > 18 ? o.outcome_status.slice(0, 16) + '...' : o.outcome_status}
                              </p>
                              <p className="text-[10px] font-semibold mt-0.5" style={{ color }}>{pct}%</p>
                            </div>
                          );
                        })}
                      </div>
                      {/* Outcome bars */}
                      <div className="space-y-2.5">
                        {outcomes.map((o) => {
                          const color = outcomeColors[o.outcome_status] || '#64748B';
                          const pct = totalOutcomeCases > 0 ? (o.total / totalOutcomeCases) * 100 : 0;
                          return (
                            <div key={o.outcome_status}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] font-semibold" style={{ color: '#475569' }}>{o.outcome_status}</span>
                                <span className="text-[11px] font-bold" style={{ color: '#0F2D52' }}>{o.total} <span style={{ color: '#94A3B8' }}>({pct.toFixed(1)}%)</span></span>
                              </div>
                              <div className="h-2 rounded-full overflow-hidden" style={{ background: '#E2E8F0' }}>
                                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Section: Monthly Trend (if available) */}
                  {monthly.length > 0 && (
                    <>
                      <div style={{ borderTop: '1px solid #E2E8F0' }} />
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>
                          <i className="ri-bar-chart-grouped-line mr-1" style={{ color: '#2563EB' }} />
                          Monthly Case Trend
                        </h4>
                        <div className="flex items-end gap-1" style={{ height: '80px' }}>
                          {monthly.slice(-12).map((m, i) => {
                            const maxCount = Math.max(...monthly.slice(-12).map(x => x.case_count || 0), 1);
                            const h = ((m.case_count || 0) / maxCount) * 100;
                            const monthLabel = m.month ? new Date(m.month).toLocaleString('default', { month: 'short' }) : '';
                            return (
                              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                <div
                                  className="w-full rounded-t transition-all"
                                  style={{ height: `${h}%`, background: '#3B82F6', minHeight: '2px', opacity: 0.8 }}
                                  title={`${monthLabel}: ${m.case_count}`}
                                />
                                <span className="text-[8px] font-medium" style={{ color: '#94A3B8' }}>{monthLabel}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Empty state */}
                  {!barangayDetail && !barangayDetailLoading && (
                    <div className="text-center py-10">
                      <i className="ri-information-line text-3xl mb-2 block" style={{ color: '#CBD5E1' }} />
                      <p className="text-xs" style={{ color: '#94A3B8' }}>No detail data available for this barangay.</p>
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