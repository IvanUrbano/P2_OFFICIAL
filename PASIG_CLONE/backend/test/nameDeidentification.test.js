/**
 * Patient-name privacy (migration 015, services/pinService.js):
 *   - historical records: names/DOB never returned (null + identity_deidentified), even
 *     with the Records PIN unlocked and even after names are approved
 *   - operational records: shown only when PATIENT_NAMES_ENABLED and the PIN is unlocked;
 *     otherwise masked to initials
 *   - a row without identity_class is treated as historical (fail closed)
 *   - names never decide identity: Patient # / Case ID are untouched
 * Run: node --test test/nameDeidentification.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}
const CONFIG = { jwt: { secret: 'test-deid-secret' }, patientNames: { enabled: false } };
stub('../config', CONFIG);
stub('../db/pasigSchema', { pool: { query: async () => ({ rows: [] }) } });

const pin = require('../services/pinService');

const jwt = require('jsonwebtoken');
// Build a request whose PIN cookie is valid (unlocked) or absent (locked).
const reqFor = (isUnlocked) => ({
  user: { id: 7 },
  cookies: isUnlocked ? { records_pin: jwt.sign({ sub: 7, purpose: 'records-pin' }, CONFIG.jwt.secret, { expiresIn: '15m' }) } : {},
});

const row = (cls) => ({
  id: 1, case_no: 'CS-2024-000001', patient_no: 'PT-000001', age: 41, sex: 'Male',
  last_name: 'Dela Cruz', first_name: 'Juan', middle_name: 'Santos', suffix: 'Jr', date_of_birth: '1983-02-01',
  ...(cls ? { identity_class: cls } : {}),
});

describe('patient-name privacy', () => {
  beforeEach(() => { CONFIG.patientNames.enabled = false; });

  it('historical: de-identified even when the PIN is unlocked', () => {
    const out = pin.protectIdentity(reqFor(true), row('historical'));
    for (const f of pin.IDENTITY_FIELDS) assert.strictEqual(out[f], null, f);
    assert.strictEqual(out.identity_deidentified, true);
    assert.strictEqual(out.case_no, 'CS-2024-000001', 'Case ID unchanged');
    assert.strictEqual(out.patient_no, 'PT-000001', 'Patient # unchanged');
    assert.strictEqual(out.age, 41);
  });

  it('historical: stays de-identified after names are approved', () => {
    CONFIG.patientNames.enabled = true;
    const out = pin.protectIdentity(reqFor(true), row('historical'));
    assert.strictEqual(out.last_name, null);
    assert.strictEqual(out.identity_deidentified, true);
  });

  it('no identity_class = historical (fail closed)', () => {
    CONFIG.patientNames.enabled = true;
    assert.strictEqual(pin.protectIdentity(reqFor(true), row(undefined)).last_name, null);
  });

  it('operational before approval: de-identified', () => {
    assert.strictEqual(pin.protectIdentity(reqFor(true), row('operational')).last_name, null);
  });

  it('operational after approval: initials while locked, full names once unlocked', () => {
    CONFIG.patientNames.enabled = true;
    const locked = pin.protectIdentity(reqFor(false), row('operational'));
    assert.strictEqual(locked.last_name, 'D•••');
    assert.strictEqual(locked.date_of_birth, null);
    assert.ok(!locked.identity_deidentified);
    const open = pin.protectIdentity(reqFor(true), row('operational'));
    assert.strictEqual(open.last_name, 'Dela Cruz');
    assert.strictEqual(open.date_of_birth, '1983-02-01');
  });

  it('a possible-match candidate follows its own class', () => {
    CONFIG.patientNames.enabled = true;
    const out = pin.protectIdentity(reqFor(true), { ...row('operational'), candidate: row('historical') });
    assert.strictEqual(out.last_name, 'Dela Cruz');
    assert.strictEqual(out.candidate.last_name, null);
    assert.strictEqual(out.candidate.identity_deidentified, true);
  });

  it('new batches are historical until names are approved', () => {
    assert.strictEqual(pin.identityClassForNewBatch(), 'historical');
    CONFIG.patientNames.enabled = true;
    assert.strictEqual(pin.identityClassForNewBatch(), 'operational');
  });

  it('never mutates the stored row', () => {
    const r = row('historical');
    pin.protectIdentity(reqFor(true), r);
    assert.strictEqual(r.last_name, 'Dela Cruz');
  });
});
