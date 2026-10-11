/**
 * Medicine pickup schedules — the rules behind the Medication Schedule page.
 *
 * A patient on treatment collects medicine at the health center every `interval_days`
 * days, from start_date to end_date. Each pickup date is either recorded by a nurse
 * ('collected' / 'missed') or not recorded yet. A pickup counts as MISSED when it was
 * recorded missed, or when it is still not collected PICKUP_GRACE_DAYS after its date.
 *
 * Missed pickups add up over the whole schedule (they never reset — each one is about an
 * interval without medicine):
 *   0 missed -> 'ok'        green
 *   1        -> 'warning1'  yellow (1st warning)
 *   2        -> 'warning2'  yellow (2nd warning)
 *   3+       -> 'critical'  red    (3rd warning)
 *
 * Dates are 'YYYY-MM-DD' strings in Philippine time; arithmetic runs on whole UTC days.
 * missedSql() is the same count in SQL for the list (filter + sort over thousands of
 * cases); test/medicationSchedule.test.js keeps the two in step.
 */

const PICKUP_GRACE_DAYS = 2;
const MAX_DURATION_MONTHS = 24;
const MAX_BACKDATE_DAYS = 90;
const MAX_MEDICINES = 10;
const DURATION_UNITS = ['days', 'weeks', 'months'];
const LEVELS = ['ok', 'warning1', 'warning2', 'critical'];

const DAY_MS = 86400000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in the Philippines as 'YYYY-MM-DD'. */
function manilaToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const dayNumber = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const isoOf = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const addDays = (iso, n) => isoOf(dayNumber(iso) + n);

