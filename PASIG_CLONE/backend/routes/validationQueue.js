/**
 * Validation work queue — the four Validation tabs and their actions.
 * Tab definitions: services/validationQueue.js. Mounted at /api/data/validation-queue.
 *
 *   GET  /summary                 counts per tab + per-batch breakdown
 *   GET  /ready                   records with no unresolved issue
 *   GET  /matches                 pending possible matches, sub-classified, with diffs
 *        (resolved through POST /api/data/records/:id/resolve-match and /records/resolve-matches)
 *   GET  /assignment              location groups + unmapped facility names       (admin)
 *   GET  /assignment/location/records      one location group's records, to review (admin)
 *   POST /assignment/location/records/:id  assign ONE record's barangay / mark it outside Pasig (admin)
 *   POST /assignment/location     classify a non-Pasig-city group as outside Pasig (admin)
 *   POST /assignment/facility     resolve an unknown facility name: map it to a registry
 *                                  facility (alias optional) or register a new one   (admin)
 *   POST /assignment/facility/accept-suggestions   map every confidently-suggested name (admin)
 *   GET  /issues                  open data issues
 *   PUT  /issues/:id              correct a data issue (becomes a validated case when clean)
 *   POST /issues/:id/exclude      exclude a data issue (kept, never sent)
 *
 * Staff see their barangay's records plus every row of the batches they uploaded (the
 * results of their own imports — view only: edits always go through the barangay id
 * permission checks, never uploaded_by). Location and facility decisions are admin-only.
 * Patient names are masked until the Records PIN is entered.
 */

const express = require('express');
const router = express.Router();
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const notifications = require('../services/notifications');
const { logAuditEvent } = require('../utils/auditLogger');
const pinService = require('../services/pinService');
const { resolveUserScope, getCaseListScope } = require('../policies/caseAccessPolicy');
const {
  ACTIONS, can, casePermissions, issuePermissions, validationPermissions,
} = require('../policies/permissions');
const {
  LIVE, NEEDS_LOCATION, NEEDS_FACILITY, MATCH_PENDING, READY, SENDS_TO_TBINSIGHT,
  categorizeMatch, issueType, issueField, suggestFacility, ymd, normFacility,
} = require('../services/validationQueue');
const { cleanRecord, PASIG_BARANGAYS } = require('../services/dataCleaner');
const { validateRecord, getValidBarangays, INSERT_COLUMNS, rowValues, identityRuleFor, currentIssueErrors } = require('../services/validator');
const { createPatient, nextCaseNo } = require('../services/matchResolution');
const { resyncSyncedCases, logReviews } = require('../services/caseFollowUp');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 50;
const canonicalBarangay = (name) => {
  const n = String(name ?? '').trim().toLowerCase();
  return n ? PASIG_BARANGAYS.find(b => b.toLowerCase() === n) || null : null;
};
const ipOf = (req) => req.ip || req.connection?.remoteAddress || null;

/**
 * Staff visibility on Validation = the rows of batches THEY uploaded, plus their own
 * barangay's rows in any batch ("see the results of their imports"). The upload only
 * grants SEEING a row — every edit action still goes through the barangay-id permission
 * checks (issuePermissions / assertCaseAction), never uploaded_by.
 * Returns the SQL fragment for `batch_id IN (SELECT … uploaded_by = me)`.
 */
function ownUploadsClause(alias, params, req) {
  params.push(req.user.id);
  const p = alias ? `${alias}.` : '';
  return `${p}batch_id IN (SELECT id FROM import_batches WHERE uploaded_by = $${params.length})`;
}

/** WHERE + params for case-based tabs: live records the user may see (+ batch filter). */
async function caseScope(req) {
  const userScope = await resolveUserScope(req.user);
  const s = getCaseListScope(req.user, userScope, 'v', 1);
  const params = [...s.params];
  const visibility = req.user.role === 'admin'
    ? '1=1'
    : `(${s.where} OR ${ownUploadsClause('v', params, req)})`;
  let where = `${LIVE} AND ${visibility}`;
  if (req.query.batch && UUID_RE.test(req.query.batch)) {
    params.push(req.query.batch);
    where += ` AND v.batch_id = $${params.length}`;
  }
  return { where, params, userScope };
}

/**
 * WHERE + params for open data issues the user may see (+ batch filter). Visibility
 * follows the same union as caseScope: their barangay's issues, or any issue from a
 * batch they uploaded (including rows whose barangay never matched — those carry
 * barangay_id NULL and are view-only for staff; see issuePermissions).
 */
function issueScope(req, userScope) {
  const params = [];
  // Issues whose batch was deleted are leftovers (older deletes did not remove them):
  // never listed or counted.
  let where = `i.status = 'open' AND EXISTS (SELECT 1 FROM import_batches ib WHERE ib.id = i.batch_id)`;
  if (req.user.role !== 'admin') {
    const clauses = [];
    if (userScope?.barangay_id != null) {
      params.push(userScope.barangay_id);
      clauses.push(`i.barangay_id = $${params.length}`);
    }
    clauses.push(ownUploadsClause('i', params, req));
    // No recognised barangay id still leaves their own uploads visible; editing an
    // issue stays denied by issuePermissions (fail closed).
    where += ` AND (${clauses.join(' OR ')})`;
  }
  if (req.query.batch && UUID_RE.test(req.query.batch)) {
    params.push(req.query.batch);
    where += ` AND i.batch_id = $${params.length}`;
  }
  return { where, params };
}

const NAME_FIELDS = ['last_name', 'first_name', 'middle_name', 'suffix', 'date_of_birth'];
// Data-issue rows keep the uploaded values in a JSON record; the issue's identity_class
// (migration 015) decides what may be shown — same rule as cases (pinService.protectIdentity).
// hidden_identity_fields lists de-identified fields that hold a stored value: those are
// shown as "De-identified" and cannot be changed.
function maskIssueRecord(req, record, identityClass) {
  if (!record) return record;
  const protectedRow = pinService.protectIdentity(req, { ...record, identity_class: identityClass });
  const out = { ...record, ...Object.fromEntries(NAME_FIELDS.map(f => [f, protectedRow[f]])) };
  delete out.identity_class;
  if (protectedRow.identity_masked) out.identity_masked = true;
  if (protectedRow.identity_deidentified) {
    out.identity_deidentified = true;
    out.hidden_identity_fields = NAME_FIELDS.filter(f => record[f] !== null && record[f] !== undefined && String(record[f]).trim() !== '');
  }
  return out;
}

