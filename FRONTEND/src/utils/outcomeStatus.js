/** Case status and final treatment outcome are separate clinical fields. */
export const CASE_STATUSES = ['DIAGNOSED', 'ON TREATMENT'];
export const APPROVED_OUTCOMES = [
  'CURED', 'TREATMENT COMPLETED', 'TREATMENT FAILED',
  'LOST TO FOLLOW-UP', 'DIED', 'NOT EVALUATED', 'EXCLUDED',
];
export const OUTCOME_FILTER_OPTIONS = ['All', ...APPROVED_OUTCOMES];
export const STATUS_FILTER_OPTIONS = ['All', ...CASE_STATUSES];
export const OUTCOME_COLORS = {
  'CURED': '#2a78d6',
  'TREATMENT COMPLETED': '#eb6834',
  'TREATMENT FAILED': '#eda100',
  'DIED': '#e87ba4',
  'LOST TO FOLLOW-UP': '#008300',
  'EXCLUDED': '#4a3aa7',
  'NOT EVALUATED': '#94A3B8',
};
export const STATUS_COLORS = { 'DIAGNOSED': '#0369A1', 'ON TREATMENT': '#1baf7a' };
export const SUCCESS_OUTCOMES = ['CURED', 'TREATMENT COMPLETED'];

export function normalizeDisplayOutcome(value) {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase();
  const canonical = s === 'FAILED' ? 'TREATMENT FAILED'
    : ['LOST TO FF-UP', 'LOST TO FOLLOW UP', 'LTFU'].includes(s) ? 'LOST TO FOLLOW-UP' : s;
  return APPROVED_OUTCOMES.includes(canonical) ? canonical : null;
}

export function normalizeRecordOutcome(value) {
  return normalizeDisplayOutcome(value) || (value == null ? null : String(value).trim().toUpperCase() || null);
}

export function isApprovedOutcome(value) {
  return normalizeDisplayOutcome(value) != null;
}
