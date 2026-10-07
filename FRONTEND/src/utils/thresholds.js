// Risk band cut points — shared read-only presentation helpers.
//
// The Low/Moderate/High bands are data-derived model boundaries, recalibrated
// on every pipeline run and deliberately NOT official DOH epidemiological
// thresholds, so the source is always spelled out next to the numbers.

/**
 * Human-readable explanation of how a run's cut points were arrived at.
 * `percentiles` and `source` come from model_metadata.config
 * (`thresholdPercentiles` / `thresholdSource`).
 *
 * @param {string} source 'tertile_incidence' | 'tertile_features' | 'override' | 'default'
 * @param {{low_pct?: number, med_pct?: number}|null} percentiles
 * @returns {string|null} null when there is no source to report
 */
export function thresholdSourceNote(source, percentiles) {
  const pct = percentiles && Number.isFinite(Number(percentiles.med_pct))
    ? ` — ${Number(percentiles.low_pct).toFixed(1)} / ${Number(percentiles.med_pct).toFixed(1)} percentile split`
    : '';
  switch (source) {
    case 'tertile_incidence': return `Data-derived from this run's incidence distribution${pct}`;
    case 'tertile_features': return `Data-derived from this run's model features${pct} (ML service unavailable)`;
    case 'override': return 'Set manually for this run';
    case 'default': return 'No calibration basis — treat as unreliable';
    default: return null;
  }
}

/**
 * Cut points are incidence per 100k and arrive as long floats (387.4389…).
 * Displayed as whole numbers — the extra digits read as false accuracy.
 *
 * @param {number} v
 * @returns {string}
 */
export function fmtCut(v) {
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * The percent-of-population sentence shown beside any cut-point display.
 * Wording is shared so every page makes the same disclaimer.
 */
export const THRESHOLDS_DISCLAIMER =
  'Data-derived model boundaries for this assessment, not official DOH epidemiological thresholds.';
