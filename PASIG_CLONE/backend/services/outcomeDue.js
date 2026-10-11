/**
 * Outcome due: patients still ON TREATMENT longer than a standard TB treatment.
 *
 * A case is due when its status is ON TREATMENT and its treatment started (or, without a
 * start date, it was diagnosed) at least OUTCOME_DUE_MONTHS ago. Nothing is changed on the
 * case — only a health worker can record the outcome (Cured needs a test result, some
 * patients need longer treatment). The system reminds:
 *   - the Medication Schedule page lists them ("Outcome due" tab);
 *   - once a week each recipient gets ONE summary notification (bell): barangay staff for
 *     the patients their barangay handles, admins for the whole city.
 * Messages carry counts and barangay names only, never patient identity.
 */
const db = require('../db/pasigSchema');
const notifications = require('./notifications');
const { NEEDS_LOCATION } = require('./validationQueue');

const OUTCOME_DUE_MONTHS = 6;
const REMIND_EVERY_DAYS = 7;
const NOTIFICATION_TYPE = 'outcome_due';
const LINK = '/medication?tab=outcome';
const TODAY = `(NOW() AT TIME ZONE 'Asia/Manila')::date`;

/** SQL condition (alias v) for an outcome-due case, given a `today` date expression. */
function outcomeDueSql(alias = 'v', today = TODAY) {
  const p = alias ? `${alias}.` : '';
  return `(${p}case_status = 'ON TREATMENT'
    AND COALESCE(${p}date_started_treatment, ${p}date_of_diagnosis) <= ${today} - INTERVAL '${OUTCOME_DUE_MONTHS} months')`;
}

// Same live-case rule as the Medication Schedule list (routes/medication.js ON_TREATMENT).
const LIVE = `v.is_archived = false AND v.match_status <> 'pending' AND v.merged_into_case_no IS NULL AND NOT ${NEEDS_LOCATION}`;

/** Users who already got an outcome-due reminder in the last REMIND_EVERY_DAYS days. */
async function recentlyReminded(userIds) {
  if (userIds.length === 0) return new Set();
  const r = await db.pool.query(
    `SELECT DISTINCT user_id FROM notifications
     WHERE type = $1 AND user_id = ANY($2::int[]) AND created_at > NOW() - INTERVAL '${REMIND_EVERY_DAYS} days'`,
    [NOTIFICATION_TYPE, userIds]
  );
  return new Set(r.rows.map(x => Number(x.user_id)));
}

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Send this week's reminders. Safe to call often: anyone reminded in the last
 * REMIND_EVERY_DAYS days is skipped. Returns { due, sent }.
 */
async function remindOutcomeDue() {
  const { rows } = await db.pool.query(
    `SELECT COALESCE(v.responsible_barangay_id, v.barangay_id) AS barangay_id,
            COALESCE(NULLIF(v.responsible_barangay, ''), v.barangay_name) AS barangay_name,
            COUNT(*)::int AS n
     FROM validated_tb_cases v
     WHERE ${LIVE} AND ${outcomeDueSql('v')}
     GROUP BY 1, 2 ORDER BY 3 DESC`
  );
  const due = rows.reduce((t, r) => t + r.n, 0);
  if (due === 0) return { due: 0, sent: 0 };

  let sent = 0;
  const send = async (userIds, n) => {
    const skip = await recentlyReminded(userIds);
    const ids = userIds.filter(id => !skip.has(Number(id)));
    if (ids.length) sent += await notifications.notify(ids, n);
  };

  // Barangay staff: the patients their barangay handles.
  for (const r of rows) {
    if (r.barangay_id == null) continue;
    const staff = await notifications.barangayStaff(r.barangay_id);
    await send(staff, {
      type: NOTIFICATION_TYPE,
      severity: 'warning',
      title: `${plural(r.n, 'patient', 'patients')} on treatment over ${OUTCOME_DUE_MONTHS} months`,
      message: `${plural(r.n, 'patient', 'patients')} in ${r.barangay_name} ${r.n === 1 ? 'has' : 'have'} been on treatment for more than ${OUTCOME_DUE_MONTHS} months without a recorded outcome. Record the outcome in TB Records.`,
      link: LINK,
    });
  }

  // Admins: the whole city in one summary.
  const top = rows.filter(r => r.barangay_name).slice(0, 3).map(r => `${r.barangay_name} (${r.n})`).join(', ');
  await send(await notifications.admins(), {
    type: NOTIFICATION_TYPE,
    severity: 'warning',
    title: `${plural(due, 'patient', 'patients')} on treatment over ${OUTCOME_DUE_MONTHS} months`,
    message: `${plural(due, 'patient', 'patients')} city-wide ${due === 1 ? 'has' : 'have'} been on treatment for more than ${OUTCOME_DUE_MONTHS} months without a recorded outcome${top ? ` — most in ${top}` : ''}. Record the outcomes in TB Records.`,
    link: LINK,
  });
  return { due, sent };
}

let timer = null;

/** Check shortly after start-up, then every 6 hours (each person is reminded at most weekly). */
function startOutcomeDueReminders() {
  const run = () => remindOutcomeDue()
    .then(r => { if (r.sent) console.log(`🔔 Outcome due: ${r.due} patients, ${r.sent} reminder(s) sent.`); })
    .catch(err => console.error('Outcome-due reminder failed:', err.message));
  setTimeout(run, 60 * 1000).unref();
  timer = setInterval(run, 6 * 60 * 60 * 1000);
  timer.unref();
}

module.exports = { OUTCOME_DUE_MONTHS, REMIND_EVERY_DAYS, NOTIFICATION_TYPE, outcomeDueSql, remindOutcomeDue, startOutcomeDueReminders };
