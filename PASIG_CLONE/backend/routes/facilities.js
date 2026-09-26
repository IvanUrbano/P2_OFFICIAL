const express = require('express');
const { Pool } = require('pg');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Connects to TBInsight's DB (AUTH_DATABASE_URL) where health_facilities live
const authPool = new Pool({
  connectionString: process.env.AUTH_DATABASE_URL,
  ssl: process.env.AUTH_DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
});

/**
 * GET /api/facilities
 * Returns all health facilities grouped by barangay, plus all barangays.
 */
router.get('/', authenticate, async (req, res) => {
  try {
    // Get all 30 barangays
    const barangaysResult = await authPool.query(
      `SELECT name, population FROM barangays ORDER BY name ASC`
    );

    // Get all facilities — check if address column exists first
    let facilitiesResult;
    try {
      facilitiesResult = await authPool.query(`
        SELECT id, name, barangay_name, facility_type, address
        FROM health_facilities
        ORDER BY barangay_name ASC, name ASC
      `);
    } catch {
      // address column may not exist yet — fall back
      facilitiesResult = await authPool.query(`
        SELECT id, name, barangay_name, facility_type, NULL::text AS address
        FROM health_facilities
        ORDER BY barangay_name ASC, name ASC
      `);
    }

    const rows = facilitiesResult.rows;

    // Group facilities by barangay
    const byBarangay = {};
    for (const row of rows) {
      if (!byBarangay[row.barangay_name]) {
        byBarangay[row.barangay_name] = [];
      }
      byBarangay[row.barangay_name].push({
        id: row.id,
        name: row.name,
        facility_type: row.facility_type,
        address: row.address,
      });
    }

    res.json({
      total: rows.length,
      barangays: barangaysResult.rows,
      barangay_count: barangaysResult.rows.length,
      facilities: rows,
      by_barangay: byBarangay,
    });
  } catch (err) {
    console.error('Error fetching facilities:', err.message);
    res.status(500).json({ error: 'Failed to fetch health facilities.' });
  }
});

module.exports = router;
