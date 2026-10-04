/**
 * Patient # / Case ID identity rules (pure functions — no database access).
 *
 *   Patient # (PT-000123)       one person
 *   Case ID   (CS-2025-000456)  one TB episode; a relapse gets a new Case ID
 *                               under the same Patient #
 *
 * A record is treated as a returning patient when Last name + First name +
 * date of birth match an existing case. That is only ever a "possible match":
 * a person confirms it before anything is merged.
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

function suggestionFor(rowDx, candidateDx) {
  return String(rowDx || '').slice(0, 10) === String(candidateDx || '').slice(0, 10)
    ? 'same_case'
    : 'new_episode';
}

/**
 * Decide, for each row (in file order), whether it becomes a new case or a
 * possible match. Rows earlier in the same file count as existing cases for
 * rows after them, so a person listed twice in one file is caught too.
 *
 * @param rows           records with last_name, first_name, date_of_birth, date_of_diagnosis
 * @param existingCases  [{ case_no, date_of_diagnosis, last_name, first_name, date_of_birth }]
 * @returns array aligned with rows:
 *   { kind: 'new' }
 *   { kind: 'pending', candidate: { case_no } | { rowIndex }, suggestion }
 */
function planIdentities(rows, existingCases) {
  const byKey = new Map();
  const add = (key, entry) => {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(entry);
  };
  for (const c of existingCases) {
    const key = identityKey(c);
    if (key) add(key, { ref: { case_no: c.case_no }, dx: c.date_of_diagnosis });
  }

  return rows.map((row, rowIndex) => {
    const key = identityKey(row);
    const matches = key ? byKey.get(key) : null;
    if (matches && matches.length > 0) {
      const latest = matches.reduce((a, b) => (String(b.dx || '') > String(a.dx || '') ? b : a));
      return {
        kind: 'pending',
        candidate: latest.ref,
        suggestion: suggestionFor(row.date_of_diagnosis, latest.dx),
      };
    }
    if (key) add(key, { ref: { rowIndex }, dx: row.date_of_diagnosis });
    return { kind: 'new' };
  });
}

module.exports = {
  formatPatientNo,
  formatCaseNo,
  computeAge,
  identityKey,
  splitFullName,
  planIdentities,
};
