/**
 * TBInsight — Outcome/Status Contract Tests
 *
 * One normalization contract, shared by Dashboard, Analytics, Reports, NLG,
 * CFR, TSR, Treatment Cascade and exports (BACKEND/tbinsight/outcomeNormalization.js).
 *
 * The 9 Excel-verified source Outcome/Status categories are:
 *   TREATMENT COMPLETED, ON TREATMENT, FAILED, DIAGNOSED, NOT EVALUATED,
 *   CURED, LOST TO FF-UP, DIED, EXCLUDED
 *
 * Two values in the live data are NOT among them, and these tests pin the
 * behaviour traced for each:
 *
 *   TREATMENT FAILED (56 rows) — the source workbook records FAILED. The
 *     upstream PASIG TB-IS cleaner maps 'failed' -> 'TREATMENT FAILED'
 *     (PASIG_CLONE/backend/services/dataCleaner.js), so that is the stored
 *     form. It is a legacy alias of FAILED: it must be analytically recognized
 *     as FAILED and must never be shown or offered to a user.
 *
 *   SCREENED (13 rows) — present verbatim in the MN sheet of the source
 *     workbook ('Screened'), upper-cased upstream. It is NOT an approved
 *     category: it is never a dropdown option and never a chart category, and
 *     it is deliberately NOT remapped onto another outcome without evidence.
 *
 * Pure unit tests — no database required.
 * Run: node --test BACKEND/test/tbinsight/outcomeContract.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  APPROVED_OUTCOMES,
  EVALUATED_TERMINAL_OUTCOMES,
  SUCCESS_OUTCOMES,
  SUCCESS_OUTCOMES_SQL,
  normalizeOutcome,
  normalizeDisplayOutcome,
  normalizeRecordOutcome,
  isApprovedOutcome,
  getOutcomeFilterValues,
  foldOutcomeCounts,
} = require('../../tbinsight/outcomeNormalization');

const EXPECTED_APPROVED = [
  'TREATMENT COMPLETED', 'ON TREATMENT', 'FAILED', 'DIAGNOSED',
  'NOT EVALUATED', 'CURED', 'LOST TO FF-UP', 'DIED', 'EXCLUDED',
];

// ==================== THE 9 APPROVED CATEGORIES ====================

describe('approved outcome contract', () => {
  it('contains exactly the 9 Excel-verified categories', () => {
    assert.strictEqual(APPROVED_OUTCOMES.length, 9);
    assert.deepStrictEqual([...APPROVED_OUTCOMES].sort(), [...EXPECTED_APPROVED].sort());
  });

  it('does not include SCREENED', () => {
    assert.ok(!APPROVED_OUTCOMES.includes('SCREENED'));
  });

  it('does not include TREATMENT FAILED as a user-facing category', () => {
    assert.ok(!APPROVED_OUTCOMES.includes('TREATMENT FAILED'));
    assert.ok(APPROVED_OUTCOMES.includes('FAILED'), 'the source-aligned form is the contract');
  });

  it('every approved category normalizes to itself', () => {
    for (const o of APPROVED_OUTCOMES) {
      assert.strictEqual(normalizeDisplayOutcome(o), o, `${o} must be stable`);
      assert.strictEqual(isApprovedOutcome(o), true, `${o} must be approved`);
    }
  });
});

// ==================== FAILED / TREATMENT FAILED ====================

describe('FAILED handling', () => {
  it('recognizes the legacy TREATMENT FAILED as FAILED', () => {
    assert.strictEqual(normalizeDisplayOutcome('TREATMENT FAILED'), 'FAILED');
    assert.strictEqual(normalizeRecordOutcome('TREATMENT FAILED'), 'FAILED');
    assert.strictEqual(isApprovedOutcome('TREATMENT FAILED'), true);
  });

  it('expands a FAILED filter to both the source and legacy values', () => {
    const values = getOutcomeFilterValues('FAILED');
    assert.ok(values.includes('FAILED'));
    assert.ok(values.includes('TREATMENT FAILED'));
  });

  it('never asks the user to select TREATMENT FAILED', () => {
    // Selecting the legacy value is still accepted defensively, but the
    // approved list a dropdown is built from offers only FAILED.
    assert.ok(!APPROVED_OUTCOMES.includes('TREATMENT FAILED'));
  });

  it('normalizes new imports to the source-aligned FAILED', () => {
    assert.strictEqual(normalizeOutcome('TREATMENT FAILED'), 'FAILED');
    assert.strictEqual(normalizeOutcome('failed'), 'FAILED');
    assert.strictEqual(normalizeOutcome('  Failed  '), 'FAILED');
  });

  it('keeps FAILED in the CFR evaluated denominator under both spellings', () => {
    // Changing the stored form must not move a record in or out of CFR.
    assert.ok(EVALUATED_TERMINAL_OUTCOMES.includes('FAILED'));
    assert.ok(EVALUATED_TERMINAL_OUTCOMES.includes('TREATMENT FAILED'));
  });
});

// ==================== SCREENED ====================

describe('SCREENED handling', () => {
  it('is not an approved category', () => {
    assert.strictEqual(normalizeDisplayOutcome('SCREENED'), null);
    assert.strictEqual(isApprovedOutcome('SCREENED'), false);
  });

  it('is not silently remapped onto another outcome', () => {
    // Preserved verbatim on a record so provenance is not destroyed.
    assert.strictEqual(normalizeRecordOutcome('SCREENED'), 'SCREENED');
    assert.strictEqual(normalizeOutcome('Screened'), 'SCREENED');
  });

  it('is excluded from chart/dropdown categories but reported, not dropped', () => {
    const rows = [
      { outcome_status: 'CURED', count: 100 },
      { outcome_status: 'SCREENED', count: 13 },
    ];
    const folded = foldOutcomeCounts(rows);
    assert.deepStrictEqual(folded.categories, [{ outcome_status: 'CURED', count: 100 }]);
    assert.deepStrictEqual(folded.unapproved, [{ value: 'SCREENED', count: 13 }]);
    assert.strictEqual(folded.unapprovedTotal, 13);
  });

  it('is not counted as an evaluated terminal outcome', () => {
    assert.ok(!EVALUATED_TERMINAL_OUTCOMES.includes('SCREENED'));
  });

  it('is not counted as a successful outcome', () => {
    assert.ok(!SUCCESS_OUTCOMES.includes('SCREENED'));
  });
});

// ==================== CASE / WHITESPACE NORMALIZATION ====================

describe('normalization is case- and whitespace-insensitive', () => {
  const variants = [
    ['  cured ', 'CURED'],
    ['Treatment Completed', 'TREATMENT COMPLETED'],
    ['on treatment', 'ON TREATMENT'],
    ['LOST TO FOLLOW-UP', 'LOST TO FF-UP'],
    ['lost to follow up', 'LOST TO FF-UP'],
    ['LTFU', 'LOST TO FF-UP'],
  ];
  for (const [input, expected] of variants) {
    it(`maps ${JSON.stringify(input)} to ${expected}`, () => {
      assert.strictEqual(normalizeDisplayOutcome(input), expected);
      assert.strictEqual(normalizeOutcome(input), expected);
    });
  }

  it('returns null for empty and missing values', () => {
    for (const v of [null, undefined, '', '   ']) {
      assert.strictEqual(normalizeDisplayOutcome(v), null);
      assert.strictEqual(normalizeRecordOutcome(v), null);
      assert.strictEqual(isApprovedOutcome(v), false);
    }
  });
});

// ==================== FOLDING / RECONCILIATION ====================

describe('foldOutcomeCounts', () => {
  it('merges the legacy value into its source-aligned category', () => {
    const folded = foldOutcomeCounts([
      { outcome_status: 'FAILED', count: 4 },
      { outcome_status: 'TREATMENT FAILED', count: 56 },
    ]);
    assert.deepStrictEqual(folded.categories, [{ outcome_status: 'FAILED', count: 60 }]);
  });

  it('returns categories in the approved display order', () => {
    const folded = foldOutcomeCounts(
      [...APPROVED_OUTCOMES].reverse().map((o) => ({ outcome_status: o, count: 1 }))
    );
    assert.deepStrictEqual(folded.categories.map((c) => c.outcome_status), APPROVED_OUTCOMES);
  });

  it('reconciles: approvedTotal + unapprovedTotal equals the input total', () => {
    const rows = [
      { outcome_status: 'TREATMENT COMPLETED', count: 8196 },
      { outcome_status: 'ON TREATMENT', count: 2870 },
      { outcome_status: 'CURED', count: 2612 },
      { outcome_status: 'LOST TO FF-UP', count: 816 },
      { outcome_status: 'DIAGNOSED', count: 331 },
      { outcome_status: 'DIED', count: 268 },
      { outcome_status: 'EXCLUDED', count: 108 },
      { outcome_status: 'TREATMENT FAILED', count: 56 },
      { outcome_status: 'NOT EVALUATED', count: 43 },
      { outcome_status: 'SCREENED', count: 13 },
    ];
    const inputTotal = rows.reduce((t, r) => t + r.count, 0);
    const folded = foldOutcomeCounts(rows);
    assert.strictEqual(folded.approvedTotal + folded.unapprovedTotal, inputTotal);
    // The approved chart total is the record total minus the unverified rows.
    assert.strictEqual(folded.approvedTotal, inputTotal - 13);
    assert.strictEqual(folded.categories.find((c) => c.outcome_status === 'FAILED').count, 56);
    assert.ok(!folded.categories.some((c) => c.outcome_status === 'SCREENED'));
  });

  it('treats a null/blank stored value as UNKNOWN rather than a category', () => {
    const folded = foldOutcomeCounts([{ outcome_status: null, count: 5 }]);
    assert.strictEqual(folded.categories.length, 0);
    assert.deepStrictEqual(folded.unapproved, [{ value: 'UNKNOWN', count: 5 }]);
  });
});

// ==================== SHARED SQL CONSTANTS ====================

describe('shared SQL constants', () => {
  it('SUCCESS_OUTCOMES_SQL lists exactly the success outcomes', () => {
    assert.strictEqual(SUCCESS_OUTCOMES_SQL, "'CURED','TREATMENT COMPLETED'");
    for (const o of SUCCESS_OUTCOMES) {
      assert.ok(SUCCESS_OUTCOMES_SQL.includes(`'${o}'`));
    }
  });

  it('success outcomes remain CURED + TREATMENT COMPLETED', () => {
    // Cascade and TSR both depend on this; it must not drift.
    assert.deepStrictEqual(SUCCESS_OUTCOMES, ['CURED', 'TREATMENT COMPLETED']);
  });
});
