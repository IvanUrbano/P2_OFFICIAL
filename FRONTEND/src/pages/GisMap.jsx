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
  const [filterYear, setFilterYear] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterBarangay, setFilterBarangay] = useState('');
  const [filterRiskLevel, setFilterRiskLevel] = useState('');

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
    const geojsonLayer = L.geoJSON(data, {
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
              <button onclick="window.dispatchEvent(new CustomEvent('gis:viewAnalytics', { detail: '${p.name || ''}' }))" style="flex: 1; padding: 8px 0; font-size: 11px; font-weight: 700; border: none; border-radius: 10px; cursor: pointer; background: #0F2D52; color: #ffffff; transition: opacity 0.15s;" onmouseenter="this.style.opacity='0.85'" onmouseleave="this.style.opacity='1'">View Analytics</button>
              <button onclick="window.dispatchEvent(new CustomEvent('gis:viewDetails', { detail: '${p.name || ''}' }))" style="flex: 1; padding: 8px 0; font-size: 11px; font-weight: 700; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; cursor: pointer; background: transparent; color: #ffffff; transition: background 0.15s;" onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='transparent'">Details</button>
            </div>
          </div>
        `;
        layer.bindPopup(popupContent, { className: 'tb-popup', maxWidth: 300, closeButton: true });
        layer.on('mouseover', highlightFeature);
        layer.on('mouseout', (e) => resetHighlight(e, geojsonLayer));
      },
    }).addTo(map);
    geojsonLayerRef.current = geojsonLayer;
    buildLabels(map, data.features, labelsRef);
    const onZoom = () => buildLabels(map, data.features, labelsRef);
    map.on('zoomend', onZoom);
    map.fitBounds(PASIG_BOUNDS, { padding: [40, 40] });
    return () => { map.off('zoomend', onZoom); };
  }, [data]);
  const stats = React.useMemo(() => {
    if (!data?.features) return null;
    const features = data.features.map(f => f.properties);
    const classes = { High: 0, Medium: 0, Low: 0, 'No Data': 0 };
    let totalCases = 0;
    let totalPop = 0;
    for (const f of features) {
      classes[f.risk_class || 'No Data'] = (classes[f.risk_class || 'No Data'] || 0) + 1;
      totalCases += f.total_cases || 0;
      totalPop += f.population || 0;
    }
    return { classes, totalCases, totalPop, total: features.length };
  }, [data]);

  const topRisk = React.useMemo(() => {
    if (!data?.features) return [];
    return data.features
      .map(f => f.properties)
      .sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0))
      .slice(0, 8);
  }, [data]);

  const riskDist = React.useMemo(() => {
    if (!data?.features) return [];
    const maxScore = Math.max(...data.features.map(f => f.properties?.risk_score || 0), 1);
    return data.features
      .map(f => f.properties)
      .sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0))
      .slice(0, 15)
      .map(f => ({
        name: f.name,
        score: f.risk_score || 0,
        pct: ((f.risk_score || 0) / maxScore) * 100,
        risk_class: f.risk_class || 'No Data',
      }));
  }, [data]);

  const barangayNames = React.useMemo(() => {
    if (!data?.features) return [];
    return data.features
      .map(f => f.properties?.name)
      .filter(Boolean)
      .sort();
  }, [data]);

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
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.8)',
          border: '1px solid #DBEAFE',
          boxShadow: '0 4px 20px rgba(37, 99, 235, 0.08)',
        }}
      >
        {/* Header Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: '1px solid #DBEAFE' }}>
          {/* Left — Title */}
          <div className="shrink-0">
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>GIS Hotspot Mapping</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Visualize TB cases across Pasig City and identify barangays with higher TB risk.</p>
          </div>

          {/* Right — Filters + Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="rounded-lg px-3 py-2 text-xs font-medium outline-none transition"
              style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#64748B' }}
            >
              <option value="">All Years</option>
              <option value="2025">2025</option>
              <option value="2024">2024</option>
              <option value="2023">2023</option>
            </select>

            <select
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="rounded-lg px-3 py-2 text-xs font-medium outline-none transition"
              style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#64748B' }}
            >
              <option value="">All Months</option>
              {["January","February","March","April","May","June","July","August","September","October","November","December"].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            <select
              value={filterBarangay}
              onChange={(e) => setFilterBarangay(e.target.value)}
              className="rounded-lg px-3 py-2 text-xs font-medium outline-none transition"
              style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#64748B' }}
            >
              <option value="">All Barangays</option>
              {barangayNames.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>

            <select
              value={filterRiskLevel}
              onChange={(e) => setFilterRiskLevel(e.target.value)}
              className="rounded-lg px-3 py-2 text-xs font-medium outline-none transition"
              style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#64748B' }}
            >
              <option value="">All Risk Levels</option>
              <option value="High">High Risk</option>
              <option value="Medium">Moderate</option>
              <option value="Low">Low Risk</option>
            </select>

            <button
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition hover:opacity-80"
              style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#0F2D52' }}
            >
              <i className="ri-download-2-line text-sm" style={{ color: '#2563EB' }} />
              Export Map
            </button>

            <button
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition hover:opacity-80"
              style={{ background: '#0F2D52', color: '#ffffff' }}
            >
              <i className="ri-fullscreen-line text-sm" />
              Fullscreen
            </button>
          </div>
        </div>

        {/* Map */}
        <div
          className="relative"
          style={{ height: 'calc(100vh - 260px)', minHeight: '500px' }}
        >
        {/* Map */}
        <div ref={mapRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#0a1128' }} />

        {/* ── Floating: Year Badge (top-left) ── */}
        <div
          className="absolute top-4 left-4 z-[1000] flex items-center gap-1.5 rounded-lg px-3 py-1.5"
          style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', border: '1px solid #DBEAFE', boxShadow: '0 2px 8px rgba(37, 99, 235, 0.1)' }}
        >
          <i className="ri-calendar-line text-xs" style={{ color: '#2563EB' }} />
          <span className="text-xs font-bold" style={{ color: '#0F2D52' }}>2025</span>
        </div>

        {/* ── Floating: Barangay Count Badge (top-right) ── */}
        <div
          className="absolute top-4 right-4 z-[1000] rounded-lg px-3 py-1.5"
          style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', border: '1px solid #DBEAFE', boxShadow: '0 2px 8px rgba(37, 99, 235, 0.1)' }}
        >
          <span className="text-xs font-semibold" style={{ color: '#64748B' }}>
            {stats?.total || 0} barangays shown
          </span>
        </div>

        {/* ── Floating: Legend (bottom-left) ── */}
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
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Barangays */}
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid #DBEAFE', boxShadow: '0 4px 20px rgba(37, 99, 235, 0.08)' }}>
            <div className="p-5 pb-3 flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold" style={{ color: '#64748B' }}>Barangays</p>
                <p className="text-3xl font-extrabold mt-1" style={{ color: '#0F2D52' }}>{stats.total}</p>
              </div>
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: '#DBEAFE' }}>
                <i className="ri-building-line text-base" style={{ color: '#2563EB' }} />
              </div>
            </div>
            <div className="flex items-center justify-between px-5 py-2.5" style={{ borderTop: '1px solid #1E40AF', background: '#0F2D52' }}>
              <span className="text-[11px] font-semibold" style={{ color: '#93C5FD' }}>Total Coverage Area</span>
            </div>
          </div>

          {/* TB Cases */}
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid #DBEAFE', boxShadow: '0 4px 20px rgba(37, 99, 235, 0.08)' }}>
            <div className="p-5 pb-3 flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold" style={{ color: '#64748B' }}>TB Cases</p>
                <p className="text-3xl font-extrabold mt-1" style={{ color: '#0F2D52' }}>{stats.totalCases.toLocaleString()}</p>
              </div>
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: '#DBEAFE' }}>
                <i className="ri-heart-pulse-line text-base" style={{ color: '#2563EB' }} />
              </div>
            </div>
            <div className="flex items-center justify-between px-5 py-2.5" style={{ borderTop: '1px solid #1E40AF', background: '#0F2D52' }}>
              <span className="text-[11px] font-semibold" style={{ color: '#93C5FD' }}>All Recorded Cases</span>
            </div>
          </div>

          {/* High-Risk Barangays */}
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid #DBEAFE', boxShadow: '0 4px 20px rgba(37, 99, 235, 0.08)' }}>
            <div className="p-5 pb-3 flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold" style={{ color: '#64748B' }}>High-Risk Barangays</p>
                <p className="text-3xl font-extrabold mt-1" style={{ color: '#0F2D52' }}>{stats.classes?.High || 0}</p>
              </div>
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: '#FEE2E2' }}>
                <i className="ri-shield-star-line text-base" style={{ color: '#EF4444' }} />
              </div>
            </div>
            <div className="flex items-center justify-between px-5 py-2.5" style={{ borderTop: '1px solid #1E40AF', background: '#0F2D52' }}>
              <span className="text-[11px] font-semibold" style={{ color: '#93C5FD' }}>Barangays at High Risk</span>
            </div>
          </div>

          {/* Case Density */}
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid #DBEAFE', boxShadow: '0 4px 20px rgba(37, 99, 235, 0.08)' }}>
            <div className="p-5 pb-3 flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold" style={{ color: '#64748B' }}>Case Density</p>
                <p className="text-3xl font-extrabold mt-1" style={{ color: '#0F2D52' }}>{(stats.totalCases / 31.3).toFixed(1)}</p>
              </div>
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: '#DBEAFE' }}>
                <i className="ri-map-2-line text-base" style={{ color: '#2563EB' }} />
              </div>
            </div>
            <div className="flex items-center justify-between px-5 py-2.5" style={{ borderTop: '1px solid #1E40AF', background: '#0F2D52' }}>
              <span className="text-[11px] font-semibold" style={{ color: '#93C5FD' }}>Cases per km² (31.3 km²)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}