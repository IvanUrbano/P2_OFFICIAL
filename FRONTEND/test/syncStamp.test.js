import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSyncStamp } from '../src/utils/syncStamp.js';

test('formats the sync time, not the current time', () => {
  const s = formatSyncStamp('2026-10-09T07:05:00', { failed: false });
  assert.equal(s, 'Fri, 9 Oct 2026 | 7:05 AM');
});

test('says Never when no sync has happened', () => {
  assert.equal(formatSyncStamp(null, { failed: false }), 'Never');
});

test('says Unavailable when the request failed or the value is not a date', () => {
  assert.equal(formatSyncStamp(null, { failed: true }), 'Unavailable');
  assert.equal(formatSyncStamp('not a date', { failed: false }), 'Unavailable');
});

test('says Loading before the first response', () => {
  assert.equal(formatSyncStamp(undefined), 'Loading…');
});
