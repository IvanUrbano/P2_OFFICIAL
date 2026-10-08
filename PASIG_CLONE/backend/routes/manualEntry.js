const express = require('express');
const router = express.Router();
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { validateRecord, getValidBarangays } = require('../services/validator');
const { cleanRecord, isPasigBarangay } = require('../services/dataCleaner');
const { logAuditEvent } = require('../utils/auditLogger');
const { startBackgroundSync, SYNC_STARTED } = require('../services/backgroundSync');
const { resolveMatch, createPatient, nextCaseNo, RESOLUTIONS } = require('../services/matchResolution');
const { normalizeCaseId } = require('../services/caseIds');
const { resolveUserScope } = require('../policies/caseAccessPolicy');
const { ACTIONS, can, assertCaseAction } = require('../policies/permissions');


function ymd(v) {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return v ? String(v).slice(0, 10) : null;
}

// ==================== MANUAL TB RECORD ENTRY ====================
// Creates one validated record (source_type='MANUAL') inside its own batch, then
// auto-syncs it to TBInsight. entered_by_* attribution stays Clone-only and is
// never included in the webhook payload.
router.post('/manual-entry', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const b = req.body || {};
    const manualErrors = [];

    // Normalize first (names, dates, sex, city, barangay canonicalization, outcome).
    // Age is always calculated from date of birth + date of diagnosis, never typed.
    const { record: cleaned, notes } = cleanRecord({ ...b, age: null });
    // The Case ID is typed by the user (from DSTB/MN) — never generated. It identifies the
    // TB case/episode, not the person: a returning patient gets a new Case ID per episode.
    cleaned.source_case_id = normalizeCaseId(b.source_case_id);

    // Manual entry is Pasig-only — the barangay must exist regardless of city
    const bgy = String(cleaned.barangay_name || '').trim();
    if (!bgy) {
      manualErrors.push('Barangay is required');
    } else if (!isPasigBarangay(bgy)) {
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

    // The Case ID already exists: this episode is already recorded. Do not create it again —
    // point to the existing case (edit it there). No "new episode" / "different person" choice.
    const existing = cleaned.source_case_id ? (await db.pool.query(
      `SELECT case_no, source_case_id, date_of_diagnosis FROM validated_tb_cases
       WHERE upper(source_case_id) = upper($1) AND is_archived = false AND merged_into_case_no IS NULL
       LIMIT 1`,
      [cleaned.source_case_id]
    )).rows[0] : null;
    if (existing) {
      return res.status(409).json({
        code: 'DUPLICATE_CASE_ID',
        error: `Case ID ${existing.source_case_id} is already recorded. Find it in TB Records and edit it there instead of adding it again.`,
        existingCase: {
          case_id: existing.source_case_id,
          date_of_diagnosis: existing.date_of_diagnosis ? ymd(existing.date_of_diagnosis) : null,
        },
      });
    }

    // Possible returning patient: same Last + First name + date of birth as an existing case
    // that carries a DIFFERENT Case ID (this entry is then a new episode of that patient).
    const candidate = (await db.pool.query(
      `SELECT v.*, p.patient_no FROM validated_tb_cases v
       LEFT JOIN patients p ON p.id = v.patient_id
       WHERE v.case_no IS NOT NULL AND v.is_archived = false
         AND lower(v.last_name) = lower($1) AND lower(v.first_name) = lower($2) AND v.date_of_birth = $3
       ORDER BY v.date_of_diagnosis DESC NULLS LAST LIMIT 1`,
      [cleaned.last_name, cleaned.first_name, cleaned.date_of_birth]
    )).rows[0] || null;

    const resolution = candidate ? b.match_resolution : null;
    // A different Case ID means a different episode, so "same case" is only possible when the
    // existing case has no Case ID yet (older record) that this entry can fill in.
    const sameCaseAllowed = Boolean(candidate && !candidate.source_case_id);
    if (candidate && resolution === 'same_case' && !sameCaseAllowed) {
      return res.status(400).json({ errors: [`The existing case already has Case ID ${candidate.source_case_id}; ${cleaned.source_case_id} is a different episode. Choose "New episode" or "Different person".`] });
    }
    // "Same case" updates the existing case — refuse up front if it is view-only for (or not
    // assigned to) this user, instead of only hiding the option in the UI.
    const scopeForMatch = candidate ? await resolveUserScope(req.user) : null;
    if (candidate && resolution === 'same_case') {
      try {
        assertCaseAction(req.user, scopeForMatch, ACTIONS.CASE_EDIT, candidate);
      } catch (err) {
        return res.status(err.status || 403).json({ error: `${err.message} Choose "New episode" or "Different person", or ask that barangay to update it.`, code: err.code });
      }
    }
    if (candidate && !RESOLUTIONS.includes(resolution)) {
      // Ask the user to decide. Details beyond the IDs are only shown when the
      // existing case is within this user's barangay access.
      // Name shown only if the existing case is in this user's scope AND names are unlocked
      // Historical (de-identified) cases never show their name.
      const visible = can(req.user, await resolveUserScope(req.user), ACTIONS.CASE_VIEW, candidate)
        && require('../services/pinService').isUnlocked(req)
        && require('../services/pinService').namesAllowed(candidate);
      return res.status(409).json({
        possibleMatch: {
          case_id: candidate.source_case_id || null,
          has_case_id: Boolean(candidate.source_case_id),
          new_case_id: cleaned.source_case_id,
          date_of_diagnosis: candidate.date_of_diagnosis ? ymd(candidate.date_of_diagnosis) : null,
          suggestion: 'new_episode',
          // "Same case" would update the existing case — offered only if it is editable here
          // and has no Case ID of its own yet.
          canUpdateExisting: sameCaseAllowed && can(req.user, scopeForMatch, ACTIONS.CASE_EDIT, candidate),
          ...(visible ? {
            name: [candidate.last_name, candidate.first_name, candidate.middle_name].filter(Boolean).join(', '),
            barangay_name: candidate.barangay_name,
            outcome_status: candidate.outcome_status,
            treatment_facility: candidate.treatment_facility,
          } : {}),
        },
      });
    }

    // Attribution: the entering user's own assigned facility (staff), NULL for admins
    const userRes = await db.authPool.query('SELECT facility_id FROM users WHERE id = $1', [req.user.id]);
    const enteredByFacilityId = userRes.rows[0]?.facility_id ?? null;

    const client = await db.pool.connect();
    let batchId;
    let recordId;
    let identity;
    try {
      await client.query('BEGIN');

      const batchRes = await client.query(
        `INSERT INTO import_batches
           (filename, uploaded_by, total_rows, dstb_count, mn_count, valid_count, error_count,
            status, validated_by, validated_at, created_at, identity_class)
         VALUES ($1, $2, 1, 0, 0, 1, 0, 'validated', $2, NOW(), NOW(), $3)
         RETURNING id`,
        [`Manual Entry — ${req.user.username}`, req.user.id, require('../services/pinService').identityClassForNewBatch()]
      );
      batchId = batchRes.rows[0].id;

      let newIdentity = null;
      if (!candidate) {
        const patient = await createPatient(client, batchId);
        newIdentity = { patientId: patient.id, caseNo: await nextCaseNo(client, cleaned.date_of_diagnosis) };
      }

      const recRes = await client.query(
        `INSERT INTO validated_tb_cases (
          batch_id, source_type, barangay_name, date_of_diagnosis, date_of_notification,
          age, sex, city, screening_facility, treatment_facility, source_of_patient,
          anatomical_site, registration_group, bacteriological_status, date_started_treatment,
          outcome_status, date_of_outcome, date_of_screening, validation_status,
          is_valid, validation_errors, validation_warnings, record_status,
          entered_by_user_id, entered_by_facility_id, current_responsible_facility_id,
          last_name, first_name, middle_name, suffix, date_of_birth,
          patient_id, case_no, match_status, match_candidate_case_no, source_case_id
        ) VALUES ($1,'MANUAL',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                  true,$19,$20,'new',$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
        RETURNING *`,
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
          JSON.stringify([...notes, ...validation.warnings]),
          JSON.stringify([]),
          req.user.id,
          enteredByFacilityId,
          enteredByFacilityId, // current_responsible_facility_id = entering user's facility
          cleaned.last_name, cleaned.first_name, cleaned.middle_name || null, cleaned.suffix || null,
          cleaned.date_of_birth,
          newIdentity ? newIdentity.patientId : null,
          newIdentity ? newIdentity.caseNo : null,
          candidate ? 'pending' : 'none',
          candidate ? candidate.case_no : null,
          cleaned.source_case_id,
        ]
      );
      recordId = recRes.rows[0].id;

      // A returning patient: apply the user's decision in the same transaction
      identity = candidate
        ? await resolveMatch(client, recRes.rows[0], resolution, req.user.id, {
          authorizeExistingCase: (existing) => assertCaseAction(req.user, scopeForMatch, ACTIONS.CASE_EDIT, existing),
        })
        : { resolution: null, caseNo: newIdentity.caseNo };

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
        caseNo: identity.caseNo,
        matchResolution: identity.resolution,
      },
    });

    // Auto-sync after commit, in the background so saving never waits on TBInsight.
    // A sync failure never rolls back the saved record; the batch ends up
    // sync_status='sync_failed' (with a notification) and can be retried from the Sync page.
    startBackgroundSync(batchId, req.user);
    const sync = SYNC_STARTED;

    const what = identity.resolution === 'same_case'
      ? `Existing case ${cleaned.source_case_id} updated`
      : `TB record created (Case ID ${cleaned.source_case_id})`;
    res.status(201).json({
      message: `${what}.`,
      batch_id: batchId,
      record_id: recordId,
      case_no: identity.caseNo,
      match_resolution: identity.resolution,
      sync,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === '23505' && /source_case_id/i.test(`${error.constraint || ''} ${error.detail || ''}`)) {
      return res.status(409).json({ code: 'DUPLICATE_CASE_ID', error: 'That Case ID was just recorded by someone else. Find it in TB Records instead of adding it again.' });
    }
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
