const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { parseCaseFile } = require('./parseCaseFile');
const { importCases, getImportHistory, getBatchErrors, getBatchSummary } = require('./importCases');
const { rebuildAggregations } = require('./aggregateMonthly');
const { seedAll, getBarangays, getHealthFacilities, findBarangay } = require('./barangays');
const { runPipeline } = require('./pipeline');
const { healthCheck: mlHealthCheck } = require('./mlClient');

const router = express.Router();

// Middleware to authorize user roles
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Unauthorized role.' });
    }
    next();
  };
};

// ==================== REFERENCE DATA ====================

/**
 * GET /api/tb/barangays
 * List all 30 barangays with population and coordinates
 */
router.get('/barangays', async (req, res) => {
  try {
    const barangays = await getBarangays();
    res.json({ barangays, count: barangays.length });
  } catch (err) {
    console.error('Fetch barangays error:', err.message);
    res.status(500).json({ error: 'Server error fetching barangays.' });
  }
});

/**
 * GET /api/tb/facilities
 * List all health facilities with parent barangay
 */
router.get('/facilities', async (req, res) => {
  try {
    const facilities = await getHealthFacilities();
    res.json({ facilities, count: facilities.length });
  } catch (err) {
    console.error('Fetch facilities error:', err.message);
    res.status(500).json({ error: 'Server error fetching facilities.' });
  }
});

/**
 * POST /api/tb/barangays/seed
 * Seed barangays and facilities from data files (admin only)
 */
router.post('/barangays/seed', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const result = await seedAll();
    res.json({ message: 'Reference data seeded successfully.', result });
  } catch (err) {
    console.error('Seed error:', err.message);
    res.status(500).json({ error: 'Server error seeding reference data.' });
  }
});

// ==================== IMPORT ====================

/**
 * POST /api/tb/import
 * Upload CSV/Excel file → parse, validate, store raw + cleaned + aggregate
 */
router.post('/import', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    // Check if file is present
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field "file".' });
    }

    const file = req.files.file;

    // Get valid barangays for validation
    const barangaysResult = await pool.query('SELECT name FROM barangays');
    const validBarangays = new Set(
      barangaysResult.rows.map(r => r.name.toLowerCase())
    );

    // Parse the file
    const parsed = parseCaseFile(file.data, file.name, validBarangays);

    if (parsed.totalRows === 0) {
      return res.status(400).json({ error: 'File is empty or has no valid data rows.' });
    }

    // Import into database
    const result = await importCases(parsed.rows, file.name);

    // Rebuild aggregations from cleaned data
    let aggregations = null;
    if (result.importedCount > 0) {
      aggregations = await rebuildAggregations();
    }

    res.status(201).json({
      message: 'File imported successfully.',
      batch: {
        id: result.batchId,
        sourceFile: file.name,
        totalRows: result.totalCount,
        imported: result.importedCount,
        errors: result.errorCount,
      },
      validation: {
        errors: parsed.errors,
        warnings: parsed.warnings,
      },
      aggregations,
    });
  } catch (err) {
    console.error('Import error:', err.message);
    res.status(500).json({ error: 'Server error during import.' });
  }
});

/**
 * GET /api/tb/import-history
 * List past imports
 */
router.get('/import-history', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const history = await getImportHistory();
    res.json({ imports: history });
  } catch (err) {
    console.error('Import history error:', err.message);
    res.status(500).json({ error: 'Server error fetching import history.' });
  }
});

/**
 * GET /api/tb/import/:batchId/errors
 * Get validation errors for a specific batch
 */
router.get('/import/:batchId/errors', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { batchId } = req.params;
    const errors = await getBatchErrors(batchId);
    const summary = await getBatchSummary(batchId);
    res.json({ batchId, summary, errors });
  } catch (err) {
    console.error('Batch errors error:', err.message);
    res.status(500).json({ error: 'Server error fetching batch errors.' });
  }
});

// ==================== CASE RECORDS ====================

