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
 * @param {string}  params.action       - Action type (e.g., PASSWORD_RESET, CREATE_USER, IMPORT_FILE)
 * @param {number}  [params.targetUserId]  - ID of the affected user
 * @param {string}  [params.targetUsername] - Username of the affected user
 * @param {string}  [params.resourceType]  - Resource type (e.g., 'import_batch', 'webhook')
 * @param {string}  [params.resourceId]    - Resource/batch ID
 * @param {string}  [params.result]     - 'SUCCESS' or 'FAILURE'
 * @param {string}  [params.ipAddress]  - IP address of the request
 * @param {string}  [params.actorRole]  - Role of the actor at write time (snapshot; later
 *                                        role changes do not rewrite historical entries)
 * @param {Object}  [params.details]    - Additional context (serialized as JSON)
 */
async function logAuditEvent({ userId, username, action, targetUserId, targetUsername, resourceType, resourceId, result, ipAddress, actorRole, details }) {
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
        resource_type TEXT,
        resource_id TEXT,
        result TEXT NOT NULL DEFAULT 'SUCCESS',
        ip_address TEXT,
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.authPool.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_logs(username)');
    await db.authPool.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)');
    await db.authPool.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at)');

    // The shared auth DB's audit_logs was created by TBInsight migration 010
    // without resource columns — CREATE IF NOT EXISTS above is a no-op there.
    await db.authPool.query('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_type TEXT');
    await db.authPool.query('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_id TEXT');
    // Migration 010 adds `details`, but a fresh DB whose table was first created by
    // routes/auth.js GET /audit-logs (older CREATE without details) would lack it.
    await db.authPool.query('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details JSONB');

    const payload = { ...(details || {}) };
    if (actorRole) payload.actorRole = actorRole;

    await db.authPool.query(
      `INSERT INTO audit_logs (user_id, username, action, target_user_id, target_username, resource_type, resource_id, result, ip_address, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        userId || null,
        username || 'system',
        action,
        targetUserId || null,
        targetUsername || null,
        resourceType || null,
        resourceId || null,
        result || 'SUCCESS',
        ipAddress || null,
        Object.keys(payload).length > 0 ? JSON.stringify(payload) : null,
      ]
    );
  } catch (err) {
    console.error('[pasig-clone] Failed to write audit log:', err.message);
  }
}

module.exports = { logAuditEvent };