// ==================== SUMMARY ====================
router.get('/summary', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { where, params, userScope } = await caseScope(req);
    const iss = issueScope(req, userScope);
    // Needs Assignment badge = RECORDS whose location is undecided (same number as the
    // Dashboard's Needs Review -> assignment). Unmapped facility names are counted as
    // NAMES, not records: one mapping fixes every record using the name, and those
    // records are already validated — counting them per record inflated the badge
    // (~9,300 vs 1,555 real location decisions).
    const counts = `
      COUNT(*) FILTER (WHERE ${READY})::int AS ready,
      COUNT(*) FILTER (WHERE ${MATCH_PENDING})::int AS matches,
      COUNT(*) FILTER (WHERE ${NEEDS_LOCATION})::int AS location,
      COUNT(*) FILTER (WHERE ${NEEDS_FACILITY})::int AS facility`;
    const facilityNames = (scopeWhere, groupBy) => `
      SELECT ${groupBy ? 'v.batch_id, ' : ''}COUNT(DISTINCT norm_facility(f.name))::int AS names
      FROM validated_tb_cases v
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN v.treatment_facility_id IS NULL THEN NULLIF(trim(v.treatment_facility), '') END),
        (CASE WHEN v.screening_facility_id IS NULL THEN NULLIF(trim(v.screening_facility), '') END)) AS f(name)
      WHERE ${scopeWhere} AND v.match_status <> 'pending' AND f.name IS NOT NULL
      ${groupBy ? 'GROUP BY v.batch_id' : ''}`;

    // Per-batch breakdown ignores the batch filter so the selector can show every batch.
    const allScope = await caseScope({ ...req, query: {} });
    const allIss = issueScope({ ...req, query: {} }, userScope);

    const [totals, issues, perBatch, perBatchIssues, batches, facTotal, facPerBatch] = await Promise.all([
      db.pool.query(`SELECT ${counts} FROM validated_tb_cases v WHERE ${where}`, params),
      db.pool.query(`SELECT COUNT(*)::int AS n FROM validation_issues i WHERE ${iss.where}`, iss.params),
      db.pool.query(`SELECT v.batch_id, ${counts} FROM validated_tb_cases v WHERE ${allScope.where} GROUP BY v.batch_id`, allScope.params),
      db.pool.query(`SELECT i.batch_id, COUNT(*)::int AS n FROM validation_issues i WHERE ${allIss.where} GROUP BY i.batch_id`, allIss.params),
      db.pool.query(
        `SELECT id, filename, created_at, status, sync_status, total_rows, uploaded_by
         FROM import_batches WHERE COALESCE(is_archived, false) = false
         ORDER BY created_at DESC LIMIT 100`
      ),
      db.pool.query(facilityNames(where, false), params),
      db.pool.query(facilityNames(allScope.where, true), allScope.params),
    ]);
    const facNamesByBatch = new Map(facPerBatch.rows.map(r => [r.batch_id, r.names]));

    const byBatch = new Map(perBatch.rows.map(r => [r.batch_id, r]));
    const issuesByBatch = new Map(perBatchIssues.rows.map(r => [r.batch_id, r.n]));
    const batchRows = batches.rows
      .map(b => {
        const c = byBatch.get(b.id) || { ready: 0, matches: 0, location: 0, facility: 0 };
        const openIssues = issuesByBatch.get(b.id) || 0;
        const facNames = facNamesByBatch.get(b.id) || 0;
        return {
          ...b,
          counts: { ready: c.ready, matches: c.matches, assignment: c.location, facilityNames: facNames, issues: openIssues },
          // Open decisions: matches + location records + data issues + facility NAMES.
          open_items: c.matches + c.location + openIssues + facNames,
          // Who may press "Validate" (writes batch metadata): the uploader or an admin.
          can_validate: req.user.role === 'admin' || (b.uploaded_by != null && Number(b.uploaded_by) === Number(req.user.id)),
        };
      })
      .filter(b => b.status === 'uploaded' || b.counts.ready + b.open_items > 0);

    const t = totals.rows[0];
    res.json({
      counts: {
        ready: t.ready,
        matches: t.matches,
        assignment: t.location,
        assignmentDetail: { location: t.location, facilityNames: facTotal.rows[0]?.names || 0, facilityRecords: t.facility },
        issues: issues.rows[0].n,
      },
      batches: batchRows,
      isAdmin: req.user.role === 'admin',
      permissions: validationPermissions(req.user),
      identityUnlocked: pinService.isUnlocked(req),
    });
  } catch (error) {
    console.error('Validation summary error:', error);
    res.status(500).json({ error: 'Failed to load validation summary.' });
  }
});

// ==================== READY ====================
router.get('/ready', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const { where, params } = await caseScope(req);
    const [count, rows] = await Promise.all([
      db.pool.query(`SELECT COUNT(*)::int AS n FROM validated_tb_cases v WHERE ${where} AND ${READY}`, params),
      db.pool.query(
        `SELECT v.id, v.batch_id, v.case_no, p.patient_no, v.last_name, v.first_name, v.middle_name, v.suffix, v.identity_class,
                v.barangay_name, v.date_of_diagnosis, v.outcome_status, v.source_type,
                v.treatment_facility, fr.name AS treatment_facility_registry, v.location_resolution,
                ${SENDS_TO_TBINSIGHT} AS sends_to_tbinsight
         FROM validated_tb_cases v
         LEFT JOIN patients p ON p.id = v.patient_id
         LEFT JOIN facility_ref fr ON fr.id = v.treatment_facility_id
         WHERE ${where} AND ${READY}
         ORDER BY v.id DESC LIMIT ${PAGE_SIZE} OFFSET $${params.length + 1}`,
        [...params, (page - 1) * PAGE_SIZE]
      ),
    ]);
    res.json({
      records: pinService.maskUnlessUnlocked(req, rows.rows),
      pagination: { page, limit: PAGE_SIZE, total: count.rows[0].n, totalPages: Math.ceil(count.rows[0].n / PAGE_SIZE) },
    });
  } catch (error) {
    console.error('Validation ready error:', error);
    res.status(500).json({ error: 'Failed to load ready records.' });
  }
});

