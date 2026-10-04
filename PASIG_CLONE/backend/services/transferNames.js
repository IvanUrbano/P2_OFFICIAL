/**
 * Adds facility and user names to case_transfers rows. Facilities and the current user
 * list live in TBInsight's database (AUTH_DATABASE_URL), not in this one, so they are
 * looked up there by id instead of joined in SQL.
 */
const db = require('../db/pasigSchema');

async function addTransferNames(rows) {
  if (!rows.length) return rows;
  const facilityIds = [...new Set(rows.flatMap(r => [r.from_facility_id, r.to_facility_id]).filter(v => v != null))];
  const userIds = [...new Set(rows.flatMap(r => [r.initiated_by_user_id, r.reviewed_by_user_id]).filter(v => v != null))];
  const [facilities, users] = await Promise.all([
    facilityIds.length
      ? db.authPool.query('SELECT id, name FROM health_facilities WHERE id = ANY($1::int[])', [facilityIds])
      : { rows: [] },
    userIds.length
      ? db.authPool.query('SELECT id, username FROM users WHERE id = ANY($1::int[])', [userIds])
      : { rows: [] },
  ]);
  const facilityName = new Map(facilities.rows.map(f => [f.id, f.name]));
  const username = new Map(users.rows.map(u => [u.id, u.username]));
  return rows.map(r => ({
    ...r,
    from_facility_name: r.from_facility_id != null ? facilityName.get(r.from_facility_id) || null : null,
    to_facility_name: r.to_facility_id != null ? facilityName.get(r.to_facility_id) || null : null,
    initiated_by_username: username.get(r.initiated_by_user_id) || null,
    reviewed_by_username: r.reviewed_by_user_id != null ? username.get(r.reviewed_by_user_id) || null : null,
  }));
}

module.exports = { addTransferNames };
