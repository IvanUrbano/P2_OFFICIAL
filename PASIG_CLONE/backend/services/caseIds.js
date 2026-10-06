/**
 * Case ID — the ID users see for a TB case:
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
 * A file that already carries a "Case ID" column keeps its IDs (they are the source of
 * truth — e.g. the 2023-2026 registry files). Rows without one get the next free number.
 * The internal case_no (CS-...) stays the hidden link key for referrals / history / sync.
 */

const CASE_ID_RE = /^[A-Z0-9]{2,6}-[DM]-\d{4}-\d{5}$/;
const LOCK_KEY = 73950242; // pg_advisory_xact_lock: one Case ID allocation at a time

const typeLetter = (sourceType) => (sourceType === 'DSTB' ? 'D' : sourceType === 'MN' ? 'M' : null);

/** A Case ID as given in a file: trimmed, upper-cased, inner spaces removed; null if blank. */
function normalizeCaseId(v) {
  const s = String(v ?? '').replace(/\s+/g, '').toUpperCase();
  return s || null;
}

/** Map facility name -> facility_code (registry name or alias), for the given names. */
async function facilityCodes(client, names) {
  const unique = [...new Set(names.filter(n => n && String(n).trim()))];
  if (unique.length === 0) return new Map();
  const { rows } = await client.query(
    `SELECT n AS name, (SELECT f.facility_code FROM facility_ref f WHERE f.id = facility_ref_id(n)) AS code
     FROM unnest($1::text[]) AS n`,
    [unique]
  );
  return new Map(rows.map(r => [r.name, r.code || null]));
}

/** "<code>-<type>-<year>" for a record (null when the type has no Case ID). */
function prefixFor(r, codes) {
  const t = typeLetter(r.source_type);
  if (!t) return null;
  const fac = (r.treatment_facility && String(r.treatment_facility).trim()) || (r.screening_facility && String(r.screening_facility).trim()) || '';
  const code = (fac && codes.get(fac)) || 'UNK';
  const year = String(r.date_of_diagnosis || '').slice(0, 4) || String(new Date().getFullYear());
  return `${code}-${t}-${year}`;
}

/**
 * Give every DSTB / MN record without a source_case_id the next free Case ID. Must run
 * inside the caller's transaction (takes a transaction-scoped advisory lock). Numbers
 * continue after the highest one already used by any case, open data issue, or record in
 * `rows` with the same prefix — so no Case ID repeats, across files and batches.
 * @returns number of IDs assigned
 */
async function assignCaseIds(client, rows) {
  const todo = rows.filter(r => !r.source_case_id && typeLetter(r.source_type));
  if (todo.length === 0) return 0;
  await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);

  const codes = await facilityCodes(client, todo.flatMap(r => [r.treatment_facility, r.screening_facility]));
  const prefixes = [...new Set(todo.map(r => prefixFor(r, codes)))];

  const next = new Map(prefixes.map(p => [p, 0]));
  const { rows: used } = await client.query(
    `SELECT left(id, -6) AS prefix, MAX(right(id, 5)::int) AS max_n FROM (
       SELECT source_case_id AS id FROM validated_tb_cases WHERE source_case_id ~ '^[A-Z0-9]+-[DM]-[0-9]{4}-[0-9]{5}$'
       UNION ALL
       SELECT record->>'source_case_id' FROM validation_issues WHERE record->>'source_case_id' ~ '^[A-Z0-9]+-[DM]-[0-9]{4}-[0-9]{5}$'
     ) x WHERE left(id, -6) = ANY($1::text[]) GROUP BY 1`,
    [prefixes]
  );
  for (const u of used) next.set(u.prefix, Math.max(next.get(u.prefix) || 0, Number(u.max_n) || 0));
  for (const r of rows) {
    if (r.source_case_id && CASE_ID_RE.test(r.source_case_id)) {
      const p = r.source_case_id.slice(0, -6);
      if (next.has(p)) next.set(p, Math.max(next.get(p), Number(r.source_case_id.slice(-5))));
    }
  }
  for (const r of todo) {
    const p = prefixFor(r, codes);
    const n = next.get(p) + 1;
    next.set(p, n);
    r.source_case_id = `${p}-${String(n).padStart(5, '0')}`;
  }
  return todo.length;
}

module.exports = { CASE_ID_RE, typeLetter, normalizeCaseId, facilityCodes, prefixFor, assignCaseIds };
