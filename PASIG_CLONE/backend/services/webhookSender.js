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

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function sendWebhook(payload, secret) {
  const signature = signPayload(payload, secret);

  const res = await fetch(config.webhook.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Pasig-Signature': signature,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  return { status: res.status, body: text };
}

async function sendPendingCases() {
  const result = await db.getPendingCases();
  const cases = result.rows;

  if (cases.length === 0) {
    return { sent: 0, message: 'No pending cases' };
  }

  const chunks = chunkArray(cases, 500);
  let totalSent = 0;
  const results = [];

  for (const chunk of chunks) {
    const payload = {
      source: 'pasig_clone',
      timestamp: new Date().toISOString(),
      total_cases: chunk.length,
      cases: chunk.map(c => ({
        id: c.id,
        dataset: c.dataset,
        patient_no: c.patient_no,
        date_reported: c.date_reported,
        facility_name: c.facility_name,
        barangay: c.barangay,
        case_classification: c.case_classification,
        treatment_regimen: c.treatment_regimen,
        patient_type: c.patient_type,
        date_treatment_started: c.date_treatment_started,
        outcome: c.outcome,
        outcome_date: c.outcome_date,
        sex: c.sex,
        age: c.age,
        registration_date: c.registration_date,
        itis_case_id: c.itis_case_id,
        first_name: c.first_name,
        middle_name: c.middle_name,
        last_name: c.last_name,
        age_group: c.age_group,
        indigenous_group: c.indigenous_group,
        contact_name: c.contact_name,
        contact_relationship: c.contact_relationship,
        validation_status: c.validation_status,
      })),
    };

    try {
      const result = await sendWebhook(payload, config.webhook.secret);
      results.push(result);

      if (result.status >= 200 && result.status < 300) {
        const caseIds = chunk.map(c => c.id);
        await db.markWebhookSent(caseIds);
        totalSent += chunk.length;
      }

      await db.logWebhook(payload, result.status, result.body);
    } catch (err) {
      results.push({ status: 0, body: err.message });
      await db.logWebhook(payload, 0, err.message);
    }
  }

  return {
    sent: totalSent,
    total: cases.length,
    chunks: chunks.length,
    results,
  };
}

module.exports = { sendPendingCases, sendWebhook, signPayload };
