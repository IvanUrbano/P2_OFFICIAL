/**
 * TBInsight — Routes Integration Tests
 *
 * Tests Express route handlers via supertest with mocked database pool.
 * Run: node --test BACKEND/test/tbinsight/routes.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');

/* ─── Mock pool ─── */
const MODULE_DB = require.resolve('../../db');
let mockQueryFn;

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

/* ─── Auth ───
 * /api/tb/* now requires an authenticated Staff or Admin user (router-level
 * guard in tbinsight/routes.js). These route tests are about route behaviour,
 * not authorization, so the app under test injects a REAL signed token for the
 * requested role and the genuine authenticateToken/authorizeRoles middleware
 * still runs and verifies it — nothing is stubbed out.
 *
 * Authorization itself (401 without a token, 403 for Staff on Admin-only
 * routes, invalid and expired tokens) is covered separately in
 * BACKEND/test/tbinsight/tbAuthorization.test.js, which builds the app
 * WITHOUT this injector.
 */
const jwt = require('jsonwebtoken');

// The real middleware verifies against process.env.JWT_SECRET; provide one for
// the test process if the environment has not set it.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-route-tests';

function signToken(role = 'admin', overrides = {}) {
  return jwt.sign(
    { id: 1, username: 'tester', email: 'tester@example.com', role, ...overrides },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function buildApp(role = 'admin') {
  uninstallMockDb();
  installMockDb();
  clearTbinsightCache();

  const app = express();
  app.use(express.json());
  const token = signToken(role);
  // Bearer auth (not cookie), so the CSRF nonce check does not apply — these
  // tests exercise route logic, and Bearer requests are exempt by design.
  app.use((req, _res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use('/api/tb', require('../../tbinsight/routes'));
  return app;
}

module.exports = { signToken };

function teardown() {
  uninstallMockDb();
}

/* ═══════════════════════════════════════════════════════ */
/*                    TEST SUITES                         */
/* ═══════════════════════════════════════════════════════ */

afterEach(teardown);

describe('GET /api/tb/barangays', () => {
  it('returns barangay list with count', async () => {
    mockQueryFn = async () => ({
      rows: [
        { name: 'Dela Paz', population: 50000 },
        { name: 'Pinagbuhatan', population: 80000 },
      ],
    });
    const res = await request(buildApp()).get('/api/tb/barangays');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.barangays));
    assert.strictEqual(res.body.barangays.length, 2);
    assert.strictEqual(res.body.count, 2);
  });
});

describe('GET /api/tb/facilities', () => {
  it('returns facility list with count', async () => {
    mockQueryFn = async () => ({
      rows: [{ name: 'Dela Paz HC', type: 'HC', barangay_name: 'Dela Paz' }],
    });
    const res = await request(buildApp()).get('/api/tb/facilities');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.facilities));
    assert.strictEqual(res.body.facilities.length, 1);
  });
});

