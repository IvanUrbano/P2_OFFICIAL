const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  CASE_STATUSES, APPROVED_OUTCOMES, SUCCESS_OUTCOMES,
  normalizeOutcome, normalizeDisplayOutcome, splitTreatmentState,
  getOutcomeFilterValues, foldOutcomeCounts,
} = require('../../tbinsight/outcomeNormalization');

describe('case status and treatment outcome contract', () => {
  it('has two current statuses and seven final outcomes', () => {
    assert.deepEqual(CASE_STATUSES, ['DIAGNOSED', 'ON TREATMENT']);
    assert.deepEqual(APPROVED_OUTCOMES, [
      'CURED', 'TREATMENT COMPLETED', 'TREATMENT FAILED',
      'LOST TO FOLLOW-UP', 'DIED', 'NOT EVALUATED', 'EXCLUDED',
    ]);
    assert.ok(!APPROVED_OUTCOMES.includes('ON TREATMENT'));
    assert.deepEqual(SUCCESS_OUTCOMES, ['CURED', 'TREATMENT COMPLETED']);
  });

  it('keeps current statuses out of treatment outcomes', () => {
    assert.deepEqual(splitTreatmentState(' diagnosed '), { case_status: 'DIAGNOSED', treatment_outcome: null });
    assert.deepEqual(splitTreatmentState('on tx'), { case_status: 'ON TREATMENT', treatment_outcome: null });
    assert.equal(normalizeDisplayOutcome('ON TREATMENT'), null);
  });

  it('normalizes historical final outcome spellings', () => {
    assert.equal(normalizeOutcome('FAILED'), 'TREATMENT FAILED');
    assert.equal(normalizeOutcome('lost to ff-up'), 'LOST TO FOLLOW-UP');
    assert.deepEqual(splitTreatmentState('LTFU'), { case_status: null, treatment_outcome: 'LOST TO FOLLOW-UP' });
    assert.deepEqual(getOutcomeFilterValues('TREATMENT FAILED'), ['TREATMENT FAILED', 'FAILED']);
  });

  it('reports unknown source values without assigning a final outcome', () => {
    assert.deepEqual(splitTreatmentState('SCREENED'), { case_status: null, treatment_outcome: null });
    const folded = foldOutcomeCounts([
      { outcome_status: 'CURED', count: 3 },
      { outcome_status: 'SCREENED', count: 2 },
    ]);
    assert.deepEqual(folded.categories, [{ outcome_status: 'CURED', count: 3 }]);
    assert.deepEqual(folded.unapproved, [{ value: 'SCREENED', count: 2 }]);
  });

  it('merges legacy variants in final outcome charts', () => {
    const folded = foldOutcomeCounts([
      { outcome_status: 'FAILED', count: 4 },
      { outcome_status: 'TREATMENT FAILED', count: 5 },
      { outcome_status: 'LOST TO FF-UP', count: 2 },
    ]);
    assert.deepEqual(folded.categories, [
      { outcome_status: 'TREATMENT FAILED', count: 9 },
      { outcome_status: 'LOST TO FOLLOW-UP', count: 2 },
    ]);
  });
});
