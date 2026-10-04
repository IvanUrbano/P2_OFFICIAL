const db = require('../db/pasigSchema');
const { cleanRecord, isBlankRecord, PASIG_BARANGAYS } = require('./dataCleaner');
const { planIdentities, formatPatientNo, formatCaseNo } = require('./patientIdentity');

const VALID_SEX = ['male', 'female'];

async function getValidBarangays() {
  // The 30 official (PSGC) barangays of Pasig City, lower-cased for comparison.
  return new Set(PASIG_BARANGAYS.map(n => n.toLowerCase()));
}

// Columns written to validated_tb_cases (order matches the value list below).
const INSERT_COLUMNS = [
  'batch_id', 'source_type', 'barangay_name', 'date_of_diagnosis', 'date_of_notification',
  'age', 'sex', 'city', 'screening_facility', 'treatment_facility', 'source_of_patient',
  'anatomical_site', 'registration_group', 'bacteriological_status', 'date_started_treatment',
  'outcome_status', 'date_of_outcome', 'record_created_at', 'date_of_screening',
  'validation_status', 'itis_case_id', 'is_valid', 'validation_errors', 'validation_warnings',
  'source_record_id', 'record_status', 'updated_by',
  // MN-specific fields (previously dropped before reaching TBInsight)
  'type', 'province', 'region', 'referred_to_dots', 'referral_status',
  'microscopy_result', 'microscopy_release_date', 'rdt_result', 'rdt_release_date', 'outcome_reason',
  // Identity (names/DOB stay in PASIG only)
  'last_name', 'first_name', 'middle_name', 'suffix', 'date_of_birth',
  'patient_id', 'case_no', 'match_status', 'match_candidate_case_no', 'match_suggestion',
];

async function insertPatients(client, patientNos, batchId) {
  const idByPatientNo = new Map();
  const chunkSize = 500;
  for (let i = 0; i < patientNos.length; i += chunkSize) {
    const chunk = patientNos.slice(i, i + chunkSize);
    const placeholders = chunk.map((_, k) => `($${k + 1}, $${chunk.length + 1})`).join(', ');
    const res = await client.query(
      `INSERT INTO patients (patient_no, created_by_batch_id) VALUES ${placeholders} RETURNING id, patient_no`,
      [...chunk, batchId]
    );
    for (const row of res.rows) idByPatientNo.set(row.patient_no, row.id);
  }
  return idByPatientNo;
}

/**
 * Re-validating replaces a batch's records and their Case IDs, so it is refused once
 * the batch has been synced (TBInsight already holds those Case IDs) or once another
 * record has been matched or merged against one of its cases.
 */
async function assertCanRevalidate(batchId) {
  const batch = await db.pool.query('SELECT sync_status FROM import_batches WHERE id = $1', [batchId]);
  if (batch.rows[0]?.sync_status === 'synced') {
    throw Object.assign(new Error('This batch was already synced to TBInsight and cannot be re-validated.'), { status: 409 });
  }
  const refs = await db.pool.query(
    `SELECT COUNT(*)::int AS n FROM validated_tb_cases o
     WHERE o.batch_id <> $1
       AND (o.match_candidate_case_no IN (SELECT case_no FROM validated_tb_cases WHERE batch_id = $1 AND case_no IS NOT NULL)
         OR o.merged_into_case_no IN (SELECT case_no FROM validated_tb_cases WHERE batch_id = $1 AND case_no IS NOT NULL))`,
    [batchId]
  );
  if (refs.rows[0].n > 0) {
    throw Object.assign(
      new Error(`Records in other batches were matched to this batch's cases (${refs.rows[0].n}); it cannot be re-validated.`),
      { status: 409 }
    );
  }
  // Data issues already corrected or excluded on the Validation page would be lost.
  const worked = await db.pool.query(
    `SELECT COUNT(*)::int AS n FROM validation_issues WHERE batch_id = $1 AND status <> 'open'`,
    [batchId]
  ).catch(() => ({ rows: [{ n: 0 }] })); // before migration 007
  if (worked.rows[0].n > 0) {
    throw Object.assign(
      new Error(`${worked.rows[0].n} data issue(s) in this batch were already corrected or excluded; it cannot be re-validated.`),
      { status: 409 }
    );
  }
}

function rowValues(batchId, r) {
  return [
    batchId, r.source_type, r.barangay_name, r.date_of_diagnosis, r.date_of_notification,
    r.age, r.sex, r.city, r.screening_facility, r.treatment_facility, r.source_of_patient,
    r.anatomical_site, r.registration_group, r.bacteriological_status, r.date_started_treatment,
    r.outcome_status, r.date_of_outcome, r.record_created_at || null, r.date_of_screening,
    r.validation_status, r.itis_case_id, r.is_valid, JSON.stringify(r.errors),
    JSON.stringify(r.warnings),
    r.source_record_id || null, r.record_status || 'new', null,
    r.type ?? null, r.province ?? null, r.region ?? null, r.referred_to_dots ?? null, r.referral_status ?? null,
    r.microscopy_result ?? null, r.microscopy_release_date ?? null, r.rdt_result ?? null,
    r.rdt_release_date ?? null, r.outcome_reason ?? null,
    r.last_name ?? null, r.first_name ?? null, r.middle_name ?? null, r.suffix ?? null, r.date_of_birth ?? null,
    r.patient_id ?? null, r.case_no ?? null, r.match_status || 'none',
    r.match_candidate_case_no ?? null, r.match_suggestion ?? null,
  ].map(v => (v === undefined ? null : v));
}

