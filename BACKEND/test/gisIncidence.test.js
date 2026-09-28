/**
 * GIS Year-Specific Incidence + Risk-Ranking UI Contract Tests
 *
 * Covers the corrected incidence methodology:
 *  A. valid population + positive cases -> correct incidence
 *  B. valid population + zero cases -> incidence = 0
 *  C. missing exact-year population + positive cases -> null
 *  D. missing exact-year population + zero cases -> null
 *  E. 2024 request must never use 2025 population
 *  F. 2025 request uses GeoJSON/reference population
 *  G. selected year aligns risk snapshot + cases + population
 *  H. RF risk_class unchanged after incidence display fix
 *  I. legacy risk_score no longer rendered in ranking
 *  J. total_cases labeled "total cases", not "active"
 *  K. Classification Confidence appears only when actual RF confidence exists
 *  L. All Years: lifetime case totals, incidence N/A (never multi-year
 *     cases / one year's population); risk class + confidence from the
 *     latest snapshot only, labeled "Latest ..." in the UI
 *
 * Run: node --test BACKEND/test/gisIncidence.test.js
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

/* ─── Mock pool ─── */
const MODULE_DB = require.resolve('../db');
let mockQueryFn;
let capturedQueries = [];

function installMockDb() {
  require.cache[MODULE_DB] = {
    id: MODULE_DB, filename: MODULE_DB, loaded: true,
    exports: {
      get query() { return mockQueryFn || (async () => ({ rows: [] })); },
      connect: async () => {}, end: async () => {},
    },
  };
}

function uninstallMockDb() {
  delete require.cache[MODULE_DB];
}

function clearTbinsightCache() {
  Object.keys(require.cache)
    .filter(k => k.includes('tbinsight') || k.includes('middleware/auth'))
    .forEach(k => delete require.cache[k]);
}

function buildApp() {
  uninstallMockDb();
  installMockDb();
  clearTbinsightCache();
  capturedQueries = [];

  const app = express();
  app.use(express.json());
  app.use('/api/tb', require('../tbinsight/routes'));
  return app;
}

function loadPopulationService() {
  uninstallMockDb();
  installMockDb();
  clearTbinsightCache();
  delete require.cache[require.resolve('../tbinsight/populationService')];
  return require('../tbinsight/populationService');
}

function teardown() {
  uninstallMockDb();
}

afterEach(teardown);

/**
 * SQL-text dispatcher for the geojson/choropleth endpoints.
 * Records every query so tests can assert SQL + params (year alignment).
 * Config: { geo, risk, forecast, cases, pop, choroplethMain, periodYear }
 */
function makeDispatcher(cfg) {
  capturedQueries = [];
  return async (sql, params) => {
    capturedQueries.push({ sql, params });
    if (sql.includes('EXTRACT(YEAR FROM MAX(period))')) {
      return { rows: cfg.periodYear != null ? [{ y: cfg.periodYear }] : [] };
    }
    if (sql.includes('barangays_geom')) return { rows: cfg.geo || [] };
    if (sql.includes('COALESCE(brs.risk_score')) return { rows: cfg.choroplethMain || [] };
    if (sql.includes('model_predictions')) return { rows: cfg.forecast || [] };
    if (sql.includes('barangay_population')) {
      if (cfg.forbidPopQuery) {
        throw new Error('barangay_population must NOT be queried for this year');
      }
      return { rows: cfg.pop || [] };
    }
    if (sql.includes('barangay_risk_scores')) return { rows: cfg.risk || [] };
    if (sql.includes('FROM tb_cases')) return { rows: cfg.cases || [] };
    return { rows: [] };
  };
}

const POLY = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };

/* ════════════════ A–D: computeYearIncidence unit tests ════════════════ */

