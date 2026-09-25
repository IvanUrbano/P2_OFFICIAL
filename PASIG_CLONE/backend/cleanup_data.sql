-- ==========================================
-- Pasig Clone Data Cleanup Script
-- Removes all imported case data and batches
-- Safe to run - only deletes data, preserves schema
-- ==========================================

-- Stop any active queries on these tables
SET statement_timeout = 0;

BEGIN;

-- Delete imported case data (in order of dependencies)
-- webhook_logs references import_batches, so delete it first
DELETE FROM webhook_logs;

-- validated_tb_cases and raw_tb_cases reference import_batches
DELETE FROM validated_tb_cases;
DELETE FROM raw_tb_cases;

-- Finally delete the batch records
DELETE FROM import_batches;

-- Reset sequences for cleaner IDs on next import
ALTER SEQUENCE IF EXISTS raw_tb_cases_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS validated_tb_cases_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS webhook_logs_id_seq RESTART WITH 1;

COMMIT;

-- Verify cleanup
SELECT 
  (SELECT COUNT(*) FROM import_batches) as import_batches_count,
  (SELECT COUNT(*) FROM raw_tb_cases) as raw_tb_cases_count,
  (SELECT COUNT(*) FROM validated_tb_cases) as validated_tb_cases_count,
  (SELECT COUNT(*) FROM webhook_logs) as webhook_logs_count;

-- Expected output: all should be 0

VACUUM ANALYZE;

SELECT '✅ Pasig Clone data cleanup complete. All imported batches and case data removed.' as status;
