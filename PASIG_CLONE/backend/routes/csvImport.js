const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');
const { parseRegistryFile } = require('../services/multiSheetParser');
const { calculateFileHash } = require('../utils/fileHash');
const { logAuditEvent } = require('../utils/auditLogger');
const notifications = require('../services/notifications');
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { getCaseListScope, resolveUserScope, responsibleBarangay } = require('../policies/caseAccessPolicy');
const { ACTIONS, can, assertCaseAction, casePermissions, referralPermissions } = require('../policies/permissions');
const { PASIG_BARANGAYS } = require('../services/dataCleaner');
const { CASE_ID_RE, normalizeCaseId } = require('../services/caseIds');
const { startBackgroundSync, SYNC_STARTED } = require('../services/backgroundSync');
const { NEEDS_LOCATION, NEEDS_FACILITY } = require('../services/validationQueue');
const { logReviews, resyncSyncedCases } = require('../services/caseFollowUp');
const pinService = require('../services/pinService');
const { withUserNames } = require('../services/userNames');
const config = require('../config');

// Needs Assignment: no barangay, a barangay outside the official list, or a non-Pasig
// city. Rebuilt on each use from the current list (loaded from the database); names are
// quote-escaped, so the literal is safe.
function unassignedSql() {
  const list = `ARRAY[${PASIG_BARANGAYS.map(n => `'${n.toLowerCase().replace(/'/g, "''")}'`).join(',')}]::text[]`;
  return `(v.barangay_name IS NULL OR lower(v.barangay_name) <> ALL(${list})
  OR (v.city IS NOT NULL AND lower(v.city) NOT IN ('pasig city', 'pasig')))`;
}

// TB Records "All Records" listing rule (alias v, archived rows excluded separately):
// validated cases only — match decided, not merged away, and location resolved. A Pasig
// record with a missing/unknown barangay stays in Validation -> Needs Assignment until
// assigned; a confirmed Non-Pasig record (location_resolution set) is listed. Staff
// visibility (their barangay, Pasig only) comes from getCaseListScope.
const TB_RECORDS_LISTED = `(v.match_status <> 'pending' AND v.merged_into_case_no IS NULL AND NOT ${NEEDS_LOCATION})`;

// Large-file parsing is expensive — cap how often it can be triggered per IP.
const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many import requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// What the upload form needs to know: whether patient-name display is approved
// (PATIENT_NAMES_ENABLED). Until then every import is de-identified.
router.get('/import-options', authenticate, authorizeRoles('admin', 'staff'), (req, res) => {
  res.json({ namesEnabled: pinService.namesEnabled() });
});

// "Historical dataset" (form field historical, default ON): the batch is de-identified
// for good, whatever PATIENT_NAMES_ENABLED says. Only an explicit historical=false on an
// approved system makes it operational (names visible to authorized, unlocked users).
const importIdentityClass = (body) => (String(body?.historical ?? 'true').toLowerCase() === 'false'
  ? pinService.identityClassForNewBatch()
  : 'historical');

async function notifyImport(user, { filename, success, batchId, message }) {
  try {
    const recipients = [user.id];
    if (!success) {
      try { recipients.push(...(await notifications.admins())); }
      catch (err) { console.error('[notifications] admin lookup failed:', err.message); }
    }
    await notifications.notify(recipients, {
      type: success ? 'import_completed' : 'import_failed',
      severity: success ? 'success' : 'danger',
      actorId: user.id, includeActor: true,
      title: `${success ? 'Import completed' : 'Import failed'}: ${filename || 'file'}`,
      message,
      link: success ? '/import?tab=history' : '/import',
      entityType: batchId ? 'import_batch' : undefined,
      entityId: batchId,
    });
  } catch (err) {
    console.error('[notifications] import outcome failed:', err.message);
  }
}

router.post('/import', importLimiter, authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    if (!req.files || !req.files.file) {
      await notifyImport(req.user, { success: false, message: 'No file was uploaded.' });
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.files.file;
    const maxSize = 500 * 1024 * 1024; // 500MB to support large imports

    if (file.size > maxSize) {
      await notifyImport(req.user, { filename: file.name, success: false, message: 'The file exceeds the upload size limit.' });
      return res.status(400).json({ error: 'File too large. Maximum size is 500MB.' });
    }

    // Validate file extension — Excel workbooks (DSTB + MN sheets) or a CSV export of one sheet
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      await notifyImport(req.user, { filename: file.name, success: false, message: 'Only Excel and CSV files can be imported.' });
      return res.status(400).json({ error: 'Unsupported file type. Only .xlsx, .xls and .csv files are accepted.' });
    }

    // ========== STEP 1: DUPLICATE FILE DETECTION ==========
    const fileHash = calculateFileHash(file.data);
    
    // Check if file already imported
    const existingBatchResult = await db.pool.query(
      `SELECT id, filename, uploaded_by, status, created_at, validated_at, synced_at, sync_status
       FROM import_batches
       WHERE file_hash = $1
       LIMIT 1`,
      [fileHash]
    );

    if (existingBatchResult.rows.length > 0) {
      // File already imported - return 409 Conflict with previous batch info
      const existingBatch = existingBatchResult.rows[0];
      const userResult = await db.authPool.query(
        'SELECT username FROM users WHERE id = $1',
        [existingBatch.uploaded_by]
      );

      console.log(`⚠️  Duplicate file detected: ${fileHash}`);
      await logAuditEvent({
        userId: req.user.id,
        action: 'IMPORT_FILE_DUPLICATE',
        resourceType: 'import_batch',
        resourceId: existingBatch.id,
        result: 'DUPLICATE_DETECTED',
        details: { filename: file.name, previousBatch: existingBatch.id },
      });

      await notifyImport(req.user, {
        filename: file.name, success: false,
        message: 'This file was already imported. Check Import History before trying again.',
      });

      return res.status(409).json({
        error: 'File already imported',
        isDuplicate: true,
        previousImport: {
          batchId: existingBatch.id,
          filename: existingBatch.filename,
          importedBy: userResult.rows[0]?.username || 'Unknown',
          importedAt: existingBatch.created_at,
          status: existingBatch.status,
          syncStatus: existingBatch.sync_status,
        },
      });
    }

    // ========== STEP 2: PARSE AND CREATE BATCH ==========
    let parsed;
    try {
      parsed = await parseRegistryFile(file.data, file.name);
    } catch (parseErr) {
      console.error('❌ File parse error:', parseErr.message);
      await notifyImport(req.user, {
        filename: file.name, success: false,
        message: 'The file could not be read. Check its format and try again.',
      });
      return res.status(400).json({
        error: ext === 'xls'
          ? 'Could not read this .xls file. Open it in Excel and save it as .xlsx or .csv, then upload again.'
          : 'Could not read this file. Make sure it is a valid Excel workbook or CSV file.',
      });
    }

    if (parsed.totalRecords === 0) {
      await notifyImport(req.user, {
        filename: file.name, success: false,
        message: 'The file contains no case rows to import.',
      });
      return res.status(400).json({
        error: parsed.sheets.length === 0
          ? 'No header row found. The file needs column headers such as Brgy, Age, Sex and Date of Diagnosis.'
          : 'The file has headers but no case rows.',
      });
    }

    const warnings = [];
    if (parsed.fileType === 'csv') {
      const sheet = parsed.sheets[0];
      warnings.push(`CSV read as ${sheet.source_type} records (header on row ${sheet.header_row}). Upload the other sheet as a separate CSV if needed.`);
    } else {
      if (parsed.dstbCount === 0) warnings.push('DSTB sheet missing or has no rows');
      if (parsed.mnCount === 0) warnings.push('MN sheet missing or has no rows');
    }
    for (const sheet of parsed.sheets) {
      if (sheet.unmapped_headers && sheet.unmapped_headers.length > 0) {
        warnings.push(`${sheet.sheet_name}: columns not imported — ${sheet.unmapped_headers.join(', ')}`);
      }
    }

    const identityClass = importIdentityClass(req.body);
    await client.query('BEGIN');

    // Insert batch with file_hash and audit fields
    const batchResult = await client.query(
      `INSERT INTO import_batches (filename, uploaded_by, file_hash, total_rows, dstb_count, mn_count, status, created_at, identity_class)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8) RETURNING id`,
      [file.name, req.user.id, fileHash, parsed.totalRecords, parsed.dstbCount, parsed.mnCount, 'uploaded', identityClass]
    );

    const batchId = batchResult.rows[0].id;

    const allRecords = [];
    for (const sheet of parsed.sheets) {
      for (const record of sheet.records) {
        allRecords.push({
          sheet_name: sheet.sheet_name,
          source_type: sheet.source_type,
          row_number: record.row_number,
          csv_data: record,
        });
      }
    }
    await db.insertRawCases(client, batchId, allRecords);

    await client.query('COMMIT');

    // Log audit event
    await logAuditEvent({
      userId: req.user.id,
      action: 'IMPORT_FILE',
      resourceType: 'import_batch',
      resourceId: batchId,
      result: 'SUCCESS',
      details: { filename: file.name, recordCount: parsed.totalRecords, fileHash, identityClass },
    });

    console.log(`✅ File imported successfully: Batch ${batchId}, ${parsed.totalRecords} records`);

    await notifyImport(req.user, {
      filename: file.name, success: true, batchId,
      message: `${parsed.totalRecords} record${parsed.totalRecords === 1 ? '' : 's'} uploaded. Review and validate this batch before syncing.`,
    });

    res.status(201).json({
      message: 'File uploaded successfully',
      batch: {
        id: batchId,
        filename: file.name,
        totalRows: parsed.totalRecords,
        dstbCount: parsed.dstbCount,
        mnCount: parsed.mnCount,
        identityClass,
        fileHash: fileHash.substring(0, 16) + '...', // Show truncated hash for verification
      },
      sheets: parsed.sheets.map(s => ({
        name: s.sheet_name,
        sourceType: s.source_type,
        recordCount: s.record_count,
        headerRow: s.header_row,
      })),
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ CSV import error:', error);
    await logAuditEvent({
      userId: req.user.id,
      action: 'IMPORT_FILE',
      result: 'FAILURE',
      details: { filename: req.files?.file?.name || 'unknown', error: error.message },
    });
    await notifyImport(req.user, {
      filename: req.files?.file?.name, success: false,
      message: 'The import could not be completed. Try again or check the server logs.',
    });
    res.status(500).json({ error: 'Failed to process file' });
  } finally {
    client.release();
  }
});