describe('computeYearIncidence (populationService)', () => {
  it('A: valid population + positive cases -> correct incidence', () => {
    const { computeYearIncidence } = loadPopulationService();
    assert.strictEqual(computeYearIncidence(600, 50000), 1200);
    assert.strictEqual(computeYearIncidence(17, 2724), 624.08);
    assert.strictEqual(computeYearIncidence(356, 45916), 775.33);
  });

  it('B: valid population + zero cases -> 0 (a real value, not null)', () => {
    const { computeYearIncidence } = loadPopulationService();
    assert.strictEqual(computeYearIncidence(0, 50000), 0);
  });

  it('C: missing exact-year population + positive cases -> null', () => {
    const { computeYearIncidence } = loadPopulationService();
    assert.strictEqual(computeYearIncidence(600, null), null);
    assert.strictEqual(computeYearIncidence(600, undefined), null);
    assert.strictEqual(computeYearIncidence(600, 0), null, 'population 0 is invalid -> null');
  });

  it('D: missing exact-year population + zero cases -> null', () => {
    const { computeYearIncidence } = loadPopulationService();
    assert.strictEqual(computeYearIncidence(0, null), null);
    assert.strictEqual(computeYearIncidence(0, undefined), null);
  });
});

/* ════════════════ E–H: geojson endpoint ════════════════ */

