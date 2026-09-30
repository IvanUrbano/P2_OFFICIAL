const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const { validateRow } = require('./parseCaseFile');
const { rebuildAggregations } = require('./aggregateMonthly');
const { schedulePipelineRun } = require('./pipeline');
const { verifyWebhookSignature } = require('../middleware/webhookAuth');

/**
 * Duplicate detection (record level) has two independent signals, both
 * DETECTION-only — neither is a database uniqueness constraint, and neither
 * ever causes a record to be rejected, skipped, overwritten, or merged:
 *
 * - MN_ITIS_ID_COLLISION: two MN records share the same itis_case_id.
 *   itis_case_id is the best available MN source reference, but an audit of
 *   the live dataset found 20 itis_case_id values shared by records with
 *   materially different barangay/age/outcome — so it is NOT a guaranteed
 *   globally-unique identifier and cannot be used to auto-reject or
 *   auto-confirm. A collision is flagged for human review only.
 *
 * - DSTB_FINGERPRINT_COLLISION: DSTB records have no genuine case/patient
 *   identifier anywhere in the source data (confirmed: PASIG_CLONE's parser
 *   never maps one; the only candidate, a "No." column, is a spreadsheet
 *   row-sequence number, not an identity, and is explicitly excluded — see
 *   multiSheetParser.test.js). The fingerprint below is a HEURISTIC built
 *   only from fields confirmed stable across re-exports of the same case
 *   (they don't get corrected/filled-in later the way screening/treatment
 *   facility, bacteriological_status, and date_started_treatment can). Two
 *   legitimate, distinct patients CAN share a fingerprint; a match means
 *   "needs human review," not "confirmed same case."
 *
 * Documented limitation (verbatim, per audit):
 *
 * "MN records contain an ITIS case reference; however, analysis of the
 * available dataset identified collisions where the same reference occurs
 * across records with materially different attributes. Therefore, the field
 * is retained as source provenance and a duplicate-detection signal rather
 * than being treated as a guaranteed globally unique record identifier.
 *
 * DSTB records do not contain a verified stable case identifier. DSTB
 * duplicate detection therefore uses a heuristic fingerprint. Potential
 * record-level duplicates from either source are flagged for review rather
 * than silently discarded."
 *
 * Fingerprint computed identically to the SQL backfill in
 * db/migrations/018_duplicate_detection.sql (same field order, same
 * uppercase/trim normalization, same md5) so historical and newly-synced
 * rows are directly comparable.
 */
