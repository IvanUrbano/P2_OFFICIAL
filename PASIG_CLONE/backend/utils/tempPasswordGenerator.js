/**
 * Secure temporary password generator.
 * Generates passwords in format: T8kP-4mQx-72Za
 * 16 characters: 4 groups of 4 alphanumeric separated by dashes.
 * Uses crypto.randomBytes() for cryptographic randomness.
 * Guaranteed to contain: uppercase, lowercase, digit.
 */
const crypto = require('crypto');

const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';
const ALL_CHARS = UPPERCASE + LOWERCASE + DIGITS;

function randomChar(charset) {
  const byte = crypto.randomBytes(1)[0];
  return charset[byte % charset.length];
}

function generateGroup() {
  const chars = [
    randomChar(UPPERCASE),
    randomChar(LOWERCASE),
    randomChar(DIGITS),
    randomChar(ALL_CHARS),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function generateTempPassword() {
  return [generateGroup(), generateGroup(), generateGroup(), generateGroup()].join('-');
}

module.exports = { generateTempPassword };