describe('GET /api/tb/gis/geojson — year-specific incidence', () => {
  it('F/H: year=2025 uses GeoJSON population, computes incidence, keeps RF risk_class', async () => {
    mockQueryFn = makeDispatcher({
      geo: [{ id: 1, name: 'San Nicolas', population: 2724, geometry: POLY, centroid_lon: 0.5, centroid_lat: 0.5 }],
      risk: [{ barangay_name: 'San Nicolas', risk_score: 41, risk_class: 'Low', incidence_per_100k: 0, model_type: 'random_forest', classification_confidence: 0.78, trend_direction: 'Stable', period: '2026-01-01' }],
      forecast: [],
      cases: [{ barangay_name: 'San Nicolas', total_cases: 17 }],
      forbidPopQuery: true, // 2025 must come from GeoJSON, never barangay_population
    });
    const res = await request(buildApp()).get('/api/tb/gis/geojson?year=2025');
    assert.strictEqual(res.status, 200);
    const f = res.body.features[0];
    // F: GeoJSON/reference population (17 / 2724 * 100k), no barangay_population query
    assert.strictEqual(f.properties.incidence_per_100k, 624.08);
    assert.strictEqual(f.properties.population, 2724);
    // H: RF risk_class untouched by the incidence change
    assert.strictEqual(f.properties.risk_class, 'Low');
    assert.strictEqual(f.properties.model_type, 'random_forest');
    // legacy value preserved for audit under its own key
    assert.strictEqual(f.properties.legacy_pipeline_incidence, 0);
  });

  it('E/G: year=2024 looks up risk period 2025-01-01, cases 2024, population 2024 (never 2025)', async () => {
    mockQueryFn = makeDispatcher({
      geo: [{ id: 1, name: 'San Nicolas', population: 2724, geometry: POLY, centroid_lon: 0.5, centroid_lat: 0.5 }],
      risk: [{ barangay_name: 'San Nicolas', risk_score: 60, risk_class: 'High', incidence_per_100k: 3551.61, model_type: 'random_forest', trend_direction: 'Stable', period: '2025-01-01' }],
      forecast: [],
      cases: [{ barangay_name: 'San Nicolas', total_cases: 70 }],
      pop: [{ barangay_name: 'San Nicolas', population: 2703 }], // exact 2024 population
    });
    const res = await request(buildApp()).get('/api/tb/gis/geojson?year=2024');
    assert.strictEqual(res.status, 200);

    const riskQ = capturedQueries.find(q => q.sql.includes('FROM barangay_risk_scores'));
    const caseQ = capturedQueries.find(q => q.sql.includes('FROM tb_cases'));
    const popQ = capturedQueries.find(q => q.sql.includes('FROM barangay_population'));
    assert.ok(riskQ, 'risk snapshot must be queried');
    assert.deepStrictEqual(riskQ.params, ['2025-01-01'], 'G: risk snapshot for 2024 is period 2025-01-01 (Y+1)');
    assert.deepStrictEqual(caseQ.params, [2024], 'G: cases must be filtered to the selected year');
    assert.ok(popQ, 'E: 2024 must query barangay_population');
    assert.deepStrictEqual(popQ.params, [2024], 'E/G: population must be the exact selected year');
    assert.ok(!popQ.sql.includes('b.population'), 'E: never substitute the 2025 GeoJSON population');

    const f = res.body.features[0];
    assert.strictEqual(f.properties.population, 2703, 'E: exact-year population');
    assert.strictEqual(f.properties.incidence_per_100k, 2589.72, '70 / 2703 * 100k');
    assert.strictEqual(f.properties.legacy_pipeline_incidence, 3551.61, 'legacy kept separately');
  });

  it('C/D: year with population rows only partially available -> missing pop barangay gets null', async () => {
    mockQueryFn = makeDispatcher({
      geo: [
        { id: 1, name: 'Has Pop', population: 10000, geometry: POLY, centroid_lon: 0.5, centroid_lat: 0.5 },
        { id: 2, name: 'No Pop', population: 10000, geometry: POLY, centroid_lon: 0.5, centroid_lat: 0.5 },
      ],
      risk: [],
      forecast: [],
      cases: [
        { barangay_name: 'Has Pop', total_cases: 5 },
        { barangay_name: 'No Pop', total_cases: 5 },
      ],
      pop: [{ barangay_name: 'Has Pop', population: 10000 }], // exact-year row missing for 'No Pop'
    });
    const res = await request(buildApp()).get('/api/tb/gis/geojson?year=2024');
    const has = res.body.features.find(x => x.properties.name === 'Has Pop');
    const none = res.body.features.find(x => x.properties.name === 'No Pop');
    assert.strictEqual(has.properties.incidence_per_100k, 50, 'A: 5 / 10000 * 100k');
    assert.strictEqual(none.properties.incidence_per_100k, null, 'C: no exact-year population -> null, never 2025 pop');
  });

  it('B: zero cases with valid reference population -> incidence 0 (not null)', async () => {
    mockQueryFn = makeDispatcher({
      geo: [{ id: 1, name: 'Quiet Bgy', population: 5000, geometry: POLY, centroid_lon: 0.5, centroid_lat: 0.5 }],
      risk: [],
      forecast: [],
      cases: [], // zero cases this year
      forbidPopQuery: true,
    });
    const res = await request(buildApp()).get('/api/tb/gis/geojson?year=2025');
    const f = res.body.features[0];
    assert.strictEqual(f.properties.total_cases, 0);
    assert.strictEqual(f.properties.incidence_per_100k, 0, 'B: valid population + zero cases -> 0');
  });

  it('D: zero cases with missing exact-year population -> null', async () => {
    mockQueryFn = makeDispatcher({
      geo: [{ id: 1, name: 'Quiet Bgy', population: 5000, geometry: POLY, centroid_lon: 0.5, centroid_lat: 0.5 }],
      risk: [],
      forecast: [],
      cases: [],
      pop: [], // no exact-year population
    });
    const res = await request(buildApp()).get('/api/tb/gis/geojson?year=2024');
    const f = res.body.features[0];
    assert.strictEqual(f.properties.incidence_per_100k, null, 'D: missing population -> null, never 0');
  });

  it('L: All Years = lifetime case totals + N/A incidence; risk class/confidence from latest snapshot only', async () => {
    mockQueryFn = makeDispatcher({
      geo: [{ id: 1, name: 'San Nicolas', population: 2724, geometry: POLY, centroid_lon: 0.5, centroid_lat: 0.5 }],
      risk: [{ barangay_name: 'San Nicolas', risk_score: 41, risk_class: 'Low', incidence_per_100k: 0, model_type: 'random_forest', classification_confidence: 0.53, trend_direction: 'Stable', period: '2026-01-01' }],
      forecast: [],
      cases: [{ barangay_name: 'San Nicolas', total_cases: 138 }], // lifetime
      forbidPopQuery: true, // no population lookup at all — no year context
    });
    const res = await request(buildApp()).get('/api/tb/gis/geojson');
    const f = res.body.features[0];
    const caseQ = capturedQueries.find(q => q.sql.includes('FROM tb_cases'));
    assert.deepStrictEqual(caseQ.params, [], 'All Years must not filter cases to any single year');
    assert.strictEqual(res.body.meta.incidence_year, null, 'All Years has no incidence year');
    assert.strictEqual(f.properties.total_cases, 138, 'lifetime sum of all case years');
    assert.strictEqual(f.properties.incidence_per_100k, null, 'never divide multi-year cases by one year\'s population -> N/A');
    assert.strictEqual(f.properties.population, 2724, 'GeoJSON population kept as the geography attribute');
    // Latest snapshot still drives the classification columns (UI labels them
    // "Latest Risk Assessment / Latest Classification Confidence")
    assert.strictEqual(f.properties.risk_class, 'Low');
    assert.strictEqual(f.properties.classification_confidence, 0.53);
    assert.strictEqual(f.properties.legacy_pipeline_incidence, 0, 'legacy value preserved for audit');
  });

  it('L: no year param AND no snapshot -> lifetime totals, population as geography attribute, incidence null', async () => {
    mockQueryFn = makeDispatcher({
      geo: [{ id: 1, name: 'Dela Paz', population: 50000, geometry: POLY, centroid_lon: 0.5, centroid_lat: 0.5 }],
      risk: [], // no snapshot at all -> no year context
      forecast: [],
      cases: [{ barangay_name: 'Dela Paz', total_cases: 600 }],
    });
    const res = await request(buildApp()).get('/api/tb/gis/geojson');
    const f = res.body.features[0];
    const caseQ = capturedQueries.find(q => q.sql.includes('FROM tb_cases'));
    assert.deepStrictEqual(caseQ.params, [], 'no year context -> lifetime query, no year param');
    assert.strictEqual(res.body.meta.incidence_year, null, 'meta reflects no year context');
    assert.strictEqual(f.properties.total_cases, 600);
    assert.strictEqual(f.properties.population, 50000, 'GeoJSON population kept as the geography attribute');
    assert.strictEqual(f.properties.incidence_per_100k, null, 'no year context -> incidence is N/A, never a fabricated figure');
  });
});

