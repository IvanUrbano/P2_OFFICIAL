// "Last Synced" label for the top bar. The value is lastSynced from GET /api/tb/data-freshness
// (when data last arrived from PASIG TB-IS), the same source the Dashboard and Settings use.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * @param {string|null|undefined} value - lastSynced timestamp; undefined = not loaded yet,
 *   null = no sync recorded.
 * @param {{failed?: boolean}} [opts] - failed: the freshness request failed.
 */
export function formatSyncStamp(value, { failed = false } = {}) {
  if (failed) return 'Unavailable';
  if (value === undefined) return 'Loading…';
  if (value === null || value === '') return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Unavailable';
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} | ${time}`;
}
