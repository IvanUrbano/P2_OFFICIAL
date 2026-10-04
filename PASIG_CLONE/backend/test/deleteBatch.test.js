/**
 * deleteBatch (db/pasigSchema.js) removes everything a batch brought in, including its
 * data issues. Before this, issues of a deleted batch stayed open on the Validation page
 * (with errors from the rules at the time) and could not be fixed into any batch.
 * Run: node --test test/deleteBatch.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const db = require('../db/pasigSchema');

function fakeClient({ batchExists = true } = {}) {
  const sql = [];
  return {
    sql,
    async query(text, params) {
      const q = String(text).replace(/\s+/g, ' ').trim();
      sql.push({ q, params });
      if (q.startsWith('DELETE FROM import_batches')) {
        return { rows: batchExists ? [{ id: params[0] }] : [], rowCount: batchExists ? 1 : 0 };
      }
      if (q.startsWith('DELETE FROM validation_issues')) return { rows: [], rowCount: 3 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
}

describe('deleteBatch', () => {
  it('deletes the batch\'s data issues before the batch row, in the same transaction', async () => {
    const client = fakeClient();
    db.pool.connect = async () => client;

    const result = await db.deleteBatch('b-1');

    const qs = client.sql.map(s => s.q);
    const issueIdx = qs.findIndex(q => q.startsWith('DELETE FROM validation_issues WHERE batch_id = $1'));
    const batchIdx = qs.findIndex(q => q.startsWith('DELETE FROM import_batches'));
    assert.ok(issueIdx > 0, 'validation_issues delete missing');
    assert.deepStrictEqual(client.sql[issueIdx].params, ['b-1']);
    assert.ok(issueIdx < batchIdx, 'issues must be deleted before the batch row');
    assert.strictEqual(qs[0], 'BEGIN');
    assert.strictEqual(qs[qs.length - 1], 'COMMIT');
    assert.strictEqual(result.deleted.dataIssues, 3);
  });

  it('rolls back (keeping the issues) when the batch does not exist', async () => {
    const client = fakeClient({ batchExists: false });
    db.pool.connect = async () => client;

    assert.strictEqual(await db.deleteBatch('missing'), null);
    const qs = client.sql.map(s => s.q);
    assert.strictEqual(qs[qs.length - 1], 'ROLLBACK');
    assert.ok(!qs.includes('COMMIT'));
  });
});