// ==================== POSSIBLE MATCHES ====================
router.get('/matches', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { where, params, userScope } = await caseScope(req);
    const result = await db.pool.query(
      `SELECT v.*, p.patient_no FROM validated_tb_cases v LEFT JOIN patients p ON p.id = v.patient_id
       WHERE ${where} AND ${MATCH_PENDING} ORDER BY v.id DESC LIMIT 500`,
      params
    );
    const candNos = [...new Set(result.rows.map(r => r.match_candidate_case_no).filter(Boolean))];
    const cands = candNos.length ? (await db.getCasesByCaseNo(candNos)).rows : [];
    const byNo = new Map(cands.map(c => [c.case_no, c]));
    let records = result.rows.map(r => {
      const found = byNo.get(r.match_candidate_case_no) || null;
      // "Same case" writes onto the existing case, so its permissions matter too.
      const candidate = found ? { ...found, permissions: casePermissions(req.user, userScope, found) } : null;
      return { ...r, candidate, ...categorizeMatch(r, found), permissions: casePermissions(req.user, userScope, r) };
    });
    const categoryCounts = records.reduce((acc, r) => ({ ...acc, [r.category]: (acc[r.category] || 0) + 1 }), {});
    if (req.query.category) records = records.filter(r => r.category === req.query.category);

    res.json({ records: pinService.maskUnlessUnlocked(req, records), categoryCounts });
  } catch (error) {
    console.error('Validation matches error:', error);
    res.status(500).json({ error: 'Failed to load possible matches.' });
  }
});

// ==================== NEEDS ASSIGNMENT ====================
router.get('/assignment', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { where, params } = await caseScope(req);
    const [locations, facilities, options] = await Promise.all([
      db.pool.query(
        `SELECT COALESCE(NULLIF(trim(v.barangay_name), ''), '') AS barangay_text,
                COALESCE(NULLIF(trim(v.city), ''), '') AS city_text,
                COUNT(*)::int AS records,
                MIN(v.date_of_diagnosis) AS first_dx, MAX(v.date_of_diagnosis) AS last_dx
         FROM validated_tb_cases v WHERE ${where} AND ${NEEDS_LOCATION}
         GROUP BY 1, 2 ORDER BY records DESC, 1 LIMIT 300`,
        params
      ),
      db.pool.query(
        `SELECT norm_facility(t) AS alias_norm, MAX(t) AS facility_text, SUM(n)::int AS records,
                array_agg(DISTINCT field) AS fields
         FROM (
           SELECT v.treatment_facility AS t, 'treatment' AS field, COUNT(*) AS n
           FROM validated_tb_cases v
           WHERE ${where} AND v.match_status <> 'pending'
             AND NULLIF(trim(v.treatment_facility), '') IS NOT NULL AND v.treatment_facility_id IS NULL
           GROUP BY 1, 2
           UNION ALL
           SELECT v.screening_facility, 'screening', COUNT(*)
           FROM validated_tb_cases v
           WHERE ${where} AND v.match_status <> 'pending'
             AND NULLIF(trim(v.screening_facility), '') IS NOT NULL AND v.screening_facility_id IS NULL
           GROUP BY 1, 2
         ) x
         GROUP BY 1 ORDER BY records DESC LIMIT 300`,
        params
      ),
      db.pool.query(
        `SELECT id, name, barangay_name, ownership, facility_category, is_external, is_reference, is_active
         FROM facility_ref WHERE COALESCE(is_active, TRUE) ORDER BY is_external, name`
      ),
    ]);
    res.json({
      locations: locations.rows,
      facilities: facilities.rows.map(f => ({ ...f, suggestion: suggestFacility(f.facility_text, options.rows) })),
      facilityOptions: options.rows,
      barangays: PASIG_BARANGAYS,
      permissions: validationPermissions(req.user),
    });
  } catch (error) {
    console.error('Validation assignment error:', error);
    res.status(500).json({ error: 'Failed to load assignment queue.' });
  }
});

// ---------- Location: record-by-record review ----------
// A group (same barangay/city text in the file) is NEVER bulk-assigned to one barangay:
// records with a missing barangay can belong to different barangays, and the facility a
// patient used does not tell where they live. An admin reviews each record and assigns
// its barangay individually. The only bulk action is "Outside Pasig" for groups whose
// city clearly is not Pasig (e.g. City = TAYTAY).

const isPasigCityText = (city) => ['pasig city', 'pasig', ''].includes(String(city ?? '').trim().toLowerCase());

function locationGroupWhere(q, startParams) {
  const params = [...startParams, String(q.barangay_text ?? ''), String(q.city_text ?? '')];
  let where = `${LIVE} AND ${NEEDS_LOCATION}
    AND COALESCE(NULLIF(trim(v.barangay_name), ''), '') = $${params.length - 1}
    AND COALESCE(NULLIF(trim(v.city), ''), '') = $${params.length}`;
  if (q.batch && UUID_RE.test(q.batch)) {
    params.push(q.batch);
    where += ` AND v.batch_id = $${params.length}`;
  }
  return { where, params };
}

// Records of one location group, for the Review Records panel.
router.get('/assignment/location/records', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const { where, params } = locationGroupWhere(req.query, []);
    const [count, rows] = await Promise.all([
      db.pool.query(`SELECT COUNT(*)::int AS n FROM validated_tb_cases v WHERE ${where}`, params),
      db.pool.query(
        `SELECT v.id, v.case_no, p.patient_no, v.last_name, v.first_name, v.middle_name, v.suffix, v.identity_class,
                v.sex, v.age, v.date_of_diagnosis, v.barangay_name, v.city, v.source_type,
                v.treatment_facility, v.screening_facility, b.filename
         FROM validated_tb_cases v
         LEFT JOIN patients p ON p.id = v.patient_id
         LEFT JOIN import_batches b ON b.id = v.batch_id
         WHERE ${where}
         ORDER BY v.date_of_diagnosis DESC NULLS LAST, v.id
         LIMIT ${PAGE_SIZE} OFFSET $${params.length + 1}`,
        [...params, (page - 1) * PAGE_SIZE]
      ),
    ]);
    res.json({
      records: pinService.maskUnlessUnlocked(req, rows.rows),
      identityUnlocked: pinService.isUnlocked(req),
      barangays: (await db.pool.query('SELECT id, name FROM barangay_ref ORDER BY name')).rows,
      canBulkOutsidePasig: !isPasigCityText(req.query.city_text),
      pagination: { page, limit: PAGE_SIZE, total: count.rows[0].n, totalPages: Math.ceil(count.rows[0].n / PAGE_SIZE) },
    });
  } catch (error) {
    console.error('Location review records error:', error);
    res.status(500).json({ error: 'Failed to load records.' });
  }
});