describe('GET /api/tb/cases', () => {
  it('returns cases with pagination', async () => {
    let callCount = 0;
    mockQueryFn = async () => {
      callCount++;
      if (callCount === 1) return { rows: [{ total: 12831 }] };
      return { rows: [{ id: 1, barangay_name: 'Dela Paz', age: 35, sex: 'Male' }] };
    };
    const res = await request(buildApp()).get('/api/tb/cases?page=1&limit=10');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.cases));
    assert.strictEqual(res.body.pagination.total, 12831);
    assert.strictEqual(res.body.pagination.totalPages, 1284);
  });

  it('applies barangay filter', async () => {
    let capturedParams;
    let callCount = 0;
    mockQueryFn = async (sql, params) => {
      capturedParams = params;
      callCount++;
      if (callCount === 1) return { rows: [{ total: 50 }] };
      return { rows: [] };
    };
    const res = await request(buildApp()).get('/api/tb/cases?barangay=Dela Paz');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(capturedParams[0], 'Dela Paz');
  });

  it('applies search filter with ILIKE', async () => {
    let capturedSql;
    let callCount = 0;
    mockQueryFn = async (sql) => {
      capturedSql = sql;
      callCount++;
      if (callCount === 1) return { rows: [{ total: 5 }] };
      return { rows: [] };
    };
    const res = await request(buildApp()).get('/api/tb/cases?search=Dela');
    assert.strictEqual(res.status, 200);
    assert.ok(capturedSql.includes('ILIKE'));
  });

  it('applies year and month filters', async () => {
    let capturedParams = [];
    let callCount = 0;
    mockQueryFn = async (sql, params) => {
      capturedParams = params || [];
      callCount++;
      if (callCount === 1) return { rows: [{ total: 100 }] };
      return { rows: [] };
    };
    await request(buildApp()).get('/api/tb/cases?year=2024&month=6');
    assert.ok(capturedParams.includes(2024));
    assert.ok(capturedParams.includes(6));
  });

  /* The outcome filter binds an ARRAY of accepted DB values to `= ANY($n)`,
   * not a scalar string. That is deliberate: the source Excel records a
   * treatment failure as FAILED, but rows imported before the canonical form
   * was aligned to the source are stored as TREATMENT FAILED, so selecting
   * FAILED has to match both. This test previously asserted
   * `capturedParams.includes('CURED')`, which looks for the bare string and
   * cannot see inside the bound array — it was written against the older
   * scalar binding and kept failing after the alias expansion was introduced,
   * even though the filter itself was correct. It now asserts the real
   * contract: the bound value is the expanded array, and the SQL compares
   * against it with ANY on a normalized column. */
  it('applies outcome filter as an array bound to = ANY', async () => {
    let capturedParams = [];
    let capturedSql = '';
    let callCount = 0;
    mockQueryFn = async (sql, params) => {
      capturedParams = params || [];
      capturedSql = sql;
      callCount++;
      if (callCount === 1) return { rows: [{ total: 200 }] };
      return { rows: [] };
    };
    await request(buildApp()).get('/api/tb/cases?outcome=CURED');

    const outcomeParam = capturedParams.find((p) => Array.isArray(p) && p.includes('CURED'));
    assert.ok(outcomeParam, `expected a bound array containing CURED, got ${JSON.stringify(capturedParams)}`);
    assert.deepStrictEqual(outcomeParam, ['CURED']);
    assert.match(capturedSql, /UPPER\(TRIM\(c\.outcome_status\)\)\s*=\s*ANY\(\$\d+\)/);
  });

  it('expands FAILED to the legacy TREATMENT FAILED value', async () => {
    // The 56 pre-alignment rows are stored as TREATMENT FAILED. Selecting the
    // source-aligned FAILED must still find them, without the user ever being
    // shown or asked to select TREATMENT FAILED.
    let capturedParams = [];
    let callCount = 0;
    mockQueryFn = async (sql, params) => {
      capturedParams = params || [];
      callCount++;
      if (callCount === 1) return { rows: [{ total: 56 }] };
      return { rows: [] };
    };
    await request(buildApp()).get('/api/tb/cases?outcome=FAILED');

    const outcomeParam = capturedParams.find((p) => Array.isArray(p));
    assert.ok(outcomeParam, 'outcome filter binds an array');
    assert.ok(outcomeParam.includes('FAILED'), 'matches the source-aligned value');
    assert.ok(outcomeParam.includes('TREATMENT FAILED'), 'also matches the legacy stored value');
  });

  it('returns record outcomes as the source-aligned label, never the legacy form', async () => {
    let callCount = 0;
    mockQueryFn = async () => {
      callCount++;
      if (callCount === 1) return { rows: [{ total: 2 }] };
      return {
        rows: [
          { id: 1, outcome_status: 'TREATMENT FAILED' },
          { id: 2, outcome_status: 'SCREENED' },
        ],
      };
    };
    const res = await request(buildApp()).get('/api/tb/cases');
    assert.strictEqual(res.status, 200);

    const [failed, screened] = res.body.cases;
    // Legacy value is presented under the source-aligned label...
    assert.strictEqual(failed.outcome_status, 'FAILED');
    assert.strictEqual(failed.outcome_status_raw, 'TREATMENT FAILED');
    assert.strictEqual(failed.outcome_status_approved, true);
    // ...and an unverified value is preserved, not remapped, but flagged.
    assert.strictEqual(screened.outcome_status, 'SCREENED');
    assert.strictEqual(screened.outcome_status_approved, false);
  });
});