router.get('/batches', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const result = await db.getBatches();
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

// Raw imported rows (full source data, including patient names and birth dates, for
// every barangay in the file) — admin only. Staff use /records, which is barangay-
// scoped and masks names until the Records PIN is entered.
router.get('/batches/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const batchResult = await db.getBatch(id);
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const recordsResult = await db.getRawCases(id);
    const batch = batchResult.rows[0];

    // Raw uploaded rows carry names too: same identity rule as every other response.
    res.json({
      batch,
      records: recordsResult.rows.map(r => ({
        ...r,
        csv_data: r.csv_data
          ? (({ identity_class, ...rest }) => rest)(pinService.protectIdentity(req, { ...r.csv_data, identity_class: batch.identity_class }))
          : r.csv_data,
      })),
    });
  } catch (error) {
    console.error('Error fetching batch:', error);
    res.status(500).json({ error: 'Failed to fetch batch' });
  }
});

// ==================== IMPORT HISTORY (Organization-wide) ====================
router.get('/import-history', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const status = req.query.status || 'active';
    const result = await db.getImportHistory(status);
    const rows = await withUserNames(result.rows, { uploaded_by: 'imported_by_username', archived_by: 'archived_by_username' });

    const batches = rows.map(b => ({
      id: b.id,
      filename: b.filename,
      importedBy: b.imported_by_username || 'Unknown',
      importedByUsername: b.imported_by_username_login || null,
      records: b.total_rows,
      validated: b.valid_count,
      rejected: b.error_count,
      status: b.status,
      syncStatus: b.sync_status,
      importedAt: b.created_at,
      validatedAt: b.validated_at,
      syncedAt: b.synced_at,
      canSync: req.user.role === 'admin' || Number(b.uploaded_by) === Number(req.user.id),
      isArchived: b.is_archived,
      archivedBy: b.archived_by_username || null,
      archivedAt: b.archived_at || null,
      archiveReason: b.archive_reason || null,
    }));

    res.json({ batches });
  } catch (error) {
    console.error('Error fetching import history:', error);
    res.status(500).json({ error: 'Failed to fetch import history' });
  }
});

// ==================== LAST IMPORT (global header) ====================
// Date/time the most recent Excel/CSV file was successfully uploaded. File-upload
// batches are the only import_batches rows written with a file_hash — manual entry
// and correction batches have none, so they never count here.
router.get('/last-import', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const result = await db.pool.query(
      `SELECT created_at FROM import_batches
       WHERE file_hash IS NOT NULL
         AND COALESCE(is_archived, false) = false
         AND status <> 'failed'
       ORDER BY created_at DESC
       LIMIT 1`
    );
    res.json({ lastImport: result.rows[0]?.created_at || null });
  } catch (error) {
    console.error('Error fetching last import:', error);
    res.status(500).json({ error: 'Failed to fetch last import time' });
  }
});

