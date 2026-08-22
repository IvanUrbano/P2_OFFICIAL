const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

/**
 * rebuild_geometry.js — Restore barangays_geom to a known-good state in one command.
 *
 * Pipeline (order matters!):
 *   1. Backup current DB geometry -> data/geometry-backup-<timestamp>.geojson
 *   2. Import official NAMRIA source (data/pasig-barangays.geojson)
 *   3. Rebuild watertight topology (fix_geometry)
 *   4. Verify against official areas (verify_geometry) — FAIL => non-zero exit
 *
 * Usage: npm run geometry:rebuild
 */

const { importGeometry } = require('./import_geometry');
const { fixGeometry } = require('./fix_geometry');
const { verifyGeometry } = require('./verify_geometry');

const BACKUP_DIR = path.join(__dirname, 'data');

async function backupGeometry(pool) {
  const r = await pool.query(`
    SELECT name, population, ST_AsGeoJSON(geom) AS gj
    FROM barangays_geom ORDER BY name
  `);
  if (!r.rows.length) return null;
  const fc = {
    type: 'FeatureCollection',
    name: 'barangays_geom_backup',
    features: r.rows.map(x => ({
      type: 'Feature',
      properties: { name: x.name, population: x.population },
      geometry: JSON.parse(x.gj),
    })),
  };
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `geometry-backup-${ts}.geojson`);
  fs.writeFileSync(file, JSON.stringify(fc));
  console.log(`💾 Backed up ${r.rows.length} geometries -> ${path.basename(file)}`);
  return file;
}

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
  });
  try {
    const client = await pool.connect();

    await backupGeometry(client);

    const n = await importGeometry(client);
    console.log(`✅ Imported ${n} barangay geometries (official NAMRIA source)`);

    await fixGeometry(client);

    const verify = await verifyGeometry(client);
    if (!verify.ok) {
      console.error('\n❌ Geometry verification FAILED after rebuild:');
      for (const i of verify.issues) console.error(`   - ${i}`);
      console.error('   A backup was written to data/geometry-backup-*.geojson — inspect and restore if needed.');
      process.exitCode = 1;
    } else {
      console.log('\n✅ Rebuild complete — geometry verified watertight and within official areas.');
    }
    client.release();
  } catch (err) {
    console.error('❌ Rebuild failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
