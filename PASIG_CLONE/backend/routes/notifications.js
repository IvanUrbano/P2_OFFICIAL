const express = require('express');
const router = express.Router();
const db = require('../db/pasigSchema');
const { authenticate } = require('../middleware/auth');

// Mounted at /api/auth/notifications (routes/auth.js). Every query is scoped to the
// signed-in user — nobody can read or mark another user's notifications.
//
//   GET  /unread-count            -> { count }
//   GET  /?status=unread|all&limit=&offset=&type=   -> { notifications, total, unread }
//   PUT  /:id/read                mark one as read
//   PUT  /:id/unread              mark one as unread
//   PUT  /read-all                mark all as read

router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const r = await db.pool.query(
      'SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    );
    res.json({ count: r.rows[0].n });
  } catch (error) {
    console.error('Notification count error:', error.message);
    res.status(500).json({ error: 'Failed to load notifications.' });
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const params = [req.user.id];
    let where = 'user_id = $1';
    if (req.query.status === 'unread') where += ' AND is_read = false';
    if (req.query.status === 'read') where += ' AND is_read = true';
    if (req.query.type) {
      params.push(String(req.query.type));
      where += ` AND type = $${params.length}`;
    }
    const [rows, totals] = await Promise.all([
      db.pool.query(
        `SELECT id, type, severity, title, message, link, entity_type, entity_id, is_read, read_at, created_at
         FROM notifications WHERE ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
      ),
      db.pool.query(
        `SELECT COUNT(*)::int AS total,
                (SELECT COUNT(*)::int FROM notifications WHERE user_id = $1 AND is_read = false) AS unread
         FROM notifications WHERE ${where}`,
        params
      ),
    ]);
    res.json({ notifications: rows.rows, total: totals.rows[0].total, unread: totals.rows[0].unread });
  } catch (error) {
    console.error('Notification list error:', error.message);
    res.status(500).json({ error: 'Failed to load notifications.' });
  }
});

router.put('/read-all', authenticate, async (req, res) => {
  try {
    const r = await db.pool.query(
      'UPDATE notifications SET is_read = true, read_at = NOW() WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    );
    res.json({ updated: r.rowCount });
  } catch (error) {
    console.error('Notification read-all error:', error.message);
    res.status(500).json({ error: 'Failed to update notifications.' });
  }
});

async function setRead(req, res, read) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid notification.' });
    const r = await db.pool.query(
      `UPDATE notifications SET is_read = $3, read_at = CASE WHEN $3 THEN NOW() ELSE NULL END
       WHERE id = $1 AND user_id = $2 RETURNING id, is_read`,
      [id, req.user.id, read]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Notification not found.' });
    res.json(r.rows[0]);
  } catch (error) {
    console.error('Notification update error:', error.message);
    res.status(500).json({ error: 'Failed to update the notification.' });
  }
}

router.put('/:id/read', authenticate, (req, res) => setRead(req, res, true));
router.put('/:id/unread', authenticate, (req, res) => setRead(req, res, false));

module.exports = router;
