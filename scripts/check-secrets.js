#!/usr/bin/env node
/**
 * Blocks commits that contain credentials.
 *
 *   node scripts/check-secrets.js          scan lines added in staged changes (pre-commit hook)
 *   node scripts/check-secrets.js --all    scan every tracked file (CI)
 *
 * Both past leaks were connection strings pasted into throwaway scripts
 * (check_table.js, cleanup_*.js) and a real value written into a guide —
 * always read credentials from process.env and keep real values in .env.
 *
 * False positive? Put `secret-scan:allow` on that line.
 */
const { execSync } = require('child_process');
const fs = require('fs');

const ALLOW_MARKER = 'secret-scan:allow';

// Values that are obviously examples, not real credentials.
const PLACEHOLDER = /^(\$\{|<|\*+$|x+$)|password|passwd|your|change|replace|example|placeholder|secret|dummy|test|xxx|\.\.\./i;

const RULES = [
  {
    name: 'Neon password',
    re: /npg_[A-Za-z0-9]{8,}/,
  },
  {
    name: 'Database URL with a password',
    re: /postgres(?:ql)?:\/\/[^:\s/'"`]+:([^@\s'"`]+)@([^/\s'"`:]+)/,
    isReal: (m) => !PLACEHOLDER.test(m[1]) && !/^(localhost|127\.0\.0\.1|host|ep-xxx)/i.test(m[2]),
  },
  {
    name: 'Secret / key / token value',
    re: /\b[A-Z0-9_]*(?:SECRET|API_KEY|TOKEN|PASSWORD)\b\s*[=:]\s*['"]?([A-Za-z0-9+/_\-]{24,})/,
    isReal: (m) => !PLACEHOLDER.test(m[1]),
  },
  { name: 'Render API key', re: /\brnd_[A-Za-z0-9]{20,}/ },
  { name: 'Render deploy hook', re: /api\.render\.com\/deploy\/srv-[a-z0-9]+\?key=/ },
  { name: 'GitHub token', re: /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

// Real env files must never be committed; *.example templates are fine.
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/;
const ENV_TEMPLATE = /\.example$/;

// Never scan these (the scanner's own patterns, lockfiles, binary data).
const SKIP_FILE = /(^|\/)(scripts\/check-secrets\.js|package-lock\.json)$|\.(png|jpe?g|gif|ico|pdf|xlsx|dump|geojson)$/i;

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function findSecrets(line) {
  if (line.includes(ALLOW_MARKER)) return [];
  const hits = [];
  for (const rule of RULES) {
    const m = line.match(rule.re);
    if (m && (!rule.isReal || rule.isReal(m))) hits.push(rule.name);
  }
  return hits;
}

function mask(line) {
  return line.trim().replace(/[A-Za-z0-9+/_\-]{12,}/g, (s) => `${s.slice(0, 4)}…`).slice(0, 140);
}

function scanStaged() {
  const findings = [];
  const files = git('diff --cached --name-only --diff-filter=ACMR').split('\n').filter(Boolean);
  for (const f of files) {
    if (ENV_FILE.test(f) && !ENV_TEMPLATE.test(f)) {
      findings.push({ file: f, line: '-', rule: 'Real .env file staged', text: 'keep it local (it is gitignored)' });
    }
  }

  let file = null;
  let lineNo = 0;
  for (const raw of git('diff --cached -U0 --no-color --diff-filter=ACMR').split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.slice(4).replace(/^b\//, '');
    } else if (raw.startsWith('@@')) {
      lineNo = Number(raw.match(/\+(\d+)/)[1]);
    } else if (raw.startsWith('+') && file && !SKIP_FILE.test(file)) {
      for (const rule of findSecrets(raw.slice(1))) findings.push({ file, line: lineNo, rule, text: mask(raw.slice(1)) });
      lineNo++;
    }
  }
  return findings;
}

function scanAll() {
  const findings = [];
  for (const f of git('ls-files').split('\n').filter(Boolean)) {
    if (ENV_FILE.test(f) && !ENV_TEMPLATE.test(f)) {
      findings.push({ file: f, line: '-', rule: 'Real .env file tracked', text: 'run: git rm --cached ' + f });
      continue;
    }
    if (SKIP_FILE.test(f) || !fs.existsSync(f)) continue;
    const content = fs.readFileSync(f, 'utf8');
    if (content.includes('\0')) continue;
    content.split('\n').forEach((text, i) => {
      for (const rule of findSecrets(text)) findings.push({ file: f, line: i + 1, rule, text: mask(text) });
    });
  }
  return findings;
}

const findings = process.argv.includes('--all') ? scanAll() : scanStaged();

if (findings.length) {
  console.error('\n✖ Possible secrets found — commit blocked:\n');
  for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.rule}]\n    ${f.text}\n`);
  console.error('Move the value into a .env file and read it with process.env.');
  console.error(`If it is not a real secret, add "${ALLOW_MARKER}" in a comment on that line.\n`);
  process.exit(1);
}
