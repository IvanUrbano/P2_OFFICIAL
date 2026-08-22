const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

/**
 * import_geometry.js — Load barangay polygon geometries from
 * data/pasig-barangays.geojson into the barangays_geom table (PostGIS).
 *
 * ⚠️ SOURCE OF TRUTH: data/pasig-barangays.geojson is the OFFICIAL NAMRIA
 * full-resolution data (see verify_geometry.js for the official area table).
 * NEVER import data/pasig-barangays-handdrawn-backup.geojson over it.
 *
 * Exported for reuse by rebuild_geometry.js; runs standalone when invoked
 * directly. Safe to re-run (upserts by name).
 */

const GEOJSON_PATH = path.join(__dirname, 'data', 'pasig-barangays.geojson');
const EXPECTED_COUNT = 30;

function loadGeojson() {
  if (!fs.existsSync(GEOJSON_PATH)) {
    throw new Error(`Missing source file: ${GEOJSON_PATH}`);
  }
  const geojson = JSON.parse(fs.readFileSync(GEOJSON_PATH, 'utf8'));
  if (!Array.isArray(geojson.features) || geojson.features.length !== EXPECTED_COUNT) {
    throw new Error(
      `Source file must contain exactly ${EXPECTED_COUNT} features (found ${geojson.features?.length ?? 0}) — refusing to import.`
    );
  }
  for (const f of geojson.features) {
    if (!f.properties?.name || !f.geometry) {
      throw new Error(`Feature missing name/geometry: ${JSON.stringify(f).slice(0, 120)}`);
    }
  }
  return geojson;
}

/** Import (upsert by name). Manages its own transaction on the given client. */
async function importGeometry(client) {
  const geojson = loadGeojson();
  try {
    await client.query('BEGIN');
    let inserted = 0;
    for (const feature of geojson.features) {
      const name = feature.properties.name;
      const population = feature.properties.population || 0;
      const geom = JSON.stringify(feature.geometry);
      await client.query(
        `INSERT INTO barangays_geom (name, population, geom)
         VALUES ($1, $2, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)))
         ON CONFLICT (name) DO UPDATE SET
           population = EXCLUDED.population,
           geom = EXCLUDED.geom`,
        [name, population, geom]
      );
      inserted++;
    }
    await client.query('COMMIT');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

if (require.main === module) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
  });
  (async () => {
    try {
      const client = await pool.connect();
      const n = await importGeometry(client);
      console.log(`✅ Imported ${n} barangay geometries`);
    } catch (err) {
      console.error('❌ Import failed:', err.message);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  })();
}

module.exports = { importGeometry, loadGeojson, GEOJSON_PATH };
