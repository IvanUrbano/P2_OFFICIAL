// How many months one risk level covers, from its assessment period. Must match
// BACKEND/tbinsight/riskWindow.js (a backend test checks).
export const RISK_WINDOW_MONTHS = 6;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Jan – Jun 2026' or 'Oct 2026 – Mar 2027' for the window starting at `period`; null if unknown. */
export function riskWindowLabel(period) {
  if (!period) return null;
  const d = new Date(`${String(period).slice(0, 10)}T00:00:00Z`);
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
