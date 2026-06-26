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
    weight: 1.5,
    opacity: 1,
    color: 'rgba(255,255,255,0.6)',
    fillOpacity: 0.6,
  };
}

function highlightFeature(e) {
  const layer = e.target;
  layer.setStyle({ weight: 3, fillOpacity: 0.8, color: '#00bfff' });
  layer.bringToFront();
}

function resetHighlight(e, layer) {
  layer?.resetStyle(e.target);
}

function formatNum(n) {
  return n != null ? Number(n).toLocaleString() : '—';
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
        html: '<div class="pasig-city-text">PASIG CITY</div>',
        iconSize: [200, 40],
        iconAnchor: [100, 20],
      }),
    });
    layer.addLayer(pasigLabel);
  }

  if (zoom >= 14) {
    const showNames = zoom >= 14.5;
    for (const f of features) {
      const c = f.properties?.centroid;
      if (!c) continue;

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
  }
  layer.addTo(map);
  layerRef.current = [layer];
}

/* ─── Sub-components ─── */

function SidebarStat({ label, value, icon, color }) {
  return (
    <div
      className="relative rounded-lg overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: color }}
      />
      <div className="pl-3.5 pr-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <i className={`${icon} text-xs`} style={{ color }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {label}
          </span>
        </div>
        <div className="text-lg font-bold" style={{ color: 'rgba(255,255,255,0.9)' }}>{value}</div>
      </div>
    </div>
  );
}

function DetailItem({ label, value }) {
  return (
    <div className="p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>{label}</div>
      <div className="text-xs font-bold mt-0.5" style={{ color: 'rgba(255,255,255,0.85)' }}>{value}</div>
    </div>
  );
}

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

