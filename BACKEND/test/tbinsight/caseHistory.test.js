/**
 * Case History helpers — the diff that preserves a case's previous values.
 *
 * The contract these tests pin down: a re-sent Case ID updates the existing row
 * in place, and whatever it used to say is written to case_history verbatim.
 * Nothing is inferred, nothing is derived from dates, and patient identity is
 * never part of the key.
 *
 * Run: node --test BACKEND/test/tbinsight/caseHistory.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  HISTORY_FIELDS, diffCaseFields, classifyChange, insertCaseHistory,
} = require('../../tbinsight/caseHistory');

const stored = (overrides = {}) => ({
  id: 42,
  case_no: 'CS-2025-000042',
  patient_no: 'PT-000009',
  barangay_id: 11,
  barangay_name: 'San Antonio',
  residence_barangay_name: null,
  residence_city: null,
  location_classification: 'Pasig City',
  outcome_status: 'ON TREATMENT',
  source_outcome_status: 'ON TREATMENT',
  date_of_outcome: null,
  date_started_treatment: '2025-03-01',
  treatment_facility: 'Rizal Medical Center',
  source_case_id: 'ROS-D-2025-00042',
  ...overrides,
});

describe('case history — diffing a same-case update', () => {
  it('tracks exactly the fields the upsert writes, and nothing about the patient', () => {
    assert.ok(HISTORY_FIELDS.includes('outcome_status'));
    assert.ok(HISTORY_FIELDS.includes('date_of_outcome'));
    // patient_no / date_of_diagnosis are identity and diagnosis facts, not
    // longitudinal treatment fields — and history is keyed by Case ID, never by
    // the patient, so a later episode of the same person stays a separate case.
    assert.ok(!HISTORY_FIELDS.includes('patient_no'));
    assert.ok(!HISTORY_FIELDS.includes('case_no'));
    assert.ok(!HISTORY_FIELDS.includes('date_of_diagnosis'));
    assert.ok(!HISTORY_FIELDS.includes('age'));
  });

  it('reports no change when the resend says the same thing', () => {
    assert.equal(diffCaseFields(stored(), stored()), null);
  });

  it('treats null and empty string as the same absence of a value', () => {
    assert.equal(diffCaseFields(
      stored({ treatment_facility: null }),
      stored({ treatment_facility: '' })
    ), null);
  });

  it('compares dates as the text the sender sent (no timezone drift)', () => {
    // pg returns `date::text` as 'YYYY-MM-DD'; the payload carries the same shape.
    assert.equal(diffCaseFields(
      stored({ date_of_outcome: '2025-06-10' }),
      stored({ date_of_outcome: '2025-06-10' })
    ), null);
    const diff = diffCaseFields(
      stored({ date_of_outcome: null }),
      stored({ date_of_outcome: '2025-06-10' })
    );
    assert.deepStrictEqual(diff.date_of_outcome, { old: null, new: '2025-06-10' });
  });

  it('preserves the previous outcome verbatim: ON TREATMENT → CURED', () => {
    const diff = diffCaseFields(stored(), stored({ outcome_status: 'CURED', source_outcome_status: 'CURED' }));
    assert.deepStrictEqual(diff, {
      outcome_status: { old: 'ON TREATMENT', new: 'CURED' },
      source_outcome_status: { old: 'ON TREATMENT', new: 'CURED' },
    });
    assert.equal(classifyChange(diff), 'status_changed');
  });

  it('classifies a non-outcome correction as a plain update', () => {
    const diff = diffCaseFields(stored(), stored({ treatment_facility: 'Pasig City Hospital' }));
    assert.deepStrictEqual(diff, {
      treatment_facility: { old: 'Rizal Medical Center', new: 'Pasig City Hospital' },
    });
    assert.equal(classifyChange(diff), 'updated');
  });

  it('classifies nothing when there is nothing to record', () => {
    assert.equal(classifyChange(null), null);
  });
});

describe('case history — writing entries', () => {
  it('inserts every entry in one statement with the previous values as JSONB', async () => {
    let captured;
    const client = {
      query: async (sql, params) => { captured = { sql, params }; return { rows: [] }; },
    };
    const written = await insertCaseHistory(client, [
      {
        tbCaseId: 42, caseNo: 'CS-2025-000042', patientNo: 'PT-000009',
        batchId: '550e8400-e29b-41d4-a716-446655440000',
        changeType: 'status_changed',
        changedFields: { outcome_status: { old: 'ON TREATMENT', new: 'CURED' } },
        source: 'webhook', changedByLabel: 'ana.cruz',
      },
      {
        tbCaseId: 43, caseNo: 'CS-2025-000043', patientNo: 'PT-000010',
        batchId: '550e8400-e29b-41d4-a716-446655440000',
        changeType: 'created', changedFields: null, source: 'webhook', changedByLabel: null,
      },
    ]);

    assert.equal(written, 2);
    assert.ok(captured.sql.includes('INSERT INTO case_history'));
    assert.ok(captured.sql.includes('VALUES'), 'one multi-row insert, not one query per case');
    // 9 bound parameters per entry: case, case_no, patient, batch, type, fields, source, user id, label
    assert.equal(captured.params.length, 18);
    assert.equal(captured.params[0], 42);
    assert.equal(captured.params[4], 'status_changed');
    assert.deepStrictEqual(JSON.parse(captured.params[5]), {
      outcome_status: { old: 'ON TREATMENT', new: 'CURED' },
    });
    assert.equal(captured.params[6], 'webhook');
    assert.equal(captured.params[7], null, 'a synced update has no TBInsight user behind it');
    assert.equal(captured.params[8], 'ana.cruz', 'the source system reported who asked for it');
    assert.equal(captured.params[13], 'created');
    assert.equal(captured.params[14], null, 'created rows record no field changes');
  });

  it('does not write anything when no case actually changed', async () => {
    let ran = false;
    const client = { query: async () => { ran = true; return { rows: [] }; } };
    assert.equal(await insertCaseHistory(client, []), 0);
    assert.equal(await insertCaseHistory(client, null), 0);
    assert.equal(ran, false);
  });

  it('never binds a malformed batch id as a UUID', async () => {
    let captured;
    const client = { query: async (sql, params) => { captured = { sql, params }; return { rows: [] }; } };
    await insertCaseHistory(client, [{
      tbCaseId: 1, caseNo: 'X', changeType: 'updated', batchId: 'not-a-uuid', source: 'webhook',
    }]);
    assert.equal(captured.params[3], null);
  });
});
