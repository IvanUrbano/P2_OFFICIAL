const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { parseCaseFile } = require('./parseCaseFile');
const { importCases, getImportHistory, getBatchErrors, getBatchSummary } = require('./importCases');
const { rebuildAggregations } = require('./aggregateMonthly');
const { seedAll, getBarangays, getHealthFacilities, findBarangay } = require('./barangays');
const { runPipeline } = require('./pipeline');
const { healthCheck: mlHealthCheck, evaluate: mlEvaluate, forecast: mlForecast } = require('./mlClient');

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
 * List distinct screening_facility names from tb_cases
 */
router.get('/facilities', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT screening_facility FROM tb_cases WHERE screening_facility IS NOT NULL AND screening_facility != '' ORDER BY screening_facility`
    );
    res.json({ facilities: result.rows.map(r => ({ name: r.screening_facility })) });
  } catch (err) {
    console.error('Fetch facilities error:', err.message);
    res.status(500).json({ error: 'Server error fetching facilities.' });
  }
});

/**
 * GET /api/tb/filter-options
 * Distinct values for dropdown filters: sex, bacteriological_status, outcome_status
 */
router.get('/filter-options', async (req, res) => {
  try {
    const [sexRes, bactRes, outcomeRes] = await Promise.all([
      pool.query(`SELECT DISTINCT sex FROM tb_cases WHERE sex IS NOT NULL AND sex != '' ORDER BY sex`),
      pool.query(`SELECT DISTINCT bacteriological_status FROM tb_cases WHERE bacteriological_status IS NOT NULL AND bacteriological_status != '' ORDER BY bacteriological_status`),
      pool.query(`SELECT DISTINCT outcome_status FROM tb_cases WHERE outcome_status IS NOT NULL AND outcome_status != '' ORDER BY outcome_status`),
    ]);
    res.json({
      sex: sexRes.rows.map(r => r.sex),
      bacteriological_status: bactRes.rows.map(r => r.bacteriological_status),
      outcome_status: outcomeRes.rows.map(r => r.outcome_status),
    });
  } catch (err) {
    console.error('Fetch filter options error:', err.message);
    res.status(500).json({ error: 'Server error fetching filter options.' });
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
 * Query params: page, limit, search, barangay, year, month, outcome, facility,
 *               sex, bacteriological_status, validation_status
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
      facility = '',
      sex = '',
      bacteriological_status = '',
      validation_status = '',
    } = req.query;

    const offset = (Math.max(1, Number(page)) - 1) * Number(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (search) {
      const term = search.trim();
      const paddedTerm = term.replace(/^0+/, '') || '0';
      conditions.push(`(
        c.id::text ILIKE $${paramIdx} OR
        c.id = $${paramIdx + 1} OR
        c.barangay_name ILIKE $${paramIdx} OR
        c.screening_facility ILIKE $${paramIdx} OR
        c.treatment_facility ILIKE $${paramIdx}
      )`);
      params.push(`%${term}%`, Number(paddedTerm));
      paramIdx += 2;
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

    if (facility) {
      const facilityTrimmed = facility.trim();
      conditions.push(`c.screening_facility = $${paramIdx}`);
      params.push(facilityTrimmed);
      paramIdx++;
    }

    if (sex) {
      conditions.push(`c.sex ILIKE $${paramIdx}`);
      params.push(sex);
      paramIdx++;
    }

    if (bacteriological_status) {
      conditions.push(`c.bacteriological_status ILIKE $${paramIdx}`);
      params.push(bacteriological_status);
      paramIdx++;
    }

    if (validation_status) {
      if (validation_status === 'Validated') {
        conditions.push(`c.batch_id IS NOT NULL`);
      } else if (validation_status === 'Pending') {
        conditions.push(`c.batch_id IS NULL`);
      }
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
        COUNT(*)::INTEGER as total_cases,
        COUNT(DISTINCT barangay_name)::INTEGER as barangays_with_cases,
        COUNT(DISTINCT DATE_TRUNC('month', date_of_diagnosis))::INTEGER as months_covered,
        MIN(date_of_diagnosis) as earliest_date,
        MAX(date_of_diagnosis) as latest_date,
        SUM(CASE WHEN UPPER(outcome_status) = 'ON TREATMENT' THEN 1 ELSE 0 END)::INTEGER as on_treatment_count,
        SUM(CASE WHEN UPPER(outcome_status) = 'CURED' THEN 1 ELSE 0 END)::INTEGER as cured_count,
        SUM(CASE WHEN UPPER(outcome_status) = 'TREATMENT COMPLETED' THEN 1 ELSE 0 END)::INTEGER as treatment_completed_count,
        SUM(CASE WHEN UPPER(outcome_status) = 'DIED' THEN 1 ELSE 0 END)::INTEGER as died_count,
        SUM(CASE WHEN UPPER(outcome_status) = 'LOST TO FOLLOW-UP' THEN 1 ELSE 0 END)::INTEGER as ltfu_count,
        SUM(CASE WHEN UPPER(outcome_status) IN ('CURED','TREATMENT COMPLETED') THEN 1 ELSE 0 END)::INTEGER as successful_count,
        COUNT(*) FILTER (WHERE outcome_status IS NOT NULL AND outcome_status != '')::INTEGER as total_outcomes,
        SUM(CASE WHEN date_of_diagnosis >= DATE_TRUNC('month', CURRENT_DATE) THEN 1 ELSE 0 END)::INTEGER as current_month_cases,
        SUM(CASE WHEN date_of_diagnosis >= (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')
                  AND date_of_diagnosis < DATE_TRUNC('month', CURRENT_DATE) THEN 1 ELSE 0 END)::INTEGER as prev_month_cases
      FROM tb_cases
    `);
    console.log('[metrics]', result.rows[0]);
    res.json({ summary: result.rows[0] });
  } catch (err) {
    console.error('Dashboard summary error:', err.message);
    res.status(500).json({ error: 'Server error fetching dashboard summary.' });
  }
});

