/**
 * Outcome-due reminders (services/outcomeDue.js): who is reminded, how often, and what
 * the reminder says. In-memory stand-in for the databases.
 * Run: node --test test/outcomeDue.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

let dueRows;
let recent;
let sent;
stub('../db/pasigSchema', {
  pool: {
    query: async (sql, params) => {
      const q = String(sql).replace(/\s+/g, ' ');
      if (q.includes('FROM validated_tb_cases v')) return { rows: dueRows };
      if (q.includes('FROM notifications')) return { rows: params[1].filter(id => recent.has(id)).map(user_id => ({ user_id })) };
      throw new Error('unexpected query ' + q.slice(0, 60));
    },
  },
  authPool: { query: async () => ({ rows: [] }) },
});
stub('../services/notifications', {
  barangayStaff: async (id) => ({ 17: [22, 23], 12: [30] }[id] || []),
  admins: async () => [1, 19],
  notify: async (ids, n) => { sent.push({ ids, ...n }); return ids.length; },
});

const due = require('../services/outcomeDue');

beforeEach(() => {
  dueRows = [
    { barangay_id: 17, barangay_name: 'Rosario', n: 12 },
    { barangay_id: 12, barangay_name: 'Maybunga', n: 1 },
    { barangay_id: null, barangay_name: null, n: 2 },
  ];
  recent = new Set();
  sent = [];
});

describe('outcome-due reminders', () => {
  it('a case is due after 6 months on treatment, counted from the treatment start (else diagnosis)', () => {
    const sql = due.outcomeDueSql('v', 'T');
    assert.match(sql, /v\.case_status = 'ON TREATMENT'/);
    assert.match(sql, /COALESCE\(v\.date_started_treatment, v\.date_of_diagnosis\) <= T - INTERVAL '6 months'/);
  });

  it("tells each barangay's staff about their own patients, and admins about the whole city", async () => {
    const r = await due.remindOutcomeDue();
    assert.deepStrictEqual(r, { due: 15, sent: 5 });
    const rosario = sent.find(s => s.ids.includes(22));
    assert.deepStrictEqual(rosario.ids, [22, 23]);
    assert.strictEqual(rosario.title, '12 patients on treatment over 6 months');
    assert.match(rosario.message, /12 patients in Rosario have been on treatment for more than 6 months/);
    assert.match(sent.find(s => s.ids.includes(30)).message, /1 patient in Maybunga has been/);
    const city = sent.find(s => s.ids.includes(1));
    assert.match(city.message, /15 patients city-wide have been .* most in Rosario \(12\), Maybunga \(1\)/);
    assert.ok(sent.every(s => s.type === 'outcome_due' && s.link === '/medication?tab=outcome'));
  });

  it('reminds each person at most once a week', async () => {
    recent = new Set([22, 23, 1]);
    const r = await due.remindOutcomeDue();
    assert.strictEqual(r.sent, 2);                       // Maybunga staff (30) and admin 19 only
    assert.deepStrictEqual(sent.flatMap(s => s.ids).sort((a, b) => a - b), [19, 30]);
  });

  it('sends nothing when no patient is due', async () => {
    dueRows = [];
    assert.deepStrictEqual(await due.remindOutcomeDue(), { due: 0, sent: 0 });
    assert.strictEqual(sent.length, 0);
  });
});
