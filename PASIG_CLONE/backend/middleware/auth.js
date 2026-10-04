const jwt = require('jsonwebtoken');
const config = require('../config');
const { getAccountState, isAccountStateCheckEnabled } = require('./accountState');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const cookieToken = req.cookies && req.cookies.token;
  const token = (authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookieToken);

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // RBAC uses the account's CURRENT role/status, not the copy frozen into the token
  // at login (see accountState.js): a demotion, deactivation or admin lock takes
  // effect on the next request instead of when the 7-day token expires.
  if (!isAccountStateCheckEnabled()) {
    req.user = decoded;
    return next();
  }
  try {
    const state = await getAccountState(decoded.id);
    if (!state) {
      return res.status(401).json({ error: 'Account not found. Please sign in again.' });
    }
    if (state.status && state.status !== 'active') {
      return res.status(401).json({ error: 'This account is inactive. Contact your administrator.' });
    }
    if (state.manually_locked) {
      return res.status(401).json({ error: 'This account is locked by an administrator.' });
    }
    req.user = { ...decoded, role: state.role, facility_id: state.facility_id ?? null, barangay_id: state.barangay_id ?? null };
  } catch (err) {
    // Database unreachable: deny rather than fall back to possibly stale token claims.
    console.error('[auth] account state lookup failed:', err.message);
    return res.status(503).json({ error: 'Unable to verify your account right now. Please try again.' });
  }
  next();
}

function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, authorizeRoles };
