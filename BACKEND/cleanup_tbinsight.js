#!/usr/bin/env node
/**
 * Cleanup script for TBInsight - Removes all imported case data
 * Run: node cleanup_tbinsight.js
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_kvc8PSp5FCjy@ep-delicate-surf-ay7m7t9k.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require'
});

async function cleanup() {
  const client = await pool.connect();
  try {
    console.log('🧹 Starting TBInsight data cleanup...\n');
    
    await client.query('BEGIN');
    
    console.log('Deleting alerts...');
    await client.query('DELETE FROM alerts');
    
    console.log('Deleting model predictions...');
    await client.query('DELETE FROM model_predictions');
    
    console.log('Deleting risk scores...');
    await client.query('DELETE FROM barangay_risk_scores');
    
    console.log('Deleting monthly summaries...');
    await client.query('DELETE FROM monthly_case_summary');
    
    console.log('Deleting case records...');
    await client.query('DELETE FROM tb_cases');
    
    console.log('Deleting raw case records...');
    await client.query('DELETE FROM tb_cases_raw');
    
    console.log('Deleting webhook logs...');
    await client.query('DELETE FROM webhook_logs');
    
    console.log('\nResetting sequences...');
    await client.query('ALTER SEQUENCE IF EXISTS tb_cases_raw_id_seq RESTART WITH 1');
    await client.query('ALTER SEQUENCE IF EXISTS tb_cases_id_seq RESTART WITH 1');
    await client.query('ALTER SEQUENCE IF EXISTS alerts_id_seq RESTART WITH 1');
    await client.query('ALTER SEQUENCE IF EXISTS model_predictions_id_seq RESTART WITH 1');
    
    await client.query('COMMIT');
    
    // Verify cleanup
    console.log('\n📊 Verification:');
    const result = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM tb_cases)::int as tb_cases_count,
        (SELECT COUNT(*) FROM tb_cases_raw)::int as tb_cases_raw_count,
        (SELECT COUNT(*) FROM monthly_case_summary)::int as monthly_summary_count,
        (SELECT COUNT(*) FROM model_predictions)::int as predictions_count,
        (SELECT COUNT(*) FROM barangay_risk_scores)::int as risk_scores_count,
        (SELECT COUNT(*) FROM alerts)::int as alerts_count,
        (SELECT COUNT(*) FROM webhook_logs)::int as webhook_logs_count
    `);
    
    console.log(result.rows[0]);
    console.log('\n✅ TBInsight database cleanup complete!\n');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Cleanup failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

cleanup();