describe('GET /api/tb/dashboard/summary', () => {
  it('returns summary metrics', async () => {
    mockQueryFn = async () => ({
      rows: [{ total_cases: 12831, barangays_with_cases: 30, months_covered: 24 }],
    });
    const res = await request(buildApp()).get('/api/tb/dashboard/summary');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.summary.total_cases, 12831);
  });

  it('returns 500 on db error', async () => {
    mockQueryFn = async () => { throw new Error('DB fail'); };
    const res = await request(buildApp()).get('/api/tb/dashboard/summary');
    assert.strictEqual(res.status, 500);
    assert.ok(res.body.error.includes('Server error'));
  });
});

describe('GET /api/tb/dashboard/monthly', () => {
  it('returns monthly trend data', async () => {
    mockQueryFn = async () => ({
      rows: [
        { barangay_name: 'Dela Paz', month: '2024-06', case_count: 45 },
        { barangay_name: 'Dela Paz', month: '2024-07', case_count: 52 },
      ],
    });
    const res = await request(buildApp()).get('/api/tb/dashboard/monthly');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.monthly));
    assert.strictEqual(res.body.monthly.length, 2);
  });
});

describe('GET /api/tb/dashboard/demographics', () => {
  it('returns demographics', async () => {
    mockQueryFn = async () => ({
      rows: [{ barangay_name: 'Dela Paz', sex: 'Male', age_group: '25-34', total: 120 }],
    });
    const res = await request(buildApp()).get('/api/tb/dashboard/demographics');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.demographics));
  });
});

describe('GET /api/tb/dashboard/outcomes', () => {
  it('returns outcomes', async () => {
    mockQueryFn = async () => ({
      rows: [{ barangay_name: 'Dela Paz', outcome_status: 'CURED', total: 200 }],
    });
    const res = await request(buildApp()).get('/api/tb/dashboard/outcomes');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.outcomes));
  });
});

describe('GET /api/tb/dashboard/facilities', () => {
  it('returns cases per facility', async () => {
    mockQueryFn = async () => ({
      rows: [{ facility_name: 'Dela Paz HC', barangay_name: 'Dela Paz', total: 300 }],
    });
    const res = await request(buildApp()).get('/api/tb/dashboard/facilities');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.facilities));
  });
});

describe('GET /api/tb/dashboard/bacteriological', () => {
  it('returns bacteriological data', async () => {
    mockQueryFn = async () => ({
      rows: [{ barangay_name: 'Dela Paz', bacteriological_status: 'SMEAR POSITIVE', total: 100 }],
    });
    const res = await request(buildApp()).get('/api/tb/dashboard/bacteriological');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.bacteriological));
  });
});

describe('GET /api/tb/dashboard/barangay/:name', () => {
  it('returns 404 for unknown barangay', async () => {
    mockQueryFn = async () => ({ rows: [] });
    const res = await request(buildApp()).get('/api/tb/dashboard/barangay/Nonexistent');
    assert.ok([200, 404].includes(res.status));
    assert.ok(Array.isArray(res.body.demographics) || res.body.error);
  });
});

