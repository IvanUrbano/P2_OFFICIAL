/**
 * Naive timestamp parsing (db/pgTimezone.js):
 *   Neon sessions run in GMT, so `timestamp without time zone` columns store
 *   UTC wall clock. Without the parser override, node-pg reads that text in
 *   the process timezone and every displayed time shifts by the local offset
 *   (8 h in Manila). timestamptz (offset-aware) and date parsers must stay
 *   on their defaults.
 * Run: node --test test/timestampParsing.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../db/pgTimezone');
const { types } = require('pg');

describe('timestamp parsing', () => {
  it('reads naive timestamps as UTC (with fractional seconds)', () => {
    const d = types.getTypeParser(1114)('2026-10-03 18:55:23.636593');
    assert.strictEqual(d.toISOString(), '2026-10-03T18:55:23.636Z');
  });

  it('reads naive timestamps as UTC (without fractional seconds)', () => {
    const d = types.getTypeParser(1114)('2026-10-03 18:55:23');
    assert.strictEqual(d.toISOString(), '2026-10-03T18:55:23.000Z');
  });

  it('leaves timestamptz parsing on its default (offset-aware)', () => {
    const d = types.getTypeParser(1184)('2026-10-03 18:55:48.717925+00');
    assert.strictEqual(d.toISOString(), '2026-10-03T18:55:48.717Z');
  });

  it('leaves date parsing on its default (calendar date preserved locally)', () => {
    const d = types.getTypeParser(1082)('2026-01-15');
    assert.strictEqual(d.getFullYear(), 2026);
    assert.strictEqual(d.getMonth(), 0);
    assert.strictEqual(d.getDate(), 15);
  });
});
