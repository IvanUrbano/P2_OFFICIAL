/**
 * Password policy validation.
 * Requirements: 8+ chars, 1 uppercase, 1 lowercase, 1 number.
 * Returns an array of error strings (empty = valid).
 */
function validatePassword(password) {
  const errors = [];

  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters long.');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter.');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter.');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number.');
  }

  return errors;
}

module.exports = { validatePassword };