/**
 * GET /api/tb/cases
 * List individual TB case records with filtering, search, and pagination
 * Query params: page, limit, search, barangay, year, month, outcome
 */
router.get('/cases', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      barangay = '',
      year = '',
      month = '',
      outcome = '',
    } = req.query;

    const offset = (Math.max(1, Number(page)) - 1) * Number(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(
        c.barangay_name ILIKE $${paramIdx} OR
        c.screening_facility ILIKE $${paramIdx} OR
        c.treatment_facility ILIKE $${paramIdx}
      )`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (barangay) {
      conditions.push(`c.barangay_name = $${paramIdx}`);
      params.push(barangay);
      paramIdx++;
    }

    if (year) {
      conditions.push(`EXTRACT(YEAR FROM c.date_of_diagnosis) = $${paramIdx}`);
      params.push(Number(year));
      paramIdx++;
    }

    if (month) {
      conditions.push(`EXTRACT(MONTH FROM c.date_of_diagnosis) = $${paramIdx}`);
      params.push(Number(month));
      paramIdx++;
    }

    if (outcome) {
      conditions.push(`c.outcome_status = $${paramIdx}`);
      params.push(outcome);
      paramIdx++;
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM tb_cases c ${whereClause}`,
      params
    );
    const total = Number(countResult.rows[0].total);

    // Fetch page
    const dataResult = await pool.query(
      `SELECT
        c.id,
        c.batch_id,
        c.barangay_name,
        c.age,
        c.sex,
        c.date_of_diagnosis,
        c.date_of_screening,
        c.date_of_notification,
        c.screening_facility,
        c.treatment_facility,
        c.source_of_patient,
        c.anatomical_site,
        c.registration_group,
        c.bacteriological_status,
        c.date_started_treatment,
        c.outcome_status,
        c.date_of_outcome
      FROM tb_cases c
      ${whereClause}
      ORDER BY c.date_of_diagnosis DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, Number(limit), offset]
    );

    res.json({
      cases: dataResult.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    console.error('Cases list error:', err.message);
    res.status(500).json({ error: 'Server error fetching cases.' });
  }
});

// ==================== DASHBOARD ANALYTICS ====================

/**
 * GET /api/tb/dashboard/summary
 * Key metrics: total cases, unique months, cases per barangay
 */
router.get('/dashboard/summary', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_cases,
        COUNT(DISTINCT barangay_name) as barangays_with_cases,
        COUNT(DISTINCT DATE_TRUNC('month', date_of_diagnosis)) as months_covered,
        MIN(date_of_diagnosis) as earliest_date,
        MAX(date_of_diagnosis) as latest_date
      FROM tb_cases
    `);
    res.json({ summary: result.rows[0] });
  } catch (err) {
    console.error('Dashboard summary error:', err.message);
    res.status(500).json({ error: 'Server error fetching dashboard summary.' });
  }
});

/**
 * GET /api/tb/dashboard/monthly
 * Monthly case trend (all barangays)
 */
