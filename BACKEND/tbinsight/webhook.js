const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const { validateRow } = require('./parseCaseFile');
const { rebuildAggregations } = require('./aggregateMonthly');
const { verifyWebhookSignature } = require('../middleware/webhookAuth');

/**
 * POST /api/webhook/pasig-clone
 * Receive webhook from Pasig Clone system.
 */
router.post('/pasig-clone', verifyWebhookSignature, async (req, res) => {
  const client = await pool.connect();
  try {
    const { source, batch_id, timestamp, sheets, schema_version } = req.body;

    // Validate payload structure
    if (schema_version !== '1.0') {
      return res.status(400).json({ error: 'Unsupported payload version. Expected schema_version "1.0".' });
    }

    if (source !== 'pasig-clone' || !sheets || !Array.isArray(sheets)) {
      return res.status(400).json({ error: 'Invalid payload structure' });
    }

    if (!batch_id || typeof batch_id !== 'string') {
      return res.status(400).json({ error: 'batch_id is required' });
    }

    // Validate batch_id is a proper UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(batch_id)) {
      return res.status(400).json({ error: 'batch_id must be a valid UUID' });
    }

    if (!timestamp) {
      return res.status(400).json({ error: 'timestamp is required' });
    }

    // Idempotency: check if this batch was already processed
    const existing = await pool.query(
      "SELECT id FROM webhook_logs WHERE batch_id = $1 AND status = 'processed'",
      [batch_id]
    );
    if (existing.rows.length > 0) {
      return res.json({
        success: true,
        message: 'Webhook already processed (duplicate)',
      });
    }

    const barangaysResult = await pool.query('SELECT name FROM barangays');
    const validBarangays = new Set(barangaysResult.rows.map(r => r.name.toLowerCase()));

    let totalRecords = 0;
    let importedCount = 0;
    let errorCount = 0;
    const errors = [];

    await client.query('BEGIN');

    for (const sheet of sheets) {
      const { source_type, records } = sheet;

      if (!source_type || !['DSTB', 'MN'].includes(source_type)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Invalid source_type: "${source_type}"` });
      }

      if (!Array.isArray(records)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'records must be an array' });
      }

      if (sheet.record_count !== undefined && sheet.record_count !== records.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `record_count mismatch: expected ${sheet.record_count}, got ${records.length}`,
        });
      }

      for (const record of records) {
        totalRecords++;
        record.source_type = source_type;

        const validation = validateRow(record, validBarangays);

        if (validation.valid) {
          // Classify location based on city field, not barangay
          const normalizedCity = String(record.city || '').trim().toLowerCase();
          const locationClassification =
            normalizedCity === 'pasig city' || normalizedCity === 'pasig'
              ? 'Pasig City'
              : 'Non-Pasig';

          await client.query(
            `INSERT INTO tb_cases (
              batch_id, date_of_diagnosis, date_of_screening, date_of_notification,
              age, sex, barangay_name, screening_facility, treatment_facility,
              source_of_patient, anatomical_site, registration_group, bacteriological_status,
              date_started_treatment, outcome_status, date_of_outcome,
              validation_status, itis_case_id, source_type, location_classification
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
            [
              batch_id,
              record.date_of_diagnosis, record.date_of_screening, record.date_of_notification,
              record.age, record.sex, record.barangay_name, record.screening_facility,
              record.treatment_facility, record.source_of_patient, record.anatomical_site,
              record.registration_group, record.bacteriological_status, record.date_started_treatment,
              record.outcome_status, record.date_of_outcome, record.validation_status,
              record.itis_case_id, source_type, locationClassification,
            ]
          );
          importedCount++;
        } else {
          errorCount++;
          errors.push({ row: record.row_number, source_type, errors: validation.errors });
        }
      }
    }

    await client.query('COMMIT');
    client.release();

    // Rebuild aggregations separately — data is already committed
    if (importedCount > 0) {
      try {
        await rebuildAggregations();
      } catch (aggErr) {
        console.error('Aggregation rebuild failed after commit:', aggErr.message);
        // Don't return 500 — data was imported successfully
      }
    }

    // Log webhook — handle duplicate-key violation gracefully
    try {
      await pool.query(
        `INSERT INTO webhook_logs (source, batch_id, payload, status, records_received, records_imported)
         VALUES ($1, $2, $3, 'processed', $4, $5)`,
        [source, batch_id, req.body, totalRecords, importedCount]
      );
    } catch (logErr) {
      if (logErr.code === '23505') {
        // Unique constraint violation — duplicate webhook, already logged
        console.log(`Webhook log for batch ${batch_id} already exists (duplicate)`);
      } else {
        console.error('Failed to log webhook:', logErr.message);
      }
    }

    res.json({
      success: true,
      message: `Webhook processed: ${importedCount} imported, ${errorCount} errors`,
      totalRecords, importedCount, errorCount,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Webhook processing error:', error);
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
