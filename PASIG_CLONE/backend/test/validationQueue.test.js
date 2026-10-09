/**
 * Validation work queue — pure logic (no database).
 * Run: node --test test/validationQueue.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { categorizeMatch, issueType, issueField, suggestFacility, NEEDS_LOCATION, READY } = require('../services/validationQueue');

const existing = {
  case_no: 'CS-2025-000010', date_of_diagnosis: '2025-03-04', outcome_status: 'ON TREATMENT',
  date_of_outcome: null, date_started_treatment: '2025-03-10', treatment_facility: 'ROSARIO HEALTH CENTER - IDOTS',
};

describe('categorizeMatch', () => {
  it('same diagnosis date, nothing new → duplicate (suggest same case)', () => {
    const r = categorizeMatch({ ...existing, case_no: null }, existing);
    assert.strictEqual(r.category, 'duplicate');
    assert.strictEqual(r.suggestion, 'same_case');
    assert.deepStrictEqual(r.changes, []);
  });

  it('same diagnosis date, outcome changed → changed outcome, with the diff', () => {
    const r = categorizeMatch({ ...existing, outcome_status: 'CURED', date_of_outcome: '2025-09-01' }, existing);
    assert.strictEqual(r.category, 'changed_outcome');
    assert.deepStrictEqual(r.changes.map(c => c.field).sort(), ['date_of_outcome', 'outcome_status']);
    assert.strictEqual(r.changes.find(c => c.field === 'outcome_status').existing, 'ON TREATMENT');
  });

  it('same diagnosis date, other details changed → existing-case update', () => {
    const r = categorizeMatch({ ...existing, treatment_facility: 'NAPICO HEALTH CENTER - IDOTS' }, existing);
    assert.strictEqual(r.category, 'case_update');
  });

  it('blank incoming values never count as changes (same case keeps existing values)', () => {
    const r = categorizeMatch({ ...existing, outcome_status: null, treatment_facility: '' }, existing);
    assert.strictEqual(r.category, 'duplicate');
  });

  it('case/space-only differences are not changes', () => {
    const r = categorizeMatch({ ...existing, outcome_status: ' on treatment ' }, existing);
    assert.strictEqual(r.category, 'duplicate');
  });

  it('different diagnosis date → possible new episode', () => {
    const r = categorizeMatch({ ...existing, date_of_diagnosis: '2026-01-15' }, existing);
    assert.strictEqual(r.category, 'new_episode');
    assert.strictEqual(r.suggestion, 'new_episode');
  });

  it('compares dates by calendar day whether they are strings or Date objects', () => {
    const r = categorizeMatch({ ...existing, date_of_diagnosis: new Date(2025, 2, 4) }, existing);
    assert.notStrictEqual(r.category, 'new_episode');
  });

  it('missing existing case → suggest different person', () => {
    assert.strictEqual(categorizeMatch(existing, null).category, 'missing_candidate');
  });
});

describe('issue classification', () => {
  it('maps validator messages to Data Issues types', () => {
    assert.strictEqual(issueType('Last name is required'), 'missing_required');
    assert.strictEqual(issueType('Date of birth cannot be after the date of diagnosis'), 'invalid_date');
    assert.strictEqual(issueType('Invalid sex: "X"'), 'invalid_value');
    assert.strictEqual(issueType('Invalid age: "300"'), 'invalid_value');
  });
  it('points each message at the field to fix', () => {
    assert.strictEqual(issueField('First name is required'), 'first_name');
    assert.strictEqual(issueField('Date of Diagnosis is required'), 'date_of_diagnosis');
    assert.strictEqual(issueField('Invalid sex: "M/F"'), 'sex');
    assert.strictEqual(issueField('Date of birth cannot be after the date of diagnosis'), 'date_of_birth');
    // Case ID errors point at the fix form's Case ID field ("look like" must not read as "age")
    assert.strictEqual(issueField('Case ID must look like ROS-D-2025-00042 (got "NAP-D-2022-0232")'), 'source_case_id');
    assert.strictEqual(issueField('Case ID is required — it comes from the file\'s "Case ID" column'), 'source_case_id');
  });
});

describe('suggestFacility', () => {
  const registry = [
    { id: 1, name: 'Rosario HC' },
    { id: 2, name: 'Pinagbuhatan HC' },
    { id: 3, name: 'Pinagbuhatan Puericulture Center' },
    { id: 4, name: 'Santa Lucia HC' },
    { id: 5, name: 'Maybunga Floodway' },
  ];
  it('matches source names to the registry by distinctive words', () => {
    assert.strictEqual(suggestFacility('ROSARIO HEALTH CENTER - IDOTS', registry).id, 1);
    assert.strictEqual(suggestFacility('PINAGBUHATAN HEALTH CENTER - IDOTS', registry).id, 2);
    assert.strictEqual(suggestFacility('PINAGBUHATAN PUERICULTURE CENTER - IDOTS', registry).id, 3);
    assert.strictEqual(suggestFacility('STA. LUCIA HEALTH CENTER', registry).id, 4);
    assert.strictEqual(suggestFacility('MAYBUNGA FLOODWAY HEALTH CENTER - IDOTS', registry).id, 5);
  });
  it('suggests nothing for facilities that are not registered', () => {
    assert.strictEqual(suggestFacility('THE MEDICAL CITY-PASIG - MTBN', registry), null);
    assert.strictEqual(suggestFacility('', registry), null);
  });
});

describe('queue predicates', () => {
  it('location needs only cases without a decided Pasig location', () => {
    assert.ok(NEEDS_LOCATION.includes('location_resolution IS NULL'));
    assert.ok(NEEDS_LOCATION.includes('barangay_id IS NULL'));
  });
  it('ready excludes pending matches and both assignment kinds', () => {
    assert.ok(READY.includes("match_status <> 'pending'") && READY.includes('NOT'));
  });
});
