const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const dbPath = require.resolve('../db/pasigSchema');
const authPath = require.resolve('../middleware/auth');
const routePath = require.resolve('../routes/auth');
const photo = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9]).toString('base64')}`;

function appWithPhotoStore() {
  let saved = null;
  const authPool = { query: async (sql, params) => {
    if (String(sql).startsWith('UPDATE users SET profile_photo_data = $1')) { saved = params[0]; return { rows: [{ id: 5 }] }; }
    if (String(sql).startsWith('UPDATE users SET profile_photo_data = NULL')) { saved = null; return { rows: [{ id: 5 }] }; }
    if (String(sql).startsWith('SELECT profile_photo_data')) return { rows: [{ profile_photo_data: saved }] };
    return { rows: [{ id: 5, username: 'staff5', role: 'staff' }] };
  } };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { authPool, pool: authPool } };
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
    authenticate: (req, _res, next) => { req.user = { id: 5, username: 'staff5', role: 'staff' }; next(); },
    authorizeRoles: () => (_req, _res, next) => next(),
  } };
  delete require.cache[routePath];
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  return app;
}

describe('Pasig profile photo', () => {
  it('uploads, returns, and removes the current account photo', async () => {
    const app = appWithPhotoStore();
    const upload = await request(app).put('/api/auth/profile/photo').send({ photo });
    assert.equal(upload.status, 200);
    const profile = await request(app).get('/api/auth/profile');
    assert.equal(profile.body.user.profile_photo_data, photo);
    const removed = await request(app).delete('/api/auth/profile/photo');
    assert.equal(removed.status, 200);
    const after = await request(app).get('/api/auth/profile');
    assert.equal(after.body.user.profile_photo_data, null);
  });

  it('rejects a non-JPEG payload', async () => {
    const app = appWithPhotoStore();
    const res = await request(app).put('/api/auth/profile/photo').send({ photo: 'data:image/svg+xml;base64,PHN2Zz4=' });
    assert.equal(res.status, 400);
  });
});
