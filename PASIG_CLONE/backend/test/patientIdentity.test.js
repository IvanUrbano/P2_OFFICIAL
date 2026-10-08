// Patient # / Case ID rules. Run with: node --test test/patientIdentity.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeAge, identityKey, planIdentities, formatPatientNo, formatCaseNo, splitFullName,
} = require('../services/patientIdentity');
const { buildColumnMap } = require('../services/multiSheetParser');
const { formatRecord } = require('../services/webhookSender');

describe('IDs', () => {
  it('formats Patient # and Case ID (year of diagnosis)', () => {
    assert.equal(formatPatientNo(123), 'PT-000123');
    assert.equal(formatCaseNo(456, '2025-03-07'), 'CS-2025-000456');
  });
});

describe('computeAge', () => {
  it('counts completed years at diagnosis', () => {
    assert.equal(computeAge('1990-06-15', '2025-06-14'), 34);
    assert.equal(computeAge('1990-06-15', '2025-06-15'), 35);
  });
  it('returns null for missing dates or birth after diagnosis', () => {
    assert.equal(computeAge(null, '2025-01-01'), null);
    assert.equal(computeAge('2026-01-01', '2025-01-01'), null);
  });
});

describe('identityKey', () => {
  it('ignores case and extra spaces; needs last, first and date of birth', () => {
    assert.equal(identityKey({ last_name: ' Dela  Cruz', first_name: 'JUAN', date_of_birth: '1990-01-01' }),
      'dela cruz|juan|1990-01-01');
    assert.equal(identityKey({ last_name: 'Dela Cruz', first_name: 'Juan' }), null);
  });
});

describe('splitFullName', () => {
  it('only splits the "LAST, FIRST" style', () => {
    assert.deepEqual(splitFullName('REYES, JOSE'), { last_name: 'REYES', first_name: 'JOSE', middle_name: null });
    assert.equal(splitFullName('Jose Reyes'), null);
  });
});

