/**
 * Audit logging for security-sensitive actions.
 * Writes to the audit_logs table (created by migration 010).
 */
const pool = require('../db');

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
 * @param {Object|string} [params.details] - Extra structured context (stored as jsonb)
 */
async function logAuditEvent({ userId, username, action, targetUserId, targetUsername, result, ipAddress, details }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, username, action, target_user_id, target_username, result, ip_address, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId || null,
        username || 'system',
        action,
        targetUserId || null,
        targetUsername || null,
        result || 'SUCCESS',
        ipAddress || null,
        details == null ? null : (typeof details === 'string' ? details : JSON.stringify(details)),
      ]
    );
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

module.exports = { logAuditEvent };
