/**
 * Loads the official barangay list from the database (TBInsight's `barangays` table,
 * reached through AUTH_DATABASE_URL — the same reference data TBInsight uses), so adding
 * or renaming a barangay there takes effect here without a code change.
 *
 * It also mirrors (id, name) into this database's `barangay_ref` table (migration 006)
 * and fills the barangay id columns on cases and referrals from their names. Triggers
 * keep those ids current on every write; the fill here covers rows written before the
 * mirror existed, or while a barangay was missing from it.
 *
 * Health facilities are mirrored the same way into `facility_ref` (migration 007), and
 * each case's treatment/screening facility id is refreshed from its facility name
 * (directly, or through a mapping in facility_aliases).
 */
const { setBarangays, PASIG_BARANGAYS } = require('./dataCleaner');

const REFRESH_MS = 10 * 60 * 1000;
let timer = null;

// Each statement only touches rows whose id is missing or no longer matches the name,
// so after the first run these are cheap no-ops.
const FILL_IDS_SQL = [
  `UPDATE validated_tb_cases v SET barangay_id = r.id
     FROM barangay_ref r
    WHERE lower(trim(v.barangay_name)) = lower(r.name) AND v.barangay_id IS NULL`,
  `UPDATE validated_tb_cases v SET responsible_barangay_id = r.id
     FROM barangay_ref r
    WHERE lower(trim(v.responsible_barangay)) = lower(r.name) AND v.responsible_barangay_id IS NULL`,
  `UPDATE case_transfers t SET from_barangay_id = r.id
     FROM barangay_ref r
    WHERE lower(trim(t.from_barangay)) = lower(r.name) AND t.from_barangay_id IS NULL`,
  `UPDATE case_transfers t SET to_barangay_id = r.id
     FROM barangay_ref r
    WHERE lower(trim(t.to_barangay)) = lower(r.name) AND t.to_barangay_id IS NULL`,
];

/** Mirror (id, name) into barangay_ref and fill the id columns. Never deletes. */
async function syncBarangayRef(pool, rows) {
  const withIds = rows.filter(r => r.id != null && r.name);
  if (!pool || withIds.length === 0) return;
  try {
    await pool.query(
      `INSERT INTO barangay_ref (id, name, synced_at)
       SELECT * FROM unnest($1::int[], $2::text[], array_fill(NOW(), ARRAY[$3::int]))
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, synced_at = EXCLUDED.synced_at`,
      [withIds.map(r => r.id), withIds.map(r => r.name), withIds.length]
    );
    for (const sql of FILL_IDS_SQL) await pool.query(sql);
  } catch (err) {
    // Before migration 006 has run the table won't exist; names still work meanwhile.
    console.error('[barangays] Could not sync barangay ids:', err.message);
  }
}

// One row per DISTINCT facility name (about a hundred), not per case.
const FILL_FACILITY_IDS_SQL = ['treatment', 'screening'].map(f => `
  WITH m AS (
    SELECT DISTINCT ${f}_facility AS t, facility_ref_id(${f}_facility) AS fid
    FROM validated_tb_cases WHERE ${f}_facility IS NOT NULL
  )
  UPDATE validated_tb_cases v SET ${f}_facility_id = m.fid
  FROM m WHERE v.${f}_facility = m.t AND v.${f}_facility_id IS DISTINCT FROM m.fid`);

/** Mirror health facilities into facility_ref and refresh case facility ids. */
async function syncFacilityRef(authPool, pool) {
  if (!pool) return;
  try {
    const { rows } = await authPool.query(
      `SELECT h.id, h.name, h.barangay_name,
              to_jsonb(h)->>'ownership' AS ownership,
              to_jsonb(h)->>'facility_category' AS facility_category,
              COALESCE((to_jsonb(h)->>'is_external')::boolean, FALSE) AS is_external,
              COALESCE((to_jsonb(h)->>'is_reference')::boolean, FALSE) AS is_reference
       FROM health_facilities h`
    );
    if (rows.length > 0) {
      await pool.query(
        `INSERT INTO facility_ref (id, name, norm_name, barangay_name, ownership, facility_category, is_external, is_reference, synced_at)
         SELECT f.id, f.name, norm_facility(f.name), f.barangay_name, f.ownership, f.facility_category,
                f.is_external, f.is_reference, NOW()
         FROM jsonb_to_recordset($1::jsonb) AS f(id int, name text, barangay_name text, ownership text,
              facility_category text, is_external boolean, is_reference boolean)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, norm_name = EXCLUDED.norm_name,
           barangay_name = EXCLUDED.barangay_name, ownership = EXCLUDED.ownership,
           facility_category = EXCLUDED.facility_category, is_external = EXCLUDED.is_external,
           is_reference = EXCLUDED.is_reference, synced_at = EXCLUDED.synced_at`,
        [JSON.stringify(rows)]
      );
    }
    for (const sql of FILL_FACILITY_IDS_SQL) await pool.query(sql);
  } catch (err) {
    // Before migration 007 has run the tables won't exist.
    console.error('[facilities] Could not sync facility ids:', err.message);
  }
}

/**
 * @param {Pool} authPool  TBInsight database (source of the barangay list)
 * @param {Pool} [pool]    this database — when given, barangay_ref and ids are synced
 */
async function loadBarangays(authPool, pool) {
  try {
    const res = await authPool.query(
      `SELECT (to_jsonb(b)->>'id')::int AS id, b.name FROM barangays b ORDER BY b.name`
    );
    await syncBarangayRef(pool, res.rows);
    await syncFacilityRef(authPool, pool);
    if (setBarangays(res.rows.map(r => r.name))) {
      return { source: 'database', count: PASIG_BARANGAYS.length };
    }
    return { source: 'built-in (database list was empty)', count: PASIG_BARANGAYS.length };
  } catch (err) {
    console.error('[barangays] Could not load from database, keeping current list:', err.message);
    return { source: 'built-in (database unreachable)', count: PASIG_BARANGAYS.length };
  }
}

function startBarangayRefresh(authPool, pool) {
  if (timer) return;
  timer = setInterval(() => { loadBarangays(authPool, pool); }, REFRESH_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = { loadBarangays, startBarangayRefresh, syncBarangayRef, syncFacilityRef };