describe('GET /api/tb/barangays/watchlist', () => {
  it('returns one row per barangay with cases, forecast and risk', async () => {
    let callCount = 0;
    mockQueryFn = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          rows: [{
            name: 'Dela Paz', population: 50000,
            current_cases: 12, prev_cases: 9, total_cases: 600,
            forecasted_count: 15, confidence_lower: 10, confidence_upper: 21,
            risk_score: 74.8, risk_class: 'High',
            incidence_per_100k: 500, trend_direction: 'Increasing',
          }],
        };
      }
      return {
        rows: [{
          latest_month: '2026-07-01', prev_month: '2026-06-01',
          forecast_period: '2026-08-01', risk_period: '2026-07-01',
        }],
      };
    };
    const res = await request(buildApp()).get('/api/tb/barangays/watchlist');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.watchlist));
    assert.strictEqual(res.body.watchlist[0].name, 'Dela Paz');
    assert.strictEqual(res.body.watchlist[0].current_cases, 12);
    assert.strictEqual(res.body.watchlist[0].prev_cases, 9);
    assert.strictEqual(res.body.watchlist[0].forecasted_count, 15);
    assert.strictEqual(res.body.watchlist[0].risk_class, 'High');
    assert.strictEqual(res.body.watchlist[0].trend_direction, 'Increasing');
    assert.strictEqual(res.body.periods.forecast_period, '2026-08-01');
    assert.strictEqual(res.body.periods.latest_month, '2026-07-01');
  });

  it('handles barangays with no data', async () => {
    let callCount = 0;
    mockQueryFn = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          rows: [{
            name: 'Palatiw', population: 40000,
            current_cases: 0, prev_cases: 0, total_cases: 0,
            forecasted_count: 0, confidence_lower: 0, confidence_upper: 0,
            risk_score: 0, risk_class: 'No Data',
            incidence_per_100k: 0, trend_direction: 'Stable',
          }],
        };
      }
      return { rows: [{ latest_month: null, prev_month: null, forecast_period: null, risk_period: null }] };
    };
    const res = await request(buildApp()).get('/api/tb/barangays/watchlist');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.watchlist[0].risk_class, 'No Data');
    assert.strictEqual(res.body.watchlist[0].current_cases, 0);
  });

  it('returns 500 on db error', async () => {
    mockQueryFn = async () => { throw new Error('DB fail'); };
    const res = await request(buildApp()).get('/api/tb/barangays/watchlist');
    assert.strictEqual(res.status, 500);
    assert.ok(res.body.error.includes('Server error'));
  });
});

describe('GET /api/tb/alerts', () => {
  it('returns alerts list', async () => {
    mockQueryFn = async () => ({
      rows: [{
        id: 1, barangay_name: 'Dela Paz', period: '2025-01-01',
        alert_type: 'danger', severity: 'High',
        message: 'High TB incidence', recommendation: 'Increase screening',
        is_read: false, created_at: '2025-01-15T10:00:00Z',
      }],
    });
    const res = await request(buildApp()).get('/api/tb/alerts');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.alerts));
    assert.strictEqual(res.body.alerts[0].severity, 'High');
  });
});

describe('PUT /api/tb/alerts/:id/read', () => {
  it('marks alert as read', async () => {
    mockQueryFn = async () => ({});
    process.env.JWT_SECRET = 'test-secret';
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: 1, username: 'test', role: 'admin' }, 'test-secret', { expiresIn: '1h' });
    const res = await request(buildApp())
      .put('/api/tb/alerts/42/read')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.message.includes('read'));
  });
});

