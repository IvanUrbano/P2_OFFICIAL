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

describe('GET /api/tb/filter-options', () => {
  it('returns years, months, and case statuses from validated case rows', async () => {
    mockQueryFn = async sql => {
      if (sql.includes('EXTRACT(YEAR FROM date_of_diagnosis)')) return { rows: [
        { year: 2027, month: 2 }, { year: 2027, month: 1 }, { year: 2025, month: 12 },
      ] };
      if (sql.includes('TRIM(case_status)')) return { rows: [{ case_status: 'DIAGNOSED' }] };
      return { rows: [] };
    };
    const res = await request(buildApp()).get('/api/tb/filter-options');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.years, [2027, 2025]);
    assert.deepStrictEqual(res.body.months, [1, 2, 12]);
    assert.deepStrictEqual(res.body.months_by_year['2027'], [1, 2]);
    assert.deepStrictEqual(res.body.case_status, ['DIAGNOSED']);
  });
});

describe('GET /api/tb/gis/years', () => {
  it('includes validated case years before monthly aggregation catches up', async () => {
    mockQueryFn = async sql => {
      assert.ok(sql.includes('FROM tb_cases'));
      assert.ok(sql.includes('FROM barangay_risk_scores'));
      assert.ok(sql.includes('date_of_diagnosis'));
      assert.ok(sql.includes('barangay_name IS NOT NULL'));
      assert.ok(!sql.includes('monthly_case_summary'));
      return { rows: [{ year: 2026 }, { year: 2025 }] };
    };
    const res = await request(buildApp()).get('/api/tb/gis/years');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.years, [2026, 2025]);
  });
});

describe('GET /api/tb/alerts/filter-options', () => {
  it('uses stored notification values when requested', async () => {
    mockQueryFn = async (_sql, params) => {
      assert.deepStrictEqual(params, ['notification']);
      return { rows: [
        { type: 'notification', severity: 'info', status: 'unread', source_module: 'gis' },
        { type: 'notification', severity: 'info', status: 'read', source_module: 'gis' },
      ] };
    };
    const res = await request(buildApp()).get('/api/tb/alerts/filter-options?type=notification');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { type: ['notification'], severity: ['info'], status: ['read', 'unread'], source: ['gis'] });
  });
});

describe('GET /api/tb/alerts', () => {
  it('matches a barangay in a summary alert coverage list', async () => {
    mockQueryFn = async (sql, params) => {
      assert.ok(sql.includes("metadata->'affected_barangays'"));
      assert.strictEqual(params[0], 'Pinagbuhatan');
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 1 }] };
      return { rows: [{ id: 3, alert_type: 'high_risk_hotspot', metadata: { affected_barangays: ['Pinagbuhatan'] } }] };
    };
    const res = await request(buildApp()).get('/api/tb/alerts?barangay=Pinagbuhatan');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.pagination.total, 1);
    assert.strictEqual(res.body.alerts[0].id, 3);
  });
});

