const fs = require('fs');
const path = require('path');
const pool = require('../db');

/**
 * Seed barangays from pasig-barangays.geojson
 * Extracts name, population, and centroid coordinates
 */
async function seedBarangays() {
  const geojsonPath = path.join(__dirname, '..', 'data', 'pasig-barangays.geojson');
  const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const feature of geojson.features) {
      const { name, population } = feature.properties;
      const [lon, lat] = feature.geometry.coordinates;

      await client.query(
        `INSERT INTO barangays (name, population, centroid_lon, centroid_lat)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO UPDATE SET
           population = EXCLUDED.population,
           centroid_lon = EXCLUDED.centroid_lon,
           centroid_lat = EXCLUDED.centroid_lat`,
        [name, population, lon, lat]
      );
    }

    await client.query('COMMIT');
    console.log(`✅ Seeded ${geojson.features.length} barangays`);
    return { success: true, count: geojson.features.length };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to seed barangays:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Seed health facilities from pasig-health-facilities.csv
 */
async function seedHealthFacilities() {
  const csvPath = path.join(__dirname, '..', 'data', 'pasig-health-facilities.csv');
  const csv = fs.readFileSync(csvPath, 'utf8');
  const lines = csv.trim().split('\n');
  const headers = lines[0].split(',');
  const rows = lines.slice(1).map(line => {
    const values = line.split(',');
    return {
      facility_name: values[0],
      barangay_name: values[1],
      facility_type: values[2],
    };
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let seeded = 0;
    for (const row of rows) {
      const result = await client.query(
        `INSERT INTO health_facilities (name, barangay_name, facility_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (name, barangay_name) DO UPDATE SET
           facility_type = EXCLUDED.facility_type`,
        [row.facility_name, row.barangay_name, row.facility_type]
      );
      seeded++;
    }

    await client.query('COMMIT');
    console.log(`✅ Seeded ${seeded} health facilities`);
    return { success: true, count: seeded };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to seed health facilities:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Seed all reference data (barangays + facilities)
 */
async function seedAll() {
  const barangays = await seedBarangays();
  const facilities = await seedHealthFacilities();
  return { barangays, facilities };
}

/**
 * Get all barangays with population
 */
async function getBarangays() {
  const result = await pool.query(
    'SELECT name, population, centroid_lon, centroid_lat FROM barangays ORDER BY name'
  );
  return result.rows;
}

/**
 * Get all health facilities with parent barangay
 */
async function getHealthFacilities() {
  const result = await pool.query(
    `SELECT hf.id, hf.name, hf.barangay_name, hf.facility_type
     FROM health_facilities hf
     ORDER BY hf.barangay_name, hf.name`
  );
  return result.rows;
}

/**
 * Find a barangay by name (case-insensitive)
 */
async function findBarangay(name) {
  const result = await pool.query(
    'SELECT name, population, centroid_lon, centroid_lat FROM barangays WHERE LOWER(name) = LOWER($1)',
    [name]
  );
  return result.rows[0] || null;
}

module.exports = {
  seedBarangays,
  seedHealthFacilities,
  seedAll,
  getBarangays,
  getHealthFacilities,
  findBarangay,
};