// ==================== STATS (Dashboard KPIs) ====================
router.get('/stats', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    // ========== KPI stats (counts only — no names) ==========
    // Role scoping mirrors the page each KPI leads to: admin = city-wide, staff =
    // their operational scope.
    //   caseWhere       -> TB Records (patient or responsible barangay is theirs, Pasig only)
    //                       the Validated KPI additionally applies the All Records
    //                       listing rule so it matches that tab exactly
    //   Total TB Records is system-wide for every role (see totalSql)
    //   validationWhere -> Validation tabs (their rows OR rows of batches they uploaded)
    //   issueWhere      -> Validation data issues (their barangay OR own uploads)
    // Batch-level items (recent imports, latest sync, batch alerts) stay shared batch
    // metadata for everyone — same design as Import History permissions.
    // Pending Referrals: admin = all pending city-wide; staff = pending INTO their
    // barangay (staff with no assigned barangay await nothing — transfers-list rule).
    const isAdmin = req.user.role === 'admin';
    const userScope = isAdmin ? null : await resolveUserScope(req.user);
    const staffBarangayId = !isAdmin && userScope?.barangay_id != null ? userScope.barangay_id : null;

    const countParams = [];
    let caseWhere = `1=1`;
    let validationWhere = `1=1`;
    // Issues whose batch was deleted are leftovers, not work to do (never counted).
    let issueWhere = `i.status = 'open' AND EXISTS (SELECT 1 FROM import_batches ib WHERE ib.id = i.batch_id)`;
    if (!isAdmin) {
      const s = getCaseListScope(req.user, userScope, 'v', 1);
      countParams.push(...s.params); // $1 = barangay when the staff member has one
      const meIdx = countParams.length + 1;
      countParams.push(req.user.id); // $me = the staff member
      const ownCases = `v.batch_id IN (SELECT id FROM import_batches WHERE uploaded_by = $${meIdx})`;
      const ownIssues = `i.batch_id IN (SELECT id FROM import_batches WHERE uploaded_by = $${meIdx})`;
      caseWhere = `${s.where}`;
      validationWhere = `(${s.where} OR ${ownCases})`;
      issueWhere = `i.status = 'open' AND EXISTS (SELECT 1 FROM import_batches ib WHERE ib.id = i.batch_id)
        AND (${s.params.length ? `i.barangay_id = $1 OR ` : ''}${ownIssues})`;
    }

    // Total = every TB case record stored in PASIG TB-IS, Pasig and Non-Pasig, whatever
    // its validation state, for every role (a count only — no identities):
    //   live cases (not archived, not merged into another case — incl. possible matches
    //   and records awaiting assignment)
    //   + open data issues (rows that failed validation; a corrected one is already a case)
    //   + rows of imports not yet validated (validation turns them into the two above)
    // Rows of archived imports that never became cases are not counted.
    // Validated = exactly the TB Records All Records listing for this user (same rule,
    // same scope), so the KPI always equals that tab's badge.
    //
    // Needs Review counts RECORDS still blocked from being validated, so it never
    // overlaps Validated (admin: Total = Validated + Needs Review):
    //   possible matches (match pending)
    //   + needs assignment = records whose LOCATION is undecided (no Pasig barangay, or a
    //     non-Pasig city not yet confirmed) — these are kept out of TB Records
    //   + open data issues (rows that failed validation)
    // An unmapped facility NAME does not block a record: it is already validated, listed
    // and synced. Facility mapping is a reference-table task (one decision per name maps
    // every record using it), so it is reported separately as facility names to map and
    // never added to Needs Review — adding it counted ~9,300 validated records a second time.
    const totalSql = `(
      (SELECT COUNT(*) FROM validated_tb_cases v WHERE NOT v.is_archived AND v.merged_into_case_no IS NULL)
      + (SELECT COUNT(*) FROM validation_issues i JOIN import_batches b ON b.id = i.batch_id
          WHERE i.status = 'open' AND NOT COALESCE(b.is_archived, false))
      + (SELECT COUNT(*) FROM raw_tb_cases r JOIN import_batches b ON b.id = r.batch_id
          WHERE b.status = 'uploaded' AND NOT COALESCE(b.is_archived, false)))`;

    const counts = (await db.pool.query(
      `SELECT
         ${totalSql}::int AS total,
         (SELECT COUNT(*) FROM validated_tb_cases v WHERE NOT v.is_archived AND ${TB_RECORDS_LISTED} AND ${caseWhere})::int AS validated,
         (SELECT COUNT(*) FROM validated_tb_cases v WHERE v.match_status = 'pending' AND NOT v.is_archived AND ${validationWhere})::int AS possible_matches,
         (SELECT COUNT(*) FROM validated_tb_cases v
            WHERE NOT v.is_archived AND v.match_status <> 'pending' AND v.merged_into_case_no IS NULL
              AND ${NEEDS_LOCATION} AND ${validationWhere})::int AS needs_location,
         (SELECT COUNT(*) FROM validated_tb_cases v
            WHERE NOT v.is_archived AND v.merged_into_case_no IS NULL
              AND ${NEEDS_FACILITY} AND ${validationWhere})::int AS facility_records,
         (SELECT COUNT(DISTINCT norm_facility(f.name)) FROM validated_tb_cases v
            CROSS JOIN LATERAL (VALUES
              (CASE WHEN v.treatment_facility_id IS NULL THEN NULLIF(trim(v.treatment_facility), '') END),
              (CASE WHEN v.screening_facility_id IS NULL THEN NULLIF(trim(v.screening_facility), '') END)) AS f(name)
            WHERE NOT v.is_archived AND v.merged_into_case_no IS NULL AND v.match_status <> 'pending'
              AND f.name IS NOT NULL AND ${validationWhere})::int AS facility_names,
         (SELECT COUNT(*) FROM validation_issues i WHERE ${issueWhere})::int AS data_issues,
         (SELECT COUNT(*) FROM validated_tb_cases v JOIN import_batches b ON b.id = v.batch_id
            WHERE b.sync_status = 'synced' AND v.is_valid AND NOT v.is_archived
              AND v.match_status <> 'pending' AND v.merged_into_case_no IS NULL
              AND (v.record_status IS DISTINCT FROM 'duplicate')
              AND NOT ${unassignedSql()} AND ${caseWhere})::int AS synced`,
      countParams
    )).rows[0];

    let referralsSql = `SELECT COUNT(*)::int AS count FROM case_transfers WHERE status = 'pending'`;
    const referralsParams = [];
    if (!isAdmin) {
      if (staffBarangayId == null) {
        referralsSql = null;
      } else {
        referralsParams.push(staffBarangayId);
        referralsSql += ` AND to_barangay_id = $1`;
      }
    }

    // Recent imports, latest sync attempt and pending-action counts — independent,
    // so run at once. Latest sync = most recent webhook log (sent or failed) with the
    // eligible Pasig record count for that batch (same rule as the Synced KPI).
    const [recentResult, latestSyncResult, pendingResult, pendingReferralsResult] = await Promise.all([
      db.pool.query(
        `SELECT b.id, b.filename, b.uploaded_by, b.total_rows, b.status, b.sync_status, b.created_at
         FROM import_batches b
         ORDER BY b.created_at DESC
         LIMIT 5`
      ).then(async r => ({ rows: (await withUserNames(r.rows, { uploaded_by: 'username' })).map(({ uploaded_by, username_login, ...rest }) => rest) })),
      db.pool.query(
        `SELECT wl.status, wl.response_code, wl.error_message, wl.sent_at, b.filename,
                (SELECT COUNT(*) FROM validated_tb_cases v
                  WHERE v.batch_id = b.id AND v.is_valid AND NOT v.is_archived
                    AND v.match_status <> 'pending' AND v.merged_into_case_no IS NULL
                    AND (v.record_status IS DISTINCT FROM 'duplicate')
                    AND NOT ${unassignedSql()})::int AS records_synced
         FROM webhook_logs wl
         JOIN import_batches b ON b.id = wl.batch_id
         WHERE wl.status IN ('sent', 'failed')
         ORDER BY wl.sent_at DESC
         LIMIT 1`
      ),
      db.pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'uploaded')::int AS requires_validation,
           COUNT(*) FILTER (WHERE status = 'validated' AND sync_status = 'pending')::int AS ready_for_sync,
           COUNT(*) FILTER (WHERE sync_status = 'sync_failed')::int AS failed_sync
         FROM import_batches`
      ),
      referralsSql ? db.pool.query(referralsSql, referralsParams) : Promise.resolve({ rows: [{ count: 0 }] }),
    ]);
    const pending = pendingResult.rows[0];
    const pendingValidationResult = { rows: [{ count: pending.requires_validation }] };
    const readyForSyncResult = { rows: [{ count: pending.ready_for_sync }] };
    const failedSyncResult = { rows: [{ count: pending.failed_sync }] };

    res.json({
      total: counts.total,
      validated: counts.validated,
      needsReview: counts.possible_matches + counts.needs_location + counts.data_issues,
      needsReviewBreakdown: {
        possibleMatches: counts.possible_matches,
        needsAssignment: counts.needs_location,
        dataIssues: counts.data_issues,
      },
      pendingReferrals: pendingReferralsResult.rows[0]?.count || 0,
      synced: counts.synced,
      recentImports: recentResult.rows,
      latestSync: latestSyncResult.rows[0] || null,
      pendingActions: {
        requiresValidation: pendingValidationResult.rows[0]?.count || 0,
        readyForSync: readyForSyncResult.rows[0]?.count || 0,
        failedSync: failedSyncResult.rows[0]?.count || 0,
        possibleMatches: counts.possible_matches,
        needsAssignment: isAdmin ? counts.needs_location : 0,
        // Reference-data task, not part of Needs Review (see above).
        facilityNamesToMap: isAdmin ? counts.facility_names : 0,
        facilityRecordsToMap: isAdmin ? counts.facility_records : 0,
        dataIssues: counts.data_issues,
      },
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ==================== RECENT ACTIVITY (Dashboard card) ====================
// Whitelisted core operational actions only — password/login/user-account,
// delete/archive/undo and other noisy events never even reach the query.
// Sentences are built here so the client only ever receives {id, text,
// createdAt}: no ip_address, no details payloads, no raw action names.
const CORE_ACTIVITY_ACTIONS = [
  'IMPORT_FILE', 'VALIDATE_BATCH', 'ASSIGN_BARANGAY', 'CONFIRM_OUTSIDE_PASIG',
  'RESOLVE_MATCH', 'RESOLVE_MATCHES_BULK', 'FIX_DATA_ISSUE', 'EXCLUDE_DATA_ISSUE',
  'TRANSFER_INITIATED', 'TRANSFER_ACCEPTED', 'TRANSFER_REJECTED',
  'SYNC_BATCH', 'MANUAL_ENTRY',
];

function activityActor(name) {
  if (!name) return 'System';
  return name.toLowerCase() === 'system' ? 'System' : name;
}

function describeActivity(row) {
  const d = (row.details && typeof row.details === 'object') ? row.details : {};
  const who = activityActor(row.actor_name);
  const file = row.filename || null;
  switch (row.action) {
    case 'IMPORT_FILE':
      return row.result === 'SUCCESS' ? `${who} imported ${file || 'a file'}` : null;
    case 'VALIDATE_BATCH':
      return `${who} validated ${file || 'a batch'}`;
    case 'ASSIGN_BARANGAY':
      return `${who} resolved a barangay assignment`;
    case 'CONFIRM_OUTSIDE_PASIG':
      return `${who} confirmed a record as outside Pasig`;
    case 'RESOLVE_MATCH':
      return `${who} resolved a possible match`;
    case 'RESOLVE_MATCHES_BULK':
      return d.requested != null
        ? `${who} resolved ${d.requested} possible matches`
        : `${who} resolved possible matches`;
    case 'FIX_DATA_ISSUE':
      return `${who} corrected a data issue`;
    case 'EXCLUDE_DATA_ISSUE':
      return `${who} excluded a data issue`;
    case 'TRANSFER_INITIATED':
      return d.to_barangay ? `${who} referred a case to ${d.to_barangay}` : `${who} referred a case`;
    case 'TRANSFER_ACCEPTED':
      return d.to_barangay ? `${d.to_barangay} accepted a referral` : `${who} accepted a referral`;
    case 'TRANSFER_REJECTED':
      return d.to_barangay ? `${d.to_barangay} declined a referral` : `${who} declined a referral`;
    case 'SYNC_BATCH':
      return row.result === 'SUCCESS'
        ? 'TBInsight synchronization completed'
        : 'TBInsight synchronization failed';
    case 'MANUAL_ENTRY':
      return `${who} added a manual record`;
    default:
      return null;
  }
}

router.get('/recent-activity', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    // audit_logs + users live on the auth DB; import_batches lives on the main
    // DB — so batch filenames are enriched with a second query, never a join.
    const result = await db.authPool.query(
      `SELECT a.id, a.action, a.result, a.details, a.created_at,
              a.resource_type, a.resource_id,
              COALESCE(NULLIF(au.full_name, ''), a.username) AS actor_name
       FROM audit_logs a
       LEFT JOIN users au ON au.id = a.user_id
       WHERE a.action = ANY($1)
       ORDER BY a.created_at DESC
       LIMIT 12`,
      [CORE_ACTIVITY_ACTIONS]
    );
    const batchIds = [...new Set(result.rows
      .filter(r => r.resource_type === 'import_batch' && r.resource_id)
      .map(r => String(r.resource_id)))];
    const filenames = new Map();
    if (batchIds.length) {
      const batches = await db.pool.query(
        `SELECT id, filename FROM import_batches WHERE id::text = ANY($1)`,
        [batchIds]
      );
      for (const b of batches.rows) filenames.set(String(b.id), b.filename);
    }
    const activity = [];
    for (const raw of result.rows) {
      const file = raw.filename
        || (raw.details && raw.details.filename)
        || (raw.resource_type === 'import_batch' && raw.resource_id
          ? filenames.get(String(raw.resource_id)) || null
          : null);
      const text = describeActivity({ ...raw, filename: file });
      if (!text) continue;
      activity.push({ id: raw.id, text, createdAt: raw.created_at });
      if (activity.length >= 5) break;
    }
    res.json({ activity });
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    res.status(500).json({ error: 'Failed to fetch recent activity' });
  }
});

// ==================== RECORDS (TB Records page) ====================
// Whitelisted sort columns for GET /records — the list is server-paginated, so
// ordering must happen in SQL; anything outside this map falls back to newest-first
// (SQL injection is impossible because neither the key nor the direction is ever
// interpolated directly).
const RECORD_SORT_COLUMNS = {
  id: 'v.id',
  patient_no: 'p.patient_no',
  // Case ID shown to users (file / generated Case ID; internal case_no for older records)
  case: 'COALESCE(v.source_case_id, v.case_no)',
  // Locked-state sorting excludes historical names; unlocked sorting is built below.
  patient: `CASE WHEN v.identity_class = 'operational' THEN v.last_name END, CASE WHEN v.identity_class = 'operational' THEN v.first_name END, p.patient_no`,
  barangay: 'v.barangay_name',
  date: 'v.date_of_diagnosis',
  sex: 'v.sex',
  age: 'v.age',
  status: 'v.case_status',
  outcome: 'v.treatment_outcome',
  facility: 'v.screening_facility',
  bact: 'v.bacteriological_status',
  source: 'v.source_type',
};

router.get('/records', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 50), 200);
    const offset = (page - 1) * limit;
    const view = ['all', 'matches', 'unassigned', 'archived'].includes(req.query.view) ? req.query.view : 'all';
    const isAdmin = req.user.role === 'admin';
    if (view === 'unassigned' && !isAdmin) {
      return res.status(403).json({ error: 'Needs Assignment is available to admins only.' });
    }

    const userScope = await resolveUserScope(req.user);
    const scope = getCaseListScope(req.user, userScope, 'v');
    const params = [...scope.params];
    const base = scope.where;
    const viewSql = {
      // Validated records only: same rule as the Dashboard's Validated KPI (TB_RECORDS_LISTED).
      all: `v.is_archived = false AND ${TB_RECORDS_LISTED}`,
      matches: `v.is_archived = false AND v.match_status = 'pending'`,
      // Same definition as the Validation page's Needs Assignment tab.
      // Same number as Validation -> Needs Assignment and the Dashboard: records whose
      // LOCATION is undecided. Unmapped facility names are counted per name on the
      // Validation page, not per record here.
      unassigned: `v.is_archived = false AND v.match_status <> 'pending' AND v.merged_into_case_no IS NULL AND ${NEEDS_LOCATION}`,
      archived: 'v.is_archived = true',
    };

    let filters = '';
    if (req.query.barangay) {
      // Filter by barangay id. A legacy caller may still send a name — it is resolved
      // to its id here (barangay_ref_id) so the comparison never runs on text. A value
      // that resolves to no registered barangay matches nothing.
      const raw = String(req.query.barangay).trim();
      const asNumber = /^\d+$/.test(raw) ? Number(raw) : null;
      const byId = asNumber != null && Number.isInteger(asNumber)
        && asNumber >= 1 && asNumber <= 2147483647;
      params.push(byId ? asNumber : raw);
      filters += byId
        ? ` AND v.barangay_id = $${params.length}`
        : ` AND v.barangay_id = barangay_ref_id($${params.length})`;
    }
    if (req.query.source_type) {
      params.push(req.query.source_type);
      filters += ` AND v.source_type = $${params.length}`;
    }
    if (['DIAGNOSED', 'ON TREATMENT'].includes(req.query.status)) {
      params.push(req.query.status);
      filters += ` AND v.case_status = $${params.length}`;
    }
    if (['CURED', 'TREATMENT COMPLETED', 'TREATMENT FAILED', 'LOST TO FOLLOW-UP', 'DIED', 'NOT EVALUATED', 'EXCLUDED'].includes(req.query.outcome)) {
      params.push(req.query.outcome);
      filters += ` AND v.treatment_outcome = $${params.length}`;
    }
    const namesUnlocked = pinService.isUnlocked(req);
    const namesEnabled = pinService.namesEnabled();
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      const s = `$${params.length}`;
      // Name search follows the same visibility rules as returned record identities.
      const searchableIdentity = namesUnlocked
        ? (namesEnabled ? `v.identity_class IN ('historical', 'operational')` : `v.identity_class = 'historical'`)
        : null;
      const nameClauses = searchableIdentity
        ? `(${searchableIdentity} AND (v.last_name ILIKE ${s} OR v.first_name ILIKE ${s} OR v.middle_name ILIKE ${s}
           OR (v.last_name || ', ' || v.first_name) ILIKE ${s})) OR `
        : '';
      filters += ` AND (${nameClauses}v.source_case_id ILIKE ${s} OR v.case_no ILIKE ${s}
        OR v.barangay_name ILIKE ${s} OR v.treatment_facility ILIKE ${s})`;
    }

    const from = 'FROM validated_tb_cases v LEFT JOIN patients p ON p.id = v.patient_id';
    const where = `${base} AND ${viewSql[view]}${filters}`;
    const identitySortClass = namesEnabled ? `v.identity_class IN ('historical', 'operational')` : `v.identity_class = 'historical'`;
    const identitySort = namesUnlocked
      ? `CASE WHEN ${identitySortClass} THEN v.last_name END, CASE WHEN ${identitySortClass} THEN v.first_name END, p.patient_no`
      : RECORD_SORT_COLUMNS.patient;
    const sortCols = req.query.sort === 'patient'
      ? identitySort
      : RECORD_SORT_COLUMNS[req.query.sort] || RECORD_SORT_COLUMNS.id;
    const sortDir = String(req.query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const orderBy = sortCols.split(', ').map(c => `${c} ${sortDir}`).join(', ');

    // Tab badges use the same visibility scope, without the search filter. All five queries
    // are independent, so they run at once (each is a ~0.2 s round trip to the database).
    const countView = async (key) =>
      (await db.pool.query(`SELECT COUNT(*)::int AS n ${from} WHERE ${base} AND ${viewSql[key]}`,
        scope.params)).rows[0].n;
    const [countResult, dataResult, allCount, matchCount, unassignedCount, archivedCount] = await Promise.all([
      db.pool.query(`SELECT COUNT(*)::int AS total ${from} WHERE ${where}`, params),
      db.pool.query(
        `SELECT v.*, p.patient_no ${from} WHERE ${where}
         ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      countView('all'),
      countView('matches'),
      isAdmin ? countView('unassigned') : Promise.resolve(null),
      countView('archived'),
    ]);
    const counts = { all: allCount, matches: matchCount, unassigned: unassignedCount, archived: archivedCount };

    // Each row carries the user's permissions on it (policies/permissions.js), including
    // why they can see it (permissions.basis: primary / referred_in / referred_out).
    let records = dataResult.rows.map(r => ({ ...r, permissions: casePermissions(req.user, userScope, r) }));

    // Possible matches: attach the existing case each one resembles
    if (view === 'matches' && records.length > 0) {
      const candNos = [...new Set(records.map(r => r.match_candidate_case_no).filter(Boolean))];
      const cands = candNos.length ? (await db.getCasesByCaseNo(candNos)).rows : [];
      const byNo = new Map(cands.map(c => [c.case_no, c]));
      records = records.map(r => ({ ...r, candidate: byNo.get(r.match_candidate_case_no) || null }));
    }

    res.json({
      records: pinService.maskUnlessUnlocked(req, records),
      identityUnlocked: namesUnlocked,
      namesEnabled: pinService.namesEnabled(),
      counts,
      pagination: {
        page,
        limit,
        total: countResult.rows[0].total,
        totalPages: Math.ceil(countResult.rows[0].total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching records:', error);
    res.status(500).json({ error: 'Failed to fetch records' });
  }
});

// ==================== RECORD DETAIL ====================
router.get('/records/:id', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.pool.query(
      `SELECT v.*, p.patient_no FROM validated_tb_cases v
       LEFT JOIN patients p ON p.id = v.patient_id WHERE v.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found.' });
    }

    const record = result.rows[0];

    const userScope = await resolveUserScope(req.user);
    const permissions = casePermissions(req.user, userScope, record);
    if (!permissions.view) {
      return res.status(403).json({ error: 'Access denied. This case is not assigned to your barangay.' });
    }

    // Referral history (user names come from TBInsight's database). Each referral carries
    // the user's permissions on it (accept / reject / cancel).
    const { addTransferNames } = require('../services/transferNames');
    const transfers = await db.pool.query(
      `SELECT * FROM case_transfers WHERE validated_case_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    const caseBarangay = {
      barangay_name: record.barangay_name, barangay_id: record.barangay_id,
      responsible_barangay: record.responsible_barangay, responsible_barangay_id: record.responsible_barangay_id,
    };
    const referrals = (await addTransferNames(transfers.rows)).map(t => ({
      ...t, permissions: referralPermissions(req.user, userScope, { ...t, ...caseBarangay }),
    }));

    // Case history: case_history events (outcome / responsibility changes) merged with
    // case_review_history decisions, newest first. Actor ids resolve to usernames.
    const historyRows = await db.pool.query(
      `SELECT 'change' AS kind, h.id, h.change_type AS type, h.changed_fields, h.notes, h.source,
              h.changed_by_user_id AS actor_id, h.changed_at AS at,
              NULL::text AS decision, NULL::text AS previous_status, NULL::text AS new_status
         FROM case_history h
        WHERE h.validated_case_id = $1
       UNION ALL
       SELECT 'review' AS kind, r.id, r.review_type, NULL::jsonb, r.notes, NULL::text,
              r.reviewed_by_user_id AS actor_id, r.reviewed_at AS at,
              r.decision, r.previous_status, r.new_status
         FROM case_review_history r
        WHERE r.validated_case_id = $1
        ORDER BY at DESC
        LIMIT 200`,
      [id]
    );
    const actorIds = [...new Set(historyRows.rows.map(h => h.actor_id).filter(v => v != null))];
    let actorNames = {};
    if (actorIds.length > 0) {
      const users = await db.authPool.query('SELECT id, username FROM users WHERE id = ANY($1::int[])', [actorIds]);
      actorNames = Object.fromEntries(users.rows.map(u => [u.id, u.username]));
    }
    const history = historyRows.rows.map(h => ({
      ...h, actor: h.actor_id != null ? (actorNames[h.actor_id] || null) : null,
    }));

    const sourceFile = record.batch_id
      ? ((await db.pool.query('SELECT filename FROM import_batches WHERE id = $1', [record.batch_id])).rows[0] || {}).filename || null
      : null;
    const fullRecord = { ...record, responsible_barangay_effective: responsibleBarangay(record), source_file: sourceFile };
    res.json({
      record: pinService.protectIdentity(req, fullRecord),
      identityUnlocked: pinService.isUnlocked(req),
      // Names/DOB can be corrected only on operational records, while unlocked.
      identityEditable: pinService.isUnlocked(req) && pinService.namesAllowed(record),
      permissions,
      transfers: referrals,
      history,
    });
  } catch (error) {
    console.error('Error fetching record detail:', error);
    res.status(500).json({ error: 'Failed to fetch record detail' });
  }
});