/* ════════════════ E–G: choropleth endpoint ════════════════ */

describe('GET /api/tb/gis/choropleth — year contract', () => {
  it('G/E: ?year=2024 locks risk snapshot + cases + population to 2024', async () => {
    mockQueryFn = makeDispatcher({
      periodYear: 2026,
      choroplethMain: [{
        name: 'San Nicolas', centroid_lon: 0.5, centroid_lat: 0.5,
        population: 2703, // simulated bp.population (2024)
        risk_score: 60, risk_class: 'High', legacy_pipeline_incidence: 3551.61,
        trend_direction: 'Stable', period: '2025-01-01', total_cases: 70,
      }],
    });
    const res = await request(buildApp()).get('/api/tb/gis/choropleth?year=2024');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.year, 2024);

    const mainQ = capturedQueries.find(q => q.sql.includes('COALESCE(brs.risk_score'));
    assert.ok(mainQ, 'main choropleth query must run');
    assert.deepStrictEqual(mainQ.params, [2024, '2025-01-01'], 'G: cases year + risk period both derived from 2024');
    assert.ok(mainQ.sql.includes('EXTRACT(YEAR FROM date_of_diagnosis) = $1'), 'G: cases filtered to selected year');
    assert.ok(mainQ.sql.includes('brs.period = $2::date'), 'G: risk snapshot read from same year (Y+1 period)');
    assert.ok(mainQ.sql.includes('bp.reference_year = $1'), 'E: population joined on exact selected year');
    assert.ok(!mainQ.sql.includes('b.population'), 'E: never fall back to 2025 GeoJSON population');

    const row = res.body.choropleth[0];
    assert.strictEqual(row.population, 2703);
    assert.strictEqual(row.incidence_per_100k, 2589.72, 'same-year cases / same-year population');
    assert.strictEqual(row.legacy_pipeline_incidence, 3551.61, 'legacy exposed under its own key');
  });

  it('G: no year param defaults to the latest risk-assessment year (period Y+1)', async () => {
    mockQueryFn = makeDispatcher({
      periodYear: 2026, // snapshot stored at 2026-01-01 -> assessment year 2025
      choroplethMain: [{
        name: 'San Nicolas', centroid_lon: 0.5, centroid_lat: 0.5,
        population: 2724, // b.population (2025 GeoJSON)
        risk_score: 41, risk_class: 'Low', legacy_pipeline_incidence: 0,
        trend_direction: 'Stable', period: '2026-01-01', total_cases: 17,
      }],
    });
    const res = await request(buildApp()).get('/api/tb/gis/choropleth');
    assert.strictEqual(res.body.year, 2025, 'latest period 2026-01-01 => assessment year 2025');

    const mainQ = capturedQueries.find(q => q.sql.includes('COALESCE(brs.risk_score'));
    assert.deepStrictEqual(mainQ.params, [2025, '2026-01-01'], 'G: everything locked to 2025');
    assert.ok(!mainQ.sql.includes('bp.reference_year'), 'F: reference year uses GeoJSON population, no bp join');

    const row = res.body.choropleth[0];
    assert.strictEqual(row.incidence_per_100k, 624.08, '17 / 2724 * 100k');
  });

  it('F: ?year=2025 uses GeoJSON population and never queries barangay_population', async () => {
    mockQueryFn = makeDispatcher({
      periodYear: 2026,
      choroplethMain: [{
        name: 'Santa Lucia', centroid_lon: 0.5, centroid_lat: 0.5,
        population: 45916,
        risk_score: 74, risk_class: 'High', legacy_pipeline_incidence: 444.29,
        trend_direction: 'Increasing', period: '2026-01-01', total_cases: 356,
      }],
      forbidPopQuery: true,
    });
    const res = await request(buildApp()).get('/api/tb/gis/choropleth?year=2025');
    const mainQ = capturedQueries.find(q => q.sql.includes('COALESCE(brs.risk_score'));
    assert.ok(mainQ.sql.includes('b.population'), 'F: reference year selects GeoJSON population');
    assert.ok(!mainQ.sql.includes('bp.reference_year'), 'F: no barangay_population join for 2025');
    assert.strictEqual(res.body.choropleth[0].incidence_per_100k, 775.33, '356 / 45916 * 100k');
  });
});

