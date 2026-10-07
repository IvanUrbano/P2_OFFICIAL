// GIS Year selects the RF snapshot trained on that data year. A current
// assessment may also be selected by its assessment year when no data-year
// snapshot exists yet. The stored period is the prediction period.
const gisSnapshotPeriodSql = `COALESCE(
  (SELECT (mm.config->>'period')::date FROM model_metadata mm
   WHERE mm.run_type IN ('pipeline_historical', 'pipeline')
     AND COALESCE((mm.metrics->>'data_year')::integer,
                  EXTRACT(YEAR FROM (mm.metrics->>'dataEnd')::date)::integer) = $1
     AND EXISTS (SELECT 1 FROM barangay_risk_scores brs
                 WHERE brs.period = (mm.config->>'period')::date)
   ORDER BY mm.trained_at DESC LIMIT 1),
  (SELECT (mm.config->>'period')::date FROM model_metadata mm
   WHERE mm.run_type = 'pipeline'
     AND EXTRACT(YEAR FROM (mm.config->>'period')::date) = $1
     AND EXISTS (SELECT 1 FROM barangay_risk_scores brs
                 WHERE brs.period = (mm.config->>'period')::date)
   ORDER BY mm.trained_at DESC LIMIT 1)
)`;

module.exports = { gisSnapshotPeriodSql };