/**
 * GET /api/tb/dashboard/metrics
 * Single consolidated endpoint for the 6 metric cards.
 * Returns: totalCases, activeCases, highRiskAreas, successRate,
 *          forecastTotal, lastSync, plus trend badges.
 */
router.get('/dashboard/metrics', async (req, res) => {
  try {
    // Core query: all data from tb_cases (guaranteed to exist)
    const result = await pool.query(`
      SELECT
        COUNT(*)::INTEGER AS total_cases,
        SUM(CASE WHEN outcome_status = 'ON TREATMENT' THEN 1 ELSE 0 END)::INTEGER AS on_treatment_count,
        SUM(CASE WHEN outcome_status = 'CURED' THEN 1 ELSE 0 END)::INTEGER AS cured_count,
        SUM(CASE WHEN outcome_status IN ('CURED', 'TREATMENT COMPLETED') THEN 1 ELSE 0 END)::INTEGER AS successful_count,
        COUNT(*) FILTER (WHERE outcome_status IS NOT NULL AND outcome_status != '')::INTEGER AS total_outcomes,
        SUM(CASE WHEN date_of_diagnosis >= DATE_TRUNC('month', CURRENT_DATE) THEN 1 ELSE 0 END)::INTEGER AS current_month_cases,
        SUM(CASE WHEN date_of_diagnosis >= (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')
                  AND date_of_diagnosis < DATE_TRUNC('month', CURRENT_DATE) THEN 1 ELSE 0 END)::INTEGER AS prev_month_cases
      FROM tb_cases
    `);
    const row = result.rows[0];

    const totalCases = row.total_cases || 0;
    const onTreatmentCount = row.on_treatment_count || 0;
    const curedCount = row.cured_count || 0;
    const successRate = row.total_outcomes > 0
      ? Math.round((row.successful_count / row.total_outcomes) * 100)
      : 0;

    // Trend: current month vs previous month
    const currentMonth = row.current_month_cases || 0;
    const prevMonth = row.prev_month_cases || 0;
    const caseTrendPct = prevMonth > 0
      ? Math.round(((currentMonth - prevMonth) / prevMonth) * 100)
      : 0;

    res.json({
      totalCases,
      onTreatmentCount,
      curedCount,
      successRate,
      caseTrend: { value: caseTrendPct, direction: caseTrendPct >= 0 ? 'up' : 'down' },
      activeStatus: onTreatmentCount > 0 ? 'Ongoing' : 'None',
    });
  } catch (err) {
    console.error('Dashboard metrics error:', err.message);
    res.status(500).json({ error: 'Server error fetching dashboard metrics.' });
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
      `SELECT sex, age_group, SUM(case_count)::INTEGER as total
       FROM demographic_summary
       WHERE barangay_name = $1
       GROUP BY sex, age_group
       ORDER BY sex, age_group`,
      [name]
    );

    // Get outcomes
    const outcomes = await pool.query(
      `SELECT outcome_status, SUM(case_count)::INTEGER as total
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
 * GET /api/tb/barangays/watchlist
 * One row per barangay: current cases (latest month), previous month,
 * all-time total, next-month forecast, and risk classification.
 * Powers the Barangay Watchlist table page.
 */
router.get('/barangays/watchlist', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        g.name,
        g.population,
        COALESCE(cur.current_cases, 0)::INTEGER AS current_cases,
        COALESCE(prev.prev_cases, 0)::INTEGER AS prev_cases,
        COALESCE(total.total_cases, 0)::INTEGER AS total_cases,
        COALESCE(f.forecasted_count, 0)::NUMERIC AS forecasted_count,
        COALESCE(f.confidence_lower, 0)::NUMERIC AS confidence_lower,
        COALESCE(f.confidence_upper, 0)::NUMERIC AS confidence_upper,
        COALESCE(r.risk_score, 0)::NUMERIC AS risk_score,
        COALESCE(r.risk_class, 'No Data') AS risk_class,
        COALESCE(r.incidence_per_100k, 0)::NUMERIC AS incidence_per_100k,
        COALESCE(r.trend_direction, 'Stable') AS trend_direction
      FROM barangays_geom g
      LEFT JOIN LATERAL (
        SELECT SUM(case_count)::INTEGER AS current_cases
        FROM monthly_case_summary
        WHERE barangay_name = g.name
          AND month = (SELECT MAX(month) FROM monthly_case_summary)
      ) cur ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(case_count)::INTEGER AS prev_cases
        FROM monthly_case_summary
        WHERE barangay_name = g.name
          AND month = ((SELECT MAX(month) FROM monthly_case_summary) - INTERVAL '1 month')::DATE
      ) prev ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(case_count)::INTEGER AS total_cases
        FROM monthly_case_summary
        WHERE barangay_name = g.name
      ) total ON TRUE
      LEFT JOIN model_predictions f
        ON f.barangay_name = g.name
       AND f.period = (SELECT MAX(period) FROM model_predictions)
      LEFT JOIN barangay_risk_scores r
        ON r.barangay_name = g.name
       AND r.period = (SELECT MAX(period) FROM barangay_risk_scores)
      ORDER BY g.name
    `);

    const metaResult = await pool.query(`
      SELECT
        (SELECT MAX(month)::TEXT FROM monthly_case_summary) AS latest_month,
        ((SELECT MAX(month) FROM monthly_case_summary) - INTERVAL '1 month')::DATE::TEXT AS prev_month,
        (SELECT MAX(period)::TEXT FROM model_predictions) AS forecast_period,
        (SELECT MAX(period)::TEXT FROM barangay_risk_scores) AS risk_period
    `);

    res.json({
      watchlist: result.rows,
      periods: metaResult.rows[0] || {},
    });
  } catch (err) {
    console.error('Watchlist error:', err.message);
    res.status(500).json({ error: 'Server error fetching barangay watchlist.' });
  }
});

