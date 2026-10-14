/**
 * How many months one risk level covers, starting at its assessment period.
 * The RF labels average this many months (pipeline.js LABEL_HORIZON_MONTHS);
 * must match RF_LABEL_HORIZON_MONTHS in ML_SERVICE/config.py and
 * RISK_WINDOW_MONTHS in FRONTEND/src/utils/riskWindow.js (tests check both).
 */
const RISK_WINDOW_MONTHS = 6;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Jan – Jun 2026' or 'Oct 2026 – Mar 2027' for the window starting at `period`; null if unknown. */
function riskWindowLabel(period) {
  if (!period) return null;
  const d = period instanceof Date ? period : new Date(`${String(period).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const endIndex = m + RISK_WINDOW_MONTHS - 1;
  const endY = y + Math.floor(endIndex / 12);
  const endM = endIndex % 12;
  return endY === y
    ? `${MONTHS[m]} – ${MONTHS[endM]} ${y}`
    : `${MONTHS[m]} ${y} – ${MONTHS[endM]} ${endY}`;
}

module.exports = { RISK_WINDOW_MONTHS, riskWindowLabel };