// Resolve ONE record: assign its barangay (by id) or classify it as outside Pasig.
router.post('/assignment/location/records/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { action } = req.body || {};
    if (!['assign', 'outside_pasig'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "assign" or "outside_pasig".' });
    }
    const record = (await db.pool.query(
      `SELECT v.id, v.case_no, v.barangay_name, v.city FROM validated_tb_cases v
       WHERE v.id = $1 AND ${LIVE} AND ${NEEDS_LOCATION}`,
      [req.params.id]
    )).rows[0];
    if (!record) return res.status(404).json({ error: 'This record no longer needs a location decision.' });

    let barangay = null;
    let updated;
    if (action === 'assign') {
      barangay = (await db.pool.query('SELECT id, name FROM barangay_ref WHERE id = $1', [Number(req.body.barangay_id)])).rows[0];
      if (!barangay) return res.status(400).json({ error: 'Choose one of the Pasig barangays.' });
      // barangay_id is authoritative; the trigger (migration 008) fills barangay_name.
      updated = await db.pool.query(
        `UPDATE validated_tb_cases
         SET barangay_id = $2, city = 'Pasig City', location_resolution = NULL,
             location_resolved_by = $3, location_resolved_at = NOW(), updated_by = $3, updated_at = NOW()
         WHERE id = $1 RETURNING id, case_no, barangay_id, barangay_name`,
        [record.id, barangay.id, req.user.id]
      );
    } else {
      updated = await db.pool.query(
        `UPDATE validated_tb_cases
         SET location_resolution = 'outside_pasig', location_resolved_by = $2, location_resolved_at = NOW()
         WHERE id = $1 RETURNING id, case_no`,
        [record.id, req.user.id]
      );
    }
    const row = updated.rows[0];

    await logReviews(db.pool, req.user.id, [{
      validated_case_id: row.id, case_no: row.case_no, review_type: 'assignment',
      decision: action === 'assign' ? 'barangay_assigned' : 'outside_pasig',
      previous_status: `${record.barangay_name || '(blank)'}${record.city ? `, ${record.city}` : ''}`,
      new_status: action === 'assign' ? barangay.name : 'outside_pasig',
      notes: null,
    }]);
    const sync = action === 'assign'
      ? await resyncSyncedCases([row.case_no], req.user, 'Barangay assignment')
      : { status: 'none', count: 0 };
    if (action === 'assign') {
      await notifications.notify(await notifications.barangayStaff(barangay.id), {
        type: 'case_assigned', severity: 'info', actorId: req.user.id,
        title: 'TB case assigned to your barangay',
        message: `Case ${row.case_no || `#${row.id}`} was assigned to ${barangay.name} during validation.`,
        link: `/records?record=${row.id}`, entityType: 'validated_tb_cases', entityId: row.id,
      });
    }
    await logAuditEvent({
      userId: req.user.id, username: req.user.username,
      action: action === 'assign' ? 'ASSIGN_BARANGAY' : 'CONFIRM_OUTSIDE_PASIG',
      resourceType: 'validated_tb_cases', resourceId: String(row.id), result: 'SUCCESS', ipAddress: ipOf(req),
      details: { caseNo: row.case_no, from: record.barangay_name || null, city: record.city || null, barangay: barangay?.name || null, sync: sync.status },
    });

    res.json({
      message: action === 'assign'
        ? `${row.case_no || 'Record'} assigned to ${barangay.name}. ${barangay.name} staff can now see it.`
        : `${row.case_no || 'Record'} classified as outside Pasig. It stays in PASIG TB-IS and is not sent to TBInsight.`,
      sync,
    });
  } catch (error) {
    console.error('Location record resolve error:', error);
    res.status(500).json({ error: 'Failed to update the record.' });
  }
});

// Bulk: classify a whole group as outside Pasig — only when its city clearly is not Pasig.
// Assigning a barangay is never done in bulk (use the record review above).
router.post('/assignment/location', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { barangay_text = '', city_text = '', action } = req.body || {};
    if (action !== 'outside_pasig') {
      return res.status(400).json({ error: 'Barangays are assigned one record at a time — use Review Records.' });
    }
    if (isPasigCityText(city_text)) {
      return res.status(400).json({ error: 'Only groups whose city is clearly outside Pasig can be classified in bulk. Review these records individually.' });
    }
    const { where, params } = locationGroupWhere({ ...req.body, barangay_text, city_text }, [req.user.id]);
    const updated = await db.pool.query(
      `UPDATE validated_tb_cases v
       SET location_resolution = 'outside_pasig', location_resolved_by = $1, location_resolved_at = NOW()
       WHERE ${where}
       RETURNING v.id, v.case_no`,
      params
    );

    await logReviews(db.pool, req.user.id, updated.rows.map(r => ({
      validated_case_id: r.id, case_no: r.case_no, review_type: 'assignment', decision: 'outside_pasig',
      previous_status: `${barangay_text || '(blank)'}, ${city_text}`, new_status: 'outside_pasig', notes: '(group)',
    })));
    await logAuditEvent({
      userId: req.user.id, username: req.user.username, action: 'CONFIRM_OUTSIDE_PASIG',
      resourceType: 'validated_tb_cases', resourceId: null, result: 'SUCCESS', ipAddress: ipOf(req),
      details: { barangay_text, city_text, records: updated.rowCount },
    });

    res.json({
      message: `${updated.rowCount} record(s) from ${city_text} classified as outside Pasig. They stay in PASIG TB-IS and are not sent to TBInsight.`,
      updated: updated.rowCount,
    });
  } catch (error) {
    console.error('Location assignment error:', error);
    res.status(500).json({ error: 'Failed to update records.' });
  }
});

