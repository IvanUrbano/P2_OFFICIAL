/**
 * Returning (previously treated) patients and their TB episodes.
 *
 * A patient's episodes are the cases under one Patient # (patient_id): a relapse gets a
 * new Case ID under the same Patient # (services/patientIdentity.js). Most earlier
 * episodes happened before the registry was imported or at another facility, so a case
 * also counts as previously treated when its registration group says so (the DOH NTP
 * "previously treated" groups), even with no earlier episode on file.
 */

// Registration group -> plain label. The registry spells these several ways.
const HISTORY_GROUPS = [
  { label: 'Relapse', test: (g) => g.includes('RELAPSE') },
  { label: 'Treatment after failure', test: (g) => g === 'TAF' || g.includes('AFTER FAIL') },
  { label: 'Treatment after lost to follow-up', test: (g) => g === 'TALF' || g.includes('LOST TO F') },
  { label: 'Previous treatment outcome unknown', test: (g) => g === 'PTOU' || g.includes('OUTCOME UNKNOWN') },
];

function treatmentHistoryGroup(registrationGroup) {
  const g = String(registrationGroup ?? '').trim().toUpperCase();
  if (!g) return null;
  const hit = HISTORY_GROUPS.find(h => h.test(g));
  return hit ? hit.label : null;
}

// Other cases of the same patient that count as episodes: live, decided, not merged away.
const LIVE_EPISODE = (a) => `${a}.is_archived = false AND ${a}.merged_into_case_no IS NULL AND ${a}.match_status <> 'pending'`;

/** SQL condition: the case is registered as previously treated, or has an earlier episode on file. */
function previouslyTreatedSql(alias = 'v') {
  if (!/^[a-z_]+$/.test(alias)) throw new Error('previouslyTreatedSql: invalid alias');
  const g = `upper(btrim(${alias}.registration_group))`;
  return `(${g} LIKE '%RELAPSE%' OR ${g} IN ('TAF', 'TALF', 'PTOU')
    OR ${g} LIKE '%AFTER FAIL%' OR ${g} LIKE '%LOST TO F%' OR ${g} LIKE '%OUTCOME UNKNOWN%'
    OR EXISTS (SELECT 1 FROM validated_tb_cases o
                WHERE o.patient_id = ${alias}.patient_id AND o.id <> ${alias}.id
                  AND o.date_of_diagnosis < ${alias}.date_of_diagnosis AND ${LIVE_EPISODE('o')}))`;
}

function ymd(v) {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return v ? String(v).slice(0, 10) : null;
}

const caseIdOf = (r) => r.source_case_id || r.case_no || null;

/**
 * The patient's episodes for the record panel, newest first.
 * @param current  the case being viewed
 * @param rows     every live case of the same patient (the current one included)
 * @param canView  (row) => boolean — whether this user may open that case
 */
function summarizeEpisodes(current, rows, canView) {
  const all = rows.some(r => r.id === current.id) ? [...rows] : [current, ...rows];
  all.sort((a, b) => String(ymd(a.date_of_diagnosis) || '').localeCompare(String(ymd(b.date_of_diagnosis) || '')) || a.id - b.id);
  const numbered = all.map((r, i) => {
    const number = i + 1;
    const isCurrent = r.id === current.id;
    if (!isCurrent && !canView(r)) {
      const year = ymd(r.date_of_diagnosis);
      return {
        number, is_current: false, restricted: true, id: null, case_id: null,
        diagnosis_year: year ? Number(year.slice(0, 4)) : null,
        outcome_status: r.outcome_status || null, barangay_name: r.barangay_name || null,
      };
    }
    return {
      number, is_current: isCurrent, restricted: false, id: r.id, case_id: caseIdOf(r),
      date_of_diagnosis: ymd(r.date_of_diagnosis), registration_group: r.registration_group || null,
      anatomical_site: r.anatomical_site || null, bacteriological_status: r.bacteriological_status || null,
      outcome_status: r.outcome_status || null, date_of_outcome: ymd(r.date_of_outcome),
      barangay_name: r.barangay_name || null,
    };
  });
  const currentNumber = numbered.find(e => e.is_current)?.number ?? null;
  const previous = currentNumber > 1 ? numbered.find(e => e.number === currentNumber - 1) : null;
  return {
    total: numbered.length,
    current_number: currentNumber,
    registered_as: treatmentHistoryGroup((all.find(r => r.id === current.id) || current).registration_group),
    previous: previous || null,
    episodes: [...numbered].reverse(),
  };
}

async function getPatientEpisodes(db, record, canView) {
  if (!record.patient_id) return summarizeEpisodes(record, [record], canView);
  const rows = (await db.query(
    `SELECT id, patient_id, case_no, source_case_id, date_of_diagnosis, registration_group, anatomical_site,
            bacteriological_status, outcome_status, date_of_outcome, barangay_name, barangay_id,
            responsible_barangay, responsible_barangay_id, is_archived, merged_into_case_no, match_status
       FROM validated_tb_cases v
      WHERE v.patient_id = $1 AND (v.id = $2 OR (${LIVE_EPISODE('v')}))`,
    [record.patient_id, record.id]
  )).rows;
  return summarizeEpisodes(record, rows, canView);
}

const INSERT_HISTORY = `INSERT INTO case_history (validated_case_id, case_no, patient_id, batch_id, change_type,
  changed_fields, source, changed_by_user_id, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;

function describeEarlier(c) {
  const outcome = c.outcome_status ? `, ${c.outcome_status}${c.date_of_outcome ? ` ${ymd(c.date_of_outcome)}` : ''}` : '';
  return `${caseIdOf(c) || 'an earlier case'} (diagnosed ${ymd(c.date_of_diagnosis) || 'unknown date'}${outcome})`;
}

/**
 * Case History entries when a person confirms a new TB episode: one on the new case
 * ("new_episode") naming the latest earlier episode, one on every earlier episode
 * ("episode_linked") naming the new case. Runs inside the caller's transaction.
 */
async function recordNewEpisode(client, { newCase, earlierCases = [], userId = null, source = 'review' }) {
  const sorted = [...earlierCases].sort((a, b) => String(ymd(b.date_of_diagnosis) || '').localeCompare(String(ymd(a.date_of_diagnosis) || '')));
  const latest = sorted[0];
  const more = sorted.length > 1 ? ` ${sorted.length - 1} earlier episode${sorted.length > 2 ? 's' : ''} also on file.` : '';
  const noteNew = latest
    ? `Returning patient: new TB episode. Previous episode ${describeEarlier(latest)}.${more}`
    : 'Returning patient: new TB episode under the same Patient #.';
  await client.query(INSERT_HISTORY, [
    newCase.id, newCase.case_no || null, newCase.patient_id || null, newCase.batch_id || null, 'new_episode',
    latest ? JSON.stringify({ previous_case_no: latest.case_no || null }) : null, source, userId, noteNew,
  ]);
  for (const c of sorted) {
    await client.query(INSERT_HISTORY, [
      c.id, c.case_no || null, c.patient_id || null, c.batch_id || null, 'episode_linked',
      JSON.stringify({ new_case_no: newCase.case_no || null }), source, userId,
      `Patient started a new TB episode: ${caseIdOf(newCase) || 'new case'} (diagnosed ${ymd(newCase.date_of_diagnosis) || 'unknown date'}).`,
    ]);
  }
}

module.exports = {
  treatmentHistoryGroup, previouslyTreatedSql, summarizeEpisodes, getPatientEpisodes, recordNewEpisode, LIVE_EPISODE,
};
