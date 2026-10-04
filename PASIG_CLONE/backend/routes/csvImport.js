const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');
const { parseRegistryFile } = require('../services/multiSheetParser');
const { calculateFileHash } = require('../utils/fileHash');
const { logAuditEvent } = require('../utils/auditLogger');
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { getCaseListScope, resolveUserFacility, canViewCase } = require('../policies/caseAccessPolicy');
const { PASIG_BARANGAYS } = require('../services/dataCleaner');
const { sendWebhook } = require('../services/webhookSender');
const pinService = require('../services/pinService');
const config = require('../config');

// Needs Assignment: no barangay, a barangay outside the official list, or a non-Pasig
// city. Rebuilt on each use from the current list (loaded from the database); names are
// quote-escaped, so the literal is safe.
function unassignedSql() {
  const list = `ARRAY[${PASIG_BARANGAYS.map(n => `'${n.toLowerCase().replace(/'/g, "''")}'`).join(',')}]::text[]`;
  return `(v.barangay_name IS NULL OR lower(v.barangay_name) <> ALL(${list})
  OR (v.city IS NOT NULL AND lower(v.city) NOT IN ('pasig city', 'pasig')))`;
}

// Large-file parsing is expensive — cap how often it can be triggered per IP.
const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many import requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/import', importLimiter, authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.files.file;
    const maxSize = 500 * 1024 * 1024; // 500MB to support large imports

    if (file.size > maxSize) {
      return res.status(400).json({ error: 'File too large. Maximum size is 500MB.' });
    }

    // Validate file extension — Excel workbooks (DSTB + MN sheets) or a CSV export of one sheet
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
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
      return res.status(400).json({
        error: ext === 'xls'
          ? 'Could not read this .xls file. Open it in Excel and save it as .xlsx or .csv, then upload again.'
          : 'Could not read this file. Make sure it is a valid Excel workbook or CSV file.',
      });
    }

    if (parsed.totalRecords === 0) {
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

    await client.query('BEGIN');

    // Insert batch with file_hash and audit fields
    const batchResult = await client.query(
      `INSERT INTO import_batches (filename, uploaded_by, file_hash, total_rows, dstb_count, mn_count, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id`,
      [file.name, req.user.id, fileHash, parsed.totalRecords, parsed.dstbCount, parsed.mnCount, 'uploaded']
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
      details: { filename: file.name, recordCount: parsed.totalRecords, fileHash },
    });

    console.log(`✅ File imported successfully: Batch ${batchId}, ${parsed.totalRecords} records`);

    res.status(201).json({
      message: 'File uploaded successfully',
      batch: {
        id: batchId,
        filename: file.name,
        totalRows: parsed.totalRecords,
        dstbCount: parsed.dstbCount,
        mnCount: parsed.mnCount,
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

router.get('/batches/:id', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { id } = req.params;

    const batchResult = await db.getBatch(id);
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const recordsResult = await db.getRawCases(id);

    res.json({
      batch: batchResult.rows[0],
      records: recordsResult.rows,
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

    const batches = result.rows.map(b => ({
      id: b.id,
      filename: b.filename,
      importedBy: b.imported_by_username || 'Unknown',
      records: b.total_rows,
      validated: b.valid_count,
      rejected: b.error_count,
      status: b.status,
      syncStatus: b.sync_status,
      importedAt: b.created_at,
      validatedAt: b.validated_at,
      syncedAt: b.synced_at,
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

// ==================== STATS (Dashboard KPIs) ====================
router.get('/stats', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    // ========== Organization-wide stats (counts only — no names) ==========
    // Total    = every row imported (including rows that failed validation)
    // Validated = rows that passed validation
    // Pending  = rows in batches not yet validated + possible matches awaiting review
    // Synced   = records actually sent to TBInsight: own cases (not merged into another
    //            case, not awaiting a match decision) with a Pasig barangay, in synced batches
    const counts = (await db.pool.query(
      `SELECT
         (SELECT COUNT(*) FROM raw_tb_cases)::int AS total,
         (SELECT COUNT(*) FROM validated_tb_cases v WHERE v.is_valid AND NOT v.is_archived)::int AS validated,
         (SELECT COUNT(*) FROM raw_tb_cases r JOIN import_batches b ON b.id = r.batch_id WHERE b.status = 'uploaded')::int AS unvalidated_rows,
         (SELECT COUNT(*) FROM validated_tb_cases v WHERE v.match_status = 'pending' AND NOT v.is_archived)::int AS possible_matches,
         (SELECT COUNT(*) FROM validated_tb_cases v
            WHERE NOT v.is_archived AND v.match_status <> 'pending' AND v.merged_into_case_no IS NULL
              AND ${unassignedSql()})::int AS needs_assignment,
         (SELECT COUNT(*) FROM validated_tb_cases v JOIN import_batches b ON b.id = v.batch_id
            WHERE b.sync_status = 'synced' AND NOT v.is_archived AND v.match_status <> 'pending'
              AND v.merged_into_case_no IS NULL AND NOT ${unassignedSql()})::int AS synced`
    )).rows[0];

    // Recent imports for dashboard
    // Recent imports, latest sync and pending-action counts — independent, so run at once
    const [recentResult, latestSyncResult, pendingResult] = await Promise.all([
      db.pool.query(
        `SELECT b.id, b.filename, u.username, b.total_rows, b.status, b.sync_status, b.created_at
         FROM import_batches b
         LEFT JOIN users u ON b.uploaded_by = u.id
         ORDER BY b.created_at DESC
         LIMIT 5`
      ),
      db.pool.query(
        `SELECT b.id, b.filename, u.username, b.total_rows, b.sync_status, b.synced_at
         FROM import_batches b
         LEFT JOIN users u ON b.synced_by = u.id
         WHERE b.sync_status = 'synced'
         ORDER BY b.synced_at DESC
         LIMIT 1`
      ),
      db.pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'uploaded')::int AS requires_validation,
           COUNT(*) FILTER (WHERE status = 'validated' AND sync_status = 'pending')::int AS ready_for_sync,
           COUNT(*) FILTER (WHERE sync_status = 'sync_failed')::int AS failed_sync
         FROM import_batches`
      ),
    ]);
    const pending = pendingResult.rows[0];
    const pendingValidationResult = { rows: [{ count: pending.requires_validation }] };
    const readyForSyncResult = { rows: [{ count: pending.ready_for_sync }] };
    const failedSyncResult = { rows: [{ count: pending.failed_sync }] };

    res.json({
      total: counts.total,
      validated: counts.validated,
      pending: counts.unvalidated_rows + counts.possible_matches,
      synced: counts.synced,
      recentImports: recentResult.rows,
      latestSync: latestSyncResult.rows[0] || null,
      pendingActions: {
        requiresValidation: pendingValidationResult.rows[0]?.count || 0,
        readyForSync: readyForSyncResult.rows[0]?.count || 0,
        failedSync: failedSyncResult.rows[0]?.count || 0,
        possibleMatches: counts.possible_matches,
        needsAssignment: req.user.role === 'admin' ? counts.needs_assignment : 0,
      },
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ==================== RECORDS (TB Records page) ====================
router.get('/records', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 50), 200);
    const offset = (page - 1) * limit;
    const view = ['all', 'matches', 'unassigned'].includes(req.query.view) ? req.query.view : 'all';
    const isAdmin = req.user.role === 'admin';
    if (view === 'unassigned' && !isAdmin) {
      return res.status(403).json({ error: 'Needs Assignment is available to admins only.' });
    }

    const facility = await resolveUserFacility(req.user);
    const scope = getCaseListScope(req.user, facility, 'v');
    const params = [...scope.params];
    const base = `v.is_archived = false AND ${scope.where}`;
    const viewSql = {
      all: `v.match_status <> 'pending' AND v.merged_into_case_no IS NULL`,
      matches: `v.match_status = 'pending'`,
      unassigned: `v.match_status <> 'pending' AND v.merged_into_case_no IS NULL AND ${unassignedSql()}`,
    };

    let filters = '';
    if (req.query.barangay) {
      params.push(req.query.barangay);
      filters += ` AND v.barangay_name = $${params.length}`;
    }
    if (req.query.source_type) {
      params.push(req.query.source_type);
      filters += ` AND v.source_type = $${params.length}`;
    }
    const namesUnlocked = pinService.isUnlocked(req);
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      const s = `$${params.length}`;
      // Searching by name is only allowed once names are unlocked with the records PIN —
      // otherwise a locked user could still find out whether a person is in the system.
      const nameClauses = namesUnlocked
        ? `v.last_name ILIKE ${s} OR v.first_name ILIKE ${s} OR v.middle_name ILIKE ${s}
           OR (v.last_name || ', ' || v.first_name) ILIKE ${s} OR `
        : '';
      filters += ` AND (${nameClauses}v.case_no ILIKE ${s} OR p.patient_no ILIKE ${s}
        OR v.barangay_name ILIKE ${s} OR v.treatment_facility ILIKE ${s} OR v.itis_case_id ILIKE ${s})`;
    }

    const from = 'FROM validated_tb_cases v LEFT JOIN patients p ON p.id = v.patient_id';
    const where = `${base} AND ${viewSql[view]}${filters}`;

    // Tab badges use the same visibility scope, without the search filter. All five queries
    // are independent, so they run at once (each is a ~0.2 s round trip to the database).
    const countView = async (key) =>
      (await db.pool.query(`SELECT COUNT(*)::int AS n ${from} WHERE ${base} AND ${viewSql[key]}`,
        scope.params)).rows[0].n;
    const [countResult, dataResult, allCount, matchCount, unassignedCount] = await Promise.all([
      db.pool.query(`SELECT COUNT(*)::int AS total ${from} WHERE ${where}`, params),
      db.pool.query(
        `SELECT v.*, p.patient_no ${from} WHERE ${where}
         ORDER BY v.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      countView('all'),
      countView('matches'),
      isAdmin ? countView('unassigned') : Promise.resolve(null),
    ]);
    const counts = { all: allCount, matches: matchCount, unassigned: unassignedCount };

    // Possible matches: attach the existing case each one resembles
    let records = dataResult.rows;
    if (view === 'matches' && records.length > 0) {
      const candNos = [...new Set(records.map(r => r.match_candidate_case_no).filter(Boolean))];
      const cands = candNos.length ? (await db.getCasesByCaseNo(candNos)).rows : [];
      const byNo = new Map(cands.map(c => [c.case_no, c]));
      records = records.map(r => ({ ...r, candidate: byNo.get(r.match_candidate_case_no) || null }));
    }

    res.json({
      records: pinService.maskUnlessUnlocked(req, records),
      identityUnlocked: namesUnlocked,
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
    const { isReadOnlyForUser } = require('../policies/caseAccessPolicy');

    const result = await db.pool.query(
      `SELECT v.*, p.patient_no FROM validated_tb_cases v
       LEFT JOIN patients p ON p.id = v.patient_id WHERE v.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found.' });
    }

    const record = result.rows[0];

    const facility = await resolveUserFacility(req.user);
    if (!canViewCase(req.user, facility, record)) {
      return res.status(403).json({ error: 'Access denied. This record is outside your barangay and facility.' });
    }

    const readOnly = isReadOnlyForUser(req.user, record);

    // Transfer/referral history (facility and user names come from TBInsight's database)
    const { addTransferNames } = require('../services/transferNames');
    const transfers = await db.pool.query(
      `SELECT * FROM case_transfers WHERE validated_case_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    const responsible = record.current_responsible_facility_id
      ? (await db.authPool.query('SELECT name FROM health_facilities WHERE id = $1', [record.current_responsible_facility_id])).rows[0]
      : null;

    const fullRecord = { ...record, current_responsible_facility_name: responsible?.name || null };
    res.json({
      record: pinService.isUnlocked(req) ? fullRecord : pinService.maskIdentity(fullRecord),
      identityUnlocked: pinService.isUnlocked(req),
      isReadOnly: readOnly,
      transfers: await addTransferNames(transfers.rows),
    });
  } catch (error) {
    console.error('Error fetching record detail:', error);
    res.status(500).json({ error: 'Failed to fetch record detail' });
  }
});

// ==================== LIMITED CASE LOOKUP ====================
router.post('/records/lookup', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { itis_case_id } = req.body;

    if (!itis_case_id) {
      return res.status(400).json({ error: 'ITIS Case ID is required for lookup.' });
    }

    // Search by stable identifier only — NOT demographics
    const result = await db.pool.query(
      `SELECT id, barangay_name, current_responsible_facility_id,
              screening_facility, treatment_facility, source_type, date_of_diagnosis
       FROM validated_tb_cases
       WHERE itis_case_id = $1 AND is_archived = false
       LIMIT 5`,
      [itis_case_id]
    );

    if (result.rows.length === 0) {
      return res.json({ exists: false });
    }

    const record = result.rows[0];
    const isInScope = canViewCase(req.user, await resolveUserFacility(req.user), record);

    if (isInScope) {
      return res.json({
        exists: true,
        case_id: record.id,
        access_status: 'CURRENT_SCOPE',
        record,
      });
    }

    // Outside scope — return minimal info only
    return res.json({
      exists: true,
      case_id: record.id,
      access_status: 'OUTSIDE_CURRENT_SCOPE',
      current_facility_id: record.current_responsible_facility_id,
      barangay: record.barangay_name,
      source_type: record.source_type,
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
    if (!canViewCase(req.user, await resolveUserFacility(req.user), row)) {
      return res.status(403).json({ error: 'Access denied. This record is outside your barangay and facility.' });
    }

    await client.query('BEGIN');
    const result = await resolveMatch(client, row, req.body?.resolution, req.user.id);
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
    res.json({ message: 'Match resolved.', ...result });
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
    facility = await resolveUserFacility(req.user);
    rows = (await db.pool.query('SELECT * FROM validated_tb_cases WHERE id = ANY($1::bigint[])', [ids])).rows;
  } catch (error) {
    console.error('Bulk resolve setup failed:', error);
    return res.status(500).json({ error: 'Failed to load the selected matches.' });
  }
  const byId = new Map(rows.map(r => [Number(r.id), r]));
  const result = { resolved: 0, counts: { same_case: 0, new_episode: 0, different_person: 0 }, failed: [] };

  const client = await db.pool.connect();
  try {
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) { result.failed.push({ id, error: 'Record not found.' }); continue; }
      if (!canViewCase(req.user, facility, row)) {
        result.failed.push({ id, error: 'Outside your barangay and facility.' });
        continue;
      }
      const resolution = choice === 'suggested' ? row.match_suggestion : choice;
      try {
        await client.query('BEGIN');
        const r = await resolveMatch(client, row, resolution, req.user.id);
        await client.query('COMMIT');
        result.resolved++;
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
      try {
        const result = await sendWebhook(corr.rows[0].id, req.user.id, { extraCaseNos: [row.case_no] });
        sync = { status: result.success ? 'synced' : 'failed', message: result.message };
      } catch (err) {
        sync = { status: 'failed', message: err.message };
      }
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

// ==================== ARCHIVE BATCH ====================
router.patch('/batches/:id/archive', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
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
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const syncResult = await db.pool.query(
      `SELECT ${db.WEBHOOK_LOG_COLUMNS}, u.username
       FROM webhook_logs wl
       LEFT JOIN users u ON wl.initiated_by = u.id
       WHERE wl.batch_id = $1
       ORDER BY wl.sent_at DESC`,
      [id]
    );

    res.json({
      batch: batchResult.rows[0],
      syncLogs: syncResult.rows,
    });
  } catch (error) {
    console.error('Error fetching batch details:', error);
    res.status(500).json({ error: 'Failed to fetch batch details' });
  }
});

// ==================== POPULATION ====================
router.get('/population', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const result = await db.getPopulation();
    res.json({ population: result.rows });
  } catch (error) {
    console.error('Error fetching population:', error);
    res.status(500).json({ error: 'Failed to fetch population data' });
  }
});

router.post('/population', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { barangay_name, population, reference_year, source } = req.body;
    if (!barangay_name || !population || !reference_year) {
      return res.status(400).json({ error: 'barangay_name, population, and reference_year are required.' });
    }

    const result = await db.addPopulation(barangay_name, population, reference_year, source || null);

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'ADD_POPULATION',
      resourceType: 'barangay_population',
      resourceId: String(result.rows[0].id),
      result: 'SUCCESS',
      details: { barangay_name, population, reference_year, source },
    });

    res.status(201).json({ message: 'Population data added', record: result.rows[0] });
  } catch (error) {
    console.error('Error adding population:', error);
    res.status(500).json({ error: 'Failed to add population data' });
  }
});

router.put('/population/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { population, source } = req.body;

    if (!population) {
      return res.status(400).json({ error: 'population is required.' });
    }

    const result = await db.updatePopulation(id, population, source || null);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Population record not found' });
    }

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'UPDATE_POPULATION',
      resourceType: 'barangay_population',
      resourceId: id,
      result: 'SUCCESS',
      details: { population, source },
    });

    res.json({ message: 'Population data updated', record: result.rows[0] });
  } catch (error) {
    console.error('Error updating population:', error);
    res.status(500).json({ error: 'Failed to update population data' });
  }
});

module.exports = router;
