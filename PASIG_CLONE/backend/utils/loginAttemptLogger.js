/**
 * Login attempt logging and account lockout enforcement.
 * Uses authPool from ../db/pasigSchema.js (shared neondb).
 */
const db = require('../db/pasigSchema');

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MINUTES = 15;

/**
 * Record a login attempt.
 */
async function logLoginAttempt(username, ipAddress, success) {
  try {
    // Create login_attempts table if it does not exist on the auth database
    await db.authPool.query(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        ip_address TEXT,
        success BOOLEAN NOT NULL,
        attempted_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.authPool.query(
      'CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts(username)'
    );
    await db.authPool.query(
      'INSERT INTO login_attempts (username, ip_address, success) VALUES ($1, $2, $3)',
      [username, ipAddress || null, success]
    );
  } catch (err) {
    console.error('[pasig-clone] Failed to log login attempt:', err.message);
  }
}

/**
 * Check if the account is currently locked.
 */
async function isAccountLocked(username) {
  try {
    // Ensure lockout columns exist
    await db.authPool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0');
    await db.authPool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP NULL');
    await db.authPool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP NULL');

    const result = await db.authPool.query(
      'SELECT locked_until FROM users WHERE username = $1 OR email = $1 LIMIT 1',
      [username]
    );
    if (result.rows.length === 0) return false;

    const { locked_until } = result.rows[0];
    if (!locked_until) return false;

    return new Date(locked_until) > new Date();
  } catch (err) {
    console.error('[pasig-clone] Failed to check lockout status:', err.message);
    return false;
  }
}

/**
 * Get the remaining lockout seconds (0 if not locked).
 */
async function getLockoutRemaining(username) {
  try {
    const result = await db.authPool.query(
      'SELECT locked_until FROM users WHERE username = $1 OR email = $1 LIMIT 1',
      [username]
    );
    if (result.rows.length === 0) return 0;

    const { locked_until } = result.rows[0];
    if (!locked_until) return 0;

    return Math.max(0, Math.ceil((new Date(locked_until).getTime() - Date.now()) / 1000));
  } catch (err) {
    return 0;
  }
}

/**
 * Record a failed attempt. If threshold reached, lock the account.
 */
async function recordFailedAttempt(username, ipAddress) {
  try {
    await db.authPool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0');
    await db.authPool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP NULL');
    await db.authPool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP NULL');

    const result = await db.authPool.query(
      `UPDATE users
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE
             WHEN failed_attempts + 1 >= $1 THEN NOW() + INTERVAL '${LOCKOUT_DURATION_MINUTES} minutes'
             ELSE locked_until
           END
       WHERE username = $2 OR email = $2
       RETURNING failed_attempts, locked_until`,
      [LOCKOUT_THRESHOLD, username]
    );

    if (result.rows.length === 0) return { locked: false, attempts: 0 };

    const { failed_attempts, locked_until } = result.rows[0];
    const locked = locked_until !== null && new Date(locked_until) > new Date();

    return { locked, attempts: failed_attempts };
  } catch (err) {
    console.error('[pasig-clone] Failed to record failed attempt:', err.message);
    return { locked: false, attempts: 0 };
  }
}

/**
 * Reset failed attempts on successful login.
 */
async function resetFailedAttempts(username) {
  try {
    await db.authPool.query(
      'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE username = $1 OR email = $1',
      [username]
    );
  } catch (err) {
    console.error('[pasig-clone] Failed to reset failed attempts:', err.message);
  }
}

module.exports = {
  logLoginAttempt,
  isAccountLocked,
  getLockoutRemaining,
  recordFailedAttempt,
  resetFailedAttempts,
  LOCKOUT_THRESHOLD,
  LOCKOUT_DURATION_MINUTES,
};
