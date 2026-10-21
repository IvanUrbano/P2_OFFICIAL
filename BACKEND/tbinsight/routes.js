const express = require('express');
const pool = require('../db');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { rebuildAggregations } = require('./aggregateMonthly');
const { seedAll, seedBarangaysGeom, getBarangays, findBarangay } = require('./barangays');
const { runPipelineTracked, getPipelineRunStatus, runHistoricalSnapshots } = require('./pipeline');
const { gisSnapshotPeriodSql } = require('./gisSnapshot');
const { healthCheck: mlHealthCheck, forecast: mlForecast } = require('./mlClient');
const {
  createNotification, getUnreadCount, evaluateAllAlerts,
  evaluateCaseIncreaseAlerts,
} = require('./alertEngine');
const { buildAnalyticsMetrics, buildForecastingMetrics, buildGisMetrics } = require('./insightDataBuilder');
const { generateAnalyticsInsight, generateForecastingInsight, generateGisInsight } = require('./nlgEngine');
const { buildDashboardMetrics, generateDashboardInsight } = require('./dashboardInsight');
const { computeTreatmentSuccessRate } = require('./treatmentSuccessRate');
const {
  APPROVED_OUTCOMES, normalizeDisplayOutcome, normalizeRecordOutcome,
  isApprovedOutcome, getOutcomeFilterValues, foldOutcomeCounts, SUCCESS_OUTCOMES_SQL,
} = require('./outcomeNormalization');
const { computeCaseFatalityRate } = require('./caseFatalityRate');
const { pasigResidentOnly, countedCases } = require('./locationScope');
const { barangayCondition } = require('./barangayFilter');
const { loadAdjacency } = require('./barangayAdjacency');
const { TREATMENT_SUCCESS_TARGET } = require('./targets');
const {
  getPopulation, getPopulationMap, calculateAnnualizedIncidence,
  getAvailablePopulationYears, getPopulationReferences, getPopulationByYear,
  validatePopulationData, savePopulationData, updatePopulationRecord,
  parsePopulationExcel, parsePopulationCsv,
  computeYearIncidence,
  GEOJSON_REFERENCE_YEAR,
} = require('./populationService');
const { runModelEvaluation, getModelEvaluationStatus } = require('./modelEvaluation');

const router = express.Router();

// ==================== AUTHORIZATION ====================
//
// TBInsight holds internal TB surveillance and analytical data, so EVERY
// /api/tb/* route requires an authenticated Staff or Admin user. Frontend
// route protection (ProtectedRoute) guards navigation only — the API is
// directly reachable, so authorization has to be enforced here.
//
// Applied once at the router level rather than per route: a per-route list is
// exactly how the read endpoints (dashboard, analytics, GIS, forecasts,
// alerts, reports, insights, pipeline status, data freshness, cases/export,
// webhook-logs) came to be unauthenticated while the mutating ones were
// protected. A router-level guard cannot be forgotten when a route is added.
//
// This is the BASELINE. Routes that already carry stricter guards keep them —
// `authorizeRoles('admin')` on a route still narrows it to Admin, so no
// Admin-only operation is downgraded to Staff by this line. The duplicated
// `authenticateToken` on those routes is harmless (it re-verifies the same
// token and re-sets req.user).
//
// It reuses the existing middleware in BACKEND/middleware/auth.js — JWT from
// the httpOnly cookie or an Authorization: Bearer header, with CSRF nonce
// enforcement for cookie-authenticated unsafe methods. No second auth system
// is introduced.
//
// Deliberately NOT covered by this router: the Pasig TB-IS webhook receiver
// (mounted separately at /api/webhook, authenticated by HMAC signature rather
// than a user JWT) and the app health check GET /api/health, which must stay
// reachable for platform health probes and exposes no surveillance data.
router.use(authenticateToken, authorizeRoles('admin', 'staff'));

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
 * List facilities actually present in validated cases, including treatment-only facilities.
 */
router.get('/facilities', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT TRIM(screening_facility) AS screening_facility FROM tb_cases
       WHERE screening_facility IS NOT NULL AND TRIM(screening_facility) != ''
       UNION
       SELECT TRIM(treatment_facility) AS screening_facility FROM tb_cases
       WHERE treatment_facility IS NOT NULL AND TRIM(treatment_facility) != ''
       ORDER BY screening_facility`
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
    const [sexRes, bactRes, outcomeRes, validationRes, sourceTypeRes, locationRes, statusRes, periodRes] = await Promise.all([
      pool.query(`SELECT DISTINCT TRIM(sex) as sex FROM tb_cases WHERE sex IS NOT NULL AND TRIM(sex) != '' ORDER BY sex`),
      pool.query(`SELECT DISTINCT TRIM(bacteriological_status) as bacteriological_status FROM tb_cases WHERE bacteriological_status IS NOT NULL AND TRIM(bacteriological_status) != '' ORDER BY bacteriological_status`),
      pool.query(`SELECT DISTINCT treatment_outcome AS outcome_status FROM tb_cases WHERE treatment_outcome IS NOT NULL ORDER BY outcome_status`),
      pool.query(`SELECT DISTINCT TRIM(validation_status) as validation_status FROM tb_cases WHERE validation_status IS NOT NULL AND TRIM(validation_status) != '' ORDER BY validation_status`),
      pool.query(`SELECT DISTINCT TRIM(source_type) as source_type FROM tb_cases WHERE source_type IS NOT NULL AND TRIM(source_type) != '' ORDER BY source_type`),
      pool.query(`SELECT DISTINCT TRIM(location_classification) as location_classification FROM tb_cases WHERE location_classification IS NOT NULL AND TRIM(location_classification) != '' ORDER BY location_classification`),
      pool.query(`SELECT DISTINCT TRIM(case_status) AS case_status FROM tb_cases WHERE case_status IS NOT NULL AND TRIM(case_status) != '' ORDER BY case_status`),
      pool.query(`SELECT DISTINCT EXTRACT(YEAR FROM date_of_diagnosis)::int AS year, EXTRACT(MONTH FROM date_of_diagnosis)::int AS month FROM tb_cases WHERE date_of_diagnosis IS NOT NULL ORDER BY year DESC, month`),
    ]);
    const periods = periodRes.rows;
    res.json({
      sex: sexRes.rows.map(r => r.sex),
      bacteriological_status: bactRes.rows.map(r => r.bacteriological_status),
      outcome_status: outcomeRes.rows
        .map(r => normalizeDisplayOutcome(r.outcome_status))
        .filter(v => v != null)
        .filter((v, i, arr) => arr.indexOf(v) === i)  // dedupe
        .sort((a, b) => APPROVED_OUTCOMES.indexOf(a) - APPROVED_OUTCOMES.indexOf(b)),
      case_status: statusRes.rows.map(r => r.case_status),
      years: [...new Set(periods.map(r => r.year))],
      months: [...new Set(periods.map(r => r.month))].sort((a, b) => a - b),
      months_by_year: Object.fromEntries([...new Set(periods.map(r => r.year))].map(year => [year, periods.filter(r => r.year === year).map(r => r.month).sort((a, b) => a - b)])),
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

/**
 * POST /api/tb/barangays/seed-geom
 * Seed barangays_geom with PostGIS polygons from GeoJSON (admin only)
 * Required for GIS map rendering
 */
router.post('/barangays/seed-geom', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const result = await seedBarangaysGeom();
    res.json({ message: 'Barangay geometries seeded successfully.', result });
  } catch (err) {
    console.error('Geom seed error:', err.message);
    res.status(500).json({ error: 'Server error seeding barangay geometries.' });
  }
});

// ==================== IMPORT ====================
// Case data enters TBInsight only through the signed Pasig Clone webhook
// (POST /api/webhook/pasig-clone). Upload, cleaning and validation happen in Pasig Clone.

// ==================== CASE RECORDS ====================

// Largest page /api/tb/cases serves (TB Records offers 10/20/50/100 per page). Pages that
// need every case use /api/tb/cases/analytics-dataset instead.
const MAX_CASES_PAGE = 100;

/**
 * Facility-scoped access for STAFF users: they see cases where their facility is the
 * current responsible facility, OR where current_responsible_facility_id is NULL
 * (historical/unresolved). ADMIN sees all cases city-wide.
 * Shared by every endpoint that lists cases so the rule cannot drift between them.
 * @returns {{ sql: string, params: any[] } | null}
 */
function staffCaseScope(user, paramIdx) {
  if (user.role === 'staff' && user.facility_id) {
    return {
      sql: `(c.current_responsible_facility_id = $${paramIdx} OR c.current_responsible_facility_id IS NULL)`,
      params: [user.facility_id],
    };
  }
  return null;
}

/**
 * GET /api/tb/cases
 * List individual TB case records with filtering, search, and pagination
 * Query params: page, limit, search, barangay, year, month, outcome, facility,
 *               sex, bacteriological_status, validation_status, source_type, location_classification
 */
router.get('/cases', async (req, res) => {
  try {
    const allowedSortFields = ['id', 'source_case_id', 'barangay_name', 'age', 'date_of_diagnosis', 'screening_facility', 'source_type'];
    const {
      page = 1,
      limit = 10,
      search = '',
      barangay = '',
      year = '',
      month = '',
      outcome = '',
      status = '',
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
    const safeLimit = Math.min(MAX_CASES_PAGE, Math.max(1, parseInt(limit) || 20));
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
        `c.case_no ILIKE $${paramIdx}`,
        `c.source_case_id ILIKE $${paramIdx}`,
        `TRIM(c.source_type) ILIKE $${paramIdx}`,
        `TRIM(c.validation_status) ILIKE $${paramIdx}`,
        `TRIM(c.sex) ILIKE $${paramIdx}`,
        `TRIM(c.bacteriological_status) ILIKE $${paramIdx}`,
        `TRIM(c.outcome_status) ILIKE $${paramIdx}`,
        `TRIM(c.case_status) ILIKE $${paramIdx}`,
        `TRIM(c.treatment_outcome) ILIKE $${paramIdx}`,
        `TRIM(c.source_of_patient) ILIKE $${paramIdx}`,
        `TRIM(c.anatomical_site) ILIKE $${paramIdx}`,
        `TRIM(c.registration_group) ILIKE $${paramIdx}`,
        `TRIM(c.location_classification) ILIKE $${paramIdx}`,
        `TRIM(c.residence_barangay_name) ILIKE $${paramIdx}`,
        `TRIM(c.residence_city) ILIKE $${paramIdx}`,
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
      conditions.push(`c.treatment_outcome = ANY($${paramIdx})`);
      params.push(getOutcomeFilterValues(outcome));
      paramIdx++;
    }

    if (status) {
      conditions.push(`c.case_status = $${paramIdx}`);
      params.push(status.trim().toUpperCase());
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

    const scope = staffCaseScope(req.user, paramIdx);
    if (scope) {
      conditions.push(scope.sql);
      params.push(...scope.params);
      paramIdx += scope.params.length;
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
        c.source_outcome_status,
        c.case_status,
        c.treatment_outcome,
        c.date_of_outcome,
        c.imported_at,
        c.validation_status,
        c.source_type,
        c.location_classification,
        c.residence_barangay_name,
        c.residence_city,
        c.case_no,
        c.source_case_id,
        c.current_responsible_facility_id
      FROM tb_cases c
      ${whereClause}
      ORDER BY c.${safeSortField} ${safeSortDir}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, safeLimit, offset]
    );

    // Keep the source value for audit while exposing status and outcome separately.
    res.json({
      cases: dataResult.rows.map((r) => ({
        ...r,
        outcome_status: r.treatment_outcome,
        outcome_status_raw: r.source_outcome_status ?? r.outcome_status,
        outcome_status_approved: isApprovedOutcome(r.outcome_status),
      })),
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
 * GET /api/tb/cases/analytics-dataset
 * Every case the user may see, with ONLY the fields Analytics and Forecasting compute
 * from — no identifiers (case_no, patient_no, batch_id). Those pages
 * filter and chart client-side, so they need all rows; they used to fetch them via
 * /api/tb/cases?limit=<total>, which shipped all 25 columns (~7 MB at 8.5k cases).
 * Same access scope, outcome labels and order as /api/tb/cases.
 */
router.get('/cases/analytics-dataset', async (req, res) => {
  try {
    const conditions = [];
    const params = [];
    const scope = staffCaseScope(req.user, 1);
    if (scope) {
      conditions.push(scope.sql);
      params.push(...scope.params);
    }
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await pool.query(
      `SELECT
        c.barangay_name,
        c.age,
        c.sex,
        c.date_of_diagnosis,
        c.screening_facility,
        c.treatment_facility,
        c.bacteriological_status,
        c.outcome_status,
        c.source_outcome_status,
        c.imported_at,
        c.case_status,
        c.treatment_outcome,
        c.location_classification,
        c.residence_barangay_name,
        c.residence_city
      FROM tb_cases c
      ${whereClause}
      ORDER BY c.date_of_diagnosis DESC`,
      params
    );

    res.json({
      cases: rows.map((r) => ({ ...r, outcome_status_raw: r.source_outcome_status ?? r.outcome_status, outcome_status: r.treatment_outcome })),
      total: rows.length,
    });
  } catch (err) {
    console.error('Analytics dataset error:', err.message);
    res.status(500).json({ error: 'Server error fetching the analytics dataset.' });
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
      status = '',
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
        `c.case_no ILIKE $${paramIdx}`,
        `c.source_case_id ILIKE $${paramIdx}`,
        `TRIM(c.source_type) ILIKE $${paramIdx}`,
        `TRIM(c.validation_status) ILIKE $${paramIdx}`,
        `TRIM(c.sex) ILIKE $${paramIdx}`,
        `TRIM(c.bacteriological_status) ILIKE $${paramIdx}`,
        `TRIM(c.outcome_status) ILIKE $${paramIdx}`,
        `TRIM(c.source_of_patient) ILIKE $${paramIdx}`,
        `TRIM(c.anatomical_site) ILIKE $${paramIdx}`,
        `TRIM(c.registration_group) ILIKE $${paramIdx}`,
        `TRIM(c.location_classification) ILIKE $${paramIdx}`,
        `TRIM(c.residence_barangay_name) ILIKE $${paramIdx}`,
        `TRIM(c.residence_city) ILIKE $${paramIdx}`,
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
    if (outcome) { conditions.push(`c.treatment_outcome = ANY($${paramIdx})`); params.push(getOutcomeFilterValues(outcome)); paramIdx++; }
    if (status) { conditions.push(`c.case_status = $${paramIdx}`); params.push(status.trim().toUpperCase()); paramIdx++; }
    if (facility) { conditions.push(`(TRIM(c.screening_facility) = $${paramIdx} OR TRIM(c.treatment_facility) = $${paramIdx})`); params.push(facility.trim()); paramIdx++; }
    if (sex) { conditions.push(`TRIM(c.sex) ILIKE $${paramIdx}`); params.push(sex.trim()); paramIdx++; }
    if (bacteriological_status) { conditions.push(`TRIM(c.bacteriological_status) ILIKE $${paramIdx}`); params.push(bacteriological_status.trim()); paramIdx++; }
    if (validation_status) { conditions.push(`TRIM(c.validation_status) = $${paramIdx}`); params.push(validation_status.trim()); paramIdx++; }
    if (source_type) { conditions.push(`TRIM(c.source_type) = $${paramIdx}`); params.push(source_type.trim()); paramIdx++; }
    if (location_classification) { conditions.push(`TRIM(c.location_classification) = $${paramIdx}`); params.push(location_classification.trim()); paramIdx++; }

    // Facility-scoped access for STAFF users
    if (req.user.role === 'staff' && req.user.facility_id) {
      conditions.push(`(c.current_responsible_facility_id = $${paramIdx} OR c.current_responsible_facility_id IS NULL)`);
      params.push(req.user.facility_id);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await pool.query(
      `SELECT
        c.id,
        c.source_case_id,
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
        c.source_outcome_status,
        c.case_status,
        c.treatment_outcome,
        c.date_of_outcome,
        c.validation_status,
        c.location_classification,
        c.residence_barangay_name,
        c.residence_city
      FROM tb_cases c
      ${whereClause}
      ORDER BY c.date_of_diagnosis DESC
      LIMIT 10000`,
      params
    );

    const headers = ['Case ID', 'Barangay', 'Age', 'Sex', 'Diagnosis Date', 'Screening Date', 'Notification Date', 'Screening Facility', 'Treatment Facility', 'Source', 'Source of Patient', 'Anatomical Site', 'Registration Group', 'Bacteriologic Status', 'Treatment Start Date', 'Case Status', 'Treatment Outcome', 'Source Outcome Value', 'Outcome Date', 'Validation', 'Location', 'Residence Barangay', 'Residence City'];
    const csvRows = [headers.join(',')];

    for (const row of result.rows) {
      const values = [
        row.source_case_id || 'No Case ID',
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
        row.case_status || '',
        row.treatment_outcome || '',
        `"${(row.source_outcome_status ?? row.outcome_status ?? '').replace(/"/g, '""')}"`,
        row.date_of_outcome ? new Date(row.date_of_outcome).toISOString().split('T')[0] : '',
        row.validation_status || '',
        row.location_classification || '',
        `"${(row.residence_barangay_name || '').replace(/"/g, '""')}"`,
        `"${(row.residence_city || '').replace(/"/g, '""')}"`,
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

