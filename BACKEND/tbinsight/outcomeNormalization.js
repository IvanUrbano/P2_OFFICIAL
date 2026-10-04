/**
 * Outcome Normalization — Canonical outcome_status handling
 *
 * All outcome comparisons, filters, and GROUP BY clauses MUST use
 * UPPER(TRIM(outcome_status)) to ensure consistent behavior regardless
 * of how data was ingested (CSV import, webhook, manual entry).
 *
 * The 9 source-aligned (Excel-verified) outcome/status values are:
 *   CURED, TREATMENT COMPLETED, ON TREATMENT, FAILED,
 *   DIED, LOST TO FF-UP, EXCLUDED, NOT EVALUATED, DIAGNOSED
 *
 * Historical DB records may also contain:
 *   TREATMENT FAILED (56 records — Excel "FAILED" that was normalized)
 *   SCREENED (13 records — likely from unnormalized webhook data)
 *   LOST TO FOLLOW-UP (variant spelling of LOST TO FF-UP)
 *
 * Tolerant variant mapping (ingest-time):
 *   TREATMENT FAILED → FAILED  (source-aligned canonical)
 *   LOST TO FOLLOW-UP, LOST TO FOLLOW UP, LTFU → LOST TO FF-UP
 *
 * Display mapping (read-time):
 *   TREATMENT FAILED → FAILED
 *   LOST TO FOLLOW-UP → LOST TO FF-UP
 */

// Canonical SQL expression for outcome comparison.
// Usage in WHERE/GROUP BY: `${NORMALIZE_OUTCOME_SQL} = 'CURED'`
const NORMALIZE_OUTCOME_SQL = 'UPPER(TRIM(outcome_status))';

// The 9 source-aligned (Excel-verified) outcome/status values.
// Single source of truth for dropdowns, charts, and UI labels.
const APPROVED_OUTCOMES = [
  'CURED',
  'TREATMENT COMPLETED',
  'ON TREATMENT',
  'FAILED',
  'DIAGNOSED',
  'NOT EVALUATED',
  'DIED',
  'LOST TO FF-UP',
  'EXCLUDED',
];

// Evaluated terminal outcomes for CFR denominator.
// Includes BOTH historical DB values (TREATMENT FAILED, LOST TO FOLLOW-UP)
// and source-aligned values (FAILED, LOST TO FF-UP) so that all records
// are correctly counted regardless of which normalization was applied at import.
const EVALUATED_TERMINAL_OUTCOMES = [
  'CURED',
  'TREATMENT COMPLETED',
  'DIED',
  'FAILED',
  'TREATMENT FAILED',   // historical — 56 records in DB
  'LOST TO FF-UP',
  'LOST TO FOLLOW-UP',  // historical variant
];

// Success outcomes for TSR and Treatment Cascade
const SUCCESS_OUTCOMES = ['CURED', 'TREATMENT COMPLETED'];

// All source-aligned canonical outcome values (for UI/display)
const CANONICAL_OUTCOMES = [...APPROVED_OUTCOMES];

/**
 * Normalize an outcome_status value to its canonical (source-aligned) form
 * at INGEST time. Called by importCases.js and webhook.js before storing.
 *
 * Returns null for empty/null/whitespace-only values.
 * Returns the UPPER'd, TRIM'd value for unknown values (preserving them
 * rather than silently mapping to something unrelated).
 */
function normalizeOutcome(value) {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase();
  if (!s) return null;
  // Tolerant variant mapping — normalize TO source-aligned form
  if (s === 'TREATMENT FAILED') return 'FAILED';
  if (s === 'LOST TO FOLLOW-UP' || s === 'LOST TO FOLLOW UP' || s === 'LTFU') return 'LOST TO FF-UP';
  return s;
}

/**
 * Map a DB outcome_status value to its source-aligned display form.
 * Used at READ time when presenting data to the UI.
 *
 * Historical DB values that differ from the Excel-verified form:
 *   TREATMENT FAILED → FAILED
 *   LOST TO FOLLOW-UP → LOST TO FF-UP
 *
 * Values NOT in the approved list (e.g. SCREENED) return null
 * so callers can exclude them from UI display.
 */
function normalizeDisplayOutcome(dbValue) {
  if (dbValue == null) return null;
  const s = String(dbValue).trim().toUpperCase();
  if (!s) return null;
  if (s === 'TREATMENT FAILED') return 'FAILED';
  if (s === 'LOST TO FOLLOW-UP' || s === 'LOST TO FOLLOW UP' || s === 'LTFU') return 'LOST TO FF-UP';
  if (APPROVED_OUTCOMES.includes(s)) return s;
  return null; // not an approved value (e.g. SCREENED)
}

