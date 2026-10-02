const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const authPool = new Pool({ connectionString: process.env.AUTH_DATABASE_URL });

pool.on('error', (err) => {
  console.error('[pasig-clone] Unexpected pool error:', err.message);
});

// Execute multi-statement SQL by splitting on statement boundaries
const execSql = async (sqlContent) => {
  const client = await pool.connect();
  try {
    // Remove SQL comments, then split on semicolons
    const cleaned = sqlContent
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');

    const statements = cleaned
      .split(/;\s*\n/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const stmt of statements) {
      await client.query(stmt);
    }
  } finally {
    client.release();
  }
};

async function initSchema() {
  const initSqlPath = path.join(__dirname, '..', 'init.sql');
  if (fs.existsSync(initSqlPath)) {
    const sql = fs.readFileSync(initSqlPath, 'utf8');
    await execSql(sql);
    console.log('[pasig-clone] Tables initialized from init.sql');
  } else {
    console.warn('[pasig-clone] init.sql not found, skipping schema initialization');
  }

  // Run migration 001 (audit fields + hash) if it exists
  const mig001Path = path.join(__dirname, 'migrations', '001_add_audit_and_hash_fields.sql');
  if (fs.existsSync(mig001Path)) {
    try {
      const mig001Sql = fs.readFileSync(mig001Path, 'utf8');
      await execSql(mig001Sql);
      console.log('[pasig-clone] Migration 001 (audit/hash fields) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 001 failed (continuing):', err.message);
    }
  }

  // Run migration 002 (case access + transfers) if it exists
  const mig002Path = path.join(__dirname, 'migrations', '002_case_access_and_transfers.sql');
  if (fs.existsSync(mig002Path)) {
    try {
      const mig002Sql = fs.readFileSync(mig002Path, 'utf8');
      await execSql(mig002Sql);
      console.log('[pasig-clone] Migration 002 (case access + transfers) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 002 failed (continuing):', err.message);
    }
  }
}

// --- CRUD Helpers ---

function insertBatch(filename, uploadedBy, totalRows, dstbCount, mnCount) {
  return pool.query(
    `INSERT INTO import_batches (filename, uploaded_by, total_rows, dstb_count, mn_count)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [filename, uploadedBy, totalRows, dstbCount, mnCount]
  );
}

function insertRawCase(batchId, sheetName, sourceType, rowNumber, csvData) {
  return pool.query(
    `INSERT INTO raw_tb_cases (batch_id, sheet_name, source_type, row_number, csv_data)
     VALUES ($1, $2, $3, $4, $5)`,
    [batchId, sheetName, sourceType, rowNumber, csvData]
  );
}

async function insertRawCases(client, batchId, records) {
  if (records.length === 0) return Promise.resolve();
  const chunkSize = 100;
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const placeholders = chunk.map((_, idx) => {
      const base = idx * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    }).join(', ');
    const flatParams = chunk.flatMap(r => [
      batchId, r.sheet_name, r.source_type, r.row_number, JSON.stringify(r.csv_data),
    ]);
    await client.query(
      `INSERT INTO raw_tb_cases (batch_id, sheet_name, source_type, row_number, csv_data)
       VALUES ${placeholders}`,
      flatParams
    );
  }
}

function insertValidatedCase(batchId, record) {
  return pool.query(
    `INSERT INTO validated_tb_cases
     (batch_id, source_type, barangay_name, date_of_diagnosis, date_of_notification,
      age, sex, city, screening_facility, treatment_facility, source_of_patient,
      anatomical_site, registration_group, bacteriological_status, date_started_treatment,
      outcome_status, date_of_outcome, record_created_at, date_of_screening,
      validation_status, itis_case_id, is_valid, validation_errors, validation_warnings)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
    [
      batchId, record.source_type, record.barangay_name, record.date_of_diagnosis,
      record.date_of_notification, record.age, record.sex, record.city,
      record.screening_facility, record.treatment_facility, record.source_of_patient,
      record.anatomical_site, record.registration_group, record.bacteriological_status,
      record.date_started_treatment, record.outcome_status, record.date_of_outcome,
      record.record_created_at, record.date_of_screening, record.validation_status,
      record.itis_case_id, record.is_valid, JSON.stringify(record.errors),
      JSON.stringify(record.warnings),
    ]
  );
}

function updateBatchValidation(batchId, validCount, errorCount) {
  return pool.query(
    `UPDATE import_batches
     SET status = 'validated', valid_count = $1, error_count = $2, validated_at = NOW()
     WHERE id = $3`,
    [validCount, errorCount, batchId]
  );
}

function updateBatchSent(batchId) {
  return pool.query(
    `UPDATE import_batches SET status = 'sent', sent_at = NOW() WHERE id = $1`,
    [batchId]
  );
}

function getBatch(batchId) {
  return pool.query(`SELECT * FROM import_batches WHERE id = $1`, [batchId]);
}

function getRawCases(batchId) {
  return pool.query(
    `SELECT * FROM raw_tb_cases WHERE batch_id = $1 ORDER BY row_number`,
    [batchId]
  );
}

function getValidatedCases(batchId) {
  return pool.query(
    `SELECT * FROM validated_tb_cases WHERE batch_id = $1 AND is_valid = true`,
    [batchId]
  );
}

