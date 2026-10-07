const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const SECRET = 'operational-notifications-test';
function stub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

let parseFailure = false;
let sent = [];
stub('../config', { jwt: { secret: SECRET, expiresIn: '1h' }, webhook: {} });
stub('../services/multiSheetParser', {
  parseRegistryFile: async () => {
    if (parseFailure) throw new Error('Unreadable workbook');
    return {
      totalRecords: 2, dstbCount: 2, mnCount: 0, fileType: 'xlsx',
      sheets: [{ sheet_name: 'DSTB', source_type: 'DSTB', record_count: 2, records: [], unmapped_headers: [] }],
    };
  },
});
stub('../utils/fileHash', { calculateFileHash: () => 'file-hash' });
stub('../utils/auditLogger', { logAuditEvent: async () => {} });
stub('../services/validator', {
  validateBatch: async () => ({
    total: 5, valid: 2, invalid: 3, warnings: [], cleaned: 2, nonPasig: 0,
    skippedBlank: 0, possibleMatches: 0, errors: [], validatedRecords: [],
  }),
});
stub('../services/notifications', {
  admins: async () => [1, 2],
  barangayStaff: async () => [],
  notify: async (recipients, notification) => {
    sent.push({ recipients, notification });
    return recipients.length;
  },
});

const query = async (sql) => {
  const q = String(sql).replace(/\s+/g, ' ').trim();
  if (q.startsWith('SELECT id, filename, uploaded_by, status, created_at')) return { rows: [] };
  if (q.startsWith('INSERT INTO import_batches')) return { rows: [{ id: 'batch-1' }] };
  if (q.startsWith('SELECT id, uploaded_by FROM import_batches')) return { rows: [{ id: 'batch-1', uploaded_by: 10 }] };
  if (q.startsWith('SELECT filename FROM import_batches')) return { rows: [{ filename: 'cases.xlsx' }] };
  if (q.startsWith('SELECT COUNT(*) FILTER')) return { rows: [{ matches: 0, assignment: 2 }] };
  if (q.startsWith('SELECT v.barangay_id')) return { rows: [] };
  return { rows: [] };
};
stub('../db/pasigSchema', {
  pool: { query, connect: async () => ({ query, release() {} }) },
  authPool: { query: async () => ({ rows: [] }) },
  insertRawCases: async () => {},
});

const importRouter = require('../routes/csvImport');
const validationRouter = require('../routes/validation');
let server;
let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.files = { file: { name: 'cases.xlsx', size: 100, data: Buffer.from('test') } };
    next();
  });
  app.use('/api/data', importRouter, validationRouter);
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/data`;
});
after(() => server.close());
beforeEach(() => { parseFailure = false; sent = []; });

async function post(path) {
  const token = jwt.sign({ id: 10, username: 'staff10', role: 'staff' }, SECRET);
  const response = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  return response.status;
}

describe('operational notifications', () => {
  it('notifies the uploader after a committed file import', async () => {
    assert.equal(await post('/import'), 201);
    assert.equal(sent[0].notification.type, 'import_completed');
    assert.deepEqual(sent[0].recipients, [10]);
    assert.equal(sent[0].notification.entityId, 'batch-1');
    assert.equal(sent[0].notification.includeActor, true);
  });

  it('notifies the uploader and admins when parsing fails', async () => {
    parseFailure = true;
    assert.equal(await post('/import'), 400);
    assert.equal(sent[0].notification.type, 'import_failed');
    assert.deepEqual(sent[0].recipients, [10, 1, 2]);
  });

  it('sends validation issues to the uploader and assignment work to admins', async () => {
    assert.equal(await post('/validate/batch-1'), 200);
    assert.deepEqual(sent.map(x => x.notification.type), ['validation_issues', 'assignment_needed']);
    assert.deepEqual(sent[0].recipients, [10, 1, 2]);
    assert.deepEqual(sent[1].recipients, [1, 2]);
    assert.match(sent[1].notification.link, /tab=assignment/);
  });
});