// ==================== EDIT CASE DETAILS ====================
// Only for cases the user may EDIT (policies/permissions.js — view-only cases are refused
// here, not just hidden in the UI). Barangay and diagnosis date are not editable here:
// location goes through Validation -> Needs Assignment, responsibility through referrals,
// and the diagnosis date anchors the Case ID / episode. Patient identity (names, date of
// birth, sex) can be corrected only while the Records PIN is unlocked.
const EDITABLE_CASE_FIELDS = [
  'source_case_id',
  'outcome_status', 'date_of_outcome', 'outcome_reason', 'date_started_treatment', 'date_of_notification', 'date_of_screening',
  'treatment_facility', 'screening_facility', 'registration_group', 'bacteriological_status',
  'anatomical_site', 'source_of_patient',
];
const EDITABLE_IDENTITY_FIELDS = ['last_name', 'first_name', 'middle_name', 'suffix', 'date_of_birth', 'sex'];
const CASE_DATE_FIELDS = new Set(['date_of_outcome', 'date_started_treatment', 'date_of_notification', 'date_of_screening', 'date_of_birth', 'date_of_diagnosis']);

router.put('/records/:id', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { cleanRecord } = require('../services/dataCleaner');
    const { validateRecord, getValidBarangays } = require('../services/validator');
    const { resyncSyncedCases } = require('../services/caseFollowUp');
    const { ymd } = require('../services/validationQueue');

    const record = (await db.pool.query('SELECT * FROM validated_tb_cases WHERE id = $1', [req.params.id])).rows[0];
    if (!record) return res.status(404).json({ error: 'Record not found.' });
    try {
      assertCaseAction(req.user, await resolveUserScope(req.user), ACTIONS.CASE_EDIT, record);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message, code: err.code });
    }
    if (record.is_archived || record.merged_into_case_no) {
      return res.status(409).json({ error: 'Archived or merged records cannot be edited.' });
    }

    const changes = req.body?.changes || {};
    if (record.match_status === 'pending') {
      // A pending row's Case ID is the one thing worth correcting before the decision is
      // made — it is what the file asserted, and it may be wrong.
      const keys = Object.keys(changes);
      if (!(keys.length > 0 && keys.every(k => k === 'source_case_id'))) {
        return res.status(409).json({ error: 'Decide this record\'s possible match (Validation) before editing it. Only its Case ID can be corrected while it is undecided.' });
      }
    }
    const unlocked = pinService.isUnlocked(req);
    const touchesIdentity = EDITABLE_IDENTITY_FIELDS.some(f => Object.prototype.hasOwnProperty.call(changes, f));
    // Historical names/DOB are de-identified and never modified (also guarded in the
    // database, migration 015).
    if (touchesIdentity && !pinService.namesAllowed(record)) {
      return res.status(403).json({ error: 'This is a de-identified historical record — patient name, date of birth and sex cannot be changed.' });
    }
    if (touchesIdentity && !unlocked) {
      return res.status(403).json({ error: 'Unlock patient names with your Records PIN to correct name, date of birth or sex.' });
    }
    const allowed = [...EDITABLE_CASE_FIELDS, ...(unlocked && pinService.namesAllowed(record) ? EDITABLE_IDENTITY_FIELDS : [])];
    const unknown = Object.keys(changes).filter(f => !allowed.includes(f));
    if (unknown.length) return res.status(400).json({ error: `These fields cannot be edited here: ${unknown.join(', ')}.` });

    // The Case ID is the case's identity: keep the file's format and never let two cases
    // carry the same one (unique index, migration 019).
    if (Object.prototype.hasOwnProperty.call(changes, 'source_case_id')) {
      const wanted = normalizeCaseId(changes.source_case_id);
      if (wanted && !CASE_ID_RE.test(wanted)) {
        const msg = `Case ID must look like ROS-D-2025-00042 (got "${String(changes.source_case_id).trim()}")`;
        return res.status(422).json({ error: msg, errors: [msg], error_fields: ['source_case_id'] });
      }
      if (wanted) {
        const clash = (await db.pool.query(
          `SELECT case_no FROM validated_tb_cases
           WHERE upper(source_case_id) = upper($1) AND id <> $2
             AND is_archived = false AND merged_into_case_no IS NULL`,
          [wanted, record.id]
        )).rows[0];
        if (clash) {
          return res.status(409).json({ error: `Case ID ${wanted} already belongs to case ${clash.case_no}. Open that case instead, or give this one a different Case ID.` });
        }
      }
    }

    // Current values as plain strings (dates as YYYY-MM-DD), then apply the changes and
    // normalize them the same way an import would.
    const current = {};
    for (const [k, v] of Object.entries(record)) current[k] = CASE_DATE_FIELDS.has(k) ? ymd(v) : v;
    const merged = { ...current };
    for (const [f, v] of Object.entries(changes)) merged[f] = v === '' || v === undefined ? null : v;
    if (Object.prototype.hasOwnProperty.call(changes, 'source_case_id')) {
      merged.source_case_id = normalizeCaseId(changes.source_case_id);
    }
    const { record: cleaned } = cleanRecord(merged);
    // A treatment start date means treatment has begun: DIAGNOSED becomes ON TREATMENT.
    // Only DIAGNOSED is upgraded — other statuses and treatment outcomes are never set here
    // (outcomes are decided by health workers).
    const startsTreatment = Boolean(cleaned.date_started_treatment)
      && String(cleaned.outcome_status ?? '').trim().toUpperCase() === 'DIAGNOSED';
    if (startsTreatment) cleaned.outcome_status = 'ON TREATMENT';
    // Records saved before Age was required may lack it — editing them must still work.
    // Same for the Case ID on batches uploaded before it was required (migration 018).
    const { identityRuleFor } = require('../services/validator');
    const batch = (await db.pool.query('SELECT case_id_required FROM import_batches WHERE id = $1', [record.batch_id])).rows[0];
    const validation = validateRecord(cleaned, record.source_type, await getValidBarangays(),
      { ...identityRuleFor(record.identity_class), legacyMissingAge: record.age === null || record.age === undefined,
        requireCaseId: batch?.case_id_required !== false });
    if (!validation.valid) {
      return res.status(422).json({ error: 'Please fix these problems.', errors: validation.errors });
    }

    // Only fields whose value actually changed.
    const norm = (f, v) => (v === null || v === undefined || v === '' ? null : CASE_DATE_FIELDS.has(f) ? ymd(v) : String(v));
    const diff = {};
    for (const f of allowed) {
      if (!Object.prototype.hasOwnProperty.call(changes, f) && !(f === 'outcome_status' && startsTreatment)) continue;
      const before = norm(f, current[f]);
      const after = norm(f, cleaned[f]);
      if (before !== after) diff[f] = { old: before, new: after };
    }
    // Age follows the date of birth (computed by the cleaner).
    if (diff.date_of_birth && cleaned.age !== undefined && String(cleaned.age ?? '') !== String(record.age ?? '')) {
      diff.age = { old: record.age ?? null, new: cleaned.age ?? null };
    }
    const fields = Object.keys(diff);
    if (fields.length === 0) return res.json({ message: 'No changes to save.', changed: [] });

    await client.query('BEGIN');
    const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    await client.query(
      `UPDATE validated_tb_cases SET ${sets}, updated_by = $${fields.length + 2}, updated_at = NOW() WHERE id = $1`,
      [record.id, ...fields.map(f => diff[f].new), req.user.id]
    );
    // Names and DOB never leave PASIG — the history keeps only which identity fields changed.
    const historyFields = Object.fromEntries(fields.map(f => [f, EDITABLE_IDENTITY_FIELDS.includes(f) && f !== 'sex'
      ? { changed: true } : diff[f]]));
    await client.query(
      `INSERT INTO case_history (validated_case_id, case_no, patient_id, batch_id, change_type, changed_fields, source, changed_by_user_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, $8)`,
      [record.id, record.case_no, record.patient_id, record.batch_id,
        diff.outcome_status ? 'status_changed' : 'updated', JSON.stringify(historyFields), req.user.id,
        req.body?.note ? String(req.body.note).slice(0, 500) : null]
    );
    await client.query('COMMIT');

    const sync = await resyncSyncedCases([record.case_no], req.user, 'Case update');
    await logAuditEvent({
      userId: req.user.id, username: req.user.username, action: 'UPDATE_CASE',
      resourceType: 'validated_tb_cases', resourceId: String(record.id), result: 'SUCCESS',
      ipAddress: req.ip || null,
      details: { caseNo: record.case_no, fields, sync: sync.status },
    });

    res.json({
      message: `Saved ${fields.length} change${fields.length === 1 ? '' : 's'}${sync.status === 'syncing' ? '. Updating TBInsight in the background' : ''}.`,
      changed: fields,
      sync,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating case:', error);
    res.status(500).json({ error: 'Failed to save the changes.' });
  } finally {
    client.release();
  }
});

