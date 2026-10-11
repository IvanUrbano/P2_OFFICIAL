/**
 * Medicine pickup schedules: dates, missed pickups and warning levels
 * (services/medicationSchedule.js). Pure functions — no database.
 * Run: node --test test/medicationSchedule.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const med = require('../services/medicationSchedule');

const weekly = { start_date: '2026-10-01', end_date: '2026-10-31', interval_days: 7 };
// Pickups Oct 1, 8, 15, 22, 29

describe('schedule dates', () => {
  it('lists a pickup every interval from start to end', () => {
    assert.deepStrictEqual(med.pickupDates(weekly), ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29']);
  });

  it('works out the last day from days, weeks and months', () => {
    assert.strictEqual(med.endDateFor('2026-10-13', 10, 'days'), '2026-10-22');
    assert.strictEqual(med.endDateFor('2026-10-13', 2, 'weeks'), '2026-10-26');
    assert.strictEqual(med.endDateFor('2026-10-13', 6, 'months'), '2027-04-12');
    assert.strictEqual(med.endDateFor('2026-10-31', 1, 'months'), '2026-11-29'); // Nov has no 31st
  });

  it('gives today in Philippine time', () => {
    assert.strictEqual(med.manilaToday(new Date('2026-10-11T17:00:00Z')), '2026-10-12'); // 1 AM in Manila
  });
});

describe('missed pickups and warnings', () => {
  it('an unrecorded pickup is late during the grace period, then counts as missed', () => {
    assert.strictEqual(med.PICKUP_GRACE_DAYS, 2);
    const at = (today) => med.summarize(weekly, [], today).pickups[0].state;
    assert.strictEqual(at('2026-10-01'), 'due');
    assert.strictEqual(at('2026-10-02'), 'late');
    assert.strictEqual(at('2026-10-03'), 'late');
    assert.strictEqual(at('2026-10-04'), 'overdue');
    assert.strictEqual(med.summarize(weekly, [], '2026-10-04').missed, 1);
  });

  it('collected pickups never count; recorded misses count at once', () => {
    const s = med.summarize(weekly, [
      { due_date: '2026-10-01', status: 'collected', collected_on: '2026-10-02' },
      { due_date: '2026-10-08', status: 'missed' },
    ], '2026-10-08');
    assert.strictEqual(s.collected, 1);
    assert.strictEqual(s.missed, 1);
    assert.strictEqual(s.pickups[0].collected_on, '2026-10-02');
    assert.strictEqual(s.next_pickup, '2026-10-15');
  });

  it('1st and 2nd missed are yellow warnings, the 3rd is red, and they never reset', () => {
    assert.strictEqual(med.levelFor(0), 'ok');
    assert.strictEqual(med.levelFor(1), 'warning1');
    assert.strictEqual(med.levelFor(2), 'warning2');
    assert.strictEqual(med.levelFor(3), 'critical');
    assert.strictEqual(med.levelFor(5), 'critical');
    const s = med.summarize(weekly, [
      { due_date: '2026-10-01', status: 'missed' },
      { due_date: '2026-10-08', status: 'collected' },
      { due_date: '2026-10-15', status: 'missed' },
      { due_date: '2026-10-22', status: 'collected' },
      { due_date: '2026-10-29', status: 'missed' },
    ], '2026-10-30');
    assert.strictEqual(s.missed, 3);
    assert.strictEqual(s.level, 'critical');
  });

  it('ignores recorded pickups that are not on the schedule (left over from an edit)', () => {
    const s = med.summarize(weekly, [{ due_date: '2026-10-02', status: 'missed' }], '2026-10-01');
    assert.strictEqual(s.missed, 0);
  });

  it('is finished once the last pickup has passed', () => {
    const all = med.pickupDates(weekly).map(d => ({ due_date: d, status: 'collected' }));
    assert.strictEqual(med.summarize(weekly, all, '2026-11-01').finished, true);
    assert.strictEqual(med.summarize(weekly, all, '2026-10-20').finished, false);
  });

  it('the SQL count reads its cut-off from the same grace period', () => {
    const sql = med.missedSql('s', 'T');
    assert.ok(sql.includes(`T - ${med.PICKUP_GRACE_DAYS + 1}`));
    assert.strictEqual(med.levelSql('warning', 'm'), 'm BETWEEN 1 AND 2');
    assert.strictEqual(med.levelSql('critical', 'm'), 'm >= 3');
    assert.strictEqual(med.levelSql('bogus', 'm'), null);
  });
});

describe('schedule form', () => {
  const good = {
    start_date: '2026-10-13', interval_days: 7, duration_value: 6, duration_unit: 'months',
    medicines: [{ name: 'HRZE (4FDC)', quantity: 28, unit: 'tablets', instructions: '4 tablets daily' }],
  };

  it('accepts a weekly 6-month schedule and works out its end', () => {
    const r = med.validateScheduleInput(good, '2026-10-11');
    assert.ifError(r.error);
    assert.strictEqual(r.value.end_date, '2027-04-12');
    assert.deepStrictEqual(r.value.medicines, [{ name: 'HRZE (4FDC)', quantity: 28, unit: 'tablets', instructions: '4 tablets daily' }]);
  });

  it('rejects bad input with a message the nurse can act on', () => {
    const bad = (changes) => med.validateScheduleInput({ ...good, ...changes }, '2026-10-11').error;
    assert.match(bad({ interval_days: 0 }), /interval/);
    assert.match(bad({ interval_days: 2.5 }), /interval/);
    assert.match(bad({ start_date: '2026-02-30' }), /first pickup date/);
    assert.match(bad({ start_date: '2026-06-01' }), /90 days ago/);
    assert.match(bad({ duration_unit: 'years' }), /how long/);
    assert.match(bad({ duration_value: 30, duration_unit: 'months' }), /24 months/);
    assert.match(bad({ duration_value: 3, duration_unit: 'days' }), /shorter than one pickup/);
    assert.match(bad({ medicines: [] }), /at least one medicine/);
    assert.match(bad({ medicines: [{ name: '', quantity: 1 }] }), /medicine name/);
    assert.match(bad({ medicines: [{ name: 'HR', quantity: 0 }] }), /amount/);
  });

  it('defaults the unit to tablets and trims text', () => {
    const r = med.validateScheduleInput({ ...good, medicines: [{ name: '  HR  ', quantity: '14' }], notes: '  ' }, '2026-10-11');
    assert.deepStrictEqual(r.value.medicines, [{ name: 'HR', quantity: 14, unit: 'tablets', instructions: '' }]);
    assert.strictEqual(r.value.notes, null);
  });
});
