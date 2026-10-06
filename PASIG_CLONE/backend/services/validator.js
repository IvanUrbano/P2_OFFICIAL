const db = require('../db/pasigSchema');
const { cleanRecord, isBlankRecord, PASIG_BARANGAYS } = require('./dataCleaner');
const { planIdentities, formatPatientNo, formatCaseNo } = require('./patientIdentity');
const { assignCaseIds, normalizeCaseId } = require('./caseIds');

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
  // Source traceability (file row; MN ITIS Lite Case No.)
  'source_case_id',
  'source_outcome_status',
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
    r.source_case_id ?? null,
    r.source_outcome_status ?? null,
  ].map(v => (v === undefined ? null : v));
}

/**
 * Clean + validate every raw row of a batch and store the results.
 * Rows are cleaned first (dataCleaner), then validated; cleaning notes are kept as warnings.
 */
async function validateBatch(batchId) {
  const records = await db.getRawCases(batchId);
  // Name / date-of-birth rules follow the batch's identity class (historical by default).
  const batchClass = (await db.pool.query('SELECT identity_class FROM import_batches WHERE id = $1', [batchId])
    .catch(() => ({ rows: [] }))).rows[0]?.identity_class || 'historical';
  const identityRule = identityRuleFor(batchClass);
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
    Object.assign(cleaned, sourceRefs({
      batchId, sheetName: record.sheet_name, sourceType: record.source_type,
      rowNumber: record.row_number, fileCaseId: cleaned.file_case_id,
    }));

    const validation = validateRecord(cleaned, record.source_type, validBarangays, identityRule);
    const warnings = [...notes, ...validation.warnings];
    if (notes.some(n => n.includes('standardized'))) results.cleaned++;
    if (!isPasig) results.nonPasig++;

    results.validatedRecords.push({
      raw_id: record.id,
      ...cleaned,
      source_outcome_status: record.csv_data?.outcome_status == null ? null : String(record.csv_data.outcome_status),
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
            last_name, first_name, date_of_birth::text AS date_of_birth,
            source_type, itis_case_id, source_case_id
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

    // Case IDs for rows whose file did not carry one (next free number per facility /
    // type / year — never repeats across files or batches).
    await assignCaseIds(client, validRecords);

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

// ==================== Record validation ====================
// Separate rules per source (DSTB sheet, MN sheet, manual entry) on a shared core.
// Pure functions — no database access.
//
// Required case data for every record: Diagnosis Date, Sex and Age (from the file, or
// calculated from the date of birth when one is given). Barangay: a missing / unknown /
// non-Pasig location never rejects the row — it is listed under Validation -> Needs
// Assignment and is not counted as validated or synced until resolved.
//
// Patient name and date of birth (decided by the record's identity_class, migration 015):
//   historical DSTB / MN  — NOT required (de-identified registry files). When the file
//     does carry them they are kept and validated normally: the date of birth is only
//     checked when one is given; a partial name only produces a warning.
//   operational DSTB / MN — required (identifiable records, after client approval).
//   Manual entry          — always required.
// Callers pass identityRuleFor(identity_class); a missing class counts as historical,
// the same fail-closed default the privacy rules use.

const NAME_DOB_FIELDS = ['last_name', 'first_name', 'date_of_birth'];
const present = (v) => v !== null && v !== undefined && String(v).trim() !== '';
const text = (v) => (v === null || v === undefined ? '' : String(v));

function validateCore(rec, validBarangays, { requireIdentity = false, legacyMissingAge = false } = {}) {
  const errors = [];
  const warnings = [];

  const normalizedCity = text(rec.city).trim().toLowerCase();
  const isPasig = normalizedCity === 'pasig city' || normalizedCity === 'pasig';
  const barangay = text(rec.barangay_name).trim();
  if (!barangay) {
    warnings.push('No barangay — listed under Needs Assignment; not sent to TBInsight until a barangay is assigned');
  } else if (isPasig && !validBarangays.has(barangay.toLowerCase())) {
    warnings.push(`Unknown barangay "${rec.barangay_name}" — listed under Needs Assignment; not sent to TBInsight until corrected`);
  } else if (!isPasig) {
    warnings.push(`Non-Pasig record: city="${rec.city ?? ''}", barangay="${rec.barangay_name}" — will not be sent to TBInsight`);
  }

  if (requireIdentity) {
    if (!present(rec.last_name)) errors.push('Last name is required');
    if (!present(rec.first_name)) errors.push('First name is required');
    if (!rec.date_of_birth) errors.push('Date of birth is required');
  } else {
    const given = NAME_DOB_FIELDS.filter(f => present(rec[f]));
    if (given.length > 0 && given.length < NAME_DOB_FIELDS.length) {
      warnings.push('Incomplete patient name / date of birth — not used to find returning patients');
    }
  }
  if (rec.date_of_birth && rec.date_of_diagnosis && rec.date_of_birth > rec.date_of_diagnosis) {
    errors.push('Date of birth cannot be after the date of diagnosis');
  }

  if (!rec.date_of_diagnosis) errors.push('Date of Diagnosis is required');

  const sex = text(rec.sex).trim();
  if (!sex) errors.push('Sex is required');
  else if (!VALID_SEX.includes(sex.toLowerCase())) errors.push(`Invalid sex: "${rec.sex}"`);

  if (!present(rec.age)) {
    // Records saved before Age was required may lack it: editing them must still work.
    if (legacyMissingAge) warnings.push('Age is missing');
    else errors.push('Age is required');
  } else {
    const age = Number(rec.age);
    if (!Number.isInteger(age) || age < 0 || age > 120) errors.push(`Invalid age: "${rec.age}"`);
  }

  return { errors, warnings };
}

/** DSTB sheet: no patient name or source Case ID required (the system Case ID is generated). */
function validateDSTB(rec, validBarangays, opts = {}) {
  const r = validateCore(rec, validBarangays, opts);
  if (rec.validation_status && !text(rec.validation_status).toLowerCase().includes('validated')) {
    r.warnings.push(`Unknown validation status: "${rec.validation_status}"`);
  }
  return r;
}

/** MN sheet: no patient name required. Its Case ID comes from the file or is generated
 *  (services/caseIds.js); the ITIS Lite Case No. is no longer needed. */
function validateMN(rec, validBarangays, opts = {}) {
  return validateCore(rec, validBarangays, opts);
}

/** Manual entry: name and date of birth are always required (cannot be switched off). */
function validateManual(rec, validBarangays, opts = {}) {
  return validateCore(rec, validBarangays, { ...opts, requireIdentity: true });
}

/** Validation options for a record's identity class (historical | operational). */
function identityRuleFor(identityClass) {
  return { requireIdentity: identityClass === 'operational' };
}

/**
 * Validate one (already cleaned) record with the rules of its source.
 * @param opts { requireIdentity?, legacyMissingAge? }
 */
function validateRecord(csvData, sourceType, validBarangays, opts = {}) {
  const fn = sourceType === 'DSTB' ? validateDSTB : sourceType === 'MN' ? validateMN : validateManual;
  const { errors, warnings } = fn(csvData, validBarangays, opts);
  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Source traceability for an imported row (never changes existing records):
 *   source_record_id — the file row it came from: "<batch id>:<sheet>:R<row>"
 *   source_case_id   — the Case ID from the file's "Case ID" column (DSTB and MN); when the
 *                      file has none it is generated at validation (services/caseIds.js)
 */
function sourceRefs({ batchId, sheetName, sourceType, rowNumber, fileCaseId }) {
  return {
    source_record_id: batchId && rowNumber != null ? `${batchId}:${sheetName || sourceType}:R${rowNumber}` : null,
    source_case_id: normalizeCaseId(fileCaseId),
  };
}

// ==================== Stored data-issue errors ====================
// validation_issues.errors is written when a batch is validated. When the rules change
// (e.g. historical rows no longer need a name / date of birth) the stored text goes
// stale, so it is re-checked against the current rules — when issues are listed and
// once at startup — instead of showing errors that no longer apply.

/** Errors an open issue has under the CURRENT rules. */
function currentIssueErrors(issue, validBarangays) {
  return validateRecord(issue.record || {}, issue.source_type, validBarangays, identityRuleFor(issue.identity_class)).errors;
}

/**
 * Rewrite stored errors of open issues that no longer match the current rules.
 * Only the errors column changes; issues whose batch was deleted are left alone
 * (they are hidden from every list). Returns { checked, updated }.
 */
async function refreshOpenIssueErrors() {
  const validBarangays = await getValidBarangays();
  const { rows } = await db.pool.query(
    `SELECT i.id, i.source_type, i.record, i.errors, i.identity_class
     FROM validation_issues i
     WHERE i.status = 'open' AND EXISTS (SELECT 1 FROM import_batches b WHERE b.id = i.batch_id)`
  );
  let updated = 0;
  for (const issue of rows) {
    const current = currentIssueErrors(issue, validBarangays);
    if (JSON.stringify(current) !== JSON.stringify(issue.errors || [])) {
      await db.pool.query('UPDATE validation_issues SET errors = $2 WHERE id = $1', [issue.id, JSON.stringify(current)]);
      updated++;
    }
  }
  return { checked: rows.length, updated };
}

module.exports = {
  validateBatch,
  validateRecord,
  validateDSTB,
  validateMN,
  validateManual,
  identityRuleFor,
  currentIssueErrors,
  refreshOpenIssueErrors,
  sourceRefs,
  getValidBarangays,
  INSERT_COLUMNS,
  rowValues,
};
