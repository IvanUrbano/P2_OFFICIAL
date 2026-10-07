const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');
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

const router = express.Router();

// Staff accounts are assigned to a BARANGAY (required); a health facility is optional.
// Admin accounts need neither.
const USER_SELECT = `
  SELECT u.id, u.username, u.full_name, u.email, u.role, u.status, u.last_login_at,
         u.must_change_password, u.created_at, u.facility_id, u.barangay_id,
         b.name AS barangay_name,
         hf.name AS facility_name, hf.barangay_name AS facility_barangay, hf.facility_type,
         u.created_by_user_id,
         COALESCE(NULLIF(cb.full_name, ''), cb.username) AS created_by_name,
         cb.username AS created_by_username
  FROM users u
  LEFT JOIN barangays b ON b.id = u.barangay_id
  LEFT JOIN health_facilities hf ON u.facility_id = hf.id
  LEFT JOIN users cb ON cb.id = u.created_by_user_id`;

const isBlank = (v) => v === undefined || v === null || v === '';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Optional email: '' / null -> null; otherwise lowercased and format-checked. */
function cleanOptionalEmail(email) {
  if (isBlank(email) || String(email).trim() === '') return { email: null };
  const e = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return { error: 'Enter a valid email address or leave it blank.' };
  return { email: e };
}

/** Validates an optional id against a reference table; returns { id } or { error }. */
async function checkReference(table, value, label) {
  if (isBlank(value)) return { id: null };
  const id = Number(value);
  if (!Number.isInteger(id)) return { error: `Invalid ${label}.` };
  const found = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
  if (found.rows.length === 0) return { error: `Unknown ${label}. Select a registered ${label}.` };
  return { id };
}

