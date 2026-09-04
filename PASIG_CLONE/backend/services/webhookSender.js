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

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': secret,
        'X-Webhook-Signature': signature,
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await response.text();

    await db.logWebhook(batchId, payload, response.ok ? 'sent' : 'failed', response.status, responseBody);
    await db.updateBatchSent(batchId);

    return {
      success: response.ok,
      status: response.status,
      message: response.ok ? 'Webhook sent successfully' : 'Webhook failed',
    };
  } catch (error) {
    await db.logWebhookError(batchId, payload, error.message);
    throw error;
  }
}

module.exports = { sendWebhook, signPayload, formatRecord };
