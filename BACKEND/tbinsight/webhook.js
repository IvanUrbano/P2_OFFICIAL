const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const { validateRow } = require('./parseCaseFile');
const { rebuildAggregations } = require('./aggregateMonthly');

/**
 * Verify HMAC-SHA256 signature.
 * First checks that the secret matches the server's WEBHOOK_SECRET,
 * then verifies the signature matches the payload.
 */
function verifySignature(payload, signature, secret) {
  if (!signature || !secret) return false;

  // Reject if secret doesn't match server's configured secret
  const serverSecret = process.env.WEBHOOK_SECRET;
  if (!serverSecret || secret !== serverSecret) return false;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  const providedSignature = signature.replace('sha256=', '');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * POST /api/webhook/pasig-clone
 * Receive webhook from Pasig Clone system.
 */
router.post('/pasig-clone', async (req, res) => {
  const client = await pool.connect();
  try {
    // Verify signature
    const signature = req.headers['x-webhook-signature'];
    const secret = req.headers['x-webhook-secret'];

    if (!verifySignature(req.body, signature, secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { source, batch_id, timestamp, sheets } = req.body;

    // Validate payload structure
    if (source !== 'pasig-clone' || !sheets || !Array.isArray(sheets)) {
      return res.status(400).json({ error: 'Invalid payload structure' });
    }

    // Get valid barangays for validation
    const barangaysResult = await pool.query('SELECT name FROM barangays');
    const validBarangays = new Set(barangaysResult.rows.map(r => r.name.toLowerCase()));

    let totalRecords = 0;
    let importedCount = 0;
    let errorCount = 0;
    const errors = [];

    await client.query('BEGIN');

    // Process each sheet
    for (const sheet of sheets) {
      const { source_type, records } = sheet;

      for (const record of records) {
        totalRecords++;

        // Add source_type to record
        record.source_type = source_type;

        // Validate record
        const validation = validateRow(record, validBarangays);

        if (validation.valid) {
          // Determine location_classification
          const locationClassification = record.barangay_name &&
            validBarangays.has(record.barangay_name.trim().toLowerCase())
            ? 'Pasig City'
            : 'Non-Pasig';

          // Insert into tb_cases
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
              batch_id || crypto.randomUUID(),
              record.date_of_diagnosis,
              record.date_of_screening,
              record.date_of_notification,
              record.age,
              record.sex ? record.sex.trim() : null,
              record.barangay_name ? record.barangay_name.trim() : null,
              record.screening_facility ? record.screening_facility.trim() : null,
              record.treatment_facility ? record.treatment_facility.trim() : null,
              record.source_of_patient ? record.source_of_patient.trim() : null,
              record.anatomical_site ? record.anatomical_site.trim() : null,
              record.registration_group ? record.registration_group.trim() : null,
              record.bacteriological_status ? record.bacteriological_status.trim() : null,
              record.date_started_treatment,
              record.outcome_status ? record.outcome_status.trim() : null,
              record.date_of_outcome,
              record.validation_status,
              record.itis_case_id ? record.itis_case_id.trim() : null,
              source_type,
              locationClassification,
            ]
          );

          importedCount++;
        } else {
          errorCount++;
          errors.push({
            row: record.row_number,
            source_type,
            errors: validation.errors,
          });
        }
      }
    }

    await client.query('COMMIT');

    // Rebuild aggregations if any records were imported
    if (importedCount > 0) {
      await rebuildAggregations();
    }

    // Log webhook
    await pool.query(
      `INSERT INTO webhook_logs (source, batch_id, payload, status, records_received, records_imported)
       VALUES ($1, $2, $3, 'processed', $4, $5)`,
      [source, batch_id, req.body, totalRecords, importedCount]
    );

    res.json({
      success: true,
      message: `Webhook processed: ${importedCount} records imported, ${errorCount} errors`,
      totalRecords,
      importedCount,
      errorCount,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Webhook processing error:', error);

    // Log failed webhook
    await pool.query(
      `INSERT INTO webhook_logs (source, batch_id, payload, status, error_message)
       VALUES ($1, $2, $3, 'failed', $4)`,
      [req.body.source, req.body.batch_id, req.body, error.message]
    ).catch(() => {});

    res.status(500).json({ error: 'Webhook processing failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
