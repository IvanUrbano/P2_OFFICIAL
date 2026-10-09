/**
 * Validation work queue — what puts a record in each Validation tab.
 *
 *   READY             no unresolved issue: not a pending match, location resolved, facility
 *                     names mapped (or blank)
 *   POSSIBLE MATCHES  match_status = 'pending' — sub-classified (categorizeMatch):
 *                     duplicate / case update / changed outcome / possible new episode
 *   NEEDS ASSIGNMENT  location (no / unknown / non-Pasig barangay, not yet decided) or
 *                     facility (a treatment/screening facility name not mapped to the
 *                     registry — unknown, needs mapping, or an unregistered private /
 *                     external facility)
 *   DATA ISSUES       rows that failed validation (validation_issues.status = 'open'):
 *                     missing required values, invalid dates, invalid values
 *
 * A record can need assignment for both location and facility; it leaves the queue only
 * when both are resolved. All SQL fragments use the validated_tb_cases alias `v`.
 */

const { UPDATE_FIELDS } = require('./matchResolution');
const { matchIdentity, suggestionForMatch } = require('./patientIdentity');

/**
 * JS mirror of SQL norm_facility(): drop a trailing program tag (the "- IDOTS" /
 * "- MTBN" suffix imported files append), lowercase, strip everything but [a-z0-9].
 * Shared by the facility routes so alias keys written on one path match lookups on
 * any other — both sides must agree or a key written here would not match SQL.
 */
const normFacility = (s) => String(s || '').toLowerCase()
  .replace(/\s*-\s*(idots|mtbn)\s*$/, '')
  .replace(/[^a-z0-9]/g, '');

const LIVE = `v.is_archived = false AND v.merged_into_case_no IS NULL`;
const PASIG_CITY = `(v.city IS NULL OR lower(trim(v.city)) IN ('pasig city', 'pasig'))`;

const NEEDS_LOCATION = `(v.match_status <> 'pending' AND v.location_resolution IS NULL
  AND (v.barangay_id IS NULL OR NOT ${PASIG_CITY}))`;

const NEEDS_FACILITY = `(v.match_status <> 'pending' AND (
     (NULLIF(trim(v.treatment_facility), '') IS NOT NULL AND v.treatment_facility_id IS NULL)
  OR (NULLIF(trim(v.screening_facility), '') IS NOT NULL AND v.screening_facility_id IS NULL)))`;

const MATCH_PENDING = `v.match_status = 'pending'`;
const READY = `(v.match_status <> 'pending' AND NOT ${NEEDS_LOCATION} AND NOT ${NEEDS_FACILITY})`;

/** A Pasig residence: resolved onto a Pasig barangay in a Pasig city. */
const SENDS_PASIG_RESIDENCE = `(v.barangay_id IS NOT NULL AND ${PASIG_CITY})`;

/**
 * Goes to TBInsight once synced vs kept in PASIG only. A Pasig residence goes
 * through on its own; a Non-Pasig residence only once an admin confirmed it
 * (TBInsight then admits it when the treatment facility is a Pasig facility).
 */
const SENDS_TO_TBINSIGHT = `((${SENDS_PASIG_RESIDENCE}) OR v.location_resolution = 'outside_pasig')`;

const ymd = (v) => {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
};
const norm = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Sub-type of a possible match, comparing the incoming record with the existing case.
 * @returns {{ category, suggestion, changes: [{field, existing, incoming}] }}
 */
function fieldChanges(row, candidate) {
  return UPDATE_FIELDS
    .map((field) => {
      const isDate = field.startsWith('date_');
      const incoming = isDate ? ymd(row[field]) : row[field];
      const existing = isDate ? ymd(candidate[field]) : candidate[field];
      return { field, existing: existing ?? null, incoming: incoming ?? null };
    })
    // Only a value the incoming record actually has can update the case (same_case uses COALESCE).
    .filter((c) => c.incoming !== null && c.incoming !== '' && norm(c.incoming) !== norm(c.existing));
}

