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

describe('summarizeWebhookPayload (sync log)', () => {
  const { summarizeWebhookPayload } = require('../db/pasigSchema');

  it('keeps batch and per-sheet counts but no records', () => {
    const payload = {
      schema_version: '1.0', source: 'pasig-clone', batch_id: 'b-1', timestamp: '2026-10-04T00:00:00Z',
      sheets: [{ sheet_name: 'DSTB', source_type: 'DSTB', record_count: 1, records: [{ case_no: 'C-1', patient_no: 'P-1', barangay_name: 'Pinagbuhatan' }] }],
    };
    const s = summarizeWebhookPayload(payload);
    assert.deepStrictEqual(s.sheets, [{ sheet_name: 'DSTB', source_type: 'DSTB', record_count: 1 }]);
    assert.strictEqual(s.batch_id, 'b-1');
    const text = JSON.stringify(s);
    assert.ok(!text.includes('C-1') && !text.includes('P-1') && !text.includes('Pinagbuhatan'));
  });
});

describe('rejectionsBySentRecord (marking records TBInsight rejected)', () => {
  const { rejectionsBySentRecord } = require('../services/webhookSender');
  const sent = [{ id: 11, case_no: 'C-11' }, { id: 12, case_no: 'C-12' }, { id: 13, case_no: null }];

  it('matches by record id, then falls back to Case ID', () => {
    const m = rejectionsBySentRecord(sent, [
      { record_id: 11, case_no: 'C-11', errors: ['Date of Diagnosis is required'] },
      { record_id: null, case_no: 'C-12', errors: ['Sex is required'] },
    ]);
    assert.deepStrictEqual([...m.entries()], [[11, 'Date of Diagnosis is required'], [12, 'Sex is required']]);
  });

  it('never marks a record that was not in this sync', () => {
    const m = rejectionsBySentRecord(sent, [
      { record_id: 999, case_no: 'C-999', errors: ['x'] },
      { record_id: null, case_no: null, errors: ['y'] },
    ]);
    assert.strictEqual(m.size, 0);
  });

  it('joins several reasons for one record', () => {
    const m = rejectionsBySentRecord(sent, [{ record_id: 13, errors: ['Sex is required', 'Invalid age: "200". Must be 0-120'] }]);
    assert.strictEqual(m.get(13), 'Sex is required; Invalid age: "200". Must be 0-120');
  });

  it('keeps every rejection from a newer TBInsight reply, not only the 10-item sample', () => {
    const rejected = Array.from({ length: 12 }, (_, i) => ({ record_id: i, errors: ['x'] }));
    const r = summarizeTbInsightResponse(JSON.stringify({ importedCount: 0, updatedCount: 0, errorCount: 12, errors: rejected.slice(0, 10), rejected }), 12);
    assert.strictEqual(r.rejected.length, 12);
    assert.strictEqual(r.rejectedSamples.length, 10);
  });
});