describe('GET /api/tb/alerts/stale-check', () => {
  it('requests re-evaluation when an existing summary lacks coverage', async () => {
    mockQueryFn = async sql => {
      assert.ok(sql.includes("metadata->'affected_barangays' IS NULL"));
      return { rows: [{ last_alert_created: new Date().toISOString(), missing_coverage: true }] };
    };
    const res = await request(buildApp()).get('/api/tb/alerts/stale-check');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.isStale, true);
  });
});

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
  it('includes screening and treatment facilities used by validated cases', async () => {
    mockQueryFn = async sql => {
      assert.ok(sql.includes('screening_facility'));
      assert.ok(sql.includes('treatment_facility'));
      return { rows: [{ screening_facility: 'Dela Paz HC' }, { screening_facility: 'Treatment Center' }] };
    };
    const res = await request(buildApp()).get('/api/tb/facilities');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.facilities, [{ name: 'Dela Paz HC' }, { name: 'Treatment Center' }]);
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
    assert.match(capturedSql, /c\.treatment_outcome\s*=\s*ANY\(\$\d+\)/);
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

  it('returns separate canonical treatment state and the retained source value', async () => {
    let callCount = 0;
    mockQueryFn = async () => {
      callCount++;
      if (callCount === 1) return { rows: [{ total: 2 }] };
      return {
        rows: [
          { id: 1, outcome_status: 'TREATMENT FAILED', source_outcome_status: 'Failed', case_status: null, treatment_outcome: 'TREATMENT FAILED' },
          { id: 2, outcome_status: 'SCREENED', case_status: null, treatment_outcome: null },
        ],
      };
    };
    const res = await request(buildApp()).get('/api/tb/cases');
    assert.strictEqual(res.status, 200);

    const [failed, screened] = res.body.cases;
    assert.strictEqual(failed.outcome_status, 'TREATMENT FAILED');
    assert.strictEqual(failed.outcome_status_raw, 'Failed');
    assert.strictEqual(failed.outcome_status_approved, true);
    assert.strictEqual(screened.outcome_status, null);
    assert.strictEqual(screened.outcome_status_raw, 'SCREENED');
    assert.strictEqual(screened.outcome_status_approved, false);
  });

  it('caps the page size at 100 (no more limit=<total> dumps)', async () => {
    let pageParams;
    mockQueryFn = async (sql, params) => {
      if (sql.includes('COUNT(*)')) return { rows: [{ total: '8518' }] };
      pageParams = params;
      return { rows: [] };
    };
    const res = await request(buildApp()).get('/api/tb/cases?limit=8518');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.pagination.limit, 100);
    assert.strictEqual(pageParams[pageParams.length - 2], 100, 'SQL LIMIT is capped too');
  });

  it('still serves the page sizes TB Records offers (10/20/50/100)', async () => {
    mockQueryFn = async (sql) => (sql.includes('COUNT(*)') ? { rows: [{ total: '500' }] } : { rows: [] });
    for (const n of [10, 20, 50, 100]) {
      const res = await request(buildApp()).get(`/api/tb/cases?limit=${n}`);
      assert.strictEqual(res.body.pagination.limit, n);
    }
  });
});

