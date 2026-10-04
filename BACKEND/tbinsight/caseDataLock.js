/**
 * Keeps analysis results consistent with the case data they were computed from.
 *
 * The pipeline reads cases, spends seconds to minutes in the ML service, then stores
 * forecasts / risk scores / alerts. If cases are deleted (batch undo), synced or
 * imported meanwhile, those results describe data that no longer exists — e.g. a
 * forecast left behind after every batch was deleted.
 *
 *   - Every writer of case data takes lockCaseData() inside its transaction.
 *   - The pipeline takes the same lock when it stores results, and first compares the
 *     case-data fingerprint with the one it captured when it started. If they differ,
 *     it discards its results and asks for a fresh run.
 *
 * pg_advisory_xact_lock is released automatically at COMMIT / ROLLBACK.
 */

const CASE_DATA_LOCK_KEY = 73950241;

async function lockCaseData(client) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [CASE_DATA_LOCK_KEY]);
}

/**
 * Cheap signature of the case set: changes whenever a case is added or removed
 * (count, highest id and id sum together catch delete-then-reimport too).
 */
async function caseDataFingerprint(q) {
  const { rows } = await q.query(
    `SELECT COUNT(*)::bigint AS n, COALESCE(MAX(id), 0)::bigint AS max_id, COALESCE(SUM(id), 0)::numeric AS sum_id
     FROM tb_cases`
  );
  const r = rows[0] || {};
  return `${r.n}:${r.max_id}:${r.sum_id}`;
}

module.exports = { CASE_DATA_LOCK_KEY, lockCaseData, caseDataFingerprint };