const FACILITY_CATEGORIES = ['health_center', 'hospital', 'clinic', 'laboratory', 'treatment_center', 'other'];
const FACILITY_TYPES = ['HC', 'PC', 'ITC', 'Floodway'];
// The queue's register dialog asks for facility_type; category is redundant with it, so
// when the caller does not send one it is derived instead of stored as 'other'.
const CATEGORY_BY_TYPE = { HC: 'health_center', PC: 'clinic', ITC: 'treatment_center', Floodway: 'health_center' };

// Map a source facility name to a registry facility (or register a new one first). The
// mapping applies to every record with that name, now and in future imports — and the
// spelling is ALWAYS recorded as an alias: refreshFacilityIds recomputes every case's
// facility id from the raw text + facility_aliases, so ids written without an alias
// would silently revert on the next refresh. An alias another facility already owns is
// never stolen — the admin gets a 409 and unmaps the other one first.
router.post('/assignment/facility', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const text = String(req.body?.facility_text || '').trim();
    const action = req.body?.action;
    if (!text) return res.status(400).json({ error: 'Facility name is required.' });
    if (!['map', 'register'].includes(action)) return res.status(400).json({ error: 'Action must be "map" or "register".' });
    const textNorm = normFacility(text);

    let facility;
    if (action === 'map') {
      const id = Number(req.body.facility_id);
      facility = (await db.pool.query('SELECT id, name, is_active FROM facility_ref WHERE id = $1', [id])).rows[0];
      if (!facility) return res.status(400).json({ error: 'Choose a registered facility.' });
      if (facility.is_active === false) {
        return res.status(409).json({ error: `${facility.name} is inactive — reactivate it before mapping records to it.` });
      }
      // The source text may not already be another facility's canonical name: records
      // carrying it would land on the wrong facility forever.
      const clash = (await db.pool.query('SELECT id, name FROM facility_ref')).rows
        .find(o => Number(o.id) !== Number(facility.id) && normFacility(o.name) === textNorm);
      if (clash) {
        return res.status(409).json({ error: `"${text}" is already the name of ${clash.name} — map to it instead.` });
      }
    } else {
      const f = req.body.facility || {};
      const name = String(f.name || '').trim();
      const isExternal = Boolean(f.is_external);
      const isActive = f.is_active !== false;
      const ownership = f.ownership === 'private' ? 'private' : f.ownership === 'public' ? 'public' : null;
      const rawType = String(f.facility_type ?? '').trim();
      if (rawType && !FACILITY_TYPES.includes(rawType)) {
        return res.status(400).json({ error: 'Please select a valid facility type.' });
      }
      const facilityType = rawType || 'HC';
      const category = FACILITY_CATEGORIES.includes(f.facility_category)
        ? f.facility_category : (CATEGORY_BY_TYPE[facilityType] || 'other');
      const brgy = isExternal ? null : canonicalBarangay(f.barangay_name);
      const city = isExternal ? String(f.city || '').trim() || null : 'Pasig City';
      if (!name) return res.status(400).json({ error: 'Facility name is required.' });
      if (!isExternal && !brgy) return res.status(400).json({ error: 'Choose the Pasig barangay of the facility, or mark it as outside Pasig.' });
      // An external facility gets NO Pasig barangay — only the city/municipality it is really in.
      if (isExternal && !city) return res.status(400).json({ error: 'Add the city or municipality of the facility (e.g. Taytay, Rizal).' });
      // Same duplicate rule as the directory — case / tag variants count (the DB index
      // compares exact strings, so a pre-check on norm_facility catches them first).
      const dupScope = isExternal
        ? await db.authPool.query('SELECT id, name FROM health_facilities WHERE barangay_name IS NULL')
        : await db.authPool.query('SELECT id, name FROM health_facilities WHERE lower(barangay_name) = lower($1)', [brgy]);
      if (dupScope.rows.some(r => normFacility(r.name) === normFacility(name))) {
        return res.status(409).json({ error: `A facility named "${name}" is already registered. Map to it instead.` });
      }
      try {
        const ins = await db.authPool.query(
          `INSERT INTO health_facilities
             (name, barangay_name, barangay_id, ownership, facility_category, is_external, is_reference, city, is_active, facility_type)
           VALUES ($1, $2, (SELECT id FROM barangays WHERE name = $2), $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, name, facility_type, barangay_name, ownership, facility_category, is_external, is_reference, is_active`,
          [name, brgy, ownership, category, isExternal, Boolean(f.is_reference), city, isActive, facilityType]
        );
        facility = ins.rows[0];
      } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: `A facility named "${name}" is already registered. Map to it instead.` });
        throw err;
      }
      await db.pool.query(
        `INSERT INTO facility_ref (id, name, norm_name, barangay_name, ownership, facility_category, is_external, is_reference, is_active)
         VALUES ($1, $2, norm_facility($2), $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, norm_name = EXCLUDED.norm_name,
           is_active = EXCLUDED.is_active`,
        [facility.id, facility.name, facility.barangay_name, facility.ownership, facility.facility_category,
          facility.is_external, facility.is_reference, facility.is_active]
      );
    }

    // The alias makes the mapping durable. Never steal one another facility owns:
    // ON CONFLICT DO UPDATE here would silently re-point that alias (and every record
    // resolving through it) at this facility — the directory's 409 rule, enforced too.
    let aliasSaved = false;
    try {
      await db.pool.query(
        `INSERT INTO facility_aliases (alias_norm, alias_text, facility_id, created_by_user_id)
         VALUES (norm_facility($1), $1, $2, $3)`,
        [text, facility.id, req.user.id]
      );
      aliasSaved = true;
    } catch (err) {
      if (err.code !== '23505') throw err;
      const existing = (await db.pool.query(
        'SELECT facility_id FROM facility_aliases WHERE alias_norm = norm_facility($1)',
        [text],
      )).rows[0];
      if (!existing || Number(existing.facility_id) !== Number(facility.id)) {
        const owner = existing
          ? (await db.pool.query('SELECT id, name FROM facility_ref WHERE id = $1', [existing.facility_id])).rows[0]
          : null;
        return res.status(409).json({
          error: owner
            ? `"${text}" is already mapped to ${owner.name} — remove that alias from ${owner.name} first.`
            : `"${text}" is already mapped to another facility.`,
        });
      }
      aliasSaved = true; // already points at this facility — idempotent
    }

    const [t, s] = await Promise.all(['treatment', 'screening'].map(f => db.pool.query(
      `UPDATE validated_tb_cases SET ${f}_facility_id = $2
       WHERE norm_facility(${f}_facility) = norm_facility($1) AND ${f}_facility_id IS DISTINCT FROM $2
       RETURNING id, case_no`,
      [text, facility.id]
    )));
    const touched = [...t.rows, ...s.rows];
    const records = t.rowCount + s.rowCount;

    // Review history + TBInsight resync, exactly like the location path: a mapping is a
    // data decision on those records, and already-synced batches must be corrected now.
    await logReviews(db.pool, req.user.id, touched.map(r => ({
      validated_case_id: r.id, case_no: r.case_no, review_type: 'assignment',
      decision: action === 'map' ? 'facility_mapped' : 'facility_registered',
      previous_status: text, new_status: facility.name, notes: null,
    })));
    const sync = await resyncSyncedCases(touched.map(r => r.case_no), req.user, 'Facility mapping');

    await logAuditEvent({
      userId: req.user.id, username: req.user.username,
      action: action === 'map' ? 'MAP_FACILITY' : 'REGISTER_FACILITY',
      resourceType: 'health_facilities', resourceId: String(facility.id), result: 'SUCCESS', ipAddress: ipOf(req),
      details: {
        facility_text: text, facility: facility.name, records, alias_saved: aliasSaved,
        is_active: facility.is_active, sync: sync.status,
      },
    });

    res.json({
      message: action === 'map'
        ? `"${text}" now maps to ${facility.name} — ${records} record field(s) updated. Saved as an alias, so future imports resolve automatically.`
        : `"${text}" now maps to ${facility.name} (newly registered) — ${records} record field(s) updated. Saved as an alias, so future imports resolve automatically.`,
      facility,
      records,
      alias_saved: aliasSaved,
      sync,
    });
  } catch (error) {
    console.error('Facility assignment error:', error);
    res.status(500).json({ error: 'Failed to map facility.' });
  }
});

