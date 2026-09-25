#!/usr/bin/env node
/**
 * Cleanup script for Pasig Clone - Removes all imported batch data
 * Run: node cleanup_pasig_clone.js
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_kvc8PSp5FCjy@ep-delicate-surf-ay7m7t9k-pooler.c-5.us-east-2.aws.neon.tech/pasig_clone_db?sslmode=require&channel_binding=require'
});

async function cleanup() {
  const client = await pool.connect();
  try {
    console.log('🧹 Starting Pasig Clone data cleanup...\n');
    
    await client.query('BEGIN');
    
    console.log('Deleting webhook logs...');
    await client.query('DELETE FROM webhook_logs');
    
    console.log('Deleting validated case records...');
    await client.query('DELETE FROM validated_tb_cases');
    
    console.log('Deleting raw case records...');
    await client.query('DELETE FROM raw_tb_cases');
    
    console.log('Deleting import batches...');
    await client.query('DELETE FROM import_batches');
    
    console.log('\nResetting sequences...');
    await client.query('ALTER SEQUENCE IF EXISTS raw_tb_cases_id_seq RESTART WITH 1');
    await client.query('ALTER SEQUENCE IF EXISTS validated_tb_cases_id_seq RESTART WITH 1');
    await client.query('ALTER SEQUENCE IF EXISTS webhook_logs_id_seq RESTART WITH 1');
    
    await client.query('COMMIT');
    
    // Verify cleanup
    console.log('\n📊 Verification:');
    const result = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM import_batches)::int as import_batches_count,
        (SELECT COUNT(*) FROM raw_tb_cases)::int as raw_tb_cases_count,
        (SELECT COUNT(*) FROM validated_tb_cases)::int as validated_tb_cases_count,
        (SELECT COUNT(*) FROM webhook_logs)::int as webhook_logs_count
    `);
    
    console.log(result.rows[0]);
    console.log('\n✅ Pasig Clone database cleanup complete!\n');
    
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
