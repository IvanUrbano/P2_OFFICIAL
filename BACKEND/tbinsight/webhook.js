const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const { validateRow } = require('./parseCaseFile');
const { normalizeOutcome } = require('./outcomeNormalization');
const { rebuildAggregations } = require('./aggregateMonthly');
const { schedulePipelineRun } = require('./pipeline');
const { verifyWebhookSignature } = require('../middleware/webhookAuth');
const { flagPossibleDuplicates } = require('./duplicateFlags');
const { lockCaseData } = require('./caseDataLock');
const {
  HISTORY_FIELDS, HISTORY_SELECT_SQL, diffCaseFields, classifyChange, insertCaseHistory,
} = require('./caseHistory');

/**
 * Duplicate detection (record level) is DETECTION-only: it is not a database uniqueness
 * constraint, and never causes a record to be rejected, skipped, overwritten, or merged.
 * The registry's ITIS number is not read, stored, sent or used for matching; the Case ID
 * (case_no / source_case_id) is the identity of a case.
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
 * Documented limitation:
 *
 * "DSTB records do not contain a verified stable case identifier. DSTB
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

// What the sync log keeps about a payload: which batch and how many records per sheet.
function summarizeWebhookPayload(body) {
  if (!body || typeof body !== 'object') return null;
  return {
    schema_version: body.schema_version,
    source: body.source,
    batch_id: body.batch_id,
    timestamp: body.timestamp,
    sheets: Array.isArray(body.sheets)
      ? body.sheets.map(s => ({
        sheet_name: s?.sheet_name,
        source_type: s?.source_type,
        record_count: Array.isArray(s?.records) ? s.records.length : s?.record_count,
      }))
      : [],
  };
}

// Which sent record a rejection belongs to: PASIG's Case ID and its own record id (sent
// as `record_id`). Neither identifies a person; they let PASIG point at the record to fix.
function rejectionRef(record) {
  const recordId = Number(record.record_id);
  return {
    case_no: record.case_no || null,
    record_id: Number.isInteger(recordId) && recordId > 0 ? recordId : null,
  };
}

// Upper bound on rejections listed back to the sender in one response.
const MAX_REJECTED_RETURNED = 5000;

// A 'received' (in-progress) claim older than this is treated as abandoned.
const STALE_CLAIM_MINUTES = 15;

// Release a claimed batch that was rejected before importing, so a corrected resend
// is not blocked behind the in-progress claim.
async function failClaim(claimId, message) {
  if (!claimId) return;
  try {
    await pool.query(
      `UPDATE webhook_logs SET status = 'failed', error_message = $2 WHERE id = $1`,
      [claimId, message]
    );
  } catch (err) {
    console.error('Failed to release webhook claim:', err.message);
  }
}

router.post('/pasig-clone', verifyWebhookSignature, async (req, res) => {
  console.log('📥 Webhook received from Pasig Clone');

  const client = await pool.connect();
  let claimId = null;
  try {
    const { source, batch_id, timestamp, sheets, schema_version } = req.body;

    // Who is asking for this change, as the source system reported it. Optional:
    // an older sender simply omits it and history rows keep a NULL actor label.
    // TBInsight has no user row for a PASIG account, so it is stored as a label
    // (case_history.changed_by_label) rather than a changed_by_user_id.
    const actorLabel = typeof req.body.actor?.username === 'string'
      ? req.body.actor.username.trim().slice(0, 100) || null
      : null;
    
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

    // Idempotency: claim the batch BEFORE importing anything. The unique index on
    // (source, batch_id) makes this atomic, so when the sender times out and retries
    // while the first attempt is still importing, only one attempt can hold the claim.
    // A 'received' row is an import in progress; one older than STALE_CLAIM_MINUTES
    // belongs to an attempt that died (e.g. a restart) and may be taken over, as may
    // a 'failed' one.
    const claim = await pool.query(
      `INSERT INTO webhook_logs (source, batch_id, status, received_at)
       VALUES ($1, $2, 'received', NOW())
       ON CONFLICT (source, batch_id) WHERE batch_id IS NOT NULL DO UPDATE
         SET status = 'received', received_at = NOW(), processed_at = NULL, error_message = NULL
         WHERE webhook_logs.status = 'failed'
            OR (webhook_logs.status = 'received'
                AND webhook_logs.received_at < NOW() - make_interval(mins => $3))
       RETURNING id`,
      [source, batch_id, STALE_CLAIM_MINUTES]
    );
    if (claim.rows.length === 0) {
      const existing = await pool.query(
        'SELECT id, status FROM webhook_logs WHERE batch_id = $1 AND source = $2',
        [batch_id, source]
      );
      if (existing.rows[0]?.status === 'received') {
        console.log(`   ⏳ Batch ${batch_id} is already being imported by another attempt`);
        return res.status(202).json({
          success: true,
          inProgress: true,
          message: 'Webhook already in progress for this batch',
        });
      }
      console.log(`   ⚠️ Batch ${batch_id} already processed (duplicate)`);
      return res.json({
        success: true,
        message: 'Webhook already processed (duplicate)',
      });
    }
    claimId = claim.rows[0].id;

    const barangaysResult = await pool.query('SELECT id, name FROM barangays');
    const validBarangays = new Set(barangaysResult.rows.map(r => r.name.toLowerCase()));
    const barangayNameMap = new Map();
    const barangayIdMap = new Map();
    for (const row of barangaysResult.rows) {
      const barangay = { id: row.id, name: row.name };
      barangayNameMap.set(row.name.toLowerCase(), barangay);
      barangayIdMap.set(Number(row.id), barangay);
    }

    // Registered, active, non-external facilities. A Non-Pasig resident is kept ONLY
    // when their treatment facility is one of these — the facility decides admission
    // and the label, never the barangay.
    const pasigFacilitiesResult = await pool.query(
      `SELECT id FROM health_facilities
       WHERE is_external = FALSE AND is_active = TRUE`
    );
    const pasigFacilityIds = new Set(pasigFacilitiesResult.rows.map(r => Number(r.id)));

    let totalRecords = 0;
    let importedCount = 0;
    let errorCount = 0;
    const errors = [];
    const allValidRows = [];

    await client.query('BEGIN');
    await lockCaseData(client); // see caseDataLock.js

    for (const sheet of sheets) {
      const { source_type, records } = sheet;

      if (!source_type || !['DSTB', 'MN', 'MANUAL'].includes(source_type)) {
        await client.query('ROLLBACK');
        await failClaim(claimId, `Invalid source_type: ${source_type}`);
        console.error(`   ❌ Invalid source_type: ${source_type}`);
        return res.status(400).json({ error: `Invalid source_type: "${source_type}"` });
      }

      if (!Array.isArray(records)) {
        await client.query('ROLLBACK');
        await failClaim(claimId, 'records is not an array');
        console.error('   ❌ records is not an array');
        return res.status(400).json({ error: 'records must be an array' });
      }

      if (sheet.record_count !== undefined && sheet.record_count !== records.length) {
        await client.query('ROLLBACK');
        await failClaim(claimId, `record_count mismatch: expected ${sheet.record_count}, got ${records.length}`);
        console.error(`   ❌ record_count mismatch: expected ${sheet.record_count}, got ${records.length}`);
        return res.status(400).json({
          error: `record_count mismatch: expected ${sheet.record_count}, got ${records.length}`,
        });
      }

      for (const record of records) {
        totalRecords++;
        record.source_type = source_type;

        // Residence exactly as the source file wrote it. It is kept separate from the
        // treatment facility, and stored as free text for a Non-Pasig resident.
        const residenceBarangay = String(record.barangay_name ?? '').trim() || null;
        const residenceCity = String(record.city ?? '').trim() || null;
        const normalizedCity = String(record.city ?? '').trim().toLowerCase();

        // Resolve by ID when supplied; the name lookup is retained for old webhook clients.
        const bgyLower = residenceBarangay ? residenceBarangay.toLowerCase() : '';
        const requestedBarangayId = record.barangay_id == null ? null : Number(record.barangay_id);
        const matchedBarangay = requestedBarangayId == null
          ? barangayNameMap.get(bgyLower)
          : barangayIdMap.get(requestedBarangayId);

        // Residence decides whether this is a Pasig case. An explicit city wins,
        // because barangay names repeat across Metro Manila (e.g. Santa Cruz): a
        // matching Pasig barangay NAME alone never makes the patient a Pasig case.
        const cityIsPasig = normalizedCity === 'pasig city' || normalizedCity === 'pasig';
        const cityIsBlank = normalizedCity === '';
        const isPasigResident = (cityIsPasig || cityIsBlank) && Boolean(matchedBarangay);

        // The only signal that lets a Non-Pasig residence through: an admin resolved
        // the record in PASIG TB-IS (Validation -> Needs Assignment -> Outside Pasig).
        const confirmedOutsidePasig = record.location_resolution === 'outside_pasig';

        const reject = (message) => {
          errorCount++;
          errors.push({
            ...rejectionRef(record),
            row: record.row_number || totalRecords,
            source_type,
            errors: [message],
          });
        };

        if (isPasigResident) {
          record.barangay_id = matchedBarangay.id;
          record.barangay_name = matchedBarangay.name;
        } else if (confirmedOutsidePasig) {
          // Non-Pasig resident, kept ONLY when the facility that manages them is a
          // registered Pasig facility. The facility decides admission and the label —
          // never the barangay: barangay_id and barangay_name stay NULL, and a
          // residence barangay name that collides with a Pasig one is never resolved
          // onto a Pasig barangay.
          const treatmentFacilityId = record.treatment_facility_id == null
            ? null
            : Number(record.treatment_facility_id);
          if (treatmentFacilityId == null || !pasigFacilityIds.has(treatmentFacilityId)) {
            reject('Non-Pasig residence: the treatment facility is not a Pasig health facility');
            continue;
          }
          record.barangay_id = null;
          record.barangay_name = null;
        } else {
          reject(cityIsPasig || cityIsBlank
            ? 'Unknown barangay ID or name: not a Pasig City barangay'
            : 'Non-Pasig residence: confirm it in Validation -> Needs Assignment before it can be sent');
          continue;
        }

        // validateRow sees the canonical Pasig barangay for a Pasig resident, and the
        // raw residence text for a Non-Pasig resident (an unknown barangay there is
        // expected, not an error).
        const validation = validateRow(
          isPasigResident ? record : { ...record, barangay_name: residenceBarangay },
          validBarangays
        );

        if (validation.valid) {
          const locationClassification = isPasigResident ? 'Pasig City' : 'Non-Pasig Resident';

          // The DSTB fingerprint is not enforced as a DB uniqueness constraint — see
          // the doc comment on computeDstbFingerprint. It is a lookup key used only
          // for post-insert possible-duplicate detection below.
          const dstbFingerprint = source_type === 'DSTB'
            ? computeDstbFingerprint({
              ...record,
              barangay_name: record.barangay_name ?? residenceBarangay,
            })
            : null;

          // A case re-sent inside a later batch keeps its original PASIG batch, so undoing
          // that original batch still removes it.
          const rowBatchId = uuidRegex.test(String(record.source_batch_id || '')) ? record.source_batch_id : batch_id;

          allValidRows.push([
            rowBatchId,
            record.barangay_id,
            record.date_of_diagnosis, record.date_of_screening, record.date_of_notification,
            record.age, record.sex, record.barangay_name, record.screening_facility,
            record.treatment_facility, record.source_of_patient, record.anatomical_site,
            record.registration_group, record.bacteriological_status, record.date_started_treatment,
            normalizeOutcome(record.outcome_status), record.date_of_outcome, record.validation_status,
            source_type, locationClassification,
            record.type, record.province, record.region,
            record.referred_to_dots, record.referral_status,
            record.microscopy_result, record.microscopy_release_date,
            record.rdt_result, record.rdt_release_date, record.outcome_reason,
            dstbFingerprint,
            record.current_responsible_facility_id ?? null,
            record.case_no || null, record.patient_no || null, record.source_case_id || null,
            isPasigResident ? null : residenceBarangay,
            isPasigResident ? null : residenceCity,
            record.source_outcome_status ?? record.outcome_status ?? null,
          ]);
          // NOT incremented here — this only means "passed validation".
          // The real insert count (importedCount, set below) reflects what
          // actually landed in the DB. Every validated row is inserted —
          // record-level duplicate detection never blocks an insert.
        } else {
          errorCount++;
          errors.push({ ...rejectionRef(record), row: record.row_number, source_type, errors: validation.errors });
        }
      }
    }

    // Columns of the INSERT below, in order. The SQL, the placeholder math, the
    // pre-update snapshot and the history diff are all derived from this list so
    // they cannot drift apart from what is actually written to tb_cases.
    const INSERT_COLUMNS = [
      'batch_id', 'barangay_id', 'date_of_diagnosis', 'date_of_screening', 'date_of_notification',
      'age', 'sex', 'barangay_name', 'screening_facility', 'treatment_facility',
      'source_of_patient', 'anatomical_site', 'registration_group', 'bacteriological_status',
      'date_started_treatment', 'outcome_status', 'date_of_outcome',
      'validation_status', 'source_type', 'location_classification',
      'type', 'province', 'region',
      'referred_to_dots', 'referral_status',
      'microscopy_result', 'microscopy_release_date',
      'rdt_result', 'rdt_release_date', 'outcome_reason',
      'dstb_fingerprint', 'current_responsible_facility_id',
      'case_no', 'patient_no', 'source_case_id',
      'residence_barangay_name', 'residence_city', 'source_outcome_status',
    ];
    const COL_INDEX = Object.fromEntries(INSERT_COLUMNS.map((name, idx) => [name, idx]));
    const COLS = INSERT_COLUMNS.length;
    const chunkSize = 100;
    let insertedCount = 0;
    let updatedCount = 0;
    let historyEntries = 0;
    const insertedDstbFingerprints = new Set();
    const missingCaseIds = [];
    const historyRows = [];
    for (let i = 0; i < allValidRows.length; i += chunkSize) {
      const chunk = allValidRows.slice(i, i + chunkSize);
      const placeholders = chunk.map((_, idx) => {
        const base = idx * COLS;
        return `(${Array.from({ length: COLS }, (_, c) => `$${base + c + 1}`).join(',')})`;
      }).join(', ');
      const flatParams = chunk.flat();

      // Snapshot the rows this chunk may UPDATE rather than insert, matched
      // strictly by the stable Case ID (case_no). Taken on the same transaction,
      // so the "before" values are exactly what is about to be overwritten.
      const chunkCaseNos = [...new Set(chunk.map(r => r[COL_INDEX.case_no]).filter(Boolean))];
      const beforeByCaseNo = new Map();
      if (chunkCaseNos.length > 0) {
        const snapshot = await client.query(HISTORY_SELECT_SQL, [chunkCaseNos]);
        for (const existing of snapshot.rows) beforeByCaseNo.set(existing.case_no, existing);
      }
      const chunkByCaseNo = new Map(
        chunk.filter(r => r[COL_INDEX.case_no]).map(r => [r[COL_INDEX.case_no], r])
      );
      // The values this chunk is about to write for a given Case ID.
      const incomingFor = (caseNo) => {
        const source = chunkByCaseNo.get(caseNo);
        if (!source) return null;
        return Object.fromEntries(HISTORY_FIELDS.map(field => [field, source[COL_INDEX[field]]]));
      };

      // case_no (PASIG's Case ID) is the only uniqueness key: a case sent again
      // updates its outcome/treatment fields in place instead of becoming a second
      // row. Rows without a case_no (and dstb_fingerprint, which is
      // NOT unique — see the doc comment above) are always inserted; they are
      // flagged MISSING_CASE_ID below because a resend of them cannot be matched,
      // and possible-duplicate detection runs as a separate, non-blocking pass.
      //
      // OUTCOMES COME ONLY FROM THE SENDER. outcome_status is assigned from
      // EXCLUDED (the payload) and nowhere else — never from a date, a duration,
      // or time elapsed since treatment started. A patient stays ON TREATMENT
      // until the source system reports a new outcome; TBInsight never decides a
      // case is CURED because enough days have passed.
      const result = await client.query(
        `INSERT INTO tb_cases (${INSERT_COLUMNS.join(', ')})
         VALUES ${placeholders}
        ON CONFLICT (case_no) WHERE case_no IS NOT NULL DO UPDATE SET
          barangay_id = EXCLUDED.barangay_id,
          barangay_name = EXCLUDED.barangay_name,
          residence_barangay_name = EXCLUDED.residence_barangay_name,
          residence_city = EXCLUDED.residence_city,
          location_classification = EXCLUDED.location_classification,
          outcome_status = EXCLUDED.outcome_status,
          source_outcome_status = COALESCE(EXCLUDED.source_outcome_status, tb_cases.source_outcome_status),
          date_of_outcome = EXCLUDED.date_of_outcome,
          date_started_treatment = EXCLUDED.date_started_treatment,
          treatment_facility = EXCLUDED.treatment_facility,
          -- the Case ID users see (PASIG); kept when a resend carries none
          source_case_id = COALESCE(EXCLUDED.source_case_id, tb_cases.source_case_id),
          updated_at = NOW()
        RETURNING id, case_no, patient_no, dstb_fingerprint, source_type, (xmax = 0) AS inserted`,
        flatParams
      );
      for (const row of result.rows) {
        const caseNo = row.case_no || null;
        const historyBase = {
          tbCaseId: row.id, caseNo, patientNo: row.patient_no ?? null,
          batchId: batch_id, source: 'webhook', changedByLabel: actorLabel,
        };
        if (row.inserted === false) {
          updatedCount++;
          const before = beforeByCaseNo.get(caseNo);
          const incoming = incomingFor(caseNo);
          if (before && incoming) {
            // Mirror the two COALESCE(...) assignments above: a resend that
            // carries no value keeps the stored one rather than clearing it.
            const effective = {
              ...incoming,
              source_outcome_status: incoming.source_outcome_status ?? before.source_outcome_status,
              source_case_id: incoming.source_case_id ?? before.source_case_id,
            };
            const diff = diffCaseFields(before, effective);
            if (diff) {
              historyRows.push({ ...historyBase, changeType: classifyChange(diff), changedFields: diff });
            }
          }
          continue;
        }
        insertedCount++;
        if (caseNo) {
          historyRows.push({ ...historyBase, changeType: 'created', changedFields: null });
        } else {
          // No Case ID: this row can never be matched on a resend.
          missingCaseIds.push(row.id);
        }
        if (row.dstb_fingerprint) insertedDstbFingerprints.add(row.dstb_fingerprint);
      }
    }
    importedCount = insertedCount;

    // Append-only case history, written on the same transaction as the case rows:
    // the previous values (ON TREATMENT) are preserved together with what produced
    // the change (source='webhook') and who asked for it (the sender's actor).
    // History can never be half-applied — it commits or rolls back with the data.
    historyEntries = await insertCaseHistory(client, historyRows);

    // A record with no Case ID cannot be matched when it is re-sent, so it is
    // always inserted — the one remaining way a resend could create a duplicate.
    // Never rejected, never merged, never deleted: flagged for human review only.
    if (missingCaseIds.length > 0) {
      await client.query(
        `UPDATE tb_cases
            SET duplicate_status = 'possible_duplicate', duplicate_flag_reason = 'MISSING_CASE_ID'
          WHERE id = ANY($1::bigint[])
            AND duplicate_flag_reason IS NULL`,
        [missingCaseIds]
      );
    }

    // Possible-duplicate detection (never rejection). For every fingerprint
    // touched by this batch, if MORE THAN ONE tb_cases row
    // now shares it (across this batch and/or earlier ones), flag every row
    // except the earliest as a possible duplicate. Never deletes, merges, or
    // blocks anything — every row keeps existing exactly as inserted; this
    // only sets a review flag and a reason.
    const flagged = await flagPossibleDuplicates(client, {
      dstbFingerprints: [...insertedDstbFingerprints],
    });
    const dstbCollisionsFlagged = flagged.dstb;
    const possibleDuplicatesFlagged = dstbCollisionsFlagged;

    await client.query('COMMIT');

    // Rebuild aggregations separately — data is already committed. Updated cases
    // (new outcomes) change the summaries just as much as new ones.
    if (importedCount > 0 || updatedCount > 0) {
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

    // Complete the claim taken at the start: the batch now counts as processed.
    // Only a summary of the payload is kept — the records themselves (case/patient
    // numbers included) already live in tb_cases_raw/tb_cases and were never read back
    // from here.
    try {
      await pool.query(
        `UPDATE webhook_logs
         SET payload = $2, status = 'processed', records_received = $3, records_imported = $4, processed_at = NOW()
         WHERE id = $1`,
        [claimId, JSON.stringify(summarizeWebhookPayload(req.body)), totalRecords, importedCount]
      );
      console.log(`✅ Webhook logged: batch ${batch_id}, ${importedCount} records imported`);
    } catch (logErr) {
      console.error('Failed to log webhook:', logErr.message);
    }

    res.json({
      success: true,
      message: `Webhook processed: ${importedCount} imported, ${updatedCount} existing cases updated, ${possibleDuplicatesFlagged} possible duplicates flagged, ${errorCount} errors`,
      totalRecords, importedCount, updatedCount, errorCount, historyEntries,
      possibleDuplicatesFlagged, dstbCollisionsFlagged,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      // Every rejected record with the sender's identifiers, so PASIG can mark each one
      // for fixing (`errors` above stays a 10-item sample for older senders).
      rejected: errors.length > 0 ? errors.slice(0, MAX_REJECTED_RETURNED) : undefined,
    });

    console.log(`✅ Webhook batch ${batch_id} completed successfully`);
    console.log(`   📊 Total: ${totalRecords}, Imported: ${importedCount}, Possible dup flagged: ${possibleDuplicatesFlagged} (DSTB: ${dstbCollisionsFlagged}), Errors: ${errorCount}`);
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
    
    // Mark the claimed batch as failed so the sender's retry can take it over.
    // Without a claim the failure happened before the batch was identified; log it
    // on its own row (batch_id NULL keeps it out of the per-batch unique index).
    try {
      const errorMessage = `${error.code || 'ERROR'}: ${error.message}`;
      if (claimId) {
        await pool.query(
          `UPDATE webhook_logs SET status = 'failed', error_message = $2 WHERE id = $1`,
          [claimId, errorMessage]
        );
      } else {
        await pool.query(
          `INSERT INTO webhook_logs (source, batch_id, status, error_message)
           VALUES ($1, NULL, 'failed', $2)`,
          [req.body?.source || 'unknown', errorMessage]
        );
      }
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
