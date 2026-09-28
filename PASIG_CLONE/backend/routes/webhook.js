const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sendWebhook } = require('../services/webhookSender');
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');

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

    res.json({
      message: result.message,
      success: result.success,
      status: result.status,
      recordsSent: result.recordsSent,
      recordsAccepted: result.recordsAccepted,
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