describe('GET /api/tb/cases/analytics-dataset', () => {
  // Same as buildApp, but lets a test set token claims (e.g. a staff facility).
  function buildAppAs(claims) {
    uninstallMockDb();
    installMockDb();
    clearTbinsightCache();
    const app = express();
    const token = signToken(claims.role, claims);
    app.use((req, _res, next) => { req.headers.authorization = `Bearer ${token}`; next(); });
    app.use('/api/tb', require('../../tbinsight/routes'));
    return app;
  }

  const FIELDS = ['barangay_name', 'age', 'sex', 'date_of_diagnosis', 'screening_facility',
    'treatment_facility', 'bacteriological_status', 'outcome_status', 'outcome_status_raw', 'source_outcome_status', 'case_status', 'treatment_outcome', 'imported_at'];

  it('returns every case with only the fields the charts use — no identifiers', async () => {
    let captured;
    mockQueryFn = async (sql, params) => {
      captured = { sql, params };
      return { rows: [{ barangay_name: 'Pinagbuhatan', age: 41, sex: 'M', date_of_diagnosis: '2025-01-05', screening_facility: 'A', treatment_facility: 'B', bacteriological_status: 'BC', outcome_status: 'TREATMENT FAILED', source_outcome_status: 'Failed', case_status: null, treatment_outcome: 'TREATMENT FAILED', imported_at: '2025-02-01' }] };
    };
    const res = await request(buildAppAs({ role: 'admin' })).get('/api/tb/cases/analytics-dataset');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.total, 1);
    assert.deepStrictEqual(Object.keys(res.body.cases[0]).sort(), [...FIELDS].sort());
    for (const id of ['case_no', 'patient_no', 'itis_case_id', 'batch_id']) {
      assert.ok(!captured.sql.includes(`c.${id}`), `${id} must not be selected`);
    }
    assert.ok(!/\bLIMIT\b/.test(captured.sql), 'not paginated: Analytics needs every case');
    assert.match(captured.sql, /ORDER BY c\.date_of_diagnosis DESC/, 'same order as /api/tb/cases');
    assert.strictEqual(res.body.cases[0].outcome_status, 'TREATMENT FAILED', 'same outcome labels as /api/tb/cases');
    assert.strictEqual(res.body.cases[0].outcome_status_raw, 'Failed', 'original source value is retained');
    assert.deepStrictEqual(captured.params, [], 'admin is not facility-scoped');
  });

  it('applies the same facility scope to staff as /api/tb/cases', async () => {
    const seen = [];
    mockQueryFn = async (sql, params) => {
      seen.push({ sql, params });
      return sql.includes('COUNT(*)') ? { rows: [{ total: '0' }] } : { rows: [] };
    };
    await request(buildAppAs({ role: 'staff', facility_id: 7 })).get('/api/tb/cases/analytics-dataset');
    await request(buildAppAs({ role: 'staff', facility_id: 7 })).get('/api/tb/cases?limit=10');
    const scope = '(c.current_responsible_facility_id = $1 OR c.current_responsible_facility_id IS NULL)';
    const dataset = seen[0];
    const listCount = seen.find(q => q.sql.includes('COUNT(*)'));
    assert.ok(dataset.sql.includes(scope));
    assert.deepStrictEqual(dataset.params, [7]);
    assert.ok(listCount.sql.includes(scope), 'both endpoints use the shared rule');
    assert.deepStrictEqual(listCount.params, [7]);
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

  it('exposes real border-sharing neighbour names, or null without an adjacency map', async () => {
    const geoRow = {
      id: 1, name: 'Dela Paz', population: 50000,
      geometry: { type: 'Polygon', coordinates: [[[121.1, 14.5], [121.11, 14.5], [121.11, 14.51], [121.1, 14.51], [121.1, 14.5]]] },
      centroid_lon: 121.105, centroid_lat: 14.505,
    };
    let adjacencyRows = [{ name: 'Dela Paz', neighbours: ['Manggahan', 'Santolan'] }];
    let callCount = 0;
    mockQueryFn = async (sql) => {
      // Checked first: the adjacency query also selects FROM barangays_geom,
      // so the geometry branch below would otherwise swallow it.
      if (sql.includes('ST_DWithin')) return { rows: adjacencyRows };
      callCount++;
      if (callCount === 1) return { rows: [geoRow] };
      if (callCount === 2) return { rows: [{ barangay_name: 'Dela Paz', risk_score: 74.8, risk_class: 'High' }] };
      return { rows: [] };
    };

    const res = await request(buildApp()).get('/api/tb/gis/geojson');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.features[0].properties.neighbours, ['Manggahan', 'Santolan']);

    // No adjacency map -> null, never a fabricated "every other barangay" list.
    adjacencyRows = [];
    callCount = 0;
    const res2 = await request(buildApp()).get('/api/tb/gis/geojson');
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.features[0].properties.neighbours, null);
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
    const res = await request(buildApp()).get('/api/tb/gis/geojson?year=2024');
    const f = res.body.features.find(x => x.properties.name === 'Dela Paz');
    assert.strictEqual(f.properties.population, null, 'no exact-year population -> null, never another year\'s figure');
    assert.strictEqual(f.properties.incidence_per_100k, null, 'missing population must surface as null, never 0');
  });

  it('GIS Year 2023 retrieves the RF snapshot trained on 2023 data (TEST F/G)', async () => {
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
    assert.deepStrictEqual(riskQueryParams, [2023], 'year=2023 must match snapshot data_year');
    const f = res.body.features.find(x => x.properties.name === 'Dela Paz');
    assert.strictEqual(f.properties.risk_class, 'Low', 'must return 2023\'s own snapshot, not a different year\'s');
    assert.strictEqual(res.body.meta.risk_assessment_period, '2024-01-01');
    assert.strictEqual(res.body.meta.requested_year, 2023);
    assert.strictEqual(res.body.meta.data_year, 2023);
    assert.strictEqual(res.body.meta.assessment_year, 2024);
    assert.strictEqual(res.body.meta.assessment_period, '2024-01-01');
    assert.strictEqual(res.body.meta.prediction_period, '2024-01-01');
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

  it('GIS Year 2026 retrieves the current 2026 RF assessment trained on 2025 data', async () => {
    const riskCalls = [];
    mockQueryFn = async (sql, params) => {
      if (sql.includes('FROM barangays_geom')) return { rows: [{ name: 'Dela Paz', population: 50000, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }] };
      if (sql.includes('FROM barangay_risk_scores')) {
        riskCalls.push({ sql, params });
        return { rows: [{ barangay_name: 'Dela Paz', period: '2026-01-01', risk_class: 'High', model_type: 'random_forest' }] };
      }
      return { rows: [] };
    };
    const res = await request(buildApp()).get('/api/tb/gis/geojson?year=2026');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(riskCalls[0].params, [2026]);
    assert.match(riskCalls[0].sql, /mm\.metrics->>'data_year'/);
    assert.strictEqual(res.body.features[0].properties.risk_class, 'High');
    assert.deepStrictEqual({
      data_year: res.body.meta.data_year,
      assessment_year: res.body.meta.assessment_year,
      assessment_period: res.body.meta.assessment_period,
      prediction_period: res.body.meta.prediction_period,
    }, { data_year: 2025, assessment_year: 2026, assessment_period: '2026-01-01',
      prediction_period: '2026-01-01' });
  });

  it('withholds confidence from a saved rule-based classification', async () => {
    let callCount = 0;
    mockQueryFn = async () => {
      callCount++;
      if (callCount === 1) return { rows: [{ name: 'Dela Paz', population: 50000, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }] };
      if (callCount === 2) return { rows: [{ barangay_name: 'Dela Paz', risk_class: 'High', model_type: 'rule_based', classification_confidence: 1, prob_high: 1, period: '2026-01-01' }] };
      return { rows: [] };
    };
    const res = await request(buildApp()).get('/api/tb/gis/geojson?year=2026');
    const feature = res.body.features[0];
    assert.strictEqual(feature.properties.model_type, 'rule_based');
    assert.strictEqual(feature.properties.classification_confidence, null);
    assert.strictEqual(feature.properties.prob_high, null);
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
  it('uses assessment year 2026 to retrieve the 2026 risk period', async () => {
    let selectedQuery;
    mockQueryFn = async (sql, params) => {
      selectedQuery = { sql, params };
      return { rows: [{ name: 'Dela Paz', period: '2026-01-01', risk_class: 'High', population: null, total_cases: 0 }] };
    };
    const res = await request(buildApp()).get('/api/tb/gis/choropleth?year=2026');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(selectedQuery.params, [2026]);
    assert.match(selectedQuery.sql, /mm\.metrics->>'data_year'/);
    assert.strictEqual(res.body.assessment_year, 2026);
    assert.strictEqual(res.body.data_year, 2025);
    assert.strictEqual(res.body.assessment_period, '2026-01-01');
  });
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

describe('GET /api/tb/evaluation/latest', () => {
  it('returns the latest saved evaluation and current evaluation status', async () => {
    const latestEvaluation = {
      id: 4,
      run_type: 'evaluation',
      trained_at: '2026-10-05T08:00:00.000Z',
      metrics: { arima: { mae: 4.6, mape: 8.2, steps: [{ month: '2025-11-01', actual: 120, predicted: 116, error: 4 }] } },
      config: { method: 'ARIMA', evaluation_start: '2025-11-01', evaluation_end: '2025-12-01' },
    };
    mockQueryFn = async sql => sql.includes("run_type = 'evaluation_failed'")
      ? { rows: [{ trained_at: '2026-10-06T08:00:00.000Z', error: 'model service unavailable' }] }
      : { rows: [latestEvaluation] };

    const res = await request(buildApp()).get('/api/tb/evaluation/latest');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.latest_evaluation.metrics.arima.steps[0], latestEvaluation.metrics.arima.steps[0]);
    assert.strictEqual(res.body.latest_evaluation.config.method, 'ARIMA');
    assert.strictEqual(res.body.evaluation_status.running, false);
    assert.strictEqual(res.body.evaluation_status.lastError, 'model service unavailable');
    assert.strictEqual(res.body.evaluation_status.failedAt, '2026-10-06T08:00:00.000Z');
  });
});

describe('GET /api/tb/forecast/backtest', () => {
  const evaluation = {
    model_version: 'arima-v1.1-rf-v1.1',
    trained_at: '2026-10-08T08:00:00.000Z',
    per_barangay: [
      { barangay_name: 'Bagong Ilog', steps: [
        { month: '2025-11-01', actual: 10, predicted: 8, method: 'arima' },
        { month: '2025-12-01', actual: 6, predicted: 7, method: 'arima' },
      ] },
      { barangay_name: 'Pinagbuhatan', steps: [{ month: '2025-11-01', actual: 30, predicted: 33 }] },
    ],
  };

  it("serves the saved model evaluation's predictions, not a seasonal stand-in", async () => {
    let sql = '';
    mockQueryFn = async q => { sql = q; return { rows: [evaluation] }; };
    const res = await request(buildApp()).get('/api/tb/forecast/backtest');

    assert.strictEqual(res.status, 200);
    assert.match(sql, /run_type = 'evaluation'/);
    assert.doesNotMatch(sql, /monthly_case_summary|tb_cases/);
    assert.strictEqual(res.body.source, 'model_evaluation');
    assert.strictEqual(res.body.evaluated_at, evaluation.trained_at);
    assert.strictEqual(res.body.data.length, 3);
    assert.deepStrictEqual(res.body.data[0], {
      barangay_name: 'Bagong Ilog', period: '2025-11-01', actual_count: 10, predicted_count: 8, error: 2, method: 'arima',
    });
  });

  it('filters to one barangay', async () => {
    mockQueryFn = async () => ({ rows: [evaluation] });
    const res = await request(buildApp()).get('/api/tb/forecast/backtest?barangay=Pinagbuhatan');
    assert.deepStrictEqual(res.body.data.map(r => r.predicted_count), [33]);
  });

  it('returns nothing (source none) before an evaluation saved per-barangay months', async () => {
    mockQueryFn = async () => ({ rows: [{ trained_at: '2026-01-01T00:00:00.000Z', per_barangay: null }] });
    const res = await request(buildApp()).get('/api/tb/forecast/backtest');
    assert.deepStrictEqual(res.body, { data: [], source: 'none', evaluated_at: null, model_version: null });
  });
});

/* --- Same-case outcome updates: reading the history they leave behind --- */

describe('GET /api/tb/cases/:caseKey/history', () => {
  // Same as buildApp, but lets a test set token claims (e.g. a staff facility).
  function appWithClaims(claims) {
    uninstallMockDb();
    installMockDb();
    clearTbinsightCache();
    const app = express();
    const token = signToken(claims.role, claims);
    app.use((req, _res, next) => { req.headers.authorization = `Bearer ${token}`; next(); });
    app.use(express.json());
    app.use('/api/tb', require('../../tbinsight/routes'));
    return app;
  }

  const caseRow = {
    id: 77, case_no: 'CS-2025-000042', patient_no: 'PT-000009',
    source_case_id: 'ROS-D-2025-00042', batch_id: 'b',
    imported_at: '2025-02-06T00:00:00Z', updated_at: '2025-06-10T00:00:00Z',
    case_status: null, treatment_outcome: 'CURED',
    outcome_status: 'CURED', source_outcome_status: 'CURED',
  };
  const historyRow = {
    id: 5, change_type: 'status_changed',
    changed_fields: { outcome_status: { old: 'ON TREATMENT', new: 'CURED' } },
    source: 'webhook', changed_by_user_id: null, changed_by_label: 'ana.cruz',
    changed_at: '2025-06-10T08:30:00Z', notes: null, batch_id: 'b',
  };

  function harness({ rows = [caseRow], history = [historyRow], users = [] } = {}) {
    const seen = [];
    mockQueryFn = async (sql, params) => {
      seen.push({ sql, params });
      if (sql.includes('FROM case_history')) return { rows: history };
      if (sql.includes('FROM users')) return { rows: users };
      if (sql.includes('FROM tb_cases')) return { rows };
      return { rows: [] };
    };
    return seen;
  }

  it('returns the case and its history, keyed by Case ID', async () => {
    const seen = harness();
    const res = await request(appWithClaims({ role: 'admin' }))
      .get('/api/tb/cases/CS-2025-000042/history');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.case.case_no, 'CS-2025-000042');
    assert.strictEqual(res.body.case.treatment_outcome, 'CURED');
    assert.strictEqual(res.body.history.length, 1);
    assert.strictEqual(res.body.history[0].change_type, 'status_changed');
    assert.deepStrictEqual(res.body.history[0].changed_fields, {
      outcome_status: { old: 'ON TREATMENT', new: 'CURED' },
    });
    assert.strictEqual(res.body.history[0].source, 'webhook');
    assert.strictEqual(res.body.history[0].actor, 'ana.cruz');
    // Matched on the stable Case ID, never on the patient.
    assert.ok(seen[0].sql.includes('c.case_no = $1'));
    assert.ok(!seen[0].sql.includes('patient_no ='), 'never matched by patient');
    assert.deepStrictEqual(seen[0].params.slice(0, 2), ['CS-2025-000042', null]);
    const historyQuery = seen.find(q => q.sql.includes('FROM case_history'));
    assert.deepStrictEqual(historyQuery.params, ['CS-2025-000042', 77]);
  });

  it('falls back to the internal id for a row imported without a Case ID', async () => {
    const seen = harness({ rows: [{ ...caseRow, case_no: null }] });
    const res = await request(appWithClaims({ role: 'admin' })).get('/api/tb/cases/77/history');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(seen[0].params.slice(0, 2), [null, 77]);
    const historyQuery = seen.find(q => q.sql.includes('FROM case_history'));
    assert.deepStrictEqual(historyQuery.params, [null, 77], 'history is read by case row, not by case_no');
  });

  it('resolves a TBInsight user id to a username when there is no source-system label', async () => {
    harness({
      history: [{ ...historyRow, changed_by_label: null, changed_by_user_id: 9 }],
      users: [{ id: 9, username: 'maria.santos' }],
    });
    const res = await request(appWithClaims({ role: 'admin' })).get('/api/tb/cases/CS-2025-000042/history');
    assert.strictEqual(res.body.history[0].actor, 'maria.santos');
  });

  it('answers 404, never 403, for a case outside a staff member facility', async () => {
    // The frontend redirects to /login on any 403, so "not yours" must read as
    // "not found" rather than as a dead session.
    const seen = [];
    mockQueryFn = async (sql, params) => {
      seen.push({ sql, params });
      // Staff scope applies to the same statement, so no row comes back.
      return { rows: [] };
    };
    const res = await request(appWithClaims({ role: 'staff', facility_id: 7 }))
      .get('/api/tb/cases/CS-2025-000042/history');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, 'Case not found.');
    const scope = '(c.current_responsible_facility_id = $3 OR c.current_responsible_facility_id IS NULL)';
    assert.ok(seen[0].sql.includes(scope), 'the shared staff rule is applied');
    assert.deepStrictEqual(seen[0].params, ['CS-2025-000042', null, 7]);
  });

  it('404s for a case that does not exist and never queries history for it', async () => {
    const seen = harness({ rows: [] });
    const res = await request(appWithClaims({ role: 'admin' })).get('/api/tb/cases/NOPE-1/history');
    assert.strictEqual(res.status, 404);
    assert.ok(!seen.some(q => q.sql.includes('FROM case_history')));
  });
});
