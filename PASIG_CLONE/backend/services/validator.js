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
    'kalawaan', 'kapasigan', 'kapitolyo', 'malinao', 'manggahan',
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

  for (const record of results.validatedRecords) {
    if (record.is_valid) {
      await db.insertValidatedCase(batchId, record);
    }
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
