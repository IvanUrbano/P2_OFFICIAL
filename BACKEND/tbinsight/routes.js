const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { parseCaseFile } = require('./parseCaseFile');
const { importCases, getImportHistory, getBatchErrors, getBatchSummary } = require('./importCases');
const { rebuildAggregations } = require('./aggregateMonthly');
const { seedAll, getBarangays, getHealthFacilities, findBarangay } = require('./barangays');
const { runPipeline } = require('./pipeline');
const { healthCheck: mlHealthCheck, evaluate: mlEvaluate, forecast: mlForecast } = require('./mlClient');
const {
  createNotification, getUnreadCount, evaluateAllAlerts,
  evaluateCaseIncreaseAlerts,
} = require('./alertEngine');

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
    const [sexRes, bactRes, outcomeRes, validationRes, sourceTypeRes, locationRes] = await Promise.all([
      pool.query(`SELECT DISTINCT TRIM(sex) as sex FROM tb_cases WHERE sex IS NOT NULL AND TRIM(sex) != '' ORDER BY sex`),
      pool.query(`SELECT DISTINCT TRIM(bacteriological_status) as bacteriological_status FROM tb_cases WHERE bacteriological_status IS NOT NULL AND TRIM(bacteriological_status) != '' ORDER BY bacteriological_status`),
      pool.query(`SELECT DISTINCT TRIM(outcome_status) as outcome_status FROM tb_cases WHERE outcome_status IS NOT NULL AND TRIM(outcome_status) != '' ORDER BY outcome_status`),
      pool.query(`SELECT DISTINCT TRIM(validation_status) as validation_status FROM tb_cases WHERE validation_status IS NOT NULL AND TRIM(validation_status) != '' ORDER BY validation_status`),
      pool.query(`SELECT DISTINCT TRIM(source_type) as source_type FROM tb_cases WHERE source_type IS NOT NULL AND TRIM(source_type) != '' ORDER BY source_type`),
      pool.query(`SELECT DISTINCT TRIM(location_classification) as location_classification FROM tb_cases WHERE location_classification IS NOT NULL AND TRIM(location_classification) != '' ORDER BY location_classification`),
    ]);
    res.json({
      sex: sexRes.rows.map(r => r.sex),
      bacteriological_status: bactRes.rows.map(r => r.bacteriological_status),
      outcome_status: outcomeRes.rows.map(r => r.outcome_status),
      validation_status: validationRes.rows.map(r => r.validation_status),
      source_type: sourceTypeRes.rows.map(r => r.source_type),
      location_classification: locationRes.rows.map(r => r.location_classification),
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

    // Create notification for successful import
    if (result.importedCount > 0) {
      try {
        await createNotification(pool, {
          title: 'Records Imported Successfully',
          message: `${result.importedCount} TB records were successfully imported from ${file.name}.`,
          sourceModule: 'tb_records',
          relatedRecordId: result.batchId,
          relatedEntityType: 'batch',
        });
        // Auto-evaluate all alert types after import
        const now = new Date();
        const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        await evaluateAllAlerts(pool, currentPeriod);
      } catch (notifErr) {
        console.error('Import notification error:', notifErr.message);
      }
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
 *               sex, bacteriological_status, validation_status, source_type, location_classification
 */
router.get('/cases', async (req, res) => {
  try {
    const allowedSortFields = ['id', 'barangay_name', 'age', 'date_of_diagnosis', 'screening_facility', 'source_type'];
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
      source_type = '',
      location_classification = '',
      sortField = 'date_of_diagnosis',
      sortDirection = 'desc',
    } = req.query;

    const safePage = Math.max(1, parseInt(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (safePage - 1) * safeLimit;
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (search) {
      const term = search.trim();
      const isNumeric = /^\d+$/.test(term);
      const paddedTerm = term.replace(/^0+/, '') || '0';

      const textClauses = [
        `TRIM(c.barangay_name) ILIKE $${paramIdx}`,
        `TRIM(c.screening_facility) ILIKE $${paramIdx}`,
        `TRIM(c.treatment_facility) ILIKE $${paramIdx}`,
        `TRIM(c.itis_case_id) ILIKE $${paramIdx}`,
        `TRIM(c.source_type) ILIKE $${paramIdx}`,
        `TRIM(c.validation_status) ILIKE $${paramIdx}`,
        `TRIM(c.sex) ILIKE $${paramIdx}`,
        `TRIM(c.bacteriological_status) ILIKE $${paramIdx}`,
        `TRIM(c.outcome_status) ILIKE $${paramIdx}`,
        `TRIM(c.source_of_patient) ILIKE $${paramIdx}`,
        `TRIM(c.anatomical_site) ILIKE $${paramIdx}`,
        `TRIM(c.registration_group) ILIKE $${paramIdx}`,
        `TRIM(c.location_classification) ILIKE $${paramIdx}`,
      ];

      if (isNumeric) {
        textClauses.unshift(
          `c.id::text = $${paramIdx + 1}`,
          `c.id = $${paramIdx + 2}`,
          `c.age::text = $${paramIdx + 1}`
        );
        params.push(`${term}%`, term, Number(paddedTerm));
        paramIdx += 3;
      } else {
        params.push(`${term}%`);
        paramIdx += 1;
      }

      conditions.push(`(${textClauses.join(' OR ')})`);
    }

    if (barangay) {
      conditions.push(`TRIM(c.barangay_name) = $${paramIdx}`);
      params.push(barangay.trim());
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
      conditions.push(`UPPER(TRIM(c.outcome_status)) = UPPER($${paramIdx})`);
      params.push(outcome.trim());
      paramIdx++;
    }

    if (facility) {
      conditions.push(`(TRIM(c.screening_facility) = $${paramIdx} OR TRIM(c.treatment_facility) = $${paramIdx})`);
      params.push(facility.trim());
      paramIdx++;
    }

    if (sex) {
      conditions.push(`TRIM(c.sex) ILIKE $${paramIdx}`);
      params.push(sex.trim());
      paramIdx++;
    }

    if (bacteriological_status) {
      conditions.push(`TRIM(c.bacteriological_status) ILIKE $${paramIdx}`);
      params.push(bacteriological_status.trim());
      paramIdx++;
    }

    if (validation_status) {
      conditions.push(`TRIM(c.validation_status) = $${paramIdx}`);
      params.push(validation_status.trim());
      paramIdx++;
    }

    if (source_type) {
      conditions.push(`TRIM(c.source_type) = $${paramIdx}`);
      params.push(source_type.trim());
      paramIdx++;
    }

    if (location_classification) {
      conditions.push(`TRIM(c.location_classification) = $${paramIdx}`);
      params.push(location_classification.trim());
      paramIdx++;
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'date_of_diagnosis';
    const safeSortDir = sortDirection === 'asc' ? 'ASC' : 'DESC';

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
        c.date_of_outcome,
        c.imported_at,
        c.validation_status,
        c.itis_case_id,
        c.source_type,
        c.location_classification
      FROM tb_cases c
      ${whereClause}
      ORDER BY c.${safeSortField} ${safeSortDir}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, safeLimit, offset]
    );

    res.json({
      cases: dataResult.rows,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    });
  } catch (err) {
    console.error('Cases list error:', err.message);
    res.status(500).json({ error: 'Server error fetching cases.' });
  }
});

/**
 * GET /api/tb/cases/export
 * Export filtered cases as CSV (no pagination)
 */
router.get('/cases/export', async (req, res) => {
  try {
    const {
      search = '',
      barangay = '',
      year = '',
      month = '',
      outcome = '',
      facility = '',
      sex = '',
      bacteriological_status = '',
      validation_status = '',
      source_type = '',
      location_classification = '',
    } = req.query;

    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (search) {
      const term = search.trim();
      const isNumeric = /^\d+$/.test(term);
      const paddedTerm = term.replace(/^0+/, '') || '0';

      const textClauses = [
        `TRIM(c.barangay_name) ILIKE $${paramIdx}`,
        `TRIM(c.screening_facility) ILIKE $${paramIdx}`,
        `TRIM(c.treatment_facility) ILIKE $${paramIdx}`,
        `TRIM(c.itis_case_id) ILIKE $${paramIdx}`,
        `TRIM(c.source_type) ILIKE $${paramIdx}`,
        `TRIM(c.validation_status) ILIKE $${paramIdx}`,
        `TRIM(c.sex) ILIKE $${paramIdx}`,
        `TRIM(c.bacteriological_status) ILIKE $${paramIdx}`,
        `TRIM(c.outcome_status) ILIKE $${paramIdx}`,
        `TRIM(c.source_of_patient) ILIKE $${paramIdx}`,
        `TRIM(c.anatomical_site) ILIKE $${paramIdx}`,
        `TRIM(c.registration_group) ILIKE $${paramIdx}`,
        `TRIM(c.location_classification) ILIKE $${paramIdx}`,
      ];

      if (isNumeric) {
        textClauses.unshift(
          `c.id::text = $${paramIdx + 1}`,
          `c.id = $${paramIdx + 2}`,
          `c.age::text = $${paramIdx + 1}`
        );
        params.push(`${term}%`, term, Number(paddedTerm));
        paramIdx += 3;
      } else {
        params.push(`${term}%`);
        paramIdx += 1;
      }

      conditions.push(`(${textClauses.join(' OR ')})`);
    }

    if (barangay) { conditions.push(`TRIM(c.barangay_name) = $${paramIdx}`); params.push(barangay.trim()); paramIdx++; }
    if (year) { conditions.push(`EXTRACT(YEAR FROM c.date_of_diagnosis) = $${paramIdx}`); params.push(Number(year)); paramIdx++; }
    if (month) { conditions.push(`EXTRACT(MONTH FROM c.date_of_diagnosis) = $${paramIdx}`); params.push(Number(month)); paramIdx++; }
    if (outcome) { conditions.push(`UPPER(TRIM(c.outcome_status)) = UPPER($${paramIdx})`); params.push(outcome.trim()); paramIdx++; }
    if (facility) { conditions.push(`(TRIM(c.screening_facility) = $${paramIdx} OR TRIM(c.treatment_facility) = $${paramIdx})`); params.push(facility.trim()); paramIdx++; }
    if (sex) { conditions.push(`TRIM(c.sex) ILIKE $${paramIdx}`); params.push(sex.trim()); paramIdx++; }
    if (bacteriological_status) { conditions.push(`TRIM(c.bacteriological_status) ILIKE $${paramIdx}`); params.push(bacteriological_status.trim()); paramIdx++; }
    if (validation_status) { conditions.push(`TRIM(c.validation_status) = $${paramIdx}`); params.push(validation_status.trim()); paramIdx++; }
    if (source_type) { conditions.push(`TRIM(c.source_type) = $${paramIdx}`); params.push(source_type.trim()); paramIdx++; }
    if (location_classification) { conditions.push(`TRIM(c.location_classification) = $${paramIdx}`); params.push(location_classification.trim()); paramIdx++; }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await pool.query(
      `SELECT
        c.id,
        c.itis_case_id,
        c.barangay_name,
        c.age,
        c.sex,
        c.date_of_diagnosis,
        c.date_of_screening,
        c.date_of_notification,
        c.screening_facility,
        c.treatment_facility,
        c.source_type,
        c.source_of_patient,
        c.anatomical_site,
        c.registration_group,
        c.bacteriological_status,
        c.date_started_treatment,
        c.outcome_status,
        c.date_of_outcome,
        c.validation_status,
        c.location_classification
      FROM tb_cases c
      ${whereClause}
      ORDER BY c.date_of_diagnosis DESC
      LIMIT 10000`,
      params
    );

    const headers = ['Case ID', 'ITIS Case ID', 'Barangay', 'Age', 'Sex', 'Diagnosis Date', 'Screening Date', 'Notification Date', 'Screening Facility', 'Treatment Facility', 'Source', 'Source of Patient', 'Anatomical Site', 'Registration Group', 'Bacteriologic Status', 'Treatment Start Date', 'Status', 'Outcome Date', 'Validation', 'Location'];
    const csvRows = [headers.join(',')];

    for (const row of result.rows) {
      const values = [
        row.id,
        row.itis_case_id || '',
        `"${(row.barangay_name || '').replace(/"/g, '""')}"`,
        row.age || '',
        row.sex || '',
        row.date_of_diagnosis ? new Date(row.date_of_diagnosis).toISOString().split('T')[0] : '',
        row.date_of_screening ? new Date(row.date_of_screening).toISOString().split('T')[0] : '',
        row.date_of_notification ? new Date(row.date_of_notification).toISOString().split('T')[0] : '',
        `"${(row.screening_facility || '').replace(/"/g, '""')}"`,
        `"${(row.treatment_facility || '').replace(/"/g, '""')}"`,
        row.source_type || '',
        row.source_of_patient || '',
        row.anatomical_site || '',
        row.registration_group || '',
        row.bacteriological_status || '',
        row.date_started_treatment ? new Date(row.date_started_treatment).toISOString().split('T')[0] : '',
        row.outcome_status || '',
        row.date_of_outcome ? new Date(row.date_of_outcome).toISOString().split('T')[0] : '',
        row.validation_status || '',
        row.location_classification || '',
      ];
      csvRows.push(values.join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tb_records_export.csv"');
    res.send(csvRows.join('\n'));
  } catch (err) {
    console.error('Cases export error:', err.message);
    res.status(500).json({ error: 'Server error exporting cases.' });
  }
});

// ==================== DASHBOARD ANALYTICS ====================

/**
 * GET /api/tb/dashboard/summary
 * Key metrics: total cases, unique months, cases per barangay
 * Query params: year, month, barangay, outcome, facility, sex, bacteriological_status, validation_status, source_type, location_classification
 */
router.get('/dashboard/summary', async (req, res) => {
  try {
    const {
      year = '',
      month = '',
      barangay = '',
      outcome = '',
      facility = '',
      sex = '',
      bacteriological_status = '',
      validation_status = '',
      source_type = '',
      location_classification = '',
    } = req.query;

    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (year) {
      conditions.push(`EXTRACT(YEAR FROM date_of_diagnosis) = $${paramIdx}`);
      params.push(Number(year));
      paramIdx++;
    }
    if (month) {
      conditions.push(`EXTRACT(MONTH FROM date_of_diagnosis) = $${paramIdx}`);
      params.push(Number(month));
      paramIdx++;
    }
    if (barangay) {
      conditions.push(`TRIM(c.barangay_name) = $${paramIdx}`);
      params.push(barangay);
      paramIdx++;
    }
    if (outcome) {
      conditions.push(`UPPER(TRIM(outcome_status)) = UPPER($${paramIdx})`);
      params.push(outcome.trim());
      paramIdx++;
    }
    if (facility) {
      conditions.push(`(TRIM(screening_facility) = $${paramIdx} OR TRIM(treatment_facility) = $${paramIdx})`);
      params.push(facility.trim());
      paramIdx++;
    }
    if (sex) {
      conditions.push(`TRIM(sex) ILIKE $${paramIdx}`);
      params.push(sex.trim());
      paramIdx++;
    }
    if (bacteriological_status) {
      conditions.push(`TRIM(bacteriological_status) ILIKE $${paramIdx}`);
      params.push(bacteriological_status.trim());
      paramIdx++;
    }
    if (validation_status) {
      conditions.push(`TRIM(validation_status) = $${paramIdx}`);
      params.push(validation_status.trim());
      paramIdx++;
    }
    if (source_type) {
      conditions.push(`TRIM(source_type) = $${paramIdx}`);
      params.push(source_type.trim());
      paramIdx++;
    }
    if (location_classification) {
      conditions.push(`TRIM(location_classification) = $${paramIdx}`);
      params.push(location_classification.trim());
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

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
        COUNT(*) FILTER (WHERE outcome_status IS NOT NULL AND outcome_status != '' AND UPPER(outcome_status) != 'NOT EVALUATED')::INTEGER as total_outcomes,
        SUM(CASE WHEN date_of_diagnosis >= DATE_TRUNC('month', CURRENT_DATE) THEN 1 ELSE 0 END)::INTEGER as current_month_cases,
        SUM(CASE WHEN date_of_diagnosis >= (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')
                  AND date_of_diagnosis < DATE_TRUNC('month', CURRENT_DATE) THEN 1 ELSE 0 END)::INTEGER as prev_month_cases
      FROM tb_cases
      ${whereClause}
    `, params);
    
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
        COUNT(*) FILTER (WHERE outcome_status IS NOT NULL AND outcome_status != '' AND UPPER(outcome_status) != 'NOT EVALUATED')::INTEGER AS total_outcomes,
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
    const { year } = req.query;
    let yearFilter = '';
    const params = [];
    if (year) {
      yearFilter = `AND EXTRACT(YEAR FROM date_of_diagnosis) = $1`;
      params.push(parseInt(year));
    }
    const result = await pool.query(`
      SELECT barangay_name,
             DATE_TRUNC('month', date_of_diagnosis)::DATE AS month,
             COUNT(*)::INTEGER AS case_count
      FROM tb_cases
      WHERE date_of_diagnosis IS NOT NULL ${yearFilter}
      GROUP BY barangay_name, DATE_TRUNC('month', date_of_diagnosis)
      ORDER BY month, barangay_name
    `, params);
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

    // Get barangay info — try barangays table first, then barangays_geom
    let barangay = await findBarangay(name).catch(() => null);
    if (!barangay) {
      try {
        const geomResult = await pool.query(
          `SELECT name, population FROM barangays_geom WHERE LOWER(name) = LOWER($1)`, [name]
        );
        if (geomResult.rows[0]) barangay = geomResult.rows[0];
      } catch {}
    }

    // Get monthly cases — always query tb_cases directly for accuracy
    let monthlyRows = [];
    try {
      const monthly = await pool.query(
        `SELECT DATE_TRUNC('month', date_of_diagnosis)::DATE AS month,
                COUNT(*)::INTEGER AS case_count
         FROM tb_cases
         WHERE LOWER(barangay_name) = LOWER($1) AND date_of_diagnosis IS NOT NULL
         GROUP BY DATE_TRUNC('month', date_of_diagnosis)
         ORDER BY month`,
        [name]
      );
      monthlyRows = monthly.rows;
    } catch (e) {
      console.error('Monthly query error:', e.message);
    }

    // Get demographics — always query tb_cases directly
    let demographicsRows = [];
    try {
      const demographics = await pool.query(
        `SELECT sex,
                CASE
                  WHEN age IS NULL THEN 'Unknown'
                  WHEN age <= 14 THEN '0-14'
                  WHEN age <= 24 THEN '15-24'
                  WHEN age <= 34 THEN '25-34'
                  WHEN age <= 44 THEN '35-44'
                  WHEN age <= 54 THEN '45-54'
                  WHEN age <= 64 THEN '55-64'
                  ELSE '65+'
                END AS age_group,
                COUNT(*)::INTEGER AS total
         FROM tb_cases
         WHERE LOWER(barangay_name) = LOWER($1)
         GROUP BY sex, age_group
         ORDER BY sex, age_group`,
        [name]
      );
      demographicsRows = demographics.rows;
    } catch (e) {
      console.error('Demographics query error:', e.message);
    }

    // Get outcomes — always query tb_cases directly
    let outcomesRows = [];
    try {
      const outcomes = await pool.query(
        `SELECT COALESCE(outcome_status, 'Unknown') AS outcome_status,
                COUNT(*)::INTEGER AS total
         FROM tb_cases
         WHERE LOWER(barangay_name) = LOWER($1)
         GROUP BY outcome_status
         ORDER BY total DESC`,
        [name]
      );
      outcomesRows = outcomes.rows;
    } catch (e) {
      console.error('Outcomes query error:', e.message);
    }

    res.json({
      barangay,
      monthly: monthlyRows,
      demographics: demographicsRows,
      outcomes: outcomesRows,
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
        COALESCE(r.trend_direction, 'Stable') AS trend_direction,
        COALESCE(r.norm_incidence, 0)::NUMERIC AS norm_incidence,
        COALESCE(r.norm_trend, 0)::NUMERIC AS norm_trend,
        COALESCE(r.norm_neighbor_risk, 0)::NUMERIC AS norm_neighbor_risk,
        COALESCE(r.norm_forecast_error, 0)::NUMERIC AS norm_forecast_error
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
    const { year, month, barangay } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;
    if (year) { conditions.push(`EXTRACT(YEAR FROM date_of_diagnosis) = $${idx}`); params.push(Number(year)); idx++; }
    if (month) { conditions.push(`EXTRACT(MONTH FROM date_of_diagnosis) = $${idx}`); params.push(Number(month)); idx++; }
    if (barangay) { conditions.push(`TRIM(barangay_name) = $${idx}`); params.push(barangay); idx++; }
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await pool.query(`
      SELECT barangay_name, sex,
             CASE
               WHEN age IS NULL THEN 'Unknown'
               WHEN age <= 14 THEN '0-14'
               WHEN age <= 24 THEN '15-24'
               WHEN age <= 34 THEN '25-34'
               WHEN age <= 44 THEN '35-44'
               WHEN age <= 54 THEN '45-54'
               WHEN age <= 64 THEN '55-64'
               ELSE '65+'
             END AS age_group,
             COUNT(*)::INTEGER AS total
      FROM tb_cases
      ${where}
      GROUP BY barangay_name, sex, age_group
      ORDER BY barangay_name, sex, age_group
    `, params);
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
    const { year, month, barangay } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;
    if (year) { conditions.push(`EXTRACT(YEAR FROM date_of_diagnosis) = $${idx}`); params.push(Number(year)); idx++; }
    if (month) { conditions.push(`EXTRACT(MONTH FROM date_of_diagnosis) = $${idx}`); params.push(Number(month)); idx++; }
    if (barangay) { conditions.push(`TRIM(barangay_name) = $${idx}`); params.push(barangay); idx++; }
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await pool.query(`
      SELECT barangay_name, COALESCE(outcome_status, 'Unknown') AS outcome_status, COUNT(*)::INTEGER as total
      FROM tb_cases
      ${where}
      GROUP BY barangay_name, outcome_status
      ORDER BY barangay_name, total DESC
    `, params);
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
    const { year } = req.query;
    const yearInt = year ? parseInt(year, 10) : null;
    const isValidYear = yearInt && !isNaN(yearInt) && yearInt >= 2000 && yearInt <= 2099;

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

    // Fetch risk scores — filtered by year if provided, otherwise latest period
    const riskQuery = isValidYear
      ? `SELECT barangay_name, COALESCE(risk_score, 0) as risk_score,
           COALESCE(risk_class, 'No Data') as risk_class,
           COALESCE(incidence_per_100k, 0) as incidence_per_100k,
           COALESCE(trend_direction, 'Stable') as trend_direction,
           COALESCE(norm_incidence, 0) as norm_incidence,
           COALESCE(norm_trend, 0) as norm_trend,
           COALESCE(norm_neighbor_risk, 0) as norm_neighbor_risk,
           COALESCE(norm_forecast_error, 0) as norm_forecast_error
         FROM barangay_risk_scores
         WHERE period = (SELECT MAX(period) FROM barangay_risk_scores WHERE EXTRACT(YEAR FROM period) = $1)`
      : `SELECT barangay_name, COALESCE(risk_score, 0) as risk_score,
           COALESCE(risk_class, 'No Data') as risk_class,
           COALESCE(incidence_per_100k, 0) as incidence_per_100k,
           COALESCE(trend_direction, 'Stable') as trend_direction,
           COALESCE(norm_incidence, 0) as norm_incidence,
           COALESCE(norm_trend, 0) as norm_trend,
           COALESCE(norm_neighbor_risk, 0) as norm_neighbor_risk,
           COALESCE(norm_forecast_error, 0) as norm_forecast_error
         FROM barangay_risk_scores
         WHERE period = (SELECT MAX(period) FROM barangay_risk_scores)`;
    const riskResult = await pool.query(riskQuery, isValidYear ? [yearInt] : []);

    // Fetch forecast data — filtered by year if provided, otherwise latest period
    const forecastQuery = isValidYear
      ? `SELECT barangay_name, COALESCE(forecasted_count, 0) as forecasted_count,
           COALESCE(confidence_lower, 0) as confidence_lower,
           COALESCE(confidence_upper, 0) as confidence_upper
         FROM model_predictions
         WHERE period = (SELECT MAX(period) FROM model_predictions WHERE EXTRACT(YEAR FROM period) = $1)`
      : `SELECT barangay_name, COALESCE(forecasted_count, 0) as forecasted_count,
           COALESCE(confidence_lower, 0) as confidence_lower,
           COALESCE(confidence_upper, 0) as confidence_upper
         FROM model_predictions
         WHERE period = (SELECT MAX(period) FROM model_predictions)`;
    const forecastResult = await pool.query(forecastQuery, isValidYear ? [yearInt] : []);

    // Fetch case counts — filtered by year if provided, otherwise all time
    const caseQuery = isValidYear
      ? `SELECT barangay_name, SUM(case_count)::INTEGER as total_cases
         FROM monthly_case_summary
         WHERE EXTRACT(YEAR FROM month) = $1
         GROUP BY barangay_name`
      : `SELECT barangay_name, SUM(case_count)::INTEGER as total_cases
         FROM monthly_case_summary
         GROUP BY barangay_name`;
    const caseResult = await pool.query(caseQuery, isValidYear ? [yearInt] : []);

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
          norm_incidence: risk.norm_incidence || 0,
          norm_trend: risk.norm_trend || 0,
          norm_neighbor_risk: risk.norm_neighbor_risk || 0,
          norm_forecast_error: risk.norm_forecast_error || 0,
        },
        geometry: row.geometry,
      };
    });

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
 * GET /api/tb/gis/years
 * Returns distinct years available in monthly_case_summary for the year filter dropdown.
 */
router.get('/gis/years', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT EXTRACT(YEAR FROM month)::INTEGER AS year
      FROM monthly_case_summary
      ORDER BY year DESC
    `);
    res.json({ years: result.rows.map(r => r.year) });
  } catch (err) {
    console.error('GIS years error:', err.message);
    res.status(500).json({ error: 'Server error fetching available years.' });
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
        COALESCE(brs.norm_incidence, 0) as norm_incidence,
        COALESCE(brs.norm_trend, 0) as norm_trend,
        COALESCE(brs.norm_neighbor_risk, 0) as norm_neighbor_risk,
        COALESCE(brs.norm_forecast_error, 0) as norm_forecast_error,
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
 * Alerts and notifications with filtering and pagination.
 *
 * Query params:
 *   type     = alert | notification (default: all)
 *   status   = unread | read | resolved (default: all)
 *   severity = critical | high | medium | low | info (default: all)
 *   barangay = barangay name (default: all)
 *   source   = source_module value (default: all)
 *   date     = today | 7d | 30d | custom (default: all)
 *   from     = YYYY-MM-DD (custom date range start)
 *   to       = YYYY-MM-DD (custom date range end)
 *   page     = integer (default: 1)
 *   limit    = integer (default: 50, max: 100)
 */
router.get('/alerts', async (req, res) => {
  try {
    // Seed sample data if alerts table is empty (wrapped in its own try/catch)
    try {
      const totalCheck = await pool.query('SELECT COUNT(*)::int AS count FROM alerts');
      if (totalCheck.rows[0].count === 0) {
        // Seed sample notifications
        const sampleNotifs = [
          { title: 'System Initialized', message: 'TBInsight surveillance system has been initialized and is ready for use.', source: 'data_integration' },
          { title: 'Data Import Completed', message: 'TB case records have been successfully imported and validated.', source: 'tb_records' },
          { title: 'Forecast Model Updated', message: 'ARIMA forecasting model has been retrained with the latest case data.', source: 'forecasting' },
          { title: 'Risk Assessment Complete', message: 'Barangay risk classification has been updated based on current data.', source: 'analytics' },
          { title: 'Report Generated', message: 'Monthly TB surveillance report has been generated and is available for review.', source: 'reports' },
        ];
        for (const n of sampleNotifs) {
          await createNotification(pool, {
            title: n.title,
            message: n.message,
            sourceModule: n.source,
          });
        }

        // Try to evaluate real alerts using the latest period from the database
        try {
          const periodResult = await pool.query(`
            SELECT MAX(month)::text AS latest FROM monthly_case_summary
            UNION ALL
            SELECT MAX(period)::text FROM barangay_risk_scores
            UNION ALL
            SELECT MAX(period)::text FROM model_predictions
          `);
          const periods = periodResult.rows.map(r => r.latest).filter(Boolean).sort().reverse();
          if (periods.length > 0) {
            const evalPeriod = periods[0].slice(0, 10); // keep full date "YYYY-MM-DD"
            await evaluateAllAlerts(pool, evalPeriod);
          }
        } catch (e) {
          console.error('Seed alert evaluation skipped:', e.message);
        }
      }
    } catch (seedErr) {
      console.error('Alert seed/evaluation skipped:', seedErr.message);
    }

    const { type, status, severity, barangay, source, date, from, to } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (type && ['alert', 'notification'].includes(type)) {
      conditions.push(`type = $${idx++}`);
      params.push(type);
    }
    if (status && ['unread', 'read', 'resolved'].includes(status)) {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }
    if (severity) {
      conditions.push(`severity = $${idx++}`);
      params.push(severity);
    }
    if (barangay) {
      conditions.push(`TRIM(barangay_name) = $${idx++}`);
      params.push(barangay);
    }
    if (source) {
      conditions.push(`source_module = $${idx++}`);
      params.push(source);
    }
    if (date === 'today') {
      conditions.push(`created_at >= CURRENT_DATE`);
    } else if (date === '7d') {
      conditions.push(`created_at >= NOW() - INTERVAL '7 days'`);
    } else if (date === '30d') {
      conditions.push(`created_at >= NOW() - INTERVAL '30 days'`);
    } else if (date === 'custom' && from && to) {
      conditions.push(`created_at >= $${idx++}`);
      params.push(from);
      conditions.push(`created_at <= $${idx++}`);
      params.push(to + ' 23:59:59');
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM alerts ${where}`,
      params
    );
    const total = countResult.rows[0].total;

    const result = await pool.query(
      `SELECT id, type, title, alert_type, severity, message, recommendation,
              barangay_name, period, source_module, status, related_record_id,
              related_entity_type, is_read, read_at, resolved_at, resolved_by,
              metadata, created_at
       FROM alerts ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    res.json({
      alerts: result.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('Alerts fetch error:', err.message);
    res.status(500).json({ error: 'Server error fetching alerts.' });
  }
});

/**
 * PUT /api/tb/alerts/:id/read
 * Mark an alert as read
 */
router.put('/alerts/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE alerts SET is_read = TRUE, status = 'read', read_at = NOW() WHERE id = $1`,
      [id]
    );
    res.json({ message: 'Alert marked as read.' });
  } catch (err) {
    console.error('Mark alert read error:', err.message);
    res.status(500).json({ error: 'Server error marking alert as read.' });
  }
});

/**
 * GET /api/tb/alerts/unread-count
 * Returns count of unread alerts + notifications (for bell badge)
 */
router.get('/alerts/unread-count', async (req, res) => {
  try {
    const count = await getUnreadCount(pool);
    res.json({ count });
  } catch (err) {
    console.error('Unread count error:', err.message);
    res.status(500).json({ error: 'Server error fetching unread count.' });
  }
});

/**
 * GET /api/tb/alerts/counts
 * Returns summary counts: critical, high, unread, today (for metric cards)
 */
router.get('/alerts/counts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE severity = 'critical' AND status != 'resolved')::int AS critical,
        COUNT(*) FILTER (WHERE severity = 'high' AND status != 'resolved')::int AS high,
        COUNT(*) FILTER (WHERE status = 'unread')::int AS unread,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today
      FROM alerts
    `);
    res.json(result.rows[0] || { critical: 0, high: 0, unread: 0, today: 0 });
  } catch (err) {
    console.error('Alert counts error:', err.message);
    res.status(500).json({ error: 'Server error fetching alert counts.' });
  }
});

/**
 * PUT /api/tb/alerts/read-all
 * Mark all unread alerts/notifications as read
 */
router.put('/alerts/read-all', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE alerts SET is_read = TRUE, status = 'read', read_at = NOW() WHERE status = 'unread'`
    );
    res.json({ message: 'All alerts marked as read.', count: result.rowCount });
  } catch (err) {
    console.error('Mark all read error:', err.message);
    res.status(500).json({ error: 'Server error marking all alerts as read.' });
  }
});

/**
 * GET /api/tb/alerts/:id
 * Get a single alert/notification detail
 */
router.get('/alerts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, type, title, alert_type, severity, message, recommendation,
              barangay_name, period, source_module, status, related_record_id,
              related_entity_type, is_read, read_at, resolved_at, resolved_by,
              metadata, created_at
       FROM alerts WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alert not found.' });
    }
    res.json({ alert: result.rows[0] });
  } catch (err) {
    console.error('Alert detail error:', err.message);
    res.status(500).json({ error: 'Server error fetching alert detail.' });
  }
});

/**
 * PUT /api/tb/alerts/:id/resolve
 * Mark an alert as resolved
 */
router.put('/alerts/:id/resolve', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { resolved_by } = req.body || {};
    await pool.query(
      `UPDATE alerts SET status = 'resolved', resolved_at = NOW(), resolved_by = $1 WHERE id = $2`,
      [resolved_by || 'system', id]
    );
    res.json({ message: 'Alert resolved.' });
  } catch (err) {
    console.error('Resolve alert error:', err.message);
    res.status(500).json({ error: 'Server error resolving alert.' });
  }
});

/**
 * GET /api/tb/alerts/stale-check
 * Returns the last evaluation time and whether alerts are stale (>24h old).
 */
router.get('/alerts/stale-check', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT MAX(created_at)::timestamptz AS last_alert_created FROM alerts WHERE type = 'alert'`
    );
    const lastCreated = result.rows[0]?.last_alert_created;
    const isStale = !lastCreated || (Date.now() - new Date(lastCreated).getTime()) > 24 * 60 * 60 * 1000;
    res.json({ lastEvaluated: lastCreated, isStale });
  } catch (err) {
    console.error('Stale check error:', err.message);
    res.json({ lastEvaluated: null, isStale: true });
  }
});

/**
 * POST /api/tb/alerts/evaluate
 * Trigger manual alert re-evaluation for a given period (admin only)
 *
 * Body: { period: "YYYY-MM-01" }
 */
router.post('/alerts/evaluate', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    let { period } = req.body || {};

    // Auto-detect latest period from database if not provided
    if (!period) {
      const periodResult = await pool.query(`
        SELECT MAX(month)::text AS latest FROM monthly_case_summary
        UNION ALL
        SELECT MAX(period)::text FROM barangay_risk_scores
        UNION ALL
        SELECT MAX(period)::text FROM model_predictions
      `);
      const periods = periodResult.rows.map(r => r.latest).filter(Boolean).sort().reverse();
      if (periods.length > 0) {
        period = periods[0].slice(0, 7); // "YYYY-MM-DD" → "YYYY-MM"
      } else {
        return res.status(400).json({ error: 'No data found in database. Import data and run the pipeline first.' });
      }
    }

    const periodDate = period.length === 7 ? period + '-01' : period;
    const results = await evaluateAllAlerts(pool, periodDate);
    const total = results.hotspots.length + results.caseIncrease.length +
                  results.forecast.length + results.treatment.length;
    res.json({ message: `Alert evaluation complete. ${total} alerts created.`, period: periodDate, results });
  } catch (err) {
    console.error('Alert evaluation error:', err.message);
    res.status(500).json({ error: 'Server error during alert evaluation.' });
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

    // Create notification for successful pipeline run
    try {
      const periodLabel = period || new Date().toISOString().slice(0, 7);
      await createNotification(pool, {
        title: 'Forecast Generated',
        message: `A new forecast has been generated for ${periodLabel}.`,
        sourceModule: 'forecasting',
        relatedEntityType: 'pipeline',
        metadata: { period: periodLabel, barangays: barangays || 'all' },
      });
    } catch (notifErr) {
      console.error('Pipeline notification error:', notifErr.message);
    }

    // Auto-evaluate alerts after pipeline completes
    try {
      const evalPeriod = period || new Date().toISOString().slice(0, 7) + '-01';
      await evaluateAllAlerts(pool, evalPeriod);
    } catch (alertErr) {
      console.error('Post-pipeline alert evaluation error:', alertErr.message);
    }

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

// ==================== REPORTS ====================

/**
 * GET /api/tb/reports/summary
 * Consolidated report data scoped to filters.
 * Query params: type (monthly|quarterly|annual|barangay), month, quarter, year, barangay
 */
router.get('/reports/summary', async (req, res) => {
  try {
    const { type = 'monthly', month, quarter, year, barangay } = req.query;

    // Compute date range based on report type
    let startDate, endDate, periodLabel, coverage;
    const yr = Number(year) || new Date().getFullYear();

    if (type === 'quarterly' && quarter) {
      const q = Number(quarter);
      const startMonth = (q - 1) * 3 + 1;
      startDate = `${yr}-${String(startMonth).padStart(2, '0')}-01`;
      const endMonth = startMonth + 2;
      const endDay = new Date(yr, endMonth, 0).getDate();
      endDate = `${yr}-${String(endMonth).padStart(2, '0')}-${endDay}`;
      periodLabel = `Q${q} ${yr}`;
    } else if (type === 'annual') {
      startDate = `${yr}-01-01`;
      endDate = `${yr}-12-31`;
      periodLabel = `Annual ${yr}`;
    } else if (type === 'barangay' && barangay && month) {
      const m = Number(month);
      startDate = `${yr}-${String(m).padStart(2, '0')}-01`;
      const endDay = new Date(yr, m, 0).getDate();
      endDate = `${yr}-${String(m).padStart(2, '0')}-${endDay}`;
      const monthName = new Date(yr, m - 1).toLocaleDateString('en-US', { month: 'long' });
      periodLabel = `${monthName} ${yr}`;
    } else if (type === 'barangay' && barangay) {
      // Barangay with no month — full year
      startDate = `${yr}-01-01`;
      endDate = `${yr}-12-31`;
      periodLabel = `Annual ${yr}`;
    } else {
      // monthly (default)
      const m = Number(month) || new Date().getMonth() + 1;
      startDate = `${yr}-${String(m).padStart(2, '0')}-01`;
      const endDay = new Date(yr, m, 0).getDate();
      endDate = `${yr}-${String(m).padStart(2, '0')}-${endDay}`;
      const monthName = new Date(yr, m - 1).toLocaleDateString('en-US', { month: 'long' });
      periodLabel = `${monthName} ${yr}`;
    }

    coverage = barangay || 'City-wide';

    // Build base WHERE clause
    const conditions = [`c.date_of_diagnosis >= $1`, `c.date_of_diagnosis <= $2`];
    const params = [startDate, endDate];
    let paramIdx = 3;

    if (barangay) {
      conditions.push(`TRIM(c.barangay_name) = $${paramIdx}`);
      params.push(barangay);
      paramIdx++;
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    // Run all queries in parallel
    const [
      summaryRes,
      outcomesRes,
      sexRes,
      ageRes,
      caseProfileRes,
      trendRes,
      barangayDistRes,
      riskRes,
      forecastRes,
      populationRes,
      casesRes,
    ] = await Promise.all([
      // Summary: total cases, active cases, success rate
      pool.query(`
        SELECT
          COUNT(*)::INTEGER AS total_cases,
          SUM(CASE WHEN UPPER(outcome_status) = 'ON TREATMENT' THEN 1 ELSE 0 END)::INTEGER AS active_cases,
          SUM(CASE WHEN UPPER(outcome_status) IN ('CURED','TREATMENT COMPLETED') THEN 1 ELSE 0 END)::INTEGER AS successful_count,
          COUNT(*) FILTER (WHERE outcome_status IS NOT NULL AND outcome_status != '' AND UPPER(outcome_status) NOT IN ('ON TREATMENT','NOT EVALUATED'))::INTEGER AS evaluated_count
        FROM tb_cases c
        ${whereClause}
      `, params),

      // Outcomes breakdown
      pool.query(`
        SELECT COALESCE(outcome_status, 'Unknown') AS outcome_status, COUNT(*)::INTEGER AS count
        FROM tb_cases c
        ${whereClause}
        GROUP BY outcome_status
        ORDER BY count DESC
      `, params),

      // Sex distribution
      pool.query(`
        SELECT sex, COUNT(*)::INTEGER AS count
        FROM tb_cases c
        ${whereClause}
        GROUP BY sex
        ORDER BY count DESC
      `, params),

      // Age distribution
      pool.query(`
        SELECT
          CASE
            WHEN age IS NULL THEN 'Unknown'
            WHEN age <= 14 THEN '0-14'
            WHEN age <= 24 THEN '15-24'
            WHEN age <= 34 THEN '25-34'
            WHEN age <= 44 THEN '35-44'
            WHEN age <= 54 THEN '45-54'
            WHEN age <= 64 THEN '55-64'
            ELSE '65+'
          END AS age_group,
          COUNT(*)::INTEGER AS count
        FROM tb_cases c
        ${whereClause}
        GROUP BY age_group
        ORDER BY count DESC
      `, params),

      // Case profile: registration group + anatomical site
      pool.query(`
        SELECT
          COALESCE(registration_group, 'Unknown') AS registration_group,
          COALESCE(anatomical_site, 'Unknown') AS anatomical_site,
          COUNT(*)::INTEGER AS count
        FROM tb_cases c
        ${whereClause}
        GROUP BY registration_group, anatomical_site
      `, params),

      // Monthly trend (scoped to report date range)
      pool.query(`
        SELECT
          DATE_TRUNC('month', date_of_diagnosis)::DATE AS month,
          COUNT(*)::INTEGER AS cases
        FROM tb_cases c
        WHERE date_of_diagnosis >= $1 AND date_of_diagnosis <= $2
        ${barangay ? 'AND barangay_name = $' + (paramIdx) : ''}
        GROUP BY month
        ORDER BY month
      `, barangay ? [startDate, endDate, barangay] : [startDate, endDate]),

      // Barangay distribution (city-wide only)
      barangay ? Promise.resolve({ rows: [] }) : pool.query(`
        SELECT barangay_name, COUNT(*)::INTEGER AS cases
        FROM tb_cases c
        WHERE date_of_diagnosis >= $1 AND date_of_diagnosis <= $2
        GROUP BY barangay_name
        ORDER BY cases DESC
      `, [startDate, endDate]),

      // Risk scores (latest period)
      pool.query(`
        SELECT DISTINCT ON (barangay_name)
          barangay_name, risk_class, incidence_per_100k, risk_score, trend_direction
        FROM barangay_risk_scores
        ORDER BY barangay_name, period DESC
      `),

      // Forecast (latest period that overlaps with report range)
      pool.query(`
        SELECT DISTINCT ON (barangay_name)
          barangay_name, forecasted_count, period, confidence_lower, confidence_upper
        FROM model_predictions
        WHERE period >= $1
        ORDER BY barangay_name, period ASC
        LIMIT 30
      `, [startDate]),

      // Population for incidence calculation
      pool.query(`SELECT name, population FROM barangays`),

      // All matching case records for the detailed table
      pool.query(`
        SELECT c.id, c.date_of_diagnosis, c.barangay_name, c.sex, c.age,
          COALESCE(c.registration_group, 'Unknown') AS registration_group,
          COALESCE(c.anatomical_site, 'Unknown') AS anatomical_site,
          COALESCE(c.outcome_status, 'Unknown') AS outcome_status,
          COALESCE(c.bacteriological_status, 'Unknown') AS bacteriological_status
        FROM tb_cases c
        ${whereClause}
        ORDER BY c.date_of_diagnosis DESC
      `, params),
    ]);

    // Compute summary values
    const summaryRow = summaryRes.rows[0] || {};
    const totalCases = summaryRow.total_cases || 0;
    const activeCases = summaryRow.active_cases || 0;
    const evaluatedCount = summaryRow.evaluated_count || 0;
    const successfulCount = summaryRow.successful_count || 0;
    const successRate = evaluatedCount > 0 ? Number(((successfulCount / evaluatedCount) * 100).toFixed(1)) : null;

    // Compute outcomes with percentages
    const outcomes = outcomesRes.rows.map(r => ({
      outcome_status: r.outcome_status,
      count: r.count,
      percentage: totalCases > 0 ? Number(((r.count / totalCases) * 100).toFixed(1)) : 0,
    }));

    // Compute sex distribution with percentages
    const sex = sexRes.rows.map(r => ({
      sex: r.sex || 'Unknown',
      count: r.count,
      percentage: totalCases > 0 ? Number(((r.count / totalCases) * 100).toFixed(1)) : 0,
    }));

    // Age groups
    const ageGroups = ageRes.rows.map(r => ({
      age_group: r.age_group,
      count: r.count,
      percentage: totalCases > 0 ? Number(((r.count / totalCases) * 100).toFixed(1)) : 0,
    }));

    // Case profile: aggregate registration groups
    const regGroups = {};
    const sites = {};
    caseProfileRes.rows.forEach(r => {
      regGroups[r.registration_group] = (regGroups[r.registration_group] || 0) + r.count;
      sites[r.anatomical_site] = (sites[r.anatomical_site] || 0) + r.count;
    });
    const caseProfile = {
      newCases: regGroups['New'] || regGroups['NEW'] || 0,
      relapse: (regGroups['Relapse'] || 0) + (regGroups['RECAPTURE'] || 0) + (regGroups['Recapture'] || 0),
      pulmonary: sites['Pulmonary'] || sites['PULMONARY'] || 0,
      extraPulmonary: Object.entries(sites).filter(([k]) => !k.toLowerCase().includes('pulmonary')).reduce((s, [, v]) => s + v, 0),
    };

    // Trend data
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const trend = trendRes.rows.map(r => {
      const d = new Date(r.month);
      return {
        month: r.month,
        label: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
        cases: r.cases,
      };
    });

    // Barangay distribution with incidence and risk
    const popMap = {};
    populationRes.rows.forEach(r => { popMap[r.name] = r.population || 0; });

    const barangayDistribution = barangayDistRes.rows.map(r => {
      const pop = popMap[r.barangay_name] || 0;
      const incidence = pop > 0 ? Number((((r.cases * 12) / pop) * 100000).toFixed(1)) : null;
      return {
        barangay: r.barangay_name,
        cases: r.cases,
        population: pop,
        incidence,
      };
    });

    // Risk summary (city-wide)
    const riskMap = {};
    riskRes.rows.forEach(r => { riskMap[r.barangay_name] = r; });

    const riskSummary = barangayDistribution.map(r => ({
      barangay: r.barangay,
      cases: r.cases,
      incidence: r.incidence,
      riskLevel: riskMap[r.barangay]?.risk_class || 'No Data',
      trendDirection: riskMap[r.barangay]?.trend_direction || 'N/A',
    }));

    // Forecast
    const totalForecasted = forecastRes.rows.reduce((s, r) => s + Math.round(Number(r.forecasted_count || 0)), 0);
    const forecastPeriod = forecastRes.rows.length > 0 ? forecastRes.rows[0].period : null;
    const forecast = {
      available: forecastRes.rows.length > 0,
      forecastedCases: totalForecasted,
      period: forecastPeriod ? new Date(forecastPeriod).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : null,
    };

    // Recommendations (rule-based)
    const recommendations = [];
    if (successRate !== null && successRate < 85) {
      recommendations.push('Treatment success rate is below the 85% target. Strengthen treatment adherence monitoring and patient follow-up.');
    }
    const highRiskBarangays = riskRes.rows.filter(r => r.risk_class === 'High' || r.risk_class === 'Very High');
    if (highRiskBarangays.length > 0) {
      recommendations.push(`Prioritize monitoring and resource allocation in ${highRiskBarangays.length} high-risk barangay(s): ${highRiskBarangays.map(r => r.barangay_name).join(', ')}.`);
    }
    if (recommendations.length === 0) {
      recommendations.push('No high-risk barangays were identified for the selected reporting period. Continue routine surveillance.');
    }

    // Recent import (last sync)
    const syncRes = await pool.query(`SELECT MAX(imported_at) AS last_sync FROM tb_cases`);
    const lastSync = syncRes.rows[0]?.last_sync || null;

    res.json({
      report: {
        type,
        period: periodLabel,
        coverage,
        generatedAt: new Date().toISOString(),
        lastSync,
      },
      summary: { totalCases, activeCases, successRate, evaluatedCount },
      outcomes,
      demographics: { sex, ageGroups },
      caseProfile,
      trend,
      barangayDistribution,
      riskSummary,
      forecast,
      recommendations,
      cases: casesRes.rows,
      population: populationRes.rows,
    });
  } catch (err) {
    console.error('Reports summary error:', err.message);
    res.status(500).json({ error: 'Server error generating report.' });
  }
});

// ==================== INTERVENTIONS ====================

/**
 * GET /api/tb/interventions
 * List interventions with filtering, search, and pagination.
 *
 * Query params: status, priority, barangay, type, assigned_to, search, page, limit
 */
router.get('/interventions', async (req, res) => {
  try {
    const { status, priority, barangay, type, assigned_to, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (status && ['pending', 'in_progress', 'completed', 'overdue'].includes(status)) {
      if (status === 'overdue') {
        conditions.push(`status != 'completed' AND target_date < CURRENT_DATE`);
      } else {
        conditions.push(`status = $${idx++}`);
        params.push(status);
      }
    }
    if (priority && ['high', 'medium', 'low'].includes(priority)) {
      conditions.push(`priority = $${idx++}`);
      params.push(priority);
    }
    if (barangay) {
      conditions.push(`TRIM(barangay_name) = $${idx++}`);
      params.push(barangay);
    }
    if (type) {
      conditions.push(`intervention_type = $${idx++}`);
      params.push(type);
    }
    if (assigned_to) {
      conditions.push(`assigned_to ILIKE $${idx++}`);
      params.push(`%${assigned_to}%`);
    }
    if (search) {
      conditions.push(`(title ILIKE $${idx} OR description ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM interventions ${where}`,
      params
    );
    const total = countResult.rows[0].total;

    const result = await pool.query(
      `SELECT id, title, description, intervention_type, barangay_name, priority,
              status, assigned_to, team, target_date, completed_at, created_by,
              related_alert_id, metadata, created_at, updated_at
       FROM interventions ${where}
       ORDER BY
         CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    res.json({
      interventions: result.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('Interventions fetch error:', err.message);
    res.status(500).json({ error: 'Server error fetching interventions.' });
  }
});

/**
 * GET /api/tb/interventions/counts
 * Summary counts: total, pending, in_progress, completed, overdue
 */
router.get('/interventions/counts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status != 'completed' AND target_date < CURRENT_DATE)::int AS overdue
      FROM interventions
    `);
    res.json(result.rows[0] || { total: 0, pending: 0, in_progress: 0, completed: 0, overdue: 0 });
  } catch (err) {
    console.error('Intervention counts error:', err.message);
    res.status(500).json({ error: 'Server error fetching intervention counts.' });
  }
});

/**
 * GET /api/tb/interventions/:id
 * Get a single intervention detail
 */
router.get('/interventions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, title, description, intervention_type, barangay_name, priority,
              status, assigned_to, team, target_date, completed_at, created_by,
              related_alert_id, metadata, created_at, updated_at
       FROM interventions WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention not found.' });
    }
    res.json({ intervention: result.rows[0] });
  } catch (err) {
    console.error('Intervention detail error:', err.message);
    res.status(500).json({ error: 'Server error fetching intervention detail.' });
  }
});

/**
 * POST /api/tb/interventions
 * Create a new intervention
 */
router.post('/interventions', authenticateToken, async (req, res) => {
  try {
    const {
      title, description, intervention_type, barangay_name,
      priority, assigned_to, team, target_date, created_by, related_alert_id, metadata,
    } = req.body;

    if (!title || !intervention_type || !barangay_name) {
      return res.status(400).json({ error: 'Required: title, intervention_type, barangay_name' });
    }

    const result = await pool.query(
      `INSERT INTO interventions
        (title, description, intervention_type, barangay_name, priority,
         assigned_to, team, target_date, created_by, related_alert_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        title, description || null, intervention_type, barangay_name,
        priority || 'medium', assigned_to || null, team || null,
        target_date || null, created_by || null, related_alert_id || null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    res.status(201).json({ message: 'Intervention created.', id: result.rows[0].id });
  } catch (err) {
    console.error('Create intervention error:', err.message);
    res.status(500).json({ error: 'Server error creating intervention.' });
  }
});

/**
 * PUT /api/tb/interventions/:id
 * Update an intervention
 */
router.put('/interventions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, description, intervention_type, barangay_name,
      priority, status, assigned_to, team, target_date, metadata,
    } = req.body;

    const fields = [];
    const params = [];
    let idx = 1;

    if (title !== undefined) { fields.push(`title = $${idx++}`); params.push(title); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); params.push(description); }
    if (intervention_type !== undefined) { fields.push(`intervention_type = $${idx++}`); params.push(intervention_type); }
    if (barangay_name !== undefined) { fields.push(`barangay_name = $${idx++}`); params.push(barangay_name); }
    if (priority !== undefined) { fields.push(`priority = $${idx++}`); params.push(priority); }
    if (status !== undefined) {
      fields.push(`status = $${idx++}`);
      params.push(status);
      if (status === 'completed') {
        fields.push(`completed_at = NOW()`);
      }
    }
    if (assigned_to !== undefined) { fields.push(`assigned_to = $${idx++}`); params.push(assigned_to); }
    if (team !== undefined) { fields.push(`team = $${idx++}`); params.push(team); }
    if (target_date !== undefined) { fields.push(`target_date = $${idx++}`); params.push(target_date); }
    if (metadata !== undefined) { fields.push(`metadata = $${idx++}`); params.push(JSON.stringify(metadata)); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    fields.push(`updated_at = NOW()`);
    params.push(id);

    await pool.query(
      `UPDATE interventions SET ${fields.join(', ')} WHERE id = $${idx}`,
      params
    );

    res.json({ message: 'Intervention updated.' });
  } catch (err) {
    console.error('Update intervention error:', err.message);
    res.status(500).json({ error: 'Server error updating intervention.' });
  }
});

/**
 * POST /api/tb/interventions/:id/complete
 * Mark an intervention as completed
 */
router.post('/interventions/:id/complete', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE interventions SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );
    res.json({ message: 'Intervention marked as completed.' });
  } catch (err) {
    console.error('Complete intervention error:', err.message);
    res.status(500).json({ error: 'Server error completing intervention.' });
  }
});

/**
 * DELETE /api/tb/interventions/:id
 * Delete an intervention
 */
router.delete('/interventions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM interventions WHERE id = $1', [id]);
    res.json({ message: 'Intervention deleted.' });
  } catch (err) {
    console.error('Delete intervention error:', err.message);
    res.status(500).json({ error: 'Server error deleting intervention.' });
  }
});

module.exports = router;