// ==================== LIMITED CASE LOOKUP ====================
router.post('/records/lookup', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const caseId = normalizeCaseId(req.body?.case_id);

    if (!caseId) {
      return res.status(400).json({ error: 'Case ID is required for lookup.' });
    }

    // Search by stable identifier only — NOT demographics
    const result = await db.pool.query(
      `SELECT id, barangay_name, responsible_barangay, current_responsible_facility_id,
              screening_facility, treatment_facility, source_type, date_of_diagnosis
       FROM validated_tb_cases
       WHERE upper(source_case_id) = $1 AND is_archived = false
       LIMIT 5`,
      [caseId]
    );

    if (result.rows.length === 0) {
      return res.json({ exists: false });
    }

    const record = result.rows[0];
    const isInScope = can(req.user, await resolveUserScope(req.user), ACTIONS.CASE_VIEW, record);

    if (isInScope) {
      return res.json({
        exists: true,
        case_id: record.id,
        access_status: 'CURRENT_SCOPE',
        record,
      });
    }

    // Outside scope — existence only. No facility/barangay metadata: knowing a case
    // exists elsewhere must not describe it (facility data never informs access).
    return res.json({
      exists: true,
      access_status: 'OUTSIDE_CURRENT_SCOPE',
    });
  } catch (error) {
    console.error('Error in case lookup:', error);
    res.status(500).json({ error: 'Failed to lookup case' });
  }
});

