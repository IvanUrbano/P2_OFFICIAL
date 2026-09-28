const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT_PATHS = new Set(['/auth/login', '/auth/logout']);

/**
 * Double-submit CSRF check for the cookie-based auth path.
 * A request authenticated via `Authorization: Bearer` requires JS to read the
 * token, which a cross-site page cannot do, so it is not vulnerable to CSRF and
 * is left alone here. A request relying on the httpOnly `token` cookie is sent
 * automatically by the browser, so it must also present a matching, readable
 * `csrf_token` cookie via the `x-csrf-token` header (set on login).
 */
function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (EXEMPT_PATHS.has(req.path)) return next();

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return next();

  const cookieToken = req.cookies && req.cookies.token;
  if (!cookieToken) return next(); // no session cookie — route's own auth check will reject

  const csrfCookie = req.cookies && req.cookies.csrf_token;
  const csrfHeader = req.headers['x-csrf-token'];

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }

  next();
}

module.exports = { csrfProtection };
