/**
 * Display names for user ids stored in this database (uploaded_by, validated_by,
 * initiated_by, ...). Accounts live in the shared auth database (AUTH_DATABASE_URL), so
 * names are looked up there by id — never joined against a local `users` table (an old
 * leftover one in the PASIG database maps ids to the wrong people, e.g. "admin"/"staff").
 *
 * Name shown = full name, else username. Unknown / deleted ids give null.
 */
const db = require('../db/pasigSchema');

async function lookupUsers(ids) {
  const unique = [...new Set(ids.filter(v => v !== null && v !== undefined).map(Number))].filter(Number.isInteger);
  if (unique.length === 0) return new Map();
  const r = await db.authPool.query(
    'SELECT id, username, full_name FROM users WHERE id = ANY($1::int[])',
    [unique]
  );
  return new Map(r.rows.map(u => [Number(u.id), {
    username: u.username,
    name: (u.full_name && String(u.full_name).trim()) || u.username,
  }]));
}

/**
 * Add names to rows.
 * @param rows
 * @param fields  { idColumn: outputColumn } — e.g. { uploaded_by: 'imported_by_username' }.
 *                outputColumn gets the display name; `${outputColumn}_login` gets the username.
 */
async function withUserNames(rows, fields) {
  if (!rows || rows.length === 0) return rows || [];
  const users = await lookupUsers(rows.flatMap(r => Object.keys(fields).map(k => r[k])));
  return rows.map(r => {
    const out = { ...r };
    for (const [idCol, outCol] of Object.entries(fields)) {
      const u = r[idCol] != null ? users.get(Number(r[idCol])) : null;
      out[outCol] = u ? u.name : null;
      out[`${outCol}_login`] = u ? u.username : null;
    }
    return out;
  });
}

module.exports = { lookupUsers, withUserNames };
