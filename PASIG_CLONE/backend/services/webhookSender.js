const crypto = require('crypto');
const fetch = require('node-fetch');
const config = require('../config');
const db = require('../db/pasigSchema');
const { logAuditEvent } = require('../utils/auditLogger');
const { isPasigBarangay, isPasigCity } = require('./dataCleaner');

function signPayload(payload, secret) {
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return `sha256=${signature}`;
}

// DATE columns come back from pg as JS Dates at local midnight. JSON.stringify would turn
// them into UTC timestamps (e.g. 2025-01-05 in Manila -> "2025-01-04T16:00:00.000Z"),
// which TBInsight would store as the previous day. Send plain YYYY-MM-DD instead.
function toYmd(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function formatRecord(record) {
  return {
    barangay_id: record.barangay_id ?? null,
    barangay_name: record.barangay_name,
    date_of_diagnosis: toYmd(record.date_of_diagnosis),
    date_of_notification: toYmd(record.date_of_notification),
    date_of_screening: toYmd(record.date_of_screening),
    age: record.age,
    sex: record.sex,
    city: record.city,
    screening_facility: record.screening_facility,
    treatment_facility: record.treatment_facility,
    source_of_patient: record.source_of_patient,
    anatomical_site: record.anatomical_site,
    registration_group: record.registration_group,
    bacteriological_status: record.bacteriological_status,
    date_started_treatment: toYmd(record.date_started_treatment),
    outcome_status: record.outcome_status,
    date_of_outcome: toYmd(record.date_of_outcome),
    record_created_at: record.record_created_at,
    source_type: record.source_type,
    validation_status: record.validation_status,
    itis_case_id: record.itis_case_id,
    type: record.type ?? null,
    province: record.province ?? null,
    region: record.region ?? null,
    referred_to_dots: record.referred_to_dots ?? null,
    referral_status: record.referral_status ?? null,
    microscopy_result: record.microscopy_result ?? null,
    microscopy_release_date: toYmd(record.microscopy_release_date),
    rdt_result: record.rdt_result ?? null,
    rdt_release_date: toYmd(record.rdt_release_date),
    outcome_reason: record.outcome_reason ?? null,
    current_responsible_facility_id: record.current_responsible_facility_id ?? null,
    // Identity: IDs only. Names and date of birth are deliberately never sent.
    case_no: record.case_no ?? null,
    patient_no: record.patient_no ?? null,
    // The PASIG batch the case originally came from, so undoing that batch in
    // TBInsight removes it even when it was (re)sent inside a later batch.
    source_batch_id: record.batch_id ?? null,
  };
}

/**
 * Turn TBInsight's webhook reply into the counts shown to the user. TBInsight reports
 * what actually happened to each record (imported / updated an existing case / rejected),
 * which can differ from what was sent.
 */
function summarizeTbInsightResponse(responseBody, recordsSent, nonPasigCount = 0) {
  let body = null;
  try { body = JSON.parse(responseBody); } catch { /* non-JSON reply: counts unknown */ }

  const excludedNote = nonPasigCount > 0 ? ` ${nonPasigCount} non-Pasig record(s) were not sent.` : '';

  if (!body || typeof body.importedCount !== 'number') {
    // TBInsight answers without counts when the batch was already processed, or when an
    // earlier attempt (e.g. one this sender timed out on) is still importing it.
    const inProgress = body?.inProgress === true;
    const duplicate = !inProgress && /already processed/i.test(body?.message || '');
    let message;
    if (inProgress) message = 'TBInsight is still importing this batch from an earlier attempt. Check Sync History in a few minutes.';
    else if (duplicate) message = 'This batch was already synced to TBInsight earlier; nothing new was imported.';
    else message = `Sent ${recordsSent} record(s); TBInsight did not report how many it accepted.`;
    return {
      recordsAccepted: null,
      recordsImported: null,
      recordsUpdated: null,
      recordsRejected: null,
      rejectedSamples: [],
      alreadySynced: duplicate,
      inProgress,
      message: message + excludedNote,
    };
  }

  const recordsImported = body.importedCount;
  const recordsUpdated = body.updatedCount || 0;
  const recordsRejected = body.errorCount || 0;
  const parts = [`${recordsImported} imported`, `${recordsUpdated} updated`];
  if (recordsRejected > 0) parts.push(`${recordsRejected} rejected`);

  return {
    recordsAccepted: recordsImported + recordsUpdated,
    recordsImported,
    recordsUpdated,
    recordsRejected,
    rejectedSamples: Array.isArray(body.errors) ? body.errors : [],
    alreadySynced: false,
    inProgress: false,
    message: `Sent ${recordsSent} record(s) to TBInsight: ${parts.join(', ')}.${excludedNote}`,
  };
}

/**
 * Check if a record is from Pasig City
 */
function isPasigRecord(record) {
  // Records were cleaned before validation, so barangay names are already canonical.
  const barangay = String(record.barangay_name || '').trim().toLowerCase();
  if (!isPasigBarangay(barangay)) return false;
  const city = String(record.city || '').trim();
  return !city || isPasigCity(city);
}

/**
 * Send webhook to TBInsight with comprehensive sync tracking
 * @param {string} batchId - Batch ID to sync
 * @param {number} userId - ID of user initiating sync
 * @returns {Object} { success, status, message, recordsSent, recordsAccepted }
 */
async function sendWebhook(batchId, userId, { extraCaseNos = [] } = {}) {
  const client = await db.pool.connect();
  let markedSyncing = false;

  try {
    const batchResult = await db.getBatch(batchId);
    if (batchResult.rows.length === 0) {
      throw new Error('Batch not found');
    }

    const batch = batchResult.rows[0];
    if (batch.status !== 'validated') {
      throw new Error('Batch must be validated before sending');
    }

    const recordsResult = await db.getValidatedCases(batchId);

    const pendingMatches = recordsResult.rows.filter(r => r.match_status === 'pending').length;
    if (pendingMatches > 0) {
      throw new Error(
        `This batch has ${pendingMatches} possible patient match${pendingMatches === 1 ? '' : 'es'} to review first. ` +
        'Open Validation → Possible Matches.'
      );
    }

    // Records that are cases in their own right. A record confirmed as the "same case"
    // as an earlier one is not itself a case: its update was applied to that earlier
    // case, which is re-sent below and updated in TBInsight by its Case ID.
    const ownCases = recordsResult.rows.filter(r => !r.merged_into_case_no);
    const resendCaseNos = new Set([
      ...recordsResult.rows.map(r => r.merged_into_case_no).filter(Boolean),
      ...extraCaseNos,
    ]);
    for (const r of ownCases) resendCaseNos.delete(r.case_no);
    const resent = resendCaseNos.size > 0 ? (await db.getCasesByCaseNo([...resendCaseNos])).rows : [];
    const candidates = [...ownCases, ...resent];

    // Filter: only send Pasig City records to TBInsight
    const pasigOnly = candidates.filter(isPasigRecord);
    const nonPasigCount = candidates.length - pasigOnly.length;
    const pasigRecords = pasigOnly.filter(r => r.record_status !== 'duplicate');

    const dstbRecords = pasigRecords.filter(r => r.source_type === 'DSTB');
    const mnRecords = pasigRecords.filter(r => r.source_type === 'MN');
    const manualRecords = pasigRecords.filter(r => r.source_type === 'MANUAL');

    // entered_by_* provenance is Clone-only — formatRecord must never include it
    // (confirmed: formatRecord serializes the fixed field list below, not the row).
    const sheets = [
      {
        sheet_name: 'DSTB',
        source_type: 'DSTB',
        record_count: dstbRecords.length,
        records: dstbRecords.map(formatRecord),
      },
      {
        sheet_name: 'MN',
        source_type: 'MN',
        record_count: mnRecords.length,
        records: mnRecords.map(formatRecord),
      },
    ];
    if (manualRecords.length > 0) {
      sheets.push({
        sheet_name: 'MANUAL',
        source_type: 'MANUAL',
        record_count: manualRecords.length,
        records: manualRecords.map(formatRecord),
      });
    }

    const payload = {
      schema_version: '1.0',
      source: 'pasig-clone',
      batch_id: batchId,
      timestamp: new Date().toISOString(),
      sheets,
    };

    const recordsSent = dstbRecords.length + mnRecords.length + manualRecords.length;

    // ========== Mark sync as in-progress ==========
    await client.query('BEGIN');
    await client.query(
      `UPDATE import_batches
       SET sync_status = 'syncing', synced_by = $1, sync_started_at = NOW()
       WHERE id = $2`,
      [userId, batchId]
    );
    await client.query('COMMIT');
    markedSyncing = true;

    console.log(`🔄 Starting webhook sync for batch ${batchId}: ${recordsSent} Pasig records${nonPasigCount > 0 ? `, ${nonPasigCount} non-Pasig excluded` : ''}`);

    // ========== Send webhook with retries ==========
    const secret = config.webhook.secret;
    const signature = signPayload(payload, secret);
    const webhookUrl = config.webhook.url;

    const MAX_RETRIES = parseInt(process.env.WEBHOOK_MAX_RETRIES || '3');
    const TIMEOUT_MS = parseInt(process.env.WEBHOOK_TIMEOUT_MS || '60000');

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

        // The timeout covers reading the reply too, and is cleared even when the
        // request fails (otherwise the timer lingers for the full TIMEOUT_MS).
        let response;
        let responseBody;
        try {
          response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Signature': signature,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          responseBody = await response.text();
        } finally {
          clearTimeout(timeout);
        }

        // Log webhook attempt
        await db.logWebhook(batchId, payload, response.ok ? 'sent' : 'failed', response.status, responseBody, userId);

        if (response.ok) {
          const outcome = summarizeTbInsightResponse(responseBody, recordsSent, nonPasigCount);

          // ========== Mark sync as successful ==========
          // Rows TBInsight rejected don't fail the batch (the rest were imported), but the
          // note is kept so Sync History shows that some records did not make it.
          await client.query('BEGIN');
          await client.query(
            `UPDATE import_batches
             SET sync_status = 'synced', synced_at = NOW(), sync_error = $2
             WHERE id = $1`,
            [batchId, outcome.recordsRejected > 0 ? `${outcome.recordsRejected} record(s) rejected by TBInsight` : null]
          );
          await client.query('COMMIT');

          console.log(`✅ Webhook synced for batch ${batchId}: ${outcome.message}`);

          // Log audit event
          await logAuditEvent({
            userId,
            action: 'SYNC_BATCH',
            resourceType: 'import_batch',
            resourceId: batchId,
            result: 'SUCCESS',
            details: {
              recordsSent,
              recordsImported: outcome.recordsImported,
              recordsUpdated: outcome.recordsUpdated,
              recordsRejected: outcome.recordsRejected,
              status: response.status,
            },
          });

          return {
            success: true,
            status: response.status,
            recordsSent,
            nonPasigExcluded: nonPasigCount,
            ...outcome,
          };
        }

        // 4xx errors — don't retry (permanent failure)
        if (response.status >= 400 && response.status < 500) {
          const errorMsg = `Webhook failed with status ${response.status}: ${responseBody}`;
          
          await client.query('BEGIN');
          await client.query(
            `UPDATE import_batches
             SET sync_status = 'sync_failed', sync_error = $1
             WHERE id = $2`,
            [errorMsg.substring(0, 500), batchId]
          );
          await client.query('COMMIT');

          console.error(`❌ Webhook failed (client error) for batch ${batchId}: ${errorMsg}`);

          await logAuditEvent({
            userId,
            action: 'SYNC_BATCH',
            resourceType: 'import_batch',
            resourceId: batchId,
            result: 'FAILURE',
            details: { status: response.status, error: 'Client error' },
          });

          return {
            success: false,
            status: response.status,
            message: 'Webhook failed: Please check your configuration',
            recordsSent,
            recordsAccepted: 0,
          };
        }

        // 5xx errors — retry if attempts remain
        if (attempt < MAX_RETRIES) {
          console.log(`⚠️  Webhook retry ${attempt}/${MAX_RETRIES} after status ${response.status}`);
          await new Promise(r => setTimeout(r, 1000 * attempt)); // Exponential backoff
          continue;
        }

        const errorMsg = `Server error after ${MAX_RETRIES} retries`;
        await client.query('BEGIN');
        await client.query(
          `UPDATE import_batches
           SET sync_status = 'sync_failed', sync_error = $1
           WHERE id = $2`,
          [errorMsg, batchId]
        );
        await client.query('COMMIT');

        await logAuditEvent({
          userId,
          action: 'SYNC_BATCH',
          resourceType: 'import_batch',
          resourceId: batchId,
          result: 'FAILURE',
          details: { status: response.status, error: 'Server error (retries exhausted)' },
        });

        return {
          success: false,
          status: response.status,
          message: 'Webhook failed: Server error',
          recordsSent,
          recordsAccepted: 0,
        };
      } catch (error) {
        // Network/timeout errors — retry if attempts remain
        if (attempt < MAX_RETRIES) {
          console.log(`⚠️  Webhook retry ${attempt}/${MAX_RETRIES} after error: ${error.message}`);
          await new Promise(r => setTimeout(r, 1000 * attempt)); // Exponential backoff
          continue;
        }

        const errorMsg = `Network error: ${error.message}`;
        await db.logWebhookError(batchId, payload, errorMsg, userId);
        
        await client.query('BEGIN');
        await client.query(
          `UPDATE import_batches
           SET sync_status = 'sync_failed', sync_error = $1
           WHERE id = $2`,
          [errorMsg.substring(0, 500), batchId]
        );
        await client.query('COMMIT');

        console.error(`❌ Webhook failed (network error) for batch ${batchId}: ${errorMsg}`);

        await logAuditEvent({
          userId,
          action: 'SYNC_BATCH',
          resourceType: 'import_batch',
          resourceId: batchId,
          result: 'FAILURE',
          details: { error: 'Network error' },
        });

        return {
          success: false,
          status: 0,
          message: `Webhook failed: ${error.message}`,
          recordsSent,
          recordsAccepted: 0,
        };
      }
    }
  } catch (error) {
    console.error(`❌ Webhook error for batch ${batchId}:`, error);
    // An unexpected error after the batch was marked 'syncing' must not leave it there.
    // Uses the pool, not `client`, which may be stuck in an aborted transaction.
    if (markedSyncing) {
      try {
        await db.pool.query(
          `UPDATE import_batches SET sync_status = 'sync_failed', sync_error = $2
           WHERE id = $1 AND sync_status = 'syncing'`,
          [batchId, `Sync error: ${error.message}`.substring(0, 500)]
        );
      } catch (statusErr) {
        console.error(`Failed to mark batch ${batchId} as sync_failed:`, statusErr.message);
      }
    }
    await logAuditEvent({
      userId,
      action: 'SYNC_BATCH',
      resourceType: 'import_batch',
      resourceId: batchId,
      result: 'FAILURE',
      details: { error: error.message },
    });
    throw error;
  } finally {
    client.release();
  }
}

