/** Canonical treatment state. outcome_status remains the source/legacy value. */
const CASE_STATUSES = ['DIAGNOSED', 'ON TREATMENT'];
const APPROVED_OUTCOMES = [
  'CURED', 'TREATMENT COMPLETED', 'TREATMENT FAILED',
  'LOST TO FOLLOW-UP', 'DIED', 'NOT EVALUATED', 'EXCLUDED',
];
const SUCCESS_OUTCOMES = ['CURED', 'TREATMENT COMPLETED'];
const EVALUATED_TERMINAL_OUTCOMES = [
  'CURED', 'TREATMENT COMPLETED', 'TREATMENT FAILED',
  'FAILED', 'LOST TO FOLLOW-UP', 'LOST TO FF-UP', 'DIED',
];
const NORMALIZE_OUTCOME_SQL = 'UPPER(TRIM(treatment_outcome))';

function normalizeOutcome(value) {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase();
  if (!s) return null;
  if (s === 'FAILED') return 'TREATMENT FAILED';
  if (['LOST TO FF-UP', 'LOST TO FOLLOW UP', 'LTFU'].includes(s)) return 'LOST TO FOLLOW-UP';
  if (['ON TX', 'ONGOING TREATMENT', 'ON GOING TREATMENT'].includes(s)) return 'ON TREATMENT';
  return s;
}

function splitTreatmentState(value) {
  const normalized = normalizeOutcome(value);
  return {
    case_status: CASE_STATUSES.includes(normalized) ? normalized : null,
    treatment_outcome: APPROVED_OUTCOMES.includes(normalized) ? normalized : null,
  };
}

function normalizeDisplayOutcome(value) {
  const normalized = normalizeOutcome(value);
  return APPROVED_OUTCOMES.includes(normalized) ? normalized : null;
}

function normalizeRecordOutcome(value) {
  return normalizeDisplayOutcome(value) || normalizeOutcome(value);
}

function isApprovedOutcome(value) {
  return normalizeDisplayOutcome(value) != null;
}

function getOutcomeFilterValues(value) {
  const normalized = normalizeDisplayOutcome(value);
  if (!normalized) return [];
  if (normalized === 'TREATMENT FAILED') return ['TREATMENT FAILED', 'FAILED'];
  if (normalized === 'LOST TO FOLLOW-UP') return ['LOST TO FOLLOW-UP', 'LOST TO FF-UP', 'LOST TO FOLLOW UP', 'LTFU'];
  return [normalized];
}

function foldOutcomeCounts(rows, { labelKey = 'outcome_status', countKey = 'count' } = {}) {
  const byCategory = new Map();
  const unapprovedMap = new Map();
  for (const row of rows || []) {
    const count = Number(row?.[countKey] || 0);
    const label = normalizeDisplayOutcome(row?.[labelKey]);
    if (label) byCategory.set(label, (byCategory.get(label) || 0) + count);
    else {
      const raw = row?.[labelKey] == null ? 'UNKNOWN' : String(row[labelKey]).trim().toUpperCase() || 'UNKNOWN';
      unapprovedMap.set(raw, (unapprovedMap.get(raw) || 0) + count);
    }
  }
  const categories = APPROVED_OUTCOMES.filter(o => byCategory.has(o))
    .map(o => ({ outcome_status: o, count: byCategory.get(o) }));
  const unapproved = [...unapprovedMap.entries()].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
  return {
    categories, unapproved,
    approvedTotal: categories.reduce((sum, row) => sum + row.count, 0),
    unapprovedTotal: unapproved.reduce((sum, row) => sum + row.count, 0),
  };
}

const SUCCESS_OUTCOMES_SQL = SUCCESS_OUTCOMES.map(v => `'${v}'`).join(',');
module.exports = {
  CASE_STATUSES, NORMALIZE_OUTCOME_SQL, EVALUATED_TERMINAL_OUTCOMES,
  SUCCESS_OUTCOMES, CANONICAL_OUTCOMES: APPROVED_OUTCOMES, APPROVED_OUTCOMES,
  normalizeOutcome, splitTreatmentState, normalizeDisplayOutcome,
  normalizeRecordOutcome, isApprovedOutcome, getOutcomeFilterValues,
  foldOutcomeCounts, SUCCESS_OUTCOMES_SQL,
};
