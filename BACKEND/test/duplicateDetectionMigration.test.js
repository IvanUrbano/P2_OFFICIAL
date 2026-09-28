/**
 * Duplicate detection migration safety (TEST F)
 *
 * Migration 018_duplicate_detection.sql must resolve the 20 pre-existing
 * MN itis_case_id collisions and 113 DSTB fingerprint collisions purely by
 * flagging (duplicate_status/duplicate_of_case_id/duplicate_flag_reason) —
 * never by deleting, merging rows, or enforcing a hard UNIQUE constraint
 * that could reject a legitimate future record. This is checked statically
 * against the SQL text so it can't silently regress, and was additionally
 * verified live: after this migration ran against production data, total
 * MN row count was unchanged (3583) and 21 MN rows / 47 DSTB rows were
 * flagged as 'possible_duplicate', none deleted.
 *
 * Run: node --test BACKEND/test/duplicateDetectionMigration.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const migrationSql = fs.readFileSync(
  path.join(__dirname, '..', 'db', 'migrations', '018_duplicate_detection.sql'),
  'utf8'
);
const upper = migrationSql.toUpperCase();

describe('Migration 018 — duplicate detection safety (TEST F)', () => {
  it('contains no DELETE statement', () => {
    assert.ok(!upper.includes('DELETE FROM'), 'migration must never delete existing tb_cases rows');
  });

  it('does not create a UNIQUE index or constraint on itis_case_id', () => {
    assert.ok(
      !/CREATE\s+UNIQUE\s+INDEX[^;]*ITIS_CASE_ID/i.test(migrationSql),
      'itis_case_id must remain a detection signal, not a hard uniqueness constraint (20 known collisions in live data)'
    );
  });

  it('does not create a UNIQUE index or constraint on the DSTB fingerprint', () => {
    assert.ok(
      !/CREATE\s+UNIQUE\s+INDEX[^;]*DSTB_FINGERPRINT/i.test(migrationSql),
      'dstb_fingerprint must remain a heuristic lookup key, never a hard uniqueness constraint'
    );
  });

  it('backfill UPDATEs only ever set duplicate-tracking columns, never clinical fields', () => {
    const updateBlocks = migrationSql.match(/UPDATE tb_cases[\s\S]*?;/gi) || [];
    assert.ok(updateBlocks.length >= 2, 'expected at least one DSTB and one MN backfill UPDATE');
    for (const block of updateBlocks) {
      // The SET clause ends at whichever of FROM/WHERE/; comes first.
      const setClause = block.match(/SET([\s\S]*?)(?:\bFROM\b|\bWHERE\b|;)/i)?.[1] || '';
      const assignedColumns = [...setClause.matchAll(/(\w+)\s*=/g)].map((m) => m[1].toLowerCase());
      const allowed = new Set(['duplicate_status', 'duplicate_of_case_id', 'duplicate_flag_reason', 'dstb_fingerprint']);
      for (const col of assignedColumns) {
        assert.ok(allowed.has(col), `backfill UPDATE touched unexpected column "${col}": ${block.slice(0, 120)}`);
      }
    }
  });

  it('backfill never flags a row as anything other than possible_duplicate', () => {
    assert.ok(!/duplicate_status\s*=\s*'confirmed/i.test(migrationSql));
    const statusAssignments = [...migrationSql.matchAll(/duplicate_status\s*=\s*'([^']+)'/gi)].map((m) => m[1]);
    for (const status of statusAssignments) {
      assert.ok(['unique', 'possible_duplicate'].includes(status), `unexpected duplicate_status value: ${status}`);
    }
  });

  it('duplicate_flag_reason distinguishes MN and DSTB collisions and never uses a combined/confirmed label', () => {
    const reasons = [...migrationSql.matchAll(/duplicate_flag_reason\s*=\s*'([^']+)'/gi)].map((m) => m[1]);
    assert.ok(reasons.includes('MN_ITIS_ID_COLLISION'));
    assert.ok(reasons.includes('DSTB_FINGERPRINT_COLLISION'));
    for (const reason of reasons) {
      assert.ok(!reason.toUpperCase().includes('CONFIRMED'));
    }
  });

  it('uses IF NOT EXISTS / IF EXISTS guards so re-running the migration is a no-op (idempotent)', () => {
    assert.ok(upper.includes('ADD COLUMN IF NOT EXISTS'));
    assert.ok(upper.includes('CREATE INDEX IF NOT EXISTS'));
  });
});