function getPendingCases() {
  return pool.query(
    `SELECT * FROM validated_tb_cases WHERE is_valid = true ORDER BY id`
  );
}

function getAllCases() {
  return pool.query(`SELECT * FROM validated_tb_cases ORDER BY id DESC`);
}

function logWebhook(batchId, payload, status, responseCode, responseBody, initiatedBy) {
  return pool.query(
    `INSERT INTO webhook_logs (batch_id, payload, status, response_code, response_body, initiated_by, initiated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [batchId, JSON.stringify(payload), status, responseCode, responseBody, initiatedBy || null]
  );
}

function logWebhookError(batchId, payload, errorMessage, initiatedBy) {
  return pool.query(
    `INSERT INTO webhook_logs (batch_id, payload, status, error_message, initiated_by, initiated_at)
     VALUES ($1, $2, 'failed', $3, $4, NOW())`,
    [batchId, JSON.stringify(payload), errorMessage, initiatedBy || null]
  );
}

function getWebhookLogs() {
  return pool.query(
    `SELECT wl.*, ib.filename, u.username
     FROM webhook_logs wl
     LEFT JOIN import_batches ib ON wl.batch_id = ib.id
     LEFT JOIN users u ON wl.initiated_by = u.id
     ORDER BY wl.sent_at DESC
     LIMIT 50`
  );
}

function getBatches() {
  return pool.query(
    `SELECT * FROM import_batches WHERE is_archived = false ORDER BY created_at DESC LIMIT 50`
  );
}

function getImportHistory(status = 'active') {
  let whereClause = '';
  if (status === 'active') whereClause = 'WHERE b.is_archived = false';
  else if (status === 'archived') whereClause = 'WHERE b.is_archived = true';
  else whereClause = '';

  return pool.query(
    `SELECT 
      b.id,
      b.filename,
      b.uploaded_by,
      u.username as imported_by_username,
      b.total_rows,
      b.valid_count,
      b.error_count,
      b.status,
      b.sync_status,
      b.created_at,
      b.validated_at,
      b.synced_at,
      b.is_archived,
      b.archived_by,
      b.archived_at,
      b.archive_reason,
      au.username as archived_by_username
     FROM import_batches b
     LEFT JOIN users u ON b.uploaded_by = u.id
     LEFT JOIN users au ON b.archived_by = au.id
     ${whereClause}
     ORDER BY b.created_at DESC
     LIMIT 100`
  );
}

function getBatchWithUsers(batchId) {
  return pool.query(
    `SELECT 
      b.*,
      u.username as imported_by_username,
      v.username as validated_by_username,
      s.username as synced_by_username,
      a.username as archived_by_username
     FROM import_batches b
     LEFT JOIN users u ON b.uploaded_by = u.id
     LEFT JOIN users v ON b.validated_by = v.id
     LEFT JOIN users s ON b.synced_by = s.id
     LEFT JOIN users a ON b.archived_by = a.id
     WHERE b.id = $1`,
    [batchId]
  );
}

function archiveBatch(batchId, archivedBy, reason) {
  return pool.query(
    `UPDATE import_batches 
     SET is_archived = true, archived_by = $2, archived_at = NOW(), archive_reason = $3
     WHERE id = $1 RETURNING *`,
    [batchId, archivedBy, reason]
  );
}

function unarchiveBatch(batchId) {
  return pool.query(
    `UPDATE import_batches 
     SET is_archived = false, archived_by = NULL, archived_at = NULL, archive_reason = NULL
     WHERE id = $1 RETURNING *`,
    [batchId]
  );
}

function archiveRecord(recordId) {
  return pool.query(
    `UPDATE validated_tb_cases SET is_archived = true WHERE id = $1 RETURNING *`,
    [recordId]
  );
}

function getPopulation() {
  return pool.query(
    `SELECT * FROM barangay_population ORDER BY barangay_name, reference_year DESC`
  );
}

function addPopulation(barangayName, population, referenceYear, source) {
  return pool.query(
    `INSERT INTO barangay_population (barangay_name, population, reference_year, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (barangay_name, reference_year) 
     DO UPDATE SET population = $2, source = $4, updated_at = NOW()
     RETURNING *`,
    [barangayName, population, referenceYear, source]
  );
}

function updatePopulation(id, population, source) {
  return pool.query(
    `UPDATE barangay_population SET population = $2, source = $3, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, population, source]
  );
}

function deleteValidatedCases(batchId) {
  return pool.query(
    `DELETE FROM validated_tb_cases WHERE batch_id = $1`,
    [batchId]
  );
}

module.exports = {
  pool,
  authPool,
  initSchema,
  insertBatch,
  insertRawCase,
  insertRawCases,
  insertValidatedCase,
  deleteValidatedCases,
  updateBatchValidation,
  updateBatchSent,
  getBatch,
  getBatchWithUsers,
  getRawCases,
  getValidatedCases,
  getPendingCases,
  getAllCases,
  logWebhook,
  logWebhookError,
  getWebhookLogs,
  getBatches,
  getImportHistory,
  archiveBatch,
  unarchiveBatch,
  archiveRecord,
  getPopulation,
  addPopulation,
  updatePopulation,
};
