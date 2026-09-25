#!/usr/bin/env node
/**
 * Reset all data in TBInsight + Pasig Clone EXCEPT user accounts and map/reference data.
 *
 *   node reset_data.js            -> PREVIEW only: lists every table and how many rows would be deleted
 *   node reset_data.js --confirm  -> actually deletes (one transaction per database; all-or-nothing)
 *
 * Databases (read from .env files, no passwords in this file):
 *   - TBInsight:    BACKEND/.env              DATABASE_URL
 *   - Pasig Clone:  PASIG_CLONE/backend/.env  DATABASE_URL
 *
 * Only ROWS are deleted (TRUNCATE). Tables, columns, indexes and constraints are never dropped or altered.
 *
 * Kept (never touched):
 *   users                                   - login accounts
 *   audit_logs, login_attempts              - security history (password resets, lockouts)
 *   model_metadata                          - history of model/pipeline runs and evaluation results
 *   barangays, barangays_geom               - the 30 barangays + GIS shapes (cases and the map depend on these)
 *   health_facilities, barangay_population  - reference data
 *   spatial_ref_sys and other PostGIS tables
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const KEEP = new Set([
  'users',
  // security / history records
  'audit_logs', 'login_attempts', 'model_metadata',
  // map and reference data
  'barangays', 'barangays_geom', 'health_facilities', 'barangay_population',
  // PostGIS system tables
  'spatial_ref_sys', 'geometry_columns', 'geography_columns', 'raster_columns', 'raster_overviews',
  'topology', 'layer',
]);

const CONFIRM = process.argv.includes('--confirm');

function readEnvVar(file, key) {
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^['"]|['"]$/g, '');
  }
  return null;
}

const DATABASES = [
  { label: 'TBInsight (neondb)', url: readEnvVar(path.join(__dirname, '.env'), 'DATABASE_URL') },
  { label: 'Pasig Clone (pasig_clone_db)', url: readEnvVar(path.join(__dirname, '..', 'PASIG_CLONE', 'backend', '.env'), 'DATABASE_URL') },
];

async function resetDatabase({ label, url }) {
  console.log(`\n=== ${label} ===`);
  if (!url) {
    console.log('  DATABASE_URL not found in .env — skipped.');
    return true;
  }

  const pool = new Pool({ connectionString: url, ssl: url.includes('neon.tech') ? { rejectUnauthorized: false } : false });
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`);

    const targets = [];
    for (const { table_name: t } of rows) {
      const { rows: c } = await client.query(`SELECT COUNT(*)::bigint AS n FROM "${t}"`);
      const n = Number(c[0].n);
      if (KEEP.has(t)) {
        console.log(`  keep    ${t.padEnd(28)} ${n} rows`);
      } else {
        targets.push(t);
        console.log(`  DELETE  ${t.padEnd(28)} ${n} rows`);
      }
    }

    if (targets.length === 0) {
      console.log('  Nothing to delete.');
      return true;
    }
    if (!CONFIRM) return true;

    // One TRUNCATE over all target tables. No CASCADE: if a kept table (e.g. users) had a
    // foreign key into a target table, Postgres refuses and NOTHING is deleted.
    await client.query('BEGIN');
    await client.query(`TRUNCATE TABLE ${targets.map(t => `"${t}"`).join(', ')} RESTART IDENTITY`);
    await client.query('COMMIT');

    const { rows: u } = await client.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='users'`);
    if (u[0].n) {
      const { rows: uc } = await client.query('SELECT COUNT(*)::int AS n FROM users');
      console.log(`  ✅ Deleted data from ${targets.length} tables. users still has ${uc[0].n} accounts.`);
    } else {
      console.log(`  ✅ Deleted data from ${targets.length} tables.`);
    }
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`  ❌ ${err.message}\n  Nothing was deleted in this database.`);
    return false;
  } finally {
    client.release();
    await pool.end();
  }
}

(async () => {
  console.log(CONFIRM
    ? 'DELETING rows (tables and columns stay; users, security logs, model history and map/reference data are kept)...'
    : 'PREVIEW — nothing will be deleted. Re-run with --confirm to delete.');
  let ok = true;
  for (const db of DATABASES) ok = (await resetDatabase(db)) && ok;
  if (!CONFIRM) console.log('\nTo delete the rows marked DELETE above, run:  node reset_data.js --confirm');
  else if (ok) console.log('\nDone. Restart both backends before importing new data.');
  process.exit(ok ? 0 : 1);
})();
