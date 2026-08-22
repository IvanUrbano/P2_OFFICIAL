const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Use DATABASE_URL if available (Render production), otherwise fall back to discrete local settings
const isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL;

const poolConfig = process.env.DATABASE_URL
  ? {
    connectionString: process.env.DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
  }
  : {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
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
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

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

    // PostGIS: enable extension + create barangays_geom table (idempotent)
    const postgisMigPath = path.join(__dirname, 'db', 'migrations', '003_postgis.sql');
    if (fs.existsSync(postgisMigPath)) {
      const postgisSql = fs.readFileSync(postgisMigPath, 'utf8');
      await execSql(postgisSql);
      console.log('✅ PostGIS migration completed successfully.');
    } else {
      console.log('⚠️ PostGIS migration not found, skipping.');
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
    console.error('❌ Failed to connect to PostgreSQL:', err.message);
  });

module.exports = pool;

