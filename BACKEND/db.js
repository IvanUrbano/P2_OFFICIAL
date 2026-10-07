const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Use DATABASE_URL if available (Render production), otherwise fall back to discrete local settings
const isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL;
const isNeon = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon.tech');

// Opening a connection to the remote (Neon) database costs ~1.5 s of TLS/auth round
// trips vs ~0.2 s per query on an open one, so idle connections are kept for 10 minutes
// (instead of being closed after 30 s and reopened on the next page load).
const poolConfig = process.env.DATABASE_URL
  ? {
    connectionString: process.env.DATABASE_URL,
    ssl: isNeon ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 600000,
    keepAlive: true,
    connectionTimeoutMillis: 10000,
  }
  : {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
const pool = new Pool(poolConfig);

// An idle connection the server drops (Neon closes idle ones) is reported as an 'error'
// on the pool; without a listener Node treats it as unhandled and crashes the process.
// The pool discards that connection and opens a new one on the next query.
pool.on('error', (err) => {
  console.error('[tbinsight] Unexpected pool error:', err.message);
});

const execSql = async (sqlContent) => {
  const client = await pool.connect();
  try {
    // A file saved "UTF-8 with BOM" starts with an invisible U+FEFF that Postgres
    // rejects as a syntax error — which aborted startup init and silently skipped every
    // later migration (015 had one from 2026-09-27 to 2026-10-04). Strip it.
    await client.query(String(sqlContent).replace(/^﻿/, ''));
  } finally {
    client.release();
  }
};

// Helper function to auto-initialize tables if they don't exist
const initDb = async () => {
  try {
    const initSqlPath = path.join(__dirname, 'init.sql');
    if (fs.existsSync(initSqlPath)) {
      const sql = fs.readFileSync(initSqlPath, 'utf8');
      await execSql(sql);
      console.log('✅ Database tables checked/initialized successfully.');
    } else {
      console.log('⚠️ init.sql file not found, skipping database auto-initialization.');
    }

    // TBInsight: auto-run full schema migration (idempotent: CREATE TABLE IF NOT EXISTS)
    const tbInsightMigPath = path.join(__dirname, 'db', 'migrations', '002_tbinsight_full_schema.sql');
    if (fs.existsSync(tbInsightMigPath)) {
      const tbSql = fs.readFileSync(tbInsightMigPath, 'utf8');
      await execSql(tbSql);
      console.log('✅ TBInsight schema migration completed successfully.');
    } else {
      console.log('⚠️ TBInsight migration not found, skipping.');
    }

    // STIS fields: add validation_status, itis_case_id, location_classification (idempotent)
    const stisMigPath = path.join(__dirname, 'db', 'migrations', '006_add_stis_fields.sql');
    if (fs.existsSync(stisMigPath)) {
      const stisSql = fs.readFileSync(stisMigPath, 'utf8');
      await execSql(stisSql);
      console.log('✅ STIS fields migration completed successfully.');
    } else {
      console.log('⚠️ STIS fields migration not found, skipping.');
    }

    // Webhook logs: track incoming webhooks from Pasig Clone (idempotent)
    const webhookMigPath = path.join(__dirname, 'db', 'migrations', '007_webhook_logs.sql');
    if (fs.existsSync(webhookMigPath)) {
      const webhookSql = fs.readFileSync(webhookMigPath, 'utf8');
      await execSql(webhookSql);
      console.log('✅ Webhook logs migration completed successfully.');
    } else {
      console.log('⚠️ Webhook logs migration not found, skipping.');
    }

    // Password hash: add password_hash column for Pasig Clone compatibility (idempotent)
    const passwordHashMigPath = path.join(__dirname, 'db', 'migrations', '008_password_hash_column.sql');
    if (fs.existsSync(passwordHashMigPath)) {
      const passwordHashSql = fs.readFileSync(passwordHashMigPath, 'utf8');
      await execSql(passwordHashSql);
      console.log('✅ Password hash migration completed successfully.');
    } else {
      console.log('⚠️ Password hash migration not found, skipping.');
    }

    // Login security: login_attempts table + lockout fields on users (idempotent)
    const loginSecurityMigPath = path.join(__dirname, 'db', 'migrations', '009_login_security.sql');
    if (fs.existsSync(loginSecurityMigPath)) {
      const loginSecuritySql = fs.readFileSync(loginSecurityMigPath, 'utf8');
      await execSql(loginSecuritySql);
      console.log('✅ Login security migration completed successfully.');
    } else {
      console.log('⚠️ Login security migration not found, skipping.');
    }

    // Audit logs: tracks password resets and other security events (idempotent)
    const auditLogsMigPath = path.join(__dirname, 'db', 'migrations', '010_audit_logs.sql');
    if (fs.existsSync(auditLogsMigPath)) {
      const auditLogsSql = fs.readFileSync(auditLogsMigPath, 'utf8');
      await execSql(auditLogsSql);
      console.log('✅ Audit logs migration completed successfully.');
    } else {
      console.log('⚠️ Audit logs migration not found, skipping.');
    }

    // Password changed at: tracks when password was last changed (idempotent)
    const passwordChangedMigPath = path.join(__dirname, 'db', 'migrations', '011_password_changed_at.sql');
    if (fs.existsSync(passwordChangedMigPath)) {
      const passwordChangedSql = fs.readFileSync(passwordChangedMigPath, 'utf8');
      await execSql(passwordChangedSql);
      console.log('✅ Password changed at migration completed successfully.');
    } else {
      console.log('⚠️ Password changed at migration not found, skipping.');
    }

    // Fix incorrect "Kapasigan Extension" barangay -> real "Bagong Katipunan" (idempotent)
    const bagongKatipunanMigPath = path.join(__dirname, 'db', 'migrations', '012_fix_bagong_katipunan.sql');
    if (fs.existsSync(bagongKatipunanMigPath)) {
      const bagongKatipunanSql = fs.readFileSync(bagongKatipunanMigPath, 'utf8');
      await execSql(bagongKatipunanSql);
      console.log('✅ Bagong Katipunan barangay fix migration completed successfully.');
    } else {
      console.log('⚠️ Bagong Katipunan barangay fix migration not found, skipping.');
    }

    // Barangay population: year-specific population reference data table (idempotent)
    const popMigPath = path.join(__dirname, 'db', 'migrations', '015_barangay_population.sql');
    if (fs.existsSync(popMigPath)) {
      const popSql = fs.readFileSync(popMigPath, 'utf8');
      await execSql(popSql);
      console.log('✅ Barangay population migration completed successfully.');
    } else {
      console.log('⚠️ Barangay population migration not found, skipping.');
    }

    // Phase 2A: users.facility_id — Staff accounts assigned to a health facility (idempotent)
    const userFacMigPath = path.join(__dirname, 'db', 'migrations', '016_user_facility.sql');
    if (fs.existsSync(userFacMigPath)) {
      const userFacSql = fs.readFileSync(userFacMigPath, 'utf8');
      await execSql(userFacSql);
      console.log('✅ User facility assignment migration completed successfully.');
    } else {
      console.log('⚠️ User facility assignment migration not found, skipping.');
    }

    // Phase 2B: tb_cases.entered_by_* — manual entry provenance (idempotent)
    const manualEntryMigPath = path.join(__dirname, 'db', 'migrations', '017_manual_entry.sql');
    if (fs.existsSync(manualEntryMigPath)) {
      const manualEntrySql = fs.readFileSync(manualEntryMigPath, 'utf8');
      await execSql(manualEntrySql);
      console.log('✅ Manual entry provenance migration completed successfully.');
    } else {
      console.log('⚠️ Manual entry provenance migration not found, skipping.');
    }

    // Duplicate detection: DSTB fingerprint
    // detection columns and one-time backfill (idempotent). Wrapped in its
    // own try/catch — a failure here (e.g. an unexpected constraint issue
    // against live data) must not prevent the unrelated migrations below
    // (boundary restore, geometry sync) from running.
    try {
      const dupDetectionMigPath = path.join(__dirname, 'db', 'migrations', '018_duplicate_detection.sql');
      if (fs.existsSync(dupDetectionMigPath)) {
        const dupDetectionSql = fs.readFileSync(dupDetectionMigPath, 'utf8');
        await execSql(dupDetectionSql);
        console.log('✅ Duplicate detection migration completed successfully.');
      } else {
        console.log('⚠️ Duplicate detection migration not found, skipping.');
      }
    } catch (dupErr) {
      console.error('❌ Duplicate detection migration failed (continuing with remaining migrations):', dupErr.message);
    }

    // Forecast method/tier column + per-model (RF vs ARIMA) run status columns (idempotent)
    try {
      const forecastMethodMigPath = path.join(__dirname, 'db', 'migrations', '019_forecast_method_and_model_status.sql');
      if (fs.existsSync(forecastMethodMigPath)) {
        const forecastMethodSql = fs.readFileSync(forecastMethodMigPath, 'utf8');
        await execSql(forecastMethodSql);
        console.log('✅ Forecast method / model status migration completed successfully.');
      } else {
        console.log('⚠️ Forecast method / model status migration not found, skipping.');
      }
    } catch (methodErr) {
      console.error('❌ Forecast method / model status migration failed (continuing with remaining migrations):', methodErr.message);
    }

    // Case access & transfers: current_responsible_facility_id on tb_cases + case_transfers table (idempotent)
    try {
      const caseAccessMigPath = path.join(__dirname, 'db', 'migrations', '020_case_access_transfers.sql');
      if (fs.existsSync(caseAccessMigPath)) {
        const caseAccessSql = fs.readFileSync(caseAccessMigPath, 'utf8');
        await execSql(caseAccessSql);
        console.log('✅ Case access & transfers migration completed successfully.');
      } else {
        console.log('⚠️ Case access & transfers migration not found, skipping.');
      }
    } catch (caseAccessErr) {
      console.error('❌ Case access & transfers migration failed (continuing with remaining migrations):', caseAccessErr.message);
    }

    // Patient # / Case ID from PASIG (unique case_no enables update-instead-of-duplicate)
    try {
      const caseIdentityMigPath = path.join(__dirname, 'db', 'migrations', '021_case_identity.sql');
      if (fs.existsSync(caseIdentityMigPath)) {
        await execSql(fs.readFileSync(caseIdentityMigPath, 'utf8'));
        console.log('✅ Case identity migration completed successfully.');
      }
    } catch (caseIdentityErr) {
      console.error('❌ Case identity migration failed (continuing with remaining migrations):', caseIdentityErr.message);
    }

    // 2026 barangay population projection (never overwrites an entered figure)
    try {
      const pop2026MigPath = path.join(__dirname, 'db', 'migrations', '022_population_2026_projection.sql');
      if (fs.existsSync(pop2026MigPath)) {
        await execSql(fs.readFileSync(pop2026MigPath, 'utf8'));
        console.log('✅ 2026 population projection migration completed successfully.');
      }
    } catch (pop2026Err) {
      console.error('❌ 2026 population projection migration failed (continuing with remaining migrations):', pop2026Err.message);
    }

    // Barangay-based staff (users.barangay_id), expanded health_facilities, case tracking
    // fields + case/review history tables. Additive only.
    try {
      const staffMigPath = path.join(__dirname, 'db', 'migrations', '023_barangay_staff_facilities_case_tracking.sql');
      if (fs.existsSync(staffMigPath)) {
        await execSql(fs.readFileSync(staffMigPath, 'utf8'));
        console.log('✅ Barangay staff / facilities / case tracking migration completed successfully.');
      }
    } catch (staffMigErr) {
      console.error('❌ Barangay staff / facilities / case tracking migration failed (continuing with remaining migrations):', staffMigErr.message);
    }

    // User profile: full_name, optional email, status, last_login_at, must_change_password
    try {
      const userProfileMigPath = path.join(__dirname, 'db', 'migrations', '024_user_profile_status.sql');
      if (fs.existsSync(userProfileMigPath)) {
        await execSql(fs.readFileSync(userProfileMigPath, 'utf8'));
        console.log('✅ User profile / status migration completed successfully.');
      }
    } catch (userProfileErr) {
      console.error('❌ User profile / status migration failed (continuing with remaining migrations):', userProfileErr.message);
    }

    // Administrator account lock (manually_locked / locked_at / locked_by_user_id)
    try {
      const manualLockMigPath = path.join(__dirname, 'db', 'migrations', '025_user_manual_lock.sql');
      if (fs.existsSync(manualLockMigPath)) {
        await execSql(fs.readFileSync(manualLockMigPath, 'utf8'));
        console.log('✅ User manual lock migration completed successfully.');
      }
    } catch (manualLockErr) {
      console.error('❌ User manual lock migration failed (continuing with remaining migrations):', manualLockErr.message);
    }

    // Who created each account (users.created_by_user_id, backfilled from audit_logs)
    try {
      const createdByMigPath = path.join(__dirname, 'db', 'migrations', '026_user_created_by.sql');
      if (fs.existsSync(createdByMigPath)) {
        await execSql(fs.readFileSync(createdByMigPath, 'utf8'));
        console.log('✅ User created-by migration completed successfully.');
      }
    } catch (createdByErr) {
      console.error('❌ User created-by migration failed (continuing with remaining migrations):', createdByErr.message);
    }

    // Patient barangay as a key on tb_cases (barangay_id, kept in step by a trigger)
    try {
      const caseBrgyMigPath = path.join(__dirname, 'db', 'migrations', '027_tb_cases_barangay_id.sql');
      if (fs.existsSync(caseBrgyMigPath)) {
        await execSql(fs.readFileSync(caseBrgyMigPath, 'utf8'));
        console.log('✅ tb_cases barangay_id migration completed successfully.');
      }
    } catch (caseBrgyErr) {
      console.error('❌ tb_cases barangay_id migration failed (continuing with remaining migrations):', caseBrgyErr.message);
    }

    try {
      const caseBrgyAuthorityMigPath = path.join(__dirname, 'db', 'migrations', '028_tb_cases_barangay_id_authority.sql');
      if (fs.existsSync(caseBrgyAuthorityMigPath)) {
        await execSql(fs.readFileSync(caseBrgyAuthorityMigPath, 'utf8'));
        console.log('✅ tb_cases barangay_id authority migration completed successfully.');
      }
    } catch (caseBrgyAuthorityErr) {
      console.error('❌ tb_cases barangay_id authority migration failed (continuing):', caseBrgyAuthorityErr.message);
    }

    // Non-Pasig residents treated in a Pasig facility: free-text residence, optional
    // barangay, facility_summary rows with no barangay.
    try {
      const nonPasigResidentMigPath = path.join(__dirname, 'db', 'migrations', '029_non_pasig_residents.sql');
      if (fs.existsSync(nonPasigResidentMigPath)) {
        await execSql(fs.readFileSync(nonPasigResidentMigPath, 'utf8'));
        console.log('✅ Non-Pasig resident migration completed successfully.');
      }
    } catch (nonPasigResidentErr) {
      console.error('❌ Non-Pasig resident migration failed (continuing):', nonPasigResidentErr.message);
    }

    // Facility codes (the facility part of the PASIG Case ID) and the treatment
    // facilities from the 2023-2026 registry files that were not registered (idempotent)
    try {
      const facilityCodesMigPath = path.join(__dirname, 'db', 'migrations', '030_facility_codes.sql');
      if (fs.existsSync(facilityCodesMigPath)) {
        await execSql(fs.readFileSync(facilityCodesMigPath, 'utf8'));
        console.log('✅ Facility codes migration completed successfully.');
      }
    } catch (facilityCodesErr) {
      console.error('❌ Facility codes migration failed (continuing):', facilityCodesErr.message);
    }

    const treatmentStateMigPath = path.join(__dirname, 'db', 'migrations', '031_case_status_treatment_outcome.sql');
    if (fs.existsSync(treatmentStateMigPath)) {
      await execSql(fs.readFileSync(treatmentStateMigPath, 'utf8'));
    }

    // Same-case outcome updates: case_history actor column, tb_cases.updated_at,
    // and the MISSING_CASE_ID review flag. Migrations are registered one-by-one
    // here (this directory is NOT scanned), so a new file needs its own block.
    const caseHistoryWiringMigPath = path.join(__dirname, 'db', 'migrations', '032_case_history_wiring.sql');
    if (fs.existsSync(caseHistoryWiringMigPath)) {
      try {
        await execSql(fs.readFileSync(caseHistoryWiringMigPath, 'utf8'));
      } catch (caseHistoryWiringErr) {
        console.error('❌ Case history wiring migration failed (continuing):', caseHistoryWiringErr.message);
      }
    }

    // Restore the 30 Pasig barangay polygons to their original, already-correct shapes,
    // undoing two earlier over-broad attempts, and keep only the Kapasigan Extension ->
    // Bagong Katipunan rename/population fix (idempotent)
    const restoreBoundariesMigPath = path.join(__dirname, 'db', 'migrations', '013_restore_original_boundaries.sql');
    if (fs.existsSync(restoreBoundariesMigPath)) {
      const restoreBoundariesSql = fs.readFileSync(restoreBoundariesMigPath, 'utf8');
      await execSql(restoreBoundariesSql);
      console.log('✅ Restore original barangay boundaries migration completed successfully.');
    } else {
      console.log('⚠️ Restore original barangay boundaries migration not found, skipping.');
    }

    // Force-sync barangay geometries directly from the GeoJSON file.
    // This always runs last and guarantees the DB matches the file,
    // overriding any earlier migration that may have corrupted the geometries.
    const geojsonPath = path.join(__dirname, 'data', 'pasig-barangays.geojson');
    if (fs.existsSync(geojsonPath)) {
      const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
      const client = await pool.connect();
      try {
        let synced = 0;
        for (const feature of geojson.features) {
          const { name, population, centroid } = feature.properties;
          const geometry = JSON.stringify(feature.geometry);
          const [lon, lat] = centroid;
          await client.query(
            `INSERT INTO barangays (name, population, centroid_lon, centroid_lat)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (name) DO UPDATE SET
               population = EXCLUDED.population,
               centroid_lon = EXCLUDED.centroid_lon,
               centroid_lat = EXCLUDED.centroid_lat`,
            [name, population || 0, lon, lat]
          );
          await client.query(
            `INSERT INTO barangays_geom (name, population, geom)
             VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))
             ON CONFLICT (name) DO UPDATE SET
               population = EXCLUDED.population,
               geom = EXCLUDED.geom`,
            [name, population || 0, geometry]
          );
          synced++;
        }
        console.log(`✅ Force-synced ${synced} barangay geometries from GeoJSON file.`);
      } finally {
        client.release();
      }
    } else {
      console.log('⚠️ pasig-barangays.geojson not found, skipping geometry sync.');
    }
  } catch (err) {
    console.error('❌ Database initialization error:', err.message);
  }
};

// Test the connection on startup
pool.connect()
  .then(async (client) => {
    console.log('✅ Connected to PostgreSQL database');
    client.release();
    // ~275 statements across 17 migration files run serially on every boot — each one a
    // round trip to Neon. That's fine on a cold deploy, but it adds up on every nodemon
    // restart in local dev. Set SKIP_MIGRATIONS=true locally once the schema is caught up.
    if (process.env.SKIP_MIGRATIONS === 'true') {
      console.log('⏭️  Skipping migrations (SKIP_MIGRATIONS=true).');
    } else {
      await initDb();
    }
    // Pre-open a few connections so the first page load doesn't pay connection setup
    await Promise.all(Array.from({ length: 6 }, () => pool.query('SELECT 1'))).catch(() => {});
  })
  .catch((err) => {
    console.error('❌ FATAL: Failed to connect to PostgreSQL:', err.message);
    process.exit(1);
  });

module.exports = pool;
