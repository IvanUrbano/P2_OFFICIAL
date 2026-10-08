/**
 * Patient # / Case ID identity rules (pure functions — no database access).
 *
 *   Patient # (PT-000123)        one person
 *   Case ID   (ROS-D-2025-00042) one TB episode, carried by the file's "Case ID" column;
 *                                a relapse gets a new Case ID under the same Patient #
 *   case_no   (CS-2025-000456)   this registry's own key for that case
 *
 * The Case ID identifies the case, so a row whose Case ID points at a case that
 * already exists joins it — unless the two rows contradict each other about the
 * patient or the diagnosis date, which is a decision for a person. Everything else
 * (a name + date of birth match) is only ever a "possible match": a person confirms
 * it before anything is merged.
 */

function pad6(n) {
  return String(n).padStart(6, '0');
}

function formatPatientNo(seq) {
  return `PT-${pad6(seq)}`;
}

function formatCaseNo(seq, dateOfDiagnosis) {
  const year = String(dateOfDiagnosis || '').slice(0, 4) || '0000';
  return `CS-${year}-${pad6(seq)}`;
}

/**
 * Completed years from date of birth to date of diagnosis (both 'YYYY-MM-DD').
 * Returns null when either date is missing or the birth date is after diagnosis.
 */
function computeAge(dateOfBirth, dateOfDiagnosis) {
  const parse = (s) => {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  };
  const b = parse(dateOfBirth);
  const dx = parse(dateOfDiagnosis);
  if (!b || !dx) return null;
  let age = dx.y - b.y;
  if (dx.m < b.m || (dx.m === b.m && dx.d < b.d)) age -= 1;
  return age < 0 ? null : age;
}

