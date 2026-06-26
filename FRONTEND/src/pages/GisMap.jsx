import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import API from '../api/axios';

/* ─── Risk class colors ─── */
const RISK_COLORS = {
  High: '#EF4444',
  Medium: '#F59E0B',
  Low: '#10B981',
  'No Data': '#6B7280',
};

const RISK_BG = {
  High: 'rgba(239, 68, 68, 0.08)',
  Medium: 'rgba(245, 158, 11, 0.08)',
  Low: 'rgba(16, 185, 129, 0.08)',
  'No Data': 'rgba(107, 114, 128, 0.08)',
};

/* Pasig City approximate bounds (SW, NE) */
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
  return n != null ? Number(n).toLocaleString() : '—';
}

function buildLabels(map, features, layerRef) {
  layerRef.current.forEach(l => { try { map.removeLayer(l); } catch { } });
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

/* ─── Sub-components ─── */

function SectionHeader({ icon, iconColor, title, right }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: `${iconColor}15` }}
        >
          <i className={`${icon} text-xs`} style={{ color: iconColor }} />
        </div>
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {title}
        </span>
      </div>
      {right}
    </div>
  );
}

function BarangayDetailPanel({ data, historicalCases, onClose }) {
  const riskColor = RISK_COLORS[data.risk_class] || RISK_COLORS['No Data'];
  const arrow = data.trend_direction === 'Increasing' ? '↑' : data.trend_direction === 'Decreasing' ? '↓' : '→';

  const rows = [
    { label: 'Current Cases', value: formatNum(data.total_cases) },
    { label: 'Predicted Cases', value: formatNum(data.forecasted_count) },
    { divider: true },
    { label: 'Trend', value: `${arrow} ${data.trend_direction || 'Stable'}` },
    { divider: true },
    { label: 'Incidence', value: data.incidence_per_100k != null ? `${Number(data.incidence_per_100k).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} /100,000` : '—' },
    { label: 'Population', value: formatNum(data.population) },
    { label: 'Historical Cases', value: historicalCases != null ? historicalCases.toLocaleString() : '—' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="px-5 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: riskColor, boxShadow: `0 0 8px ${riskColor}55` }}
            />
            <span className="text-sm font-bold" style={{ color: 'rgba(255,255,255,0.9)' }}>
              {data.name}
            </span>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider"
              style={{ background: `${riskColor}20`, color: riskColor }}
            >
              {data.risk_class}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-5 h-5 rounded flex items-center justify-center transition-colors"
            style={{ color: 'rgba(255,255,255,0.25)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.25)'}
          >
            <i className="ri-close-line text-xs" />
          </button>
        </div>
      </div>

      {/* Data rows */}
      <div className="px-5 py-3" style={{ fontFamily: 'monospace', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {rows.map((row, i) => {
          if (row.divider) {
            return <div key={`d-${i}`} className="my-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }} />;
          }
          return (
            <div key={row.label} className="flex items-center justify-between py-1.5">
              <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{row.label}</span>
              <span className="text-[12px] font-bold tabular-nums" style={{ color: 'rgba(255,255,255,0.85)' }}>{row.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Page Component ─── */
export default function GisMap() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const geojsonLayerRef = useRef(null);
  const outlineLayerRef = useRef(null);
  const labelsRef = useRef([]);
  const [data, setData] = useState(null);
  const [monthlyByBarangay, setMonthlyByBarangay] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedBarangay, setSelectedBarangay] = useState(null);

  /* Fetch GeoJSON once */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await API.get('/api/tb/gis/geojson');
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load map data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* Pre-fetch all monthly data once, grouped by barangay name */
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
        // Sort each barangay's months chronologically
        Object.values(grouped).forEach(arr => arr.sort((a, b) => a.month.localeCompare(b.month)));
        if (!cancelled) setMonthlyByBarangay(grouped);
      } catch {
        // Non-critical — detail panel will show "—" for historical cases
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (loading) return;
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
  }, [loading]);

  useEffect(() => {
    if (!mapInstance.current || !data) return;

    const map = mapInstance.current;

    if (geojsonLayerRef.current) map.removeLayer(geojsonLayerRef.current);
    if (outlineLayerRef.current) map.removeLayer(outlineLayerRef.current);
    labelsRef.current.forEach(l => { try { map.removeLayer(l); } catch { } });
    labelsRef.current = [];

    if (data.outline) {
      const outlineLayer = L.geoJSON(
        { type: 'Feature', properties: {}, geometry: data.outline },
        {
          style: { fillColor: '#1a1a2e', fillOpacity: 0.85, weight: 0, opacity: 0 },
          interactive: false,
        }
      ).addTo(map);
      outlineLayerRef.current = outlineLayer;
    }

    const geojsonLayer = L.geoJSON(data, {
      style: riskStyle,
      onEachFeature: (feature, layer) => {
        const p = feature.properties || {};
        const popupContent = `
          <div style="font-family: Inter, sans-serif; min-width: 220px;">
            <div style="font-size: 15px; font-weight: 700; margin-bottom: 8px; color: #0f172a;">
              ${p.name || 'Unknown'}
            </div>
            <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
              <tr><td style="padding: 3px 8px 3px 0; color: #64748b;">Risk Class</td><td style="padding: 3px 0; font-weight: 600; color: ${RISK_COLORS[p.risk_class] || '#6B7280'};">${p.risk_class || 'No Data'}</td></tr>
              <tr><td style="padding: 3px 8px 3px 0; color: #64748b;">Risk Score</td><td style="padding: 3px 0; font-weight: 600;">${formatNum(p.risk_score)}</td></tr>
              <tr><td style="padding: 3px 8px 3px 0; color: #64748b;">Incidence / 100k</td><td style="padding: 3px 0; font-weight: 600;">${formatNum(p.incidence_per_100k)}</td></tr>
              <tr><td style="padding: 3px 8px 3px 0; color: #64748b;">Trend</td><td style="padding: 3px 0; font-weight: 600;">${p.trend_direction === 'Increasing' ? '↑' : p.trend_direction === 'Decreasing' ? '↓' : '→'} ${p.trend_direction || 'Stable'}</td></tr>
              <tr><td style="padding: 3px 8px 3px 0; color: #64748b;">Forecasted Cases</td><td style="padding: 3px 0; font-weight: 600;">${formatNum(p.forecasted_count)}</td></tr>
              <tr><td style="padding: 3px 8px 3px 0; color: #64748b;">Total Cases</td><td style="padding: 3px 0; font-weight: 600;">${formatNum(p.total_cases)}</td></tr>
              <tr><td style="padding: 3px 8px 3px 0; color: #64748b;">Population</td><td style="padding: 3px 0; font-weight: 600;">${formatNum(p.population)}</td></tr>
            </table>
          </div>
        `;

        layer.bindPopup(popupContent, { className: 'tb-popup', maxWidth: 300, closeButton: true });
        layer.on('click', () => setSelectedBarangay(p));
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
  }, [data, loading]);

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

  if (loading) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ background: '#0a1128', height: 'calc(100vh - 72px)', margin: '-24px', width: 'calc(100% + 48px)' }}
      >
        <div className="text-center">
          <div className="animate-spin w-10 h-10 border-3 border-t-transparent rounded-full mx-auto mb-3" style={{ borderColor: '#2E6FAF', borderTopColor: 'transparent' }} />
          <p style={{ color: 'rgba(255,255,255,0.4)' }}>Initializing map systems...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ background: '#0a1128', height: 'calc(100vh - 72px)', margin: '-24px', width: 'calc(100% + 48px)' }}
      >
        <div className="text-center">
          <i className="ri-error-warning-line text-4xl mb-2 block" style={{ color: '#EF4444' }} />
          <p style={{ color: '#EF4444' }}>Failed to load map</p>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex overflow-hidden"
      style={{
        height: 'calc(100vh - 72px)',
        margin: '-24px',
        width: 'calc(100% + 48px)',
        background: '#0a1128',
      }}
    >

      {/* ═══ LEFT: MAP ═══ */}
      <div className="relative flex-1 min-w-0">
        <div ref={mapRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#0a1128' }} />

        {/* Legend overlay */}
        <div
          className="absolute top-4 left-4 z-[1000] rounded-xl p-3"
          style={{
            background: 'rgba(10,17,32,0.85)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div className="text-[10px] font-bold mb-2 uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
            <i className="ri-palette-line mr-1" style={{ color: '#2E6FAF' }} />
            Risk Level
          </div>
          {[
            { label: 'High', color: '#EF4444' },
            { label: 'Medium', color: '#F59E0B' },
            { label: 'Low', color: '#10B981' },
          ].map(({ label, color }) => (
            <div key={label} className="flex items-center gap-2 mb-1 last:mb-0">
              <div className="w-3 h-2 rounded-sm" style={{ background: color }} />
              <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</span>
              <span className="text-[11px] ml-auto font-bold tabular-nums" style={{ color }}>{stats?.classes?.[label] || 0}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ RIGHT: SIDEBAR ═══ */}
      <div
        className="flex flex-col overflow-y-auto"
        style={{
          width: '340px',
          flexShrink: 0,
          background: '#0c1223',
        }}
      >
        {/* ── Sidebar Header ── */}
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-2.5 mb-1">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #2E6FAF 0%, #174A7E 100%)' }}
            >
              <i className="ri-map-pin-2-fill text-sm" style={{ color: '#fff' }} />
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight" style={{ color: 'rgba(255,255,255,0.92)' }}>
                GIS Risk Map
              </h1>
              <p className="text-[10px] leading-tight" style={{ color: 'rgba(255,255,255,0.3)' }}>
                Geographic distribution of TB risk
              </p>
            </div>
          </div>
        </div>

        <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)' }} />

        {/* ── Stats Grid (2x2) ── */}
        {stats && (
          <div className="grid grid-cols-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {[
              { label: 'Barangays', value: stats.total, icon: 'ri-building-line', color: '#2E6FAF' },
              { label: 'Cases', value: stats.totalCases.toLocaleString(), icon: 'ri-heart-pulse-line', color: '#4FD1C5' },
              { label: 'Population', value: stats.totalPop.toLocaleString(), icon: 'ri-group-line', color: '#10B981' },
              { label: 'Area', value: '31.3 km²', icon: 'ri-map-2-line', color: '#8B5CF6' },
            ].map((m, i) => (
              <div
                key={m.label}
                className="flex items-center gap-2.5 px-5 py-3.5"
                style={{
                  borderRight: i % 2 === 0 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                }}
              >
                <i className={`${m.icon} text-sm`} style={{ color: m.color }} />
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {m.label}
                  </div>
                  <div className="text-sm font-bold tabular-nums" style={{ color: 'rgba(255,255,255,0.88)' }}>
                    {m.value}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Selected Barangay ── */}
        {selectedBarangay && (
          <>
            <BarangayDetailPanel
              data={selectedBarangay}
              historicalCases={
                monthlyByBarangay[selectedBarangay.name]
                  ? monthlyByBarangay[selectedBarangay.name].reduce((s, r) => s + (r.case_count || 0), 0)
                  : null
              }
              onClose={() => setSelectedBarangay(null)}
            />
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)' }} />
          </>
        )}

        {/* ── Risk Distribution ── */}
        <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <SectionHeader icon="ri-bar-chart-grouped-line" iconColor="#2E6FAF" title="Risk Distribution" />
          <div className="flex flex-col gap-2">
            {riskDist.map((b, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className="text-[11px] truncate" style={{ color: 'rgba(255,255,255,0.4)', width: '88px' }}>
                  {b.name}
                </span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{
                    width: `${b.pct}%`,
                    background: `linear-gradient(90deg, ${RISK_COLORS[b.risk_class]}80, ${RISK_COLORS[b.risk_class]})`,
                  }} />
                </div>
                <span className="text-[10px] font-mono tabular-nums" style={{ color: 'rgba(255,255,255,0.3)', width: '32px', textAlign: 'right' }}>
                  {b.score.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Top Risk ── */}
        <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <SectionHeader icon="ri-shield-star-line" iconColor="#EF4444" title="Highest Risk" />
          <div className="flex flex-col gap-1">
            {topRisk.slice(0, 5).map((b, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-2 rounded-lg transition-colors"
                style={{ background: 'transparent' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span
                  className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-black shrink-0"
                  style={{
                    background: i < 2 ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.05)',
                    color: i < 2 ? '#EF4444' : 'rgba(255,255,255,0.3)',
                  }}
                >
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold truncate" style={{ color: 'rgba(255,255,255,0.8)' }}>{b.name}</div>
                  <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
                    {formatNum(b.total_cases)} cases · {formatNum(b.population)} pop
                  </div>
                </div>
                <span className="text-[11px] font-mono font-bold tabular-nums" style={{ color: RISK_COLORS[b.risk_class] }}>
                  {b.risk_score?.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Data Source ── */}
        <div className="px-5 py-3 mt-auto">
          <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.15)' }}>
            <i className="ri-database-2-line mr-1" />
            NAMRIA/PSGC 2023 · ARIMA + Random Forest
          </div>
        </div>
      </div>

    </div>
  );
}