describe('GET /api/tb/gis/geojson', () => {
  it('returns FeatureCollection with merged risk data', async () => {
    let callCount = 0;
    mockQueryFn = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          rows: [{
            id: 1, name: 'Dela Paz', population: 50000,
            geometry: { type: 'Polygon', coordinates: [[[121.1, 14.5], [121.11, 14.5], [121.11, 14.51], [121.1, 14.51], [121.1, 14.5]]] },
            centroid_lon: 121.105, centroid_lat: 14.505,
          }],
        };
      }
      if (callCount === 2) {
        return { rows: [{ barangay_name: 'Dela Paz', risk_score: 74.8, risk_class: 'High', incidence_per_100k: 500, trend_direction: 'Increasing' }] };
      }
      if (callCount === 3) {
        return { rows: [{ barangay_name: 'Dela Paz', forecasted_count: 42, confidence_lower: 30, confidence_upper: 55 }] };
      }
      return { rows: [{ barangay_name: 'Dela Paz', total_cases: 600 }] };
    };

    const res = await request(buildApp()).get('/api/tb/gis/geojson');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.type, 'FeatureCollection');
    assert.strictEqual(res.body.features.length, 1);

    const f = res.body.features[0];
    assert.strictEqual(f.properties.name, 'Dela Paz');
    assert.strictEqual(f.properties.risk_score, 74.8);
    assert.strictEqual(f.properties.risk_class, 'High');
    assert.strictEqual(f.properties.forecasted_count, 42);
    assert.strictEqual(f.properties.total_cases, 600);

    assert.strictEqual(res.body.outline.type, 'MultiPolygon');
    assert.ok(res.body.outline.coordinates.length > 0);
  });

  it('returns 500 on db error', async () => {
    mockQueryFn = async () => { throw new Error('DB fail'); };
    const res = await request(buildApp()).get('/api/tb/gis/geojson');
    assert.strictEqual(res.status, 500);
  });

  it('builds outline from Polygon features', async () => {
    let callCount = 0;
    mockQueryFn = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          rows: [{
            id: 1, name: 'Bgy A', population: 10000,
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
            centroid_lon: 0.5, centroid_lat: 0.5,
          }],
        };
      }
      return { rows: [] };
    };

    const res = await request(buildApp()).get('/api/tb/gis/geojson');
    assert.strictEqual(res.body.outline.type, 'MultiPolygon');
    assert.strictEqual(res.body.outline.coordinates.length, 1);
  });

  it('builds outline from MultiPolygon features', async () => {
    let callCount = 0;
    mockQueryFn = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          rows: [{
            id: 1, name: 'Bgy B', population: 10000,
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
                [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]],
              ],
            },
            centroid_lon: 1.5, centroid_lat: 1.5,
          }],
        };
      }
      return { rows: [] };
    };

    const res = await request(buildApp()).get('/api/tb/gis/geojson');
    assert.strictEqual(res.body.outline.coordinates.length, 2);
  });

  it('never coalesces a missing exact-year population incidence to 0 (TEST E)', async () => {
    let callCount = 0;
    mockQueryFn = async () => {
      callCount++;
      if (callCount === 1) {
        return { rows: [{ id: 1, name: 'Dela Paz', population: 50000, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }, centroid_lon: 0.5, centroid_lat: 0.5 }] };
      }
      if (callCount === 2) {
        // risk row exists, but...
        return { rows: [{ barangay_name: 'Dela Paz', risk_score: 40, risk_class: 'Medium', incidence_per_100k: null, trend_direction: 'Stable', period: '2024-01-01' }] };
      }
      // ...2023 has NO exact-year population record (forecast/cases/pop all
      // empty) — year-specific incidence must surface null, never 0.
      return { rows: [] };
    };
    const res = await request(buildApp()).get('/api/tb/gis/geojson?year=2023');
    const f = res.body.features.find(x => x.properties.name === 'Dela Paz');
    assert.strictEqual(f.properties.population, null, 'no exact-year population -> null, never another year\'s figure');
    assert.strictEqual(f.properties.incidence_per_100k, null, 'missing population must surface as null, never 0');
  });

  it('a specific year requests THAT year\'s own snapshot (period Y+1-01-01), not the latest one (TEST F/G)', async () => {
    let callCount = 0;
    let riskQueryParams = null;
    mockQueryFn = async (sql, params) => {
      callCount++;
      if (callCount === 1) {
        return { rows: [{ id: 1, name: 'Dela Paz', population: 50000, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }, centroid_lon: 0.5, centroid_lat: 0.5 }] };
      }
      if (callCount === 2) {
        riskQueryParams = params;
        // 2023's OWN snapshot (period 2024-01-01) — distinct from whatever
        // the current/latest (e.g. 2026) snapshot says.
        return { rows: [{ barangay_name: 'Dela Paz', risk_score: 20, risk_class: 'Low', model_type: 'rule_based', incidence_per_100k: null, trend_direction: 'Stable', period: '2024-01-01' }] };
      }
      return { rows: [] };
    };
    const res = await request(buildApp()).get('/api/tb/gis/geojson?year=2023');
    assert.deepStrictEqual(riskQueryParams, ['2024-01-01'], 'year=2023 must look up period 2024-01-01 exactly (Y+1 convention), not the latest overall period');
    const f = res.body.features.find(x => x.properties.name === 'Dela Paz');
    assert.strictEqual(f.properties.risk_class, 'Low', 'must return 2023\'s own snapshot, not a different year\'s');
    assert.strictEqual(res.body.meta.risk_assessment_period, '2024-01-01');
    assert.strictEqual(res.body.meta.requested_year, 2023);
    assert.strictEqual(res.body.meta.requested_year_has_snapshot, true);
  });

  it('a year with no computed snapshot yet shows No Data, never substituting a different year\'s snapshot (TEST G)', async () => {
    let callCount = 0;
    mockQueryFn = async () => {
      callCount++;
      if (callCount === 1) {
        return { rows: [{ id: 1, name: 'Dela Paz', population: 50000, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }, centroid_lon: 0.5, centroid_lat: 0.5 }] };
      }
      if (callCount === 2) return { rows: [] }; // no snapshot exists for 2019 yet
      return { rows: [] };
    };
    const res = await request(buildApp()).get('/api/tb/gis/geojson?year=2019');
    const f = res.body.features.find(x => x.properties.name === 'Dela Paz');
    assert.strictEqual(f.properties.risk_class, 'No Data');
    assert.strictEqual(f.properties.model_type, null);
    assert.strictEqual(res.body.meta.requested_year_has_snapshot, false);
    assert.strictEqual(res.body.meta.risk_assessment_period, null);
  });

  it('exposes RF provenance fields: model_type, classification_confidence, probabilities, and features (TEST H)', async () => {
    let callCount = 0;
    mockQueryFn = async () => {
      callCount++;
      if (callCount === 1) {
        return { rows: [{ id: 1, name: 'Dela Paz', population: 50000, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }, centroid_lon: 0.5, centroid_lat: 0.5 }] };
      }
      if (callCount === 2) {
        return {
          rows: [{
            barangay_name: 'Dela Paz', risk_score: 60, risk_class: 'High', incidence_per_100k: 300, trend_direction: 'Increasing',
            model_type: 'random_forest', model_version: 'arima-v1.0-rf-v1.0', classification_confidence: 0.82,
            prob_low: 0.05, prob_medium: 0.13, prob_high: 0.82,
            features: { rolling_12m_incidence: 300, recent_trend: 1.2, seasonality_flag: 0, lag_1m: 5, lag_2m: 4, lag_3m: 3, neighbor_risk: 0.6, historical_bias: 0 },
            period: '2026-01-01',
          }],
        };
      }
      return { rows: [] };
    };
    const res = await request(buildApp()).get('/api/tb/gis/geojson');
    const f = res.body.features.find(x => x.properties.name === 'Dela Paz');
    assert.strictEqual(f.properties.model_type, 'random_forest');
    assert.strictEqual(f.properties.classification_confidence, 0.82);
    assert.strictEqual(f.properties.prob_high, 0.82);
    assert.strictEqual(f.properties.rf_features.rolling_12m_incidence, 300);
  });

  it('marks a barangay with no risk row as No Data with no fabricated model_type (TEST D)', async () => {
    let callCount = 0;
    mockQueryFn = async () => {
      callCount++;
      if (callCount === 1) {
        return { rows: [{ id: 1, name: 'Dela Paz', population: 50000, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }, centroid_lon: 0.5, centroid_lat: 0.5 }] };
      }
      return { rows: [] }; // no risk rows at all — RF classification unavailable
    };
    const res = await request(buildApp()).get('/api/tb/gis/geojson');
    const f = res.body.features.find(x => x.properties.name === 'Dela Paz');
    assert.strictEqual(f.properties.risk_class, 'No Data');
    assert.strictEqual(f.properties.model_type, null, 'must not claim a model produced a classification that does not exist');
  });
});

