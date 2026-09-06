const express = require('express');
const router = express.Router();
const { sendWebhook } = require('../services/webhookSender');
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');

router.post('/send', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { batchId } = req.body;

    if (!batchId) {
      return res.status(400).json({ error: 'batchId is required' });
    }

    const result = await sendWebhook(batchId);

    res.json({
      message: result.message,
      success: result.success,
      status: result.status,
    });
  } catch (error) {
    console.error('Webhook send error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/logs', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const result = await db.getWebhookLogs();
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching webhook logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

module.exports = router;
