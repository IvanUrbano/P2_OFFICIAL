const db = require('../db/pasigSchema');

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
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM validated_tb_cases WHERE batch_id = $1', [batchId]);

    for (const record of results.validatedRecords) {
      if (record.is_valid) {
        await client.query(
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
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

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