/* ════════════════ I–K: GisMap.jsx source contract ════════════════ */

describe('GisMap.jsx risk-ranking UI contract (source assertions)', () => {
  const srcPath = path.join(__dirname, '..', '..', 'FRONTEND', 'src', 'pages', 'GisMap.jsx');
  const src = fs.readFileSync(srcPath, 'utf8');
  const rankStart = src.indexOf('{/* ── Risk Distribution ── */}');
  const rankEnd = src.indexOf('{/* ── NLG GIS Insight Panel ── */}');
  const ranking = src.slice(rankStart, rankEnd);
  const memoStart = src.indexOf('const riskRankingData = React.useMemo');
  const memoEnd = src.indexOf('}, [data]);', memoStart);
  const memo = src.slice(memoStart, memoEnd);

  it('I: legacy risk_score is not rendered in the ranking', () => {
    assert.ok(rankStart > 0 && rankEnd > rankStart, 'ranking block located');
    assert.ok(!ranking.includes('formatNum(b.risk_score)'), 'no legacy score value render');
    assert.ok(!ranking.includes('risk_score'), 'no risk_score reference at all in ranking');
  });

  it('J: case label is "total cases", never "active"', () => {
    assert.ok(ranking.includes('total cases'), 'shows "total cases"');
    assert.ok(!ranking.includes('} active'), 'never shows "active"');
  });

  it('K: Classification Confidence only when actual RF confidence exists, exact label', () => {
    assert.ok(
      ranking.includes("const hasRfConfidence = b.model_type === 'random_forest' && b.classification_confidence != null"),
      'display guarded by model_type + non-null confidence'
    );
    assert.ok(ranking.includes('hasRfConfidence ?'), 'value rendered through the guard ternary');
    assert.ok(ranking.includes('Classification Confidence'), 'exact label used');
    assert.ok(!/\bRisk Score\b/.test(ranking), 'no "Risk Score" label in ranking');
  });

  it('fix 3: clinical subtitles replaced by count-based neutral labels', () => {
    assert.ok(memoStart > 0 && memoEnd > memoStart, 'riskRankingData memo located');
    assert.ok(!memo.includes('Immediate Action Required'), 'old subtitle removed');
    assert.ok(!memo.includes('Close Monitoring Recommended'), 'old subtitle removed');
    assert.ok(!memo.includes('Routine Surveillance'), 'old subtitle removed');
    assert.ok(!memo.includes('subtitle:'), 'subtitle property gone from sections');
    assert.ok(memo.includes('barangay${'), 'section labels carry barangay counts');
    assert.ok(!ranking.includes('sec.subtitle'), 'no subtitle render in the table');
  });

  it('M: ranking does not imply RF generated rank 1-30; All Years RF columns renamed; per-100k hidden', () => {
    assert.ok(ranking.includes('Risk-Classified Barangays'), 'header states classification, not a generated ranking');
    assert.ok(!ranking.includes('Risk-Ranked Barangays'), 'old header removed');
    assert.ok(
      ranking.includes('Grouped by latest Random Forest risk classification and ordered by total cases within each group'),
      'All Years helper documents grouping + total-cases ordering'
    );
    assert.ok(
      ranking.includes('Grouped by Random Forest risk classification and ordered by'),
      'helper text documents the grouping + ordering rule'
    );
    assert.ok(ranking.includes('Latest Risk Assessment ('), 'All Years column renamed to Latest Risk Assessment + year');
    assert.ok(ranking.includes('Latest Classification Confidence'), 'All Years column renamed to Latest Classification Confidence');
    assert.ok(ranking.includes('All Years combines available TB records from'), 'context line uses dynamic year range');
    assert.ok(ranking.includes('Incidence per 100,000 is available only when a specific year is selected'), 'context line explains per-100k availability');
    assert.ok(ranking.includes('caseYearRange'), 'year range is dynamic, not hardcoded');
    assert.ok(ranking.includes('classifiedBarangays'), 'counter uses classified/total');
    assert.ok(
      ranking.includes("{filterYear && <span className=\"text-right\">per 100k</span>}") ||
      ranking.includes('filterYear && <span className="text-right">per 100k</span>'),
      'per-100k header column hidden in All Years'
    );
    assert.ok(
      ranking.includes('{filterYear && ('),
      'per-100k data cell hidden in All Years'
    );
    assert.ok(
      ranking.includes('How strongly the Random Forest model supports the assigned risk classification'),
      'confidence tooltip explains RF predict_proba, not TB probability'
    );
    assert.ok(
      ranking.includes("sec.key === 'No Data' ? 'No Assessment'"),
      'No Assessment badge, never No Data Risk'
    );
    assert.ok(
      ranking.includes('b.incidence_per_100k != null ? formatNum'),
      'null incidence renders as N/A, never a fabricated number (specific-year path)'
    );
    // Memo-level: section construction
    assert.ok(memo.includes('No Assessment —'), 'section label renamed No Data -> No Assessment');
    assert.ok(
      memo.includes("groups['No Data'].length > 0"),
      'No Assessment section only rendered when count > 0 (never an empty section)'
    );
  });
});
