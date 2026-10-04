/**
 * Follow-up after a record is corrected on the Validation page.
 *
 * resyncSyncedCases — a case whose batch was ALREADY sent to TBInsight is re-sent on its
 *   own (as a small "Correction" batch, the same mechanism the barangay assignment used),
 *   so TBInsight updates it by Case ID. Cases in batches not yet synced simply go out
 *   with their batch.
 *
 * logReviews — writes review decisions to case_review_history (migration 004).
 */

const db = require('../db/pasigSchema');
const { sendWebhook } = require('./webhookSender');

async function resyncSyncedCases(caseNos, user, label = 'Correction') {
  const nos = [...new Set((caseNos || []).filter(Boolean))];
  if (nos.length === 0) return { status: 'none', count: 0 };
  const synced = await db.pool.query(
    `SELECT v.case_no FROM validated_tb_cases v JOIN import_batches b ON b.id = v.batch_id
     WHERE v.case_no = ANY($1::text[]) AND b.sync_status = 'synced'`,
    [nos]
  );
  if (synced.rows.length === 0) return { status: 'pending', count: 0 };

  const corr = await db.pool.query(
    `INSERT INTO import_batches (filename, uploaded_by, total_rows, valid_count, error_count, status, validated_by, validated_at)
     VALUES ($1, $2, 0, 0, 0, 'validated', $2, NOW()) RETURNING id`,
    [`${label} — ${user.username}`, user.id]
  );
  try {
    const result = await sendWebhook(corr.rows[0].id, user.id, { extraCaseNos: synced.rows.map(r => r.case_no) });
    return { status: result.success ? 'synced' : 'failed', count: synced.rows.length, message: result.message };
  } catch (err) {
    return { status: 'failed', count: synced.rows.length, message: err.message };
  }
}

/**
 * @param {object} q  pool or transaction client
 * @param {Array<{validated_case_id, case_no, review_type, decision, previous_status, new_status, notes}>} entries
 */
async function logReviews(q, userId, entries) {
  if (!entries || entries.length === 0) return;
  for (let i = 0; i < entries.length; i += 500) {
    const chunk = entries.slice(i, i + 500);
    await q.query(
      `INSERT INTO case_review_history
         (validated_case_id, case_no, review_type, decision, previous_status, new_status, notes, reviewed_by_user_id)
       SELECT x.validated_case_id, x.case_no, x.review_type, x.decision, x.previous_status, x.new_status, x.notes, $2
       FROM jsonb_to_recordset($1::jsonb) AS x(validated_case_id bigint, case_no text, review_type text,
            decision text, previous_status text, new_status text, notes text)`,
      [JSON.stringify(chunk), userId]
    );
  }
}

module.exports = { resyncSyncedCases, logReviews };
