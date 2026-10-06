/**
 * Case ID: <FACILITY CODE>-<D|M>-<YEAR>-<NNNNN> (services/caseIds.js)
 *   - facility = treatment facility's code (screening if blank, UNK if neither resolves)
 *   - D = DSTB, M = MN; year of diagnosis; running number per facility + type + year
 *   - a Case ID carried by the file is kept; new numbers continue after the highest one
 *     already used (cases, open data issues, the batch itself) — never repeats
 *   - the "Case ID" column is read by the parser
 * Run: node --test test/caseIds.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { CASE_ID_RE, normalizeCaseId, prefixFor, assignCaseIds, typeLetter } = require('../services/caseIds');
const { buildColumnMap } = require('../services/multiSheetParser');

const REGISTRY = { 'ROSARIO HEALTH CENTER - IDOTS': 'ROS', 'THE MEDICAL CITY-PASIG - MTBN': 'TMCP', 'PINEDA HEALTH CENTER - IDOTS': 'PND' };
function client({ used = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      calls.push(s);
      if (s.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
      if (s.includes('FROM unnest($1::text[]) AS n')) return { rows: params[0].map(n => ({ name: n, code: REGISTRY[n] || null })) };
      if (s.includes('MAX(right(id, 5)::int)')) {
        const out = {};
        for (const id of used) { const p = id.slice(0, -6); if (params[0].includes(p)) out[p] = Math.max(out[p] || 0, Number(id.slice(-5))); }
        return { rows: Object.entries(out).map(([prefix, max_n]) => ({ prefix, max_n })) };
      }
      return { rows: [] };
    },
  };
}
const row = (o) => ({ source_type: 'DSTB', date_of_diagnosis: '2025-03-04', treatment_facility: 'ROSARIO HEALTH CENTER - IDOTS', ...o });

describe('Case ID format', () => {
  it('normalizes IDs from files and recognizes the format', () => {
    assert.strictEqual(normalizeCaseId(' ros-d-2025-00042 '), 'ROS-D-2025-00042');
    assert.strictEqual(normalizeCaseId('  '), null);
    assert.ok(CASE_ID_RE.test('PINPC-D-2023-00001'));
    assert.ok(CASE_ID_RE.test('TMCP-M-2025-00113'));
    assert.ok(!CASE_ID_RE.test('1180031'), 'an ITIS number is not a Case ID');
    assert.strictEqual(typeLetter('DSTB'), 'D');
    assert.strictEqual(typeLetter('MN'), 'M');
    assert.strictEqual(typeLetter('MANUAL'), null);
  });

  it('prefix: treatment facility, else screening facility, else UNK', () => {
    const codes = new Map(Object.entries(REGISTRY));
    assert.strictEqual(prefixFor(row({}), codes), 'ROS-D-2025');
    assert.strictEqual(prefixFor(row({ source_type: 'MN', treatment_facility: '', screening_facility: 'THE MEDICAL CITY-PASIG - MTBN' }), codes), 'TMCP-M-2025');
    assert.strictEqual(prefixFor(row({ treatment_facility: 'Somewhere Unknown' }), codes), 'UNK-D-2025');
    assert.strictEqual(prefixFor(row({ treatment_facility: null, screening_facility: null }), codes), 'UNK-D-2025');
  });
});

describe('assignCaseIds', () => {
  it('numbers per facility + type + year and keeps IDs from the file', async () => {
    const rows = [
      row({}), row({}),                                                     // ROS-D-2025-00001, 00002
      row({ source_type: 'MN', treatment_facility: 'THE MEDICAL CITY-PASIG - MTBN' }), // TMCP-M-2025-00001
      row({ date_of_diagnosis: '2024-12-30' }),                             // ROS-D-2024-00001
      row({ source_case_id: 'ROS-D-2025-00010' }),                          // from the file: kept
    ];
    const c = client();
    assert.strictEqual(await assignCaseIds(c, rows), 4);
    assert.deepStrictEqual(rows.map(r => r.source_case_id),
      ['ROS-D-2025-00011', 'ROS-D-2025-00012', 'TMCP-M-2025-00001', 'ROS-D-2024-00001', 'ROS-D-2025-00010']);
    assert.ok(c.calls[0].startsWith('SELECT pg_advisory_xact_lock'), 'allocation is serialized');
  });

  it('continues after the highest number already used (cases / open data issues) — no repeats across files', async () => {
    const rows = [row({}), row({ treatment_facility: 'PINEDA HEALTH CENTER - IDOTS' })];
    await assignCaseIds(client({ used: ['ROS-D-2025-00041', 'ROS-D-2025-00007', 'PND-D-2024-00099'] }), rows);
    assert.deepStrictEqual(rows.map(r => r.source_case_id), ['ROS-D-2025-00042', 'PND-D-2025-00001']);
  });

  it('leaves manual-entry records alone and does nothing when every row has an ID', async () => {
    const c = client();
    assert.strictEqual(await assignCaseIds(c, [row({ source_type: 'MANUAL' }), row({ source_case_id: 'ROS-D-2025-00001' })]), 0);
    assert.strictEqual(c.calls.length, 0);
  });
});

describe('parser', () => {
  it('maps the "Case ID" column; ITIS stays its own field', () => {
    const map = buildColumnMap(['#', 'Case ID', 'ITIS Lite Case No.', 'Brgy', 'Age', 'Sex'], 'MN');
    assert.strictEqual(map[1], 'file_case_id');
    assert.strictEqual(map[2], 'itis_case_id');
  });
});
