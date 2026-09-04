const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SCHEMA = 'pasig_clone';

// Execute multi-statement SQL by splitting on semicolons
const execSql = async (sqlContent) => {
  const client = await pool.connect();
  try {
    const statements = sqlContent
      .split(/;\s*\n/)
      .map(s => s.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim())
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
    console.log(`[${SCHEMA}] Schema and tables initialized from init.sql`);
  } else {
    console.warn(`[${SCHEMA}] init.sql not found, skipping schema initialization`);
  }
}

// --- CRUD Helpers ---

function insertBatch(filename, uploadedBy, totalRows, dstbCount, mnCount) {
  return pool.query(
    `INSERT INTO ${SCHEMA}.import_batches (filename, uploaded_by, total_rows, dstb_count, mn_count)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [filename, uploadedBy, totalRows, dstbCount, mnCount]
  );
}

function insertRawCase(batchId, sheetName, sourceType, rowNumber, csvData) {
  return pool.query(
    `INSERT INTO ${SCHEMA}.raw_tb_cases (batch_id, sheet_name, source_type, row_number, csv_data)
     VALUES ($1, $2, $3, $4, $5)`,
    [batchId, sheetName, sourceType, rowNumber, csvData]
  );
}

function insertValidatedCase(batchId, record) {
  return pool.query(
    `INSERT INTO ${SCHEMA}.validated_tb_cases
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
    `UPDATE ${SCHEMA}.import_batches
     SET status = 'validated', valid_count = $1, error_count = $2, validated_at = NOW()
     WHERE id = $3`,
    [validCount, errorCount, batchId]
  );
}

function updateBatchSent(batchId) {
  return pool.query(
    `UPDATE ${SCHEMA}.import_batches SET status = 'sent', sent_at = NOW() WHERE id = $1`,
    [batchId]
  );
}

function getBatch(batchId) {
  return pool.query(`SELECT * FROM ${SCHEMA}.import_batches WHERE id = $1`, [batchId]);
}

function getRawCases(batchId) {
  return pool.query(
    `SELECT * FROM ${SCHEMA}.raw_tb_cases WHERE batch_id = $1 ORDER BY row_number`,
    [batchId]
  );
}

function getValidatedCases(batchId) {
  return pool.query(
    `SELECT * FROM ${SCHEMA}.validated_tb_cases WHERE batch_id = $1 AND is_valid = true`,
    [batchId]
  );
}

function getPendingCases() {
  return pool.query(
    `SELECT * FROM ${SCHEMA}.validated_tb_cases WHERE is_valid = true ORDER BY id`
  );
}

function getAllCases() {
  return pool.query(`SELECT * FROM ${SCHEMA}.validated_tb_cases ORDER BY id DESC`);
}

function logWebhook(batchId, payload, status, responseCode, responseBody) {
  return pool.query(
    `INSERT INTO ${SCHEMA}.webhook_logs (batch_id, payload, status, response_code, response_body)
     VALUES ($1, $2, $3, $4, $5)`,
    [batchId, JSON.stringify(payload), status, responseCode, responseBody]
  );
}

function logWebhookError(batchId, payload, errorMessage) {
  return pool.query(
    `INSERT INTO ${SCHEMA}.webhook_logs (batch_id, payload, status, error_message)
     VALUES ($1, $2, 'failed', $3)`,
    [batchId, JSON.stringify(payload), errorMessage]
  );
}

function getWebhookLogs() {
  return pool.query(
    `SELECT wl.*, ib.filename
     FROM ${SCHEMA}.webhook_logs wl
     LEFT JOIN ${SCHEMA}.import_batches ib ON wl.batch_id = ib.id
     ORDER BY wl.sent_at DESC
     LIMIT 50`
  );
}

function getBatches() {
  return pool.query(
    `SELECT * FROM ${SCHEMA}.import_batches ORDER BY created_at DESC LIMIT 50`
  );
}

module.exports = {
  pool,
  initSchema,
  insertBatch,
  insertRawCase,
  insertValidatedCase,
  updateBatchValidation,
  updateBatchSent,
  getBatch,
  getRawCases,
  getValidatedCases,
  getPendingCases,
  getAllCases,
  logWebhook,
  logWebhookError,
  getWebhookLogs,
  getBatches,
};
