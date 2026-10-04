/**
 * Sync outcome counts (services/webhookSender.js → summarizeTbInsightResponse):
 *   The numbers shown after a sync must come from TBInsight's reply (what it
 *   actually imported / updated / rejected), not from how many records were sent.
 * Run: node --test test/syncOutcome.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { summarizeTbInsightResponse } = require('../services/webhookSender');

describe('summarizeTbInsightResponse', () => {
  it('uses TBInsight counts, not the number sent', () => {
    const body = JSON.stringify({
      success: true, totalRecords: 500, importedCount: 450, updatedCount: 30, errorCount: 20,
      errors: [{ row: 7, source_type: 'DSTB', errors: ['Invalid date_of_diagnosis'] }],
    });
    const r = summarizeTbInsightResponse(body, 500);
    assert.strictEqual(r.recordsImported, 450);
    assert.strictEqual(r.recordsUpdated, 30);
    assert.strictEqual(r.recordsRejected, 20);
    assert.strictEqual(r.recordsAccepted, 480);
    assert.strictEqual(r.rejectedSamples.length, 1);
    assert.match(r.message, /450 imported, 30 updated, 20 rejected/);
  });

  it('omits "rejected" from the message when nothing was rejected', () => {
    const body = JSON.stringify({ importedCount: 10, updatedCount: 0, errorCount: 0 });
    const r = summarizeTbInsightResponse(body, 10);
    assert.strictEqual(r.recordsRejected, 0);
    assert.strictEqual(r.recordsAccepted, 10);
    assert.doesNotMatch(r.message, /rejected/);
  });

  it('mentions non-Pasig records that were not sent', () => {
    const body = JSON.stringify({ importedCount: 5, updatedCount: 0, errorCount: 0 });
    const r = summarizeTbInsightResponse(body, 5, 3);
    assert.match(r.message, /3 non-Pasig record\(s\) were not sent/);
  });

  it('recognizes a batch TBInsight already processed', () => {
    const body = JSON.stringify({ success: true, message: 'Webhook already processed (duplicate)' });
    const r = summarizeTbInsightResponse(body, 12);
    assert.strictEqual(r.alreadySynced, true);
    assert.strictEqual(r.recordsAccepted, null);
    assert.match(r.message, /already synced/);
  });

  it('recognizes a batch TBInsight is still importing from an earlier attempt', () => {
    const body = JSON.stringify({ success: true, inProgress: true, message: 'Webhook already in progress for this batch' });
    const r = summarizeTbInsightResponse(body, 12);
    assert.strictEqual(r.inProgress, true);
    assert.strictEqual(r.alreadySynced, false);
    assert.strictEqual(r.recordsAccepted, null);
    assert.match(r.message, /still importing/);
  });

  it('does not invent counts for a non-JSON reply', () => {
    const r = summarizeTbInsightResponse('OK', 8);
    assert.strictEqual(r.alreadySynced, false);
    assert.strictEqual(r.recordsAccepted, null);
    assert.strictEqual(r.recordsRejected, null);
    assert.match(r.message, /did not report/);
  });
});
