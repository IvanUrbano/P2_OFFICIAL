// Medication Schedule page helpers. The server decides every warning
// (backend/services/medicationSchedule.js); endDateFor / pickupCount here only preview
// the form before it is saved, using the same date rules.

export const LEVEL_STYLE = {
  ok: { label: 'On track', bg: 'rgba(16,185,129,0.1)', color: '#047857', dot: '#10B981' },
  warning1: { label: '1st warning', bg: 'rgba(245,158,11,0.14)', color: '#92400E', dot: '#F59E0B' },
  warning2: { label: '2nd warning', bg: 'rgba(245,158,11,0.14)', color: '#92400E', dot: '#F59E0B' },
  critical: { label: '3rd warning', bg: 'rgba(239,68,68,0.12)', color: '#991B1B', dot: '#EF4444' },
  none: { label: 'No schedule', bg: '#F1F5F9', color: '#64748B', dot: '#CBD5E1' },
};

export const PICKUP_STATE = {
  collected: { label: 'Collected', color: '#047857', bg: 'rgba(16,185,129,0.1)', icon: 'ri-checkbox-circle-fill' },
  missed: { label: 'Missed', color: '#991B1B', bg: 'rgba(239,68,68,0.1)', icon: 'ri-close-circle-fill' },
  overdue: { label: 'Missed (not collected)', color: '#991B1B', bg: 'rgba(239,68,68,0.1)', icon: 'ri-error-warning-fill' },
  late: { label: 'Late', color: '#92400E', bg: 'rgba(245,158,11,0.12)', icon: 'ri-time-line' },
  due: { label: 'Due today', color: '#1D4ED8', bg: 'rgba(59,130,246,0.1)', icon: 'ri-calendar-event-line' },
  upcoming: { label: 'Upcoming', color: '#64748B', bg: '#F1F5F9', icon: 'ri-calendar-line' },
};

export const INTERVAL_PRESETS = [
  { days: 7, label: 'Every week' },
  { days: 14, label: 'Every 2 weeks' },
  { days: 1, label: 'Every day' },
  { days: 3, label: 'Every 3 days' },
];

// Common TB medicines for the name dropdown; any other name can still be typed.
export const MEDICINE_SUGGESTIONS = [
  { name: 'HRZE (4FDC)', hint: 'Intensive phase — 4-drug fixed-dose combination' },
  { name: 'HR (2FDC)', hint: 'Continuation phase — 2-drug fixed-dose combination' },
  { name: 'Isoniazid (H)', hint: 'Single drug' },
  { name: 'Rifampicin (R)', hint: 'Single drug' },
  { name: 'Pyrazinamide (Z)', hint: 'Single drug' },
  { name: 'Ethambutol (E)', hint: 'Single drug' },
  { name: 'Pyridoxine (Vitamin B6)', hint: 'Given with isoniazid' },
];
export const MEDICINE_UNITS = ['tablets', 'capsules', 'sachets', 'vials', 'bottles', 'ml'];

const DAY_MS = 86400000;
const dayNumber = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const isoOf = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

export function endDateFor(start, value, unit) {
  const n = Number(value);
  if (!start || !Number.isInteger(n) || n < 1) return null;
  if (unit === 'days') return isoOf(dayNumber(start) + n - 1);
  if (unit === 'weeks') return isoOf(dayNumber(start) + n * 7 - 1);
  const d = new Date(`${start}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastOfMonth));
  return isoOf(dayNumber(d.toISOString().slice(0, 10)) - 1);
}

export function pickupCount(start, end, interval) {
  const step = Number(interval);
  if (!start || !end || !(step >= 1) || end < start) return 0;
  return Math.floor((dayNumber(end) - dayNumber(start)) / step) + 1;
}

/** Duration the form should show for a saved schedule (whole months/weeks when exact). */
export function durationOf(start, end) {
  for (let m = 1; m <= 24; m += 1) if (endDateFor(start, m, 'months') === end) return { value: m, unit: 'months' };
  const days = dayNumber(end) - dayNumber(start) + 1;
  return days % 7 === 0 ? { value: days / 7, unit: 'weeks' } : { value: days, unit: 'days' };
}

export function intervalLabel(days) {
  const preset = INTERVAL_PRESETS.find((p) => p.days === Number(days));
  return preset ? preset.label : `Every ${days} days`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const medicineLine = (m) => `${m.name} — ${m.quantity} ${m.unit}${m.instructions ? ` (${m.instructions})` : ''}`;