/** Last day of a schedule that starts on `start` and runs `value` days / weeks / months. */
function endDateFor(start, value, unit) {
  const n = Number(value);
  if (unit === 'days') return addDays(start, n - 1);
  if (unit === 'weeks') return addDays(start, n * 7 - 1);
  const d = new Date(`${start}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  // Oct 31 + 1 month -> Nov 30 (clamped), not Dec 1
  const lastOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastOfMonth));
  return addDays(d.toISOString().slice(0, 10), -1);
}

/** Every pickup date of a schedule, in order. */
function pickupDates(schedule) {
  const start = dayNumber(schedule.start_date);
  const end = dayNumber(schedule.end_date);
  const step = Number(schedule.interval_days);
  const dates = [];
  for (let d = start; d <= end; d += step) dates.push(isoOf(d));
  return dates;
}

const levelFor = (missed) => (missed <= 0 ? 'ok' : missed === 1 ? 'warning1' : missed === 2 ? 'warning2' : 'critical');

/**
 * Each pickup with its state, plus the totals.
 *   state: 'collected' | 'missed' (recorded) | 'overdue' (not recorded, past the grace
 *          period — counts as missed) | 'late' (not recorded, within the grace period) |
 *          'due' (today) | 'upcoming'
 * `pickups` are the recorded rows ({ due_date, status, collected_on, medicines }); rows
 * that are not on the schedule's dates (left over from an edit) are ignored.
 */
function summarize(schedule, pickups = [], today = manilaToday()) {
  const recorded = new Map(pickups.map((p) => [String(p.due_date).slice(0, 10), p]));
  const t = dayNumber(today);
  const list = pickupDates(schedule).map((date) => {
    const rec = recorded.get(date);
    const d = dayNumber(date);
    let state;
    if (rec) state = rec.status;
    else if (d + PICKUP_GRACE_DAYS < t) state = 'overdue';
    else if (d < t) state = 'late';
    else if (d === t) state = 'due';
    else state = 'upcoming';
    return {
      date,
      state,
      collected_on: rec?.collected_on ? String(rec.collected_on).slice(0, 10) : null,
      medicines: rec?.medicines || null,
      recorded_by: rec?.recorded_by ?? null,
      recorded_at: rec?.recorded_at ?? null,
    };
  });
  const collected = list.filter((p) => p.state === 'collected').length;
  const missed = list.filter((p) => p.state === 'missed' || p.state === 'overdue').length;
  const next = list.find((p) => ['late', 'due', 'upcoming'].includes(p.state)) || null;
  return {
    pickups: list,
    total: list.length,
    collected,
    missed,
    level: levelFor(missed),
    next_pickup: next ? next.date : null,
    next_state: next ? next.state : null,
    // Expected at the center now: a pickup due today, or a late one still in its grace period.
    due_now: list.some((p) => p.state === 'due' || p.state === 'late'),
    finished: dayNumber(schedule.end_date) < t && !next,
  };
}

/** SQL condition for summarize().due_now: an unrecorded pickup dated today - grace .. today. */
function dueNowSql(s = 's', today = 'CURRENT_DATE') {
  return `EXISTS (SELECT 1 FROM generate_series(0, ${PICKUP_GRACE_DAYS}) g
    WHERE ${today} - g BETWEEN ${s}.start_date AND ${s}.end_date
      AND (${today} - g - ${s}.start_date) % ${s}.interval_days = 0
      AND NOT EXISTS (SELECT 1 FROM medication_pickups mp WHERE mp.schedule_id = ${s}.id AND mp.due_date = ${today} - g))`;
}

/**
 * The missed count as a SQL expression, for schedule alias `s` and a `today` date
 * expression — the same rule as summarize():
 *   pickups whose grace period has passed (date <= today - grace - 1), minus those
 *   collected, plus later ones already recorded missed.
 */
function missedSql(s = 's', today = 'CURRENT_DATE') {
  const cutoff = `LEAST(${s}.end_date, ${today} - ${PICKUP_GRACE_DAYS + 1})`;
  const onSchedule = (col) => `(${col} - ${s}.start_date) % ${s}.interval_days = 0`;
  return `(
    CASE WHEN ${cutoff} >= ${s}.start_date THEN (${cutoff} - ${s}.start_date) / ${s}.interval_days + 1 ELSE 0 END
    - (SELECT COUNT(*) FROM medication_pickups mp WHERE mp.schedule_id = ${s}.id AND mp.status = 'collected'
        AND mp.due_date BETWEEN ${s}.start_date AND ${cutoff} AND ${onSchedule('mp.due_date')})
    + (SELECT COUNT(*) FROM medication_pickups mp WHERE mp.schedule_id = ${s}.id AND mp.status = 'missed'
        AND mp.due_date > ${cutoff} AND mp.due_date <= ${s}.end_date AND ${onSchedule('mp.due_date')})
  )::int`;
}

/** SQL condition for a warning level over a missed-count expression. */
function levelSql(level, missed) {
  switch (level) {
    case 'ok': return `${missed} = 0`;
    case 'warning1': return `${missed} = 1`;
    case 'warning2': return `${missed} = 2`;
    case 'warning': return `${missed} BETWEEN 1 AND 2`;
    case 'critical': return `${missed} >= 3`;
    default: return null;
  }
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

/** [{ name, quantity, unit, instructions }] from the form, or an error message. */
function normalizeMedicines(input) {
  if (!Array.isArray(input) || input.length === 0) return { error: 'Add at least one medicine to give at each pickup.' };
  if (input.length > MAX_MEDICINES) return { error: `Up to ${MAX_MEDICINES} medicines per schedule.` };
  const medicines = [];
  for (const [i, m] of input.entries()) {
    const name = clean(m?.name, 80);
    const quantity = Number(m?.quantity);
    if (!name) return { error: `Medicine ${i + 1}: enter the medicine name.` };
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10000) {
      return { error: `${name}: enter the amount given per pickup (a number above 0).` };
    }
    medicines.push({ name, quantity, unit: clean(m?.unit, 20) || 'tablets', instructions: clean(m?.instructions, 200) });
  }
  return { medicines };
}

/**
 * Validates the schedule form. Returns { value } ready to store, or { error }.
 * Body: { start_date, interval_days, duration_value, duration_unit, medicines, notes }.
 */
function validateScheduleInput(body = {}, today = manilaToday()) {
  const interval = Number(body.interval_days);
  if (!Number.isInteger(interval) || interval < 1 || interval > 60) {
    return { error: 'Pickup interval must be a whole number of days from 1 to 60.' };
  }
  if (!isIsoDate(body.start_date)) return { error: 'Enter a valid first pickup date.' };
  if (dayNumber(body.start_date) < dayNumber(today) - MAX_BACKDATE_DAYS) {
    return { error: `The first pickup cannot be more than ${MAX_BACKDATE_DAYS} days ago.` };
  }
  const unit = body.duration_unit;
  const value = Number(body.duration_value);
  if (!DURATION_UNITS.includes(unit) || !Number.isInteger(value) || value < 1) {
    return { error: 'Enter how long the treatment runs (a whole number of days, weeks or months).' };
  }
  const end = endDateFor(body.start_date, value, unit);
  if (end > endDateFor(body.start_date, MAX_DURATION_MONTHS, 'months')) {
    return { error: `A schedule can run at most ${MAX_DURATION_MONTHS} months.` };
  }
  if (dayNumber(end) - dayNumber(body.start_date) + 1 < interval) {
    return { error: 'The treatment is shorter than one pickup interval.' };
  }
  const meds = normalizeMedicines(body.medicines);
  if (meds.error) return { error: meds.error };
  return {
    value: {
      start_date: body.start_date,
      end_date: end,
      duration_value: value,
      duration_unit: unit,
      interval_days: interval,
      medicines: meds.medicines,
      notes: clean(body.notes, 500) || null,
    },
  };
}

const START_MODES = ['same', 'treatment_start'];

/**
 * One patient's dates in a bulk assignment.
 *   'same'            every patient gets the form's first pickup and end date.
 *   'treatment_start' pickups keep the rhythm of the patient's own treatment start: the first
 *                     one is the next pickup date on or after today, and the treatment runs
 *                     the form's duration from the treatment start. A patient without a
 *                     treatment start date falls back to 'same'.
 * Returns { start_date, end_date } or { skip } with the reason.
 */
function planForCase(value, mode, record, today = manilaToday()) {
  const ts = record?.date_started_treatment ? String(record.date_started_treatment).slice(0, 10) : null;
  if (mode !== 'treatment_start' || !isIsoDate(ts)) return { start_date: value.start_date, end_date: value.end_date };
  const end = endDateFor(ts, value.duration_value, value.duration_unit);
  const step = value.interval_days;
  const behind = dayNumber(today) - dayNumber(ts);
  const first = behind <= 0 ? ts : addDays(ts, Math.ceil(behind / step) * step);
  if (first > end) return { skip: 'treatment period already over' };
  return { start_date: first, end_date: end };
}

module.exports = {
  START_MODES, planForCase,
  PICKUP_GRACE_DAYS, MAX_BACKDATE_DAYS, LEVELS, DURATION_UNITS,
  manilaToday, isIsoDate, addDays, endDateFor, pickupDates, levelFor, summarize,
  missedSql, dueNowSql, levelSql, normalizeMedicines, validateScheduleInput,
};
