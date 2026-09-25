/**
 * File Hash Utility
 * Generates SHA256 checksums for duplicate file detection
 */

const crypto = require('crypto');

/**
 * Calculate SHA256 hash of file buffer
 * @param {Buffer} fileBuffer - File content as buffer
 * @returns {string} SHA256 hash in hex format
 */
function calculateFileHash(fileBuffer) {
  if (!Buffer.isBuffer(fileBuffer)) {
    throw new Error('Input must be a Buffer');
  }

  return crypto
    .createHash('sha256')
    .update(fileBuffer)
    .digest('hex');
}

/**
 * Verify a file hasn't been corrupted using its hash
 * @param {Buffer} fileBuffer - File content to verify
 * @param {string} expectedHash - Expected SHA256 hash
 * @returns {boolean} True if hashes match
 */
function verifyFileHash(fileBuffer, expectedHash) {
  const calculatedHash = calculateFileHash(fileBuffer);
  return crypto.timingSafeEqual(
    Buffer.from(calculatedHash, 'hex'),
    Buffer.from(expectedHash, 'hex')
  );
}

module.exports = {
  calculateFileHash,
  verifyFileHash,
};
