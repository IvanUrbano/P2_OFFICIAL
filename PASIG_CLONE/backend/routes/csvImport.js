const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { parseRegistryFile } = require('../services/multiSheetParser');
const { calculateFileHash } = require('../utils/fileHash');
const { logAuditEvent } = require('../utils/auditLogger');
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { getCaseListScope } = require('../policies/caseAccessPolicy');

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
    // ========== Organization-wide stats (not per-user) ==========
    const totalResult = await db.pool.query('SELECT COUNT(*)::int AS count FROM validated_tb_cases');
    const validResult = await db.pool.query('SELECT COUNT(*)::int AS count FROM validated_tb_cases WHERE is_valid = true');
    const invalidResult = await db.pool.query('SELECT COUNT(*)::int AS count FROM validated_tb_cases WHERE is_valid = false');
    const pendingResult = await db.pool.query("SELECT COUNT(*)::int AS count FROM import_batches WHERE status NOT IN ('validated', 'sent')");

    // Synced count from batches with successful sync
    let syncedCount = 0;
    const syncedResult = await db.pool.query("SELECT COUNT(DISTINCT batch_id)::int AS count FROM import_batches WHERE sync_status = 'synced'");
    syncedCount = syncedResult.rows[0]?.count || 0;

    // Recent imports for dashboard
    const recentResult = await db.pool.query(
      `SELECT b.id, b.filename, u.username, b.total_rows, b.status, b.sync_status, b.created_at
       FROM import_batches b
       LEFT JOIN users u ON b.uploaded_by = u.id
       ORDER BY b.created_at DESC
       LIMIT 5`
    );

    // Latest sync info
    const latestSyncResult = await db.pool.query(
      `SELECT b.id, b.filename, u.username, b.total_rows, b.sync_status, b.synced_at
       FROM import_batches b
       LEFT JOIN users u ON b.synced_by = u.id
       WHERE b.sync_status = 'synced'
       ORDER BY b.synced_at DESC
       LIMIT 1`
    );

    // Pending actions
    const pendingValidationResult = await db.pool.query(
      "SELECT COUNT(*)::int AS count FROM import_batches WHERE status = 'uploaded'"
    );
    const readyForSyncResult = await db.pool.query(
      "SELECT COUNT(*)::int AS count FROM import_batches WHERE status = 'validated' AND sync_status = 'pending'"
    );
    const failedSyncResult = await db.pool.query(
      "SELECT COUNT(*)::int AS count FROM import_batches WHERE sync_status = 'sync_failed'"
    );

    res.json({
      total: totalResult.rows[0]?.count || 0,
      validated: validResult.rows[0]?.count || 0,
      invalid: invalidResult.rows[0]?.count || 0,
      pending: pendingResult.rows[0]?.count || 0,
      synced: syncedCount,
      recentImports: recentResult.rows,
      latestSync: latestSyncResult.rows[0] || null,
      pendingActions: {
        requiresValidation: pendingValidationResult.rows[0]?.count || 0,
        readyForSync: readyForSyncResult.rows[0]?.count || 0,
        failedSync: failedSyncResult.rows[0]?.count || 0,
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

    // Get facility-scoped WHERE clause
    const scope = getCaseListScope(req.user);

    // Build WHERE clause with optional filters
    let where = `is_archived = false AND ${scope.where}`;
    const params = [...scope.params];
    let paramIdx = params.length + 1;

    if (req.query.barangay) {
      where += ` AND barangay_name = $${paramIdx++}`;
      params.push(req.query.barangay);
    }
    if (req.query.source_type) {
      where += ` AND source_type = $${paramIdx++}`;
      params.push(req.query.source_type);
    }
    if (req.query.search) {
      where += ` AND (barangay_name ILIKE $${paramIdx} OR city ILIKE $${paramIdx} OR screening_facility ILIKE $${paramIdx} OR treatment_facility ILIKE $${paramIdx} OR itis_case_id ILIKE $${paramIdx})`;
      params.push(`%${req.query.search}%`);
      paramIdx++;
    }

    // Count query
    const countResult = await db.pool.query(
      `SELECT COUNT(*)::int AS total FROM validated_tb_cases WHERE ${where}`,
      params
    );

    // Data query
    const dataResult = await db.pool.query(
      `SELECT * FROM validated_tb_cases WHERE ${where} ORDER BY id DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({
      records: dataResult.rows,
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
    const { canViewCase, isReadOnlyForUser } = require('../policies/caseAccessPolicy');

    const result = await db.pool.query(
      'SELECT * FROM validated_tb_cases WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found.' });
    }

    const record = result.rows[0];

    if (!canViewCase(req.user, record)) {
      return res.status(403).json({ error: 'Access denied. This record is outside your facility scope.' });
    }

    const readOnly = isReadOnlyForUser(req.user, record);

    // Fetch transfer history for this case
    const transfers = await db.pool.query(
      `SELECT ct.*, 
              hf1.name AS from_facility_name,
              hf2.name AS to_facility_name,
              u1.username AS initiated_by_username,
              u2.username AS accepted_by_username
       FROM case_transfers ct
       LEFT JOIN health_facilities hf1 ON ct.from_facility_id = hf1.id
       LEFT JOIN health_facilities hf2 ON ct.to_facility_id = hf2.id
       LEFT JOIN users u1 ON ct.initiated_by_user_id = u1.id
       LEFT JOIN users u2 ON ct.accepted_by_user_id = u2.id
       WHERE ct.validated_case_id = $1
       ORDER BY ct.created_at DESC`,
      [id]
    );

    res.json({
      record,
      isReadOnly: readOnly,
      transfers: transfers.rows,
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
    const isInScope = req.user.role === 'admin' ||
      record.current_responsible_facility_id === req.user.facility_id ||
      record.current_responsible_facility_id === null;

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

// ==================== BATCH DETAILS ====================
router.get('/batches/:id/details', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { id } = req.params;

    const batchResult = await db.getBatchWithUsers(id);
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const syncResult = await db.pool.query(
      `SELECT wl.*, u.username 
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