/**
 * GET /api/tb/cases/:caseKey/history
 * Case History for a single case: the append-only record of what changed on it
 * and who changed it (written by tbinsight/caseHistory.js on every same-case
 * outcome update).
 *
 * `caseKey` is the stable Case ID (tb_cases.case_no) — the same key the webhook
 * matches a re-sent record on. A purely numeric key falls back to the internal
 * id, so a row that was imported without a Case ID is still inspectable. It is
 * NEVER matched by patient number: the same person can have a later, new
 * episode, which is a different Case ID and therefore a different case with its
 * own history. Longitudinal updates to one case never appear as a second case.
 *
 * A case outside a staff user's facility answers 404 rather than 403 on purpose:
 * the frontend treats any 403 as a dead session and redirects to /login.
 */
router.get('/cases/:caseKey/history', async (req, res) => {
  try {
    const caseKey = String(req.params.caseKey || '').trim();
    if (!caseKey) return res.status(404).json({ error: 'Case not found.' });

    const numericId = /^\d+$/.test(caseKey) ? Number(caseKey) : null;
    const params = [numericId == null ? caseKey : null, numericId];
    const conditions = [
      `(($1::text IS NOT NULL AND c.case_no = $1) OR ($2::bigint IS NOT NULL AND c.id = $2))`,
    ];
    let paramIdx = 3;

    const scope = staffCaseScope(req.user, paramIdx);
    if (scope) {
      conditions.push(scope.sql);
      params.push(...scope.params);
      paramIdx += scope.params.length;
    }

    const caseResult = await pool.query(
      `SELECT c.id, c.case_no, c.patient_no, c.source_case_id, c.batch_id,
              c.imported_at, c.updated_at, c.case_status, c.treatment_outcome,
              c.outcome_status, c.source_outcome_status
         FROM tb_cases c
        WHERE ${conditions.join(' AND ')}
        LIMIT 1`,
      params
    );
    const record = caseResult.rows[0];
    if (!record) return res.status(404).json({ error: 'Case not found.' });

    const historyResult = await pool.query(
      `SELECT id, change_type, changed_fields, source, changed_by_user_id,
              changed_by_label, changed_at, notes, batch_id
         FROM case_history
        WHERE ($1::text IS NOT NULL AND case_no = $1)
           OR ($1::text IS NULL AND tb_case_id = $2::bigint)
        ORDER BY changed_at DESC, id DESC
        LIMIT 200`,
      [record.case_no, record.id]
    );

    // Actor: the label the source system reported for a synced change, else the
    // username of a TBInsight user (for a future manual/review edit).
    const userIds = [...new Set(historyResult.rows.map(h => h.changed_by_user_id).filter(v => v != null))];
    const actorNames = {};
    if (userIds.length > 0) {
      const users = await pool.query(
        'SELECT id, username FROM users WHERE id = ANY($1::int[])',
        [userIds]
      );
      for (const user of users.rows) actorNames[user.id] = user.username;
    }

    res.json({
      case: {
        id: record.id,
        case_no: record.case_no,
        source_case_id: record.source_case_id,
        patient_no: record.patient_no,
        case_status: record.case_status,
        treatment_outcome: record.treatment_outcome,
        outcome_status: record.treatment_outcome,
        outcome_status_raw: record.source_outcome_status ?? record.outcome_status,
        imported_at: record.imported_at,
        updated_at: record.updated_at,
      },
      history: historyResult.rows.map(h => ({
        id: Number(h.id),
        change_type: h.change_type,
        changed_fields: h.changed_fields,
        source: h.source,
        actor: h.changed_by_label || actorNames[h.changed_by_user_id] || null,
        changed_at: h.changed_at,
        batch_id: h.batch_id,
        notes: h.notes,
      })),
    });
  } catch (err) {
    console.error('Case history error:', err.message);
    res.status(500).json({ error: 'Server error fetching case history.' });
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
      status = '',
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
    const brgy = barangayCondition('barangay_name', `$${paramIdx}`, barangay);
    if (brgy) {
      conditions.push(brgy.sql);
      params.push(brgy.value);
      paramIdx++;
    }
    if (outcome) {
      conditions.push(`treatment_outcome = ANY($${paramIdx})`);
      params.push(getOutcomeFilterValues(outcome));
      paramIdx++;
    }
    if (status) {
      conditions.push(`case_status = $${paramIdx}`);
      params.push(status.trim().toUpperCase());
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

    // City-wide KPI scope. Skipped only when the caller explicitly filters on
    // location_classification, so a deliberate lookup of legacy rows still works.
    if (!location_classification) {
      conditions.push(countedCases());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(`
      SELECT
        COUNT(*)::INTEGER as total_cases,
        COUNT(DISTINCT barangay_name)::INTEGER as barangays_with_cases,
        COUNT(DISTINCT DATE_TRUNC('month', date_of_diagnosis))::INTEGER as months_covered,
        MIN(date_of_diagnosis) as earliest_date,
        MAX(date_of_diagnosis) as latest_date,
        SUM(CASE WHEN case_status = 'ON TREATMENT' THEN 1 ELSE 0 END)::INTEGER as on_treatment_count,
        SUM(CASE WHEN treatment_outcome = 'CURED' THEN 1 ELSE 0 END)::INTEGER as cured_count,
        SUM(CASE WHEN treatment_outcome = 'TREATMENT COMPLETED' THEN 1 ELSE 0 END)::INTEGER as treatment_completed_count,
        SUM(CASE WHEN treatment_outcome = 'DIED' THEN 1 ELSE 0 END)::INTEGER as died_count,
        SUM(CASE WHEN treatment_outcome = 'LOST TO FOLLOW-UP' THEN 1 ELSE 0 END)::INTEGER as ltfu_count,
        -- remaining outcomes + the other case status, so the TB Records outcome chart
        -- and status counts cover every category
        SUM(CASE WHEN treatment_outcome = 'TREATMENT FAILED' THEN 1 ELSE 0 END)::INTEGER as treatment_failed_count,
        SUM(CASE WHEN treatment_outcome = 'NOT EVALUATED' THEN 1 ELSE 0 END)::INTEGER as not_evaluated_count,
        SUM(CASE WHEN treatment_outcome = 'EXCLUDED' THEN 1 ELSE 0 END)::INTEGER as excluded_count,
        SUM(CASE WHEN case_status = 'DIAGNOSED' THEN 1 ELSE 0 END)::INTEGER as diagnosed_count,
        -- diagnosed but still without a treatment start 30+ days later: records to follow up
        COUNT(*) FILTER (WHERE case_status = 'DIAGNOSED'
                           AND date_of_diagnosis < CURRENT_DATE - INTERVAL '30 days')::INTEGER as diagnosed_overdue_count,
        SUM(CASE WHEN treatment_outcome IN (${SUCCESS_OUTCOMES_SQL}) THEN 1 ELSE 0 END)::INTEGER as successful_count,
        COUNT(*) FILTER (WHERE treatment_outcome IN ('CURED','TREATMENT COMPLETED','TREATMENT FAILED','LOST TO FOLLOW-UP','DIED'))::INTEGER as total_outcomes,
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
 * Returns: totalCases, onTreatmentCount, successRate,
 *          forecastTotal, lastSync, plus trend badges.
 */
router.get('/dashboard/metrics', async (req, res) => {
  try {
    // Core query: Pasig City data from tb_cases
    const result = await pool.query(`
      SELECT
        COUNT(*)::INTEGER AS total_cases,
        SUM(CASE WHEN case_status = 'ON TREATMENT' THEN 1 ELSE 0 END)::INTEGER AS on_treatment_count,
        SUM(CASE WHEN treatment_outcome = 'CURED' THEN 1 ELSE 0 END)::INTEGER AS cured_count,
        SUM(CASE WHEN treatment_outcome IN ('CURED', 'TREATMENT COMPLETED') THEN 1 ELSE 0 END)::INTEGER AS successful_count,
        COUNT(*) FILTER (WHERE treatment_outcome IN ('CURED','TREATMENT COMPLETED','TREATMENT FAILED','LOST TO FOLLOW-UP','DIED'))::INTEGER AS total_outcomes,
        SUM(CASE WHEN date_of_diagnosis >= DATE_TRUNC('month', CURRENT_DATE) THEN 1 ELSE 0 END)::INTEGER AS current_month_cases,
        SUM(CASE WHEN date_of_diagnosis >= (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')
                  AND date_of_diagnosis < DATE_TRUNC('month', CURRENT_DATE) THEN 1 ELSE 0 END)::INTEGER AS prev_month_cases
      FROM tb_cases
      WHERE ${countedCases()}
    `);
    const row = result.rows[0];

    const totalCases = row.total_cases || 0;
    const onTreatmentCount = row.on_treatment_count || 0;
    const curedCount = row.cured_count || 0;

    // TSR: single shared calculation (see treatmentSuccessRate.js) — defaults
    // to the current-year cohort (Y-1) when unfiltered, matching this
    // route's prior always-current-year behavior.
    const { successRate } = await computeTreatmentSuccessRate(pool, {});

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
    let filters = `WHERE date_of_diagnosis IS NOT NULL AND ${pasigResidentOnly()}`;
    const params = [];
    if (year) {
      filters += ` AND EXTRACT(YEAR FROM date_of_diagnosis) = $1`;
      params.push(parseInt(year));
    }
    const result = await pool.query(`
      SELECT barangay_name,
             TO_CHAR(DATE_TRUNC('month', date_of_diagnosis), 'YYYY-MM-DD') AS month,
             COUNT(*)::INTEGER AS case_count
      FROM tb_cases
      ${filters}
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
 * Query: ?year=YYYY (optional) — scopes case_status_counts only.
 */
router.get('/dashboard/barangay/:name', async (req, res) => {
  try {
    const { name } = req.params;

    // Optional ?year=YYYY scopes ONLY case_status_counts (the "On Treatment"
    // figure) by diagnosis year, matching the Analytics KPI definition:
    // cases diagnosed in year Y that are currently on treatment. Monthly,
    // demographics and outcomes stay all-time — they are historical
    // breakdowns, not period metrics, and are rendered as such.
    const yearInt = req.query.year ? parseInt(req.query.year, 10) : null;
    const statusYear = yearInt && !isNaN(yearInt) && yearInt >= 2000 && yearInt <= 2099
      ? yearInt
      : null;

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
    const statusCounts = await pool.query(
      `SELECT case_status, COUNT(*)::INTEGER AS total FROM tb_cases
       WHERE LOWER(barangay_name) = LOWER($1) AND case_status IS NOT NULL
         ${statusYear !== null ? 'AND EXTRACT(YEAR FROM date_of_diagnosis) = $2' : ''}
       GROUP BY case_status`,
      statusYear !== null ? [name, statusYear] : [name]
    );
    let outcomesRows = [];
    try {
      const outcomes = await pool.query(
        `SELECT treatment_outcome AS outcome_status,
                COUNT(*)::INTEGER AS total
         FROM tb_cases
         WHERE LOWER(barangay_name) = LOWER($1) AND treatment_outcome IS NOT NULL
         GROUP BY treatment_outcome
         ORDER BY total DESC`,
        [name]
      );
      outcomesRows = outcomes.rows.map((r) => ({
        ...r,
        outcome_status: normalizeRecordOutcome(r.outcome_status),
        outcome_status_raw: r.outcome_status,
        outcome_status_approved: isApprovedOutcome(r.outcome_status),
      }));
    } catch (e) {
      console.error('Outcomes query error:', e.message);
    }

    res.json({
      barangay,
      monthly: monthlyRows,
      demographics: demographicsRows,
      case_status_counts: statusCounts.rows,
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
        r.incidence_per_100k::NUMERIC AS incidence_per_100k,
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
    // Barangay-keyed breakdown: Non-Pasig residents carry a NULL barangay_name and
    // would otherwise surface as one unnamed bar. Their counts belong to the
    // facility/city view, not to a Pasig barangay.
    conditions.push(pasigResidentOnly());
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
    conditions.push(pasigResidentOnly());
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    // Normalize case/whitespace before grouping — matches the UPPER(TRIM(...))
    // pattern used elsewhere (treatmentSuccessRate.js).
    // Without this, a stray casing difference (e.g. "Cured" vs "CURED") would
    // silently split one real outcome into two separate rows/pie slices.
    const result = await pool.query(`
      SELECT barangay_name,
             treatment_outcome AS outcome_status,
             COUNT(*)::INTEGER as total
      FROM tb_cases
      ${where} AND treatment_outcome IS NOT NULL
      GROUP BY barangay_name, treatment_outcome
      ORDER BY barangay_name, total DESC
    `, params);
    // Emit the source-aligned label per row (legacy 'TREATMENT FAILED' becomes
    // 'FAILED') and flag anything outside the 9 verified categories, so every
    // consumer gets the same terminology from one place instead of each page
    // re-implementing the alias mapping. Barangay grouping is preserved.
    const outcomes = result.rows.map((r) => ({
      ...r,
      outcome_status: normalizeRecordOutcome(r.outcome_status),
      outcome_status_raw: r.outcome_status,
      outcome_status_approved: isApprovedOutcome(r.outcome_status),
    }));
    res.json({ outcomes });
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

    // The five lookups below are independent, so they are started together and awaited
    // once (each is a ~0.2 s round trip to the remote database).
    // Fetch barangays with geometry from PostGIS
    const geoQ = pool.query(`
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

    // Resolve GIS Year to the snapshot trained on that data year. Its saved
    // prediction period can fall in the following calendar year.
    //
    // A specific year selects the snapshot whose data_year matches it.
    // The current assessment remains selectable by assessment_year when
    // there is no snapshot trained on that year's data yet.
    //
    // No year filter ("All Years") shows the latest overall snapshot.
    // incidence_per_100k is intentionally NOT coalesced to 0 — null means
    // "no matching-year population reference", rendered as N/A.
    const riskSelect = `barangay_name, COALESCE(risk_score, 0) as risk_score,
         COALESCE(risk_class, 'No Data') as risk_class,
         incidence_per_100k,
         COALESCE(trend_direction, 'Stable') as trend_direction,
         COALESCE(norm_incidence, 0) as norm_incidence,
         COALESCE(norm_trend, 0) as norm_trend,
         COALESCE(norm_neighbor_risk, 0) as norm_neighbor_risk,
         COALESCE(norm_forecast_error, 0) as norm_forecast_error,
         model_type, model_version, classification_confidence,
         prob_low, prob_medium, prob_high, features, period::text AS period,
         (SELECT COALESCE((mm.metrics->>'data_year')::integer,
                          EXTRACT(YEAR FROM (mm.metrics->>'dataEnd')::date)::integer)
          FROM model_metadata mm
          WHERE (mm.config->>'period')::date = barangay_risk_scores.period
          ORDER BY mm.trained_at DESC LIMIT 1) AS snapshot_data_year`;
    const riskQ = isValidYear
      ? pool.query(
          `SELECT ${riskSelect} FROM barangay_risk_scores
           WHERE period = ${gisSnapshotPeriodSql}`,
          [yearInt]
        )
      : pool.query(
          `SELECT ${riskSelect} FROM barangay_risk_scores WHERE period = (SELECT MAX(period) FROM barangay_risk_scores)`
        );

    // Effective incidence year comes from the explicit ?year filter.
    // With no year selected ("All Years") there is no single year for cases/population:
    // incidence stays null
    // (rendered N/A) rather than dividing lifetime totals by one year's
    // population. The latest snapshot is still used below for risk class /
    // confidence, but clearly labeled as the latest assessment in the UI.
    const incidenceYear = isValidYear ? yearInt : null;

    // Forecasts use the selected snapshot's stored prediction period:
    // a historical snapshot deliberately skips ARIMA (see
    // pipeline.js:runHistoricalSnapshots), so a past year genuinely has no
    // forecast. Previously this
    // always showed the latest (e.g. 2026) forecast regardless of the
    // selected year, which misattributed today's forecast to a historical
    // view.
    // forecasted_count is NOT coalesced to 0: a historical snapshot skips ARIMA
    // entirely, so a past year has no forecast at all, and 0 would read as "the
    // model predicted zero cases" — a claim never made. Null renders as N/A.
    const forecastSelect = `barangay_name, forecasted_count,
             confidence_lower, confidence_upper`;
    const forecastQ = isValidYear
      ? pool.query(
          `SELECT ${forecastSelect} FROM model_predictions
           WHERE period = ${gisSnapshotPeriodSql}`,
          [yearInt]
        )
      : pool.query(
          `SELECT ${forecastSelect} FROM model_predictions
           WHERE period = (SELECT MAX(period) FROM model_predictions)`
        );

    // Case counts: a selected year filters cases to THAT year. With no
    // explicit year ("All Years") totals are LIFETIME — and because
    // incidenceYear is also null in that mode, population and incidence
    // both stay null: multi-year case totals are never divided by a
    // single-year population (no fabricated cross-period incidence).
    const effectiveCaseYear = isValidYear ? yearInt : null;
    const caseQuery = effectiveCaseYear !== null
      ? `SELECT barangay_name, COUNT(*)::INTEGER as total_cases
         FROM tb_cases
         WHERE date_of_diagnosis IS NOT NULL
           AND EXTRACT(YEAR FROM date_of_diagnosis) = $1
           AND ${pasigResidentOnly()}
         GROUP BY barangay_name`
      : `SELECT barangay_name, COUNT(*)::INTEGER as total_cases
         FROM tb_cases
         WHERE date_of_diagnosis IS NOT NULL
           AND ${pasigResidentOnly()}
         GROUP BY barangay_name`;
    const caseQ = pool.query(
      caseQuery, effectiveCaseYear !== null ? [effectiveCaseYear] : []
    );

    // Year-specific population for incidence — STRICT year matching
    // (incidenceYear computed above). When the reference year (2025) is
    // selected, population comes from the GeoJSON barangays_geom table. For
    // any other year, an EXACT barangay_population row for that year is
    // required; if no exact-year row exists, population stays null and
    // incidence renders N/A. A population from a different year is never
    // substituted, because that would misrepresent incidence for the
    // selected year.
    const popQ = incidenceYear !== null && incidenceYear !== GEOJSON_REFERENCE_YEAR
      ? pool.query(
          `SELECT barangay_name, population FROM barangay_population
           WHERE reference_year = $1 AND status = 'ACTIVE'`,
          [incidenceYear]
        )
      : Promise.resolve(null);

    const [geoResult, riskResult, forecastResult, caseResult, popResult] =
      await Promise.all([geoQ, riskQ, forecastQ, caseQ, popQ]);

    // Real border-sharing neighbours (barangayAdjacency.js: ST_DWithin 50 m).
    // Awaits AFTER the main queries on purpose — it is an optional enrichment,
    // it swallows its own errors (returns null), and keeping it last leaves
    // the call order of the queries above unchanged. Null means "no adjacency
    // map available": every feature then carries neighbours: null and the UI
    // hides the Neighboring Barangay Context block rather than falling back to
    // "every other barangay", which would be a fabricated neighbour list.
    const adjacency = await loadAdjacency();

    const riskAssessmentPeriod = riskResult.rows[0]?.period || null;
    const assessmentYear = riskAssessmentPeriod ? Number(String(riskAssessmentPeriod).slice(0, 4)) : null;
    const periodMonth = riskAssessmentPeriod ? Number(String(riskAssessmentPeriod).slice(5, 7)) : null;
    const dataYear = riskResult.rows[0]?.snapshot_data_year != null
      ? Number(riskResult.rows[0].snapshot_data_year)
      : assessmentYear == null ? null : (periodMonth === 1 ? assessmentYear - 1 : assessmentYear);
    // Distinguishes "All Years showing the latest snapshot" from "this
    // specific year has no snapshot at all yet" for the frontend's label.
    const requestedYearHasSnapshot = isValidYear ? riskResult.rows.length > 0 : null;

    let yearPopMap = {};
    if (incidenceYear !== null) {
      if (incidenceYear === GEOJSON_REFERENCE_YEAR) {
        for (const row of geoResult.rows) yearPopMap[row.name] = row.population;
      } else {
        for (const row of popResult.rows) yearPopMap[row.barangay_name] = row.population;
      }
    }

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
          // Year-matched population (same rule as incidence): reference
          // (GeoJSON) population only for the reference year, exact-year
          // rows otherwise, null when the effective year has no population
          // record — never another year's figure. With no year context at
          // all (no filter and no risk snapshot) the GeoJSON reference
          // population is shown as the geography attribute it is, with
          // incidence null regardless.
          population: incidenceYear !== null
            ? (yearPopMap[row.name] ?? null)
            : row.population,
          centroid: [row.centroid_lon, row.centroid_lat],
          risk_score: risk.risk_score || 0,
          risk_class: risk.risk_class || 'No Data',
          // Authoritative year-specific GIS incidence: cases in the selected
          // (or risk-assessment) year over the STRICTLY year-matched
          // population × 100,000. Zero cases with a valid population yields
          // 0 (a real lowest value); a missing exact-year population yields
          // null → rendered as N/A. Never substitutes another year's
          // population. (The pipeline-stored annualized-month value is kept
          // separately below as legacy_pipeline_incidence.)
          incidence_per_100k: computeYearIncidence(
            cases.total_cases || 0, yearPopMap[row.name]
          ),
          trend_direction: risk.trend_direction || 'Stable',
          // Null (not 0) when this year has no forecast — see forecastSelect.
          forecasted_count: forecast.forecasted_count ?? null,
          confidence_lower: forecast.confidence_lower ?? null,
          confidence_upper: forecast.confidence_upper ?? null,
          total_cases: cases.total_cases || 0,
          norm_incidence: risk.norm_incidence || 0,
          norm_trend: risk.norm_trend || 0,
          norm_neighbor_risk: risk.norm_neighbor_risk || 0,
          norm_forecast_error: risk.norm_forecast_error || 0,
          // Legacy weighted-score analytical fields end here (risk_score,
          // norm_*) — kept for research/audit use, but risk_class above is
          // the sole authoritative classification (from model_type below).
          model_type: risk.model_type || null,
          model_version: risk.model_version || null,
          // Real confidence only when model_type is 'random_forest' — the
          // rule-based fallback never populates these (see pipeline.js).
          classification_confidence: risk.model_type === 'random_forest' ? risk.classification_confidence ?? null : null,
          prob_low: risk.model_type === 'random_forest' ? risk.prob_low ?? null : null,
          prob_medium: risk.model_type === 'random_forest' ? risk.prob_medium ?? null : null,
          prob_high: risk.model_type === 'random_forest' ? risk.prob_high ?? null : null,
          // The actual RF input values used for this classification —
          // "indicators used," never presented as a causal explanation.
          rf_features: risk.features ?? null,
          // Real border-sharing neighbours by name (sorted in SQL), or null
          // when no adjacency map exists. The client resolves each name to
          // its own risk_class from THIS same payload — neighbour names only,
          // never a copied or re-derived classification. This is context for
          // the neighbour_risk RF input; it says nothing about transmission.
          neighbours: adjacency?.[row.name] ?? null,
          // LEGACY pipeline value: annualized latest-calendar-month
          // calculation ((latest month × 12) / population × 100k). NOT the
          // authoritative year-specific incidence — see incidence_per_100k
          // above. Kept only for research/audit traceability. Backlog: audit
          // / rename / deprecate this field so it cannot be accidentally
          // reused later as annual incidence.
          legacy_pipeline_incidence: risk.incidence_per_100k ?? null,
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
    // The prediction period is the saved assessment. Training data year and selected
      // case/incidence year are separate values in this metadata.
      meta: {
        risk_assessment_period: riskAssessmentPeriod,
        assessment_period: riskAssessmentPeriod,
        prediction_period: riskAssessmentPeriod,
        assessment_year: assessmentYear,
        data_year: dataYear,
        requested_year: isValidYear ? yearInt : null,
        requested_year_has_snapshot: requestedYearHasSnapshot,
        // Year that cases/population/incidence are locked to — null in
        // "All Years" mode (no year filter), where incidence is N/A by
        // design rather than a cross-period figure.
        incidence_year: incidenceYear,
      },
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
 * Returns years with validated Pasig barangay cases or saved RF assessments.
 * A model assessment is selectable even before case data arrives for its year.
 */
router.get('/gis/years', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT year FROM (
        SELECT DISTINCT EXTRACT(YEAR FROM date_of_diagnosis)::INTEGER AS year
        FROM tb_cases
        WHERE date_of_diagnosis IS NOT NULL AND ${pasigResidentOnly()}
        UNION
        SELECT DISTINCT EXTRACT(YEAR FROM period)::INTEGER AS year
        FROM barangay_risk_scores
      ) available_years
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
    // Year selects matching case/population data and its RF snapshot by
    // data_year. If no data-year snapshot exists, the current assessment
    // remains accessible by assessment_year. Without a year, use the latest
    // risk assessment and report its data/assessment years separately.
    const requestedYear = req.query.year ? parseInt(req.query.year, 10) : null;
    const validRequestedYear = requestedYear && !isNaN(requestedYear) &&
      requestedYear >= 2000 && requestedYear <= 2099;

    // Derive the assessment year when no valid year was requested. A
    // snapshot stored at period 2026-01-01 is the 2026 assessment,
    // trained on data through 2025. The period's year is the assessment year.
    const periodYearResult = await pool.query(
      `SELECT EXTRACT(YEAR FROM MAX(period))::INTEGER AS y FROM barangay_risk_scores`
    );
    const latestPeriodYear = periodYearResult.rows[0]?.y;
    let effectiveYear;
    if (validRequestedYear) {
      effectiveYear = requestedYear;
    } else if (latestPeriodYear) {
      effectiveYear = latestPeriodYear;
    } else {
      effectiveYear = new Date().getFullYear();
    }

    const isRefYear = effectiveYear === GEOJSON_REFERENCE_YEAR;

    // Population: reference year (2025) uses the GeoJSON barangays table;
    // any other year requires an EXACT barangay_population row for that year
    // (never substitute another year's population). The LEFT JOIN keeps all
    // barangays while allowing a null exact-year population → incidence N/A.
    const result = await pool.query(
      `SELECT
        b.name,
        b.centroid_lon,
        b.centroid_lat,
        ${isRefYear ? 'b.population' : 'bp.population'} AS population,
        COALESCE(brs.risk_score, 0) as risk_score,
        COALESCE(brs.risk_class, 'No Data') as risk_class,
        brs.incidence_per_100k AS legacy_pipeline_incidence,
        COALESCE(brs.trend_direction, 'Stable') as trend_direction,
        COALESCE(brs.norm_incidence, 0) as norm_incidence,
        COALESCE(brs.norm_trend, 0) as norm_trend,
        COALESCE(brs.norm_neighbor_risk, 0) as norm_neighbor_risk,
        COALESCE(brs.norm_forecast_error, 0) as norm_forecast_error,
        brs.period::text AS period,
        (SELECT COALESCE((mm.metrics->>'data_year')::integer,
                         EXTRACT(YEAR FROM (mm.metrics->>'dataEnd')::date)::integer)
         FROM model_metadata mm
         WHERE (mm.config->>'period')::date = brs.period
         ORDER BY mm.trained_at DESC LIMIT 1) AS snapshot_data_year,
        COALESCE(tc.total_cases, 0) as total_cases
      FROM barangays b
      LEFT JOIN barangay_risk_scores brs ON b.name = brs.barangay_name
        AND brs.period = ${gisSnapshotPeriodSql}
      LEFT JOIN (
        SELECT barangay_name, COUNT(*)::INTEGER as total_cases
        FROM tb_cases
        WHERE date_of_diagnosis IS NOT NULL
          AND EXTRACT(YEAR FROM date_of_diagnosis) = $1
          AND ${pasigResidentOnly()}
        GROUP BY barangay_name
      ) tc ON b.name = tc.barangay_name
      ${isRefYear ? '' : `LEFT JOIN barangay_population bp
        ON b.name = bp.barangay_name
        AND bp.reference_year = $1 AND bp.status = 'ACTIVE'`}
      ORDER BY b.name`,
      [effectiveYear]
    );

    // Year-specific incidence: same-year cases over same-year population ×
    // 100,000. Zero cases with valid population → 0; missing exact-year
    // population → null (N/A). The legacy pipeline value is exposed under a
    // distinct key so it can never be mistaken for authoritative incidence.
    const choropleth = result.rows.map(r => ({
      ...r,
      incidence_per_100k: computeYearIncidence(r.total_cases, r.population),
    }));

    const assessmentPeriod = result.rows.find(r => r.period)?.period || null;
    const periodMonth = assessmentPeriod ? Number(String(assessmentPeriod).slice(5, 7)) : null;
    const assessmentYear = assessmentPeriod ? Number(String(assessmentPeriod).slice(0, 4)) : null;
    const dataYear = result.rows.find(r => r.snapshot_data_year != null)?.snapshot_data_year;
    res.json({ choropleth, year: effectiveYear, assessment_year: assessmentYear,
      data_year: assessmentPeriod ? (dataYear != null ? Number(dataYear)
        : periodMonth === 1 ? assessmentYear - 1 : assessmentYear) : null,
      assessment_period: assessmentPeriod, prediction_period: assessmentPeriod });
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

    // Check if model_predictions has data
    const countResult = await pool.query('SELECT COUNT(*) FROM model_predictions');
    const hasPredictions = parseInt(countResult.rows[0].count) > 0;

    if (hasPredictions) {
      let query = `
        SELECT
          barangay_name, period::text AS period, forecasted_count,
          confidence_lower, confidence_upper,
          risk_class, incidence_per_100k, model_version,
          actual_count, forecast_error, method
        FROM model_predictions
        ORDER BY period DESC, barangay_name
      `;
      const params = [];
      if (barangay) {
        query = `
          SELECT
            barangay_name, period::text AS period, forecasted_count,
            confidence_lower, confidence_upper,
            risk_class, incidence_per_100k, model_version,
            actual_count, forecast_error, method
          FROM model_predictions
          WHERE barangay_name = $1
          ORDER BY period DESC, barangay_name
        `;
        params.push(barangay);
      }
      const result = await pool.query(query, params);
      return res.json({ forecasts: result.rows });
    }

    // Fallback: aggregate monthly data from tb_cases when model_predictions is empty
    // Use LAG() to compute a naive forecast (previous month's actual as next month's prediction)
    let fallbackQuery = `
      WITH monthly AS (
        SELECT
          barangay_name,
          DATE_TRUNC('month', date_of_diagnosis)::DATE AS period,
          COUNT(*)::INTEGER AS actual_count
        FROM tb_cases
        WHERE date_of_diagnosis IS NOT NULL
        AND ${pasigResidentOnly()}
    `;
    const fallbackParams = [];
    if (barangay) {
      fallbackQuery += ` AND barangay_name = $1`;
      fallbackParams.push(barangay);
    }
    fallbackQuery += `
        GROUP BY barangay_name, DATE_TRUNC('month', date_of_diagnosis)
      ),
      with_lag AS (
        SELECT
          barangay_name, period, actual_count,
          LAG(actual_count) OVER (PARTITION BY barangay_name ORDER BY period) AS prev_count
        FROM monthly
      )
      SELECT
        barangay_name, period,
        COALESCE(prev_count, actual_count) AS forecasted_count,
        null AS confidence_lower,
        null AS confidence_upper,
        null AS risk_class,
        null AS incidence_per_100k,
        null AS model_version,
        actual_count,
        ABS(actual_count - COALESCE(prev_count, actual_count))::INTEGER AS forecast_error,
        'naive_lag_fallback' AS method
      FROM with_lag
      ORDER BY period DESC, barangay_name
    `;
    const result = await pool.query(fallbackQuery, fallbackParams);
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
 * RF risk classifications — reads barangay_risk_scores directly (the
 * authoritative RF table). Previously this INNER JOINed model_predictions,
 * which (a) had an ambiguous, unqualified `barangay_name` present in both
 * tables — Postgres rejected every call with "column reference is
 * ambiguous", so this endpoint has been failing 100% of the time — and
 * (b) would have silently excluded historical snapshot periods (2023/2024
 * in the reference dataset) once those were introduced, since a historical
 * snapshot deliberately has no matching model_predictions row (ARIMA is
 * skipped for those runs). Neither forecast data nor the join is needed
 * for "RF risk classifications."
 */
router.get('/predictions/risk', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        barangay_name, period, risk_class, model_type, model_version,
        incidence_per_100k, risk_score,
        CASE WHEN model_type = 'random_forest' THEN classification_confidence END AS classification_confidence,
        CASE WHEN model_type = 'random_forest' THEN prob_low END AS prob_low,
        CASE WHEN model_type = 'random_forest' THEN prob_medium END AS prob_medium,
        CASE WHEN model_type = 'random_forest' THEN prob_high END AS prob_high
      FROM barangay_risk_scores
      WHERE risk_class IS NOT NULL
      ORDER BY period DESC, barangay_name
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
router.post('/alerts/seed', authenticateToken, async (req, res) => {
  try {
    const notifCheck = await pool.query("SELECT COUNT(*)::int AS count FROM alerts WHERE type = 'notification'");
    if (notifCheck.rows[0].count > 0) {
      return res.json({ message: 'Notifications already seeded' });
    }
    const sampleNotifs = [
      { title: 'System Initialized', message: 'TBInsight surveillance system has been initialized and is ready for use.', source: 'data_integration' },
      { title: 'Data Import Completed', message: 'TB case records have been successfully imported and validated.', source: 'tb_records' },
      { title: 'Forecast Model Updated', message: 'ARIMA forecasting model has been retrained with the latest case data.', source: 'forecasting' },
      { title: 'Risk Assessment Complete', message: 'Barangay risk classification has been updated based on current data.', source: 'analytics' },
      { title: 'Report Generated', message: 'Monthly TB surveillance report has been generated and is available for review.', source: 'reports' },
    ];
    for (const n of sampleNotifs) {
      await createNotification(pool, { title: n.title, message: n.message, sourceModule: n.source });
    }
    res.json({ message: 'Notifications seeded', count: sampleNotifs.length });
  } catch (err) {
    console.error('Seed error:', err.message);
    res.status(500).json({ error: 'Failed to seed notifications' });
  }
});

router.get('/alerts', async (req, res) => {
  try {
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
      conditions.push(`(TRIM(barangay_name) = $${idx} OR COALESCE(metadata->'affected_barangays', '[]'::jsonb) ? $${idx})`);
      params.push(barangay.trim());
      idx++;
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

router.get('/alerts/filter-options', async (req, res) => {
  try {
    const type = req.query.type === 'notification' ? 'notification' : null;
    const result = await pool.query(`
      SELECT DISTINCT type, severity, status, source_module
      FROM alerts
      WHERE ($1::text IS NULL OR type = $1)
    `, [type]);
    const values = key => [...new Set(result.rows.map(row => row[key]).filter(Boolean))].sort();
    res.json({ type: values('type'), severity: values('severity'), status: values('status'), source: values('source_module') });
  } catch (err) {
    console.error('Alert filter options error:', err.message);
    res.status(500).json({ error: 'Server error fetching alert filter options.' });
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
 * GET /api/tb/alerts/stale-check
 * Check if alerts need re-evaluation
 *
 * Returns the last evaluation time and whether alerts are stale (>24h old).
 */
router.get('/alerts/stale-check', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT MAX(created_at)::timestamptz AS last_alert_created,
              EXISTS (
                SELECT 1 FROM alerts
                WHERE status != 'resolved'
                  AND alert_type IN ('high_risk_hotspot', 'case_increase', 'forecast_exceeds_threshold')
                  AND metadata->'affected_barangays' IS NULL
              ) AS missing_coverage
       FROM alerts WHERE type = 'alert'`
    );
    const lastCreated = result.rows[0]?.last_alert_created;
    const isStale = result.rows[0]?.missing_coverage || !lastCreated || (Date.now() - new Date(lastCreated).getTime()) > 24 * 60 * 60 * 1000;
    res.json({ lastEvaluated: lastCreated, isStale });
  } catch (err) {
    console.error('Stale check error:', err.message);
    res.json({ lastEvaluated: null, isStale: true });
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
 * Backfill actual_case counts for a past period (feeds the risk index's forecast-error component).
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

    if (!/^\d{4}-\d{2}/.test(period)) {
      return res.status(400).json({ error: 'Period must be in YYYY-MM format' });
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
  const { period, thresholds, forecastHorizon, barangays } = req.body || {};

  // Single-flight: a run already in progress (e.g. sync auto-trigger) wins.
  // Checked synchronously with the guard inside runPipelineTracked, so a run
  // cannot slip in between the two checks (same tick, single-threaded).
  if (getPipelineRunStatus().running) {
    return res.status(202).json({ message: 'Pipeline already running.', current_run: getPipelineRunStatus() });
  }

  // Tracked runner — same state machine + post-run hooks (notification, alert
  // evaluation) as sync-triggered background runs, so both update current_run
  // and the GIS pipeline-status banner identically. Never rejects.
  const result = await runPipelineTracked({ period, thresholds, forecastHorizon, barangays }, 'manual');
  if (!result) {
    const { lastError } = getPipelineRunStatus();
    console.error('Pipeline failed:', lastError || 'Unknown error.');
    return res.status(500).json({ error: 'Pipeline failed. See server logs for details.' });
  }

  res.json({ message: 'Pipeline completed.', result });
});

/**
 * POST /api/tb/pipeline/historical
 * Admin-only backfill: computes risk snapshots for historical data years
 * not already covered by the current pipeline assessment. Each uses data
 * through that year's December, so it reflects what the classifier would
 * have said "as of" that year — not a copy of the current assessment.
 *
 * This is a one-time/rare recovery operation (data for a whole past year
 * essentially never changes after the fact), not something tied to the
 * automatic webhook sync trigger, so it has its own single-flight guard
 * separate from the regular pipeline's.
 */
let _historicalBackfillRunning = false;
router.post('/pipeline/historical', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  if (_historicalBackfillRunning) {
    return res.status(202).json({ message: 'Historical backfill already running.' });
  }
  _historicalBackfillRunning = true;
  try {
    const summaries = await runHistoricalSnapshots();
    res.json({ message: 'Historical snapshot backfill completed.', years: summaries });
  } catch (err) {
    console.error('Historical snapshot backfill error:', err.message);
    res.status(500).json({ error: 'Historical snapshot backfill failed. See server logs for details.' });
  } finally {
    _historicalBackfillRunning = false;
  }
});

/**
 * GET /api/tb/pipeline/status
 * Latest pipeline run metadata + live background-run state (`current_run`)
 * so the UI can show "processing" instead of silently empty results.
 */
router.get('/pipeline/status', async (req, res) => {
  try {
    // run_type defaults to the regular pipeline run; Settings' Model &
    // Data Maintenance section passes 'pipeline_historical' to show the
    // last backfill timestamp instead.
    const allowedRunTypes = ['pipeline', 'pipeline_historical'];
    const runType = allowedRunTypes.includes(req.query.run_type) ? req.query.run_type : 'pipeline';
    const result = await pool.query(
      `SELECT id, run_type, model_version, trained_at, training_months, metrics, config,
              rf_status, rf_updated_at, arima_status, arima_updated_at
       FROM model_metadata
       WHERE run_type = $1
       ORDER BY trained_at DESC
       LIMIT 1`,
      [runType]
    );
    res.json({ latest_run: result.rows[0] || null, current_run: getPipelineRunStatus() });
  } catch (err) {
    console.error('Pipeline status error:', err.message);
    res.status(500).json({ error: 'Server error fetching pipeline status.' });
  }
});

/**
 * GET /api/tb/evaluation/latest
 * Latest saved walk-forward evaluation, including its actual/predicted steps.
 */
router.get('/evaluation/latest', async (req, res) => {
  try {
    const [result, failureResult] = await Promise.all([pool.query(
      `SELECT id, model_version, trained_at, training_months, metrics, config
       FROM model_metadata
       WHERE run_type = 'evaluation'
       ORDER BY trained_at DESC
       LIMIT 1`
    ), pool.query(
      `SELECT trained_at, metrics->>'error' AS error
       FROM model_metadata
       WHERE run_type = 'evaluation_failed'
       ORDER BY trained_at DESC
       LIMIT 1`
    )]);
    const latestEvaluation = result.rows[0] || null;
    const latestFailure = failureResult.rows[0] || null;
    const failureIsNewer = latestFailure && (!latestEvaluation
      || new Date(latestFailure.trained_at) > new Date(latestEvaluation.trained_at));
    const liveStatus = getModelEvaluationStatus();
    res.json({
      latest_evaluation: latestEvaluation,
      evaluation_status: {
        ...liveStatus,
        lastError: liveStatus.lastError || (failureIsNewer ? latestFailure.error : null),
        failedAt: liveStatus.failedAt || (failureIsNewer ? latestFailure.trained_at : null),
      },
    });
  } catch (err) {
    console.error('Latest model evaluation fetch error:', err.message);
    res.status(500).json({ error: 'Server error fetching model performance.' });
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
    const evaluation = await runModelEvaluation(minTrain);
    res.json({ message: 'Evaluation completed.', evaluation });
  } catch (err) {
    console.error('Evaluate error:', err.message);
    const status = err.message === 'No historical data available for evaluation.' ? 400 : 500;
    res.status(status).json({ error: err.message || 'Evaluation failed. See server logs for details.' });
  }
});

/**
 * GET /api/tb/forecast/backtest
 * Past predictions of the forecasting model next to the cases reported later,
 * per barangay and month, for the "Actual and predicted cases" chart.
 *
 * Read from the latest saved walk-forward evaluation (POST /evaluate via
 * modelEvaluation.js): each month was predicted by the same forecast the
 * pipeline uses, fitted only on the months before it. Nothing is recomputed
 * here. Before an evaluation that saved per-barangay months exists, the list is
 * empty (source 'none') rather than filled with a different method — an
 * earlier version showed "same month last year" under this title.
 */
router.get('/forecast/backtest', async (req, res) => {
  try {
    const { barangay } = req.query;
    const result = await pool.query(
      `SELECT model_version, trained_at, metrics->'arima'->'per_barangay' AS per_barangay
       FROM model_metadata
       WHERE run_type = 'evaluation'
       ORDER BY trained_at DESC
       LIMIT 1`
    );
    const evaluation = result.rows[0];
    const perBarangay = Array.isArray(evaluation?.per_barangay) ? evaluation.per_barangay : [];

    const data = [];
    for (const b of perBarangay) {
      if (barangay && b.barangay_name !== barangay) continue;
      for (const step of b.steps || []) {
        const actual = Number(step.actual);
        const predicted = Number(step.predicted);
        if (!step.month || !Number.isFinite(actual) || !Number.isFinite(predicted)) continue;
        data.push({
          barangay_name: b.barangay_name,
          period: String(step.month).slice(0, 10),
          actual_count: actual,
          predicted_count: predicted,
          error: Math.abs(actual - predicted),
          method: step.method || 'arima',
        });
      }
    }

    res.json({
      data,
      source: data.length > 0 ? 'model_evaluation' : 'none',
      evaluated_at: data.length > 0 ? evaluation.trained_at : null,
      model_version: data.length > 0 ? evaluation.model_version : null,
    });
  } catch (err) {
    console.error('Forecast backtest fetch error:', err.message);
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

    // Build base WHERE clause (Pasig City only). City-wide report totals use the
    // counted scope: legacy 'Non-Pasig' rows are traceability-only and never count,
    // while 'Non-Pasig Resident' rows are real patients managed by a Pasig facility
    // and DO count here — they just never enter a barangay breakdown.
    const conditions = [`c.date_of_diagnosis >= $1`, `c.date_of_diagnosis <= $2`, countedCases('c')];
    const params = [startDate, endDate];
    let paramIdx = 3;

    if (barangay) {
      conditions.push(`TRIM(c.barangay_name) = $${paramIdx}`);
      params.push(barangay);
      paramIdx++;
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    // Run queries in 2 batches to stay within pool limit (max 20, but be safe)
    const [summaryRes, outcomesRes, sexRes, ageRes, caseProfileRes, trendRes] = await Promise.all([
      // Summary: total cases, current case statuses, and success rate
      pool.query(`
        SELECT
          COUNT(*)::INTEGER AS total_cases,
          SUM(CASE WHEN case_status = 'DIAGNOSED' THEN 1 ELSE 0 END)::INTEGER AS diagnosed_cases,
          SUM(CASE WHEN case_status = 'ON TREATMENT' THEN 1 ELSE 0 END)::INTEGER AS on_treatment_cases,
          SUM(CASE WHEN treatment_outcome IN (${SUCCESS_OUTCOMES_SQL}) THEN 1 ELSE 0 END)::INTEGER AS successful_count,
          COUNT(*) FILTER (WHERE treatment_outcome IN ('CURED','TREATMENT COMPLETED','TREATMENT FAILED','LOST TO FOLLOW-UP','DIED'))::INTEGER AS evaluated_count
        FROM tb_cases c
        ${whereClause}
      `, params),

      // Outcomes breakdown — raw grouping; the rows are folded into the
      // approved source-aligned categories after the query (see below).
      pool.query(`
        SELECT treatment_outcome AS outcome_status, COUNT(*)::INTEGER AS count
        FROM tb_cases c
        ${whereClause} AND treatment_outcome IS NOT NULL
        GROUP BY treatment_outcome
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
        ${barangay ? 'AND TRIM(barangay_name) = $3' : ''}
        AND ${countedCases('c')}
        GROUP BY month
        ORDER BY month
      `, barangay ? [startDate, endDate, barangay] : [startDate, endDate]),
    ]);

    const [barangayDistRes, riskRes, forecastRes, populationRes, casesRes, facilityRes] = await Promise.all([
      // Barangay distribution (city-wide only)
      barangay ? Promise.resolve({ rows: [] }) : pool.query(`
        SELECT TRIM(barangay_name) AS barangay_name, COUNT(*)::INTEGER AS cases
        FROM tb_cases c
        WHERE date_of_diagnosis >= $1 AND date_of_diagnosis <= $2
          AND ${pasigResidentOnly('c')}
        GROUP BY TRIM(barangay_name)
        ORDER BY cases DESC
      `, [startDate, endDate]),

      // Risk scores (latest period)
      pool.query(`
        SELECT DISTINCT ON (barangay_name)
          barangay_name, risk_class, incidence_per_100k, risk_score, trend_direction,
          TO_CHAR(period, 'YYYY-MM') AS period_key
        FROM barangay_risk_scores
        ORDER BY barangay_name, period DESC
      `),

      // Forecast: the first stored forecast month on/after the report start, taken as ONE
      // period for every barangay (so the total is a single month), and limited to the
      // report's barangay when one is selected.
      pool.query(`
        SELECT barangay_name, forecasted_count, period, method
        FROM model_predictions
        WHERE period = (SELECT MIN(period) FROM model_predictions WHERE period >= $1)
          ${barangay ? 'AND TRIM(barangay_name) = $2' : ''}
      `, barangay ? [startDate, barangay] : [startDate]),

      // Population for incidence calculation — year-specific
      getPopulationMap(yr),

      // All matching case records for the detailed table
      pool.query(`
        SELECT c.id, c.source_case_id, c.case_no, c.date_of_diagnosis, c.barangay_name, c.sex, c.age,
          COALESCE(c.registration_group, 'Unknown') AS registration_group,
          COALESCE(c.anatomical_site, 'Unknown') AS anatomical_site,
          c.case_status,
          c.treatment_outcome AS outcome_status,
          COALESCE(c.source_outcome_status, c.outcome_status) AS source_outcome_status,
          COALESCE(c.bacteriological_status, 'Unknown') AS bacteriological_status
        FROM tb_cases c
        ${whereClause}
        ORDER BY c.date_of_diagnosis DESC
      `, params),

      // Facility performance
      pool.query(`
        SELECT
          TRIM(screening_facility) AS facility,
          COUNT(*)::INTEGER AS total_cases,
          SUM(CASE WHEN treatment_outcome IN (${SUCCESS_OUTCOMES_SQL}) THEN 1 ELSE 0 END)::INTEGER AS successful,
          COUNT(*) FILTER (WHERE treatment_outcome IN ('CURED','TREATMENT COMPLETED','TREATMENT FAILED','LOST TO FOLLOW-UP','DIED'))::INTEGER AS evaluated
        FROM tb_cases c
        ${whereClause}
        AND screening_facility IS NOT NULL AND screening_facility != ''
        GROUP BY TRIM(screening_facility)
        ORDER BY total_cases DESC
      `, params),
    ]);

    // Compute summary values
    const summaryRow = summaryRes.rows[0] || {};
    const totalCases = summaryRow.total_cases || 0;
    const onTreatmentCases = summaryRow.on_treatment_cases || 0;
    const diagnosedCases = summaryRow.diagnosed_cases || 0;

    // TSR: single shared calculation (see treatmentSuccessRate.js) — do not
    // reimplement the cohort query here.
    const { successRate, cohortTotal, cohortYear } = await computeTreatmentSuccessRate(pool, { year: yr, barangay });
    // Same denominator successRate is computed from (the Y-1 treatment-start
    // cohort) — NOT summaryRow.evaluated_count, which counts a different,
    // diagnosis-period-based population. Reporting that count alongside this
    // successRate would silently mix two different cohorts under one label.
    const evaluatedCount = cohortTotal;

    // CFR: single shared calculation (see caseFatalityRate.js) — do not
    // reimplement the evaluated-outcomes denominator here.
    const { rate: fatalityRate, evaluated: fatalityEvaluated, died: fatalityDied } = await computeCaseFatalityRate(pool, { year: yr, barangay });

    // Outcome breakdown: the shared fold into the 9 approved source-aligned
    // categories (see foldOutcomeCounts). This previously echoed the raw stored
    // values straight to the report, so a legacy 'TREATMENT FAILED' row and the
    // unverified 'SCREENED' value were both printed as though they were Excel
    // Outcome/Status categories. Records outside the approved set are now
    // reported in a separate reconciliation block instead of being shown as a
    // category or silently dropped.
    const folded = foldOutcomeCounts(outcomesRes.rows, { labelKey: 'outcome_status', countKey: 'count' });
    const outcomes = folded.categories.map(c => ({
      outcome_status: c.outcome_status,
      count: c.count,
      percentage: totalCases > 0 ? Number(((c.count / totalCases) * 100).toFixed(1)) : 0,
    }));
    const outcomeReconciliation = {
      totalCases,
      approvedTotal: folded.approvedTotal,
      unapprovedTotal: folded.unapprovedTotal,
      unapproved: folded.unapproved,
    };

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
      newCases: regGroups['New'] || regGroups['NEW'] || regGroups['new'] || 0,
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
    // populationRes is now from getPopulationMap(yr) — a Map of { barangayName: { population, ... } }
    const popMap = {};
    for (const [name, popObj] of Object.entries(populationRes)) {
      popMap[name] = popObj?.population || 0;
    }

    // Annualization factor: annual/barangay-without-month = 1 (no annualization),
    // monthly = 12, quarterly = 4, barangay-with-month = 12
    const isFullPeriod = (type === 'annual') || (type === 'barangay' && !month);
    const annualFactor = isFullPeriod ? 1 : (type === 'quarterly' ? 4 : 12);
    const incidenceLabel = isFullPeriod ? 'Annual Incidence / 100k' : 'Annualized Incidence / 100k';

    const barangayDistribution = barangayDistRes.rows.map(r => {
      const pop = popMap[r.barangay_name] || 0;
      const rawIncidence = pop > 0 ? (r.cases * annualFactor / pop) * 100000 : null;
      const incidence = rawIncidence != null ? Number(rawIncidence.toFixed(1)) : null;
      return {
        barangay: r.barangay_name,
        cases: r.cases,
        population: pop,
        incidence,
        incidenceLabel,
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

    // Forecast (single stored period; says so when it is not inside the report period)
    const totalForecasted = forecastRes.rows.reduce((t, r) => t + Math.round(Number(r.forecasted_count || 0)), 0);
    const forecastPeriod = forecastRes.rows.length > 0 ? forecastRes.rows[0].period : null;
    const forecastMethods = [...new Set(forecastRes.rows.map(r => r.method).filter(Boolean))];
    const forecast = {
      available: forecastRes.rows.length > 0,
      forecastedCases: totalForecasted,
      period: forecastPeriod ? new Date(forecastPeriod).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : null,
      barangays: forecastRes.rows.length,
      methods: forecastMethods,
      outsideReportPeriod: forecastPeriod ? new Date(forecastPeriod) > new Date(`${endDate}T23:59:59`) : false,
    };

    // The report's own barangay: classification, trend, population and incidence.
    let barangayProfile = null;
    if (barangay) {
      const pop = popMap[barangay] || 0;
      const rawInc = pop > 0 ? (totalCases * annualFactor / pop) * 100000 : null;
      barangayProfile = {
        barangay,
        population: pop || null,
        incidence: rawInc != null ? Number(rawInc.toFixed(1)) : null,
        incidenceLabel,
        riskLevel: riskMap[barangay]?.risk_class || 'No Data',
        trendDirection: riskMap[barangay]?.trend_direction || null,
      };
    }
    const riskAssessmentPeriod = riskRes.rows.map(r => r.period_key).filter(Boolean).sort().pop() || null;

    // Recommendations (rule-based)
    const recommendations = [];
    if (successRate !== null && successRate < TREATMENT_SUCCESS_TARGET) {
      recommendations.push(`Treatment success rate is below the ${TREATMENT_SUCCESS_TARGET}% target. Strengthen treatment adherence monitoring and patient follow-up.`);
    }
    const highRiskBarangays = riskRes.rows.filter(r => (r.risk_class === 'High' || r.risk_class === 'Very High')
      && (!barangay || r.barangay_name === barangay));
    if (barangay) {
      if (highRiskBarangays.length > 0) {
        recommendations.push(`${barangay} is classified High Risk in the latest assessment. Prioritize case finding, contact tracing and treatment monitoring here.`);
      }
    } else if (highRiskBarangays.length > 0) {
      recommendations.push(`Prioritize monitoring and resource allocation in ${highRiskBarangays.length} high-risk barangay(s): ${highRiskBarangays.map(r => r.barangay_name).join(', ')}.`);
    }
    if (recommendations.length === 0) {
      recommendations.push(barangay
        ? `${barangay} is not classified High Risk in the latest assessment. Continue routine surveillance.`
        : 'No high-risk barangays were identified in the latest risk assessment. Continue routine surveillance.');
    }

    // Recent import (last sync)
    const syncRes = await pool.query(`SELECT MAX(imported_at) AS last_sync FROM tb_cases`);
    const lastSync = syncRes.rows[0]?.last_sync || null;
    // Newest diagnosis date inside the report scope: tells the reader when the period is only partly covered.
    const latestRes = await pool.query(`SELECT MAX(c.date_of_diagnosis)::TEXT AS latest FROM tb_cases c ${whereClause}`, params);
    const latestCaseDate = latestRes.rows[0]?.latest || null;

    // Comparison: the period immediately before this one, and the same period a year earlier.
    const [sy, sm] = startDate.split('-').map(Number);
    const [ey, em] = endDate.split('-').map(Number);
    const spanMonths = (ey - sy) * 12 + (em - sm) + 1;
    const periodName = (y, m) => {
      if (spanMonths === 12) return String(y);
      if (spanMonths === 3) return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
      return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    };
    const prevStart = new Date(Date.UTC(sy, sm - 1 - spanMonths, 1));
    const cmpParams = [startDate, spanMonths];
    if (barangay) cmpParams.push(barangay);
    const cmpRes = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE c.date_of_diagnosis >= $1::date - make_interval(months => $2::int)
                           AND c.date_of_diagnosis < $1::date)::INTEGER AS previous_cases,
        COUNT(*) FILTER (WHERE c.date_of_diagnosis >= $1::date - INTERVAL '12 months'
                           AND c.date_of_diagnosis < ($1::date + make_interval(months => $2::int)) - INTERVAL '12 months')::INTEGER AS yoy_cases
      FROM tb_cases c
      WHERE c.date_of_diagnosis >= $1::date - INTERVAL '12 months'
        AND c.date_of_diagnosis < $1::date
        AND ${countedCases('c')}
        ${barangay ? 'AND TRIM(c.barangay_name) = $3' : ''}
    `, cmpParams);
    const comparison = {
      previousLabel: periodName(prevStart.getUTCFullYear(), prevStart.getUTCMonth() + 1),
      previousCases: cmpRes.rows[0]?.previous_cases ?? 0,
      yearAgoLabel: periodName(sy - 1, sm),
      yearAgoCases: cmpRes.rows[0]?.yoy_cases ?? 0,
      sameAsPrevious: spanMonths === 12,
    };

    // Alerts raised for the period (the alert's period is the first day of its month).
    const alertParams = [startDate, endDate];
    if (barangay) alertParams.push(barangay);
    const alertsRes = await pool.query(`
      SELECT COALESCE(title, alert_type) AS title, alert_type, severity, status, barangay_name, message
      FROM alerts
      WHERE COALESCE(type, 'alert') = 'alert'
        AND period >= $1::date AND period <= $2::date
        ${barangay ? `AND (TRIM(barangay_name) = $3 OR metadata->'affected_barangays' ? $3)` : ''}
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'danger' THEN 0 WHEN 'high' THEN 1 WHEN 'warning' THEN 2 WHEN 'medium' THEN 2 ELSE 3 END,
               created_at DESC
      LIMIT 25
    `, alertParams);

    // Interventions created or due within the period.
    const intParams = [startDate, endDate];
    if (barangay) intParams.push(barangay);
    const interventionsRes = await pool.query(`
      SELECT title, intervention_type, barangay_name, priority, status, assigned_to, target_date::TEXT AS target_date
      FROM interventions
      WHERE (created_at::date BETWEEN $1::date AND $2::date OR target_date BETWEEN $1::date AND $2::date)
        ${barangay ? 'AND TRIM(barangay_name) = $3' : ''}
      ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at DESC
      LIMIT 25
    `, intParams);

    // Older records: the same breakdowns for the same period one year earlier, so the report
    // can say how the picture changed. Any failure leaves `older` null (the report then simply
    // omits the comparison sentences).
    let older = null;
    try {
      const prevConditions = [
        `c.date_of_diagnosis >= $1::date - INTERVAL '1 year'`,
        `c.date_of_diagnosis <= $2::date - INTERVAL '1 year'`,
        countedCases('c'),
      ];
      if (barangay) prevConditions.push('TRIM(c.barangay_name) = $3');
      const prevWhere = 'WHERE ' + prevConditions.join(' AND ');
      const [pSummary, pOutcomes, pSex, pAge, pBrgy, pTsr, pCfr] = await Promise.all([
        pool.query(`SELECT COUNT(*)::INTEGER AS total_cases FROM tb_cases c ${prevWhere}`, params),
        pool.query(`SELECT treatment_outcome AS outcome_status, COUNT(*)::INTEGER AS count FROM tb_cases c ${prevWhere} AND treatment_outcome IS NOT NULL GROUP BY treatment_outcome`, params),
        pool.query(`SELECT sex, COUNT(*)::INTEGER AS count FROM tb_cases c ${prevWhere} GROUP BY sex`, params),
        pool.query(`
          SELECT CASE WHEN age IS NULL THEN 'Unknown' WHEN age <= 14 THEN '0-14' WHEN age <= 24 THEN '15-24'
                      WHEN age <= 34 THEN '25-34' WHEN age <= 44 THEN '35-44' WHEN age <= 54 THEN '45-54'
                      WHEN age <= 64 THEN '55-64' ELSE '65+' END AS age_group, COUNT(*)::INTEGER AS count
          FROM tb_cases c ${prevWhere} GROUP BY age_group`, params),
        barangay ? Promise.resolve({ rows: [] }) : pool.query(`
          SELECT TRIM(barangay_name) AS barangay_name, COUNT(*)::INTEGER AS cases
          FROM tb_cases c
          WHERE date_of_diagnosis >= $1::date - INTERVAL '1 year' AND date_of_diagnosis <= $2::date - INTERVAL '1 year'
            AND ${pasigResidentOnly('c')}
          GROUP BY TRIM(barangay_name)`, [startDate, endDate]),
        computeTreatmentSuccessRate(pool, { year: yr - 1, barangay }),
        computeCaseFatalityRate(pool, { year: yr - 1, barangay }),
      ]);
      const prevTotal = pSummary.rows[0]?.total_cases || 0;
      if (prevTotal > 0) {
        const prevFolded = foldOutcomeCounts(pOutcomes.rows, { labelKey: 'outcome_status', countKey: 'count' });
        older = {
          label: comparison.yearAgoLabel,
          totalCases: prevTotal,
          successRate: pTsr.successRate ?? null,
          fatalityRate: pCfr.rate ?? null,
          outcomes: prevFolded.categories.map(c => ({ outcome_status: c.outcome_status, count: c.count })),
          sex: pSex.rows.map(r => ({ sex: r.sex || 'Unknown', count: r.count })),
          ageGroups: pAge.rows.map(r => ({ age_group: r.age_group, count: r.count })),
          barangayDistribution: pBrgy.rows.map(r => ({ barangay: r.barangay_name, cases: r.cases })),
        };
      }
    } catch (olderErr) {
      console.warn('Report older-records comparison failed:', olderErr.message);
    }

    // Audit trail: who generated this report, when, and for what scope.
    const generatedAt = new Date();
    const reportRef = `RPT-${generatedAt.toISOString().slice(0, 10).replace(/-/g, '')}-${require('crypto').randomBytes(3).toString('hex').toUpperCase()}`;
    let generatedBy = { username: req.user?.username || 'unknown', fullName: null, role: req.user?.role || null };
    try {
      const u = await pool.query('SELECT full_name FROM users WHERE id = $1', [req.user?.id]);
      generatedBy.fullName = u.rows[0]?.full_name || null;
    } catch (nameErr) {
      console.warn('Report author lookup failed:', nameErr.message);
    }
    const { logAuditEvent } = require('../utils/auditLogger');
    await logAuditEvent({
      userId: req.user?.id,
      username: req.user?.username,
      action: 'REPORT_GENERATED',
      result: 'SUCCESS',
      ipAddress: req.ip || null,
      details: { reportRef, type, period: periodLabel, coverage, year: yr, month: month || null, quarter: quarter || null, barangay: barangay || null },
    });

    res.json({
      report: {
        type,
        period: periodLabel,
        coverage,
        generatedAt: generatedAt.toISOString(),
        reportRef,
        generatedBy,
        lastSync,
        startDate,
        endDate,
        latestCaseDate,
      },
      summary: { totalCases, diagnosedCases, onTreatmentCases, successRate, evaluatedCount, cohortYear, fatalityRate, fatalityEvaluated, fatalityDied },
      outcomes,
      outcomeReconciliation,
      demographics: { sex, ageGroups },
      caseProfile,
      trend,
      barangayDistribution,
      riskSummary,
      forecast,
      comparison,
      older,
      alerts: alertsRes.rows,
      interventions: interventionsRes.rows,
      barangayProfile,
      riskAssessmentPeriod,
      incidenceLabel,
      recommendations,
      cases: casesRes.rows,
      population: populationRes.rows,
      facilityPerformance: facilityRes.rows,
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

router.get('/interventions/filter-options', async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT priority, intervention_type, status FROM interventions');
    const values = key => [...new Set(result.rows.map(row => row[key]).filter(Boolean))].sort();
    res.json({ priority: values('priority'), type: values('intervention_type'), status: values('status') });
  } catch (err) {
    console.error('Intervention filter options error:', err.message);
    res.status(500).json({ error: 'Server error fetching intervention filter options.' });
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
router.post('/interventions', authenticateToken, authorizeRoles('admin'), async (req, res) => {
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
router.put('/interventions/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
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
router.post('/interventions/:id/complete', authenticateToken, authorizeRoles('admin'), async (req, res) => {
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
router.delete('/interventions/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM interventions WHERE id = $1', [id]);
    res.json({ message: 'Intervention deleted.' });
  } catch (err) {
    console.error('Delete intervention error:', err.message);
    res.status(500).json({ error: 'Server error deleting intervention.' });
  }
});

// ==================== NLG INSIGHTS ====================

/**
 * GET /api/tb/insights/analytics
 * Generate NLG-based analytics insight from computed metrics.
 * Query params: year, month, barangay, facility, outcome, sex, ageGroup, bacteriological
 */
router.get('/insights/analytics', async (req, res) => {
  try {
    const { year, month, barangay, facility, outcome, sex, ageGroup, bacteriological } = req.query;
    const filters = {};
    if (year) filters.year = year;
    if (month) filters.month = month;
    if (barangay) filters.barangay = barangay;
    if (facility) filters.facility = facility;
    if (outcome) filters.outcome = outcome;
    if (req.query.status) filters.status = req.query.status;
    if (sex) filters.sex = sex;
    if (ageGroup) filters.ageGroup = ageGroup;
    if (bacteriological) filters.bacteriological = bacteriological;

    const metrics = await buildAnalyticsMetrics(pool, filters);
    const insight = generateAnalyticsInsight(metrics, filters);
    res.json(insight);
  } catch (err) {
    console.error('Analytics insight error:', err.message);
    res.status(500).json({ error: 'Server error generating analytics insight.' });
  }
});

/**
 * GET /api/tb/insights/dashboard
 * Concise, Dashboard-specific template NLG (see dashboardInsight.js).
 *
 * Deliberately separate from /insights/analytics: the Dashboard is an
 * overview page and must not render the seven-section Analytics narrative.
 * Takes no filters — the Dashboard has no global filter controls.
 *
 * Returns { type, headline, summary, sections, meta }. `headline` is the
 * one-line { text, tone } at the top of the Dashboard welcome panel;
 * `summary` is the overview paragraph under it.
 */
router.get('/insights/dashboard', async (req, res) => {
  try {
    const metrics = await buildDashboardMetrics(pool);
    const insight = generateDashboardInsight(metrics);
    res.json(insight);
  } catch (err) {
    console.error('Dashboard insight error:', err.message);
    res.status(500).json({ error: 'Server error generating dashboard insight.' });
  }
});

/**
 * GET /api/tb/data-freshness
 * Freshness metadata for the Dashboard header. These are THREE DISTINCT
 * concepts and are returned separately rather than collapsed into one
 * "last updated" timestamp:
 *
 *   lastSynced   — last data transfer received from PASIG TB-IS
 *                  (webhook_logs.received_at), falling back to the newest
 *                  tb_cases.imported_at when no webhook delivery is logged
 *                  (e.g. records loaded by file import). `syncSource` says which.
 *   lastModelRun — newest model_metadata row for run_type 'pipeline', i.e.
 *                  the last full analytics/model pipeline execution.
 *   latestCaseDate — the most recent date_of_diagnosis in the data. This is a
 *                  CLINICAL date describing data coverage, never a system
 *                  freshness timestamp, and is labelled as such.
 *
 * Read-only: this never triggers a synchronisation or a model run.
 */
router.get('/data-freshness', async (req, res) => {
  try {
    const safe = (promise, label) => promise.catch((err) => {
      console.error(`Data freshness query failed (${label}):`, err.message);
      return null;
    });

    const [webhookRes, importRes, modelRes, caseRes] = await Promise.all([
      // Only a webhook that actually finished importing counts as a data
      // sync. webhook_logs.status is constrained to ('received','processed',
      // 'failed'): 'processed' is written after the import succeeds, 'failed'
      // on error, and 'received' is the column default meaning "arrived but
      // not yet processed". Filtering to 'processed' therefore excludes both
      // failed attempts and payloads that were received but never imported.
      // processed_at is preferred over received_at (it is the completion
      // time); COALESCE covers historical rows written before processed_at
      // began being set.
      safe(pool.query(
        `SELECT MAX(COALESCE(processed_at, received_at)) AS last_received
         FROM webhook_logs
         WHERE status = 'processed'`
      ), 'webhook'),
      safe(pool.query(`SELECT MAX(imported_at) AS last_imported FROM tb_cases`), 'import'),
      safe(pool.query(
        `SELECT trained_at, model_version, rf_status, arima_status, training_months
         FROM model_metadata
         WHERE run_type = 'pipeline'
         ORDER BY trained_at DESC
         LIMIT 1`
      ), 'model'),
      safe(pool.query(`SELECT MAX(date_of_diagnosis) AS latest_case FROM tb_cases`), 'cases'),
    ]);

    const lastWebhook = webhookRes?.rows[0]?.last_received || null;
    const lastImport = importRes?.rows[0]?.last_imported || null;
    const model = modelRes?.rows[0] || null;

    // Prefer the webhook delivery timestamp — that is the actual transfer
    // from PASIG TB-IS. Only fall back to imported_at when no delivery is
    // logged, and say so, rather than presenting an import time as a sync.
    const lastSynced = lastWebhook || lastImport;
    const syncSource = lastWebhook ? 'webhook' : lastImport ? 'import' : null;

    res.json({
      lastSynced,
      syncSource,
      lastModelRun: model ? model.trained_at : null,
      modelVersion: model ? model.model_version : null,
      modelRfStatus: model ? model.rf_status : null,
      modelArimaStatus: model ? model.arima_status : null,
      modelTrainingMonths: model ? model.training_months : null,
      latestCaseDate: caseRes?.rows[0]?.latest_case || null,
      dataSource: 'PASIG TB-IS',
    });
  } catch (err) {
    console.error('Data freshness error:', err.message);
    res.status(500).json({ error: 'Server error fetching data freshness.' });
  }
});

/**
 * GET /api/tb/insights/forecasting
 * Generate NLG-based forecasting insight from computed metrics.
 * Query params: startYear, endYear, barangay, horizon
 */
router.get('/insights/forecasting', async (req, res) => {
  try {
    const { startYear, endYear, barangay, horizon } = req.query;
    const filters = {};
    if (startYear) filters.startYear = startYear;
    if (endYear) filters.endYear = endYear;
    if (barangay) filters.barangay = barangay;
    if (horizon) filters.horizon = horizon;

    const metrics = await buildForecastingMetrics(pool, filters);
    const insight = generateForecastingInsight(metrics, filters);
    res.json(insight);
  } catch (err) {
    console.error('Forecasting insight error:', err.message);
    res.status(500).json({ error: 'Server error generating forecasting insight.' });
  }
});

/**
 * GET /api/tb/insights/gis
 * Generate NLG-based GIS/map insight from risk scores + case distribution.
 * Query params: barangay (optional highlight), year (optional data year)
 */
router.get('/insights/gis', async (req, res) => {
  try {
    const { barangay, year } = req.query;
    const filters = {};
    if (barangay) filters.barangay = barangay;
    if (year) filters.year = year;

    const metrics = await buildGisMetrics(pool, filters);
    const insight = generateGisInsight(metrics, filters);
    res.json(insight);
  } catch (err) {
    console.error('GIS insight error:', err.message);
    res.status(500).json({ error: 'Server error generating GIS insight.' });
  }
});

/**
 * GET /api/tb/treatment-success-rate
 * Single shared TSR calculation (see treatmentSuccessRate.js) — the
 * cohort-based figure required by the intended methodology. Every page
 * that displays "Treatment Success Rate" / "Success Rate" should call this
 * rather than computing its own (diagnosis-date-filtered) approximation,
 * which is a DIFFERENT metric and previously caused four frontend cards to
 * disagree with this same number as reported by NLG-generated text.
 *
 * Query params: year (reporting year Y; cohort is Y-1), barangay (optional).
 */
router.get('/treatment-success-rate', async (req, res) => {
  try {
    const { year, barangay, sex, ageGroup, facility, bacteriological } = req.query;
    const result = await computeTreatmentSuccessRate(pool, { year, barangay, sex, ageGroup, facility, bacteriological });
    res.json(result);
  } catch (err) {
    console.error('Treatment success rate error:', err.message);
    res.status(500).json({ error: 'Server error computing treatment success rate.' });
  }
});

/**
 * GET /api/tb/case-fatality-rate
 * Single shared CFR calculation (see caseFatalityRate.js) — every page that
 * displays "Case Fatality Rate" should call this rather than computing its
 * own denominator independently.
 *
 * Query params: year, month, barangay, sex, ageGroup, facility, bacteriological.
 */
router.get('/case-fatality-rate', async (req, res) => {
  try {
    const { year, month, barangay, sex, ageGroup, facility, bacteriological } = req.query;
    const result = await computeCaseFatalityRate(pool, { year, month, barangay, sex, ageGroup, facility, bacteriological });
    res.json(result);
  } catch (err) {
    console.error('Case fatality rate error:', err.message);
    res.status(500).json({ error: 'Server error computing case fatality rate.' });
  }
});

/**
 * GET /api/tb/webhook-logs
 * List recent webhook integration logs.
 */
router.get('/webhook-logs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, source, batch_id, status, records_received, records_imported,
             error_message, received_at, processed_at
      FROM webhook_logs
      ORDER BY received_at DESC
      LIMIT 50
    `);
    res.json({ logs: result.rows });
  } catch (err) {
    console.error('Webhook logs error:', err.message);
    res.status(500).json({ error: 'Server error fetching webhook logs.' });
  }
});

// ==================== POPULATION REFERENCE DATA ====================

/**
 * GET /api/tb/population/years
 * Get available population reference years.
 */
router.get('/population/years', authenticateToken, async (req, res) => {
  try {
    const years = await getAvailablePopulationYears();
    res.json({ years });
  } catch (err) {
    console.error('Population years error:', err.message);
    res.status(500).json({ error: 'Server error fetching population years.' });
  }
});

/**
 * GET /api/tb/population
 * Get all population reference years with metadata.
 */
router.get('/population', authenticateToken, async (req, res) => {
  try {
    const references = await getPopulationReferences();
    res.json({ references });
  } catch (err) {
    console.error('Population references error:', err.message);
    res.status(500).json({ error: 'Server error fetching population references.' });
  }
});

/**
 * GET /api/tb/population/template/csv
 * Download CSV population template.
 */
router.get('/population/template/csv', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const templatePath = path.join(__dirname, '..', 'data', 'population-template.csv');
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ error: 'Template not found.' });
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=population-template.csv');
    res.send(fs.readFileSync(templatePath, 'utf8'));
  } catch (err) {
    console.error('CSV template error:', err.message);
    res.status(500).json({ error: 'Server error generating template.' });
  }
});

/**
 * GET /api/tb/population/template/xlsx
 * Download XLSX population template.
 */
router.get('/population/template/xlsx', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const templatePath = path.join(__dirname, '..', 'data', 'TBInsight_Population_Reference_Template.xlsx');
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ error: 'Template not found.' });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=TBInsight_Population_Reference_Template.xlsx');
    res.send(fs.readFileSync(templatePath));
  } catch (err) {
    console.error('XLSX template error:', err.message);
    res.status(500).json({ error: 'Server error generating template.' });
  }
});

/**
 * GET /api/tb/population/:year
 * Get population for a specific reference year.
 */
router.get('/population/:year', authenticateToken, async (req, res) => {
  try {
    const { year } = req.params;
    const yearNum = Number(year);
    if (!yearNum || yearNum < 2000 || yearNum > 2100) {
      return res.status(400).json({ error: 'Invalid reference year.' });
    }
    const data = await getPopulationByYear(yearNum);
    res.json({ year: yearNum, data });
  } catch (err) {
    console.error('Population by year error:', err.message);
    res.status(500).json({ error: 'Server error fetching population data.' });
  }
});

/**
 * POST /api/tb/population/validate
 * Validate population data before saving.
 * Supports both JSON body (manual/CSV) and file upload (CSV/XLSX).
 */
router.post('/population/validate', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    let reference_year, records, source_organization, source_reference, notes;

    // Check if file upload (multipart)
    if (req.files && req.files.file) {
      const file = req.files.file;
      const ext = file.name.split('.').pop().toLowerCase();

      if (ext === 'xlsx' || ext === 'xls') {
        // XLSX: extract reference info from Excel
        const parsed = parsePopulationExcel(file.data);
        reference_year = parsed.reference_year;
        source_organization = parsed.source_organization;
        source_reference = parsed.source_reference;
        notes = parsed.notes;
        records = parsed.records;
      } else if (ext === 'csv') {
        // CSV: extract reference info from file (form fields override if provided)
        const parsed = parsePopulationCsv(file.data.toString('utf8'));
        reference_year = req.body.reference_year || parsed.reference_year;
        source_organization = req.body.source_organization || parsed.source_organization;
        source_reference = req.body.source_reference || parsed.source_reference;
        notes = req.body.notes || parsed.notes;
        records = parsed.records;
      } else {
        return res.status(400).json({ error: 'Unsupported file format. Use .csv or .xlsx' });
      }
    } else {
      // JSON body (manual entry)
      reference_year = req.body.reference_year;
      records = req.body.records;
    }

    if (!reference_year || !records || !Array.isArray(records)) {
      return res.status(400).json({ error: 'reference_year and records are required.' });
    }
    const yearNum = Number(reference_year);
    if (!yearNum || yearNum < 2000 || yearNum > 2100) {
      return res.status(400).json({ error: 'Invalid reference year.' });
    }
    if (yearNum === GEOJSON_REFERENCE_YEAR) {
      return res.status(400).json({ error: `Year ${GEOJSON_REFERENCE_YEAR} is managed by the existing GeoJSON reference.` });
    }
    const validation = await validatePopulationData(yearNum, records);
    res.json({ validation, reference_year: yearNum, source_organization, source_reference, notes });
  } catch (err) {
    console.error('Population validation error:', err.message);
    res.status(500).json({ error: 'Server error validating population data.' });
  }
});

/**
 * POST /api/tb/population
 * Save population data for a reference year.
 * Supports both JSON body (manual/CSV) and file upload (CSV/XLSX).
 */
router.post('/population', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    let reference_year, source_organization, source_reference, notes, records;

    // Check if file upload (multipart)
    if (req.files && req.files.file) {
      const file = req.files.file;
      const ext = file.name.split('.').pop().toLowerCase();

      if (ext === 'xlsx' || ext === 'xls') {
        // XLSX: extract reference info from Excel
        const parsed = parsePopulationExcel(file.data);
        reference_year = parsed.reference_year;
        source_organization = parsed.source_organization;
        source_reference = parsed.source_reference;
        notes = parsed.notes;
        records = parsed.records;
      } else if (ext === 'csv') {
        // CSV: extract reference info from file (form fields override if provided)
        const parsed = parsePopulationCsv(file.data.toString('utf8'));
        reference_year = req.body.reference_year || parsed.reference_year;
        source_organization = req.body.source_organization || parsed.source_organization;
        source_reference = req.body.source_reference || parsed.source_reference;
        notes = req.body.notes || parsed.notes;
        records = parsed.records;
      } else {
        return res.status(400).json({ error: 'Unsupported file format. Use .csv or .xlsx' });
      }
    } else {
      // JSON body (manual entry)
      reference_year = req.body.reference_year;
      source_organization = req.body.source_organization;
      source_reference = req.body.source_reference;
      notes = req.body.notes;
      records = req.body.records;
    }

    if (!reference_year || !source_organization || !source_reference || !records || !Array.isArray(records)) {
      return res.status(400).json({ error: 'reference_year, source_organization, source_reference, and records are required.' });
    }
    const yearNum = Number(reference_year);
    if (!yearNum || yearNum < 2000 || yearNum > 2100) {
      return res.status(400).json({ error: 'Invalid reference year.' });
    }
    if (yearNum === GEOJSON_REFERENCE_YEAR) {
      return res.status(400).json({ error: `Year ${GEOJSON_REFERENCE_YEAR} is managed by the existing GeoJSON reference.` });
    }

    const validation = await validatePopulationData(yearNum, records);
    if (validation.invalid.length > 0 || validation.unmatched.length > 0 || validation.duplicates.length > 0) {
      return res.status(400).json({ error: 'Validation failed.', validation });
    }

    const result = await savePopulationData(yearNum, source_organization, source_reference, notes, validation.valid_records, req.user?.id);

    // Log audit event
    try {
      const { logAuditEvent } = require('../utils/auditLogger');
      await logAuditEvent({
        userId: req.user?.id,
        username: req.user?.username,
        action: 'POPULATION_REFERENCE_CREATE',
        targetUserId: null,
        targetUsername: null,
        result: 'SUCCESS',
        ipAddress: req.ip || null,
      });
    } catch (auditErr) {
      console.warn('Audit log failed for population save:', auditErr.message);
    }

    res.status(201).json({ message: 'Population data saved.', result, validation });
  } catch (err) {
    console.error('Population save error:', err.message);
    res.status(500).json({ error: 'Server error saving population data.' });
  }
});

/**
 * PUT /api/tb/population/:id
 * Update a single population record.
 */
router.put('/population/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { population } = req.body;
    if (!population || isNaN(population) || parseInt(population) <= 0) {
      return res.status(400).json({ error: 'Valid population value is required.' });
    }
    const record = await updatePopulationRecord(id, population, req.user?.id);
    if (!record) {
      return res.status(404).json({ error: 'Population record not found.' });
    }

    // Log audit event
    try {
      const { logAuditEvent } = require('../utils/auditLogger');
      await logAuditEvent({
        userId: req.user?.id,
        username: req.user?.username,
        action: 'POPULATION_REFERENCE_UPDATE',
        targetUserId: null,
        targetUsername: null,
        result: 'SUCCESS',
        ipAddress: req.ip || null,
      });
    } catch (auditErr) {
      console.warn('Audit log failed for population update:', auditErr.message);
    }

    res.json({ message: 'Population record updated.', record });
  } catch (err) {
    console.error('Population update error:', err.message);
    res.status(500).json({ error: 'Server error updating population record.' });
  }
});

module.exports = router;
