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

    // Fix incorrect "Kapasigan Extension" barangay -> real "Bagong Katipunan" (idempotent)
    const bagongKatipunanMigPath = path.join(__dirname, 'db', 'migrations', '008_fix_bagong_katipunan.sql');
    if (fs.existsSync(bagongKatipunanMigPath)) {
      const bagongKatipunanSql = fs.readFileSync(bagongKatipunanMigPath, 'utf8');
      await execSql(bagongKatipunanSql);
      console.log('✅ Bagong Katipunan barangay fix migration completed successfully.');
    } else {
      console.log('⚠️ Bagong Katipunan barangay fix migration not found, skipping.');
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

