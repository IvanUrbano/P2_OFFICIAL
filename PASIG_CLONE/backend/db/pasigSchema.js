require('./pgTimezone'); // must run before any query: naive timestamps are UTC
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Opening a connection to the remote (Neon) database costs ~1.5 s vs ~0.2 s per query on
// an open one, so idle connections are kept for 10 minutes instead of pg's default 10 s.
const POOL_OPTIONS = { idleTimeoutMillis: 600000, keepAlive: true, max: 10 };
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ...POOL_OPTIONS });
const authPool = new Pool({ connectionString: process.env.AUTH_DATABASE_URL, ...POOL_OPTIONS });

pool.on('error', (err) => {
  console.error('[pasig-clone] Unexpected pool error:', err.message);
});
// Same for the shared auth database: a dropped idle connection must not crash the process.
authPool.on('error', (err) => {
  console.error('[pasig-clone] Unexpected auth pool error:', err.message);
});

const execSql = async (sqlContent) => {
  const client = await pool.connect();
  try {
    // Strip a UTF-8 BOM: Postgres rejects it as a syntax error, aborting schema init.
    await client.query(String(sqlContent).replace(/^﻿/, ''));
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

  const mig003Path = path.join(__dirname, 'migrations', '003_patient_case_identity.sql');
  if (fs.existsSync(mig003Path)) {
    try {
      await execSql(fs.readFileSync(mig003Path, 'utf8'));
      console.log('[pasig-clone] Migration 003 (patient # / case ID) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 003 failed (continuing):', err.message);
    }
  }

  const mig004Path = path.join(__dirname, 'migrations', '004_case_tracking.sql');
  if (fs.existsSync(mig004Path)) {
    try {
      await execSql(fs.readFileSync(mig004Path, 'utf8'));
      console.log('[pasig-clone] Migration 004 (case tracking fields) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 004 failed (continuing):', err.message);
    }
  }

  const mig005Path = path.join(__dirname, 'migrations', '005_barangay_referrals.sql');
  if (fs.existsSync(mig005Path)) {
    try {
      await execSql(fs.readFileSync(mig005Path, 'utf8'));
      console.log('[pasig-clone] Migration 005 (barangay referrals) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 005 failed (continuing):', err.message);
    }
  }

  const mig006Path = path.join(__dirname, 'migrations', '006_barangay_ids_referral_review.sql');
  if (fs.existsSync(mig006Path)) {
    try {
      await execSql(fs.readFileSync(mig006Path, 'utf8'));
      console.log('[pasig-clone] Migration 006 (barangay ids, referral review) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 006 failed (continuing):', err.message);
    }
  }

  const mig007Path = path.join(__dirname, 'migrations', '007_validation_queue.sql');
  if (fs.existsSync(mig007Path)) {
    try {
      await execSql(fs.readFileSync(mig007Path, 'utf8'));
      console.log('[pasig-clone] Migration 007 (validation queue) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 007 failed (continuing):', err.message);
    }
  }

  const mig008Path = path.join(__dirname, 'migrations', '008_barangay_ids_authoritative.sql');
  if (fs.existsSync(mig008Path)) {
    try {
      await execSql(fs.readFileSync(mig008Path, 'utf8'));
      console.log('[pasig-clone] Migration 008 (authoritative barangay ids) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 008 failed (continuing):', err.message);
    }
  }

  const mig009Path = path.join(__dirname, 'migrations', '009_referral_final_structure.sql');
  if (fs.existsSync(mig009Path)) {
    try {
      await execSql(fs.readFileSync(mig009Path, 'utf8'));
      console.log('[pasig-clone] Migration 009 (final referral structure) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 009 failed (continuing):', err.message);
    }
  }

  const mig010Path = path.join(__dirname, 'migrations', '010_validation_issue_barangay_id.sql');
  if (fs.existsSync(mig010Path)) {
    try {
      await execSql(fs.readFileSync(mig010Path, 'utf8'));
      console.log('[pasig-clone] Migration 010 (data-issue barangay id) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 010 failed (continuing):', err.message);
    }
  }

  const mig011Path = path.join(__dirname, 'migrations', '011_case_history_events.sql');
  if (fs.existsSync(mig011Path)) {
    try {
      await execSql(fs.readFileSync(mig011Path, 'utf8'));
      console.log('[pasig-clone] Migration 011 (case_history outcome events) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 011 failed (continuing):', err.message);
    }
  }

  const mig012Path = path.join(__dirname, 'migrations', '012_notifications.sql');
  if (fs.existsSync(mig012Path)) {
    try {
      await execSql(fs.readFileSync(mig012Path, 'utf8'));
      console.log('[pasig-clone] Migration 012 (notifications) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 012 failed (continuing):', err.message);
    }
  }

  const mig013Path = path.join(__dirname, 'migrations', '013_facility_match_order.sql');
  if (fs.existsSync(mig013Path)) {
    try {
      await execSql(fs.readFileSync(mig013Path, 'utf8'));
      console.log('[pasig-clone] Migration 013 (facility match order) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 013 failed (continuing):', err.message);
    }
  }

  const mig015Path = path.join(__dirname, 'migrations', '015_identity_class.sql');
  if (fs.existsSync(mig015Path)) {
    try {
      await execSql(fs.readFileSync(mig015Path, 'utf8'));
      console.log('[pasig-clone] Migration 015 (patient-name privacy class) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 015 failed (continuing):', err.message);
    }
  }

  const mig016Path = path.join(__dirname, 'migrations', '016_facility_codes.sql');
  if (fs.existsSync(mig016Path)) {
    try {
      await execSql(fs.readFileSync(mig016Path, 'utf8'));
      console.log('[pasig-clone] Migration 016 (facility codes) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 016 failed (continuing):', err.message);
    }
  }
  const mig017Path = path.join(__dirname, 'migrations', '017_case_status_treatment_outcome.sql');
  if (fs.existsSync(mig017Path)) await execSql(fs.readFileSync(mig017Path, 'utf8'));

  const mig018Path = path.join(__dirname, 'migrations', '018_case_id_required.sql');
  if (fs.existsSync(mig018Path)) {
    try {
      await execSql(fs.readFileSync(mig018Path, 'utf8'));
      console.log('[pasig-clone] Migration 018 (Case ID required for new batches) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 018 failed (continuing):', err.message);
    }
  }

  const mig019Path = path.join(__dirname, 'migrations', '019_case_id_unique.sql');
  if (fs.existsSync(mig019Path)) {
    try {
      await execSql(fs.readFileSync(mig019Path, 'utf8'));
      console.log('[pasig-clone] Migration 019 (Case ID unique per case) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 019 failed (continuing):', err.message);
    }
  }

  const mig020Path = path.join(__dirname, 'migrations', '020_medication_schedules.sql');
  if (fs.existsSync(mig020Path)) {
    try {
      await execSql(fs.readFileSync(mig020Path, 'utf8'));
      console.log('[pasig-clone] Migration 020 (medicine pickup schedules) completed.');
    } catch (err) {
      console.error('[pasig-clone] Migration 020 failed (continuing):', err.message);
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
      validation_status, is_valid, validation_errors, validation_warnings)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
    [
      batchId, record.source_type, record.barangay_name, record.date_of_diagnosis,
      record.date_of_notification, record.age, record.sex, record.city,
      record.screening_facility, record.treatment_facility, record.source_of_patient,
      record.anatomical_site, record.registration_group, record.bacteriological_status,
      record.date_started_treatment, record.outcome_status, record.date_of_outcome,
      record.record_created_at, record.date_of_screening, record.validation_status,
      record.is_valid, JSON.stringify(record.errors),
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
    `SELECT v.*, p.patient_no FROM validated_tb_cases v
     LEFT JOIN patients p ON p.id = v.patient_id
     WHERE v.batch_id = $1 AND v.is_valid = true`,
    [batchId]
  );
}

function getCasesByCaseNo(caseNos) {
  return pool.query(
    `SELECT v.*, p.patient_no FROM validated_tb_cases v
     LEFT JOIN patients p ON p.id = v.patient_id
     WHERE v.case_no = ANY($1::text[])`,
    [caseNos]
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

// The sync log keeps what was sent, not the records themselves: the full payload holds
// every case (case/patient numbers included) and was never read back, so storing it
// only duplicated patient data and bloated the table.
function summarizeWebhookPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return {
    schema_version: payload.schema_version,
    source: payload.source,
    batch_id: payload.batch_id,
    timestamp: payload.timestamp,
    sheets: Array.isArray(payload.sheets)
      ? payload.sheets.map(s => ({ sheet_name: s.sheet_name, source_type: s.source_type, record_count: s.record_count }))
      : [],
  };
}

function logWebhook(batchId, payload, status, responseCode, responseBody, initiatedBy) {
  return pool.query(
    `INSERT INTO webhook_logs (batch_id, payload, status, response_code, response_body, initiated_by, initiated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [batchId, JSON.stringify(summarizeWebhookPayload(payload)), status, responseCode, responseBody, initiatedBy || null]
  );
}

function logWebhookError(batchId, payload, errorMessage, initiatedBy) {
  return pool.query(
    `INSERT INTO webhook_logs (batch_id, payload, status, error_message, initiated_by, initiated_at)
     VALUES ($1, $2, 'failed', $3, $4, NOW())`,
    [batchId, JSON.stringify(summarizeWebhookPayload(payload)), errorMessage, initiatedBy || null]
  );
}

// Never select wl.payload in list views: it holds every record sent in that sync
// (megabytes per row) and made this list take over a minute to load.
const WEBHOOK_LOG_COLUMNS = `wl.id, wl.batch_id, wl.status, wl.response_code, wl.response_body, wl.error_message,
       wl.initiated_by, wl.initiated_at, wl.sent_at, wl.acknowledged_at`;

function getWebhookLogs() {
  return pool.query(
    // Who started the sync is named by routes (services/userNames.js — users live in the
    // auth database).
    `SELECT ${WEBHOOK_LOG_COLUMNS}, ib.filename
     FROM webhook_logs wl
     LEFT JOIN import_batches ib ON wl.batch_id = ib.id
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
      b.archive_reason
     FROM import_batches b
     ${whereClause}
     ORDER BY b.created_at DESC
     LIMIT 100`
  );
}

function getBatchWithUsers(batchId) {
  return pool.query(
    // User names are added by the route (services/userNames.js).
    `SELECT b.* FROM import_batches b WHERE b.id = $1`,
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

function restoreRecord(recordId) {
  return pool.query(
    `UPDATE validated_tb_cases SET is_archived = false WHERE id = $1 AND is_archived = true RETURNING *`,
    [recordId]
  );
}

function deleteValidatedCases(batchId) {
  return pool.query(
    `DELETE FROM validated_tb_cases WHERE batch_id = $1`,
    [batchId]
  );
}

/**
 * Permanently delete a batch and everything it brought in (raw rows, validated cases,
 * data issues, webhook send logs, then the batch row itself) in one transaction. Children are deleted
 * before the parent because import_batches has no ON DELETE CASCADE. Frees up the batch's
 * file_hash so the same file can be re-uploaded.
 *
 * Returns null if the batch doesn't exist, otherwise { batch, deleted }.
 */
async function deleteBatch(batchId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM case_transfers WHERE validated_case_id IN (SELECT id FROM validated_tb_cases WHERE batch_id = $1)`,
      [batchId]
    );
    const raw = await client.query('DELETE FROM raw_tb_cases WHERE batch_id = $1', [batchId]);
    const validated = await client.query('DELETE FROM validated_tb_cases WHERE batch_id = $1', [batchId]);
    // Data issues are the batch's rows that failed validation; left behind they stay
    // listed on the Validation page with no batch to fix them into.
    const issues = await client.query('DELETE FROM validation_issues WHERE batch_id = $1', [batchId]);
    // Patients this batch created, unless a record from another batch now belongs to them
    await client.query(
      `DELETE FROM patients p WHERE p.created_by_batch_id = $1
       AND NOT EXISTS (SELECT 1 FROM validated_tb_cases v WHERE v.patient_id = p.id)`,
      [batchId]
    );
    const logs = await client.query('DELETE FROM webhook_logs WHERE batch_id = $1', [batchId]);
    const batch = await client.query('DELETE FROM import_batches WHERE id = $1 RETURNING *', [batchId]);

    if (batch.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query('COMMIT');
    return {
      batch: batch.rows[0],
      deleted: {
        rawRows: raw.rowCount, validatedCases: validated.rowCount,
        dataIssues: issues.rowCount, webhookLogs: logs.rowCount,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
  deleteBatch,
  updateBatchValidation,
  updateBatchSent,
  getBatch,
  getBatchWithUsers,
  getRawCases,
  getValidatedCases,
  getCasesByCaseNo,
  getPendingCases,
  getAllCases,
  logWebhook,
  logWebhookError,
  summarizeWebhookPayload,
  getWebhookLogs,
  WEBHOOK_LOG_COLUMNS,
  getBatches,
  getImportHistory,
  archiveBatch,
  unarchiveBatch,
  archiveRecord,
  restoreRecord,
};
