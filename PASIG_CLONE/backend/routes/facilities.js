const express = require('express');
const { authenticate } = require('../middleware/auth');
// TBInsight's DB (AUTH_DATABASE_URL), where health_facilities live — shared pool, so it
// reuses already-open connections instead of opening its own.
const { authPool } = require('../db/pasigSchema');

const router = express.Router();

/**
 * GET /api/facilities
 * Returns all health facilities grouped by barangay, plus all barangays.
 */
router.get('/', authenticate, async (req, res) => {
  try {
    // Both lookups at once (each is a ~0.2 s round trip to the remote database).
    // to_jsonb(h)->>'address' reads the address column if it exists and gives NULL if it
    // doesn't — one query, instead of a failing query followed by a fallback.
    const [barangaysResult, facilitiesResult] = await Promise.all([
      authPool.query(`SELECT name, population FROM barangays ORDER BY name ASC`),
      authPool.query(`
        SELECT h.id, h.name, h.barangay_name, h.facility_type, to_jsonb(h)->>'address' AS address
        FROM health_facilities h
        ORDER BY h.barangay_name ASC, h.name ASC
      `),
    ]);

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
