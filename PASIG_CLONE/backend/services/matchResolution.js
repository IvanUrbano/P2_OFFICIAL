/**
 * Applying a person's decision on a possible patient match.
 *
 *   same_case        the record is a later report of the matched case: its clinical
 *                    fields update that case (blank values never erase existing ones).
 *                    The record itself does not become a case.
 *   new_episode      same patient, new TB episode: new Case ID, existing Patient #.
 *   different_person new Patient # and new Case ID.
 *
 * Normally called from an explicit user action — except when the file's own Case ID
 * says two rows are the same case (services/validator.js), which resolves itself.
 */
const { formatPatientNo, formatCaseNo } = require('./patientIdentity');
const { normalizeCaseId } = require('./caseIds');
const { recordNewEpisode, LIVE_EPISODE } = require('./episodes');

// Every clinical value a later report of the same case may correct. Location is absent
// on purpose: a barangay change goes through Validation -> Needs Assignment, which also
// re-points barangay_id. Patient identity (names, date of birth) is absent too — the
// file does not carry it for de-identified records, and migration 015 protects it.
const UPDATE_FIELDS = [
  'date_of_diagnosis', 'date_of_notification', 'date_of_screening',
  'age', 'sex',
  'date_started_treatment', 'outcome_status', 'date_of_outcome', 'outcome_reason',
  'treatment_facility', 'screening_facility',
  'source_of_patient', 'anatomical_site', 'registration_group', 'bacteriological_status',
  'type', 'province', 'region', 'referred_to_dots', 'referral_status',
  'microscopy_result', 'microscopy_release_date', 'rdt_result', 'rdt_release_date',
  'source_outcome_status',
];
const RESOLUTIONS = ['same_case', 'new_episode', 'different_person'];

const upper = (v) => (v == null ? null : String(v).toUpperCase());

async function nextCaseNo(client, dateOfDiagnosis) {
  const r = await client.query(`SELECT nextval('case_no_seq')::bigint AS n`);
  return formatCaseNo(r.rows[0].n, dateOfDiagnosis);
}

async function createPatient(client, batchId) {
  const seq = await client.query(`SELECT nextval('patient_no_seq')::bigint AS n`);
  const ins = await client.query(
    `INSERT INTO patients (patient_no, created_by_batch_id) VALUES ($1, $2) RETURNING id, patient_no`,
    [formatPatientNo(seq.rows[0].n), batchId]
  );
  return ins.rows[0];
}

function ymd(v) {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return v ? String(v).slice(0, 10) : null;
}

/**
 * @param client  pg client inside an open transaction
 * @param row     the pending validated_tb_cases row
 * @param options.source  case_history source for a new episode ('review' or 'manual')
 * @param options.authorizeExistingCase  called with the existing case before "same case"
 *        writes onto it; must throw (with .status) if the user may not edit that case.
 *        Required: "same case" changes a DIFFERENT case than the one being resolved.
 * @returns { resolution, caseNo }  caseNo = the case this record now belongs to
 */
async function resolveMatch(client, row, resolution, userId, { authorizeExistingCase, source = 'review' } = {}) {
  if (!RESOLUTIONS.includes(resolution)) {
    throw Object.assign(new Error('Choose: same case, new episode, or different person.'), { status: 400 });
  }
  if (row.match_status !== 'pending') {
    throw Object.assign(new Error('This record has no pending match.'), { status: 409 });
  }

  const cand = row.match_candidate_case_no
    ? (await client.query('SELECT * FROM validated_tb_cases WHERE case_no = $1 FOR UPDATE', [row.match_candidate_case_no])).rows[0]
    : null;
  if (!cand && resolution !== 'different_person') {
    throw Object.assign(
      new Error('The matched case no longer exists (its batch may have been deleted). Choose "Different person".'),
      { status: 409 }
    );
  }
  // Guard: if the resolution is not "same case" and the Case ID already belongs
  // to this case, refuse – a person must decide which resolution is correct.
  if (resolution !== 'same_case' && cand && cand.source_case_id) {
    if (upper(cand.source_case_id) === upper(row.source_case_id)) {
      throw Object.assign(new Error('This case already carries the Case ID ' + row.source_case_id + '. Choose a different resolution.'), { status: 409 });
    }
  }

  const resolvedCols = `match_status = 'resolved', match_resolution = $2, match_resolved_by = $3, match_resolved_at = NOW()`;

  if (resolution === 'same_case') {
    if (typeof authorizeExistingCase !== 'function') {
      throw new Error('resolveMatch: authorizeExistingCase is required for "same case".');
    }
    authorizeExistingCase(cand);
    const sets = UPDATE_FIELDS.map((f, i) => `${f} = COALESCE($${i + 2}, ${f})`).join(', ');
    await client.query(
      `UPDATE validated_tb_cases SET ${sets}, updated_by = $${UPDATE_FIELDS.length + 2}, updated_at = NOW() WHERE id = $1`,
      [cand.id, ...UPDATE_FIELDS.map(f => (f.startsWith('date_') ? ymd(row[f]) : row[f] ?? null)), userId]
    );
    // The Case ID identifies the case: one that already has it is never given another.
    // It is only filled in when the case still has none (a batch from before Case IDs
    // were required), and only when no other live case carries it (migration 019).
    const wanted = normalizeCaseId(row.source_case_id);
    if (wanted && !cand.source_case_id) {
      await client.query(
        `UPDATE validated_tb_cases SET source_case_id = $2
          WHERE id = $1 AND source_case_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM validated_tb_cases o
                             WHERE o.id <> $1 AND upper(o.source_case_id) = upper($2)
                               AND o.is_archived = false AND o.merged_into_case_no IS NULL)`,
        [cand.id, wanted]
      );
    }
    await client.query(
      `UPDATE validated_tb_cases SET ${resolvedCols}, merged_into_case_no = $4, patient_id = $5, record_status = 'updated'
       WHERE id = $1`,
      [row.id, resolution, userId, cand.case_no, cand.patient_id]
    );
    return { resolution, caseNo: cand.case_no };
  }

  let patientId;
  if (resolution === 'new_episode') {
    patientId = cand.patient_id;
  } else {
    patientId = (await createPatient(client, row.batch_id)).id;
  }
  const caseNo = await nextCaseNo(client, ymd(row.date_of_diagnosis));
  await client.query(
    `UPDATE validated_tb_cases SET ${resolvedCols}, patient_id = $4, case_no = $5 WHERE id = $1`,
    [row.id, resolution, userId, patientId, caseNo]
  );
  if (resolution === 'new_episode') {
    // Case History on both sides: the new case names its previous episode, and every
    // earlier episode of this patient names the new case.
    const earlier = await client.query(
      `SELECT id, case_no, source_case_id, patient_id, batch_id, date_of_diagnosis, outcome_status, date_of_outcome
         FROM validated_tb_cases v
        WHERE v.patient_id = $1 AND v.id <> $2 AND ${LIVE_EPISODE('v')}`,
      [patientId, row.id]
    );
    await recordNewEpisode(client, {
      newCase: { id: row.id, case_no: caseNo, source_case_id: row.source_case_id, patient_id: patientId,
        batch_id: row.batch_id, date_of_diagnosis: row.date_of_diagnosis },
      earlierCases: earlier.rows, userId, source,
    });
  }
  return { resolution, caseNo };
}

module.exports = { resolveMatch, createPatient, nextCaseNo, RESOLUTIONS, UPDATE_FIELDS };
