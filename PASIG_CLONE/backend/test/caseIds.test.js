/**
 * Case ID: <FACILITY CODE>-<D|M>-<YEAR>-<NNNNN> (services/caseIds.js)
 *   - D = DSTB, M = MN; year of diagnosis; running number per facility + type + year
 *   - ALWAYS taken from the file's "Case ID" column or the Add TB Record form — the system
 *     never generates one (a row without it fails validation, services/validator.js)
 *   - the "Case ID" column is read by the parser
 * Run: node --test test/caseIds.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { CASE_ID_RE, normalizeCaseId } = require('../services/caseIds');
const { buildColumnMap } = require('../services/multiSheetParser');

describe('Case ID format', () => {
  it('normalizes IDs from files and recognizes the format', () => {
    assert.strictEqual(normalizeCaseId(' ros-d-2025-00042 '), 'ROS-D-2025-00042');
    assert.strictEqual(normalizeCaseId(' ros d 2025 00042 '), 'ROSD202500042', 'inner spaces are removed');
    assert.strictEqual(normalizeCaseId('  '), null);
    assert.ok(CASE_ID_RE.test('PINPC-D-2023-00001'));
    assert.ok(CASE_ID_RE.test('TMCP-M-2025-00113'));
    assert.ok(!CASE_ID_RE.test('1180031'), 'an ITIS number is not a Case ID');
    assert.ok(!CASE_ID_RE.test('ROS-X-2025-00042'), 'only D (DSTB) and M (MN) letter');
    assert.ok(!CASE_ID_RE.test('ROS-D-2025-42'), 'the number is always five digits');
  });

  it('is never generated: the module only normalizes and validates', () => {
    assert.deepStrictEqual(Object.keys(require('../services/caseIds')).sort(), ['CASE_ID_RE', 'normalizeCaseId']);
  });
});

describe('parser', () => {
  it('maps the "Case ID" column; the ITIS column is ignored', () => {
    const map = buildColumnMap(['#', 'Case ID', 'ITIS Lite Case No.', 'Brgy', 'Age', 'Sex'], 'MN');
    assert.strictEqual(map[1], 'file_case_id');
    assert.strictEqual(map[2], undefined);
  });
});
