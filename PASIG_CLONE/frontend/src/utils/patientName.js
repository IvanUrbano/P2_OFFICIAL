// Patient name for display. Historical records are de-identified by the server
// (names/DOB never sent — identity_deidentified: true); show that plainly.
export const DEIDENTIFIED = 'De-identified';

export function patientName(r, { short = false } = {}) {
  if (!r) return '—';
  if (r.identity_deidentified) return DEIDENTIFIED;
  if (!r.last_name && !r.first_name) return '—';
  if (short) return `${r.last_name || ''}, ${r.first_name || ''}`;
  return `${r.last_name || ''}, ${r.first_name || ''}${r.middle_name ? ` ${r.middle_name}` : ''}${r.suffix ? ` ${r.suffix}` : ''}`;
}