/**
 * Expand a display-level outcome filter value to all DB variants that
 * should match. Used in SQL WHERE clauses.
 *
 * Example: user selects "FAILED" in the dropdown → DB may have "FAILED"
 * (new imports) or "TREATMENT FAILED" (56 historical records).
 * This function returns ['FAILED', 'TREATMENT FAILED'] so both match.
 */
function getOutcomeFilterValues(displayValue) {
  const s = String(displayValue).trim().toUpperCase();
  if (s === 'FAILED') return ['FAILED', 'TREATMENT FAILED'];
  if (s === 'LOST TO FF-UP') return ['LOST TO FF-UP', 'LOST TO FOLLOW-UP'];
  return [s];
}


/**
 * Display label for an INDIVIDUAL RECORD's outcome_status.
 *
 * Differs from normalizeDisplayOutcome, which returns null for a value outside
 * the approved set so that aggregates (charts, dropdowns, category lists) can
 * drop it. A record row cannot be dropped — hiding the stored value would
 * destroy traceability — so an unapproved value is returned verbatim
 * (UPPER/TRIM'd) and `isApprovedOutcome` reports false, letting the UI mark it
 * as not a verified source category instead of presenting it as one.
 *
 * Approved and legacy-aliased values map to their source-aligned form:
 *   TREATMENT FAILED  -> FAILED
 *   LOST TO FOLLOW-UP -> LOST TO FF-UP
 */
function normalizeRecordOutcome(dbValue) {
  if (dbValue == null) return null;
  const s = String(dbValue).trim().toUpperCase();
  if (!s) return null;
  return normalizeDisplayOutcome(s) || s;
}

/**
 * True when the stored value corresponds to one of the 9 Excel-verified
 * source Outcome/Status categories (after legacy aliasing).
 * SCREENED, REFUSED and any other unverified value return false.
 */
function isApprovedOutcome(dbValue) {
  return normalizeDisplayOutcome(dbValue) != null;
}


/**
 * Fold raw (value, count) outcome rows into the approved source-aligned
 * categories — the single shared rule behind every outcome CATEGORY list
 * (Dashboard chart, Analytics chart, Reports breakdown).
 *
 * Legacy values are merged into their canonical category (TREATMENT FAILED
 * into FAILED), categories are returned in APPROVED_OUTCOMES order, and
 * anything outside the 9 verified categories is reported separately in
 * `unapproved` rather than displayed as an Excel category or silently dropped.
 * That makes the reconciliation explicit: approvedTotal + unapprovedTotal
 * equals the record count the caller passed in.
 *
 * @param {Array<object>} rows - rows with a label and a count field
 * @param {object} [opts]
 * @param {string} [opts.labelKey='outcome_status']
 * @param {string} [opts.countKey='count']
 * @returns {{categories: Array<{outcome_status: string, count: number}>,
 *   unapproved: Array<{value: string, count: number}>,
 *   approvedTotal: number, unapprovedTotal: number}}
 */
function foldOutcomeCounts(rows, { labelKey = 'outcome_status', countKey = 'count' } = {}) {
  const byCategory = new Map();
  const unapprovedMap = new Map();
  for (const row of rows || []) {
    const count = Number(row?.[countKey] || 0);
    const label = normalizeDisplayOutcome(row?.[labelKey]);
    if (label) {
      byCategory.set(label, (byCategory.get(label) || 0) + count);
    } else {
      const raw = row?.[labelKey] == null ? 'UNKNOWN' : String(row[labelKey]).trim().toUpperCase() || 'UNKNOWN';
      unapprovedMap.set(raw, (unapprovedMap.get(raw) || 0) + count);
    }
  }
  const categories = APPROVED_OUTCOMES
    .filter((o) => byCategory.has(o))
    .map((o) => ({ outcome_status: o, count: byCategory.get(o) }));
  const unapproved = [...unapprovedMap.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
  return {
    categories,
    unapproved,
    approvedTotal: categories.reduce((t, c) => t + c.count, 0),
    unapprovedTotal: unapproved.reduce((t, c) => t + c.count, 0),
  };
}


/**
 * SQL fragment listing the success outcomes, for use inside an IN (...) clause.
 * Lets every "successful outcome" count reference the one shared definition
 * instead of repeating a literal ('CURED','TREATMENT COMPLETED') pair that can
 * drift between routes.
 */
const SUCCESS_OUTCOMES_SQL = SUCCESS_OUTCOMES.map((v) => `'${v}'`).join(',');

module.exports = {
  NORMALIZE_OUTCOME_SQL,
  EVALUATED_TERMINAL_OUTCOMES,
  SUCCESS_OUTCOMES,
  CANONICAL_OUTCOMES,
  APPROVED_OUTCOMES,
  normalizeOutcome,
  normalizeDisplayOutcome,
  normalizeRecordOutcome,
  isApprovedOutcome,
  getOutcomeFilterValues,
  foldOutcomeCounts,
  SUCCESS_OUTCOMES_SQL,
};
