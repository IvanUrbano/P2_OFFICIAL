const db = require('../db/pasigSchema');
const { classifyRecord } = require('./recordDuplicateDetector');
const { cleanRecord, isBlankRecord, PASIG_BARANGAYS } = require('./dataCleaner');

const VALID_SEX = ['male', 'female'];

async function getValidBarangays() {
  // The 30 official (PSGC) barangays of Pasig City, lower-cased for comparison.
  return new Set(PASIG_BARANGAYS.map(n => n.toLowerCase()));
}

// Columns written to validated_tb_cases (order matches the value list below).
const INSERT_COLUMNS = [
  'batch_id', 'source_type', 'barangay_name', 'date_of_diagnosis', 'date_of_notification',
  'age', 'sex', 'city', 'screening_facility', 'treatment_facility', 'source_of_patient',
  'anatomical_site', 'registration_group', 'bacteriological_status', 'date_started_treatment',
  'outcome_status', 'date_of_outcome', 'record_created_at', 'date_of_screening',
  'validation_status', 'itis_case_id', 'is_valid', 'validation_errors', 'validation_warnings',
  'source_record_id', 'record_status', 'updated_by',
  // MN-specific fields (previously dropped before reaching TBInsight)
  'type', 'province', 'region', 'referred_to_dots', 'referral_status',
  'microscopy_result', 'microscopy_release_date', 'rdt_result', 'rdt_release_date', 'outcome_reason',
];

function rowValues(batchId, r) {
  return [
    batchId, r.source_type, r.barangay_name, r.date_of_diagnosis, r.date_of_notification,
    r.age, r.sex, r.city, r.screening_facility, r.treatment_facility, r.source_of_patient,
    r.anatomical_site, r.registration_group, r.bacteriological_status, r.date_started_treatment,
    r.outcome_status, r.date_of_outcome, r.record_created_at || null, r.date_of_screening,
    r.validation_status, r.itis_case_id, r.is_valid, JSON.stringify(r.errors),
    JSON.stringify(r.warnings),
    r.source_record_id || null, r.record_status || 'new', null,
    r.type ?? null, r.province ?? null, r.region ?? null, r.referred_to_dots ?? null, r.referral_status ?? null,
    r.microscopy_result ?? null, r.microscopy_release_date ?? null, r.rdt_result ?? null,
    r.rdt_release_date ?? null, r.outcome_reason ?? null,
  ].map(v => (v === undefined ? null : v));
}

/**
 * Clean + validate every raw row of a batch and store the results.
 * Rows are cleaned first (dataCleaner), then validated; cleaning notes are kept as warnings.
 */
