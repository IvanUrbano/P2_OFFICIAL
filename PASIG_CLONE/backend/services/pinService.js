/**
 * Records PIN — a second factor for viewing identifiable patient information.
 *
 * Patient names and dates of birth are hidden (masked) in every response unless the user
 * has unlocked them with their personal PIN. A correct PIN sets a short-lived httpOnly
 * cookie (15 minutes). Five wrong PINs lock PIN entry for 15 minutes. PINs are stored
 * bcrypt-hashed, keyed by the user id from the shared auth database.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/pasigSchema');

const UNLOCK_MINUTES = 15;
const MAX_FAILED = 5;
const LOCKOUT_MINUTES = 15;
const COOKIE = 'records_pin';
const PURPOSE = 'records-pin';

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = db.pool.query(`
      CREATE TABLE IF NOT EXISTS user_pins (
        user_id INTEGER PRIMARY KEY,
        pin_hash TEXT NOT NULL,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TIMESTAMP,
        updated_at TIMESTAMP DEFAULT NOW()
      )`).catch((err) => { tableReady = null; throw err; });
  }
  return tableReady;
}

const isValidPin = (pin) => /^\d{4,6}$/.test(String(pin || ''));

async function getPinRow(userId) {
  await ensureTable();
  return (await db.pool.query('SELECT * FROM user_pins WHERE user_id = $1', [userId])).rows[0] || null;
}

async function setPin(userId, pin) {
  await ensureTable();
  const hash = await bcrypt.hash(String(pin), 10);
  await db.pool.query(
    `INSERT INTO user_pins (user_id, pin_hash, failed_attempts, locked_until, updated_at)
     VALUES ($1, $2, 0, NULL, NOW())
     ON CONFLICT (user_id) DO UPDATE SET pin_hash = $2, failed_attempts = 0, locked_until = NULL, updated_at = NOW()`,
    [userId, hash]
  );
}

/** @returns { ok } | { ok:false, reason:'no_pin'|'locked'|'wrong', lockedUntil?, attemptsLeft? } */
async function verifyPin(userId, pin) {
  const row = await getPinRow(userId);
  if (!row) return { ok: false, reason: 'no_pin' };
  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    return { ok: false, reason: 'locked', lockedUntil: row.locked_until };
  }
  if (await bcrypt.compare(String(pin || ''), row.pin_hash)) {
    await db.pool.query('UPDATE user_pins SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1', [userId]);
    return { ok: true };
  }
  const failed = (row.locked_until ? 0 : row.failed_attempts) + 1;
  if (failed >= MAX_FAILED) {
    const until = new Date(Date.now() + LOCKOUT_MINUTES * 60000);
    await db.pool.query('UPDATE user_pins SET failed_attempts = 0, locked_until = $2 WHERE user_id = $1', [userId, until]);
    return { ok: false, reason: 'locked', lockedUntil: until };
  }
  await db.pool.query('UPDATE user_pins SET failed_attempts = $2, locked_until = NULL WHERE user_id = $1', [userId, failed]);
  return { ok: false, reason: 'wrong', attemptsLeft: MAX_FAILED - failed };
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
});

function issueUnlock(res, userId) {
  const token = jwt.sign({ sub: userId, purpose: PURPOSE }, config.jwt.secret, { expiresIn: `${UNLOCK_MINUTES}m` });
  res.cookie(COOKIE, token, { ...cookieOptions(), maxAge: UNLOCK_MINUTES * 60000 });
  return new Date(Date.now() + UNLOCK_MINUTES * 60000);
}

function clearUnlock(res) {
  res.clearCookie(COOKIE, cookieOptions());
}

/** Unlock expiry (Date) when this request's user has unlocked names, otherwise null. */
function unlockedUntil(req) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token || !req.user) return null;
  try {
    const p = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
    if (p.purpose !== PURPOSE || Number(p.sub) !== Number(req.user.id)) return null;
    return new Date(p.exp * 1000);
  } catch {
    return null;
  }
}

const isUnlocked = (req) => unlockedUntil(req) !== null;

const maskName = (v) => (v ? `${String(v).trim().charAt(0).toUpperCase()}•••` : v);

/** Hide name and date of birth on a record (and its matched candidate, if attached). */
function maskIdentity(row) {
  if (!row) return row;
  const out = {
    ...row,
    last_name: maskName(row.last_name),
    first_name: maskName(row.first_name),
    middle_name: row.middle_name ? maskName(row.middle_name) : row.middle_name,
    date_of_birth: row.date_of_birth ? null : row.date_of_birth,
    identity_masked: true,
  };
  if (row.candidate) out.candidate = maskIdentity(row.candidate);
  return out;
}

const maskUnlessUnlocked = (req, rows) => (isUnlocked(req) ? rows : rows.map(maskIdentity));

module.exports = {
  isValidPin, getPinRow, setPin, verifyPin, issueUnlock, clearUnlock, unlockedUntil, isUnlocked,
  maskIdentity, maskUnlessUnlocked, UNLOCK_MINUTES, MAX_FAILED,
};
