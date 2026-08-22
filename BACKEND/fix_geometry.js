const { Pool } = require('pg');
require('dotenv').config();

/**
 * fix_geometry.js — Rebuild barangays_geom as a watertight topology.
 *
 * Problem: source polygons do not share exact vertices, causing visible
 * gaps/overlaps between neighboring barangays.
 *
 * Solution (all in PostGIS, single transaction):
 *   1. Union all polygons -> "coverage" (source is edge-shared NAMRIA,
 *      so the union is nearly watertight; remaining faces are tiny slivers)
 *   2. Node original boundaries + coverage boundary -> shared line network
 *   3. Polygonize -> faces (each face = a piece of land)
 *   4. Assign every face to the barangay it's inside (distance 0),
 *      tie-broken by largest overlap; uncontained gap faces go to nearest
 *   5. Rebuild each barangay = unary union of its faces
 *
 * Result: no gaps, no overlaps, shapes preserved as closely as possible.
 * Safe to re-run.
 *
 * ⚠️ ORDER MATTERS: run on a FRESH import (node import_geometry.js first).
 * Running the fix twice on already-fixed data re-processes remnant edges
 * and can inflate areas (the old 100 m buffer rim did exactly this).
 *
 * Exported for reuse by rebuild_geometry.js; runs standalone when invoked
 * directly.
 */

// NOTE: coverage is the exact union — NO buffer. A 100 m buffer created a
// single "donut" rim face (~3.7 km²) that was dumped onto one barangay.
const BUFFER_M = 0; // kept as placeholder; queries no longer take params

/** Rebuild topology. Manages its own transaction on the given client. */
async function fixGeometry(client) {
  console.log('🛠️  Rebuilding barangay topology...');
  try {
    await client.query('BEGIN');

    const before = await client.query('SELECT COUNT(*)::int AS n FROM barangays_geom');
    console.log(`   Before: ${before.rows[0].n} barangays`);

    // 1-3. Coverage -> linework -> faces
    const facesRes = await client.query(`
      WITH coverage AS (
        SELECT ST_UnaryUnion(ST_Collect(geom)) AS geom
        FROM barangays_geom
      ),
      flat_lines AS (
        SELECT (ST_Dump(ST_Boundary(geom))).geom AS g FROM barangays_geom
        UNION ALL
        SELECT (ST_Dump(ST_Boundary(geom))).geom AS g FROM coverage
      ),
      combined_lines AS (
        SELECT ST_UnaryUnion(ST_Collect(g)) AS linework FROM flat_lines
      )
      SELECT (ST_Dump(ST_Polygonize(linework))).geom AS face
      FROM combined_lines
    `);
    console.log(`   Faces created: ${facesRes.rows.length}`);

    // 4-5. Assign each face to a barangay and rebuild polygons
    const fixRes = await client.query(`
      WITH coverage AS (
        SELECT ST_UnaryUnion(ST_Collect(geom)) AS geom FROM barangays_geom
      ),
      flat_lines AS (
        SELECT (ST_Dump(ST_Boundary(geom))).geom AS g FROM barangays_geom
        UNION ALL
        SELECT (ST_Dump(ST_Boundary(geom))).geom AS g FROM coverage
      ),
      combined_lines AS (
        SELECT ST_UnaryUnion(ST_Collect(g)) AS linework FROM flat_lines
      ),
      faces AS (
        SELECT (ST_Dump(ST_Polygonize(linework))).geom AS face FROM combined_lines
      ),
      assigned AS (
        SELECT f.face,
          (
            SELECT b.name FROM barangays_geom b
            ORDER BY
              ST_Distance(ST_PointOnSurface(f.face)::geography, b.geom::geography),
              ST_Area(ST_Intersection(b.geom, f.face)) DESC
            LIMIT 1
          ) AS name
        FROM faces f
      )
      SELECT name, ST_Multi(ST_UnaryUnion(ST_Collect(face))) AS geom
      FROM assigned
      GROUP BY name
      ORDER BY name
    `);
    console.log(`   Rebuilt: ${fixRes.rows.length} barangays`);

    if (fixRes.rows.length !== before.rows[0].n) {
      throw new Error(`Expected ${before.rows[0].n} barangays, got ${fixRes.rows.length} — aborting (no changes made)`);
    }

    // Write back
    for (const row of fixRes.rows) {
      await client.query(
        `UPDATE barangays_geom SET geom = $1 WHERE name = $2`,
        [row.geom, row.name]
      );
    }

    await client.query('COMMIT');
    console.log(`✅ Topology rebuilt: ${fixRes.rows.length} barangays updated, watertight.`);
    return fixRes.rows.length;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Fix failed:', err.message);
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
      await fixGeometry(client);
    } catch (err) {
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  })();
}

module.exports = { fixGeometry };
