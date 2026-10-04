/**
 * Outcome / Status — the single frontend contract.
 *
 * Mirrors BACKEND/tbinsight/outcomeNormalization.js. Every page that lists,
 * orders, filters or labels an Outcome/Status value imports from here instead
 * of declaring its own array: Dashboard, Analytics, TB Records, Reports and
 * GIS each used to keep a private copy, which is how a value could be approved
 * in one place and shown differently in another.
 *
 * These are the 9 Excel-verified source Outcome/Status categories. SCREENED is
 * NOT one of them — it exists in the stored data (13 records, traced to the MN
 * sheet of the source workbook via PASIG TB-IS) but is not a verified source
 * category, so it is never offered as a filter option and never drawn as a
 * chart category. It is not mapped onto another outcome either; doing so
 * without evidence would misclassify real records.
 *
 * Legacy aliases: records imported before the canonical form was aligned to the
 * source are stored as TREATMENT FAILED / LOST TO FOLLOW-UP. The API now
 * returns the source-aligned label for record rows and category lists, so these
 * aliases are a safety net for any value that reaches the UI unmapped. The
 * user-facing label is always FAILED, never TREATMENT FAILED.
 */

/** The 9 approved source-aligned categories, in display order. */
export const APPROVED_OUTCOMES = [
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

/** Filter dropdown options, including the "no filter" sentinel. */
export const OUTCOME_FILTER_OPTIONS = ['All', ...APPROVED_OUTCOMES];

/** Shared chart colours, so one category is the same colour on every page. */
export const OUTCOME_COLORS = {
  'CURED': '#2a78d6',
  'TREATMENT COMPLETED': '#eb6834',
  'ON TREATMENT': '#1baf7a',
  'FAILED': '#eda100',
  'DIED': '#e87ba4',
  'LOST TO FF-UP': '#008300',
  'EXCLUDED': '#4a3aa7',
  'DIAGNOSED': '#0369A1',
  'NOT EVALUATED': '#94A3B8',
};

/** Statuses that represent a patient still under treatment. */
export const ACTIVE_OUTCOMES = ['ON TREATMENT'];

/** Outcomes counted as a successful treatment result. */
export const SUCCESS_OUTCOMES = ['CURED', 'TREATMENT COMPLETED'];

/**
 * Map a stored value to its source-aligned display label.
 * Returns null for anything outside the approved set (e.g. SCREENED), so
 * aggregates can exclude it deliberately rather than render it as a category.
 */
export function normalizeDisplayOutcome(value) {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase();
  if (!s) return null;
  if (s === 'TREATMENT FAILED') return 'FAILED';
  if (s === 'LOST TO FOLLOW-UP' || s === 'LOST TO FOLLOW UP' || s === 'LTFU') return 'LOST TO FF-UP';
  return APPROVED_OUTCOMES.includes(s) ? s : null;
}

/**
 * Display label for an individual record. Unlike normalizeDisplayOutcome this
 * never returns null for a present value: a record's stored value is shown as
 * it is (upper-cased) when it is not an approved category, because hiding it
 * would remove traceability. Pair it with isApprovedOutcome to mark such a
 * value as unverified instead of presenting it as a source category.
 */
export function normalizeRecordOutcome(value) {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase();
  if (!s) return null;
  return normalizeDisplayOutcome(s) || s;
}

/** True when the value is one of the 9 Excel-verified source categories. */
export function isApprovedOutcome(value) {
  return normalizeDisplayOutcome(value) != null;
}
