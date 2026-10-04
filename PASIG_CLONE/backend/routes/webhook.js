const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sendWebhook } = require('../services/webhookSender');
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const notifications = require('../services/notifications');

// Sync outcome: a failure goes to the other admins; the person who uploaded the file
// hears either way.
async function notifySync(batchId, result, user) {
  try {
    const batch = (await db.pool.query('SELECT filename, uploaded_by FROM import_batches WHERE id = $1', [batchId])).rows[0];
    if (!batch) return;
    const partial = result.success && result.recordsRejected > 0;
    const n = {
      type: result.success ? 'sync_completed' : 'sync_failed',
      severity: !result.success ? 'danger' : partial ? 'warning' : 'success',
      actorId: user.id,
      title: result.success
        ? `${batch.filename} synced to TBInsight${partial ? ` (${result.recordsRejected} rejected)` : ''}`
        : `Sync to TBInsight failed: ${batch.filename}`,
      message: result.success
        ? `${result.message} Synced by ${user.username}.`
        : `${result.message || 'TBInsight did not accept the records.'} Try again from Data Sync.`,
      link: '/sync-history', entityType: 'import_batch', entityId: batchId,
    };
    const recipients = [batch.uploaded_by];
    if (!result.success) recipients.push(...(await notifications.admins()));
    await notifications.notify(recipients, n);
  } catch (err) {
    console.error('[notifications] sync notification failed:', err.message);
  }
}

const sendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many sync requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/send', sendLimiter, authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { batchId } = req.body;

    if (!batchId) {
      return res.status(400).json({ error: 'batchId is required' });
    }

    // Pass userId to sendWebhook for audit tracking
    const result = await sendWebhook(batchId, req.user.id);
    await notifySync(batchId, result, req.user);

    res.json({
      message: result.message,
      success: result.success,
      status: result.status,
      recordsSent: result.recordsSent,
      recordsAccepted: result.recordsAccepted,
      recordsImported: result.recordsImported,
      recordsUpdated: result.recordsUpdated,
      recordsRejected: result.recordsRejected,
      rejectedSamples: result.rejectedSamples,
      nonPasigExcluded: result.nonPasigExcluded,
      alreadySynced: result.alreadySynced,
      inProgress: result.inProgress,
    });
  } catch (error) {
    console.error('Webhook send error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/logs', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const result = await db.getWebhookLogs();
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching webhook logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

module.exports = router;
