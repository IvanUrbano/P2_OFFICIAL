const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SCHEMA = 'pasig_clone';

async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.cases (
        id SERIAL PRIMARY KEY,
        dataset TEXT NOT NULL,
        patient_no TEXT,
        date_reported DATE,
        facility_name TEXT,
        barangay TEXT,
        case_classification TEXT,
        treatment_regimen TEXT,
        patient_type TEXT,
        date_treatment_started DATE,
        outcome TEXT,
        outcome_date DATE,
        sex TEXT,
        age INTEGER,
        registration_date DATE,
        -- MN-only fields
        itis_case_id TEXT,
        first_name TEXT,
        middle_name TEXT,
        last_name TEXT,
        age_group TEXT,
        indigenous_group TEXT,
        contact_name TEXT,
        contact_relationship TEXT,
        -- Metadata
        validation_status TEXT DEFAULT 'pending',
        source_file TEXT,
        imported_by TEXT DEFAULT 'pasig_clone',
        imported_at TIMESTAMP DEFAULT NOW(),
        webhook_sent BOOLEAN DEFAULT FALSE,
        webhook_sent_at TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.webhook_log (
        id SERIAL PRIMARY KEY,
        payload JSONB,
        status INTEGER,
        response TEXT,
        sent_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log(`[${SCHEMA}] Schema and tables initialized`);
  } finally {
    client.release();
  }
}

function insertCase(dataset, row, meta = {}) {
  const fields = [
    'patient_no', 'date_reported', 'facility_name', 'barangay',
    'case_classification', 'treatment_regimen', 'patient_type',
    'date_treatment_started', 'outcome', 'outcome_date', 'sex',
    'age', 'registration_date', 'itis_case_id', 'first_name',
    'middle_name', 'last_name', 'age_group', 'indigenous_group',
    'contact_name', 'contact_relationship', 'validation_status'
  ];

  const allFields = ['dataset', ...fields, 'source_file'];
  const placeholders = allFields.map((_, i) => `$${i + 1}`).join(', ');
  const values = [
    dataset,
    ...fields.map(f => row[f] || null),
    meta.sourceFile || null
  ];

  return pool.query(
    `INSERT INTO ${SCHEMA}.cases (${allFields.join(', ')})
     VALUES (${placeholders})
     RETURNING id`,
    values
  );
}

function markWebhookSent(caseIds) {
  return pool.query(
    `UPDATE ${SCHEMA}.cases
     SET webhook_sent = TRUE, webhook_sent_at = NOW()
     WHERE id = ANY($1)`,
    [caseIds]
  );
}

function logWebhook(payload, status, response) {
  return pool.query(
    `INSERT INTO ${SCHEMA}.webhook_log (payload, status, response)
     VALUES ($1, $2, $3)`,
    [JSON.stringify(payload), status, response]
  );
}

function getPendingCases() {
  return pool.query(
    `SELECT * FROM ${SCHEMA}.cases
     WHERE webhook_sent = FALSE
     ORDER BY id`
  );
}

function getAllCases() {
  return pool.query(
    `SELECT * FROM ${SCHEMA}.cases ORDER BY id DESC`
  );
}

module.exports = {
  pool,
  initSchema,
  insertCase,
  markWebhookSent,
  logWebhook,
  getPendingCases,
  getAllCases,
};
