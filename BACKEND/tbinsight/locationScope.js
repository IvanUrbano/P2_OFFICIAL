/**
 * Scope rules for Non-Pasig residents who are treated/managed by a Pasig facility.
 *
 * A TB patient whose residence is outside Pasig is kept in TBInsight when their
 * TREATMENT facility resolves to a registered Pasig facility. They are stored with
 * location_classification = 'Non-Pasig Resident', free-text residence columns, and
 * barangay_id / barangay_name NULL — the facility never decides the barangay, and a
 * non-Pasig patient is never stamped with a Pasig barangay, not even when the
 * residence barangay name collides with a Pasig one.
 *
 * Two scopes, and only two:
 *
 *   pasigResidentOnly()  barangay-keyed work: L3 barangay aggregates, per-100k
 *                        incidence, choropleth, ARIMA / RF inputs, alert evaluation,
 *                        per-barangay dashboards and reports.
 *   countedCases()       city-wide counts, KPIs and facility statistics.
 *
 * Nothing else decides inclusion. A query that filters on a barangay name already
 * excludes these rows for free (their barangay_name IS NULL), so cohort rates such as
 * TSR / CFR need no predicate.
 *
 * Every predicate takes an optional table alias so it can be dropped into a JOINed
 * query without shadowing.
 */

const NON_COUNTED = `('Non-Pasig', 'Non-Pasig Resident')`;

/**
 * Rows that belong to a Pasig barangay.
 * Also guards barangay_name IS NOT NULL so a mis-labelled row can never put a NULL
 * barangay into the NOT NULL, FK-constrained L3 tables.
 *
 * @param {string} [alias] table alias, e.g. 'c' for `FROM tb_cases c`
 */
function pasigResidentOnly(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `COALESCE(${p}location_classification, 'Pasig City') NOT IN ${NON_COUNTED}`
    + ` AND ${p}barangay_name IS NOT NULL`;
}

/**
 * Rows counted in city-wide totals and in facility statistics.
 * NULL classification counts as Pasig (legacy rows); only the legacy 'Non-Pasig' value
 * — records kept for traceability and never counted — is dropped.
 *
 * @param {string} [alias] table alias
 */
function countedCases(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `COALESCE(${p}location_classification, 'Pasig City') <> 'Non-Pasig'`;
}

/** True when a stored location_classification marks a Non-Pasig resident. */
function isNonPasigResident(classification) {
  return String(classification || '').trim() === 'Non-Pasig Resident';
}

module.exports = {
  pasigResidentOnly,
  countedCases,
  isNonPasigResident,
};
