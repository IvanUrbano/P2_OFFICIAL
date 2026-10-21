/**
 * Returning (previously treated) patients and their TB episodes.
 * Run: node --test test/episodes.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  treatmentHistoryGroup, previouslyTreatedSql, summarizeEpisodes, recordNewEpisode,
} = require('../services/episodes');

describe('treatmentHistoryGroup', () => {
  it('recognises the DOH previously-treated registration groups, in any spelling', () => {
    assert.strictEqual(treatmentHistoryGroup('RELAPSE'), 'Relapse');
    assert.strictEqual(treatmentHistoryGroup(' relapse '), 'Relapse');
    assert.strictEqual(treatmentHistoryGroup('TX AFTER LOST TO FF-UP'), 'Treatment after lost to follow-up');
    assert.strictEqual(treatmentHistoryGroup('TALF'), 'Treatment after lost to follow-up');
    assert.strictEqual(treatmentHistoryGroup('TX AFTER FAILURE'), 'Treatment after failure');
    assert.strictEqual(treatmentHistoryGroup('TAF'), 'Treatment after failure');
    assert.strictEqual(treatmentHistoryGroup('PREVIOUS TX OUTCOME UNKNOWN'), 'Previous treatment outcome unknown');
    assert.strictEqual(treatmentHistoryGroup('PTOU'), 'Previous treatment outcome unknown');
  });

  it('does not count new or unclassified patients', () => {
    for (const g of ['NEW', 'New', 'OTHER', '', null, undefined, 'TRANSFER IN']) {
      assert.strictEqual(treatmentHistoryGroup(g), null, String(g));
    }
  });
});

describe('previouslyTreatedSql', () => {
  const sql = previouslyTreatedSql('v');
  it('matches the registration group or an earlier episode of the same patient', () => {
    assert.match(sql, /upper\(btrim\(v\.registration_group\)\)/);
    assert.match(sql, /RELAPSE/);
    assert.match(sql, /EXISTS \(SELECT 1 FROM validated_tb_cases o/);
    assert.match(sql, /o\.patient_id = v\.patient_id/);
    assert.match(sql, /o\.date_of_diagnosis < v\.date_of_diagnosis/);
    assert.match(sql, /o\.is_archived = false/);
  });
  it('never interpolates anything but the alias', () => {
    assert.throws(() => previouslyTreatedSql('v; DROP TABLE x'), /alias/);
  });
});

describe('summarizeEpisodes', () => {
  const current = { id: 5, patient_id: 9, date_of_diagnosis: '2025-03-10' };
  const rows = [
    { id: 5, patient_id: 9, source_case_id: 'ROS-D-2025-00042', case_no: 'CS-2025-000005', date_of_diagnosis: '2025-03-10',
      registration_group: 'RELAPSE', anatomical_site: 'Pulmonary', bacteriological_status: 'Bacteriologically-confirmed TB',
      outcome_status: 'ON TREATMENT', date_of_outcome: null, barangay_name: 'Rosario' },
    { id: 2, patient_id: 9, source_case_id: 'ROS-D-2022-00310', case_no: 'CS-2022-000002', date_of_diagnosis: '2022-02-01',
      registration_group: 'NEW', anatomical_site: 'Pulmonary', bacteriological_status: null,
      outcome_status: 'CURED', date_of_outcome: '2023-08-15', barangay_name: 'Rosario' },
    { id: 3, patient_id: 9, source_case_id: 'MAN-D-2023-00001', case_no: 'CS-2023-000003', date_of_diagnosis: '2023-11-20',
      registration_group: 'NEW', anatomical_site: 'Pulmonary', bacteriological_status: null,
      outcome_status: 'LOST TO FOLLOW-UP', date_of_outcome: '2024-02-01', barangay_name: 'Manggahan' },
  ];

  it('lists every episode newest first, numbered from the first', () => {
    const s = summarizeEpisodes(current, rows, () => true);
    assert.deepStrictEqual(s.episodes.map(e => e.number), [3, 2, 1]);
    assert.deepStrictEqual(s.episodes.map(e => e.case_id), ['ROS-D-2025-00042', 'MAN-D-2023-00001', 'ROS-D-2022-00310']);
    assert.strictEqual(s.episodes[0].is_current, true);
    assert.strictEqual(s.total, 3);
    assert.strictEqual(s.current_number, 3);
  });

  it('describes the latest earlier episode and the registered history', () => {
    const s = summarizeEpisodes(current, rows, () => true);
    assert.strictEqual(s.previous.case_id, 'MAN-D-2023-00001');
    assert.strictEqual(s.previous.outcome_status, 'LOST TO FOLLOW-UP');
    assert.strictEqual(s.registered_as, 'Relapse');
  });

  it('hides the Case ID and link of an episode the user may not open, keeping year, outcome and barangay', () => {
    const s = summarizeEpisodes(current, rows, (r) => r.barangay_name === 'Rosario');
    const hidden = s.episodes.find(e => e.number === 2);
    assert.strictEqual(hidden.restricted, true);
    assert.strictEqual(hidden.id, null);
    assert.strictEqual(hidden.case_id, null);
    assert.strictEqual(hidden.diagnosis_year, 2023);
    assert.strictEqual(hidden.outcome_status, 'LOST TO FOLLOW-UP');
    assert.strictEqual(hidden.barangay_name, 'Manggahan');
    assert.ok(!('date_of_diagnosis' in hidden));
  });

  it('a patient registered as relapse with no earlier episode on file says so', () => {
    const s = summarizeEpisodes(current, [rows[0]], () => true);
    assert.strictEqual(s.total, 1);
    assert.strictEqual(s.previous, null);
    assert.strictEqual(s.registered_as, 'Relapse');
  });
});

describe('recordNewEpisode', () => {
  it('writes a history entry on the new case and on each earlier episode', async () => {
    const calls = [];
    const client = { query: async (sql, params) => { calls.push({ sql: String(sql).replace(/\s+/g, ' '), params }); return { rows: [] }; } };
    const newCase = { id: 5, case_no: 'CS-2025-000005', source_case_id: 'ROS-D-2025-00042', patient_id: 9, batch_id: null, date_of_diagnosis: '2025-03-10' };
    const earlier = [
      { id: 2, case_no: 'CS-2022-000002', source_case_id: 'ROS-D-2022-00310', patient_id: 9, batch_id: null,
        date_of_diagnosis: '2022-02-01', outcome_status: 'CURED', date_of_outcome: '2023-08-15' },
    ];
    await recordNewEpisode(client, { newCase, earlierCases: earlier, userId: 7, source: 'review' });
    const inserts = calls.filter(c => c.sql.startsWith('INSERT INTO case_history'));
    assert.strictEqual(inserts.length, 2);
    const onNew = inserts.find(c => c.params[0] === 5);
    const onOld = inserts.find(c => c.params[0] === 2);
    assert.strictEqual(onNew.params[4], 'new_episode');
    assert.match(onNew.params[8], /ROS-D-2022-00310/);
    assert.match(onNew.params[8], /CURED/);
    assert.strictEqual(onOld.params[4], 'episode_linked');
    assert.match(onOld.params[8], /ROS-D-2025-00042/);
    assert.strictEqual(onNew.params[6], 'review');
    assert.strictEqual(onNew.params[7], 7);
  });

  it('writes only the new-case entry when no earlier episode exists', async () => {
    const calls = [];
    const client = { query: async (sql, params) => { calls.push({ sql: String(sql), params }); return { rows: [] }; } };
    await recordNewEpisode(client, { newCase: { id: 5, patient_id: 9 }, earlierCases: [], userId: 1, source: 'manual' });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].params[4], 'new_episode');
  });
});

describe('resolveMatch -> new episode writes Case History', () => {
  const { resolveMatch } = require('../services/matchResolution');
  it('records the link on the new case and on the earlier episode', async () => {
    const calls = [];
    const earlier = { id: 2, case_no: 'CS-2022-000002', source_case_id: 'ROS-D-2022-00310', patient_id: 9, batch_id: null,
      date_of_diagnosis: '2022-02-01', outcome_status: 'CURED', date_of_outcome: '2023-08-15' };
    const client = {
      query: async (sql, params) => {
        const q = String(sql).replace(/\s+/g, ' ');
        calls.push({ q, params });
        if (q.includes('FOR UPDATE')) return { rows: [earlier] };
        if (q.includes("nextval('case_no_seq')")) return { rows: [{ n: 5 }] };
        if (q.startsWith('SELECT id, case_no, source_case_id')) return { rows: [earlier] };
        return { rows: [] };
      },
    };
    const row = { id: 5, match_status: 'pending', match_candidate_case_no: 'CS-2022-000002', source_case_id: 'ROS-D-2025-00042',
      date_of_diagnosis: '2025-03-10', batch_id: null };
    const out = await resolveMatch(client, row, 'new_episode', 7);
    assert.strictEqual(out.resolution, 'new_episode');
    const inserts = calls.filter(c => c.q.startsWith('INSERT INTO case_history'));
    assert.deepStrictEqual(inserts.map(c => [c.params[0], c.params[4]]), [[5, 'new_episode'], [2, 'episode_linked']]);
    assert.strictEqual(inserts[0].params[2], 9, 'new case history carries the shared Patient #');
  });

  it('does not write episode history for a different person', async () => {
    const calls = [];
    const client = { query: async (sql) => { const q = String(sql); calls.push(q);
      if (q.includes('patient_no_seq')) return { rows: [{ n: 1 }] };
      if (q.includes('INSERT INTO patients')) return { rows: [{ id: 50, patient_no: 'PT-000001' }] };
      if (q.includes('case_no_seq')) return { rows: [{ n: 6 }] };
      return { rows: [] }; } };
    await resolveMatch(client, { id: 6, match_status: 'pending', match_candidate_case_no: null, date_of_diagnosis: '2025-01-01' }, 'different_person', 1);
    assert.ok(!calls.some(q => q.includes('INSERT INTO case_history')));
  });
});
