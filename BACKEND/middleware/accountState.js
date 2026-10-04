/**
 * Current account state for RBAC.
 *
 * The JWT is issued at login and lives 7 days, so the role/facility inside it can be
 * stale: an admin demoted to staff, or a deactivated / locked account, would keep its
 * old access until the token expired. authenticate() therefore re-reads the account
 * from the shared users table on each request.
 *
 * A short cache (ACCOUNT_STATE_TTL_MS, default 30 s) keeps this from adding a database
 * round trip (~0.2 s on the remote database) to every API call; concurrent requests
 * for the same user share one lookup. Account changes made through this server call
 * invalidateAccount() so they apply immediately here; changes made by the other
 * server apply within the TTL.
 */

// Lazy: keeps this module loadable in unit tests that stub ../db per test.
const getPool = () => require('../db');

const TTL_MS = Number(process.env.ACCOUNT_STATE_TTL_MS ?? 30000);
const cache = new Map();    // id -> { state, expires }
const inFlight = new Map(); // id -> Promise<state|null>

async function loadAccountState(id) {
  const { rows } = await getPool().query(
    `SELECT id, role, status, manually_locked, facility_id, barangay_id
     FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] && Number(rows[0].id) === Number(id) ? rows[0] : null;
}

/** Current { id, role, status, manually_locked, facility_id, barangay_id }, or null if no such user. */
async function getAccountState(id) {
  const key = Number(id);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.state;
  if (inFlight.has(key)) return inFlight.get(key);

  const p = loadAccountState(key)
    .then((state) => {
      if (TTL_MS > 0) cache.set(key, { state, expires: Date.now() + TTL_MS });
      return state;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/**
 * Whether authenticate() checks live account state. Always on in a running server.
 * Under Node's test runner (NODE_TEST_CONTEXT is set) it is off by default, because
 * most route tests stub the database with fixed rows that are not user records;
 * tests that cover this check set ACCOUNT_STATE_CHECK=on. Outside the test runner
 * nothing can turn it off.
 */
function isAccountStateCheckEnabled() {
  const underTestRunner = Boolean(process.env.NODE_TEST_CONTEXT);
  if (!underTestRunner) return true;
  return process.env.ACCOUNT_STATE_CHECK === 'on';
}

function invalidateAccount(id) {
  cache.delete(Number(id));
}

function _clearAccountCache() {
  cache.clear();
}

module.exports = { getAccountState, invalidateAccount, isAccountStateCheckEnabled, _clearAccountCache };
