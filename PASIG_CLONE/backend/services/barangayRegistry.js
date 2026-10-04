/**
 * Loads the official barangay list from the database (TBInsight's `barangays` table,
 * reached through AUTH_DATABASE_URL — the same reference data TBInsight uses), so adding
 * or renaming a barangay there takes effect here without a code change.
 */
const { setBarangays, PASIG_BARANGAYS } = require('./dataCleaner');

const REFRESH_MS = 10 * 60 * 1000;
let timer = null;

async function loadBarangays(authPool) {
  try {
    const res = await authPool.query('SELECT name FROM barangays ORDER BY name');
    if (setBarangays(res.rows.map(r => r.name))) {
      return { source: 'database', count: PASIG_BARANGAYS.length };
    }
    return { source: 'built-in (database list was empty)', count: PASIG_BARANGAYS.length };
  } catch (err) {
    console.error('[barangays] Could not load from database, keeping current list:', err.message);
    return { source: 'built-in (database unreachable)', count: PASIG_BARANGAYS.length };
  }
}

function startBarangayRefresh(authPool) {
  if (timer) return;
  timer = setInterval(() => { loadBarangays(authPool); }, REFRESH_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = { loadBarangays, startBarangayRefresh };
