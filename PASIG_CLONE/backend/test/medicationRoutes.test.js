/**
 * /api/data/medication — who may assign schedules and record pickups, enforced on the
 * backend. In-memory stand-in for the databases (no real database is touched).
 * Run: node --test test/medicationRoutes.test.js
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'test-medication-secret';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

const STAFF_BARANGAY = { 22: { barangay_id: 17, barangay_name: 'Rosario' } };
let cases;
let schedules;
let writes;
let listed;
const base = {
  source_case_id: 'ROS-D-2025-00042', case_no: 'CS-2025-000001', identity_class: 'historical', city: 'Pasig City',
  is_archived: false, merged_into_case_no: null, match_status: 'none', location_resolution: null, case_status: 'ON TREATMENT',
};

function poolQuery(sql, params = []) {
  const q = String(sql).replace(/\s+/g, ' ').trim();
  if (q.includes('FROM validated_tb_cases v WHERE v.id = $1')) return { rows: cases.filter(c => c.id === Number(params[0])) };
  if (q.includes('FROM medication_schedules s WHERE s.id = $1')) return { rows: schedules.filter(s => s.id === Number(params[0])) };
  if (q.includes('FROM medication_schedules s WHERE s.validated_case_id = $1')) {
    return { rows: schedules.filter(s => s.validated_case_id === Number(params[0])) };
  }
  if (q.startsWith('SELECT due_date::text AS due_date')) return { rows: [] };
  if (q.includes('COUNT(*)::int AS "all"')) { listed.push({ q, params }); return { rows: [{ all: 2, none: 1, ok: 0, warning: 1, critical: 0 }] }; }
  if (q.startsWith('SELECT r.* FROM')) {
    listed.push({ q, params });
    const s = schedules[0];
    return { rows: [
      { ...cases[0], schedule_id: s.id, medicines: s.medicines, interval_days: s.interval_days, start_date: s.start_date, end_date: s.end_date, missed: 2 },
      { ...cases[3], id: 5, schedule_id: null, missed: null },
    ] };
  }
  if (q.startsWith('SELECT schedule_id, due_date::text')) return { rows: [] };
  if (q.includes('NOT EXISTS (SELECT 1 FROM medication_schedules')) {
    listed.push({ q, params });
    return { rows: [{ ...base, id: 5, barangay_id: 17, barangay_name: 'Rosario', responsible_barangay_id: null }] };
  }
  if (q.includes('FROM validated_tb_cases v WHERE v.id = ANY')) return { rows: cases.filter(c => params[0].map(Number).includes(c.id)) };
  if (q.startsWith('SELECT validated_case_id FROM medication_schedules')) {
    return { rows: schedules.filter(s => s.status === 'active' && params[0].map(Number).includes(s.validated_case_id)).map(s => ({ validated_case_id: s.validated_case_id })) };
  }
  if (q.includes('FROM unnest(')) { writes.push({ q, params }); return { rows: params[0].map(id => ({ validated_case_id: id })) }; }
  if (/^(INSERT|UPDATE|DELETE)/.test(q)) {
    writes.push({ q, params });
    return { rows: q.startsWith('INSERT INTO medication_schedules') ? [{ id: 99 }] : [] };
  }
  return { rows: [] };
}

stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {}, patientNames: { enabled: false } });
stub('../db/pasigSchema', {
  pool: { query: async (s, p) => poolQuery(s, p) },
  authPool: {
    query: async (sql, params) => (String(sql).includes('FROM users u JOIN barangays b')
      ? { rows: STAFF_BARANGAY[Number(params[0])] ? [STAFF_BARANGAY[Number(params[0])]] : [] }
      : { rows: [] }),
  },
});
stub('../utils/auditLogger', { logAuditEvent: async () => {} });

const med = require('../services/medicationSchedule');
const router = require('../routes/medication');

let server; let url;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/data/medication', router);
  await new Promise(r => { server = app.listen(0, r); });
  url = `http://127.0.0.1:${server.address().port}/api/data/medication`;
});
after(() => server.close());

const today = med.manilaToday();
beforeEach(() => {
  writes = [];
  listed = [];
  cases = [
    { ...base, id: 1, barangay_id: 17, barangay_name: 'Rosario', responsible_barangay_id: null, responsible_barangay: null },     // editable
    { ...base, id: 2, barangay_id: 17, barangay_name: 'Rosario', responsible_barangay_id: 12, responsible_barangay: 'Maybunga' },  // view only
    { ...base, id: 3, barangay_id: 30, barangay_name: 'Ugong', responsible_barangay_id: null, responsible_barangay: null },        // not assigned
    { ...base, id: 4, barangay_id: 17, barangay_name: 'Rosario', case_status: null, outcome_status: 'CURED' },                      // finished treatment
  ];
  schedules = [
    { id: 10, validated_case_id: 1, status: 'active', interval_days: 7, start_date: med.addDays(today, -14), end_date: med.addDays(today, 60), medicines: [{ name: 'HRZE', quantity: 28, unit: 'tablets' }] },
    { id: 11, validated_case_id: 2, status: 'active', interval_days: 7, start_date: today, end_date: med.addDays(today, 60), medicines: [] },
    { id: 12, validated_case_id: 1, status: 'stopped', interval_days: 7, start_date: today, end_date: med.addDays(today, 60), medicines: [] },
  ];
});

const call = async (method, path, body, user = { id: 22, username: 'maria', role: 'staff' }) => {
  const token = jwt.sign(user, SECRET);
  const res = await fetch(`${url}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};
const form = {
  start_date: today, interval_days: 7, duration_value: 6, duration_unit: 'months',
  medicines: [{ name: 'HRZE (4FDC)', quantity: 28, unit: 'tablets', instructions: '4 tablets daily' }],
};

describe('assigning a schedule', () => {
  it('an admin assigns one to any patient on treatment', async () => {
    const r = await call('POST', '/3/schedule', form, { id: 1, username: 'admin', role: 'admin' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const ins = writes.find(w => w.q.startsWith('INSERT INTO medication_schedules'));
    assert.strictEqual(ins.params[0], 3);
    assert.strictEqual(ins.params[2], 7);
    assert.strictEqual(ins.params[4], med.endDateFor(today, 6, 'months'));
  });

  it('staff cannot assign one to another barangay\'s or a referred-out patient', async () => {
    assert.strictEqual((await call('POST', '/3/schedule', form)).status, 403);
    assert.strictEqual((await call('POST', '/2/schedule', form)).status, 403);
    assert.strictEqual(writes.length, 0);
  });

  it('only patients on treatment get a schedule, and the form is checked', async () => {
    assert.strictEqual((await call('POST', '/4/schedule', form)).status, 409);
    const r = await call('POST', '/1/schedule', { ...form, medicines: [] });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /at least one medicine/);
  });
});

describe('viewing', () => {
  it('lists the staff member\'s own patients on treatment with their warning and next pickup', async () => {
    const r = await call('GET', '/?level=warning&search=ROS');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.counts, { all: 2, none: 1, ok: 0, warning: 1, critical: 0 });
    assert.strictEqual(r.body.pagination.total, 1);                       // the warning count
    const [scheduled, unscheduled] = r.body.patients;
    assert.strictEqual(scheduled.level, 'warning2');
    assert.strictEqual(scheduled.next_pickup, today);
    assert.strictEqual(scheduled.permissions.edit, true);
    assert.strictEqual(unscheduled.level, null);
    const data = listed.find(l => l.q.startsWith('SELECT r.* FROM'));
    assert.match(data.q, /BETWEEN 1 AND 2/);                              // level filter
    assert.match(data.q, /v.case_status = 'ON TREATMENT'/);
    assert.strictEqual(data.params[0], 17);                                // staff barangay scope
    assert.strictEqual(data.params[1], '%ROS%');
  });

  it('lists patients whose outcome is due (on treatment past 6 months)', async () => {
    await call('GET', '/?level=outcome');
    const data = listed.find(l => l.q.startsWith('SELECT r.* FROM'));
    assert.match(data.q, /WHERE r\.outcome_due/);
    assert.match(data.q, /COALESCE\(v\.date_started_treatment, v\.date_of_diagnosis\) <= .* INTERVAL '6 months'/);
    const counts = listed.find(l => l.q.includes('AS "outcome"'));
    assert.ok(counts, 'counts include the Outcome due tab');
  });

  it('filters by barangay and Due now, and searches names only once the PIN is unlocked', async () => {
    await call('GET', '/?level=due&barangay=17&search=Cruz');
    const data = listed.find(l => l.q.startsWith('SELECT r.* FROM'));
    assert.match(data.q, /WHERE r\.due_now/);
    assert.match(data.q, /v\.barangay_id = \$2/);
    assert.strictEqual(data.params[1], 17);
    assert.doesNotMatch(data.q, /last_name ILIKE/);                       // locked: no name search
    listed = [];
    await call('GET', '/?barangay=Rosario');
    assert.match(listed[0].q, /barangay_ref_id\(\$2\)/);                  // a name resolves to its id
  });

  it('a view-only patient\'s schedule can be seen but says it cannot be changed', async () => {
    const r = await call('GET', '/2');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.patient.permissions.edit, false);
    assert.strictEqual(r.body.schedule.id, 11);
    assert.strictEqual(r.body.patient.last_name, null); // names follow the Records PIN rules
    assert.strictEqual(r.body.outcome_due, false);
    assert.strictEqual(r.body.outcome_due_months, 6);
  });

  it('another barangay\'s patient is not shown', async () => {
    assert.strictEqual((await call('GET', '/3')).status, 403);
  });

  it('the active schedule comes with its pickups and warning; stopped ones as history', async () => {
    const r = await call('GET', '/1');
    assert.strictEqual(r.body.schedule.id, 10);
    assert.strictEqual(r.body.schedule.missed, 2);           // two weekly pickups passed, none collected
    assert.strictEqual(r.body.schedule.level, 'warning2');
    assert.deepStrictEqual(r.body.history.map(s => s.id), [12]);
  });
});

describe('assigning to many patients at once', () => {
  it('creates one schedule each for the patients the user may edit, and skips the rest unchanged', async () => {
    cases.push({ ...base, id: 6, barangay_id: 17, barangay_name: 'Rosario', responsible_barangay_id: null, date_started_treatment: null });
    const r = await call('POST', '/bulk-schedule', { ...form, start_mode: 'same', case_ids: [1, 2, 3, 4, 6] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.created, 1);
    const ins = writes.find(w => w.q.includes('FROM unnest('));
    assert.deepStrictEqual(ins.params[0], [6]);
    assert.deepStrictEqual(ins.params[1], [today]);
    assert.match(ins.q, /ON CONFLICT \(validated_case_id\) WHERE status = 'active' DO NOTHING/);
    const why = Object.fromEntries(r.body.skipped.map(s => [s.id, s.reason]));
    assert.deepStrictEqual(why, { 1: 'already has a schedule', 2: 'view only for your account', 3: 'view only for your account', 4: 'not on treatment' });
  });

  it('"all matching" uses the list filters and only patients without a schedule', async () => {
    const r = await call('POST', '/bulk-schedule', { ...form, start_mode: 'same', all_matching: { barangay: '17', search: 'ROS' } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const sel = listed.find(l => l.q.includes('NOT EXISTS (SELECT 1 FROM medication_schedules'));
    assert.match(sel.q, /v\.case_status = 'ON TREATMENT'/);
    assert.match(sel.q, /v\.barangay_id = \$2/);
    assert.deepStrictEqual(sel.params.slice(0, 3), [17, 17, '%ROS%']);   // staff scope, barangay, search
    assert.strictEqual(r.body.created, 1);                                // case 5 (the stub's match)
  });

  it('checks the form and the selection first', async () => {
    assert.strictEqual((await call('POST', '/bulk-schedule', { ...form, case_ids: [] })).status, 400);
    assert.strictEqual((await call('POST', '/bulk-schedule', { ...form, start_mode: 'weird', case_ids: [1] })).status, 400);
    assert.strictEqual((await call('POST', '/bulk-schedule', { ...form, medicines: [], case_ids: [1] })).status, 400);
    assert.strictEqual(writes.length, 0);
  });
});

describe('recording pickups', () => {
  it('records a pickup on a schedule date with the medicines handed out', async () => {
    const r = await call('PUT', `/schedules/10/pickups/${med.addDays(today, -7)}`, { status: 'collected' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const ins = writes.find(w => w.q.startsWith('INSERT INTO medication_pickups'));
    assert.deepStrictEqual(ins.params.slice(1, 4), [med.addDays(today, -7), 'collected', today]);
    assert.match(ins.params[4], /HRZE/);
  });

  it('refuses dates that are not pickups, future pickups, and bad statuses', async () => {
    assert.strictEqual((await call('PUT', `/schedules/10/pickups/${med.addDays(today, -6)}`, { status: 'collected' })).status, 400);
    assert.strictEqual((await call('PUT', `/schedules/10/pickups/${med.addDays(today, 7)}`, { status: 'collected' })).status, 400);
    assert.strictEqual((await call('PUT', `/schedules/10/pickups/${today}`, { status: 'maybe' })).status, 400);
    assert.strictEqual(writes.length, 0);
  });

  it('clearing a pickup deletes the record', async () => {
    const r = await call('PUT', `/schedules/10/pickups/${today}`, { status: null });
    assert.strictEqual(r.status, 200);
    assert.ok(writes[0].q.startsWith('DELETE FROM medication_pickups'));
  });

  it('view-only patients and stopped schedules cannot be changed', async () => {
    assert.strictEqual((await call('PUT', `/schedules/11/pickups/${today}`, { status: 'collected' })).status, 403);
    assert.strictEqual((await call('POST', '/schedules/12/stop')).status, 409);
    assert.strictEqual(writes.length, 0);
  });

  it('stopping keeps the schedule as history', async () => {
    const r = await call('POST', '/schedules/10/stop');
    assert.strictEqual(r.status, 200);
    assert.match(writes[0].q, /SET status = 'stopped'/);
  });
});
