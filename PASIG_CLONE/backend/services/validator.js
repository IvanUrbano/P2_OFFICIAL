const db = require('../db/pasigSchema');
const { getSourceRecordId } = require('./recordDuplicateDetector');

const VALID_SEX = ['male', 'female'];
const VALID_OUTCOME = [
  'cured', 'treatment completed', 'died', 'treatment failed',
  'lost to follow-up', 'not evaluated', 'on treatment',
];

async function getValidBarangays() {
  // For Pasig Clone, we validate against the known 30 Pasig barangays.
  // In production, this could query a barangays reference table.
  // For now, use the hardcoded list as the authoritative source.
  return new Set([
    'bagong ilog', 'bambang', 'buting', 'caniogan', 'dela paz',
    'kalawaan', 'kapasigan', 'kapasigan extension', 'kapitolyo', 'malinao', 'manggahan',
    'maybunga', 'oranbo', 'palatiw', 'pinagbuhatan', 'pineda',
    'rosario', 'sagad', 'san antonio', 'san joaquin', 'san jose',
    'san miguel', 'san nicolas', 'santa cruz', 'santa lucia',
    'santa rosa', 'santo tomas', 'santolan', 'sumilang', 'ugong',
  ]);
}

async function validateBatch(batchId) {
  const records = await db.getRawCases(batchId);
  const validBarangays = await getValidBarangays();

  const results = {
    total: records.rows.length,
    valid: 0,
    invalid: 0,
    warnings: 0,
    errors: [],
    validatedRecords: [],
  };

  for (const record of records.rows) {
    const csvData = record.csv_data;
    const validation = validateRecord(csvData, record.source_type, validBarangays);

    results.validatedRecords.push({
      raw_id: record.id,
      source_type: record.source_type,
      row_number: record.row_number,
      ...csvData,
      is_valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
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

    if (validation.warnings.length > 0) {
      results.warnings++;
    }
  }

  await db.updateBatchValidation(batchId, results.valid, results.invalid);

  // Idempotency: delete existing validated records for this batch before re-inserting
  const validRecords = results.validatedRecords.filter(r => r.is_valid);

  // Compute source_record_id and record_status for each valid record
  for (const r of validRecords) {
    r.source_record_id = getSourceRecordId(r, r.source_type);
    r.record_status = 'new';
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM validated_tb_cases WHERE batch_id = $1', [batchId]);

    const COLS = 27;
    const chunkSize = 100;
    for (let i = 0; i < validRecords.length; i += chunkSize) {
      const chunk = validRecords.slice(i, i + chunkSize);
      const placeholders = chunk.map((_, idx) => {
        const base = idx * COLS;
        return `(${Array.from({ length: COLS }, (_, c) => `$${base + c + 1}`).join(',')})`;
      }).join(', ');
      const flatParams = chunk.flatMap(r => [
        batchId, r.source_type, r.barangay_name, r.date_of_diagnosis,
        r.date_of_notification, r.age, r.sex, r.city,
        r.screening_facility, r.treatment_facility, r.source_of_patient,
        r.anatomical_site, r.registration_group, r.bacteriological_status,
        r.date_started_treatment, r.outcome_status, r.date_of_outcome,
        r.record_created_at, r.date_of_screening, r.validation_status,
        r.itis_case_id, r.is_valid, JSON.stringify(r.errors),
        JSON.stringify(r.warnings),
        r.source_record_id || null, r.record_status || 'new', null,
      ]);
      await client.query(
        `INSERT INTO validated_tb_cases
         (batch_id, source_type, barangay_name, date_of_diagnosis, date_of_notification,
          age, sex, city, screening_facility, treatment_facility, source_of_patient,
          anatomical_site, registration_group, bacteriological_status, date_started_treatment,
          outcome_status, date_of_outcome, record_created_at, date_of_screening,
          validation_status, itis_case_id, is_valid, validation_errors, validation_warnings,
          source_record_id, record_status, updated_by)
         VALUES ${placeholders}`,
        flatParams
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  results.summary = { total: validRecords.length, new: validRecords.length, updated: 0, duplicate: 0, error: 0 };

  return results;
}

function validateRecord(csvData, sourceType, validBarangays) {
  const errors = [];
  const warnings = [];

  // Determine if this is a Pasig City record based on city field
  const normalizedCity = (csvData.city || '').trim().toLowerCase();
  const isPasig = normalizedCity === 'pasig city' || normalizedCity === 'pasig';

  if (!csvData.barangay_name || csvData.barangay_name.trim() === '') {
    errors.push('Barangay is required');
  } else if (isPasig && !validBarangays.has(csvData.barangay_name.trim().toLowerCase())) {
    // Only reject unknown barangays for Pasig City records
    errors.push(`Unknown barangay: "${csvData.barangay_name}"`);
  } else if (!isPasig) {
    // Non-Pasig records: retain but warn — excluded from Pasig analytics
    warnings.push(`Non-Pasig record: city="${csvData.city}", barangay="${csvData.barangay_name}"`);
  }

  if (!csvData.date_of_diagnosis) {
    errors.push('Date of Diagnosis is required');
  }

  if (!csvData.sex || csvData.sex.trim() === '') {
    errors.push('Sex is required');
  } else if (!VALID_SEX.includes(csvData.sex.trim().toLowerCase())) {
    errors.push(`Invalid sex: "${csvData.sex}"`);
  }

  if (csvData.age !== null && csvData.age !== undefined) {
    const age = parseInt(csvData.age);
    if (isNaN(age) || age < 0 || age > 120) {
      errors.push(`Invalid age: "${csvData.age}"`);
    }
  }

  if (sourceType === 'DSTB') {
    if (csvData.validation_status) {
      const status = csvData.validation_status.toLowerCase();
      if (!status.includes('validated') && !status.includes('not validated')) {
        warnings.push(`Unknown validation status: "${csvData.validation_status}"`);
      }
    }
  }

  if (sourceType === 'MN') {
    if (!csvData.itis_case_id || csvData.itis_case_id.trim() === '') {
      warnings.push('MN record missing ITIS Case ID');
    }
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