// A sync attempt takes at most a few minutes (WEBHOOK_MAX_RETRIES x WEBHOOK_TIMEOUT_MS plus
// backoff), so a batch still 'syncing' after this long was interrupted (server restart,
// crash) and will never finish on its own.
const STUCK_SYNC_MINUTES = 15;
const INTERRUPTED_SYNC_MESSAGE = 'Sync was interrupted before TBInsight confirmed it. Sync again to confirm.';

/**
 * Move batches stuck at 'syncing' to 'sync_failed' so they show up as failed and can be
 * re-synced. Re-syncing is safe: TBInsight answers "already processed" for a batch it
 * did receive. Batches marked 'syncing' before sync_started_at existed have no start
 * time and are recovered too.
 * @returns {Promise<string[]>} ids of the recovered batches
 */
async function recoverStuckSyncs(pool = db.pool, minutes = STUCK_SYNC_MINUTES) {
  const result = await pool.query(
    `UPDATE import_batches
     SET sync_status = 'sync_failed', sync_error = $2
     WHERE sync_status = 'syncing'
       AND (sync_started_at IS NULL OR sync_started_at < NOW() - make_interval(mins => $1))
     RETURNING id`,
    [minutes, INTERRUPTED_SYNC_MESSAGE]
  );
  const ids = result.rows.map(r => r.id);
  if (ids.length > 0) {
    console.warn(`⚠️  Recovered ${ids.length} interrupted sync(s): ${ids.join(', ')}`);
  }
  return ids;
}

module.exports = { sendWebhook, recoverStuckSyncs, STUCK_SYNC_MINUTES, signPayload, formatRecord, isPasigRecord, toYmd, summarizeTbInsightResponse };
