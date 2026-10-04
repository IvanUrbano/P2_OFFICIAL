/**
 * In-app notifications (the bell in the header). Table: notifications (migration 012).
 *
 * Recipients are resolved from the auth database's users table:
 *   - barangay staff  -> active staff whose barangay_id matches
 *   - admins          -> active admins (city-wide)
 * The acting user is never notified about their own action.
 *
 * Messages carry case IDs only — never patient names or dates of birth (those stay
 * behind the Records PIN). Creating a notification never fails the request that caused
 * it: errors are logged and swallowed.
 */
const db = require('../db/pasigSchema');

const SEVERITIES = new Set(['info', 'success', 'warning', 'danger']);

async function activeUsers(where, params) {
  const r = await db.authPool.query(
    `SELECT id FROM users WHERE COALESCE(status, 'active') = 'active' AND ${where}`,
    params
  );
  return r.rows.map(u => Number(u.id));
}

/** Active staff assigned to a barangay. */
function barangayStaff(barangayId) {
  if (barangayId == null) return Promise.resolve([]);
  return activeUsers(`role = 'staff' AND barangay_id = $1`, [Number(barangayId)]);
}

/** Active admins. */
function admins() {
  return activeUsers(`role = 'admin'`, []);
}

/**
 * Create one notification per recipient.
 * @param {number[]} userIds
 * @param {{type:string, title:string, message?:string, severity?:string, link?:string,
 *          entityType?:string, entityId?:string|number, actorId?:number}} n
 * @returns {Promise<number>} rows created
 */
async function notify(userIds, n) {
  try {
    const actor = n.actorId != null ? Number(n.actorId) : null;
    const ids = [...new Set((userIds || []).map(Number))].filter(id => Number.isInteger(id) && id > 0 && id !== actor);
    if (ids.length === 0) return 0;
    const severity = SEVERITIES.has(n.severity) ? n.severity : 'info';
    const r = await db.pool.query(
      `INSERT INTO notifications (user_id, type, severity, title, message, link, entity_type, entity_id, actor_user_id)
       SELECT u, $2, $3, $4, $5, $6, $7, $8, $9 FROM unnest($1::int[]) AS u`,
      [ids, n.type, severity, String(n.title).slice(0, 200), n.message ?? null, n.link ?? null,
        n.entityType ?? null, n.entityId != null ? String(n.entityId) : null, actor]
    );
    return r.rowCount;
  } catch (err) {
    console.error('[notifications] create failed:', err.message);
    return 0;
  }
}

/** Notify a barangay's staff; falls back to admins when the barangay has no active staff. */
async function notifyBarangay(barangayId, n) {
  try {
    const staff = await barangayStaff(barangayId);
    return notify(staff.length ? staff : await admins(), n);
  } catch (err) {
    console.error('[notifications] recipient lookup failed:', err.message);
    return 0;
  }
}

async function notifyAdmins(n) {
  try {
    return notify(await admins(), n);
  } catch (err) {
    console.error('[notifications] recipient lookup failed:', err.message);
    return 0;
  }
}

/** Mark notifications about an entity as read for everyone (e.g. a referral that was handled). */
async function resolveEntity(entityType, entityId, types) {
  try {
    await db.pool.query(
      `UPDATE notifications SET is_read = true, read_at = NOW()
       WHERE entity_type = $1 AND entity_id = $2 AND is_read = false
         AND ($3::text[] IS NULL OR type = ANY($3::text[]))`,
      [entityType, String(entityId), types || null]
    );
  } catch (err) {
    console.error('[notifications] resolve failed:', err.message);
  }
}

module.exports = { notify, notifyBarangay, notifyAdmins, resolveEntity, barangayStaff, admins };