function computeDstbFingerprint(record) {
  const norm = (v) => String(v ?? '').trim().toUpperCase();
  const input = [
    norm(record.barangay_name),
    record.date_of_diagnosis ?? '',
    norm(record.sex),
    record.age ?? '',
    norm(record.anatomical_site),
    norm(record.registration_group),
  ].join('|');
  return crypto.createHash('md5').update(input).digest('hex');
}

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

      if (!source_type || !['DSTB', 'MN', 'MANUAL'].includes(source_type)) {
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
          // Barangay not in Pasig — skip this record (already counted in totalRecords above)
          errorCount++;
          errors.push({ row: record.row_number || totalRecords, source_type, errors: ['Unknown barangay: not a Pasig City barangay'] });
          continue;
        }

        const validation = validateRow(record, validBarangays);

        if (validation.valid) {
          const normalizedCity = String(record.city || '').trim().toLowerCase();
          // An explicit city wins: barangay names repeat across Metro Manila (e.g. Santa Cruz),
          // so a matching Pasig barangay name alone does not make the patient a Pasig case.
          // Without a city, fall back to the barangay lookup.
          let locationClassification;
          if (normalizedCity === 'pasig city' || normalizedCity === 'pasig') {
            locationClassification = 'Pasig City';
          } else if (normalizedCity) {
            locationClassification = 'Non-Pasig';
          } else {
            locationClassification = validBarangays.has(String(record.barangay_name || '').trim().toLowerCase())
              ? 'Pasig City'
              : 'Non-Pasig';
          }

          // Neither itis_case_id (MN) nor the DSTB fingerprint is enforced as
          // a DB uniqueness constraint — see the doc comment on
          // computeDstbFingerprint. Both are lookup keys used only for
          // post-insert possible-duplicate detection below.
          const dstbFingerprint = source_type === 'DSTB' ? computeDstbFingerprint(record) : null;

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
            dstbFingerprint,
          ]);
          // NOT incremented here — this only means "passed validation".
          // The real insert count (importedCount, set below) reflects what
          // actually landed in the DB. Every validated row is inserted —
          // record-level duplicate detection never blocks an insert.
        } else {
          errorCount++;
          errors.push({ row: record.row_number, source_type, errors: validation.errors });
        }
      }
    }

    const COLS = 31;
    const chunkSize = 100;
    let insertedCount = 0;
    const insertedDstbFingerprints = new Set();
    const insertedMnItisCaseIds = new Set();
    for (let i = 0; i < allValidRows.length; i += chunkSize) {
      const chunk = allValidRows.slice(i, i + chunkSize);
      const placeholders = chunk.map((_, idx) => {
        const base = idx * COLS;
        return `(${Array.from({ length: COLS }, (_, c) => `$${base + c + 1}`).join(',')})`;
      }).join(', ');
      const flatParams = chunk.flat();
      // No ON CONFLICT clause: neither itis_case_id nor dstb_fingerprint is a
      // DB uniqueness constraint (see the doc comment above). Every validated
      // row is inserted unconditionally; possible-duplicate detection runs
      // as a separate, non-blocking flagging pass below.
      const result = await client.query(
        `INSERT INTO tb_cases (
          batch_id, date_of_diagnosis, date_of_screening, date_of_notification,
          age, sex, barangay_name, screening_facility, treatment_facility,
          source_of_patient, anatomical_site, registration_group, bacteriological_status,
          date_started_treatment, outcome_status, date_of_outcome,
          validation_status, itis_case_id, source_type, location_classification,
          type, province, region,
          referred_to_dots, referral_status,
          microscopy_result, microscopy_release_date,
          rdt_result, rdt_release_date, outcome_reason,
          dstb_fingerprint
        ) VALUES ${placeholders}
        RETURNING id, dstb_fingerprint, itis_case_id, source_type`,
        flatParams
      );
      insertedCount += result.rows.length;
      for (const row of result.rows) {
        if (row.dstb_fingerprint) insertedDstbFingerprints.add(row.dstb_fingerprint);
        if (row.source_type === 'MN' && row.itis_case_id) insertedMnItisCaseIds.add(row.itis_case_id);
      }
    }
    importedCount = insertedCount;

    // Possible-duplicate detection (never rejection). For every fingerprint
    // or itis_case_id touched by this batch, if MORE THAN ONE tb_cases row
    // now shares it (across this batch and/or earlier ones), flag every row
    // except the earliest as a possible duplicate. Never deletes, merges, or
    // blocks anything — every row keeps existing exactly as inserted; this
    // only sets a review flag and a reason.
    let dstbCollisionsFlagged = 0;
    if (insertedDstbFingerprints.size > 0) {
      const flagResult = await client.query(
        `UPDATE tb_cases t
         SET duplicate_status = 'possible_duplicate', duplicate_of_case_id = earliest.id,
             duplicate_flag_reason = 'DSTB_FINGERPRINT_COLLISION'
         FROM (
           SELECT dstb_fingerprint, MIN(id) AS id
           FROM tb_cases
           WHERE source_type = 'DSTB' AND dstb_fingerprint = ANY($1::text[])
           GROUP BY dstb_fingerprint
           HAVING COUNT(*) > 1
         ) earliest
         WHERE t.dstb_fingerprint = earliest.dstb_fingerprint
           AND t.id != earliest.id
           AND t.source_type = 'DSTB'
           AND t.duplicate_status = 'unique'
         RETURNING t.id`,
        [[...insertedDstbFingerprints]]
      );
      dstbCollisionsFlagged = flagResult.rows.length;
    }

    let mnCollisionsFlagged = 0;
    if (insertedMnItisCaseIds.size > 0) {
      const flagResult = await client.query(
        `UPDATE tb_cases t
         SET duplicate_status = 'possible_duplicate', duplicate_of_case_id = earliest.id,
             duplicate_flag_reason = 'MN_ITIS_ID_COLLISION'
         FROM (
           SELECT itis_case_id, MIN(id) AS id
           FROM tb_cases
           WHERE source_type = 'MN' AND itis_case_id = ANY($1::text[])
           GROUP BY itis_case_id
           HAVING COUNT(*) > 1
         ) earliest
         WHERE t.itis_case_id = earliest.itis_case_id
           AND t.id != earliest.id
           AND t.source_type = 'MN'
           AND t.duplicate_status = 'unique'
         RETURNING t.id`,
        [[...insertedMnItisCaseIds]]
      );
      mnCollisionsFlagged = flagResult.rows.length;
    }
    const possibleDuplicatesFlagged = dstbCollisionsFlagged + mnCollisionsFlagged;

    await client.query('COMMIT');

    // Rebuild aggregations separately — data is already committed
    if (importedCount > 0) {
      try {
        await rebuildAggregations();
      } catch (aggErr) {
        console.error('Aggregation rebuild failed after commit:', aggErr.message);
        // Don't return 500 — data was imported successfully
      }

      // Auto-run the prediction pipeline so GIS risk scores appear without a
      // manual Forecasting visit. Debounced: a burst of syncs (multi-year
      // uploads) collapses into one run; duplicate batches return earlier and
      // never reach this point. Responds to the caller immediately — the run
      // happens in the background (single-flight, failures captured in status).
      schedulePipelineRun(`webhook:${batch_id}`, 5000);
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
      message: `Webhook processed: ${importedCount} imported, ${possibleDuplicatesFlagged} possible duplicates flagged, ${errorCount} errors`,
      totalRecords, importedCount, errorCount,
      possibleDuplicatesFlagged, mnCollisionsFlagged, dstbCollisionsFlagged,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });

    console.log(`✅ Webhook batch ${batch_id} completed successfully`);
    console.log(`   📊 Total: ${totalRecords}, Imported: ${importedCount}, Possible dup flagged: ${possibleDuplicatesFlagged} (MN: ${mnCollisionsFlagged}, DSTB: ${dstbCollisionsFlagged}), Errors: ${errorCount}`);
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
      batch_id: req.body?.batch_id || null,
    });
  } finally {
    client.release();
  }
});

module.exports = router;
