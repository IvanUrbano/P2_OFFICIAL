// Patient name for display. The server de-identifies historical records until the
// user's Records PIN is unlocked; show that plainly when identity is unavailable.
export const DEIDENTIFIED = 'De-identified';

export function patientName(r, { short = false } = {}) {
  if (!r) return '—';
  if (r.identity_deidentified) return DEIDENTIFIED;
  if (!r.last_name && !r.first_name) return '—';
  if (short) return `${r.last_name || ''}, ${r.first_name || ''}`;
  return `${r.last_name || ''}, ${r.first_name || ''}${r.middle_name ? ` ${r.middle_name}` : ''}${r.suffix ? ` ${r.suffix}` : ''}`;
}