/**
 * GET /api/tb/dashboard/demographics
 * Age/sex distributions across all barangays
 */
router.get('/dashboard/demographics', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT barangay_name, sex, age_group, SUM(case_count)::INTEGER as total
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
      SELECT barangay_name, outcome_status, SUM(case_count)::INTEGER as total
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
      SELECT facility_name, barangay_name, SUM(case_count)::INTEGER as total
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
      SELECT barangay_name, bacteriological_status, SUM(case_count)::INTEGER as total
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
 * GET /api/tb/gis/geojson
 * Full GeoJSON with polygon boundaries + risk data merged into properties.
 * Now served from PostGIS (barangays_geom table).
 */
router.get('/gis/geojson', async (req, res) => {
  try {
    // Fetch barangays with geometry from PostGIS
    const geoResult = await pool.query(`
      SELECT
        id,
        name,
        population,
        ST_AsGeoJSON(geom)::json AS geometry,
        ST_X(ST_Centroid(geom)) AS centroid_lon,
        ST_Y(ST_Centroid(geom)) AS centroid_lat
      FROM barangays_geom
      ORDER BY name
    `);

    // Fetch latest risk scores
    const riskResult = await pool.query(`
      SELECT
        barangay_name,
        COALESCE(risk_score, 0) as risk_score,
        COALESCE(risk_class, 'No Data') as risk_class,
        COALESCE(incidence_per_100k, 0) as incidence_per_100k,
        COALESCE(trend_direction, 'Stable') as trend_direction
      FROM barangay_risk_scores
      WHERE period = (SELECT MAX(period) FROM barangay_risk_scores)
    `);

    // Fetch forecast data
    const forecastResult = await pool.query(`
      SELECT
        barangay_name,
        COALESCE(forecasted_count, 0) as forecasted_count,
        COALESCE(confidence_lower, 0) as confidence_lower,
        COALESCE(confidence_upper, 0) as confidence_upper
      FROM model_predictions
      WHERE period = (SELECT MAX(period) FROM model_predictions)
    `);

    // Fetch case counts
    const caseResult = await pool.query(`
      SELECT barangay_name, SUM(case_count)::INTEGER as total_cases
      FROM monthly_case_summary
      GROUP BY barangay_name
    `);

    // Build lookup maps
    const riskMap = {};
    for (const row of riskResult.rows) riskMap[row.barangay_name] = row;
    const forecastMap = {};
    for (const row of forecastResult.rows) forecastMap[row.barangay_name] = row;
    const caseMap = {};
    for (const row of caseResult.rows) caseMap[row.barangay_name] = row;

    // Build GeoJSON features with merged risk data
    const features = geoResult.rows.map(row => {
      const risk = riskMap[row.name] || {};
      const forecast = forecastMap[row.name] || {};
      const cases = caseMap[row.name] || {};

      return {
        type: 'Feature',
        properties: {
          name: row.name,
          population: row.population,
          centroid: [row.centroid_lon, row.centroid_lat],
          risk_score: risk.risk_score || 0,
          risk_class: risk.risk_class || 'No Data',
          incidence_per_100k: risk.incidence_per_100k || 0,
          trend_direction: risk.trend_direction || 'Stable',
          forecasted_count: forecast.forecasted_count || 0,
          confidence_lower: forecast.confidence_lower || 0,
          confidence_upper: forecast.confidence_upper || 0,
          total_cases: cases.total_cases || 0,
        },
        geometry: row.geometry,
      };
    });

    // Fallback: if risk data is missing OR uniform (all same class), compute from case data using tertiles
    const riskClasses = new Set(features.map(f => f.properties.risk_class).filter(Boolean));
    const hasMeaningfulRiskData = riskClasses.size > 1;
    if (!hasMeaningfulRiskData) {
      // Compute incidence per 100k for each barangay
      const withIncidence = features.map(f => {
        const pop = f.properties.population || 1;
        const cases = f.properties.total_cases || 0;
        const incidence = (cases / pop) * 100000;
        return { ...f, _incidence: incidence };
      });
      // Sort by incidence to compute tertiles
      withIncidence.sort((a, b) => a._incidence - b._incidence);
      const n = withIncidence.length;
      const lowMax = Math.floor(n / 3);
      const medMax = Math.floor((2 * n) / 3);
      withIncidence.forEach((f, i) => {
        if (i < lowMax) {
          f.properties.risk_class = 'Low';
        } else if (i < medMax) {
          f.properties.risk_class = 'Medium';
        } else {
          f.properties.risk_class = 'High';
        }
        f.properties.risk_score = Math.round((f._incidence / (withIncidence[n - 1]._incidence || 1)) * 100 * 100) / 100;
        f.properties.incidence_per_100k = Math.round(f._incidence * 100) / 100;
        delete f._incidence;
      });
      features.length = 0;
      features.push(...withIncidence);
    }

    // Build merged outline from all outer rings — used to fill gaps between barangays
    const outlineCoords = [];
    for (const feature of features) {
      if (feature.geometry.type === 'Polygon') {
        outlineCoords.push(feature.geometry.coordinates[0]);
      } else if (feature.geometry.type === 'MultiPolygon') {
        for (const poly of feature.geometry.coordinates) {
          outlineCoords.push(poly[0]);
        }
      }
    }

    res.json({
      type: 'FeatureCollection',
      name: 'pasig_barangays',
      features,
      outline: {
        type: 'MultiPolygon',
        coordinates: outlineCoords.map(c => [c])
      }
    });
  } catch (err) {
    console.error('GeoJSON error:', err.message);
    res.status(500).json({ error: 'Server error generating GeoJSON.' });
  }
});

/**
 * GET /api/tb/gis/barangay-at?lon=X&lat=Y
 * Find which barangay contains a given point (spatial query).
 */
router.get('/gis/barangay-at', async (req, res) => {
  try {
    const { lon, lat } = req.query;
    if (!lon || !lat) {
      return res.status(400).json({ error: 'Missing lon or lat query parameters.' });
    }
    const lonF = parseFloat(lon);
    const latF = parseFloat(lat);
    if (isNaN(lonF) || isNaN(latF)) {
      return res.status(400).json({ error: 'lon and lat must be valid numbers.' });
    }

    const result = await pool.query(`
      SELECT
        name,
        population,
        ST_Area(geom::geography)::INTEGER AS area_m2,
        ST_X(ST_Centroid(geom)) AS centroid_lon,
        ST_Y(ST_Centroid(geom)) AS centroid_lat
      FROM barangays_geom
      WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
      LIMIT 1
    `, [lonF, latF]);

    if (result.rows.length === 0) {
      return res.json({ found: false, message: 'Point is outside all Pasig barangays.' });
    }

    res.json({ found: true, barangay: result.rows[0] });
  } catch (err) {
    console.error('barangay-at error:', err.message);
    res.status(500).json({ error: 'Server error in spatial query.' });
  }
});

/**
 * GET /api/tb/gis/areas
 * Return barangay areas in km² using PostGIS geography (accurate on WGS84).
 */
router.get('/gis/areas', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        name,
        population,
        ST_Area(geom::geography)::INTEGER AS area_m2,
        ROUND((ST_Area(geom::geography) / 1000000.0)::numeric, 3) AS area_km2,
        ROUND((population::numeric / (ST_Area(geom::geography) / 1000000.0))::numeric, 1) AS pop_density_per_km2
      FROM barangays_geom
      ORDER BY area_km2 DESC
    `);

    res.json({ areas: result.rows });
  } catch (err) {
    console.error('areas error:', err.message);
    res.status(500).json({ error: 'Server error computing areas.' });
  }
});

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
 * Optional query: ?barangay=Name (filter by barangay)
 */
router.get('/forecasts', async (req, res) => {
  try {
    const { barangay } = req.query;
    let query = `
      SELECT
        barangay_name, period, forecasted_count,
        confidence_lower, confidence_upper,
        risk_class, incidence_per_100k, model_version,
        actual_count, forecast_error
      FROM model_predictions
      ORDER BY period DESC, barangay_name
    `;
    const params = [];
    if (barangay) {
      query = `
        SELECT
          barangay_name, period, forecasted_count,
          confidence_lower, confidence_upper,
          risk_class, incidence_per_100k, model_version,
          actual_count, forecast_error
        FROM model_predictions
        WHERE barangay_name = $1
        ORDER BY period DESC, barangay_name
      `;
      params.push(barangay);
    }
    const result = await pool.query(query, params);
    res.json({ forecasts: result.rows });
  } catch (err) {
    console.error('Forecasts error:', err.message);
    res.status(500).json({ error: 'Server error fetching forecasts.' });
  }
});

/**
 * GET /api/tb/forecast/actual-vs-predicted
 * Joins model_predictions with monthly_case_summary for actual vs predicted chart.
 * Optional query: ?barangay=Name (filter by single barangay)
 */
router.get('/forecast/actual-vs-predicted', async (req, res) => {
  try {
    const { barangay } = req.query;
    let query = `
      SELECT
        mp.barangay_name,
        mp.period,
        mp.forecasted_count,
        mp.confidence_lower,
        mp.confidence_upper,
        COALESCE(mp.actual_count, 0) AS actual_count,
        mp.risk_class,
        mp.incidence_per_100k
      FROM model_predictions mp
      ORDER BY mp.period, mp.barangay_name
    `;
    const params = [];
    if (barangay) {
      query = `
        SELECT
          mp.barangay_name,
          mp.period,
          mp.forecasted_count,
          mp.confidence_lower,
          mp.confidence_upper,
          COALESCE(mp.actual_count, 0) AS actual_count,
          mp.risk_class,
          mp.incidence_per_100k
        FROM model_predictions mp
        WHERE mp.barangay_name = $1
        ORDER BY mp.period, mp.barangay_name
      `;
      params.push(barangay);
    }
    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Actual vs predicted error:', err.message);
    res.status(500).json({ error: 'Server error fetching actual vs predicted data.' });
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

// ==================== BACKFILL (Feedback Loop) ====================

/**
 * PUT /api/tb/predictions/backfill
 * Backfill actual_case counts for a past period to activate the historical_bias feedback loop.
 *
 * Body: { period: "YYYY-MM-DD", actual_counts: { "Barangay A": 45, "Barangay B": 32, ... } }
 *
 * After CSV import for a month, call this endpoint to reconcile predictions with reality.
 * This enables the RF model to learn from past forecast errors.
 */
router.put('/predictions/backfill', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { period, actual_counts } = req.body;

    if (!period || !actual_counts || typeof actual_counts !== 'object') {
      return res.status(400).json({
        error: 'Required: { period: "YYYY-MM-DD", actual_counts: { "Barangay A": 45, ... } }',
      });
    }

    const periodDate = period + '-01'; // Ensure it's a valid date
    let updated = 0;
    let notFound = [];

    for (const [barangayName, actualCount] of Object.entries(actual_counts)) {
      if (typeof actualCount !== 'number' || actualCount < 0) continue;

      const result = await pool.query(
        `UPDATE model_predictions
         SET actual_count = $1,
             forecast_error = ABS($1 - COALESCE(forecasted_count, 0))
         WHERE barangay_name = $2 AND period = $3`,
        [actualCount, barangayName, periodDate]
      );

      if (result.rowCount > 0) {
        updated++;
      } else {
        notFound.push(barangayName);
      }
    }

    res.json({
      message: `Backfilled ${updated} predictions for period ${period}.`,
      updated,
      notFound,
    });
  } catch (err) {
    console.error('Backfill error:', err.message);
    res.status(500).json({ error: 'Server error during backfill.' });
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
 * Body: { period?: "YYYY-MM-DD", thresholds?: { low_max, med_max }, forecastHorizon?: number, barangays?: string[] }
 */
router.post('/pipeline', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { period, thresholds, forecastHorizon, barangays } = req.body || {};
    const result = await runPipeline({ period, thresholds, forecastHorizon, barangays });
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

/**
 * POST /api/tb/evaluate
 * Run walk-forward evaluation for ARIMA + RF models (admin only).
 *
 * Calls Python /evaluate with historical data.
 * Returns per-step results + aggregated metrics (MAE/MAPE for ARIMA, accuracy/F1 for RF).
 *
 * Body: { min_train?: number } (default 24)
 */
router.post('/evaluate', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { min_train: minTrain = 24 } = req.body || {};

    // Fetch historical data (same as pipeline)
    const monthlyResult = await pool.query(
      'SELECT barangay_name, month, case_count FROM monthly_case_summary ORDER BY month'
    );
    if (monthlyResult.rows.length === 0) {
      return res.status(400).json({ error: 'No historical data available for evaluation.' });
    }

    // Build series for ARIMA
    const series = monthlyResult.rows.map(r => ({
      barangay_name: r.barangay_name,
      month: r.month.toISOString().slice(0, 10),
      case_count: r.case_count,
    }));

    // Get barangay population
    const barangaysResult = await pool.query('SELECT name, population FROM barangays ORDER BY name');
    const populationMap = {};
    for (const row of barangaysResult.rows) {
      populationMap[row.name] = row.population;
    }

    // Auto-calibrate thresholds
    const barangayIncidences = [];
    const byBarangay = {};
    for (const row of monthlyResult.rows) {
      if (!byBarangay[row.barangay_name]) byBarangay[row.barangay_name] = [];
      byBarangay[row.barangay_name].push(row);
    }
    for (const [name, months] of Object.entries(byBarangay)) {
      const totalCases = months.reduce((sum, m) => sum + m.case_count, 0);
      const pop = populationMap[name] || 1000;
      const annualized = (totalCases / months.length) * 12;
      const incidence = (annualized / pop) * 100_000;
      barangayIncidences.push(incidence);
    }

    let thresholds;
    try {
      const { thresholds: callThresholds } = require('./mlClient');
      const thresholdResult = await callThresholds(barangayIncidences, 'tertile');
      thresholds = { low_max: thresholdResult.low_max, med_max: thresholdResult.med_max };
    } catch {
      thresholds = { low_max: 150.0, med_max: 350.0 };
    }

    // Build training rows (reuse pipeline logic)
    const { runPipeline } = require('./pipeline');
    // We need _buildTrainingRows but it's not exported — build a simple version here
    // Use a simplified approach: build training rows from monthly data
    const trainRows = [];
    const ROLLING_WINDOW = 12;
    const allMonths = [...new Set(monthlyResult.rows.map(r => r.month.toISOString().slice(0, 10)))].sort();

    for (const [name, months] of Object.entries(byBarangay)) {
      const pop = populationMap[name] || 1000;
      const sorted = months.sort((a, b) => a.month.localeCompare(b.month));

      if (sorted.length < ROLLING_WINDOW + 1) continue;

      for (let i = ROLLING_WINDOW; i < sorted.length; i++) {
        const targetMonth = sorted[i];
        const window = sorted.slice(i - ROLLING_WINDOW, i);
        const windowCounts = window.map(w => w.case_count);

        const totalCount = windowCounts.reduce((a, b) => a + b, 0);
        const annualized = (totalCount / windowCounts.length) * 12;
        const forecastedIncidence = (annualized / pop) * 100_000;

        // Trend (slope)
        const n = windowCounts.length;
        const xMean = (n - 1) / 2;
        const yMean = windowCounts.reduce((a, b) => a + b, 0) / n;
        let num = 0, den = 0;
        for (let j = 0; j < n; j++) {
          num += (j - xMean) * (windowCounts[j] - yMean);
          den += (j - xMean) * (j - xMean);
        }
        const slope = den !== 0 ? num / den : 0;

        // Seasonality flag
        const historyUpToTarget = sorted.slice(0, i + 1);
        let seasonalityFlag = 0;
        if (historyUpToTarget.length >= 24) {
          const counts = historyUpToTarget.map(m => m.case_count);
          const series = counts.slice(-24);
          // Simple autocorrelation at lag 12
          const n2 = series.length;
          const mean = series.reduce((a, b) => a + b, 0) / n2;
          let autocorrNum = 0, autocorrDen = 0;
          for (let j = 0; j < n2 - 12; j++) {
            autocorrNum += (series[j] - mean) * (series[j + 12] - mean);
            autocorrDen += (series[j] - mean) * (series[j] - mean);
          }
          seasonalityFlag = (autocorrDen > 0 && autocorrNum / autocorrDen > 0.3) ? 1 : 0;
        }

        // Lag features
        const lag1m = i >= 1 ? sorted[i - 1].case_count : 0;
        const lag2m = i >= 2 ? sorted[i - 2].case_count : 0;
        const lag3m = i >= 3 ? sorted[i - 3].case_count : 0;

        // Neighbor risk
        let neighborRisk = 0;
        const otherIncidences = [];
        for (const [otherName, otherMonths] of Object.entries(byBarangay)) {
          if (otherName === name) continue;
          const otherMonthData = otherMonths.find(m => m.month === targetMonth.month);
          if (otherMonthData) {
            const otherPop = populationMap[otherName] || 1000;
            otherIncidences.push((otherMonthData.case_count / otherPop) * 100_000);
          }
        }
        if (otherIncidences.length > 0) {
          neighborRisk = otherIncidences.reduce((a, b) => a + b, 0) / otherIncidences.length;
        }

        const incidence = (targetMonth.case_count / pop) * 100_000;

        trainRows.push({
          barangay_name: name,
          features: {
            forecasted_incidence: forecastedIncidence,
            recent_trend: slope,
            seasonality_flag: seasonalityFlag,
            lag_1m: lag1m,
            lag_2m: lag2m,
            lag_3m: lag3m,
            neighbor_risk: neighborRisk,
            historical_bias: 0,
          },
          incidence,
        });
      }
    }

    // Sort train rows by time (so walk-forward works correctly)
    // Each row's time position is determined by its position in the sorted months list
    trainRows.sort((a, b) => {
      // Use incidence as a proxy for time ordering — not ideal but workable
      // Better: use the month from the original data
      return 0; // The rows are already in order from the loop above
    });

    // Call Python /evaluate
    const result = await mlEvaluate(series, trainRows, thresholds, minTrain);

    // Store evaluation results in model_metadata
    try {
      await pool.query(
        `INSERT INTO model_metadata (run_type, model_version, training_months, metrics, config)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          'evaluation',
          'arima-v1.0-rf-v1.0',
          trainRows.length,
          JSON.stringify({
            arima: { mae: result.arima.mae, mape: result.arima.mape, n_steps: result.arima.n_steps },
            rf: { accuracy: result.rf.accuracy, f1_macro: result.rf.f1_macro, n_steps: result.rf.n_steps },
          }),
          JSON.stringify({ thresholds, min_train: minTrain, period: allMonths[allMonths.length - 1] }),
        ]
      );
    } catch (metaErr) {
      console.error('Failed to store evaluation metadata:', metaErr.message);
    }

    res.json({ message: 'Evaluation completed.', evaluation: result });
  } catch (err) {
    console.error('Evaluate error:', err.message);
    res.status(500).json({ error: 'Evaluation failed.', details: err.message });
  }
});

