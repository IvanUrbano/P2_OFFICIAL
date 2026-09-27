const express = require('express');
const router = express.Router();
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { validateRecord, getValidBarangays } = require('../services/validator');
const { cleanRecord, PASIG_BARANGAYS } = require('../services/dataCleaner');
const { logAuditEvent } = require('../utils/auditLogger');
const { sendWebhook } = require('../services/webhookSender');

const PASIG_BARANGAY_SET = new Set(PASIG_BARANGAYS.map(n => n.toLowerCase()));

// ==================== MANUAL TB RECORD ENTRY ====================
// Creates one validated record (source_type='MANUAL') inside its own batch, then
// auto-syncs it to TBInsight. entered_by_* attribution stays Clone-only and is
// never included in the webhook payload.
router.post('/manual-entry', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const b = req.body || {};
    const manualErrors = [];

    // Manual-specific: age is required (validateRecord treats age as optional 0–120)
    if (b.age === null || b.age === undefined || String(b.age).trim() === '') {
      manualErrors.push('Age is required');
    }

    // Normalize first (dates, sex, age, city, barangay canonicalization, outcome)
    const { record: cleaned, notes } = cleanRecord({ ...b });

    // Manual entry is Pasig-only — the barangay must exist regardless of city
    const bgy = String(cleaned.barangay_name || '').trim();
    if (!bgy) {
      manualErrors.push('Barangay is required');
    } else if (!PASIG_BARANGAY_SET.has(bgy.toLowerCase())) {
      manualErrors.push(`Unknown barangay: "${bgy}"`);
    }

    // Shared validation rules (diagnosis required, sex valid, age range, …)
    const validBarangays = await getValidBarangays();
    const validation = validateRecord(cleaned, 'MANUAL', validBarangays);

    // Outcome-date rules (outcome-only): outcome cannot be dated before
    // diagnosis or before treatment start
    const outcomeDate = cleaned.date_of_outcome || null;
    if (outcomeDate) {
      if (cleaned.date_of_diagnosis && outcomeDate < cleaned.date_of_diagnosis) {
        manualErrors.push('Date of Outcome cannot be earlier than Date of Diagnosis');
      }
      if (cleaned.date_started_treatment && outcomeDate < cleaned.date_started_treatment) {
        manualErrors.push('Date of Outcome cannot be earlier than Date Started Treatment');
      }
    }

    const allErrors = [...new Set([...manualErrors, ...validation.errors])];
    if (allErrors.length > 0) {
      return res.status(400).json({ errors: allErrors, warnings: [...notes, ...validation.warnings] });
    }

    // Attribution: the entering user's own assigned facility (staff), NULL for admins
    const userRes = await db.authPool.query('SELECT facility_id FROM users WHERE id = $1', [req.user.id]);
    const enteredByFacilityId = userRes.rows[0]?.facility_id ?? null;

    const client = await db.pool.connect();
    let batchId;
    let recordId;
    try {
      await client.query('BEGIN');

      const batchRes = await client.query(
        `INSERT INTO import_batches
           (filename, uploaded_by, total_rows, dstb_count, mn_count, valid_count, error_count,
            status, validated_by, validated_at, created_at)
         VALUES ($1, $2, 1, 0, 0, 1, 0, 'validated', $2, NOW(), NOW())
         RETURNING id`,
        [`Manual Entry — ${req.user.username}`, req.user.id]
      );
      batchId = batchRes.rows[0].id;

      const recRes = await client.query(
        `INSERT INTO validated_tb_cases (
          batch_id, source_type, barangay_name, date_of_diagnosis, date_of_notification,
          age, sex, city, screening_facility, treatment_facility, source_of_patient,
          anatomical_site, registration_group, bacteriological_status, date_started_treatment,
          outcome_status, date_of_outcome, date_of_screening, validation_status, itis_case_id,
          is_valid, validation_errors, validation_warnings, record_status,
          entered_by_user_id, entered_by_facility_id
        ) VALUES ($1,'MANUAL',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                  true,$20,$21,'new',$22,$23)
        RETURNING id`,
        [
          batchId,
          cleaned.barangay_name,
          cleaned.date_of_diagnosis || null,
          cleaned.date_of_notification || null,
          cleaned.age,
          cleaned.sex || null,
          cleaned.city || 'Pasig City',
          cleaned.screening_facility || null,
          cleaned.treatment_facility || null,
          cleaned.source_of_patient || null,
          cleaned.anatomical_site || null,
          cleaned.registration_group || null,
          cleaned.bacteriological_status || null,
          cleaned.date_started_treatment || null,
          cleaned.outcome_status || null,
          cleaned.date_of_outcome || null,
          cleaned.date_of_screening || null,
          cleaned.validation_status || 'Validated',
          cleaned.itis_case_id || null,
          JSON.stringify([...notes, ...validation.warnings]),
          JSON.stringify([]),
          req.user.id,
          enteredByFacilityId,
        ]
      );
      recordId = recRes.rows[0].id;

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }

    // Manual-entry audit log (Clone-only provenance)
    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'MANUAL_ENTRY',
      resourceType: 'validated_tb_cases',
      resourceId: recordId,
      result: 'SUCCESS',
      ipAddress: req.ip || null,
      details: {
        batchId,
        barangay: cleaned.barangay_name,
        dateOfDiagnosis: cleaned.date_of_diagnosis || null,
        screeningFacility: cleaned.screening_facility || null,
        treatmentFacility: cleaned.treatment_facility || null,
        enteredByFacilityId,
      },
    });

    // Auto-sync after commit — a sync failure never rolls back the saved record;
    // the batch stays sync_status='sync_failed' and can be retried from the Sync page.
    let sync = { status: 'pending', message: null };
    try {
      const result = await sendWebhook(batchId, req.user.id);
      sync = result.success
        ? { status: 'synced', message: result.message, recordsSent: result.recordsSent }
        : { status: 'failed', message: result.message };
    } catch (syncErr) {
      console.error('Manual entry auto-sync failed:', syncErr.message);
      sync = { status: 'failed', message: syncErr.message };
    }

    res.status(201).json({
      message: sync.status === 'synced'
        ? 'TB record created and synced to TBInsight.'
        : 'TB record created.',
      batch_id: batchId,
      record_id: recordId,
      sync,
    });
  } catch (error) {
    console.error('Manual entry error:', error);
    res.status(500).json({ error: 'Failed to create TB record.' });
  }
});

