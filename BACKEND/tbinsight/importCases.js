const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const { normalizeOutcome } = require('./outcomeNormalization');

/**
 * Import parsed case data into the database
 * Stores raw rows in tb_cases_raw and validated rows in tb_cases
 * All within a single transaction
 *
 * @param {Array} rows - Parsed rows from parseCaseFile
 * @param {string} sourceFile - Original filename
 * @returns {Object} { batchId, importedCount, errorCount, batch }
 */
async function importCases(rows, sourceFile) {
  const batchId = uuidv4();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let importedCount = 0;
    let errorCount = 0;

    for (const row of rows) {
      // Derive location_classification from barangays table
      let locationClassification = null;
      if (row.barangay_name) {
        const bgyCheck = await client.query(
          `SELECT name FROM barangays WHERE LOWER(name) = LOWER($1)`,
          [row.barangay_name.trim()]
        );
        locationClassification = bgyCheck.rows.length > 0 ? 'Pasig City' : 'Non-Pasig';
      }

      // Insert raw row (all rows, including errors)
      await client.query(
        `INSERT INTO tb_cases_raw (
          batch_id, row_number, validation_status,
          date_of_screening, date_of_diagnosis, date_of_notification,
          age, sex, barangay_name, city,
          screening_facility, treatment_facility,
          source_of_patient, anatomical_site,
          registration_group, bacteriological_status,
          date_started_treatment, outcome_status, date_of_outcome,
          record_created_at, source_file,
          itis_case_id, source_type, location_classification
        ) VALUES (
          $1, $2, $3,
          $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12,
          $13, $14,
          $15, $16,
          $17, $18, $19,
          $20, $21,
          $22, $23, $24
        )`,
        [
          batchId,
          row.row_number,
          row.validation_status,
          row.date_of_screening,
          row.date_of_diagnosis,
          row.date_of_notification,
          row.age,
          row.sex ? row.sex.trim() : null,
          row.barangay_name ? row.barangay_name.trim() : null,
          row.city ? row.city.trim() : null,
          row.screening_facility ? row.screening_facility.trim() : null,
          row.treatment_facility ? row.treatment_facility.trim() : null,
          row.source_of_patient ? row.source_of_patient.trim() : null,
          row.anatomical_site ? row.anatomical_site.trim() : null,
          row.registration_group ? row.registration_group.trim() : null,
          row.bacteriological_status ? row.bacteriological_status.trim() : null,
          row.date_started_treatment,
          normalizeOutcome(row.outcome_status),
          row.date_of_outcome,
          row.record_created_at,
          sourceFile,
          row.itis_case_id ? row.itis_case_id.trim() : null,
          row.source_type ? row.source_type.trim() : null,
          locationClassification,
        ]
      );

      // Insert ALL rows into tb_cases (not just validated)
      await client.query(
        `INSERT INTO tb_cases (
          batch_id,
          date_of_diagnosis, date_of_screening, date_of_notification,
          age, sex, barangay_name,
          screening_facility, treatment_facility,
          source_of_patient, anatomical_site,
          registration_group, bacteriological_status,
          date_started_treatment, outcome_status, date_of_outcome,
          validation_status, itis_case_id, source_type, location_classification
        ) VALUES (
          $1,
          $2, $3, $4,
          $5, $6, $7,
          $8, $9,
          $10, $11,
          $12, $13,
          $14, $15, $16,
          $17, $18, $19, $20
        )`,
        [
          batchId,
          row.date_of_diagnosis,
          row.date_of_screening,
          row.date_of_notification,
          row.age,
          row.sex ? row.sex.trim() : null,
          row.barangay_name ? row.barangay_name.trim() : null,
          row.screening_facility ? row.screening_facility.trim() : null,
          row.treatment_facility ? row.treatment_facility.trim() : null,
          row.source_of_patient ? row.source_of_patient.trim() : null,
          row.anatomical_site ? row.anatomical_site.trim() : null,
          row.registration_group ? row.registration_group.trim() : null,
          row.bacteriological_status ? row.bacteriological_status.trim() : null,
          row.date_started_treatment,
          normalizeOutcome(row.outcome_status),
          row.date_of_outcome,
          row.validation_status || null,
          row.itis_case_id ? row.itis_case_id.trim() : null,
          row.source_type ? row.source_type.trim() : null,
          locationClassification,
        ]
      );

      if (row.validation_status === 'Validated') {
        importedCount++;
      } else {
        errorCount++;
      }
    }

    // Record the batch in a lightweight way
    // We use tb_cases_raw to track batches since all rows are stored there
    await client.query('COMMIT');

    console.log(`✅ Batch ${batchId}: ${importedCount} imported, ${errorCount} errors`);

    return {
      batchId,
      importedCount,
      errorCount,
      totalCount: rows.length,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Import failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get import history (list of batches)
 */
async function getImportHistory() {
  const result = await pool.query(
    `SELECT
       batch_id,
       source_file,
       MIN(imported_at) as imported_at,
       COUNT(*) as total_rows,
       COUNT(*) FILTER (WHERE validation_status = 'Validated') as valid_rows,
        COUNT(*) FILTER (WHERE validation_status = 'Not Validated') as error_rows
     FROM tb_cases_raw
     GROUP BY batch_id, source_file
     ORDER BY MIN(imported_at) DESC`
  );
  return result.rows;
}

/**
 * Get validation errors for a specific batch
 */
async function getBatchErrors(batchId) {
  const result = await pool.query(
    `SELECT row_number, validation_status
     FROM tb_cases_raw
     WHERE batch_id = $1 AND validation_status = 'Not Validated'
     ORDER BY row_number`,
    [batchId]
  );
  return result.rows;
}

/**
 * Get summary stats for a batch
 */
async function getBatchSummary(batchId) {
  const result = await pool.query(
    `SELECT
       COUNT(*) as total_rows,
       COUNT(*) FILTER (WHERE validation_status = 'Validated') as valid_rows,
       COUNT(*) FILTER (WHERE validation_status = 'Not Validated') as error_rows
     FROM tb_cases_raw
     WHERE batch_id = $1`,
    [batchId]
  );
  return result.rows[0] || null;
}

module.exports = {
  importCases,
  getImportHistory,
  getBatchErrors,
  getBatchSummary,
};
