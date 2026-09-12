const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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

// ==================== REGISTER (Admin Only) ====================
router.post('/register', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { username, email, role } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    if (!username || !email) {
      return res.status(400).json({ error: 'Username and email are required.' });
    }

    const userRole = role || 'staff';
    if (!['admin', 'staff'].includes(userRole)) {
      return res.status(400).json({ error: 'Invalid role. Must be admin or staff.' });
    }

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'User with this email or username already exists.' });
    }

    // Generate secure temporary password
    const tempPassword = generateTempPassword();

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(tempPassword, salt);

    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash, role, password_changed_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id, username, email, role, created_at',
      [username, email, hashedPassword, userRole]
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

    // Find user
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR email = $1 LIMIT 1',
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

    // Success — reset lockout and log
    await resetFailedAttempts(username);
    await logLoginAttempt(username, ipAddress, true);

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // Set token in httpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Check if password was changed within the last 24 hours
    const recentlyChanged = user.password_changed_at &&
      (Date.now() - new Date(user.password_changed_at).getTime()) < 24 * 60 * 60 * 1000;

    res.json({
      message: 'Login successful.',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
      },
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
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.json({ message: 'Logged out successfully.' });
});

// ==================== GET PROFILE (Protected) ====================
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ user: result.rows[0] });
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
    await pool.query('UPDATE users SET password_hash = $1, password_changed_at = NOW() WHERE id = $2', [hashedPassword, req.user.id]);

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Change password error:', err.message);
    res.status(500).json({ error: 'Server error changing password.' });
  }
});

// ==================== GET ALL USERS (Admin Only) ====================
router.get('/users', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error('Fetch users error:', err.message);
    res.status(500).json({ error: 'Server error fetching users.' });
  }
});

// ==================== DELETE USER (Admin Only) ====================
router.delete('/users/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ message: 'User deleted successfully.' });
  } catch (err) {
    console.error('Delete user error:', err.message);
    res.status(500).json({ error: 'Server error deleting user.' });
  }
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
  } catch (err) {
    console.error('Admin reset password error:', err.message);
    res.status(500).json({ error: 'Unable to reset password. Please try again.' });
  }
});

module.exports = router;