describe('planIdentities', () => {
  const juan = { last_name: 'Dela Cruz', first_name: 'Juan', date_of_birth: '1990-01-01' };

  it('a new person becomes a new case', () => {
    assert.deepEqual(planIdentities([{ ...juan, date_of_diagnosis: '2025-01-05' }], []),
      [{ kind: 'new', matchedBy: null, conflict: false }]);
  });

  it('a person already in the system is held as a possible match, never merged', () => {
    const existing = [{ ...juan, case_no: 'CS-2024-000001', date_of_diagnosis: '2024-02-01' }];
    const [p] = planIdentities([{ ...juan, last_name: 'DELA CRUZ', date_of_diagnosis: '2025-01-05' }], existing);
    assert.equal(p.kind, 'pending');
    assert.deepEqual(p.candidate, { case_no: 'CS-2024-000001' });
    assert.equal(p.suggestion, 'new_episode', 'different diagnosis date suggests a new episode');
  });

  it('same diagnosis date suggests the same case', () => {
    const existing = [{ ...juan, case_no: 'CS-2025-000001', date_of_diagnosis: '2025-01-05' }];
    const [p] = planIdentities([{ ...juan, date_of_diagnosis: '2025-01-05' }], existing);
    assert.equal(p.suggestion, 'same_case');
  });

  it('matches against the most recent existing case', () => {
    const existing = [
      { ...juan, case_no: 'CS-2023-000001', date_of_diagnosis: '2023-01-01' },
      { ...juan, case_no: 'CS-2024-000009', date_of_diagnosis: '2024-06-01' },
    ];
    const [p] = planIdentities([{ ...juan, date_of_diagnosis: '2025-01-05' }], existing);
    assert.deepEqual(p.candidate, { case_no: 'CS-2024-000009' });
  });

  it('catches the same person listed twice in one file', () => {
    const plan = planIdentities([
      { ...juan, date_of_diagnosis: '2025-01-05' },
      { ...juan, date_of_diagnosis: '2025-01-05' },
    ], []);
    assert.equal(plan[0].kind, 'new');
    assert.equal(plan[1].kind, 'pending');
    assert.deepEqual(plan[1].candidate, { rowIndex: 0 });
  });

  it('different date of birth is a different person', () => {
    const existing = [{ ...juan, case_no: 'CS-2024-000001', date_of_diagnosis: '2024-02-01' }];
    const [p] = planIdentities([{ ...juan, date_of_birth: '1991-01-01', date_of_diagnosis: '2025-01-05' }], existing);
    assert.equal(p.kind, 'new');
  });

  it('a row whose Case ID points at a case joins THAT case, not one found by name', () => {
    const existing = [
      { ...juan, case_no: 'CS-2024-000001', date_of_diagnosis: '2024-02-01', source_case_id: 'ROS-D-2024-00001' },
      { case_no: 'CS-2025-000007', last_name: 'Santos', first_name: 'Ana', date_of_birth: '1988-05-04',
        date_of_diagnosis: '2025-01-05', source_case_id: 'ROS-D-2025-00042' },
    ];
    const [p] = planIdentities(
      [{ ...juan, date_of_diagnosis: '2024-02-01', source_case_id: 'ROS-D-2025-00042' }],
      existing
    );
    assert.equal(p.kind, 'pending');
    assert.equal(p.matchedBy, 'case_id');
    assert.deepEqual(p.candidate, { case_no: 'CS-2025-000007' });
    assert.equal(p.conflict, true, 'the Case ID belongs to a different patient');
  });

  it('a Case ID match on the same patient is compatible even when the date was corrected', () => {
    const existing = [{ ...juan, case_no: 'CS-2025-000007', date_of_diagnosis: '2025-01-05', source_case_id: 'ROS-D-2025-00042' }];
    const [p] = planIdentities([{ ...juan, date_of_diagnosis: '2025-02-11', source_case_id: 'ROS-D-2025-00042' }], existing);
    assert.equal(p.matchedBy, 'case_id');
    assert.equal(p.conflict, false);
  });

  it('a de-identified row joins its Case ID when the diagnosis date agrees', () => {
    const existing = [{ case_no: 'CS-2025-000007', date_of_diagnosis: '2025-01-05', source_case_id: 'ROS-D-2025-00042' }];
    const [p] = planIdentities([{ date_of_diagnosis: '2025-01-05', source_case_id: 'ROS-D-2025-00042' }], existing);
    assert.equal(p.matchedBy, 'case_id');
    assert.equal(p.conflict, false);
  });

  it('the same Case ID twice in one file: same patient merges, a different patient conflicts', () => {
    const rows = [
      { ...juan, date_of_diagnosis: '2025-01-05', source_case_id: 'ROS-D-2025-00042' },
      { ...juan, date_of_diagnosis: '2025-01-05', source_case_id: 'ROS-D-2025-00042' },
      { last_name: 'Santos', first_name: 'Ana', date_of_birth: '1988-05-04',
        date_of_diagnosis: '2025-01-05', source_case_id: 'ROS-D-2025-00042' },
    ];
    const plan = planIdentities(rows, []);
    assert.equal(plan[1].kind, 'pending');
    assert.equal(plan[1].matchedBy, 'case_id');
    assert.equal(plan[1].conflict, false, 'same patient, same date -> the later row is a report of the first');
    assert.equal(plan[2].kind, 'pending');
    assert.equal(plan[2].conflict, true, 'a different patient claiming the same Case ID is for a person to decide');
  });
});

describe('CSV headers', () => {
  it('maps name and date-of-birth columns', () => {
    const headers = ['Last Name', 'First Name', 'Middle Name', 'Suffix', 'Date of Birth', 'Date of Diagnosis', 'Age', 'Sex', 'Brgy'];
    const fields = Object.values(buildColumnMap(headers, 'DSTB'));
    for (const f of ['last_name', 'first_name', 'middle_name', 'suffix', 'date_of_birth', 'date_of_diagnosis', 'age']) {
      assert.ok(fields.includes(f), `missing ${f}`);
    }
  });
  it('maps a single patient-name column', () => {
    assert.equal(buildColumnMap(['Patient Name'], 'DSTB')[0], 'full_name');
  });
});

describe('privacy: payload to TBInsight', () => {
  it('carries the IDs but never names or date of birth', () => {
    const out = formatRecord({
      case_no: 'CS-2025-000001', patient_no: 'PT-000001', source_case_id: 'ROS-D-2025-00001', batch_id: '550e8400-e29b-41d4-a716-446655440000',
      last_name: 'Dela Cruz', first_name: 'Juan', middle_name: 'Santos', suffix: 'Jr.', date_of_birth: '1990-01-01',
      barangay_name: 'Ugong', age: 35,
    });
    assert.equal(out.case_no, 'CS-2025-000001');
    assert.equal(out.source_case_id, 'ROS-D-2025-00001', 'the Case ID users see');
    assert.equal('patient_no' in out, false, 'Patient # is no longer sent');
    assert.equal(out.age, 35);
    for (const k of ['last_name', 'first_name', 'middle_name', 'suffix', 'date_of_birth']) {
      assert.equal(k in out, false, `${k} must not be sent`);
    }
    assert.ok(!JSON.stringify(out).includes('Dela Cruz'));
  });
});
