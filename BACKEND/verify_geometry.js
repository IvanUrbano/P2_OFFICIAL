const { Pool } = require('pg');
require('dotenv').config();

/**
 * verify_geometry.js — Health check for barangays_geom.
 *
 * Checks:
 *   1. Exactly 30 rows, all geometries valid
 *   2. No overlapping pairs
 *   3. Every polygonized face is inside some barangay (no gaps)
 *   4. Sum of areas == union area (watertight)
 *   5. Per-barangay area within tolerance of the OFFICIAL NAMRIA values
 *      (reference table below, from the full-resolution NAMRIA shapefile;
 *      Kapasigan/Kapasigan Extension are our documented split of official
 *      Kapasigan 0.157 km²)
 *
 * Exits non-zero on FAIL so it can gate CI / be wired into scripts.
 * Usage: node verify_geometry.js
 */

// Official NAMRIA AREA_SQKM values (full-res shapefile, EPSG:32651 -> WGS84).
// Our Kapasigan split: Kapasigan 0.098 + Kapasigan Extension 0.058 = 0.156.
const OFFICIAL_KM2 = {
  'Bagong Ilog': 1.213,
  'Bambang': 0.521,
  'Buting': 0.348,
  'Caniogan': 1.044,
  'Dela Paz': 1.314,
  'Kalawaan': 1.008,
  'Kapasigan': 0.098,
  'Kapasigan Extension': 0.058,
  'Kapitolyo': 1.017,
  'Malinao': 0.241,
  'Manggahan': 3.558,
  'Maybunga': 2.186,
  'Oranbo': 0.521,
  'Palatiw': 0.304,
  'Pinagbuhatan': 3.546,
  'Pineda': 0.581,
  'Rosario': 2.594,
  'Sagad': 0.110,
  'San Antonio': 0.738,
  'San Joaquin': 0.592,
  'San Jose': 0.093,
  'San Miguel': 1.224,
  'San Nicolas': 0.230,
  'Santa Cruz': 0.047,
  'Santa Lucia': 1.872,
  'Santa Rosa': 0.150,
  'Santo Tomas': 0.138,
  'Santolan': 2.079,
  'Sumilang': 0.107,
  'Ugong': 3.749,
};

const FAIL_KM2 = 0.05; // hard fail if a barangay deviates more than this
const WARN_KM2 = 0.02; // warn above this (e.g. Sumilang +2.3 ha sliver)

async function verifyGeometry(pool) {
  const issues = [];
  const warnings = [];
  const report = [];

  // 1. Count + validity + watertightness + overlaps
  const stats = await pool.query(`
    WITH flat_lines AS (
      SELECT (ST_Dump(ST_Boundary(geom))).geom AS g FROM barangays_geom
    ),
    noded AS (SELECT ST_UnaryUnion(ST_Collect(g)) AS linework FROM flat_lines),
    faces AS (SELECT (ST_Dump(ST_Polygonize(linework))).geom AS face FROM noded)
    SELECT
      (SELECT COUNT(*)::int FROM barangays_geom) AS total,
      (SELECT COUNT(*)::int FROM barangays_geom WHERE NOT ST_IsValid(geom)) AS invalid,
      (SELECT COUNT(*)::int FROM faces) AS faces,
      (SELECT COUNT(*)::int FROM faces f WHERE NOT EXISTS (
        SELECT 1 FROM barangays_geom b WHERE ST_Contains(b.geom, ST_PointOnSurface(f.face)))) AS unassigned_faces,
      (SELECT ROUND(SUM(ST_Area(geom::geography)/1000000)::numeric, 6) FROM barangays_geom) AS sum_km2,
      (SELECT ROUND((ST_Area(ST_UnaryUnion(ST_Collect(geom))::geography)/1000000)::numeric, 6) FROM barangays_geom) AS union_km2,
      (SELECT COUNT(*)::int FROM barangays_geom a JOIN barangays_geom b
         ON a.name < b.name AND ST_Overlaps(a.geom, b.geom)) AS overlaps
  `);
  const s = stats.rows[0];

  if (s.total !== 30) issues.push(`Expected 30 barangays, found ${s.total}`);
  if (s.invalid > 0) issues.push(`${s.invalid} invalid geometries`);
  if (s.overlaps > 0) issues.push(`${s.overlaps} overlapping pairs`);
  if (s.unassigned_faces > 0) issues.push(`${s.unassigned_faces} unassigned faces (gaps)`);
  const areaDiff = Math.abs(Number(s.sum_km2) - Number(s.union_km2));
  if (areaDiff > 0.001) issues.push(`Sum area (${s.sum_km2}) != union area (${s.union_km2}) — gaps or overlaps`);

  // 2. Per-barangay areas vs official reference
  const areas = await pool.query(`
    SELECT name, ROUND((ST_Area(geom::geography)/1000000)::numeric, 3) AS km2
    FROM barangays_geom ORDER BY name
  `);
  for (const row of areas.rows) {
    const official = OFFICIAL_KM2[row.name];
    if (official === undefined) {
      warnings.push(`No official reference for "${row.name}" (new barangay?)`);
      continue;
    }
    const delta = Math.abs(Number(row.km2) - official);
    report.push({ name: row.name, km2: Number(row.km2), official, delta });
    if (delta > FAIL_KM2) issues.push(`${row.name}: ${row.km2} km² vs official ${official} km² (Δ ${delta.toFixed(3)})`);
    else if (delta > WARN_KM2) warnings.push(`${row.name}: ${row.km2} km² vs official ${official} km² (Δ ${delta.toFixed(3)})`);
  }

  return { ok: issues.length === 0, issues, warnings, report, stats: s };
}

if (require.main === module) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
  });
  (async () => {
    try {
      const res = await verifyGeometry(pool);

      console.log(`Barangays: ${res.stats.total}  |  Invalid: ${res.stats.invalid}  |  Overlaps: ${res.stats.overlaps}  |  Unassigned faces: ${res.stats.unassigned_faces}`);
      console.log(`Area: sum ${res.stats.sum_km2} km²  ==  union ${res.stats.union_km2} km²  ${Math.abs(Number(res.stats.sum_km2) - Number(res.stats.union_km2)) <= 0.001 ? '✅ watertight' : '❌'}`);
      console.log('');
      console.log('Per-barangay vs official NAMRIA (km²):');
      for (const r of res.report) {
        const flag = r.delta > FAIL_KM2 ? '❌' : r.delta > WARN_KM2 ? '⚠️' : '✅';
        console.log(`  ${flag} ${r.name.padEnd(20)} ${r.km2.toFixed(3)}  (official ${r.official.toFixed(3)}, Δ ${r.delta.toFixed(3)})`);
      }
      if (res.warnings.length) {
        console.log('\nWarnings:');
        for (const w of res.warnings) console.log(`  ⚠️ ${w}`);
      }
      if (!res.ok) {
        console.log('\n❌ GEOMETRY BROKEN — run:  npm run geometry:rebuild');
        process.exitCode = 1;
      } else {
        console.log('\n✅ Geometry OK');
      }
    } catch (err) {
      console.error('❌ Verify failed:', err.message);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  })();
}

module.exports = { verifyGeometry, OFFICIAL_KM2 };