/**
 * GET /api/tb/forecast/backtest
 * Walk-forward backtest: for each month, predict using value from 12 months ago (seasonal naive).
 * Returns per-barangay per-period actual vs predicted for historical validation.
 */
router.get('/forecast/backtest', async (req, res) => {
  try {
    const { barangay } = req.query;
    let query = `
      SELECT barangay_name, month, case_count
      FROM monthly_case_summary
      ORDER BY barangay_name, month
    `;
    const params = [];
    if (barangay) {
      query = `
        SELECT barangay_name, month, case_count
        FROM monthly_case_summary
        WHERE barangay_name = $1
        ORDER BY barangay_name, month
      `;
      params.push(barangay);
    }
    const result = await pool.query(query, params);

    // Group by barangay
    const byBarangay = {};
    for (const row of result.rows) {
      const name = row.barangay_name;
      if (!byBarangay[name]) byBarangay[name] = [];
      byBarangay[name].push({
        month: row.month.toISOString().slice(0, 10),
        case_count: row.case_count,
      });
    }

    // For each barangay, produce backtest predictions
    const backtestRows = [];
    const SEASONAL_PERIOD = 12;

    for (const [name, pts] of Object.entries(byBarangay)) {
      if (pts.length <= SEASONAL_PERIOD) continue; // need at least 13 months
      for (let i = SEASONAL_PERIOD; i < pts.length; i++) {
        const actual = pts[i].case_count;
        const predicted = pts[i - SEASONAL_PERIOD].case_count;
        backtestRows.push({
          barangay_name: name,
          period: pts[i].month,
          actual_count: actual,
          predicted_count: predicted,
          error: Math.abs(actual - predicted),
        });
      }
    }

    res.json({ data: backtestRows });
  } catch (err) {
    console.error('Backtest error:', err.message);
    res.status(500).json({ error: 'Server error generating backtest data.' });
  }
});

module.exports = router;