// ==================== MANUAL ENTRY DROPDOWN OPTIONS ====================
// Distinct values already present in the Clone's records (same normalized
// vocabulary TBInsight receives). Frontend falls back to static lists when empty.
router.get('/manual-options', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const [regRes, srcRes, anatRes, bactRes] = await Promise.all([
      db.pool.query(`SELECT DISTINCT TRIM(registration_group) AS v FROM validated_tb_cases
                     WHERE registration_group IS NOT NULL AND TRIM(registration_group) != '' AND is_archived = false
                     ORDER BY 1`),
      db.pool.query(`SELECT DISTINCT TRIM(source_of_patient) AS v FROM validated_tb_cases
                     WHERE source_of_patient IS NOT NULL AND TRIM(source_of_patient) != '' AND is_archived = false
                     ORDER BY 1`),
      db.pool.query(`SELECT DISTINCT TRIM(anatomical_site) AS v FROM validated_tb_cases
                     WHERE anatomical_site IS NOT NULL AND TRIM(anatomical_site) != '' AND is_archived = false
                     ORDER BY 1`),
      db.pool.query(`SELECT DISTINCT TRIM(bacteriological_status) AS v FROM validated_tb_cases
                     WHERE bacteriological_status IS NOT NULL AND TRIM(bacteriological_status) != '' AND is_archived = false
                     ORDER BY 1`),
    ]);
    res.json({
      registration_group: regRes.rows.map(r => r.v),
      source_of_patient: srcRes.rows.map(r => r.v),
      anatomical_site: anatRes.rows.map(r => r.v),
      bacteriological_status: bactRes.rows.map(r => r.v),
    });
  } catch (error) {
    console.error('Manual options error:', error);
    res.status(500).json({ error: 'Failed to load form options.' });
  }
});

module.exports = router;