/* ─── Page Component ─── */
export default function GisMap() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const geojsonLayerRef = useRef(null);
  const outlineLayerRef = useRef(null);
  const labelsRef = useRef([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedBarangay, setSelectedBarangay] = useState(null);

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

  useEffect(() => {
    if (loading) return;
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      center: [14.555, 121.075],
      zoom: 15.5,
      zoomControl: false,
      attributionControl: true,
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
    labelsRef.current.forEach(l => { try { map.removeLayer(l); } catch {} });
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
      <div className="flex items-center justify-center rounded-xl" style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(0,0,0,0.04)', aspectRatio: '1 / 1' }}>
        <div className="text-center">
          <div className="animate-spin w-10 h-10 border-3 border-t-transparent rounded-full mx-auto mb-3" style={{ borderColor: '#2E6FAF', borderTopColor: 'transparent' }} />
          <p style={{ color: '#64748b' }}>Loading map data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center rounded-xl" style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(0,0,0,0.04)', aspectRatio: '1 / 1' }}>
        <div className="text-center">
          <i className="ri-error-warning-line text-4xl mb-2 block" style={{ color: '#EF4444' }} />
          <p style={{ color: '#EF4444' }}>Failed to load map</p>
          <p className="text-sm mt-1" style={{ color: '#64748b' }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ─── Page Header ─── */}
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #2E6FAF 0%, #174A7E 100%)' }}
          >
            <i className="ri-map-pin-2-fill text-sm" style={{ color: '#fff' }} />
          </div>
          <h1 className="text-xl font-bold" style={{ color: '#1e293b' }}>
            GIS Risk Map
          </h1>
        </div>
        <p className="text-sm ml-[42px]" style={{ color: '#475569' }}>
          Geographic distribution of TB risk across Pasig City barangays
        </p>
      </div>

      {/* ─── Main layout ─── */}
      <div className="flex gap-4" style={{ minHeight: '700px' }}>

        {/* ─── MAP ─── */}
        <div className="relative rounded-xl overflow-hidden flex-1" style={{ border: '1px solid rgba(0,0,0,0.06)', minWidth: 0 }}>
          <div ref={mapRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#0a1929' }} />

          {/* Legend overlay */}
          <div className="absolute top-4 left-4 z-[1000] rounded-lg p-3" style={{
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(0,0,0,0.06)',
          }}>
            <div className="text-xs font-bold mb-2" style={{ color: '#1e293b' }}>
              <i className="ri-palette-line mr-1" style={{ color: '#2E6FAF' }} />
              Risk Level
            </div>
            {[
              { label: 'High', color: '#EF4444' },
              { label: 'Medium', color: '#F59E0B' },
              { label: 'Low', color: '#10B981' },
            ].map(({ label, color }) => (
              <div key={label} className="flex items-center gap-2 mb-1.5 last:mb-0">
                <div className="w-4 h-2.5 rounded-sm" style={{ background: color }} />
                <span className="text-xs" style={{ color: '#475569' }}>{label}</span>
                <span className="text-xs ml-auto font-bold" style={{ color }}>{stats?.classes?.[label] || 0}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ─── SIDEBAR (dark) ─── */}
        <div
          className="flex flex-col gap-3 overflow-y-auto rounded-xl"
          style={{
            width: '340px',
            flexShrink: 0,
            background: 'rgba(10,17,32,0.92)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.06)',
            padding: '16px',
          }}
        >
          {/* ── Stats Grid ── */}
          {stats && (
            <div className="grid grid-cols-2 gap-2">
              <SidebarStat label="Barangays" value={stats.total} icon="ri-building-line" color="#2E6FAF" />
              <SidebarStat label="Total Cases" value={stats.totalCases.toLocaleString()} icon="ri-heart-pulse-line" color="#4FD1C5" />
              <SidebarStat label="Population" value={stats.totalPop.toLocaleString()} icon="ri-group-line" color="#10B981" />
              <SidebarStat label="Area" value="31.3 km²" icon="ri-map-2-line" color="#8B5CF6" />
            </div>
          )}

          {/* ── Selected Barangay ── */}
          {selectedBarangay && (
            <div
              className="rounded-xl p-4 relative overflow-hidden"
              style={{
                background: RISK_BG[selectedBarangay.risk_class] || RISK_BG['No Data'],
                border: `1px solid ${RISK_COLORS[selectedBarangay.risk_class] || RISK_COLORS['No Data']}30`,
              }}
            >
              <div className="absolute top-0 left-0 w-full h-[2px]" style={{ background: RISK_COLORS[selectedBarangay.risk_class] }} />
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold" style={{ color: 'rgba(255,255,255,0.9)' }}>
                    {selectedBarangay.name}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider" style={{
                    background: RISK_COLORS[selectedBarangay.risk_class],
                    color: '#fff',
                  }}>
                    {selectedBarangay.risk_class}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedBarangay(null)}
                  className="w-6 h-6 rounded flex items-center justify-center transition-colors"
                  style={{ color: 'rgba(255,255,255,0.4)' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.8)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
                >
                  <i className="ri-close-line text-sm" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <DetailItem label="Risk Score" value={formatNum(selectedBarangay.risk_score)} />
                <DetailItem label="Incidence/100k" value={formatNum(selectedBarangay.incidence_per_100k)} />
                <DetailItem label="Trend" value={`${selectedBarangay.trend_direction === 'Increasing' ? '↑' : selectedBarangay.trend_direction === 'Decreasing' ? '↓' : '→'} ${selectedBarangay.trend_direction || 'Stable'}`} />
                <DetailItem label="Forecasted" value={formatNum(selectedBarangay.forecasted_count)} />
                <DetailItem label="Total Cases" value={formatNum(selectedBarangay.total_cases)} />
                <DetailItem label="Population" value={formatNum(selectedBarangay.population)} />
              </div>
            </div>
          )}

          {/* ── Risk Distribution ── */}
          <div className="rounded-xl p-4" style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <SectionHeader icon="ri-bar-chart-grouped-line" iconColor="#2E6FAF" title="Risk Distribution" />
            <div className="flex flex-col gap-2">
              {riskDist.map((b, i) => (
                <div key={i} className="flex items-center gap-2.5 group">
                  <span className="text-[11px] truncate transition-colors" style={{ color: 'rgba(255,255,255,0.4)', width: '88px' }}>
                    {b.name}
                  </span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{
                      width: `${b.pct}%`,
                      background: `linear-gradient(90deg, ${RISK_COLORS[b.risk_class]}99, ${RISK_COLORS[b.risk_class]})`,
                    }} />
                  </div>
                  <span className="text-[11px] font-mono tabular-nums" style={{ color: 'rgba(255,255,255,0.35)', width: '34px', textAlign: 'right' }}>
                    {b.score.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Top Risk Barangays ── */}
          <div className="rounded-xl p-4" style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <SectionHeader icon="ri-shield-star-line" iconColor="#EF4444" title="Highest Risk" />
            <div className="flex flex-col gap-1.5">
              {topRisk.slice(0, 5).map((b, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-2.5 rounded-lg transition-colors cursor-default"
                  style={{ background: 'transparent' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span
                    className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-black shrink-0"
                    style={{
                      background: i === 0 ? 'rgba(239,68,68,0.15)' : i === 1 ? 'rgba(239,68,68,0.10)' : 'rgba(255,255,255,0.06)',
                      color: i < 2 ? '#EF4444' : 'rgba(255,255,255,0.4)',
                    }}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold truncate" style={{ color: 'rgba(255,255,255,0.85)' }}>{b.name}</div>
                    <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {formatNum(b.total_cases)} cases · {formatNum(b.population)} pop
                    </div>
                  </div>
                  <span className="text-xs font-mono font-bold tabular-nums" style={{ color: RISK_COLORS[b.risk_class] }}>
                    {b.risk_score?.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Data Source ── */}
          <div className="rounded-lg px-3 py-2 mt-auto" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
              <i className="ri-database-2-line mr-1" />
              NAMRIA/PSGC 2023 · ARIMA + Random Forest
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
