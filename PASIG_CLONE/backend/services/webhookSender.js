const crypto = require('crypto');
const fetch = require('node-fetch');
const config = require('../config');
const db = require('../db/pasigSchema');

function signPayload(payload, secret) {
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return `sha256=${signature}`;
}

function formatRecord(record) {
  return {
    barangay_name: record.barangay_name,
    date_of_diagnosis: record.date_of_diagnosis,
    date_of_notification: record.date_of_notification,
    date_of_screening: record.date_of_screening,
    age: record.age,
    sex: record.sex,
    city: record.city,
    screening_facility: record.screening_facility,
    treatment_facility: record.treatment_facility,
    source_of_patient: record.source_of_patient,
    anatomical_site: record.anatomical_site,
    registration_group: record.registration_group,
    bacteriological_status: record.bacteriological_status,
    date_started_treatment: record.date_started_treatment,
    outcome_status: record.outcome_status,
    date_of_outcome: record.date_of_outcome,
    record_created_at: record.record_created_at,
    source_type: record.source_type,
    validation_status: record.validation_status,
    itis_case_id: record.itis_case_id,
  };
}

async function sendWebhook(batchId) {
  const batchResult = await db.getBatch(batchId);
  if (batchResult.rows.length === 0) {
    throw new Error('Batch not found');
  }

  const batch = batchResult.rows[0];
  if (batch.status !== 'validated') {
    throw new Error('Batch must be validated before sending');
  }

  const recordsResult = await db.getValidatedCases(batchId);

  const dstbRecords = recordsResult.rows.filter(r => r.source_type === 'DSTB');
  const mnRecords = recordsResult.rows.filter(r => r.source_type === 'MN');

  const payload = {
    schema_version: '1.0',
    source: 'pasig-clone',
    batch_id: batchId,
    timestamp: new Date().toISOString(),
    sheets: [
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
    ],
  };

  const secret = config.webhook.secret;
  const signature = signPayload(payload, secret);
  const webhookUrl = config.webhook.url;

  const MAX_RETRIES = parseInt(process.env.WEBHOOK_MAX_RETRIES || '3');
  const TIMEOUT_MS = parseInt(process.env.WEBHOOK_TIMEOUT_MS || '60000');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const responseBody = await response.text();

      await db.logWebhook(batchId, payload, response.ok ? 'sent' : 'failed', response.status, responseBody);

      if (response.ok) {
        await db.updateBatchSent(batchId);
        return { success: true, status: response.status, message: 'Webhook sent successfully' };
      }

      // 4xx errors — don't retry (permanent failure)
      if (response.status >= 400 && response.status < 500) {
        return { success: false, status: response.status, message: 'Webhook failed (client error)' };
      }

      // 5xx errors — retry if attempts remain
      if (attempt < MAX_RETRIES) {
        console.log(`Webhook retry ${attempt}/${MAX_RETRIES} after ${response.status}`);
        continue;
      }

      return { success: false, status: response.status, message: 'Webhook failed after retries' };
    } catch (error) {
      // Network/timeout errors — retry if attempts remain
      if (attempt < MAX_RETRIES) {
        console.log(`Webhook retry ${attempt}/${MAX_RETRIES} after error: ${error.message}`);
        continue;
      }

      await db.logWebhookError(batchId, payload, error.message);
      return { success: false, status: 0, message: `Webhook failed: ${error.message}` };
    }
  }
}

module.exports = { sendWebhook, signPayload, formatRecord };
