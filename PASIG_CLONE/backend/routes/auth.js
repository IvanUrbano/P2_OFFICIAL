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
const { notify } = require('../services/notifications');
const { invalidateAccount } = require('../middleware/accountState');
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

// ==================== ASSIGNMENT HELPERS ====================
// Staff accounts are assigned to a BARANGAY (required); admins are city-wide (no
// barangay). The legacy facility_id is no longer set from the Users page but is kept
// on existing accounts (transfers still use it).

const USER_SELECT = `
  SELECT u.id, u.username, u.full_name, u.email, u.role, u.status, u.last_login_at,
         u.must_change_password, u.created_at, u.updated_at, u.facility_id, u.barangay_id,
         u.failed_attempts, u.locked_until, u.manually_locked, u.locked_at,
         (u.manually_locked OR (u.locked_until IS NOT NULL AND u.locked_until > NOW())) AS is_locked,
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
const USER_STATUSES = ['active', 'inactive'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Optional email: '' / null -> null; otherwise lowercased and format-checked. */
function cleanOptionalEmail(email) {
  if (isBlank(email) || String(email).trim() === '') return { email: null };
  const e = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return { error: 'Enter a valid email address or leave it blank.' };
  return { email: e };
}

/** Resolves barangay ids to names for audit details: { 17: 'Rosario', ... }. */
async function barangayNamesFor(ids) {
  const wanted = [...new Set(ids.filter((v) => v !== null && v !== undefined))];
  if (wanted.length === 0) return {};
  const found = await db.authPool.query('SELECT id, name FROM barangays WHERE id = ANY($1::int[])', [wanted]);
  const names = {};
  for (const row of found.rows) names[row.id] = row.name;
  return names;
}

/** Validates an optional id against a reference table; returns { id } or { error }. */
async function checkReference(table, value, label) {
  if (isBlank(value)) return { id: null };
  const id = Number(value);
  if (!Number.isInteger(id)) return { error: `Invalid ${label}.` };
  const found = await db.authPool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
  if (found.rows.length === 0) return { error: `Unknown ${label}. Select a registered ${label}.` };
  return { id };
}

// ==================== REGISTER (Admin Only) ====================
router.post('/register', accountActionLimiter, authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { full_name, username, email, role, barangay_id } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    const fullName = String(full_name ?? '').trim().replace(/\s+/g, ' ');
    const cleanUsername = username?.trim().toLowerCase();
    if (!fullName || !cleanUsername) {
      return res.status(400).json({ error: 'Full name and username are required.' });
    }
    if (!/^[a-z0-9._-]{3,50}$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'Username must be 3-50 characters: letters, numbers, dot, dash or underscore.' });
    }
    const { email: cleanEmail, error: emailError } = cleanOptionalEmail(email);
    if (emailError) return res.status(400).json({ error: emailError });

    const userRole = role || 'staff';
    if (!['admin', 'staff'].includes(userRole)) {
      return res.status(400).json({ error: 'Invalid role. Must be admin or staff.' });
    }

    const existing = await db.authPool.query(
      'SELECT id FROM users WHERE LOWER(username) = $1 OR ($2::text IS NOT NULL AND LOWER(email) = $2)',
      [cleanUsername, cleanEmail]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email already exists.' });
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

    // System-generated temporary password; the user must replace it at first login.
    const tempPassword = generateTempPassword();

    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    const result = await db.authPool.query(
      `INSERT INTO users (full_name, username, email, password_hash, role, barangay_id,
                          status, must_change_password, password_changed_at, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', TRUE, NOW(), $7)
       RETURNING id, full_name, username, email, role, barangay_id, status,
                 must_change_password, created_at, created_by_user_id`,
      [fullName, cleanUsername, cleanEmail, hashedPassword, userRole, barangayId, req.user.id]
    );

    const newUser = result.rows[0];

    // Log audit event (never log the password itself)
    const createdBarangayNames = await barangayNamesFor([barangayId]);
    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'USER_CREATED',
      targetUserId: newUser.id,
      targetUsername: newUser.username,
      result: 'SUCCESS',
      ipAddress,
      actorRole: req.user.role,
      details: {
        role: userRole,
        barangayId,
        barangayName: barangayId ? (createdBarangayNames[barangayId] || null) : null,
        access: barangayId ? 'barangay' : 'city-wide',
      },
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

    // Deactivated accounts cannot sign in (checked after the password so the response
    // does not reveal which usernames exist).
    if (user.status && user.status !== 'active') {
      await logLoginAttempt(cleanUsername, ipAddress, false);
      return res.status(403).json({ error: 'This account is inactive. Contact your administrator.' });
    }
    // Locked by an administrator (separate from the automatic failed-login lockout above).
    if (user.manually_locked) {
      await logLoginAttempt(cleanUsername, ipAddress, false);
      return res.status(423).json({ error: 'This account is locked by an administrator. Contact your administrator.' });
    }

    // Success — reset lockout and log
    await resetFailedAttempts(cleanUsername);
    await logLoginAttempt(cleanUsername, ipAddress, true);
    await db.authPool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

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

    // Assignment context for the logged-in user: barangay (staff) + optional facility.
    let facility = null;
    let barangay = null;
    const ctx = await db.authPool.query(
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
        facility_id: user.facility_id || null,
        facility,
        barangay_id: barangay?.id ?? null,
        barangay,
        full_name: user.full_name || null,
        must_change_password: Boolean(user.must_change_password),
      },
      // Temporary (system-generated) password still in use: the client sends the user
      // to Settings > Security to set their own before continuing.
      mustChangePassword: Boolean(user.must_change_password),
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
    const result = await db.authPool.query(`${USER_SELECT} WHERE u.id = $1`, [req.user.id]);

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

    if (!username) {
      return res.status(400).json({ error: 'Username is required.' });
    }
    // Email is optional: blank clears it.
    const { email: cleanEmail, error: emailError } = cleanOptionalEmail(email);
    if (emailError) return res.status(400).json({ error: emailError });

    const conflict = await db.authPool.query(
      'SELECT id FROM users WHERE (($1::text IS NOT NULL AND LOWER(email) = $1) OR LOWER(username) = $2) AND id <> $3',
      [cleanEmail, username.toLowerCase(), req.user.id]
    );
    if (conflict.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email is already in use by another account.' });
    }

    const result = await db.authPool.query(
      'UPDATE users SET username = $1, email = $2 WHERE id = $3 RETURNING id, username, email, role, created_at',
      [username.toLowerCase(), cleanEmail, req.user.id]
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
      details: { newUsername: username.toLowerCase(), newEmail: cleanEmail },
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
    await db.authPool.query(
      'UPDATE users SET password_hash = $1, password_changed_at = NOW(), must_change_password = FALSE WHERE id = $2',
      [hashedPassword, req.user.id]
    );

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
    const result = await db.authPool.query(`${USER_SELECT} ORDER BY u.created_at DESC`);
    res.json({ users: result.rows });
  } catch (error) {
    console.error('Fetch users error:', error.message);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// ==================== UPDATE USER (Admin Only) ====================
// Editable: full_name, email (optional), role, barangay_id (staff only), status.
// Fields left out of the request keep their current value. Admins are city-wide, so
// their barangay is always stored as NULL. facility_id is not touched (legacy field).
router.put('/users/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, role, barangay_id, status } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    const existingResult = await db.authPool.query(
      'SELECT id, username, full_name, email, role, barangay_id, status FROM users WHERE id = $1',
      [id]
    );
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const existing = existingResult.rows[0];
    const isSelf = Number(id) === Number(req.user.id);

    const targetRole = isBlank(role) ? existing.role : role;
    if (!['admin', 'staff'].includes(targetRole)) {
      return res.status(400).json({ error: 'Invalid role. Must be admin or staff.' });
    }
    const targetStatus = isBlank(status) ? (existing.status || 'active') : status;
    if (!USER_STATUSES.includes(targetStatus)) {
      return res.status(400).json({ error: 'Invalid status. Must be active or inactive.' });
    }
    if (isSelf && targetStatus !== 'active') {
      return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    }
    if (isSelf && targetRole !== 'admin') {
      return res.status(400).json({ error: 'You cannot remove your own admin role.' });
    }

    let nextFullName = existing.full_name;
    if (full_name !== undefined) {
      nextFullName = String(full_name ?? '').trim().replace(/\s+/g, ' ');
      if (!nextFullName) return res.status(400).json({ error: 'Full name is required.' });
    }

    let nextEmail = existing.email;
    if (email !== undefined) {
      const cleaned = cleanOptionalEmail(email);
      if (cleaned.error) return res.status(400).json({ error: cleaned.error });
      nextEmail = cleaned.email;
      if (nextEmail) {
        const taken = await db.authPool.query(
          'SELECT 1 FROM users WHERE LOWER(email) = $1 AND id <> $2', [nextEmail, id]
        );
        if (taken.rows.length > 0) return res.status(409).json({ error: 'Email is already in use by another account.' });
      }
    }

    let nextBarangayId = null;
    if (targetRole === 'staff') {
      const brgy = await checkReference('barangays', barangay_id !== undefined ? barangay_id : existing.barangay_id, 'barangay');
      if (brgy.error) return res.status(400).json({ error: brgy.error });
      if (brgy.id === null) {
        return res.status(400).json({ error: 'An assigned barangay is required for staff accounts.' });
      }
      nextBarangayId = brgy.id;
    }

    const result = await db.authPool.query(
      `UPDATE users
       SET full_name = $1, email = $2, role = $3, barangay_id = $4, status = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING id, full_name, username, email, role, barangay_id, status, created_at`,
      [nextFullName, nextEmail, targetRole, nextBarangayId, targetStatus, id]
    );
    invalidateAccount(id);

    // One audit event per concern that actually changed — no duplicate/parent rows.
    const auditBase = {
      userId: req.user.id,
      username: req.user.username,
      targetUserId: result.rows[0].id,
      targetUsername: result.rows[0].username,
      result: 'SUCCESS',
      ipAddress,
      actorRole: req.user.role,
    };
    const nameChanged = (existing.full_name || null) !== (nextFullName || null);
    const emailChanged = (existing.email || null) !== (nextEmail || null);
    const roleChanged = existing.role !== targetRole;
    const barangayChanged = (existing.barangay_id ?? null) !== nextBarangayId;
    const statusChanged = (existing.status ?? null) !== targetStatus;

    if (nameChanged || emailChanged) {
      await logAuditEvent({
        ...auditBase,
        action: 'USER_UPDATED',
        details: {
          old: { full_name: existing.full_name || null, email: existing.email || null },
          new: { full_name: nextFullName || null, email: nextEmail || null },
        },
      });
    }
    if (roleChanged) {
      await logAuditEvent({
        ...auditBase,
        action: 'ROLE_CHANGED',
        details: { old: existing.role, new: targetRole },
      });
    }
    if (barangayChanged) {
      const names = await barangayNamesFor([existing.barangay_id, nextBarangayId]);
      await logAuditEvent({
        ...auditBase,
        action: 'BARANGAY_ASSIGNMENT_CHANGED',
        details: {
          old: existing.barangay_id != null ? (names[existing.barangay_id] || null) : null,
          new: nextBarangayId != null ? (names[nextBarangayId] || null) : null,
          oldId: existing.barangay_id ?? null,
          newId: nextBarangayId,
        },
      });
    }
    if (statusChanged) {
      await logAuditEvent({
        ...auditBase,
        action: targetStatus === 'active' ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_DEACTIVATED',
        details: { old: existing.status ?? null, new: targetStatus },
      });
    }
    if (roleChanged || barangayChanged) {
      const names = nextBarangayId != null ? await barangayNamesFor([nextBarangayId]) : {};
      await notify([result.rows[0].id], {
        type: 'account_updated', severity: 'info', actorId: req.user.id,
        title: 'Your access was updated',
        message: targetRole === 'admin'
          ? 'You are now an administrator with city-wide access.'
          : `You are now assigned to Barangay ${names[nextBarangayId] || ''}. You see and manage TB cases assigned to that barangay.`,
        link: '/records', entityType: 'user', entityId: result.rows[0].id,
      });
    }

    res.json({ message: 'User updated successfully.', user: result.rows[0] });
  } catch (error) {
    console.error('Update user error:', error.message);
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

// ==================== ACTIVATE / DEACTIVATE (Admin Only) ====================
// Only the account's status changes; nothing the user entered or reviewed is touched.
router.patch('/users/:id/status', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    if (!USER_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be active or inactive.' });
    }
    if (Number(id) === Number(req.user.id) && status !== 'active') {
      return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    }

    const existing = await db.authPool.query('SELECT status FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    const previousStatus = existing.rows[0].status ?? null;

    const result = await db.authPool.query(
      `UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, username, status`,
      [status, id]
    );
    invalidateAccount(id);

    if (previousStatus !== status) {
      await logAuditEvent({
        userId: req.user.id,
        username: req.user.username,
        action: status === 'active' ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_DEACTIVATED',
        targetUserId: result.rows[0].id,
        targetUsername: result.rows[0].username,
        result: 'SUCCESS',
        ipAddress,
        actorRole: req.user.role,
        details: { old: previousStatus, new: status },
      });
    }

    res.json({
      message: status === 'active' ? 'Account activated.' : 'Account deactivated.',
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Update user status error:', error.message);
    res.status(500).json({ error: 'Failed to update account status.' });
  }
});

// ==================== LOCK ACCOUNT (Admin Only) ====================
// Holds the account until an administrator unlocks it. Unlike deactivation this is a
// temporary security measure; neither removes the user or their audit history.
router.post('/users/:id/lock', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    if (Number(id) === Number(req.user.id)) {
      return res.status(400).json({ error: 'You cannot lock your own account.' });
    }

    const result = await db.authPool.query(
      `UPDATE users SET manually_locked = TRUE, locked_at = NOW(), locked_by_user_id = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, username`,
      [id, req.user.id]
    );
    invalidateAccount(id);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'ACCOUNT_LOCKED',
      targetUserId: result.rows[0].id,
      targetUsername: result.rows[0].username,
      result: 'SUCCESS',
      ipAddress,
      actorRole: req.user.role,
    });

    res.json({ message: 'Account locked.', user: result.rows[0] });
  } catch (error) {
    console.error('Lock user error:', error.message);
    res.status(500).json({ error: 'Failed to lock account.' });
  }
});

// ==================== UNLOCK ACCOUNT (Admin Only) ====================
// Clears both an administrator lock and the automatic lockout from repeated wrong
// passwords (5 attempts -> 15 minutes).
router.post('/users/:id/unlock', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    const result = await db.authPool.query(
      `UPDATE users
       SET failed_attempts = 0, locked_until = NULL,
           manually_locked = FALSE, locked_at = NULL, locked_by_user_id = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, username`,
      [id]
    );
    invalidateAccount(id);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'ACCOUNT_UNLOCKED',
      targetUserId: result.rows[0].id,
      targetUsername: result.rows[0].username,
      result: 'SUCCESS',
      ipAddress,
      actorRole: req.user.role,
    });

    res.json({ message: 'Account unlocked.', user: result.rows[0] });
  } catch (error) {
    console.error('Unlock user error:', error.message);
    res.status(500).json({ error: 'Failed to unlock account.' });
  }
});

// ==================== DELETE USER — DISABLED ====================
// Accounts are never deleted: audit logs, imports, reviews and records reference the
// user who made them. Use PATCH /users/:id/status (deactivate) instead.
router.delete('/users/:id', authenticate, authorizeRoles('admin'), (req, res) => {
  res.status(405).json({ error: 'User accounts cannot be deleted. Deactivate the account instead.' });
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
      'UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL, password_changed_at = NOW(), must_change_password = TRUE WHERE id = $2',
      [hashedPassword, id]
    );

    await notify([targetUser.id], {
      type: 'account_updated', severity: 'warning', actorId: req.user.id,
      title: 'Your password was reset',
      message: `An administrator (${req.user.username}) reset your password. If you did not ask for this, tell your administrator.`,
      link: '/settings', entityType: 'user', entityId: targetUser.id,
    });

    // Log audit event (never log the password itself)
    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'PASSWORD_RESET',
      targetUserId: targetUser.id,
      targetUsername: targetUser.username,
      result: 'SUCCESS',
      ipAddress,
      actorRole: req.user.role,
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
// Schema is owned by utils/auditLogger.js (CREATE + ALTERs on every write); this
// endpoint only reads. Actor/target display names and the actor's role come from
// users joins so entries read like "Juan Reyes (Admin)" instead of raw usernames.
router.get('/audit-logs', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const result = await db.authPool.query(
      `SELECT a.*,
              COALESCE(NULLIF(au.full_name, ''), au.username) AS actor_full_name,
              au.role AS actor_role,
              COALESCE(NULLIF(tu.full_name, ''), tu.username) AS target_full_name,
              tu.role AS target_role
       FROM audit_logs a
       LEFT JOIN users au ON au.id = a.user_id
       LEFT JOIN users tu ON tu.id = a.target_user_id
       ORDER BY a.created_at DESC
       LIMIT 200`
    );
    res.json({ logs: result.rows });
  } catch (error) {
    console.error('Fetch audit logs error:', error.message);
    res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
});

// ==================== NOTIFICATIONS ====================
// The header bell (Layout.jsx) and the Notifications page. See routes/notifications.js;
// notifications are created by services/notifications.js.
router.use('/notifications', require('./notifications'));

module.exports = router;
