/**
 * Case History presentation helpers.
 *
 * A history entry is one append-only row about ONE case (never about a patient):
 * what changed, when, and who asked for it. The same person can have a later,
 * new episode — that is a different Case ID with its own, separate history.
 */

const FIELD_LABELS = {
  barangay_id: 'Barangay',
  barangay_name: 'Barangay',
  residence_barangay_name: 'Residence Barangay',
  residence_city: 'Residence City',
  location_classification: 'Location Classification',
  outcome_status: 'Outcome',
  source_outcome_status: 'Source Outcome',
  date_of_outcome: 'Outcome Date',
  date_started_treatment: 'Treatment Start',
  treatment_facility: 'Treatment Facility',
  source_case_id: 'Case ID',
};

const changeTitles = {
  created: 'Case created',
  updated: 'Case updated',
  status_changed: 'Outcome changed',
  merged: 'Case merged',
  transferred: 'Case transferred',
  deleted: 'Case removed',
  restored: 'Case restored',
};

function showValue(value) {
  return value == null || value === '' ? '—' : String(value);
}

/**
 * Turn a raw history row into something renderable.
 * @param {{ change_type: string, changed_fields?: object|null }} entry
 * @returns {{ title: string, lines: string[] }}
 */
export function describeHistoryEntry(entry) {
  const fields = (entry && typeof entry.changed_fields === 'object' && entry.changed_fields)
    ? entry.changed_fields
    : {};
  const changedKeys = Object.keys(fields);
  const title = changeTitles[entry?.change_type] || 'Case updated';

  if (entry?.change_type === 'created') {
    return { title, lines: ['First received from the source system.'] };
  }

  const lines = changedKeys.map((field) => {
    const change = fields[field] || {};
    const label = field === 'outcome_status'
      ? 'Outcome'
      : (FIELD_LABELS[field] || field);
    return `${label}: ${showValue(change.old)} → ${showValue(change.new)}`;
  });

  return {
    title,
    lines: lines.length > 0 ? lines : ['No field-level detail recorded.'],
  };
}

/**
 * "Oct 5, 2026, 3:04 PM" — safe for a missing/invalid timestamp.
 */
export function formatHistoryTimestamp(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/**
 * Who made the change: the label the source system reported, the username of a
 * TBInsight user, or a neutral fallback. Never a patient identifier.
 */
export function historyActorLabel(entry) {
  const actor = entry?.actor;
  if (actor && String(actor).trim()) return String(actor).trim();
  const sourceLabels = {
    webhook: 'TBInsight sync',
    import: 'TBInsight import',
    manual: 'TBInsight user',
    transfer: 'Facility transfer',
    review: 'Reviewer',
    system: 'System',
  };
  return sourceLabels[entry?.source] || 'System';
}