/**
 * Clean + validate every raw row of a batch and store the results.
 * Rows are cleaned first (dataCleaner), then validated; cleaning notes are kept as warnings.
 */
async function validateBatch(batchId) {
  const records = await db.getRawCases(batchId);
  const validBarangays = await getValidBarangays();

  const results = {
    total: records.rows.length,
    valid: 0,
    invalid: 0,
    warnings: 0,
    cleaned: 0,
    skippedBlank: 0,
    nonPasig: 0,
    errors: [],
    validatedRecords: [],
  };

  for (const record of records.rows) {
    const { record: cleaned, notes, isPasig } = cleanRecord(record.csv_data || {});

    if (isBlankRecord(cleaned)) {
      results.skippedBlank++;
      continue;
    }

    const validation = validateRecord(cleaned, record.source_type, validBarangays);
    const warnings = [...notes, ...validation.warnings];
    if (notes.some(n => n.includes('standardized'))) results.cleaned++;
    if (!isPasig) results.nonPasig++;

    results.validatedRecords.push({
      raw_id: record.id,
      ...cleaned,
      source_type: record.source_type,
      row_number: record.row_number,
      is_valid: validation.valid,
      errors: validation.errors,
      warnings,
    });

    if (validation.valid) {
      results.valid++;
    } else {
      results.invalid++;
      results.errors.push({
        row: record.row_number,
        source_type: record.source_type,
        errors: validation.errors,
      });
    }

    if (warnings.length > 0) results.warnings++;
  }

  const validRecords = results.validatedRecords.filter(r => r.is_valid);
  const invalidRecords = results.validatedRecords.filter(r => !r.is_valid);

  await assertCanRevalidate(batchId);

  // Patient # / Case ID: compare against every existing case outside this batch.
  const existing = await db.pool.query(
    `SELECT case_no, date_of_diagnosis::text AS date_of_diagnosis,
            last_name, first_name, date_of_birth::text AS date_of_birth
     FROM validated_tb_cases
     WHERE case_no IS NOT NULL AND is_archived = false AND batch_id <> $1`,
    [batchId]
  );
  const plan = planIdentities(validRecords, existing.rows);
  const newIdx = plan.map((p, i) => (p.kind === 'new' ? i : -1)).filter(i => i >= 0);
  let possibleMatches = 0;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotency: re-validating a batch replaces its previous results (and the
    // patients it created, unless another record now belongs to them)
    await client.query('DELETE FROM validated_tb_cases WHERE batch_id = $1', [batchId]);
    await client.query(
      `DELETE FROM patients p WHERE p.created_by_batch_id = $1
       AND NOT EXISTS (SELECT 1 FROM validated_tb_cases v WHERE v.patient_id = p.id)`,
      [batchId]
    );

    // Rows that failed validation are kept as open Data Issues (Validation page) so they
    // can be corrected or excluded, instead of being dropped. Only open issues exist
    // here: assertCanRevalidate refuses once any were corrected/excluded.
    await client.query(`DELETE FROM validation_issues WHERE batch_id = $1`, [batchId]);
    for (let i = 0; i < invalidRecords.length; i += 200) {
      const chunk = invalidRecords.slice(i, i + 200);
      await client.query(
        `INSERT INTO validation_issues
           (batch_id, raw_case_id, row_number, source_type, record, errors, warnings, barangay_name)
         SELECT $1, x.raw_id, x.row_number, x.source_type, x.record, x.errors, x.warnings, x.barangay_name
         FROM jsonb_to_recordset($2::jsonb) AS x(raw_id bigint, row_number int, source_type text,
              record jsonb, errors jsonb, warnings jsonb, barangay_name text)`,
        [batchId, JSON.stringify(chunk.map(r => {
          const { raw_id, row_number, source_type, is_valid, errors, warnings, ...record } = r;
          return { raw_id, row_number, source_type, record, errors, warnings, barangay_name: record.barangay_name || null };
        }))]
      );
    }

    if (newIdx.length > 0) {
      const patientSeqs = await client.query(
        `SELECT nextval('patient_no_seq')::bigint AS n FROM generate_series(1, $1)`, [newIdx.length]
      );
      const caseSeqs = await client.query(
        `SELECT nextval('case_no_seq')::bigint AS n FROM generate_series(1, $1)`, [newIdx.length]
      );
      const patientNos = patientSeqs.rows.map(r => formatPatientNo(r.n));
      const idByPatientNo = await insertPatients(client, patientNos, batchId);
      newIdx.forEach((rowIdx, k) => {
        const r = validRecords[rowIdx];
        r.patient_id = idByPatientNo.get(patientNos[k]);
        r.case_no = formatCaseNo(caseSeqs.rows[k].n, r.date_of_diagnosis);
        r.match_status = 'none';
        r.record_status = 'new';
      });
    }

    plan.forEach((p, i) => {
      if (p.kind !== 'pending') return;
      const r = validRecords[i];
      r.match_status = 'pending';
      r.match_candidate_case_no = p.candidate.case_no ?? validRecords[p.candidate.rowIndex].case_no;
      r.match_suggestion = p.suggestion;
      r.record_status = 'new';
      possibleMatches++;
    });

    const COLS = INSERT_COLUMNS.length;
    const chunkSize = 100;
    for (let i = 0; i < validRecords.length; i += chunkSize) {
      const chunk = validRecords.slice(i, i + chunkSize);
      const placeholders = chunk.map((_, idx) => {
        const base = idx * COLS;
        return `(${Array.from({ length: COLS }, (_, c) => `$${base + c + 1}`).join(',')})`;
      }).join(', ');
      const flatParams = chunk.flatMap(r => rowValues(batchId, r));
      await client.query(
        `INSERT INTO validated_tb_cases (${INSERT_COLUMNS.join(', ')}) VALUES ${placeholders}`,
        flatParams
      );
    }

    await client.query(
      `UPDATE import_batches
       SET status = 'validated', valid_count = $1, error_count = $2, validated_at = NOW()
       WHERE id = $3`,
      [results.valid, results.invalid, batchId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  results.possibleMatches = possibleMatches;
  results.summary = {
    total: validRecords.length,
    new: newIdx.length,
    possibleMatches,
    error: results.invalid,
    cleaned: results.cleaned,
    nonPasig: results.nonPasig,
    skippedBlank: results.skippedBlank,
  };

  return results;
}

/**
 * Validate one (already cleaned) record. Pure function — no database access.
 */
function validateRecord(csvData, sourceType, validBarangays) {
  const errors = [];
  const warnings = [];

  const str = v => (v === null || v === undefined ? '' : String(v));
  const normalizedCity = str(csvData.city).trim().toLowerCase();
  const isPasig = normalizedCity === 'pasig city' || normalizedCity === 'pasig';
  const barangay = str(csvData.barangay_name).trim();

  // A missing or unrecognized barangay no longer rejects the record: it is kept,
  // listed under Needs Assignment for an admin to fix, and not sent to TBInsight
  // until it has a Pasig barangay.
  if (!barangay) {
    warnings.push('No barangay — listed under Needs Assignment; not sent to TBInsight until a barangay is assigned');
  } else if (isPasig && !validBarangays.has(barangay.toLowerCase())) {
    warnings.push(`Unknown barangay "${csvData.barangay_name}" — listed under Needs Assignment; not sent to TBInsight until corrected`);
  } else if (!isPasig) {
    // Non-Pasig records: kept but not sent to TBInsight
    warnings.push(`Non-Pasig record: city="${csvData.city ?? ''}", barangay="${csvData.barangay_name}" — will not be sent to TBInsight`);
  }

  if (!str(csvData.last_name).trim()) errors.push('Last name is required');
  if (!str(csvData.first_name).trim()) errors.push('First name is required');
  if (!csvData.date_of_birth) {
    errors.push('Date of birth is required');
  } else if (csvData.date_of_diagnosis && csvData.date_of_birth > csvData.date_of_diagnosis) {
    errors.push('Date of birth cannot be after the date of diagnosis');
  }

  if (!csvData.date_of_diagnosis) {
    errors.push('Date of Diagnosis is required');
  }

  const sex = str(csvData.sex).trim();
  if (!sex) {
    errors.push('Sex is required');
  } else if (!VALID_SEX.includes(sex.toLowerCase())) {
    errors.push(`Invalid sex: "${csvData.sex}"`);
  }

  if (csvData.age !== null && csvData.age !== undefined && csvData.age !== '') {
    const age = Number(csvData.age);
    if (!Number.isInteger(age) || age < 0 || age > 120) {
      errors.push(`Invalid age: "${csvData.age}"`);
    }
  }

  if (sourceType === 'DSTB' && csvData.validation_status) {
    const status = str(csvData.validation_status).toLowerCase();
    if (!status.includes('validated')) {
      warnings.push(`Unknown validation status: "${csvData.validation_status}"`);
    }
  }

  if (sourceType === 'MN' && !str(csvData.itis_case_id).trim()) {
    warnings.push('MN record missing ITIS Case ID');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

module.exports = {
  validateBatch,
  validateRecord,
  getValidBarangays,
  INSERT_COLUMNS,
  rowValues,
};
