const jwt = require('jsonwebtoken');
const { getAccountState, isAccountStateCheckEnabled } = require('./accountState');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Middleware to verify JWT token
const authenticateToken = async (req, res, next) => {
  // Check for token in cookies first, then Authorization header
  const cookieToken = req.cookies?.token;
  const token = cookieToken || req.headers['authorization']?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    // CSRF protection: the auth cookie is SameSite=None (frontend and backend
    // are on different origins), so browsers attach it automatically even to
    // cross-site requests. A state-changing request authenticated via that
    // cookie must also echo the per-login nonce (embedded in the JWT at login
    // and handed to the frontend once, in the login response body) as the
    // x-csrf-token header — something only our own JS can know. Requests
    // authenticated via an explicit Bearer header are exempt: attaching that
    // header requires code the calling page controls, which a cross-site
    // page forging a request cannot do.
    const usedCookieAuth = token === cookieToken;
    if (usedCookieAuth && !SAFE_METHODS.has(req.method)) {
      const csrfHeader = req.headers['x-csrf-token'];
      if (!decoded.csrf || csrfHeader !== decoded.csrf) {
        return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
      }
    }
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  // RBAC uses the account's CURRENT role/status (accounts are managed from PASIG on the
  // shared users table), not the copy frozen into the 7-day token at login.
  if (!isAccountStateCheckEnabled()) return next();
  try {
    const state = await getAccountState(req.user.id);
    if (!state) {
      return res.status(401).json({ error: 'Account not found. Please sign in again.' });
    }
    if (state.status && state.status !== 'active') {
      return res.status(401).json({ error: 'This account is inactive. Contact your administrator.' });
    }
    if (state.manually_locked) {
      return res.status(401).json({ error: 'This account is locked by an administrator.' });
    }
    req.user = { ...req.user, role: state.role, facility_id: state.facility_id ?? null, barangay_id: state.barangay_id ?? null };
  } catch (err) {
    console.error('[auth] account state lookup failed:', err.message);
    return res.status(503).json({ error: 'Unable to verify your account right now. Please try again.' });
  }
  next();
};

// Middleware to check user roles
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
};

module.exports = { authenticateToken, authorizeRoles };
