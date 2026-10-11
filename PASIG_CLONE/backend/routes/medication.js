/**
 * Medication Schedule — medicine pickup schedules for patients on treatment
 * (/api/data/medication/*). Rules: services/medicationSchedule.js.
 *
 * Who may do what follows the case (policies/permissions.js): anyone who can see a
 * case sees its schedule; whoever can edit the case (admin, or the barangay handling
 * it) can assign, change and stop the schedule and record pickups.
 */
const express = require('express');
const router = express.Router();
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { getCaseListScope, resolveUserScope } = require('../policies/caseAccessPolicy');
const { ACTIONS, assertCaseAction, casePermissions } = require('../policies/permissions');
const { NEEDS_LOCATION } = require('../services/validationQueue');
const pinService = require('../services/pinService');
const { withUserNames } = require('../services/userNames');
const { logAuditEvent } = require('../utils/auditLogger');
const med = require('../services/medicationSchedule');

const TODAY = `(NOW() AT TIME ZONE 'Asia/Manila')::date`;
const MISSED = med.missedSql('s', TODAY);
const DUE_NOW = med.dueNowSql('s', TODAY);

// Patients listed: validated, live cases still on treatment — the TB Records listing rule
// (routes/csvImport.js TB_RECORDS_LISTED) narrowed to case status ON TREATMENT.
const ON_TREATMENT = `v.is_archived = false AND v.case_status = 'ON TREATMENT'
  AND v.match_status <> 'pending' AND v.merged_into_case_no IS NULL AND NOT ${NEEDS_LOCATION}`;

const CASE_COLUMNS = `v.id, v.source_case_id, v.case_no, v.last_name, v.first_name, v.middle_name, v.suffix,
  v.identity_class, v.barangay_name, v.barangay_id, v.responsible_barangay, v.responsible_barangay_id,
  v.location_resolution, v.city, v.is_archived, v.merged_into_case_no, v.match_status, v.case_status,
  v.treatment_facility, v.date_started_treatment::text AS date_started_treatment`;
const SCHEDULE_COLUMNS = `s.id, s.validated_case_id, s.medicines, s.interval_days, s.start_date::text AS start_date,
  s.end_date::text AS end_date, s.notes, s.status, s.created_by, s.created_at, s.updated_by, s.updated_at,
  s.stopped_by, s.stopped_at`;

const fail = (res, err, fallback) => {
  if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error(`${fallback}:`, err);
  return res.status(500).json({ error: fallback });
};
const httpError = (status, message) => Object.assign(new Error(message), { status });

const audit = (req, action, scheduleId, details) => logAuditEvent({
  userId: req.user.id, username: req.user.username, actorRole: req.user.role, action,
  resourceType: 'medication_schedule', resourceId: String(scheduleId), result: 'SUCCESS', ipAddress: req.ip, details,
});

async function loadCase(caseId) {
  if (!/^\d+$/.test(String(caseId))) throw httpError(404, 'Patient not found.');
  const r = await db.pool.query(`SELECT ${CASE_COLUMNS} FROM validated_tb_cases v WHERE v.id = $1`, [caseId]);
  if (!r.rows[0]) throw httpError(404, 'Patient not found.');
  return r.rows[0];
}

async function loadSchedule(scheduleId) {
  if (!/^\d+$/.test(String(scheduleId))) throw httpError(404, 'Schedule not found.');
  const r = await db.pool.query(`SELECT ${SCHEDULE_COLUMNS} FROM medication_schedules s WHERE s.id = $1`, [scheduleId]);
  if (!r.rows[0]) throw httpError(404, 'Schedule not found.');
  return r.rows[0];
}

/** Case + schedule the user may change; throws 403/404/409 otherwise. */
async function editableSchedule(req, scheduleId) {
  const schedule = await loadSchedule(scheduleId);
  const record = await loadCase(schedule.validated_case_id);
  assertCaseAction(req.user, await resolveUserScope(req.user), ACTIONS.CASE_EDIT, record);
  if (schedule.status !== 'active') throw httpError(409, 'This schedule was stopped and can no longer be changed.');
  return { schedule, record };
}

/**
 * The list's barangay and search filters (appended to `params`) — shared by the list and
 * "assign to all matching", so a bulk assignment covers exactly the patients shown.
 */
