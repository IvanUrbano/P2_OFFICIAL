/**
 * Invariant: a case is NEVER marked CURED (or any outcome) by the passage of time.
 *
 * Outcome comes only from a validated update to an existing Case ID — a source
 * system record, a manual correction, or a migration that carries the value it
 * was given. Elapsed time, date arithmetic, and "it has been 6 months" logic
 * must never write an outcome, because a case that is still being followed up
 * must stay ON TREATMENT until someone actually records the result.
 *
 * Checked statically across the whole repo so the rule cannot quietly regress.
 * Run: node --test BACKEND/test/tbinsight/noAutoOutcome.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const SCAN_DIRS = ['BACKEND', 'PASIG_CLONE', 'FRONTEND/src'];
const EXT = new Set(['.js', '.jsx', '.sql', '.ts']);
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', '.git']);

function collectFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) collectFiles(path.join(dir, entry.name), out);
      continue;
    }
    if (EXT.has(path.extname(entry.name))) out.push(path.join(dir, entry.name));
  }
  return out;
}

const files = SCAN_DIRS
  .map((d) => path.join(REPO, d))
  .filter((p) => fs.existsSync(p))
  .flatMap((p) => collectFiles(p))
  // Production source only — the tests are allowed to write CURED literals.
  .filter((f) => !/(^|[\\/])test([\\/]|$)|\.test\.[jt]sx?$/.test(f));

const rel = (f) => path.relative(REPO, f).split(path.sep).join('/');

/** Time expressions that would make an outcome depend on the calendar. */
const TIME_EXPRESSIONS = [
  /CURRENT_DATE/, /\bNOW\(\)/, /\bINTERVAL\b/i, /make_interval/i,
  /DATE_TRUNC/i, /\bCURRENT_TIMESTAMP\b/, /AGE\(/i, /EXTRACT\(/i,
];

describe('Outcomes are never derived from elapsed time', () => {
  it('scans the real source tree, not a stale fixture', () => {
    assert.ok(files.length > 50, `expected to scan the repo, found ${files.length} files`);
    assert.ok(files.some((f) => rel(f) === 'BACKEND/tbinsight/webhook.js'));
  });

  it('no UPDATE anywhere writes outcome_status from a time expression', () => {
    const offenders = [];
    for (const file of files) {
      const sql = fs.readFileSync(file, 'utf8');
      const statements = sql.match(/UPDATE\s+[\w."`]*[\s\S]{0,600}?;/gi) || [];
      for (const stmt of statements) {
        if (!/outcome_status\s*=/i.test(stmt)) continue;
        if (TIME_EXPRESSIONS.some((re) => re.test(stmt))) {
          offenders.push(`${rel(file)}: ${stmt.replace(/\s+/g, ' ').slice(0, 160)}`);
        }
      }
    }
    assert.deepStrictEqual(offenders, [], 'an outcome must never depend on the clock');
  });

  it('no SQL assignment invents an outcome literal', () => {
    const offenders = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/outcome_status\s*=\s*'(?!EXCLUDED)/i.test(line) && !/^\s*(--|\/\/|\*)/.test(line)) {
          offenders.push(`${rel(file)}:${i + 1}: ${line.trim().slice(0, 140)}`);
        }
      });
    }
    assert.deepStrictEqual(offenders, [], 'nothing may hard-code an outcome onto a case');
  });

  it('no date of outcome or treatment-start date silently flips a status', () => {
    const offenders = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/outcome_status\s*=/.test(line)) return;
        if (!/date_of_outcome|date_started_treatment|date_of_diagnosis/.test(line)) return;
        if (/^\s*(--|\/\/|\*)/.test(line)) return;
        offenders.push(`${rel(file)}:${i + 1}: ${line.trim().slice(0, 140)}`);
      });
    }
    assert.deepStrictEqual(offenders, [], 'dates are facts about a case, never a verdict on it');
  });

  it('the webhook copies the outcome the source system actually reported', () => {
    const webhook = fs.readFileSync(path.join(REPO, 'BACKEND/tbinsight/webhook.js'), 'utf8');
    // The only place an existing case's outcome is written.
    assert.match(webhook, /outcome_status\s*=\s*EXCLUDED\.outcome_status/);
    // Its source column mirrors the record, never a computed value.
    assert.match(webhook, /source_outcome_status\s*=\s*(COALESCE\(EXCLUDED\.source_outcome_status|EXCLUDED\.source_outcome_status)/);
    const assignLines = webhook.split('\n').filter((l) => /^\s*outcome_status\s*=/.test(l));
    assert.ok(assignLines.length >= 1, 'the outcome column is written by the upsert');
    assert.ok(
      assignLines.every((l) => /EXCLUDED\.outcome_status/.test(l)),
      `every outcome write comes from the payload: ${assignLines.join(' | ')}`
    );
  });

  it('no background job or cron sweep touches case outcomes', () => {
    const offenders = [];
    for (const file of files) {
      const sql = fs.readFileSync(file, 'utf8');
      if (!/setInterval|node-cron|schedule\.scheduleJob|pg_cron/i.test(sql)) continue;
      // Server-side only: the frontend has no write path to tb_cases at all.
      if (!/^[\\/]|backend|pasig_clone/i.test(rel(file))) continue;
      // Only a process that can write rows matters; a dashboard that polls and
      // re-renders outcome labels is a read, not a verdict.
      if (!/\bUPDATE\s+\w+|\bINSERT\s+INTO\b/i.test(sql)) continue;
      if (/outcome_status/.test(sql)) offenders.push(rel(file));
    }
    assert.deepStrictEqual(offenders, [], 'nothing scheduled may decide an outcome');
  });

  it('nothing converts elapsed follow-up time into a CURED verdict in JS', () => {
    const offenders = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/['"`]CURED['"`]/.test(line)) return;
        if (/\b\d+\s*(days|months|weeks)\b/i.test(line) || /\bINTERVAL\b/i.test(line)
          || /\belapsed\b/i.test(line) || /\bdiff\b/i.test(line)) {
          offenders.push(`${rel(file)}:${i + 1}: ${line.trim().slice(0, 140)}`);
        }
      });
    }
    assert.deepStrictEqual(offenders, [], 'a duration must never become a CURED');
  });
});