function normName(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Matching key, or null when any part is missing. */
function identityKey(r) {
  const last = normName(r.last_name);
  const first = normName(r.first_name);
  const dob = String(r.date_of_birth || '').slice(0, 10);
  if (!last || !first || !dob) return null;
  return `${last}|${first}|${dob}`;
}

/**
 * Case ID matching key (DSTB and MN): the Case ID carried by the file
 * (services/caseIds.js). Records are NEVER matched on barangay + date + sex + age (too
 * many different people share those).
 */
function sourceCaseKey(r) {
  const v = String(r.source_case_id ?? '').replace(/\s+/g, '').toLowerCase();
  return v ? `case-id|${v}` : null;
}

/**
 * Split a single "Name" column. Only the registry style "LAST, FIRST MIDDLE"
 * is split; anything without a comma is left alone (and will fail the
 * required-name check rather than being guessed at).
 */
function splitFullName(full) {
  const s = String(full ?? '').replace(/\s+/g, ' ').trim();
  const comma = s.indexOf(',');
  if (comma < 0) return null;
  const last = s.slice(0, comma).trim();
  const rest = s.slice(comma + 1).trim().split(' ').filter(Boolean);
  if (!last || rest.length === 0) return null;
  return {
    last_name: last,
    first_name: rest.length > 1 ? rest.slice(0, -1).join(' ') : rest[0],
    middle_name: rest.length > 1 ? rest[rest.length - 1] : null,
  };
}

function day(v) {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return v ? String(v).slice(0, 10) : null;
}

function suggestionFor(rowDx, candidateDx) {
  return day(rowDx) && day(rowDx) === day(candidateDx) ? 'same_case' : 'new_episode';
}

/**
 * May these two rows be the same case? Asked when a Case ID is what tied them
 * together:
 *   - both patients identified -> they must be the same person (a re-import is
 *     allowed to correct the diagnosis date, so the date is not decisive here);
 *   - otherwise the diagnosis date is the only thing the rows can be compared on.
 * Two identified patients who differ can never be the same case, even when their
 * diagnosis dates happen to match.
 */
function identityCompatible(row, candidate) {
  const a = identityKey(row);
  const b = identityKey(candidate);
  if (a && b) return a === b;
  const dx = day(row?.date_of_diagnosis);
  return Boolean(dx && dx === day(candidate?.date_of_diagnosis));
}

function matchedByKey(key) {
  if (key && key.startsWith('case-id|')) return 'case_id';
  return 'identity';
}

/** Both rows name a patient, and not the same one. */
function patientDiffers(row, candidate) {
  const a = identityKey(row);
  const b = identityKey(candidate);
  return Boolean(a && b && a !== b);
}

/**
 * What the record's match is offered as. A Case ID match is the case itself — the
 * file's Case ID is what identifies the case — unless the two rows contradict each
 * other, where the only safe offers are the ones that start a separate case.
 */
function suggestionForMatch(row, candidate, { matchedBy, conflict } = {}) {
  const meta = matchedBy === undefined ? matchIdentity(row, candidate) : { matchedBy, conflict };
  if (meta.matchedBy === 'case_id' && !meta.conflict) return 'same_case';
  if (meta.conflict && patientDiffers(row, candidate)) return 'different_person';
  return suggestionFor(row.date_of_diagnosis, candidate?.date_of_diagnosis);
}

/**
 * How an incoming row and the case it was matched to were tied together:
 * 'case_id' (the file's Case ID) or 'identity' (name + date of birth). conflict = the Case ID points at this case
 * while the patient / diagnosis date say otherwise, so a person must decide.
 *
 * @returns {{ matchedBy: 'case_id'|'identity'|null, conflict: boolean }}
 */
function matchIdentity(row, candidate) {
  if (!candidate) return { matchedBy: null, conflict: false };
  const byCase = sourceCaseKey(row);
  if (byCase && byCase === sourceCaseKey(candidate)) {
    return { matchedBy: 'case_id', conflict: !identityCompatible(row, candidate) };
  }
  return { matchedBy: 'identity', conflict: false };
}

/**
 * The patient this row describes belongs to some OTHER case than the one its Case ID
 * points at (the matched case may not carry a name at all). Nobody with this patient
 * seen yet is not a contradiction — there is nothing to contradict.
 */
function identityContradicts(row, matchedEntry, byKey) {
  const key = identityKey(row);
  if (!key || !byKey.has(key)) return false;
  const target = matchedEntry.ref.case_no ?? null;
  return !byKey.get(key).some((e) => (e.ref.case_no ?? null) === target);
}

/**
 * Decide, for each row (in file order), whether it becomes a new case or a
 * possible match. Rows earlier in the same file count as existing cases for
 * rows after them, so a person listed twice in one file is caught too.
 *
 * @param rows           records with last_name, first_name, date_of_birth, date_of_diagnosis
 * @param existingCases  [{ case_no, date_of_diagnosis, last_name, first_name, date_of_birth }]
 * @returns array aligned with rows:
 *   { kind: 'new', matchedBy: null, conflict: false }
 *   { kind: 'pending', candidate: { case_no } | { rowIndex }, suggestion, matchedBy, conflict }
 */
function planIdentities(rows, existingCases) {
  const byKey = new Map();
  const add = (key, entry) => {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(entry);
  };
  // Keys: the Case ID the file carries FIRST (it is the case's identity: a row whose
  // Case ID points at an existing case joins that case), then name + date of birth,
  // Keys of a row are only registered once it has found no match, so a row never matches itself.
  const keysOf = (r) => [sourceCaseKey(r), identityKey(r)].filter(Boolean);
  for (const c of existingCases) {
    for (const key of keysOf(c)) add(key, { ref: { case_no: c.case_no }, dx: c.date_of_diagnosis, rec: c });
  }

  return rows.map((row, rowIndex) => {
    const keys = keysOf(row);
    const key = keys.find(k => byKey.has(k));
    const matches = key ? byKey.get(key) : null;
    if (matches && matches.length > 0) {
      const latest = matches.reduce((a, b) => (String(b.dx || '') > String(a.dx || '') ? b : a));
      const matchedBy = matchedByKey(key);
      const conflict = matchedBy === 'case_id'
        && (!identityCompatible(row, latest.rec) || identityContradicts(row, latest, byKey));
      return {
        kind: 'pending',
        candidate: latest.ref,
        suggestion: suggestionForMatch(row, latest.rec, { matchedBy, conflict }),
        matchedBy,
        conflict,
      };
    }
    for (const k of keys) add(k, { ref: { rowIndex }, dx: row.date_of_diagnosis, rec: row });
    return { kind: 'new', matchedBy: null, conflict: false };
  });
}

module.exports = {
  formatPatientNo,
  formatCaseNo,
  computeAge,
  splitFullName,
  identityKey,
  identityCompatible,
  sourceCaseKey,
  matchIdentity,
  suggestionForMatch,
  planIdentities,
};