function listFilters(req, params, query = req.query) {
  let filters = '';
  if (query.barangay) {
    // Same as TB Records: a barangay id, or a name resolved to its id.
    const raw = String(query.barangay).trim();
    const asNumber = /^\d+$/.test(raw) ? Number(raw) : null;
    const byId = asNumber != null && asNumber >= 1 && asNumber <= 2147483647;
    params.push(byId ? asNumber : raw);
    filters += byId ? ` AND v.barangay_id = $${params.length}` : ` AND v.barangay_id = barangay_ref_id($${params.length})`;
  }
  if (query.search) {
    params.push(`%${String(query.search).trim()}%`);
    const p = `$${params.length}`;
    // Names are searchable only while they would be shown (Records PIN unlocked) —
    // the same identity rule as TB Records.
    const searchable = pinService.isUnlocked(req)
      ? (pinService.namesEnabled() ? `v.identity_class IN ('historical', 'operational')` : `v.identity_class = 'historical'`)
      : null;
    const names = searchable
      ? `(${searchable} AND (v.last_name ILIKE ${p} OR v.first_name ILIKE ${p} OR v.middle_name ILIKE ${p}
         OR (v.last_name || ', ' || v.first_name) ILIKE ${p})) OR `
      : '';
    filters += ` AND (${names}v.source_case_id ILIKE ${p} OR v.case_no ILIKE ${p} OR v.barangay_name ILIKE ${p})`;
  }
  return filters;
}

/**
 * GET / — patients on treatment with their schedule's warning level.
 * Query: level = none | ok | warning | critical (warning = 1st or 2nd) | due (expected at the
 * center now), barangay (id or name), search (Case ID, barangay; names once unlocked), page, limit.
 * Sorted: most missed first, then patients without a schedule, then those on track.
 */
