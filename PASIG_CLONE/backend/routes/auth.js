const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { validatePassword } = require('../utils/passwordValidator');
const { generateTempPassword } = require('../utils/tempPasswordGenerator');
const { logAuditEvent } = require('../utils/auditLogger');
const {
  logLoginAttempt,
  isAccountLocked,
  getLockoutRemaining,
  recordFailedAttempt,
  resetFailedAttempts,
} = require('../utils/loginAttemptLogger');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Guards account-mutating actions (register, password changes/resets) from abuse.
const accountActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==================== REGISTER (Admin Only) ====================
router.post('/register', accountActionLimiter, authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { username, email, role, facility_id } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    const cleanUsername = username?.trim().toLowerCase();
    const cleanEmail = email?.trim().toLowerCase();

    if (!cleanUsername || !cleanEmail) {
      return res.status(400).json({ error: 'Username and email are required.' });
    }

    const userRole = role || 'staff';
    if (!['admin', 'staff'].includes(userRole)) {
      return res.status(400).json({ error: 'Invalid role. Must be admin or staff.' });
    }

    const existing = await db.authPool.query(
      'SELECT id FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $2',
      [cleanUsername, cleanEmail]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email already exists.' });
    }

    // Facility assignment: required for staff, optional (NULL) for admin.
    let facilityId = null;
    if (facility_id !== undefined && facility_id !== null && facility_id !== '') {
      const facResult = await db.authPool.query(
        'SELECT id FROM health_facilities WHERE id = $1',
        [Number(facility_id)]
      );
      if (facResult.rows.length === 0) {
        return res.status(400).json({ error: 'Unknown health facility. Select a registered facility.' });
      }
      facilityId = Number(facility_id);
    } else if (userRole === 'staff') {
      return res.status(400).json({ error: 'A registered health facility is required for staff accounts.' });
    }

    // Generate secure temporary password
    const tempPassword = generateTempPassword();

    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    const result = await db.authPool.query(
      `INSERT INTO users (username, email, password_hash, role, facility_id, password_changed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, username, email, role, facility_id, created_at`,
      [cleanUsername, cleanEmail, hashedPassword, userRole, facilityId]
    );

    const newUser = result.rows[0];

    // Log audit event (never log the password itself)
    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'CREATE_USER',
      targetUserId: newUser.id,
      targetUsername: newUser.username,
      result: 'SUCCESS',
      ipAddress,
      details: { role: userRole, facilityId },
    });

    res.status(201).json({
      message: 'User created successfully.',
      user: newUser,
      tempPassword,
    });
  } catch (error) {
    console.error('Register error:', error.message);
    res.status(500).json({ error: 'Unable to create user. Please try again.' });
  }
});

// ==================== LOGIN ====================
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const username = email;

    const cleanUsername = username?.trim().toLowerCase();

    if (!cleanUsername || !password) {
      return res.status(400).json({ error: 'Username/email and password are required.' });
    }

    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    // Check if account is locked
    if (await isAccountLocked(cleanUsername)) {
      const remaining = await getLockoutRemaining(cleanUsername);
      return res.status(423).json({
        error: 'Account temporarily locked due to too many failed attempts. Please try again later.',
        retryAfter: remaining,
      });
    }

    // Find user
    const result = await db.authPool.query(
      'SELECT * FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $1',
      [cleanUsername]
    );

    if (result.rows.length === 0) {
      await logLoginAttempt(cleanUsername, ipAddress, false);
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = result.rows[0];

    // Compare password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await logLoginAttempt(cleanUsername, ipAddress, false);
      const { locked } = await recordFailedAttempt(cleanUsername, ipAddress);
      if (locked) {
        const remaining = await getLockoutRemaining(cleanUsername);
        return res.status(423).json({
          error: 'Account temporarily locked due to too many failed attempts. Please try again later.',
          retryAfter: remaining,
        });
      }
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // Success — reset lockout and log
    await resetFailedAttempts(cleanUsername);
    await logLoginAttempt(cleanUsername, ipAddress, true);

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role, facility_id: user.facility_id || null },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    // Set token in httpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Readable double-submit CSRF cookie — paired with the x-csrf-token header
    // on state-changing requests so a cross-site page can't ride the session cookie.
    const csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf_token', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Check if password was changed within the last 24 hours
    const recentlyChanged = user.password_changed_at &&
      (Date.now() - new Date(user.password_changed_at).getTime()) < 24 * 60 * 60 * 1000;

    // Facility context for the logged-in user (staff accounts are facility-assigned)
    let facility = null;
    if (user.facility_id) {
      const facResult = await db.authPool.query(
        'SELECT id, name, barangay_name, facility_type FROM health_facilities WHERE id = $1',
        [user.facility_id]
      );
      facility = facResult.rows[0] || null;
    }

    res.json({
      message: 'Login successful.',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        facility_id: user.facility_id || null,
        facility,
      },
      passwordRecentlyChanged: recentlyChanged,
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// ==================== LOGOUT ====================
router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.clearCookie('csrf_token', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  require('../services/pinService').clearUnlock(res); // hide patient names again
  res.json({ message: 'Logged out successfully.' });
});