describe('GET /api/tb/gis/barangay-at', () => {
  it('returns 400 when lon/lat missing', async () => {
    const res = await request(buildApp()).get('/api/tb/gis/barangay-at');
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Missing'));
  });

  it('returns 400 for non-numeric values', async () => {
    const res = await request(buildApp()).get('/api/tb/gis/barangay-at?lon=abc&lat=xyz');
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('valid numbers'));
  });

  it('returns found=true when point inside polygon', async () => {
    mockQueryFn = async () => ({
      rows: [{ name: 'Dela Paz', population: 50000, area_m2: 3500000, centroid_lon: 121.105, centroid_lat: 14.505 }],
    });
    const res = await request(buildApp()).get('/api/tb/gis/barangay-at?lon=121.105&lat=14.505');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.found, true);
    assert.strictEqual(res.body.barangay.name, 'Dela Paz');
  });

  it('returns found=false when point outside', async () => {
    mockQueryFn = async () => ({ rows: [] });
    const res = await request(buildApp()).get('/api/tb/gis/barangay-at?lon=121.5&lat=14.9');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.found, false);
  });
});

describe('GET /api/tb/gis/areas', () => {
  it('returns areas with km²', async () => {
    mockQueryFn = async () => ({
      rows: [
        { name: 'Pinagbuhatan', population: 80000, area_m2: 3540000, area_km2: 3.540, pop_density_per_km2: 22600 },
        { name: 'Dela Paz', population: 50000, area_m2: 2200000, area_km2: 2.200, pop_density_per_km2: 22700 },
      ],
    });
    const res = await request(buildApp()).get('/api/tb/gis/areas');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.areas));
    assert.strictEqual(res.body.areas[0].area_km2, 3.540);
  });
});