router.get('/', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 20), 100);
    const userScope = await resolveUserScope(req.user);
    const scope = getCaseListScope(req.user, userScope, 'v');
    const params = [...scope.params];

    const filters = listFilters(req, params);
    const rowsSql = `SELECT ${CASE_COLUMNS}, s.id AS schedule_id, s.medicines, s.interval_days,
        s.start_date::text AS start_date, s.end_date::text AS end_date,
        CASE WHEN s.id IS NULL THEN NULL ELSE ${MISSED} END AS missed,
        (s.id IS NOT NULL AND ${DUE_NOW}) AS due_now
      FROM validated_tb_cases v
      LEFT JOIN medication_schedules s ON s.validated_case_id = v.id AND s.status = 'active'
      WHERE ${scope.where} AND ${ON_TREATMENT}${filters}`;

    const level = req.query.level;
    const levelWhere = level === 'none' ? 'r.schedule_id IS NULL'
      : level === 'due' ? 'r.due_now'
      : med.levelSql(level, 'r.missed') ? `r.schedule_id IS NOT NULL AND ${med.levelSql(level, 'r.missed')}` : 'TRUE';

    const [countsRes, dataRes] = await Promise.all([
      db.pool.query(`SELECT
          COUNT(*)::int AS "all",
          COUNT(*) FILTER (WHERE r.schedule_id IS NULL)::int AS "none",
          COUNT(*) FILTER (WHERE r.missed = 0)::int AS "ok",
          COUNT(*) FILTER (WHERE r.missed BETWEEN 1 AND 2)::int AS "warning",
          COUNT(*) FILTER (WHERE r.missed >= 3)::int AS "critical",
          COUNT(*) FILTER (WHERE r.due_now)::int AS "due"
        FROM (${rowsSql}) r`, params),
      db.pool.query(`SELECT r.* FROM (${rowsSql}) r WHERE ${levelWhere}
        ORDER BY CASE WHEN r.missed > 0 THEN 0 WHEN r.schedule_id IS NULL THEN 1 ELSE 2 END,
          r.missed DESC NULLS LAST, r.start_date, r.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, (page - 1) * limit]),
    ]);

    const today = med.manilaToday();
    // The next pickup of each listed schedule: needs only its recorded pickups.
    const ids = dataRes.rows.map(r => r.schedule_id).filter(Boolean);
    const recorded = ids.length
      ? (await db.pool.query(`SELECT schedule_id, due_date::text AS due_date, status FROM medication_pickups
          WHERE schedule_id = ANY($1::bigint[])`, [ids])).rows
      : [];
    const patients = dataRes.rows.map((r) => {
      const out = { ...r, permissions: casePermissions(req.user, userScope, r) };
      if (r.schedule_id) {
        const sum = med.summarize(r, recorded.filter(p => String(p.schedule_id) === String(r.schedule_id)), today);
        Object.assign(out, { missed: sum.missed, level: sum.level, collected: sum.collected, total: sum.total,
          next_pickup: sum.next_pickup, next_state: sum.next_state, due_now: sum.due_now, finished: sum.finished });
      } else {
        out.level = null;
      }
      return out;
    });

    const total = level === 'none' ? countsRes.rows[0].none
      : ['ok', 'warning', 'critical', 'due'].includes(level) ? countsRes.rows[0][level]
        : countsRes.rows[0].all;
    res.json({
      patients: pinService.maskUnlessUnlocked(req, patients),
      counts: countsRes.rows[0],
      grace_days: med.PICKUP_GRACE_DAYS,
      today,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    fail(res, err, 'Failed to load medication schedules');
  }
});

/** GET /:caseId — one patient: active schedule with every pickup, and stopped ones. */
router.get('/:caseId', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const record = await loadCase(req.params.caseId);
    const userScope = await resolveUserScope(req.user);
    const permissions = assertCaseAction(req.user, userScope, ACTIONS.CASE_VIEW, record);
    const schedules = (await db.pool.query(
      `SELECT ${SCHEDULE_COLUMNS} FROM medication_schedules s WHERE s.validated_case_id = $1 ORDER BY s.created_at DESC`,
      [record.id]
    )).rows;
    const active = schedules.find(s => s.status === 'active') || null;
    let schedule = null;
    if (active) {
      const pickups = (await db.pool.query(
        `SELECT due_date::text AS due_date, status, collected_on::text AS collected_on, medicines, recorded_by, recorded_at
         FROM medication_pickups WHERE schedule_id = $1`,
        [active.id]
      )).rows;
      const sum = med.summarize(active, pickups);
      sum.pickups = await withUserNames(sum.pickups, { recorded_by: 'recorded_by_name' });
      [schedule] = await withUserNames([{ ...active, ...sum }], { created_by: 'created_by_name', updated_by: 'updated_by_name' });
    }
    const history = await withUserNames(schedules.filter(s => s.status === 'stopped'), { stopped_by: 'stopped_by_name' });
    res.json({
      patient: pinService.protectIdentity(req, { ...record, permissions }),
      schedule,
      history,
      grace_days: med.PICKUP_GRACE_DAYS,
      today: med.manilaToday(),
    });
  } catch (err) {
    fail(res, err, 'Failed to load the medication schedule');
  }
});

/** POST /:caseId/schedule — assign a pickup schedule (validateScheduleInput body). */
router.post('/:caseId/schedule', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const record = await loadCase(req.params.caseId);
    assertCaseAction(req.user, await resolveUserScope(req.user), ACTIONS.CASE_EDIT, record);
    if (record.case_status !== 'ON TREATMENT') throw httpError(409, 'Only patients on treatment can be given a schedule.');
    const { value, error } = med.validateScheduleInput(req.body);
    if (error) throw httpError(400, error);
    let created;
    try {
      created = (await db.pool.query(
        `INSERT INTO medication_schedules (validated_case_id, medicines, interval_days, start_date, end_date, notes, created_by, updated_by)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $7) RETURNING id`,
        [record.id, JSON.stringify(value.medicines), value.interval_days, value.start_date, value.end_date, value.notes, req.user.id]
      )).rows[0];
    } catch (err) {
      if (err.code === '23505') throw httpError(409, 'This patient already has a schedule. Refresh the page.');
      throw err;
    }
    await audit(req, 'MEDICATION_SCHEDULE_CREATE', created.id, { case_id: record.source_case_id, ...value });
    res.status(201).json({ message: 'Schedule assigned.', id: created.id });
  } catch (err) {
    fail(res, err, 'Failed to assign the schedule');
  }
});

const MAX_BULK = 3000;

/**
 * POST /bulk-schedule — one schedule form for many patients.
 * Body: the schedule form + start_mode ('same' | 'treatment_start', see planForCase) and
 * either case_ids: [...] or all_matching: { barangay, search } (every patient on treatment
 * without a schedule that the list would show). Each patient is checked like a single
 * assignment; anyone who cannot be given one is skipped, never changed.
 * Returns { created, skipped: [{ id, case_id, reason }] }.
 */
router.post('/bulk-schedule', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const mode = req.body?.start_mode || 'same';
    if (!med.START_MODES.includes(mode)) throw httpError(400, 'Choose how the first pickup date is set.');
    const { value, error } = med.validateScheduleInput(req.body);
    if (error) throw httpError(400, error);

    const userScope = await resolveUserScope(req.user);
    let rows;
    if (req.body.all_matching) {
      const scope = getCaseListScope(req.user, userScope, 'v');
      const params = [...scope.params];
      const filters = listFilters(req, params, req.body.all_matching);
      rows = (await db.pool.query(
        `SELECT ${CASE_COLUMNS} FROM validated_tb_cases v
         WHERE ${scope.where} AND ${ON_TREATMENT}${filters}
           AND NOT EXISTS (SELECT 1 FROM medication_schedules s WHERE s.validated_case_id = v.id AND s.status = 'active')
         ORDER BY v.id LIMIT ${MAX_BULK + 1}`,
        params
      )).rows;
    } else {
      const ids = [...new Set((req.body.case_ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
      if (ids.length === 0) throw httpError(400, 'Select at least one patient.');
      if (ids.length > MAX_BULK) throw httpError(400, `Up to ${MAX_BULK} patients at a time.`);
      rows = (await db.pool.query(`SELECT ${CASE_COLUMNS} FROM validated_tb_cases v WHERE v.id = ANY($1::bigint[])`, [ids])).rows;
    }
    if (rows.length > MAX_BULK) throw httpError(400, `More than ${MAX_BULK} patients match. Narrow it down with the barangay filter.`);
    if (rows.length === 0) throw httpError(400, 'No patients to assign: every matching patient already has a schedule.');

    const existing = new Set((await db.pool.query(
      `SELECT validated_case_id FROM medication_schedules WHERE status = 'active' AND validated_case_id = ANY($1::bigint[])`,
      [rows.map(r => r.id)]
    )).rows.map(r => String(r.validated_case_id)));

    const today = med.manilaToday();
    const plans = [];
    const skipped = [];
    for (const record of rows) {
      const skip = (reason) => skipped.push({ id: record.id, case_id: record.source_case_id, reason });
      if (!casePermissions(req.user, userScope, record).edit) { skip('view only for your account'); continue; }
      if (record.case_status !== 'ON TREATMENT') { skip('not on treatment'); continue; }
      if (existing.has(String(record.id))) { skip('already has a schedule'); continue; }
      const plan = med.planForCase(value, mode, record, today);
      if (plan.skip) { skip(plan.skip); continue; }
      plans.push({ id: record.id, ...plan });
    }

    let created = 0;
    if (plans.length) {
      // One statement for all of them; a schedule added meanwhile is left alone (partial unique index).
      const inserted = await db.pool.query(
        `INSERT INTO medication_schedules (validated_case_id, medicines, interval_days, start_date, end_date, notes, created_by, updated_by)
         SELECT p.id, $4::jsonb, $5, p.start_date, p.end_date, $6, $7, $7
         FROM unnest($1::bigint[], $2::date[], $3::date[]) AS p(id, start_date, end_date)
         ON CONFLICT (validated_case_id) WHERE status = 'active' DO NOTHING
         RETURNING validated_case_id`,
        [plans.map(p => p.id), plans.map(p => p.start_date), plans.map(p => p.end_date),
          JSON.stringify(value.medicines), value.interval_days, value.notes, req.user.id]
      );
      created = inserted.rows.length;
      const done = new Set(inserted.rows.map(r => String(r.validated_case_id)));
      plans.filter(p => !done.has(String(p.id))).forEach(p => {
        skipped.push({ id: p.id, case_id: rows.find(r => r.id === p.id)?.source_case_id, reason: 'already has a schedule' });
      });
    }
    await audit(req, 'MEDICATION_SCHEDULE_BULK_CREATE', 'bulk', {
      created, skipped: skipped.length, start_mode: mode, interval_days: value.interval_days,
      duration: `${value.duration_value} ${value.duration_unit}`, medicines: value.medicines.map(m => m.name),
    });
    res.status(created ? 201 : 200).json({
      message: `Assigned ${created} schedule${created === 1 ? '' : 's'}${skipped.length ? `, skipped ${skipped.length}` : ''}.`,
      created,
      skipped,
    });
  } catch (err) {
    fail(res, err, 'Failed to assign the schedules');
  }
});

/** PUT /schedules/:id — change the schedule. Recorded pickups are kept. */
router.put('/schedules/:id', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { schedule, record } = await editableSchedule(req, req.params.id);
    const { value, error } = med.validateScheduleInput(req.body);
    if (error) throw httpError(400, error);
    await db.pool.query(
      `UPDATE medication_schedules SET medicines = $2::jsonb, interval_days = $3, start_date = $4, end_date = $5,
         notes = $6, updated_by = $7, updated_at = NOW() WHERE id = $1`,
      [schedule.id, JSON.stringify(value.medicines), value.interval_days, value.start_date, value.end_date, value.notes, req.user.id]
    );
    await audit(req, 'MEDICATION_SCHEDULE_UPDATE', schedule.id, { case_id: record.source_case_id, ...value });
    res.json({ message: 'Schedule updated.' });
  } catch (err) {
    fail(res, err, 'Failed to update the schedule');
  }
});

/** POST /schedules/:id/stop — end the schedule early (kept as history). */
router.post('/schedules/:id/stop', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { schedule, record } = await editableSchedule(req, req.params.id);
    await db.pool.query(
      `UPDATE medication_schedules SET status = 'stopped', stopped_by = $2, stopped_at = NOW(), updated_by = $2, updated_at = NOW()
       WHERE id = $1`,
      [schedule.id, req.user.id]
    );
    await audit(req, 'MEDICATION_SCHEDULE_STOP', schedule.id, { case_id: record.source_case_id });
    res.json({ message: 'Schedule stopped.' });
  } catch (err) {
    fail(res, err, 'Failed to stop the schedule');
  }
});

/**
 * PUT /schedules/:id/pickups/:date — record one pickup.
 * Body: { status: 'collected' | 'missed' | null (clear), collected_on? (defaults to today) }.
 * The date must be one of the schedule's pickup dates and not in the future.
 */
router.put('/schedules/:id/pickups/:date', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { schedule } = await editableSchedule(req, req.params.id);
    const date = req.params.date;
    if (!med.isIsoDate(date) || !med.pickupDates(schedule).includes(date)) {
      throw httpError(400, 'That date is not a pickup date on this schedule.');
    }
    const today = med.manilaToday();
    if (date > today) throw httpError(400, 'A pickup cannot be recorded before its date.');
    const status = req.body?.status ?? null;
    if (status === null) {
      await db.pool.query('DELETE FROM medication_pickups WHERE schedule_id = $1 AND due_date = $2', [schedule.id, date]);
      return res.json({ message: 'Pickup cleared.' });
    }
    if (!['collected', 'missed'].includes(status)) throw httpError(400, "Status must be 'collected' or 'missed'.");
    let collectedOn = null;
    if (status === 'collected') {
      collectedOn = req.body.collected_on || today;
      if (!med.isIsoDate(collectedOn) || collectedOn > today || collectedOn < med.addDays(date, -med.MAX_BACKDATE_DAYS)) {
        throw httpError(400, 'Enter a valid collection date (not in the future).');
      }
    }
    await db.pool.query(
      `INSERT INTO medication_pickups (schedule_id, due_date, status, collected_on, medicines, recorded_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (schedule_id, due_date) DO UPDATE SET status = EXCLUDED.status, collected_on = EXCLUDED.collected_on,
         medicines = EXCLUDED.medicines, recorded_by = EXCLUDED.recorded_by, recorded_at = NOW()`,
      [schedule.id, date, status, collectedOn, status === 'collected' ? JSON.stringify(schedule.medicines) : null, req.user.id]
    );
    res.json({ message: status === 'collected' ? 'Pickup recorded as collected.' : 'Pickup recorded as missed.' });
  } catch (err) {
    fail(res, err, 'Failed to record the pickup');
  }
});

module.exports = router;
