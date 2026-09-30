/**
 * Outcome Normalization — Canonical outcome_status handling
 *
 * All outcome comparisons, filters, and GROUP BY clauses MUST use
 * UPPER(TRIM(outcome_status)) to ensure consistent behavior regardless
 * of how data was ingested (CSV import, webhook, manual entry).
 *
 * The canonical DB values (verified) are:
 *   CURED, TREATMENT COMPLETED, ON TREATMENT, DIED,
 *   TREATMENT FAILED, LOST TO FF-UP, EXCLUDED, NOT EVALUATED,
 *   DIAGNOSED, SCREENED
 *
 * Tolerant variants handled:
 *   FAILED → TREATMENT FAILED
 *   LOST TO FOLLOW-UP, LOST TO FOLLOW UP, LTFU → LOST TO FF-UP
 */

// Canonical SQL expression for outcome comparison.
// Usage in WHERE/GROUP BY: `${NORMALIZE_OUTCOME_SQL} = 'CURED'`
const NORMALIZE_OUTCOME_SQL = 'UPPER(TRIM(outcome_status))';

// Evaluated terminal outcomes for CFR denominator
const EVALUATED_TERMINAL_OUTCOMES = [
  'CURED',
  'TREATMENT COMPLETED',
  'DIED',
  'TREATMENT FAILED',
  'LOST TO FF-UP',
  'LOST TO FOLLOW-UP',
];

// Success outcomes for TSR and Treatment Cascade
const SUCCESS_OUTCOMES = ['CURED', 'TREATMENT COMPLETED'];

// All known canonical outcome values
const CANONICAL_OUTCOMES = [
  'CURED',
  'TREATMENT COMPLETED',
  'ON TREATMENT',
  'DIED',
  'TREATMENT FAILED',
  'LOST TO FF-UP',
  'EXCLUDED',
  'NOT EVALUATED',
  'DIAGNOSED',
  'SCREENED',
];

/**
 * Normalize an outcome_status value to its canonical form.
 * Returns null for empty/null/whitespace-only values.
 * Returns the UPPER'd, TRIM'd value for unknown values (preserving them
 * rather than silently mapping to something unrelated).
 */
function normalizeOutcome(value) {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase();
  if (!s) return null;
  // Tolerant variant mapping
  if (s === 'FAILED') return 'TREATMENT FAILED';
  if (s === 'LOST TO FOLLOW-UP' || s === 'LOST TO FOLLOW UP' || s === 'LTFU') return 'LOST TO FF-UP';
  return s;
}

module.exports = {
  NORMALIZE_OUTCOME_SQL,
  EVALUATED_TERMINAL_OUTCOMES,
  SUCCESS_OUTCOMES,
  CANONICAL_OUTCOMES,
  normalizeOutcome,
};
