-- ============================================================
-- Forecast method/tier tracking + per-model (RF vs ARIMA) run status
-- ============================================================
--
-- 1. model_predictions.method — records which forecasting method actually
--    produced each barangay's forecast row: 'arima' (real ARIMA, 24+ months
--    of history), a fallback method name such as 'exponential_smoothing' /
--    'seasonal_naive' / 'seasonal-naive-fallback' (10-23 months, or the ML
--    service unreachable — always labeled "Baseline Forecast" in the UI,
--    never "ARIMA"), or 'insufficient_data' (< 10 months — no forecast is
--    produced at all). Previously this was only knowable in aggregate, at
--    the whole-pipeline-run level (model_metadata.metrics.forecastMethods),
--    so a caller could not tell which specific barangay used a fallback.
--
-- 2. model_metadata gets separate rf_status/arima_status (+ their own
--    timestamps), so a run where one model succeeded and the other failed
--    or fell back is no longer indistinguishable from a fully healthy run
--    in the persisted "latest run" record.

ALTER TABLE model_predictions ADD COLUMN IF NOT EXISTS method TEXT;

ALTER TABLE model_metadata ADD COLUMN IF NOT EXISTS rf_status TEXT;
ALTER TABLE model_metadata ADD COLUMN IF NOT EXISTS rf_updated_at TIMESTAMPTZ;
ALTER TABLE model_metadata ADD COLUMN IF NOT EXISTS arima_status TEXT;
ALTER TABLE model_metadata ADD COLUMN IF NOT EXISTS arima_updated_at TIMESTAMPTZ;