// Accept every suggested mapping at once (only names the matcher is confident about;
// the rest stay in the queue for a manual decision). The fill below is scoped to THIS
// plan's normalized names — an unscoped fill would rewrite records whose text matches
// some unrelated alias, changing data nobody reviewed.
router.post('/assignment/facility/accept-suggestions', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const [names, options] = await Promise.all([
      db.pool.query(
        `SELECT norm_facility(t) AS alias_norm, MAX(t) AS facility_text FROM (
           SELECT treatment_facility AS t FROM validated_tb_cases v
           WHERE ${LIVE} AND NULLIF(trim(treatment_facility), '') IS NOT NULL AND treatment_facility_id IS NULL
           UNION ALL
           SELECT screening_facility FROM validated_tb_cases v
           WHERE ${LIVE} AND NULLIF(trim(screening_facility), '') IS NOT NULL AND screening_facility_id IS NULL
         ) x GROUP BY 1`
      ),
      db.pool.query('SELECT id, name FROM facility_ref'),
    ]);
    const plan = names.rows
      .map(n => ({ text: n.facility_text, norm: n.alias_norm, suggestion: suggestFacility(n.facility_text, options.rows) }))
      .filter(p => p.suggestion);
    if (plan.length === 0) return res.json({ message: 'No suggestions to accept.', mapped: 0 });

    await db.pool.query(
      `INSERT INTO facility_aliases (alias_norm, alias_text, facility_id, created_by_user_id)
       SELECT x.norm, x.t, x.f, $2 FROM jsonb_to_recordset($1::jsonb) AS x(norm text, t text, f int)
       ON CONFLICT (alias_norm) DO NOTHING`,
      [JSON.stringify(plan.map(p => ({ norm: p.norm, t: p.text, f: p.suggestion.id }))), req.user.id]
    );
    const norms = plan.map(p => p.norm);
    const filled = await Promise.all(['treatment', 'screening'].map(f => db.pool.query(
      `UPDATE validated_tb_cases v SET ${f}_facility_id = a.facility_id
       FROM facility_aliases a
       WHERE a.alias_norm = ANY($1::text[]) AND a.alias_norm = norm_facility(v.${f}_facility)
         AND v.${f}_facility_id IS DISTINCT FROM a.facility_id
       RETURNING v.id, v.case_no, v.${f}_facility AS facility_text`,
      [norms]
    )));
    const touched = filled.flatMap(r => r.rows);
    const fields = filled.reduce((n, r) => n + r.rowCount, 0);

    const byNorm = new Map(plan.map(p => [p.norm, p.suggestion.name]));
    await logReviews(db.pool, req.user.id, touched.map(r => ({
      validated_case_id: r.id, case_no: r.case_no, review_type: 'assignment',
      decision: 'facility_mapped', previous_status: r.facility_text,
      new_status: byNorm.get(normFacility(r.facility_text)) || null, notes: '(accepted suggestions)',
    })));
    const sync = await resyncSyncedCases(touched.map(r => r.case_no), req.user, 'Facility mapping');

    await logAuditEvent({
      userId: req.user.id, username: req.user.username, action: 'MAP_FACILITY_BULK',
      resourceType: 'health_facilities', resourceId: null, result: 'SUCCESS', ipAddress: ipOf(req),
      details: { mapped: plan.length, fields, sync: sync.status, mappings: plan.map(p => `${p.text} -> ${p.suggestion.name}`) },
    });
    res.json({ message: `Accepted ${plan.length} suggested mapping(s); ${fields} record field(s) updated.`, mapped: plan.length, sync });
  } catch (error) {
    console.error('Accept facility suggestions error:', error);
    res.status(500).json({ error: 'Failed to accept suggestions.' });
  }
});

