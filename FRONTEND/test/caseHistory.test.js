import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeHistoryEntry, formatHistoryTimestamp, historyActorLabel } from '../src/utils/caseHistory.js';

/**
 * Same-case outcome updates, as the record tab shows them: one entry per
 * change to ONE Case ID, spelling out what the case used to say.
 */

test('a same-case outcome update shows the previous outcome verbatim', () => {
  const entry = {
    change_type: 'status_changed',
    changed_fields: {
      outcome_status: { old: 'ON TREATMENT', new: 'CURED' },
      date_of_outcome: { old: null, new: '2025-06-10' },
    },
    source: 'webhook',
    actor: 'ana.cruz',
    changed_at: '2025-06-10T08:30:00Z',
  };
  const { title, lines } = describeHistoryEntry(entry);

  assert.equal(title, 'Outcome changed');
  assert.ok(lines.includes('Outcome: ON TREATMENT → CURED'), lines.join(' | '));
  assert.ok(lines.includes('Outcome Date: — → 2025-06-10'), lines.join(' | '));
});

test('a correction that is not the outcome reads as a plain update', () => {
  const { title, lines } = describeHistoryEntry({
    change_type: 'updated',
    changed_fields: { treatment_facility: { old: 'Rizal Medical Center', new: 'Pasig City Hospital' } },
  });
  assert.equal(title, 'Case updated');
  assert.deepEqual(lines, ['Treatment Facility: Rizal Medical Center → Pasig City Hospital']);
});

test('a new case says so instead of pretending something changed', () => {
  const { title, lines } = describeHistoryEntry({ change_type: 'created', changed_fields: null });
  assert.equal(title, 'Case created');
  assert.deepEqual(lines, ['First received from the source system.']);
});

test('a resubmission with no recorded detail does not render an empty list', () => {
  for (const entry of [
    { change_type: 'updated', changed_fields: null },
    { change_type: 'updated', changed_fields: {} },
    { change_type: undefined, changed_fields: undefined },
    null,
  ]) {
    const { title, lines } = describeHistoryEntry(entry);
    assert.ok(title, 'always has a title');
    assert.ok(lines.length > 0 && lines.every((l) => typeof l === 'string' && l.length > 0));
  }
});

test('timestamps are readable and never "Invalid Date"', () => {
  assert.equal(formatHistoryTimestamp(null), 'Unknown time');
  assert.equal(formatHistoryTimestamp(''), 'Unknown time');
  assert.equal(formatHistoryTimestamp('not-a-date'), 'Unknown time');
  const formatted = formatHistoryTimestamp('2025-06-10T08:30:00Z');
  assert.match(formatted, /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M$/);
  assert.ok(!formatted.includes('Invalid'));
});

test('the actor is the person the source system reported, else a neutral source label', () => {
  assert.equal(historyActorLabel({ actor: '  ana.cruz ', source: 'webhook' }), 'ana.cruz');
  assert.equal(historyActorLabel({ actor: null, source: 'webhook' }), 'TBInsight sync');
  assert.equal(historyActorLabel({ actor: null, source: 'manual' }), 'TBInsight user');
  assert.equal(historyActorLabel({ source: 'unknown-source' }), 'System');
  assert.equal(historyActorLabel(null), 'System');
});

test('a history entry never renders a patient identifier', () => {
  const { lines } = describeHistoryEntry({
    change_type: 'status_changed',
    changed_fields: { outcome_status: { old: 'ON TREATMENT', new: 'CURED' } },
  });
  const text = lines.join('\n');
  assert.ok(!/PT-\d/i.test(text), `history is about the case, not the patient: ${text}`);
  assert.ok(!/patient/i.test(text));
});
