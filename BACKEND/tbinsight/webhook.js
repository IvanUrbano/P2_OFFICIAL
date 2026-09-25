const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const { validateRow } = require('./parseCaseFile');
const { rebuildAggregations } = require('./aggregateMonthly');
const { verifyWebhookSignature } = require('../middleware/webhookAuth');

router.post('/pasig-clone', verifyWebhookSignature, async (req, res) => {
  console.log('📥 Webhook received from Pasig Clone');
  
  const client = await pool.connect();
  try {
    const { source, batch_id, timestamp, sheets, schema_version } = req.body;
    
    console.log(`   Source: ${source}, Batch: ${batch_id}, Schema: ${schema_version}`);
    if (!sheets) {
      console.error('   ❌ No sheets in payload');
      return res.status(400).json({ error: 'sheets field is required' });
    }
    console.log(`   Sheets: ${sheets?.length || 0}`);

    // Validate payload structure
    if (schema_version !== '1.0') {
      console.error(`   ❌ Invalid schema version: ${schema_version}`);
      return res.status(400).json({ error: 'Unsupported payload version. Expected schema_version "1.0".' });
    }

    if (source !== 'pasig-clone' || !Array.isArray(sheets)) {
      console.error(`   ❌ Invalid payload structure: source=${source}, sheets is array=${Array.isArray(sheets)}`);
      return res.status(400).json({ error: 'Invalid payload structure' });
    }

    if (!batch_id || typeof batch_id !== 'string') {
      console.error(`   ❌ Invalid batch_id: ${batch_id}`);
      return res.status(400).json({ error: 'batch_id is required' });
    }

    // Validate batch_id is a proper UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(batch_id)) {
      console.error(`   ❌ Invalid batch_id format: ${batch_id}`);
      return res.status(400).json({ error: 'batch_id must be a valid UUID' });
    }

    if (!timestamp) {
      console.error('   ❌ Missing timestamp');
      return res.status(400).json({ error: 'timestamp is required' });
    }

    // Idempotency: check if this batch was already processed (or attempted)
    const existing = await pool.query(
      "SELECT id, status FROM webhook_logs WHERE batch_id = $1",
      [batch_id]
    );
    if (existing.rows.length > 0) {
      const existingStatus = existing.rows[0].status;
      if (existingStatus === 'processed') {
        console.log(`   ⚠️ Batch ${batch_id} already processed (duplicate)`);
        return res.json({
          success: true,
          message: 'Webhook already processed (duplicate)',
        });
      }
      // If status is 'failed', delete the old log and retry
      console.log(`   🔄 Batch ${batch_id} has a previous failed attempt — clearing for retry`);
      await pool.query('DELETE FROM webhook_logs WHERE batch_id = $1', [batch_id]);
    }

    const barangaysResult = await pool.query('SELECT name FROM barangays');
    const validBarangays = new Set(barangaysResult.rows.map(r => r.name.toLowerCase()));
    // Canonical name map: lowercase → title case (for FK constraint)
    const barangayNameMap = new Map();
    for (const row of barangaysResult.rows) {
      barangayNameMap.set(row.name.toLowerCase(), row.name);
    }

    let totalRecords = 0;
    let importedCount = 0;
    let errorCount = 0;
    const errors = [];
    const allValidRows = [];

    await client.query('BEGIN');

    for (const sheet of sheets) {
      const { source_type, records } = sheet;

      if (!source_type || !['DSTB', 'MN'].includes(source_type)) {
        await client.query('ROLLBACK');
        console.error(`   ❌ Invalid source_type: ${source_type}`);
        return res.status(400).json({ error: `Invalid source_type: "${source_type}"` });
      }

      if (!Array.isArray(records)) {
        await client.query('ROLLBACK');
        console.error('   ❌ records is not an array');
        return res.status(400).json({ error: 'records must be an array' });
      }

      if (sheet.record_count !== undefined && sheet.record_count !== records.length) {
        await client.query('ROLLBACK');
        console.error(`   ❌ record_count mismatch: expected ${sheet.record_count}, got ${records.length}`);
        return res.status(400).json({
          error: `record_count mismatch: expected ${sheet.record_count}, got ${records.length}`,
        });
      }

      for (const record of records) {
        totalRecords++;
        record.source_type = source_type;

        // Normalize barangay_name to canonical title-case (required for FK constraint)
        const bgyLower = String(record.barangay_name || '').trim().toLowerCase();
        const canonicalBgy = barangayNameMap.get(bgyLower);
        if (canonicalBgy) {
          record.barangay_name = canonicalBgy;
        } else {
          // Barangay not in Pasig — skip this record
          totalRecords++;
          errorCount++;
          errors.push({ row: record.row_number || totalRecords, source_type, errors: ['Unknown barangay: not a Pasig City barangay'] });
          continue;
        }

        const validation = validateRow(record, validBarangays);

        if (validation.valid) {
          const normalizedCity = String(record.city || '').trim().toLowerCase();
          let locationClassification =
            normalizedCity === 'pasig city' || normalizedCity === 'pasig'
              ? 'Pasig City'
              : null;
          if (!locationClassification) {
            locationClassification = validBarangays.has(String(record.barangay_name || '').trim().toLowerCase())
              ? 'Pasig City'
              : 'Non-Pasig';
          }

          allValidRows.push([
            batch_id,
            record.date_of_diagnosis, record.date_of_screening, record.date_of_notification,
            record.age, record.sex, record.barangay_name, record.screening_facility,
            record.treatment_facility, record.source_of_patient, record.anatomical_site,
            record.registration_group, record.bacteriological_status, record.date_started_treatment,
            record.outcome_status, record.date_of_outcome, record.validation_status,
            record.itis_case_id, source_type, locationClassification,
            record.type, record.province, record.region,
            record.referred_to_dots, record.referral_status,
            record.microscopy_result, record.microscopy_release_date,
            record.rdt_result, record.rdt_release_date, record.outcome_reason,
          ]);
          importedCount++;
        } else {
          errorCount++;
          errors.push({ row: record.row_number, source_type, errors: validation.errors });
        }
      }
    }

    const COLS = 30;
    const chunkSize = 100;
    for (let i = 0; i < allValidRows.length; i += chunkSize) {
      const chunk = allValidRows.slice(i, i + chunkSize);
      const placeholders = chunk.map((_, idx) => {
        const base = idx * COLS;
        return `(${Array.from({ length: COLS }, (_, c) => `$${base + c + 1}`).join(',')})`;
      }).join(', ');
      const flatParams = chunk.flat();
      await client.query(
        `INSERT INTO tb_cases (
          batch_id, date_of_diagnosis, date_of_screening, date_of_notification,
          age, sex, barangay_name, screening_facility, treatment_facility,
          source_of_patient, anatomical_site, registration_group, bacteriological_status,
          date_started_treatment, outcome_status, date_of_outcome,
          validation_status, itis_case_id, source_type, location_classification,
          type, province, region,
          referred_to_dots, referral_status,
          microscopy_result, microscopy_release_date,
          rdt_result, rdt_release_date, outcome_reason
        ) VALUES ${placeholders}`,
        flatParams
      );
    }

    await client.query('COMMIT');

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
        [source, batch_id, JSON.stringify(req.body), totalRecords, importedCount]
      );
      console.log(`✅ Webhook logged: batch ${batch_id}, ${importedCount} records imported`);
    } catch (logErr) {
      if (logErr.code === '23505') {
        // Unique constraint violation — duplicate webhook, already logged
        console.log(`⚠️ Webhook log for batch ${batch_id} already exists (duplicate)`);
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
    
    console.log(`✅ Webhook batch ${batch_id} completed successfully`);
    console.log(`   📊 Total records: ${totalRecords}, Imported: ${importedCount}, Errors: ${errorCount}`);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback error:', rollbackErr.message);
    }
    
    console.error('❌ Webhook processing error:');
    console.error('   Message:', error.message);
    console.error('   Code:', error.code);
    if (error.stack) {
      console.error('   Stack:', error.stack.split('\n').slice(0, 5).join('\n'));
    }
    
    // Try to log the webhook failure, but be defensive about req.body
    try {
      const source = req.body?.source || 'unknown';
      const batchId = req.body?.batch_id || 'unknown';
      const payload = req.body ? JSON.stringify(req.body) : '{}';
      await pool.query(
        `INSERT INTO webhook_logs (source, batch_id, payload, status, error_message)
         VALUES ($1, $2, $3, 'failed', $4)`,
        [source, batchId, payload, `${error.code || 'ERROR'}: ${error.message}`]
      );
    } catch (logErr) {
      console.error('Failed to log webhook error:', logErr.message);
    }
    
    res.status(500).json({ 
      error: 'Webhook processing failed',
      details: error.message,
      code: error.code
    });
  } finally {
    client.release();
  }
});

module.exports = router;
