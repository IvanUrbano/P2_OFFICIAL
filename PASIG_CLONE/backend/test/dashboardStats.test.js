/**
 * Dashboard KPI stats (GET /stats):
 *   - needsReview      = possible matches + needs assignment + data issues (the three
 *                        unresolved categories — NOT the old unvalidated-rows count)
 *   - pendingReferrals = role-aware: admin sees every pending transfer city-wide, staff
 *                        only the ones awaiting THEIR barangay, staff w/o barangay see 0
 *   - synced           = eligible Pasig records TBInsight accepted: mirrors sendWebhook
 *                        (is_valid, non-duplicate, Pasig name+city, own case, synced batch)
 *   - latestSync       = newest webhook_logs attempt (sent|failed) + eligible records_synced
 *                        for that batch (feeds the Latest TBInsight Sync card)
 *   - recentImports    = batch rows with username/created_at/sync_status (Recent Imports card)
 *   - the old `pending` field is gone (only the removed KPI card used it)
 * Run: node --test test/dashboardStats.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-dashboard-stats-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

const captured = {
  countsSql: null, countsParams: null, referralSql: null, referralParams: null,
  referralQueries: 0, recentSql: null, latestSyncSql: null,
};
let staffScope = { rows: [{ barangay_id: 17, barangay_name: 'Rosario' }] };

const COUNTS = {
  total: 100, validated: 80, possible_matches: 4, needs_assignment: 3, data_issues: 2, synced: 50,
};

const DEFAULT_SYNC_ROW = {
  status: 'sent', response_code: 200, error_message: null,
  sent_at: '2026-10-03T18:55:23.636Z', filename: 'maybunga_oct.csv', records_synced: 50,
};
const DEFAULT_RECENT_ROWS = [{
  id: 9, filename: 'bagongilog.csv', username: 'admin1', total_rows: 120,
  status: 'validated', sync_status: 'synced', created_at: '2026-10-03T10:00:00.000Z',
}];
let latestSyncRow = DEFAULT_SYNC_ROW;
let recentRows = DEFAULT_RECENT_ROWS;

stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {} });
stub('../db/pasigSchema', {
  pool: {
    query: async (sql, params) => {
      const q = String(sql).replace(/\s+/g, ' ');
      if (q.includes('FROM case_transfers')) {
        captured.referralQueries += 1;
        captured.referralSql = q;
        captured.referralParams = params || [];
        return { rows: [{ count: 7 }] };
      }
      if (q.includes('FILTER (WHERE status')) {
        return { rows: [{ requires_validation: 1, ready_for_sync: 2, failed_sync: 3 }] };
      }
      if (q.includes('b.uploaded_by = u.id')) {
        captured.recentSql = q;
        return { rows: recentRows };
      }
      if (q.includes('FROM webhook_logs')) {
        captured.latestSyncSql = q;
        return { rows: latestSyncRow ? [latestSyncRow] : [] };
      }
      if (q.includes('AS possible_matches')) {
        captured.countsSql = q;
        captured.countsParams = params || [];
        return { rows: [COUNTS] };
      }
      throw new Error(`Unexpected pool query: ${q.slice(0, 100)}`);
    },
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
  },
  authPool: {
    query: async (sql) => {
      if (String(sql).includes('JOIN barangays b')) return staffScope;
      throw new Error(`Unexpected authPool query: ${String(sql).slice(0, 100)}`);
    },
  },
});
stub('../utils/auditLogger', { logAuditEvent: async () => {} });

const csvImportRouter = require('../routes/csvImport');

let server; let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/data', csvImportRouter);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/data`;
});
after(() => server.close());

const token = (role, id = 1) => jwt.sign({ id, username: `${role}${id}`, role }, SECRET);
async function call(role) {
  const res = await fetch(base + '/stats', { headers: { authorization: `Bearer ${token(role)}` } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

beforeEach(() => {
  captured.countsSql = null;
  captured.countsParams = null;
  captured.referralSql = null;
  captured.referralParams = null;
  captured.referralQueries = 0;
  captured.recentSql = null;
  captured.latestSyncSql = null;
  staffScope = { rows: [{ barangay_id: 17, barangay_name: 'Rosario' }] };
  latestSyncRow = DEFAULT_SYNC_ROW;
  recentRows = DEFAULT_RECENT_ROWS;
});

describe('dashboard stats', () => {
  it('admin: needsReview combines the three unresolved categories; pending field is gone', async () => {
    const r = await call('admin');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.needsReview, 4 + 3 + 2);
    assert.ok(!('pending' in r.body), 'the old pending field must be removed');
    assert.strictEqual(r.body.synced, 50);
    assert.strictEqual(r.body.pendingActions.needsAssignment, 3, 'admin keeps assignment in the alerts box');
  });

  it('admin: pendingReferrals counts every pending referral city-wide (no barangay filter)', async () => {
    const r = await call('admin');
    assert.strictEqual(r.body.pendingReferrals, 7);
    assert.strictEqual(captured.referralQueries, 1);
    assert.ok(!captured.referralSql.includes('to_barangay_id'), 'admin query must not filter by barangay');
    assert.deepStrictEqual(captured.referralParams, []);
  });

  it('staff: pendingReferrals only counts referrals into their own barangay', async () => {
    const r = await call('staff');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.pendingReferrals, 7);
    assert.ok(captured.referralSql.includes("status = 'pending'"));
    assert.ok(captured.referralSql.includes('AND to_barangay_id = $1'));
    assert.deepStrictEqual(captured.referralParams, [17]);
    assert.strictEqual(r.body.pendingActions.needsAssignment, 0, 'assignment stays admin-only in the alerts box');
    assert.strictEqual(r.body.needsReview, 4 + 3 + 2, 'needsReview = the three (scoped) counts');
  });

  it('staff without an assigned barangay awaits nothing', async () => {
    staffScope = { rows: [] };
    const r = await call('staff');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.pendingReferrals, 0);
    assert.strictEqual(captured.referralQueries, 0, 'no case_transfers query without a scope');
  });

  it('synced mirrors webhook eligibility, not every imported row', async () => {
    await call('admin');
    const q = captured.countsSql;
    assert.ok(q.includes('b.sync_status'), 'only batches whose webhook succeeded');
    assert.ok(q.includes('v.is_valid'), 'webhook sends is_valid rows only');
    assert.ok(q.includes("IS DISTINCT FROM 'duplicate'"), 'webhook excludes duplicates');
    assert.ok(q.includes('v.merged_into_case_no IS NULL'), 'own cases only');
    assert.ok(q.includes("v.match_status <> 'pending'"), 'no unresolved matches');
    assert.ok(q.includes('lower(v.barangay_name)'), 'Pasig name/city eligibility (unassignedSql)');
    assert.ok(!q.includes(`b.status = 'uploaded'`), 'unvalidated rows are no longer part of any KPI');
  });

  it('admin: all case KPIs are city-wide with no scope params', async () => {
    await call('admin');
    const q = captured.countsSql;
    assert.ok(q.includes('COUNT(*) FROM raw_tb_cases'), 'admin total counts every imported row');
    assert.ok(!q.includes('uploaded_by'), 'no own-upload scope for admin');
    assert.ok(!q.includes('barangay_id = $'), 'no barangay params for admin');
    assert.deepStrictEqual(captured.countsParams, []);
  });

  it('staff: case KPIs follow the TB Records scope, validation KPIs the Validation visibility', async () => {
    await call('staff');
    const q = captured.countsSql;
    assert.ok(q.includes('v.barangay_id = $1'), 'records scope: patient barangay');
    assert.ok(q.includes('v.responsible_barangay_id'), 'records scope: responsible barangay');
    assert.ok(q.includes('uploaded_by = $2'), 'validation scope: own uploads join in');
    assert.ok(q.includes('i.barangay_id = $1'), 'data issues scoped by barangay');
    assert.ok(q.includes('validated_tb_cases v WHERE NOT v.is_archived AND'), 'staff total = live cases in scope');
    assert.ok(!q.includes('COUNT(*) FROM raw_tb_cases'), 'staff never sees the city-wide raw-row total');
    assert.deepStrictEqual(captured.countsParams, [17, 1], '$1 = barangay, $2 = staff user');
  });

  it('staff without a barangay sees only their own uploads', async () => {
    staffScope = { rows: [] };
    await call('staff');
    const q = captured.countsSql;
    assert.ok(q.includes('1=0'), 'records scope denies everything');
    assert.ok(q.includes('uploaded_by = $1'), 'own uploads still visible in the validation KPIs');
    assert.ok(!q.includes('i.barangay_id'), 'no barangay filter without a barangay');
    assert.deepStrictEqual(captured.countsParams, [1]);
  });

  it('latestSync: sent attempt exposes the exact shape the Latest TBInsight Sync card renders', async () => {
    const r = await call('admin');
    assert.strictEqual(r.status, 200);
    const s = r.body.latestSync;
    assert.ok(s, 'latestSync present');
    assert.strictEqual(s.status, 'sent');
    assert.strictEqual(s.response_code, 200);
    assert.strictEqual(s.filename, 'maybunga_oct.csv');
    assert.strictEqual(s.records_synced, 50);
    assert.strictEqual(s.sent_at, '2026-10-03T18:55:23.636Z');
    assert.ok(captured.latestSyncSql.includes("wl.status IN ('sent', 'failed')"), 'only real attempts count');
    assert.ok(captured.latestSyncSql.includes('ORDER BY wl.sent_at DESC'), 'newest attempt first');
    assert.ok(captured.latestSyncSql.includes('LIMIT 1'), 'single row');
    assert.ok(captured.latestSyncSql.includes('AS records_synced'), 'eligible count travels with the row');
    assert.ok(captured.latestSyncSql.includes('v.match_status'), 'records_synced mirrors webhook eligibility');
  });

  it('latestSync: failed attempt surfaces error_message / HTTP code for the card', async () => {
    latestSyncRow = {
      status: 'failed', response_code: 502, error_message: 'TBInsight gateway timeout',
      sent_at: '2026-10-02T09:00:00.000Z', filename: 'pineda_sep.csv', records_synced: 0,
    };
    const r = await call('staff');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.latestSync.status, 'failed');
    assert.strictEqual(r.body.latestSync.error_message, 'TBInsight gateway timeout');
    assert.strictEqual(r.body.latestSync.response_code, 502);
  });

  it('latestSync: null when no sync attempt has ever been logged', async () => {
    latestSyncRow = null;
    const r = await call('admin');
    assert.strictEqual(r.body.latestSync, null);
  });

  it('recentImports carry the columns the Recent Imports card renders', async () => {
    const r = await call('admin');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.recentImports, DEFAULT_RECENT_ROWS);
    assert.ok(captured.recentSql.includes('ORDER BY b.created_at DESC'), 'newest first');
    assert.ok(captured.recentSql.includes('LIMIT 5'), 'capped at 5 batches');
    assert.ok(captured.recentSql.includes('u.username'), 'importer name for the row');
    assert.ok(captured.recentSql.includes('b.sync_status'), 'SYNCED badge source');
  });
});
