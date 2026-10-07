/**
 * Background sync to TBInsight.
 *
 * A sync can take minutes (TBInsight asleep on Render, large batch, retries), so no
 * request waits for one: the caller starts it here and answers right away. The
 * outcome lands on import_batches (sync_status / sync_error / sync_result), which the
 * Sync page polls, and as a notification to the person who started it.
 */

const db = require('../db/pasigSchema');
const { sendWebhook, STUCK_SYNC_MINUTES } = require('./webhookSender');
const notifications = require('./notifications');

// Sync outcome reaches the uploader and the person who started it. Failures also
// reach admins so they can retry or investigate.
async function notifySync(batchId, result, user) {
  try {
    const batch = (await db.pool.query('SELECT filename, uploaded_by FROM import_batches WHERE id = $1', [batchId])).rows[0];
    if (!batch) return;
    const partial = result.success && result.recordsRejected > 0;
    const n = {
      type: result.success ? 'sync_completed' : 'sync_failed',
      severity: !result.success ? 'danger' : partial ? 'warning' : 'success',
      actorId: user.id, includeActor: true,
      title: result.success
        ? `${batch.filename} synced to TBInsight${partial ? ` (${result.recordsRejected} rejected)` : ''}`
        : `Sync to TBInsight failed: ${batch.filename}`,
      message: result.success
        ? `${result.message} Synced by ${user.username}.`
        : `${result.message || 'TBInsight did not accept the records.'} Try again from Data Sync.`,
      link: '/sync-history', entityType: 'import_batch', entityId: batchId,
    };
    const recipients = [batch.uploaded_by, user.id];
    if (!result.success) {
      try { recipients.push(...(await notifications.admins())); }
      catch (err) { console.error('[notifications] admin lookup failed:', err.message); }
    }
    await notifications.notify(recipients, n);
  } catch (err) {
    console.error('[notifications] sync notification failed:', err.message);
  }
}

/**
 * Start syncing a batch without waiting for it. Never throws and never rejects:
 * a sync that blows up marks the batch 'sync_failed' and notifies.
 * @returns {Promise} settles when the sync is over (tests await it; routes don't)
 */
function startBackgroundSync(batchId, user, options = {}) {
  // Who asked for this sync. TBInsight keeps it on the case history rows it
  // writes for a same-case outcome update; it is a label, not an id, because a
  // PASIG account has no row in TBInsight's users table. Omitted when the caller
  // has no username to report — history then simply records a null actor.
  const senderOptions = user && user.username
    ? { ...options, actor: { username: user.username, role: user.role } }
    : options;
  return sendWebhook(batchId, user.id, senderOptions)
    .then(result => notifySync(batchId, result, user))
    .catch(async (err) => {
      console.error(`❌ Background sync of batch ${batchId} failed:`, err.message);
      // sendWebhook only resets 'syncing' itself once it got that far; a check that
      // failed earlier (e.g. pending matches) would otherwise leave the claim behind.
      try {
        await db.pool.query(
          `UPDATE import_batches SET sync_status = 'sync_failed', sync_error = $2
           WHERE id = $1 AND sync_status = 'syncing'`,
          [batchId, err.message.substring(0, 500)]
        );
      } catch (statusErr) {
        console.error(`Failed to mark batch ${batchId} as sync_failed:`, statusErr.message);
      }
      await notifySync(batchId, { success: false, message: err.message }, user);
    });
}

/**
 * Mark a batch 'syncing' unless a sync of it is already running. Atomic, so a
 * double-click or two admins cannot start two syncs of the same batch.
 * @returns {Promise<{ok: true} | {ok: false, status: number, error: string, inProgress?: boolean}>}
 */
async function claimBatchForSync(batchId, userId) {
  const claimed = await db.pool.query(
    `UPDATE import_batches
     SET sync_status = 'syncing', sync_started_at = NOW(), sync_error = NULL, sync_result = NULL, synced_by = $2
     WHERE id = $1 AND status = 'validated'
       AND (sync_status IS DISTINCT FROM 'syncing'
            OR sync_started_at IS NULL
            OR sync_started_at < NOW() - make_interval(mins => $3))
     RETURNING id`,
    [batchId, userId, STUCK_SYNC_MINUTES]
  );
  if (claimed.rows.length > 0) return { ok: true };

  const batch = (await db.pool.query('SELECT status, sync_status FROM import_batches WHERE id = $1', [batchId])).rows[0];
  if (!batch) return { ok: false, status: 404, error: 'Batch not found' };
  if (batch.status !== 'validated') return { ok: false, status: 400, error: 'Batch must be validated before sending' };
  return { ok: false, status: 409, inProgress: true, error: 'This batch is already being synced. Its result will appear here when it finishes.' };
}

/** Background-sync message shown in place of a sync result that isn't known yet. */
const SYNC_STARTED = { status: 'syncing', message: 'Syncing to TBInsight in the background. You will get a notification when it finishes.' };

module.exports = { startBackgroundSync, claimBatchForSync, notifySync, SYNC_STARTED };
