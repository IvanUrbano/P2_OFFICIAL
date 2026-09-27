const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Use DATABASE_URL if available (Render production), otherwise fall back to discrete local settings
const isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL;
const isNeon = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon.tech');

const poolConfig = process.env.DATABASE_URL
  ? {
    connectionString: process.env.DATABASE_URL,
    ssl: isNeon ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
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

// Execute multi-statement SQL by splitting on semicolons and running each individually.
// pg's extended query protocol doesn't support multiple statements in one call.
const execSql = async (sqlContent) => {
  const client = await pool.connect();
  try {
    // Split on ";\n" or ";" at end of line — avoids splitting on semicolons inside strings/comments
    const statements = sqlContent
      .split(/;\s*\n/)
      .map(s => s.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim())
      .filter(s => s.length > 0);

    for (const stmt of statements) {
      await client.query(stmt);
    }
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
    await initDb();
  })
  .catch((err) => {
    console.error('❌ FATAL: Failed to connect to PostgreSQL:', err.message);
    process.exit(1);
  });

module.exports = pool;
