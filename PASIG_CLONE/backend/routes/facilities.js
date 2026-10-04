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
    // to_jsonb(...)->> reads columns added by TBInsight migration 023 (barangay id,
    // ownership, category, external/reference flags) and yields NULL before it has run.
    const [barangaysResult, facilitiesResult] = await Promise.all([
      authPool.query(`
        SELECT (to_jsonb(b)->>'id')::int AS id, b.name, b.population
        FROM barangays b
        WHERE COALESCE((to_jsonb(b)->>'is_active')::boolean, TRUE)
        ORDER BY b.name ASC`),
      authPool.query(`
        SELECT h.id, h.name, h.barangay_name, h.facility_type,
               to_jsonb(h)->>'address' AS address,
               (to_jsonb(h)->>'barangay_id')::int AS barangay_id,
               to_jsonb(h)->>'ownership' AS ownership,
               to_jsonb(h)->>'facility_category' AS facility_category,
               COALESCE((to_jsonb(h)->>'is_external')::boolean, FALSE) AS is_external,
               COALESCE((to_jsonb(h)->>'is_reference')::boolean, FALSE) AS is_reference
        FROM health_facilities h
        WHERE COALESCE((to_jsonb(h)->>'is_active')::boolean, TRUE)
        ORDER BY h.barangay_name ASC NULLS LAST, h.name ASC
      `),
    ]);

    const rows = facilitiesResult.rows;

    // Group facilities by barangay
    const byBarangay = {};
    for (const row of rows) {
      // External facilities (outside Pasig) have no barangay.
      const key = row.barangay_name || 'External';
      if (!byBarangay[key]) {
        byBarangay[key] = [];
      }
      byBarangay[key].push({
        id: row.id,
        name: row.name,
        facility_type: row.facility_type,
        address: row.address,
        ownership: row.ownership,
        facility_category: row.facility_category,
        is_external: row.is_external,
        is_reference: row.is_reference,
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
