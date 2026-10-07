/**
 * Barangay filter shared by the Dashboard KPI queries (summary, treatment success rate,
 * case fatality rate).
 *
 * The filter used to take exactly one barangay. The Dashboard's recommended filters scope
 * the page to a GROUP of barangays (e.g. the High-risk ones), so `barangay` may now be a
 * single name or a list (`?barangay=A&barangay=B`). One name behaves exactly as before.
 */

/** Any accepted form -> a clean array of barangay names. */
function barangayList(value) {
  return [].concat(value ?? [])
    .map((v) => String(v).trim())
    .filter(Boolean);
}

/**
 * SQL condition + bind value for `column`.
 * @returns {{ sql: string, value: string|string[] }|null}  null when no barangay was given
 */
function barangayCondition(column, placeholder, value) {
  const list = barangayList(value);
  if (list.length === 0) return null;
  return list.length === 1
    ? { sql: `TRIM(${column}) = ${placeholder}`, value: list[0] }
    : { sql: `TRIM(${column}) = ANY(${placeholder}::text[])`, value: list };
}

module.exports = { barangayList, barangayCondition };
