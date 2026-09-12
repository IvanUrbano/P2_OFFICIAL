/**
 * Audit logging for security-sensitive actions.
 * Writes to the audit_logs table on the shared auth database.
 */
const db = require('../db/pasigSchema');

/**
 * Log an audit event.
 * @param {Object} params
 * @param {number}  params.userId       - ID of the user performing the action
 * @param {string}  params.username     - Username of the actor
 * @param {string}  params.action       - Action type (e.g., PASSWORD_RESET, CREATE_USER)
 * @param {number}  [params.targetUserId]  - ID of the affected user
 * @param {string}  [params.targetUsername] - Username of the affected user
 * @param {string}  [params.result]     - 'SUCCESS' or 'FAILURE'
 * @param {string}  [params.ipAddress]  - IP address of the request
 */
async function logAuditEvent({ userId, username, action, targetUserId, targetUsername, result, ipAddress }) {
  try {
    // Ensure audit_logs table exists on the auth database
    await db.authPool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        target_user_id INTEGER,
        target_username TEXT,
        result TEXT NOT NULL DEFAULT 'SUCCESS',
        ip_address TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.authPool.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_logs(username)');
    await db.authPool.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)');
    await db.authPool.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at)');

    await db.authPool.query(
      `INSERT INTO audit_logs (user_id, username, action, target_user_id, target_username, result, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId || null,
        username || 'system',
        action,
        targetUserId || null,
        targetUsername || null,
        result || 'SUCCESS',
        ipAddress || null,
      ]
    );
  } catch (err) {
    console.error('[pasig-clone] Failed to write audit log:', err.message);
  }
}

module.exports = { logAuditEvent };