// ==================== GET PROFILE (Protected) ====================
router.get('/profile', authenticate, async (req, res) => {
  try {
    const result = await db.authPool.query(
      `SELECT u.id, u.username, u.email, u.role, u.created_at, u.facility_id,
              hf.name AS facility_name, hf.barangay_name AS facility_barangay, hf.facility_type
       FROM users u
       LEFT JOIN health_facilities hf ON u.facility_id = hf.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Profile error:', error.message);
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// ==================== UPDATE PROFILE (Protected) ====================
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { username, email } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    if (!username || !email) {
      return res.status(400).json({ error: 'Username and email are required.' });
    }

    const conflict = await db.authPool.query(
      'SELECT id FROM users WHERE (LOWER(email) = $1 OR LOWER(username) = $2) AND id <> $3',
      [email.toLowerCase(), username.toLowerCase(), req.user.id]
    );
    if (conflict.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email is already in use by another account.' });
    }

    const result = await db.authPool.query(
      'UPDATE users SET username = $1, email = $2 WHERE id = $3 RETURNING id, username, email, role, created_at',
      [username.toLowerCase(), email.toLowerCase(), req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'UPDATE_PROFILE',
      targetUserId: req.user.id,
      targetUsername: username.toLowerCase(),
      result: 'SUCCESS',
      ipAddress,
      details: { newUsername: username.toLowerCase(), newEmail: email.toLowerCase() },
    });

    res.json({ message: 'Profile updated successfully.', user: result.rows[0] });
  } catch (error) {
    console.error('Update profile error:', error.message);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ==================== CHANGE PASSWORD (Protected) ====================
router.put('/password', accountActionLimiter, authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }

    const passwordErrors = validatePassword(newPassword);
    if (passwordErrors.length > 0) {
      return res.status(400).json({ error: passwordErrors.join(' ') });
    }

    const result = await db.authPool.query(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    await db.authPool.query('UPDATE users SET password_hash = $1, password_changed_at = NOW() WHERE id = $2', [hashedPassword, req.user.id]);

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'CHANGE_PASSWORD',
      targetUserId: req.user.id,
      targetUsername: req.user.username,
      result: 'SUCCESS',
      ipAddress,
    });

    res.json({ message: 'Password changed successfully.' });
  } catch (error) {
    console.error('Change password error:', error.message);
    res.status(500).json({ error: 'Failed to change password.' });
  }
});

// ==================== GET ALL USERS (Admin Only) ====================
router.get('/users', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const result = await db.authPool.query(
      `SELECT u.id, u.username, u.email, u.role, u.created_at, u.facility_id,
              hf.name AS facility_name, hf.barangay_name AS facility_barangay, hf.facility_type
       FROM users u
       LEFT JOIN health_facilities hf ON u.facility_id = hf.id
       ORDER BY u.created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (error) {
    console.error('Fetch users error:', error.message);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// ==================== UPDATE USER ROLE / FACILITY (Admin Only) ====================
router.put('/users/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role, facility_id } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    const existingResult = await db.authPool.query(
      'SELECT id, username, role, facility_id FROM users WHERE id = $1',
      [id]
    );
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const existing = existingResult.rows[0];

    const targetRole = role !== undefined && role !== null && role !== '' ? role : existing.role;
    if (!['admin', 'staff'].includes(targetRole)) {
      return res.status(400).json({ error: 'Invalid role. Must be admin or staff.' });
    }
    const roleChanged = targetRole !== existing.role;

    // Resolve the facility for the updated account:
    // - facility_id supplied explicitly (including null) wins;
    // - staff accounts keep their facility (and must have one — Admin→Staff without one fails);
    // - role change to admin without a supplied facility clears the facility to NULL.
    let nextFacilityId;
    if (facility_id !== undefined) {
      nextFacilityId = facility_id === null || facility_id === '' ? null : Number(facility_id);
    } else if (targetRole === 'staff') {
      nextFacilityId = existing.facility_id ?? null;
      if (nextFacilityId === null) {
        return res.status(400).json({ error: 'A registered health facility is required for staff accounts.' });
      }
    } else {
      // targetRole === 'admin', no facility supplied in this update
      nextFacilityId = roleChanged ? null : (existing.facility_id ?? null);
    }

    if (nextFacilityId !== null) {
      const facResult = await db.authPool.query(
        'SELECT id FROM health_facilities WHERE id = $1',
        [nextFacilityId]
      );
      if (facResult.rows.length === 0) {
        return res.status(400).json({ error: 'Unknown health facility. Select a registered facility.' });
      }
    }

    const result = await db.authPool.query(
      `UPDATE users SET role = $1, facility_id = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, username, email, role, facility_id, created_at`,
      [targetRole, nextFacilityId, id]
    );

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'UPDATE_USER',
      targetUserId: result.rows[0].id,
      targetUsername: result.rows[0].username,
      result: 'SUCCESS',
      ipAddress,
      details: {
        fromRole: existing.role,
        toRole: targetRole,
        fromFacilityId: existing.facility_id ?? null,
        toFacilityId: nextFacilityId,
      },
    });

    res.json({ message: 'User updated successfully.', user: result.rows[0] });
  } catch (error) {
    console.error('Update user error:', error.message);
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

// ==================== DELETE USER (Admin Only) ====================
router.delete('/users/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    // Fetch user before deleting for audit
    const userResult = await db.authPool.query('SELECT id, username FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const targetUser = userResult.rows[0];

    await db.authPool.query('DELETE FROM users WHERE id = $1', [id]);

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'DELETE_USER',
      targetUserId: targetUser.id,
      targetUsername: targetUser.username,
      result: 'SUCCESS',
      ipAddress,
    });

    res.json({ message: 'User deleted successfully.' });
  } catch (error) {
    console.error('Delete user error:', error.message);
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

// ==================== ADMIN RESET PASSWORD (Admin Only) ====================
router.put('/users/:id/password', accountActionLimiter, authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    const userResult = await db.authPool.query('SELECT id, username FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const targetUser = userResult.rows[0];

    // Generate secure temporary password
    const tempPassword = generateTempPassword();

    // Hash and store
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(tempPassword, salt);
    await db.authPool.query(
      'UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL, password_changed_at = NOW() WHERE id = $2',
      [hashedPassword, id]
    );

    // Log audit event (never log the password itself)
    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'PASSWORD_RESET',
      targetUserId: targetUser.id,
      targetUsername: targetUser.username,
      result: 'SUCCESS',
      ipAddress,
    });

    res.json({
      message: 'Password reset successfully.',
      tempPassword,
    });
  } catch (error) {
    console.error('Admin reset password error:', error.message);
    res.status(500).json({ error: 'Unable to reset password. Please try again.' });
  }
});

// ==================== AUDIT LOGS (Admin Only) ====================
router.get('/audit-logs', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    // Ensure audit_logs table exists
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

    const result = await db.authPool.query(
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200'
    );
    res.json({ logs: result.rows });
  } catch (error) {
    console.error('Fetch audit logs error:', error.message);
    res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
});

// ==================== NOTIFICATIONS (not yet populated) ====================
// Layout.jsx polls these every 30s to drive the bell icon. No backend flow
// creates notifications yet, so these return an explicitly empty set — the
// bell stays visible but shows nothing instead of 404-spamming the console.
// Shapes: unread-count -> {count}, list -> {notifications}.

router.get('/notifications/unread-count', authenticate, (req, res) => {
  res.json({ count: 0 });
});

router.get('/notifications', authenticate, (req, res) => {
  res.json({ notifications: [] });
});

module.exports = router;
