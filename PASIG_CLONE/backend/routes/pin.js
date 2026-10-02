const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db/pasigSchema');
const { authenticate } = require('../middleware/auth');
const { logAuditEvent } = require('../utils/auditLogger');
const pin = require('../services/pinService');

// GET /api/auth/pin/status — has the user set a PIN, and are names currently unlocked?
router.get('/status', authenticate, async (req, res) => {
  try {
    const row = await pin.getPinRow(req.user.id);
    const until = pin.unlockedUntil(req);
    res.json({
      hasPin: Boolean(row),
      unlocked: Boolean(until),
      unlockedUntil: until,
      lockedUntil: row?.locked_until && new Date(row.locked_until) > new Date() ? row.locked_until : null,
    });
  } catch (err) {
    console.error('PIN status error:', err.message);
    res.status(500).json({ error: 'Failed to load PIN status.' });
  }
});

// POST /api/auth/pin — set or change the PIN. Requires the account password.
router.post('/', authenticate, async (req, res) => {
  try {
    const { password, pin: newPin } = req.body || {};
    if (!pin.isValidPin(newPin)) return res.status(400).json({ error: 'PIN must be 4 to 6 digits.' });
    const user = (await db.authPool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!user || !password || !(await bcrypt.compare(String(password), user.password_hash))) {
      return res.status(401).json({ error: 'Account password is incorrect.' });
    }
    await pin.setPin(req.user.id, newPin);
    pin.clearUnlock(res);
    await logAuditEvent({
      userId: req.user.id, username: req.user.username, action: 'RECORDS_PIN_SET',
      resourceType: 'user', resourceId: String(req.user.id), result: 'SUCCESS', ipAddress: req.ip || null,
    });
    res.json({ message: 'Records PIN saved.' });
  } catch (err) {
    console.error('PIN set error:', err.message);
    res.status(500).json({ error: 'Failed to save PIN.' });
  }
});

// POST /api/auth/pin/verify — unlock patient names for a short time
router.post('/verify', authenticate, async (req, res) => {
  try {
    const result = await pin.verifyPin(req.user.id, req.body?.pin);
    await logAuditEvent({
      userId: req.user.id, username: req.user.username, action: 'RECORDS_PIN_UNLOCK',
      resourceType: 'user', resourceId: String(req.user.id), result: result.ok ? 'SUCCESS' : 'FAILURE',
      ipAddress: req.ip || null, details: result.ok ? null : { reason: result.reason },
    });
    if (result.ok) {
      const until = pin.issueUnlock(res, req.user.id);
      return res.json({ unlocked: true, unlockedUntil: until });
    }
    if (result.reason === 'no_pin') return res.status(400).json({ error: 'Set up your records PIN first (Settings → Security).' });
    if (result.reason === 'locked') {
      return res.status(423).json({ error: `Too many wrong PINs. Try again after ${new Date(result.lockedUntil).toLocaleTimeString()}.`, lockedUntil: result.lockedUntil });
    }
    return res.status(401).json({ error: `Wrong PIN. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} left.` });
  } catch (err) {
    console.error('PIN verify error:', err.message);
    res.status(500).json({ error: 'Failed to verify PIN.' });
  }
});

// POST /api/auth/pin/lock — hide names again immediately
router.post('/lock', authenticate, (req, res) => {
  pin.clearUnlock(res);
  res.json({ unlocked: false });
});

module.exports = router;