router.get('/dashboard/monthly', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT barangay_name, month, case_count
      FROM monthly_case_summary
      ORDER BY month, barangay_name
    `);
    res.json({ monthly: result.rows });
  } catch (err) {
    console.error('Dashboard monthly error:', err.message);
    res.status(500).json({ error: 'Server error fetching monthly data.' });
  }
});

/**
 * GET /api/tb/dashboard/barangay/:name
 * Per-barangay breakdown: monthly cases, demographics, outcomes
 */
router.get('/dashboard/barangay/:name', async (req, res) => {
  try {
    const { name } = req.params;

    // Verify barangay exists
    const barangay = await findBarangay(name);
    if (!barangay) {
      return res.status(404).json({ error: `Barangay "${name}" not found.` });
    }

    // Get monthly cases
    const monthly = await pool.query(
      `SELECT month, case_count FROM monthly_case_summary
       WHERE barangay_name = $1 ORDER BY month`,
      [name]
    );

    // Get demographics
    const demographics = await pool.query(
      `SELECT sex, age_group, SUM(case_count) as total
       FROM demographic_summary
       WHERE barangay_name = $1
       GROUP BY sex, age_group
       ORDER BY sex, age_group`,
      [name]
    );

    // Get outcomes
    const outcomes = await pool.query(
      `SELECT outcome_status, SUM(case_count) as total
       FROM outcome_summary
       WHERE barangay_name = $1
       GROUP BY outcome_status
       ORDER BY total DESC`,
      [name]
    );

    res.json({
      barangay,
      monthly: monthly.rows,
      demographics: demographics.rows,
      outcomes: outcomes.rows,
    });
  } catch (err) {
    console.error('Barangay detail error:', err.message);
    res.status(500).json({ error: 'Server error fetching barangay data.' });
  }
});

/**
 * GET /api/tb/dashboard/demographics
 * Age/sex distributions across all barangays
 */
router.get('/dashboard/demographics', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT barangay_name, sex, age_group, SUM(case_count) as total
      FROM demographic_summary
      GROUP BY barangay_name, sex, age_group
      ORDER BY barangay_name, sex, age_group
    `);
    res.json({ demographics: result.rows });
  } catch (err) {
    console.error('Demographics error:', err.message);
    res.status(500).json({ error: 'Server error fetching demographics.' });
  }
});

/**
 * GET /api/tb/dashboard/outcomes
 * Treatment outcome breakdown per barangay
 */
router.get('/dashboard/outcomes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT barangay_name, outcome_status, SUM(case_count) as total
      FROM outcome_summary
      GROUP BY barangay_name, outcome_status
      ORDER BY barangay_name, total DESC
    `);
    res.json({ outcomes: result.rows });
  } catch (err) {
    console.error('Outcomes error:', err.message);
    res.status(500).json({ error: 'Server error fetching outcomes.' });
  }
});

/**
 * GET /api/tb/dashboard/facilities
 * Cases per health facility
 */
router.get('/dashboard/facilities', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT facility_name, barangay_name, SUM(case_count) as total
      FROM facility_summary
      GROUP BY facility_name, barangay_name
      ORDER BY total DESC
    `);
    res.json({ facilities: result.rows });
  } catch (err) {
    console.error('Facilities error:', err.message);
    res.status(500).json({ error: 'Server error fetching facility data.' });
  }
});

/**
 * GET /api/tb/dashboard/bacteriological
 * Bacteriological status breakdown per barangay
 */
router.get('/dashboard/bacteriological', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT barangay_name, bacteriological_status, SUM(case_count) as total
      FROM bacteriological_summary
      GROUP BY barangay_name, bacteriological_status
      ORDER BY barangay_name, total DESC
    `);
    res.json({ bacteriological: result.rows });
  } catch (err) {
    console.error('Bacteriological error:', err.message);
    res.status(500).json({ error: 'Server error fetching bacteriological data.' });
  }
});

// ==================== GIS & PREDICTIONS ====================

/**
 * GET /api/tb/gis/choropleth
 * Map data: barangay risk scores + classes for choropleth
 */
router.get('/gis/choropleth', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        b.name,
        b.centroid_lon,
        b.centroid_lat,
        b.population,
        COALESCE(brs.risk_score, 0) as risk_score,
        COALESCE(brs.risk_class, 'No Data') as risk_class,
        COALESCE(brs.incidence_per_100k, 0) as incidence_per_100k,
        COALESCE(brs.trend_direction, 'Stable') as trend_direction,
        brs.period
      FROM barangays b
      LEFT JOIN barangay_risk_scores brs ON b.name = brs.barangay_name
        AND brs.period = (
          SELECT MAX(period) FROM barangay_risk_scores
          WHERE barangay_name = b.name
        )
      ORDER BY b.name
    `);
    res.json({ choropleth: result.rows });
  } catch (err) {
    console.error('Choropleth error:', err.message);
    res.status(500).json({ error: 'Server error fetching choropleth data.' });
  }
});