async function validateBatch(batchId) {
  const records = await db.getRawCases(batchId);
  const validBarangays = await getValidBarangays();

  const results = {
    total: records.rows.length,
    valid: 0,
    invalid: 0,
    warnings: 0,
    cleaned: 0,
    skippedBlank: 0,
    nonPasig: 0,
    errors: [],
    validatedRecords: [],
  };

  for (const record of records.rows) {
    const { record: cleaned, notes, isPasig } = cleanRecord(record.csv_data || {});

    if (isBlankRecord(cleaned)) {
      results.skippedBlank++;
      continue;
    }

    const validation = validateRecord(cleaned, record.source_type, validBarangays);
    const warnings = [...notes, ...validation.warnings];
    if (notes.some(n => n.includes('standardized'))) results.cleaned++;
    if (!isPasig) results.nonPasig++;

    results.validatedRecords.push({
      raw_id: record.id,
      ...cleaned,
      source_type: record.source_type,
      row_number: record.row_number,
      is_valid: validation.valid,
      errors: validation.errors,
      warnings,
    });

    if (validation.valid) {
      results.valid++;
    } else {
      results.invalid++;
      results.errors.push({
        row: record.row_number,
        source_type: record.source_type,
        errors: validation.errors,
      });
    }

    if (warnings.length > 0) results.warnings++;
  }

  const validRecords = results.validatedRecords.filter(r => r.is_valid);
  const classificationCounts = { new: 0, updated: 0, duplicate: 0 };
  for (const r of validRecords) {
    const classification = await classifyRecord(r, r.source_type, batchId);
    r.source_record_id = classification.sourceRecordId;
    r.record_status = classification.status;
    classificationCounts[classification.status] = (classificationCounts[classification.status] || 0) + 1;
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotency: re-validating a batch replaces its previous results
    await client.query('DELETE FROM validated_tb_cases WHERE batch_id = $1', [batchId]);

    const COLS = INSERT_COLUMNS.length;
    const chunkSize = 100;
    for (let i = 0; i < validRecords.length; i += chunkSize) {
      const chunk = validRecords.slice(i, i + chunkSize);
      const placeholders = chunk.map((_, idx) => {
        const base = idx * COLS;
        return `(${Array.from({ length: COLS }, (_, c) => `$${base + c + 1}`).join(',')})`;
      }).join(', ');
      const flatParams = chunk.flatMap(r => rowValues(batchId, r));
      await client.query(
        `INSERT INTO validated_tb_cases (${INSERT_COLUMNS.join(', ')}) VALUES ${placeholders}`,
        flatParams
      );
    }

    await client.query(
      `UPDATE import_batches
       SET status = 'validated', valid_count = $1, error_count = $2, validated_at = NOW()
       WHERE id = $3`,
      [results.valid, results.invalid, batchId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  results.summary = {
    total: validRecords.length,
    new: classificationCounts.new,
    updated: classificationCounts.updated,
    duplicate: classificationCounts.duplicate,
    error: results.invalid,
    cleaned: results.cleaned,
    nonPasig: results.nonPasig,
    skippedBlank: results.skippedBlank,
  };

  return results;
}

/**
 * Validate one (already cleaned) record. Pure function — no database access.
 */
function validateRecord(csvData, sourceType, validBarangays) {
  const errors = [];
  const warnings = [];

  const str = v => (v === null || v === undefined ? '' : String(v));
  const normalizedCity = str(csvData.city).trim().toLowerCase();
  const isPasig = normalizedCity === 'pasig city' || normalizedCity === 'pasig';
  const barangay = str(csvData.barangay_name).trim();

  if (!barangay) {
    errors.push('Barangay is required');
  } else if (isPasig && !validBarangays.has(barangay.toLowerCase())) {
    // Only reject unknown barangays for Pasig City records
    errors.push(`Unknown barangay: "${csvData.barangay_name}"`);
  } else if (!isPasig) {
    // Non-Pasig records: kept but not sent to TBInsight
    warnings.push(`Non-Pasig record: city="${csvData.city ?? ''}", barangay="${csvData.barangay_name}" — will not be sent to TBInsight`);
  }

  if (!csvData.date_of_diagnosis) {
    errors.push('Date of Diagnosis is required');
  }

  const sex = str(csvData.sex).trim();
  if (!sex) {
    errors.push('Sex is required');
  } else if (!VALID_SEX.includes(sex.toLowerCase())) {
    errors.push(`Invalid sex: "${csvData.sex}"`);
  }

  if (csvData.age !== null && csvData.age !== undefined && csvData.age !== '') {
    const age = Number(csvData.age);
    if (!Number.isInteger(age) || age < 0 || age > 120) {
      errors.push(`Invalid age: "${csvData.age}"`);
    }
  }

  if (sourceType === 'DSTB' && csvData.validation_status) {
    const status = str(csvData.validation_status).toLowerCase();
    if (!status.includes('validated')) {
      warnings.push(`Unknown validation status: "${csvData.validation_status}"`);
    }
  }

  if (sourceType === 'MN' && !str(csvData.itis_case_id).trim()) {
    warnings.push('MN record missing ITIS Case ID');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

module.exports = {
  validateBatch,
  validateRecord,
  getValidBarangays,
};
