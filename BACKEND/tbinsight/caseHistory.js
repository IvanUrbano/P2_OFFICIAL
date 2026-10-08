/**
 * Case History — append-only record of what changed on a case and who did it.
 *
 * The table (`case_history`, migration 023) has existed since the barangay/staff
 * work but nothing in TBInsight ever wrote to it, so an outcome correction
 * arriving on a re-sent Case ID silently overwrote the previous value. This
 * module is the writer for the webhook path — the only path that mutates cases
 * in TBInsight.
 *
 * Rules this module exists to enforce:
 *
 *   - A re-sent record is matched ONLY by the stable Case ID (tb_cases.case_no)
     and updates that row in place; history is written instead of a second row.
 *   - The previous values are preserved verbatim in `changed_fields`
 *     ({ "field": { "old": …, "new": … } }) — nothing is guessed or back-filled.
 *   - `source` records WHAT produced the change and `changed_by_label` records
 *     WHO did, as reported by the source system. TBInsight never invents an
 *     actor: `changed_by_user_id` stays NULL because a synced record has no
 *     TBInsight user behind it.
 *   - Outcomes are only ever what the source sent. Nothing here derives an
 *     outcome — least of all CURED — from dates or elapsed time.
 *   - Patient identity is not case identity: history is keyed by case_no, never
 *     by patient_no, so a later episode of the same person is a separate case
 *     with its own history.
 */

// The fields the webhook upsert manages (tbinsight/webhook.js DO UPDATE SET).
// Keeping this list in one place means the pre-update snapshot, the diff and
// the upsert cannot drift apart.
const HISTORY_FIELDS = [
  'barangay_id',
  'barangay_name',
  'residence_barangay_name',
  'residence_city',
  'location_classification',
  'outcome_status',
  'source_outcome_status',
  'date_of_outcome',
  'date_started_treatment',
  'treatment_facility',
  'source_case_id',
];

// Columns selected as the "before" snapshot. DATE columns are cast to text so
// they compare directly against the sender's 'YYYY-MM-DD' strings with no
// timezone interpretation on either side.
const HISTORY_SELECT_SQL = `
  SELECT id, case_no, patient_no,
         barangay_id, barangay_name, residence_barangay_name, residence_city,
         location_classification, outcome_status, source_outcome_status,
         date_of_outcome::text AS date_of_outcome,
         date_started_treatment::text AS date_started_treatment,
         treatment_facility, source_case_id
  FROM tb_cases
  WHERE case_no = ANY($1::text[])`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalize any value to a comparable string. `null` and '' are the same thing
 * (an empty date and a missing date are both "no value"), and pg's DATE/INT
 * text forms line up with what the sender sent.
 */
function normValue(value) {
  return value == null ? '' : String(value);
}

/**
 * Diff the stored row against the incoming values for the tracked fields.
 * @returns {null} when nothing changed, otherwise { field: { old, new } }
 */
function diffCaseFields(before, after) {
  if (!before || !after) return null;
  const changed = {};
  for (const field of HISTORY_FIELDS) {
    const oldValue = normValue(before[field]);
    const newValue = normValue(after[field]);
    if (oldValue !== newValue) {
      changed[field] = { old: before[field] ?? null, new: after[field] ?? null };
    }
  }
  return Object.keys(changed).length > 0 ? changed : null;
}

/**
 * What kind of change this is, for the change_type CHECK.
 * An outcome moving from ON TREATMENT to CURED is a status change; anything
 * else on an existing case is an ordinary update.
 */
function classifyChange(diff) {
  if (!diff) return null;
  return Object.prototype.hasOwnProperty.call(diff, 'outcome_status')
    ? 'status_changed'
    : 'updated';
}

/**
 * Append history entries. Runs on the caller's transaction client so the
 * history row and the case change commit (or roll back) together.
 *
 * @param {{ query: Function }} client  pool or transaction client
 * @param {Array<object>} entries       one per changed/created case
 * @returns {Promise<number>} how many rows were written
 */
async function insertCaseHistory(client, entries) {
  const rows = (entries || []).filter(Boolean);
  if (rows.length === 0) return 0;

  const params = [];
  const tuples = rows.map((entry, index) => {
    const base = index * 9;
    params.push(
      entry.tbCaseId ?? null,
      entry.caseNo ?? null,
      entry.patientNo ?? null,
      UUID_RE.test(String(entry.batchId || '')) ? entry.batchId : null,
      entry.changeType,
      entry.changedFields ? JSON.stringify(entry.changedFields) : null,
      entry.source ?? 'webhook',
      entry.changedByUserId ?? null,
      entry.changedByLabel ?? null
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5},
             $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
  }).join(', ');

  await client.query(
    `INSERT INTO case_history
       (tb_case_id, case_no, patient_no, batch_id, change_type, changed_fields,
        source, changed_by_user_id, changed_by_label)
     VALUES ${tuples}`,
    params
  );
  return rows.length;
}

module.exports = {
  HISTORY_FIELDS,
  HISTORY_SELECT_SQL,
  normValue,
  diffCaseFields,
  classifyChange,
  insertCaseHistory,
};