/**
 * GET /api/tb/forecasts
 * ARIMA predictions per barangay
 */
router.get('/forecasts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        barangay_name, period, forecasted_count,
        confidence_lower, confidence_upper,
        incidence_per_100k, model_version
      FROM model_predictions
      ORDER BY period DESC, barangay_name
    `);
    res.json({ forecasts: result.rows });
  } catch (err) {
    console.error('Forecasts error:', err.message);
    res.status(500).json({ error: 'Server error fetching forecasts.' });
  }
});

/**
 * GET /api/tb/predictions/risk
 * RF risk classifications
 */
router.get('/predictions/risk', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        barangay_name, period, risk_class,
        incidence_per_100k, risk_score
      FROM model_predictions mp
      JOIN barangay_risk_scores brs
        ON mp.barangay_name = brs.barangay_name AND mp.period = brs.period
      WHERE mp.risk_class IS NOT NULL
      ORDER BY mp.period DESC, mp.barangay_name
    `);
    res.json({ predictions: result.rows });
  } catch (err) {
    console.error('Risk predictions error:', err.message);
    res.status(500).json({ error: 'Server error fetching risk predictions.' });
  }
});

/**
 * GET /api/tb/alerts
 * Active alerts
 */
router.get('/alerts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, barangay_name, period, alert_type, severity,
             message, recommendation, is_read, created_at
      FROM alerts
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json({ alerts: result.rows });
  } catch (err) {
    console.error('Alerts error:', err.message);
    res.status(500).json({ error: 'Server error fetching alerts.' });
  }
});

/**
 * PUT /api/tb/alerts/:id/read
 * Mark an alert as read
 */
router.put('/alerts/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE alerts SET is_read = TRUE WHERE id = $1', [id]);
    res.json({ message: 'Alert marked as read.' });
  } catch (err) {
    console.error('Mark alert read error:', err.message);
    res.status(500).json({ error: 'Server error marking alert as read.' });
  }
});

// ==================== PIPELINE & ML SERVICE ====================

/**
 * GET /api/tb/ml/health
 * Check if the Python ML service is reachable
 */
router.get('/ml/health', async (req, res) => {
  try {
    const healthy = await mlHealthCheck();
    res.json({
      ml_service: healthy ? 'healthy' : 'unreachable',
      status: healthy ? 'ok' : 'degraded',
    });
  } catch (err) {
    res.json({ ml_service: 'unreachable', status: 'error', error: err.message });
  }
});

/**
 * POST /api/tb/pipeline
 * Run the full prediction pipeline:
 *   1. Query L3 data → build series for ARIMA
 *   2. Call Python /forecast → get predictions
 *   3. Compute RF features per barangay
 *   4. Call Python /classify → get risk classes + proba
 *   5. Compute weighted risk scores
 *   6. Store all results in L4/L5/L6 tables
 *   7. Generate alerts for High-risk transitions
 *
 * Body: { period?: "YYYY-MM-DD", thresholds?: { low_max, med_max } }
 */
router.post('/pipeline', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { period, thresholds } = req.body || {};
    const result = await runPipeline({ period, thresholds });
    res.json({ message: 'Pipeline completed.', result });
  } catch (err) {
    console.error('Pipeline error:', err.message);
    res.status(500).json({ error: 'Pipeline failed.', details: err.message });
  }
});

/**
 * GET /api/tb/pipeline/status
 * Get the latest pipeline run metadata
 */
router.get('/pipeline/status', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, run_type, model_version, trained_at, training_months, metrics, config
       FROM model_metadata
       WHERE run_type = 'pipeline'
       ORDER BY trained_at DESC
       LIMIT 1`
    );
    res.json({ latest_run: result.rows[0] || null });
  } catch (err) {
    console.error('Pipeline status error:', err.message);
    res.status(500).json({ error: 'Server error fetching pipeline status.' });
  }
});

module.exports = router;
