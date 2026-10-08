const MAX_PHOTO_BYTES = 300 * 1024;

function validateProfilePhoto(value) {
  if (typeof value !== 'string' || value.length > 420000 || !value.startsWith('data:image/jpeg;base64,')) {
    return { error: 'Choose a JPEG, PNG, or WebP image up to 5 MB.' };
  }
  const encoded = value.slice('data:image/jpeg;base64,'.length);
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return { error: 'The selected image could not be read.' };
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_PHOTO_BYTES || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    return { error: 'The profile photo must be a valid JPEG under 300 KB.' };
  }
  return { photo: value };
}

module.exports = { validateProfilePhoto };
