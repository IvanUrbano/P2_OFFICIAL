/**
 * TBInsight — /api/tb/* Authorization Tests
 *
 * The Dashboard (and every other TBInsight page) is protected on the frontend
 * by ProtectedRoute, but that guards navigation only — the API is directly
 * reachable. TBInsight holds internal TB surveillance and analytical data, so
 * every /api/tb/* route requires an authenticated Staff or Admin user, enforced
 * by a router-level guard in tbinsight/routes.js that reuses the existing
 * middleware (BACKEND/middleware/auth.js). No second auth system exists.
 *
 * These tests build the app WITHOUT the token injector that routes.test.js
 * uses, so the real authenticateToken / authorizeRoles middleware decides every
 * outcome here.
 *
 * Covers: no token -> 401, Staff read -> allowed, Admin read -> allowed,
 * Staff on an Admin-only mutation -> 403, invalid token -> 401,
 * expired token -> 401, and that Admin-only routes were not downgraded.
 *
 * Mock pool only — no database required.
 * Run: node --test BACKEND/test/tbinsight/tbAuthorization.test.js
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-authorization-tests';

/* ─── Mock pool ─── */
const MODULE_DB = require.resolve('../../db');

function installMockDb() {
  require.cache[MODULE_DB] = {
    id: MODULE_DB, filename: MODULE_DB, loaded: true,
    exports: {
      query: async () => ({ rows: [] }),
      connect: async () => {},
      end: async () => {},
    },
  };
}

function uninstallMockDb() {
  delete require.cache[MODULE_DB];
}

function clearTbinsightCache() {
  Object.keys(require.cache)
    .filter((k) => k.includes('tbinsight') || k.includes('middleware/auth'))
    .forEach((k) => delete require.cache[k]);
}

/** App with NO auth injection — the genuine middleware runs. */
function buildApp() {
  uninstallMockDb();
  installMockDb();
  clearTbinsightCache();
  const app = express();
  app.use(express.json());
  app.use('/api/tb', require('../../tbinsight/routes'));
  return app;
}

function token(role, opts = {}) {
  return jwt.sign(
    { id: 1, username: 'tester', email: 't@example.com', role },
    process.env.JWT_SECRET,
    { expiresIn: '1h', ...opts }
  );
}

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

afterEach(() => uninstallMockDb());

/* Representative read endpoints across every TBInsight surface, so securing
 * the Dashboard's two new routes while leaving the equivalent Analytics / GIS /
 * Forecast routes open would fail here. */
const READ_ENDPOINTS = [
  '/api/tb/barangays',
  '/api/tb/facilities',
  '/api/tb/filter-options',
  '/api/tb/cases',
  '/api/tb/cases/export',
  // Same-case outcome updates: reading a case's history is a read like any
  // other — 403 here would bounce the frontend to /login mid-inspection.
  '/api/tb/cases/CS-2025-000001/history',
  '/api/tb/dashboard/summary',
  '/api/tb/dashboard/monthly',
  '/api/tb/dashboard/outcomes',
  '/api/tb/dashboard/demographics',
  '/api/tb/gis/choropleth',
  '/api/tb/gis/geojson',
  '/api/tb/forecasts',
  '/api/tb/predictions/risk',
  '/api/tb/alerts',
  '/api/tb/reports/summary',
  '/api/tb/insights/analytics',
  '/api/tb/insights/dashboard',
  '/api/tb/insights/forecasting',
  '/api/tb/insights/gis',
  '/api/tb/treatment-success-rate',
  '/api/tb/case-fatality-rate',
  '/api/tb/pipeline/status',
  '/api/tb/data-freshness',
  '/api/tb/webhook-logs',
  '/api/tb/interventions',
];

/* Mutating operations that must stay Admin-only. */
const ADMIN_ONLY = [
  { method: 'post', path: '/api/tb/pipeline' },
  { method: 'post', path: '/api/tb/pipeline/historical' },
  { method: 'post', path: '/api/tb/evaluate' },
  { method: 'post', path: '/api/tb/barangays/seed' },
  { method: 'post', path: '/api/tb/alerts/evaluate' },
  { method: 'post', path: '/api/tb/interventions' },
  { method: 'delete', path: '/api/tb/interventions/1' },
  { method: 'post', path: '/api/tb/population' },
];

