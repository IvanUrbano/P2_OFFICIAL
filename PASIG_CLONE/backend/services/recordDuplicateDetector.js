/**
 * Record Duplicate Detector
 * Classifies incoming records as: new, existing, updated, or duplicate
 * Uses stable source identifiers to detect duplicates
 */

const db = require('../db/pasigSchema');

/**
 * Get source record ID based on source type
 * DSTB: uses validation_status as source ID (patient case identifier)
 * MN: no stable source ID (the Case ID is handled by the identity rules)
 * @param {Object} record - Parsed record data
 * @param {string} sourceType - 'DSTB' or 'MN'
 * @returns {string|null} Stable source record ID
 */
function getSourceRecordId(record, sourceType) {
  if (!record) return null;

  // For DSTB, use a combination of key identifiers
  // This creates a stable key from patient data
  if (sourceType === 'DSTB') {
    const parts = [
      record.barangay_name || '',
      record.date_of_diagnosis || '',
      (record.sex || '').charAt(0), // First letter of sex
      record.age || '',
    ];
    const stableId = parts.join('_').replace(/[^a-zA-Z0-9_]/g, '');
    return stableId || null;
  }

  return null;
}

/**
 * Classify a record compared to existing records
 * @param {Object} record - Record data
 * @param {string} sourceType - 'DSTB' or 'MN'
 * @param {number|null} excludeBatchId - Batch to exclude from the lookup (the
 *   batch currently being (re-)validated, so replaying it doesn't self-match)
 * @returns {Promise<Object>} { status: 'new'|'existing'|'updated'|'duplicate', existingId: null|id }
 */
async function classifyRecord(record, sourceType, excludeBatchId = null) {
  try {
    const sourceRecordId = getSourceRecordId(record, sourceType);

    // If no source ID can be determined, it's new
    if (!sourceRecordId) {
      return {
        status: 'new',
        existingId: null,
        sourceRecordId: null,
      };
    }

    // Query for existing record with same source ID
    const params = [sourceType, sourceRecordId];
    let batchFilter = '';
    if (excludeBatchId !== null) {
      params.push(excludeBatchId);
      batchFilter = ` AND batch_id <> $${params.length}`;
    }
    const result = await db.pool.query(
      `SELECT id, is_valid,
              barangay_name, date_of_diagnosis, age, sex,
              source_record_id
       FROM validated_tb_cases
       WHERE source_type = $1 AND source_record_id = $2${batchFilter}
       LIMIT 1`,
      params
    );

    if (result.rows.length === 0) {
      return {
        status: 'new',
        existingId: null,
        sourceRecordId,
      };
    }

    const existing = result.rows[0];

    // Compare key fields to detect if updated or exact duplicate
    const isSameRecord =
      existing.barangay_name === record.barangay_name &&
      existing.date_of_diagnosis === record.date_of_diagnosis &&
      existing.age === record.age &&
      existing.sex === record.sex;

    return {
      status: isSameRecord ? 'duplicate' : 'updated',
      existingId: existing.id,
      sourceRecordId,
    };
  } catch (err) {
    console.error('Error classifying record:', err.message);
    // On error, classify as new (safer than marking as duplicate)
    return {
      status: 'new',
      existingId: null,
      sourceRecordId: null,
      error: err.message,
    };
  }
}

/**
 * Classify all records in a batch
 * @param {Array} records - Array of record objects
 * @param {string} sourceType - 'DSTB' or 'MN'
 * @param {number|null} excludeBatchId - Batch to exclude from the lookup
 * @returns {Promise<Object>} Classification summary
 */
async function classifyBatch(records, sourceType, excludeBatchId = null) {
  const summary = {
    total: records.length,
    new: 0,
    updated: 0,
    duplicate: 0,
    error: 0,
    classifications: [],
  };

  for (const record of records) {
    try {
      const classification = await classifyRecord(record, sourceType, excludeBatchId);
      classification.record = record;
      summary.classifications.push(classification);

      switch (classification.status) {
        case 'new':
          summary.new++;
          break;
        case 'updated':
          summary.updated++;
          break;
        case 'duplicate':
          summary.duplicate++;
          break;
        default:
          summary.error++;
      }
    } catch (err) {
      summary.error++;
      summary.classifications.push({
        status: 'error',
        record,
        error: err.message,
      });
    }
  }

  return summary;
}

module.exports = {
  getSourceRecordId,
  classifyRecord,
  classifyBatch,
};