describe('GET /api/tb/gis/choropleth', () => {
  it('returns choropleth data', async () => {
    mockQueryFn = async () => ({
      rows: [{ name: 'Dela Paz', risk_score: 74.8, risk_class: 'High', population: 50000 }],
    });
    const res = await request(buildApp()).get('/api/tb/gis/choropleth');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.choropleth));
    assert.strictEqual(res.body.choropleth[0].risk_class, 'High');
  });
});

describe('GET /api/tb/forecasts', () => {
  it('returns forecast data', async () => {
    mockQueryFn = async () => ({
      rows: [{ barangay_name: 'Dela Paz', period: '2025-06-01', forecasted_count: 42 }],
    });
    const res = await request(buildApp()).get('/api/tb/forecasts');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.forecasts));
    assert.strictEqual(res.body.forecasts[0].forecasted_count, 42);
  });
});

describe('GET /api/tb/predictions/risk', () => {
  it('returns risk classifications', async () => {
    mockQueryFn = async () => ({
      rows: [{ barangay_name: 'Dela Paz', risk_class: 'High', risk_score: 74.8 }],
    });
    const res = await request(buildApp()).get('/api/tb/predictions/risk');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.predictions));
    assert.strictEqual(res.body.predictions[0].risk_class, 'High');
  });
});

describe('GET /api/tb/pipeline/status', () => {
  it('returns latest pipeline run', async () => {
    mockQueryFn = async () => ({
      rows: [{ id: 1, run_type: 'pipeline', model_version: 'v1.0', trained_at: '2025-06-15T10:00:00Z' }],
    });
    const res = await request(buildApp()).get('/api/tb/pipeline/status');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.latest_run);
    assert.strictEqual(res.body.latest_run.model_version, 'v1.0');
    // Live background-run state machine is exposed alongside the persisted run
    assert.ok(res.body.current_run);
    assert.strictEqual(typeof res.body.current_run.running, 'boolean');
    assert.strictEqual(res.body.current_run.running, false);
    assert.strictEqual(res.body.current_run.runsFinished, 0);
    // GIS banner states derive from these
    assert.strictEqual(res.body.current_run.lastRunStatus, null);
    assert.strictEqual(res.body.current_run.lastError, null);
  });
});