// ==================== 1. NO AUTHENTICATION ====================

describe('/api/tb/* — unauthenticated requests', () => {
  for (const path of READ_ENDPOINTS) {
    it(`401s without a token: ${path}`, async () => {
      const res = await request(buildApp()).get(path);
      assert.strictEqual(res.status, 401, `${path} returned ${res.status}`);
      assert.match(res.body.error || '', /token/i);
    });
  }

  it('does not leak the JWT secret or a stack trace in the 401 body', async () => {
    const res = await request(buildApp()).get('/api/tb/dashboard/summary');
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes(process.env.JWT_SECRET), 'JWT secret must not appear in a response');
    assert.ok(!/\bat\s+\w+.*:\d+:\d+/.test(body), 'no stack trace in a response');
    assert.deepStrictEqual(Object.keys(res.body), ['error']);
  });
});

// ==================== 2 & 3. STAFF / ADMIN READS ====================

describe('/api/tb/* — authenticated reads', () => {
  for (const role of ['staff', 'admin']) {
    it(`allows ${role} on every read endpoint`, async () => {
      const app = buildApp();
      const t = token(role);
      for (const path of READ_ENDPOINTS) {
        const res = await request(app).get(path).set(bearer(t));
        assert.notStrictEqual(res.status, 401, `${path} rejected ${role} with 401`);
        assert.notStrictEqual(res.status, 403, `${path} rejected ${role} with 403`);
      }
    });
  }
});

// ==================== 4. STAFF ON ADMIN-ONLY ====================

describe('/api/tb/* — Admin-only operations', () => {
  for (const { method, path } of ADMIN_ONLY) {
    it(`403s for Staff: ${method.toUpperCase()} ${path}`, async () => {
      const res = await request(buildApp())[method](path)
        .set(bearer(token('staff')))
        .send({});
      assert.strictEqual(res.status, 403, `${path} returned ${res.status} for staff`);
      assert.match(res.body.error || '', /permission/i);
    });

    it(`does not 403 for Admin: ${method.toUpperCase()} ${path}`, async () => {
      const res = await request(buildApp())[method](path)
        .set(bearer(token('admin')))
        .send({});
      // The handler may still fail against the mock pool; the point is that
      // authorization did not reject an Admin.
      assert.notStrictEqual(res.status, 403, `${path} wrongly 403'd an admin`);
      assert.notStrictEqual(res.status, 401, `${path} wrongly 401'd an admin`);
    });
  }

  it('401s an Admin-only mutation with no token at all', async () => {
    const res = await request(buildApp()).post('/api/tb/pipeline').send({});
    assert.strictEqual(res.status, 401);
  });
});

// ==================== 5 & 6. INVALID / EXPIRED TOKENS ====================

describe('/api/tb/* — malformed credentials', () => {
  it('401s an invalid token', async () => {
    const res = await request(buildApp())
      .get('/api/tb/dashboard/summary')
      .set(bearer('not-a-jwt'));
    assert.strictEqual(res.status, 401);
  });

  it('401s a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ id: 1, role: 'admin' }, 'wrong-secret', { expiresIn: '1h' });
    const res = await request(buildApp())
      .get('/api/tb/dashboard/summary')
      .set(bearer(forged));
    assert.strictEqual(res.status, 401);
  });

  it('401s an expired token', async () => {
    const expired = jwt.sign(
      { id: 1, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' }
    );
    const res = await request(buildApp())
      .get('/api/tb/dashboard/summary')
      .set(bearer(expired));
    assert.strictEqual(res.status, 401);
  });

  it('403s a valid token carrying no role', async () => {
    const roleless = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await request(buildApp())
      .get('/api/tb/dashboard/summary')
      .set(bearer(roleless));
    // Authenticated but not authorized for any TBInsight role.
    assert.strictEqual(res.status, 403);
  });

  it('403s an unknown role', async () => {
    const res = await request(buildApp())
      .get('/api/tb/dashboard/summary')
      .set(bearer(token('guest')));
    assert.strictEqual(res.status, 403);
  });
});
