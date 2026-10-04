const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { startBackgroundSync, claimBatchForSync } = require('../services/backgroundSync');

const sendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many sync requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Starts the sync and answers immediately (202); the page follows it via GET /status.
router.post('/send', sendLimiter, authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { batchId } = req.body;

    if (!batchId) {
      return res.status(400).json({ error: 'batchId is required' });
    }

    const claim = await claimBatchForSync(batchId, req.user.id);
    if (!claim.ok) {
      return res.status(claim.status).json({ error: claim.error, inProgress: claim.inProgress || undefined });
    }

    startBackgroundSync(batchId, req.user);
    res.status(202).json({ started: true, batchId, message: 'Sync started.' });
  } catch (error) {
    console.error('Webhook send error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Current sync state of a batch, plus TBInsight's counts once it has finished.
router.get('/status/:batchId', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { rows } = await db.pool.query(
      `SELECT id, filename, sync_status, sync_error, sync_result, sync_started_at, synced_at
       FROM import_batches WHERE id = $1`,
      [req.params.batchId]
    );
    const b = rows[0];
    if (!b) return res.status(404).json({ error: 'Batch not found' });
    res.json({
      batchId: b.id,
      filename: b.filename,
      syncStatus: b.sync_status,
      error: b.sync_error,
      result: b.sync_result,
      startedAt: b.sync_started_at,
      finishedAt: b.synced_at,
    });
  } catch (error) {
    console.error('Error fetching sync status:', error);
    res.status(500).json({ error: 'Failed to fetch sync status' });
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
