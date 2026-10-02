/**
 * Applying a person's decision on a possible patient match.
 *
 *   same_case        the record is a later report of the matched case: its outcome /
 *                    treatment fields update that case (blank values never erase
 *                    existing ones). The record itself does not become a case.
 *   new_episode      same patient, new TB episode: new Case ID, existing Patient #.
 *   different_person new Patient # and new Case ID.
 *
 * Never automatic — only called from an explicit user action.
 */
const { formatPatientNo, formatCaseNo } = require('./patientIdentity');

const UPDATE_FIELDS = ['outcome_status', 'date_of_outcome', 'date_started_treatment', 'treatment_facility'];
const RESOLUTIONS = ['same_case', 'new_episode', 'different_person'];

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
 * @returns { resolution, caseNo }  caseNo = the case this record now belongs to
 */
async function resolveMatch(client, row, resolution, userId) {
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

  const resolvedCols = `match_status = 'resolved', match_resolution = $2, match_resolved_by = $3, match_resolved_at = NOW()`;

  if (resolution === 'same_case') {
    const sets = UPDATE_FIELDS.map((f, i) => `${f} = COALESCE($${i + 2}, ${f})`).join(', ');
    await client.query(
      `UPDATE validated_tb_cases SET ${sets}, updated_by = $${UPDATE_FIELDS.length + 2}, updated_at = NOW() WHERE id = $1`,
      [cand.id, ...UPDATE_FIELDS.map(f => (f.startsWith('date_') ? ymd(row[f]) : row[f] ?? null)), userId]
    );
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
  return { resolution, caseNo };
}

module.exports = { resolveMatch, createPatient, nextCaseNo, RESOLUTIONS, UPDATE_FIELDS };