function categorizeMatch(row, candidate) {
  if (!candidate) {
    return { category: 'missing_candidate', suggestion: 'different_person', changes: [] };
  }
  const meta = matchIdentity(row, candidate);
  // A Case ID that identifies the case makes this row a report of that case,
  // regardless of the diagnosis date. A Case ID that contradicts the patient it
  // points at is never offered as "same case".
  if (meta.matchedBy === 'case_id') {
    if (meta.conflict) return { category: 'new_episode', suggestion: 'different_person', changes: [] };
    const changes = fieldChanges(row, candidate);
    if (changes.length === 0) return { category: 'duplicate', suggestion: 'same_case', changes };
    const outcomeChanged = changes.some((c) => c.field === 'outcome_status' || c.field === 'date_of_outcome');
    return { category: outcomeChanged ? 'changed_outcome' : 'case_update', suggestion: 'same_case', changes };
  }
  const sameDx = ymd(row.date_of_diagnosis) && ymd(row.date_of_diagnosis) === ymd(candidate.date_of_diagnosis);
  if (!sameDx) {
    return { category: 'new_episode', suggestion: 'new_episode', changes: [] };
  }
  const changes = fieldChanges(row, candidate);
  if (changes.length === 0) return { category: 'duplicate', suggestion: 'same_case', changes };
  const outcomeChanged = changes.some((c) => c.field === 'outcome_status' || c.field === 'date_of_outcome');
  return { category: outcomeChanged ? 'changed_outcome' : 'case_update', suggestion: 'same_case', changes };
}

/** Classify a validation error message for the Data Issues tab. */
function issueType(message) {
  const m = String(message).toLowerCase();
  if (m.includes('required')) return 'missing_required';
  if (m.includes('date') && (m.includes('after') || m.includes('invalid') || m.includes('before'))) return 'invalid_date';
  if (m.includes('invalid')) return 'invalid_value';
  return 'incomplete';
}

/** Which record field an error message is about (to highlight it in the fix form). */
const IDENTITY_FIELDS = ['last_name', 'first_name', 'middle_name', 'suffix', 'date_of_birth'];

/**
 * A fix to a historical (de-identified) data issue may fill in a blank name or date of
 * birth, but not change a stored one — except the date of birth once the user has unlocked
 * the Records PIN, so a mistyped one (e.g. after the date of diagnosis) can be corrected.
 * @returns {{ locked: string[], keep: string[] }} locked: changes to refuse;
 *   keep: fields whose submitted value is ignored (the stored value stays)
 */
function protectedIdentityChanges(record, changes, { dobEditable = false } = {}) {
  const stored = f => record?.[f] !== null && record?.[f] !== undefined && String(record[f]).trim() !== '';
  const fixed = IDENTITY_FIELDS.filter(f => !(f === 'date_of_birth' && dobEditable));
  const given = f => Object.prototype.hasOwnProperty.call(changes || {}, f);
  return {
    locked: fixed.filter(f => given(f) && stored(f) && String(changes[f] ?? '') !== String(record[f])),
    keep: fixed.filter(f => given(f) && stored(f)),
  };
}

function issueField(message) {
  const m = String(message).toLowerCase();
  if (m.includes('case id')) return 'source_case_id';
  if (m.includes('last name')) return 'last_name';
  if (m.includes('first name')) return 'first_name';
  if (m.includes('date of birth')) return 'date_of_birth';
  if (m.includes('date of diagnosis')) return 'date_of_diagnosis';
  if (m.includes('sex')) return 'sex';
  if (m.includes('age')) return 'age';
  if (m.includes('barangay')) return 'barangay_name';
  return null;
}

const STOP = new Set(['health', 'center', 'centre', 'hc', 'idots', 'dots', 'mtbn', 'tb', 'the', 'of', 'city', 'pasig', 'clinic', 'and', 'brgy', 'barangay']);
const tokens = (s) => String(s || '').toLowerCase()
  .replace(/\bsta\.?\b/g, 'santa').replace(/\bsto\.?\b/g, 'santo')
  .split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));

/**
 * Best registry facility for a source facility name, by shared distinctive words
 * ("ROSARIO HEALTH CENTER - IDOTS" -> "Rosario HC"). Only a suggestion — an admin confirms.
 */
function suggestFacility(text, facilities) {
  const want = tokens(text);
  if (want.length === 0) return null;
  let best = null;
  for (const f of facilities) {
    const have = tokens(f.name);
    if (have.length === 0) continue;
    const shared = have.filter((w) => want.includes(w)).length;
    if (shared === 0) continue;
    // Every distinctive word of the facility must appear in the source name.
    if (shared < have.length) continue;
    const score = shared / Math.max(want.length, have.length);
    if (!best || score > best.score) best = { id: f.id, name: f.name, score };
  }
  return best && best.score >= 0.5 ? { id: best.id, name: best.name } : null;
}

module.exports = {
  LIVE, NEEDS_LOCATION, NEEDS_FACILITY, MATCH_PENDING, READY, SENDS_TO_TBINSIGHT, PASIG_CITY,
  categorizeMatch, issueType, issueField, protectedIdentityChanges, suggestFacility, ymd, normFacility,
};