// ==================== DATA ISSUES ====================
router.get('/issues', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const userScope = await resolveUserScope(req.user);
    const { where, params } = issueScope(req, userScope);
    const issueScopeUser = userScope;
    const [count, rows] = await Promise.all([
      db.pool.query(`SELECT COUNT(*)::int AS n FROM validation_issues i WHERE ${where}`, params),
      db.pool.query(
        `SELECT i.id, i.batch_id, i.row_number, i.source_type, i.record, i.errors, i.warnings,
                i.barangay_id, i.barangay_name, i.identity_class,
                i.created_at, i.updated_at, b.filename
         FROM validation_issues i LEFT JOIN import_batches b ON b.id = i.batch_id
         WHERE ${where}
         ORDER BY i.batch_id, i.row_number NULLS LAST LIMIT ${PAGE_SIZE} OFFSET $${params.length + 1}`,
        [...params, (page - 1) * PAGE_SIZE]
      ),
    ]);
    const typeCounts = {};
    const validBarangays = await getValidBarangays();
    const issues = rows.rows.map(r => {
      // Errors under the CURRENT rules (checked on the unmasked record) — stored text
      // from older rules is never shown.
      const errors = currentIssueErrors(r, validBarangays);
      const types = [...new Set(errors.map(issueType))];
      types.forEach(t => { typeCounts[t] = (typeCounts[t] || 0) + 1; });
      return {
        ...r,
        errors,
        // Nothing left to fix under the current rules: saving it adds it as a case.
        no_remaining_errors: errors.length === 0,
        record: maskIssueRecord(req, r.record, r.identity_class),
        issue_types: types,
        error_fields: [...new Set(errors.map(issueField).filter(Boolean))],
        permissions: issuePermissions(req.user, issueScopeUser, { ...r, status: 'open' }),
      };
    });
    res.json({
      issues,
      typeCounts,
      isAdmin: req.user.role === 'admin',
      identityUnlocked: pinService.isUnlocked(req),
      pagination: { page, limit: PAGE_SIZE, total: count.rows[0].n, totalPages: Math.ceil(count.rows[0].n / PAGE_SIZE) },
    });
  } catch (error) {
    console.error('Validation issues error:', error);
    res.status(500).json({ error: 'Failed to load data issues.' });
  }
});

const EDITABLE_FIELDS = [
  'last_name', 'first_name', 'middle_name', 'suffix', 'date_of_birth', 'sex', 'age',
  'date_of_diagnosis', 'date_started_treatment', 'date_of_outcome', 'outcome_status',
  'barangay_name', 'city', 'treatment_facility', 'screening_facility',
  'registration_group', 'bacteriological_status', 'anatomical_site', 'itis_case_id',
];
// The row's location decides which barangay owns it, so changing it is an assignment
// decision: staff fix the clinical values of issues already assigned to their barangay,
// while the location fields belong to an administrator (assignments are made under
// Needs Assignment). A row whose barangay never matched is admin-only anyway.
const STAFF_LOCATION_FIELDS = new Set(['barangay_name', 'city']);

async function loadIssueForUser(req, id, action) {
  const issue = (await db.pool.query('SELECT * FROM validation_issues WHERE id = $1', [id])).rows[0];
  if (!issue) return { error: [404, 'Data issue not found.'] };
  if (issue.status !== 'open') return { error: [409, `This issue was already ${issue.status}.`] };
  if (!can(req.user, await resolveUserScope(req.user), action, issue)) {
    // Say exactly who can resolve it — an unassigned row is an administrator decision;
    // anything else belongs to the staff of the barangay it is assigned to.
    const { reason } = issuePermissions(req.user, null, { ...issue, status: 'open' });
    if (reason === 'admin_required') {
      return { error: [403, 'Barangay could not be matched — records without an assigned barangay can only be resolved by an administrator.'] };
    }
    const owner = issue.barangay_name || 'another barangay';
    return { error: [403, `This record is assigned to ${owner} — only ${owner} staff or an administrator can resolve it.`] };
  }
  return { issue };
}