// ==================== RESOLVE A POSSIBLE PATIENT MATCH ====================
router.post('/records/:id/resolve-match', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  const { resolveMatch } = require('../services/matchResolution');
  const client = await db.pool.connect();
  try {
    const row = (await db.pool.query('SELECT * FROM validated_tb_cases WHERE id = $1', [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Record not found.' });
    const scope = await resolveUserScope(req.user);
    assertCaseAction(req.user, scope, ACTIONS.MATCH_RESOLVE, row);

    await client.query('BEGIN');
    // "Same case" writes onto the EXISTING case — the user must be able to edit it too.
    const result = await resolveMatch(client, row, req.body?.resolution, req.user.id, {
      authorizeExistingCase: (existing) => assertCaseAction(req.user, scope, ACTIONS.CASE_EDIT, existing),
    });
    await logReviews(client, req.user.id, [{
      validated_case_id: row.id, case_no: result.caseNo, review_type: 'match', decision: result.resolution,
      previous_status: 'pending', new_status: 'resolved',
      notes: row.match_candidate_case_no ? `Matched to ${row.match_candidate_case_no}` : null,
    }]);
    await client.query('COMMIT');

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'RESOLVE_MATCH',
      resourceType: 'validated_tb_cases',
      resourceId: row.id,
      result: 'SUCCESS',
      details: { resolution: result.resolution, caseNo: result.caseNo, candidate: row.match_candidate_case_no },
    });
    // The batch may already be synced without this record (held back while undecided):
    // send it now that it has a decision.
    const sync = await resyncSyncedCases([result.caseNo], req.user, 'Possible match decided').catch(() => null);
    res.json({ message: 'Match resolved.', ...result, sync });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Error resolving match:', error);
    res.status(500).json({ error: 'Failed to resolve match' });
  } finally {
    client.release();
  }
});