// ==================== REGISTER (Admin Only) ====================
router.post('/register', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { full_name, username, email, role, barangay_id } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    // Full name is optional here for older API clients; the PASIG Users page requires it.
    const fullName = String(full_name ?? '').trim().replace(/\s+/g, ' ') || null;
    if (!username) {
      return res.status(400).json({ error: 'Username is required.' });
    }
    const { email: cleanEmail, error: emailError } = cleanOptionalEmail(email);
    if (emailError) return res.status(400).json({ error: emailError });

    const userRole = role || 'staff';
    if (!['admin', 'staff'].includes(userRole)) {
      return res.status(400).json({ error: 'Invalid role. Must be admin or staff.' });
    }

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE ($1::text IS NOT NULL AND LOWER(email) = $1) OR LOWER(username) = LOWER($2)',
      [cleanEmail, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'User with this email or username already exists.' });
    }

    // Staff: assigned barangay required. Admin: city-wide, barangay always NULL.
    let barangayId = null;
    if (userRole === 'staff') {
      const brgy = await checkReference('barangays', barangay_id, 'barangay');
      if (brgy.error) return res.status(400).json({ error: brgy.error });
      if (brgy.id === null) {
        return res.status(400).json({ error: 'An assigned barangay is required for staff accounts.' });
      }
      barangayId = brgy.id;
    }

    // Generate secure temporary password
    const tempPassword = generateTempPassword();

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(tempPassword, salt);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role, barangay_id, full_name,
                          status, must_change_password, password_changed_at, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', TRUE, NOW(), $7)
       RETURNING id, username, full_name, email, role, barangay_id, status,
                 must_change_password, created_at, created_by_user_id`,
      [username, cleanEmail, hashedPassword, userRole, barangayId, fullName, req.user.id]
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
      details: { role: userRole, barangayId, access: barangayId ? 'barangay' : 'city-wide' },
    });

    res.status(201).json({
      message: 'User created successfully.',
      user: newUser,
      tempPassword,
    });
  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ error: 'Unable to create user. Please try again.' });
  }
});

// ==================== LOGIN ====================
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const username = email;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username/email and password are required.' });
    }

    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    // Check if account is locked
    if (await isAccountLocked(username)) {
      const remaining = await getLockoutRemaining(username);
      return res.status(423).json({
        error: 'Account temporarily locked due to too many failed attempts. Please try again later.',
        retryAfter: remaining,
      });
    }

// Find user by username or email (case-insensitive)
const result = await pool.query(
  'SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1',
  [username]
);

    if (result.rows.length === 0) {
      await logLoginAttempt(username, ipAddress, false);
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = result.rows[0];

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password_hash || user.password);

    if (!isMatch) {
      await logLoginAttempt(username, ipAddress, false);
      const { locked } = await recordFailedAttempt(username, ipAddress);
      if (locked) {
        const remaining = await getLockoutRemaining(username);
        return res.status(423).json({
          error: 'Account temporarily locked due to too many failed attempts. Please try again later.',
          retryAfter: remaining,
        });
      }
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // Deactivated accounts cannot sign in (checked after the password so the response
    // does not reveal which usernames exist).
    if (user.status && user.status !== 'active') {
      await logLoginAttempt(username, ipAddress, false);
      return res.status(403).json({ error: 'This account is inactive. Contact your administrator.' });
    }
    // Locked by an administrator (separate from the automatic failed-login lockout).
    if (user.manually_locked) {
      await logLoginAttempt(username, ipAddress, false);
      return res.status(423).json({ error: 'This account is locked by an administrator. Contact your administrator.' });
    }

    // Success — reset lockout and log
    await resetFailedAttempts(username);
    await logLoginAttempt(username, ipAddress, true);
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    // Generate JWT — includes a per-login CSRF nonce (see middleware/auth.js)
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role, csrf: csrfToken },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // Set token in httpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // This notice is only for an outstanding temporary/admin-reset password.
    // A user's own password change also updates password_changed_at, but clears
    // must_change_password and must not show the reset notice at later logins.
    const recentlyChanged = Boolean(user.must_change_password && user.password_changed_at &&
      (Date.now() - new Date(user.password_changed_at).getTime()) < 24 * 60 * 60 * 1000);

    // Assignment context for the logged-in user: barangay (staff) + optional facility.
    let facility = null;
    let barangay = null;
    const ctx = await pool.query(
      `SELECT u.barangay_id, b.name AS barangay_name,
              hf.id AS facility_id, hf.name AS facility_name,
              hf.barangay_name AS facility_barangay, hf.facility_type
       FROM users u
       LEFT JOIN barangays b ON b.id = u.barangay_id
       LEFT JOIN health_facilities hf ON hf.id = u.facility_id
       WHERE u.id = $1`,
      [user.id]
    );
    const c = ctx.rows[0];
    if (c?.barangay_id) barangay = { id: c.barangay_id, name: c.barangay_name };
    if (c?.facility_id) {
      facility = { id: c.facility_id, name: c.facility_name, barangay_name: c.facility_barangay, facility_type: c.facility_type };
    }

    res.json({
      message: 'Login successful.',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
        facility_id: user.facility_id || null,
        facility,
        barangay_id: barangay?.id ?? null,
        barangay,
        full_name: user.full_name || null,
        must_change_password: Boolean(user.must_change_password),
      },
      mustChangePassword: Boolean(user.must_change_password),
      csrfToken,
      passwordRecentlyChanged: recentlyChanged,
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// ==================== LOGOUT ====================
router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
  });
  res.json({ message: 'Logged out successfully.' });
});

// ==================== GET PROFILE (Protected) ====================
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`${USER_SELECT} WHERE u.id = $1`, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const photo = await pool.query('SELECT profile_photo_data FROM users WHERE id = $1', [req.user.id]);
    res.json({ user: { ...result.rows[0], profile_photo_data: photo.rows[0]?.profile_photo_data || null } });
  } catch (err) {
    console.error('Profile error:', err.message);
    res.status(500).json({ error: 'Server error fetching profile.' });
  }
});

// ==================== UPDATE PROFILE (Protected) ====================
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { username, email } = req.body;

    if (!username || !email) {
      return res.status(400).json({ error: 'Username and email are required.' });
    }

    const conflict = await pool.query(
      'SELECT id FROM users WHERE (email = $1 OR username = $2) AND id <> $3',
      [email, username, req.user.id]
    );
    if (conflict.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email is already in use by another account.' });
    }

    const result = await pool.query(
      'UPDATE users SET username = $1, email = $2 WHERE id = $3 RETURNING id, username, email, role, created_at',
      [username, email, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ message: 'Profile updated successfully.', user: result.rows[0] });
  } catch (err) {
    console.error('Update profile error:', err.message);
    res.status(500).json({ error: 'Server error updating profile.' });
  }
});

// ==================== CHANGE PASSWORD (Protected) ====================
router.put('/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }

    const passwordErrors = validatePassword(newPassword);
    if (passwordErrors.length > 0) {
      return res.status(400).json({ error: passwordErrors.join(' ') });
    }

    const result = await pool.query(
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
    await pool.query(
      'UPDATE users SET password_hash = $1, password_changed_at = NOW(), must_change_password = FALSE WHERE id = $2',
      [hashedPassword, req.user.id]
    );

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Change password error:', err.message);
    res.status(500).json({ error: 'Server error changing password.' });
  }
});

// ==================== GET ALL USERS (Admin Only) ====================
router.get('/users', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const result = await pool.query(`${USER_SELECT} ORDER BY u.created_at DESC`);
    res.json({ users: result.rows });
  } catch (err) {
    console.error('Fetch users error:', err.message);
    res.status(500).json({ error: 'Server error fetching users.' });
  }
});

// ==================== DELETE USER — DISABLED ====================
// Accounts are never deleted: audit logs and records reference the user who made them.
// Deactivate the account instead (managed from the PASIG Users page).
router.delete('/users/:id', authenticateToken, authorizeRoles('admin'), (req, res) => {
  res.status(405).json({ error: 'User accounts cannot be deleted. Deactivate the account instead.' });
});

// ==================== ADMIN RESET PASSWORD (Admin Only) ====================
router.put('/users/:id/password', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    const userResult = await pool.query('SELECT id, username FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const targetUser = userResult.rows[0];

    // Generate secure temporary password
    const tempPassword = generateTempPassword();

    // Hash and store
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(tempPassword, salt);
    await pool.query(
      'UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL, password_changed_at = NOW(), must_change_password = TRUE WHERE id = $2',
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
  } catch (err) {
    console.error('Admin reset password error:', err.message);
    res.status(500).json({ error: 'Unable to reset password. Please try again.' });
  }
});

module.exports = router;