// Correct a data issue. Still invalid -> the corrections are saved and the remaining
// problems returned. Clean -> it becomes a validated case in its original batch (as a
// possible match if the patient already exists) and the issue is resolved.
router.put('/issues/:id', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { issue, error } = await loadIssueForUser(req, req.params.id, ACTIONS.ISSUE_FIX);
    if (error) return res.status(error[0]).json({ error: error[1] });

    const changes = req.body?.changes || {};
    // Historical rows: stored names/DOB are de-identified and never modified. A blank
    // required value may still be filled in.
    if (!pinService.namesAllowed(issue)) {
      const locked = NAME_FIELDS.filter(f => Object.prototype.hasOwnProperty.call(changes, f)
        && issue.record?.[f] !== null && issue.record?.[f] !== undefined && String(issue.record[f]).trim() !== ''
        && String(changes[f] ?? '') !== String(issue.record[f]));
      if (locked.length) {
        return res.status(403).json({ error: 'This is a de-identified historical record — its stored patient name and date of birth cannot be changed.' });
      }
      for (const f of NAME_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(changes, f) && issue.record?.[f] != null && String(issue.record[f]).trim() !== '') delete changes[f];
      }
    }
    const merged = { ...issue.record };
    const editable = req.user.role === 'admin'
      ? EDITABLE_FIELDS
      : EDITABLE_FIELDS.filter((f) => !STAFF_LOCATION_FIELDS.has(f));
    for (const f of editable) {
      if (Object.prototype.hasOwnProperty.call(changes, f)) {
        const v = changes[f];
        merged[f] = v === '' || v === undefined ? null : v;
      }
    }
    const { record: cleaned, notes } = cleanRecord(merged);
    // Source traceability: keep the file row; the MN source Case ID follows the ITIS no.
    cleaned.source_record_id = issue.record?.source_record_id ?? null;
    cleaned.source_case_id = issue.source_type === 'MN' && cleaned.itis_case_id
      ? String(cleaned.itis_case_id).trim() : null;
    const validation = validateRecord(cleaned, issue.source_type, await getValidBarangays(), identityRuleFor(issue.identity_class));
    const warnings = [...notes, ...validation.warnings];

    if (!validation.valid) {
      await client.query(
        `UPDATE validation_issues SET record = $2, errors = $3, warnings = $4, barangay_name = $5, updated_at = NOW()
         WHERE id = $1`,
        [issue.id, JSON.stringify(cleaned), JSON.stringify(validation.errors), JSON.stringify(warnings), cleaned.barangay_name || null]
      );
      return res.status(422).json({
        error: 'Some problems remain. Your corrections were saved.',
        errors: validation.errors,
        error_fields: [...new Set(validation.errors.map(issueField).filter(Boolean))],
      });
    }

    // Possible returning patient -> pending match (a person decides; never merged):
    // same name + DOB as an existing case (when both are given), or for MN the same
    // ITIS Lite Case No. DSTB rows are never matched on barangay + date + sex + age.
    let cand = null;
    if (cleaned.last_name && cleaned.first_name && cleaned.date_of_birth) {
      cand = (await client.query(
        `SELECT v.case_no, v.date_of_diagnosis::text AS date_of_diagnosis FROM validated_tb_cases v
         WHERE v.case_no IS NOT NULL AND v.is_archived = false
           AND lower(v.last_name) = lower($1) AND lower(v.first_name) = lower($2) AND v.date_of_birth = $3
         ORDER BY v.date_of_diagnosis DESC NULLS LAST LIMIT 1`,
        [cleaned.last_name, cleaned.first_name, cleaned.date_of_birth]
      )).rows[0] || null;
    }
    if (!cand && cleaned.source_case_id) {
      cand = (await client.query(
        `SELECT v.case_no, v.date_of_diagnosis::text AS date_of_diagnosis FROM validated_tb_cases v
         WHERE v.case_no IS NOT NULL AND v.is_archived = false AND v.source_type = 'MN'
           AND lower(regexp_replace(COALESCE(v.source_case_id, v.itis_case_id), '[[:space:]]', '', 'g'))
               = lower(regexp_replace($1, '[[:space:]]', '', 'g'))
         ORDER BY v.date_of_diagnosis DESC NULLS LAST LIMIT 1`,
        [cleaned.source_case_id]
      )).rows[0] || null;
    }

    await client.query('BEGIN');
    const row = {
      ...cleaned,
      source_type: issue.source_type,
      validation_status: cleaned.validation_status || 'Validated',
      is_valid: true,
      errors: [],
      warnings: [...warnings, 'Corrected on the Validation page'],
      record_status: 'new',
    };
    if (cand) {
      Object.assign(row, {
        match_status: 'pending',
        match_candidate_case_no: cand.case_no,
        match_suggestion: ymd(cand.date_of_diagnosis) === ymd(cleaned.date_of_diagnosis) ? 'same_case' : 'new_episode',
      });
    } else {
      const patient = await createPatient(client, issue.batch_id);
      Object.assign(row, { patient_id: patient.id, case_no: await nextCaseNo(client, cleaned.date_of_diagnosis), match_status: 'none' });
    }
    const placeholders = INSERT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ');
    const inserted = (await client.query(
      `INSERT INTO validated_tb_cases (${INSERT_COLUMNS.join(', ')}) VALUES (${placeholders}) RETURNING id, case_no`,
      rowValues(issue.batch_id, row)
    )).rows[0];
    await client.query(
      `UPDATE validation_issues
       SET status = 'resolved', record = $2, errors = '[]', resolved_case_id = $3,
           resolved_by_user_id = $4, resolved_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [issue.id, JSON.stringify(cleaned), inserted.id, req.user.id]
    );
    await client.query(
      `UPDATE import_batches SET valid_count = COALESCE(valid_count, 0) + 1,
         error_count = GREATEST(COALESCE(error_count, 0) - 1, 0) WHERE id = $1`,
      [issue.batch_id]
    );
    await logReviews(client, req.user.id, [{
      validated_case_id: inserted.id, case_no: inserted.case_no, review_type: 'validation',
      decision: 'corrected', previous_status: 'invalid', new_status: cand ? 'possible_match' : 'valid',
      notes: (Array.isArray(issue.errors) ? issue.errors : []).join('; ') || null,
    }]);
    await client.query('COMMIT');

    const sync = cand ? { status: 'pending', count: 0 } : await resyncSyncedCases([inserted.case_no], req.user, 'Data correction');
    await logAuditEvent({
      userId: req.user.id, username: req.user.username, action: 'FIX_DATA_ISSUE',
      resourceType: 'validated_tb_cases', resourceId: String(inserted.id), result: 'SUCCESS', ipAddress: ipOf(req),
      details: { issueId: issue.id, batchId: issue.batch_id, row: issue.row_number, caseNo: inserted.case_no, possibleMatch: Boolean(cand), sync: sync.status },
    });

    res.json({
      message: cand
        ? 'Corrected. The patient already exists, so the record is now under Possible Matches.'
        : `Corrected and validated as ${inserted.case_no}.`,
      caseId: inserted.id,
      caseNo: inserted.case_no,
      possibleMatch: Boolean(cand),
      sync,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Fix data issue error:', error);
    res.status(500).json({ error: 'Failed to save the correction.' });
  } finally {
    client.release();
  }
});

router.post('/issues/:id/exclude', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const note = String(req.body?.note || '').trim();
    if (!note) return res.status(400).json({ error: 'Give a reason for excluding this record.' });
    const { issue, error } = await loadIssueForUser(req, req.params.id, ACTIONS.ISSUE_EXCLUDE);
    if (error) return res.status(error[0]).json({ error: error[1] });

    await db.pool.query(
      `UPDATE validation_issues SET status = 'excluded', resolution_note = $2, resolved_by_user_id = $3,
         resolved_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [issue.id, note, req.user.id]
    );
    await logReviews(db.pool, req.user.id, [{
      validated_case_id: null, case_no: null, review_type: 'validation', decision: 'excluded',
      previous_status: 'invalid', new_status: 'excluded', notes: `Batch ${issue.batch_id}, row ${issue.row_number ?? '?'}: ${note}`,
    }]);
    await logAuditEvent({
      userId: req.user.id, username: req.user.username, action: 'EXCLUDE_DATA_ISSUE',
      resourceType: 'validation_issues', resourceId: String(issue.id), result: 'SUCCESS', ipAddress: ipOf(req),
      details: { batchId: issue.batch_id, row: issue.row_number, note },
    });
    res.json({ message: 'Excluded. The row is kept for the record but will not become a case.' });
  } catch (error) {
    console.error('Exclude data issue error:', error);
    res.status(500).json({ error: 'Failed to exclude the record.' });
  }
});

module.exports = router;