// ==================== RESOLVE SELECTED POSSIBLE MATCHES (bulk) ====================
// body: { ids: [...], resolution: 'suggested' | 'same_case' | 'new_episode' | 'different_person' }
// 'suggested' applies each record's own suggestion. Each record is resolved in its own
// transaction, so one failure (e.g. its matched case was deleted) doesn't undo the rest.
const BULK_RESOLVE_MAX = 500;
router.post('/records/resolve-matches', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  const { resolveMatch, RESOLUTIONS } = require('../services/matchResolution');
  const ids = Array.isArray(req.body?.ids)
    ? [...new Set(req.body.ids.map(Number).filter(Number.isInteger))]
    : [];
  const choice = req.body?.resolution;
  if (ids.length === 0) return res.status(400).json({ error: 'Select at least one match.' });
  if (ids.length > BULK_RESOLVE_MAX) {
    return res.status(400).json({ error: `Select at most ${BULK_RESOLVE_MAX} matches at a time.` });
  }
  if (choice !== 'suggested' && !RESOLUTIONS.includes(choice)) {
    return res.status(400).json({ error: 'Choose: suggested, same case, new episode, or different person.' });
  }

  let facility;
  let rows;
  try {
    facility = await resolveUserScope(req.user);
    rows = (await db.pool.query('SELECT * FROM validated_tb_cases WHERE id = ANY($1::bigint[])', [ids])).rows;
  } catch (error) {
    console.error('Bulk resolve setup failed:', error);
    return res.status(500).json({ error: 'Failed to load the selected matches.' });
  }
  const byId = new Map(rows.map(r => [Number(r.id), r]));
  const result = { resolved: 0, counts: { same_case: 0, new_episode: 0, different_person: 0 }, failed: [] };
  const resolvedCaseNos = [];

  const client = await db.pool.connect();
  try {
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) { result.failed.push({ id, error: 'Record not found.' }); continue; }
      try {
        assertCaseAction(req.user, facility, ACTIONS.MATCH_RESOLVE, row);
      } catch (err) {
        result.failed.push({ id, error: err.message });
        continue;
      }
      const resolution = choice === 'suggested' ? row.match_suggestion : choice;
      try {
        await client.query('BEGIN');
        const r = await resolveMatch(client, row, resolution, req.user.id, {
          authorizeExistingCase: (existing) => assertCaseAction(req.user, facility, ACTIONS.CASE_EDIT, existing),
        });
        await logReviews(client, req.user.id, [{
          validated_case_id: row.id, case_no: r.caseNo, review_type: 'match', decision: r.resolution,
          previous_status: 'pending', new_status: 'resolved',
          notes: row.match_candidate_case_no ? `Matched to ${row.match_candidate_case_no} (bulk)` : '(bulk)',
        }]);
        await client.query('COMMIT');
        result.resolved++;
        resolvedCaseNos.push(r.caseNo);
        result.counts[r.resolution]++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (!err.status) console.error(`Bulk resolve failed for record ${id}:`, err);
        result.failed.push({ id, error: err.status ? err.message : 'Failed to resolve.' });
      }
    }
  } finally {
    client.release();
  }

  const resolvedNos = [...new Set(resolvedCaseNos)].filter(Boolean);
  if (resolvedNos.length) {
    try { result.sync = await resyncSyncedCases(resolvedNos, req.user, 'Possible matches decided'); }
    catch (err) { console.error('Re-sync after bulk match resolve failed:', err.message); }
  }

  await logAuditEvent({
    userId: req.user.id,
    username: req.user.username,
    action: 'RESOLVE_MATCHES_BULK',
    resourceType: 'validated_tb_cases',
    resourceId: null,
    result: result.failed.length === 0 ? 'SUCCESS' : 'PARTIAL',
    details: { requested: ids.length, choice, ...result.counts, failed: result.failed.length },
  });
  res.json(result);
});

