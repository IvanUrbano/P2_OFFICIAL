-- ==========================================
-- TBInsight Data Cleanup Script
-- Removes all imported case data and results
-- Safe to run - only deletes data, preserves schema
-- ==========================================

-- Stop any active queries on these tables
SET statement_timeout = 0;

BEGIN;

-- Delete imported case data (in order of dependencies)
DELETE FROM alerts;
DELETE FROM model_predictions;
DELETE FROM barangay_risk_scores;
DELETE FROM monthly_case_summary;
DELETE FROM tb_cases;
DELETE FROM tb_cases_raw;

-- Delete webhook sync history
DELETE FROM webhook_logs;

-- Reset sequences for ID fields (optional, for cleaner IDs)
ALTER SEQUENCE IF EXISTS tb_cases_raw_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS tb_cases_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS alerts_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS model_predictions_id_seq RESTART WITH 1;

COMMIT;

-- Verify cleanup
SELECT 
  (SELECT COUNT(*) FROM tb_cases) as tb_cases_count,
  (SELECT COUNT(*) FROM tb_cases_raw) as tb_cases_raw_count,
  (SELECT COUNT(*) FROM monthly_case_summary) as monthly_summary_count,
  (SELECT COUNT(*) FROM model_predictions) as predictions_count,
  (SELECT COUNT(*) FROM barangay_risk_scores) as risk_scores_count,
  (SELECT COUNT(*) FROM alerts) as alerts_count,
  (SELECT COUNT(*) FROM webhook_logs) as webhook_logs_count;

-- Expected output: all should be 0

VACUUM ANALYZE;

SELECT '✅ TBInsight data cleanup complete. All imported data removed.' as status;
