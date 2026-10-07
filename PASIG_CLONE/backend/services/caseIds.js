/**
 * Case ID — the ID users see for a TB case, and the key that says two rows describe the
 * same case:
 *
 *     <FACILITY CODE>-<D|M>-<YEAR>-<NNNNN>        e.g. ROS-D-2025-00042
 *
 *   facility code  treatment facility's facility_code (TBInsight health_facilities,
 *                  mirrored in facility_ref; names resolve through facility_ref_id(), i.e.
 *                  the registry name or a facility alias); screening facility when the
 *                  treatment facility is blank; UNK when neither resolves
 *   D | M          DSTB | MN
 *   YEAR           year of diagnosis
 *   NNNNN          running number per facility + type + year
 *
 * The Case ID always comes from the file's "Case ID" column (or the Add TB Record form) —
 * the system NEVER generates one. A row without one fails validation, because the Case ID
 * is what identifies this case when the same file, or a later report of the same case, is
 * imported again. The internal case_no (CS-...) stays the hidden link key for referrals /
 * history / sync.
 */

const CASE_ID_RE = /^[A-Z0-9]{2,6}-[DM]-\d{4}-\d{5}$/;

/** A Case ID as given in a file: trimmed, upper-cased, inner spaces removed; null if blank. */
function normalizeCaseId(v) {
  const s = String(v ?? '').replace(/\s+/g, '').toUpperCase();
  return s || null;
}

module.exports = { CASE_ID_RE, normalizeCaseId };