// ==================== NEEDS ASSIGNMENT: SET BARANGAY (admin) ====================
router.patch('/records/:id/assign', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const wanted = String(req.body?.barangay_name || '').trim().toLowerCase();
    const barangay = PASIG_BARANGAYS.find(n => n.toLowerCase() === wanted);
    if (!barangay) return res.status(400).json({ error: 'Choose one of the 30 Pasig barangays.' });

    const updated = await db.pool.query(
      `UPDATE validated_tb_cases SET barangay_name = $2, city = 'Pasig City', updated_by = $3, updated_at = NOW()
       WHERE id = $1 AND match_status <> 'pending' AND merged_into_case_no IS NULL
       RETURNING id, case_no, batch_id`,
      [req.params.id, barangay, req.user.id]
    );
    const row = updated.rows[0];
    if (!row) return res.status(404).json({ error: 'Record not found.' });

    // If its batch was already synced, send just this case now (as its own small
    // batch); otherwise it goes out with its batch as usual.
    let sync = { status: 'pending' };
    const batch = (await db.getBatch(row.batch_id)).rows[0];
    if (batch?.sync_status === 'synced' && row.case_no) {
      const corr = await db.pool.query(
        `INSERT INTO import_batches (filename, uploaded_by, total_rows, valid_count, error_count, status, validated_by, validated_at)
         VALUES ($1, $2, 0, 0, 0, 'validated', $2, NOW()) RETURNING id`,
        [`Correction — ${req.user.username}`, req.user.id]
      );
      startBackgroundSync(corr.rows[0].id, req.user, { extraCaseNos: [row.case_no] });
      sync = SYNC_STARTED;
    }

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'ASSIGN_BARANGAY',
      resourceType: 'validated_tb_cases',
      resourceId: row.id,
      result: 'SUCCESS',
      details: { barangay, caseNo: row.case_no, sync: sync.status },
    });
    res.json({ message: `Assigned to ${barangay}.`, sync });
  } catch (error) {
    console.error('Error assigning barangay:', error);
    res.status(500).json({ error: 'Failed to assign barangay' });
  }
});

// ==================== ARCHIVE RECORD ====================
router.patch('/records/:id/archive', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { id } = req.params;
    const found = await db.pool.query(
      `SELECT id, barangay_name, barangay_id, responsible_barangay, responsible_barangay_id,
              is_archived, merged_into_case_no
       FROM validated_tb_cases WHERE id = $1`,
      [id]
    );
    if (found.rows.length === 0) return res.status(404).json({ error: 'Record not found' });
    try {
      assertCaseAction(req.user, await resolveUserScope(req.user), ACTIONS.CASE_ARCHIVE, found.rows[0]);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message, code: err.code });
    }
    const result = await db.archiveRecord(id);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'ARCHIVE_RECORD',
      resourceType: 'validated_tb_cases',
      resourceId: id,
      result: 'SUCCESS',
      details: { recordId: id },
    });

    res.json({ message: 'Record archived successfully', record: result.rows[0] });
  } catch (error) {
    console.error('Error archiving record:', error);
    res.status(500).json({ error: 'Failed to archive record' });
  }
});

// ==================== RESTORE ARCHIVED RECORD (admin only) ====================
router.patch('/records/:id/restore', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const found = await db.pool.query(
      'SELECT id, is_archived FROM validated_tb_cases WHERE id = $1',
      [id]
    );
    if (found.rows.length === 0) return res.status(404).json({ error: 'Record not found' });
    if (!found.rows[0].is_archived) {
      return res.status(409).json({ error: 'This record is not archived.' });
    }

    const result = await db.restoreRecord(id);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Record not found' });

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'RESTORE_RECORD',
      resourceType: 'validated_tb_cases',
      resourceId: id,
      result: 'SUCCESS',
      details: { recordId: id },
    });

    res.json({ message: 'Record restored successfully', record: result.rows[0] });
  } catch (error) {
    console.error('Error restoring record:', error);
    res.status(500).json({ error: 'Failed to restore record' });
  }
});

// ==================== ARCHIVE BATCH ====================
// ==================== ARCHIVE BATCH (admin only) ====================
// Archiving takes an import out of the active history — an administrative action on
// someone else's upload, so staff cannot do it (unarchive and delete are admin-only too).
router.patch('/batches/:id/archive', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const result = await db.archiveBatch(id, req.user.id, reason || null);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'ARCHIVE_BATCH',
      resourceType: 'import_batch',
      resourceId: id,
      result: 'SUCCESS',
      details: { batchId: id, reason: reason || null },
    });

    res.json({ message: 'Batch archived successfully', batch: result.rows[0] });
  } catch (error) {
    console.error('Error archiving batch:', error);
    res.status(500).json({ error: 'Failed to archive batch' });
  }
});

// ==================== UNARCHIVE BATCH ====================
router.patch('/batches/:id/unarchive', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.unarchiveBatch(id);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'UNARCHIVE_BATCH',
      resourceType: 'import_batch',
      resourceId: id,
      result: 'SUCCESS',
      details: { batchId: id },
    });

    res.json({ message: 'Batch unarchived successfully', batch: result.rows[0] });
  } catch (error) {
    console.error('Error unarchiving batch:', error);
    res.status(500).json({ error: 'Failed to unarchive batch' });
  }
});

// ==================== DELETE BATCH (hard delete, admin only) ====================
/**
 * Permanently removes a batch: first asks TBInsight to undo the same batch (if it was
 * ever synced), then deletes the batch's rows here. Lets admins import/delete/re-import
 * freely while testing, without the batch lingering in either system.
 *
 * If TBInsight can't be reached or refuses the delete, nothing is removed on either side
 * so the two systems never drift out of sync — retry once TBInsight is reachable.
 */
router.delete('/batches/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await db.getBatch(id);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    let tbInsight = { attempted: false };
    if (config.webhook.url) {
      try {
        // The PASIG frontend authenticates with an httpOnly cookie, not a header, so pass
        // the same token on explicitly. Both systems share JWT_SECRET; a Bearer header is
        // also exempt from TBInsight's cookie-CSRF check.
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7)
          : req.cookies && req.cookies.token;
        const origin = new URL(config.webhook.url).origin;
        const tbRes = await fetch(`${origin}/api/tb/integration/batches/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });

        if (tbRes.status === 404) {
          tbInsight = { attempted: true, foundInTbInsight: false };
        } else if (tbRes.ok) {
          tbInsight = { attempted: true, foundInTbInsight: true, ...(await tbRes.json()) };
        } else {
          const details = await tbRes.text();
          return res.status(502).json({
            error: 'Could not remove this batch from TBInsight. Nothing was deleted.',
            tbInsightStatus: tbRes.status,
            details: details.slice(0, 500),
          });
        }
      } catch (err) {
        console.error('TBInsight delete call failed:', err);
        return res.status(502).json({
          error: `Could not reach TBInsight to remove this batch. Nothing was deleted. (${err.code || err.name}: ${err.message})`,
        });
      }
    }

    const result = await db.deleteBatch(id);
    if (!result) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'DELETE_BATCH',
      resourceType: 'import_batch',
      resourceId: id,
      result: 'SUCCESS',
      details: { batchId: id, filename: result.batch.filename, deletedLocally: result.deleted, tbInsight },
    });

    res.json({
      message: 'Batch permanently deleted.',
      batchId: id,
      deletedLocally: result.deleted,
      tbInsight,
    });
  } catch (error) {
    console.error('Error deleting batch:', error);
    res.status(500).json({ error: 'Failed to delete batch' });
  }
});

// ==================== BATCH DETAILS ====================
router.get('/batches/:id/details', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { id } = req.params;

    const batchResult = await db.getBatchWithUsers(id);
    batchResult.rows = await withUserNames(batchResult.rows, {
      uploaded_by: 'imported_by_username', validated_by: 'validated_by_username',
      synced_by: 'synced_by_username', archived_by: 'archived_by_username',
    });
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const syncResult = await db.pool.query(
      `SELECT ${db.WEBHOOK_LOG_COLUMNS}
       FROM webhook_logs wl
       WHERE wl.batch_id = $1
       ORDER BY wl.sent_at DESC`,
      [id]
    );
    syncResult.rows = await withUserNames(syncResult.rows, { initiated_by: 'username' });

    res.json({
      batch: batchResult.rows[0],
      syncLogs: syncResult.rows,
    });
  } catch (error) {
    console.error('Error fetching batch details:', error);
    res.status(500).json({ error: 'Failed to fetch batch details' });
  }
});

module.exports = router;
