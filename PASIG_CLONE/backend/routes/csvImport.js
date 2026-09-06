const express = require('express');
const router = express.Router();
const fileUpload = require('express-fileupload');
const { parseMultiSheetExcel } = require('../services/multiSheetParser');
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');

router.use(fileUpload());

router.post('/import', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.files.file;
    const maxSize = 50 * 1024 * 1024;

    if (file.size > maxSize) {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }

    // Validate file extension — only .xlsx and .xls are supported
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls'].includes(ext)) {
      return res.status(400).json({ error: 'Unsupported file type. Only .xlsx and .xls files are accepted.' });
    }

    const parsed = parseMultiSheetExcel(file.data, file.name);

    const warnings = [];
    if (parsed.dstbCount === 0) warnings.push('Required DSTB sheet missing');
    if (parsed.mnCount === 0) warnings.push('Required MN sheet missing');

    await client.query('BEGIN');

    const batchResult = await client.query(
      `INSERT INTO import_batches (filename, uploaded_by, total_rows, dstb_count, mn_count)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [file.name, req.user.id, parsed.totalRecords, parsed.dstbCount, parsed.mnCount]
    );

    const batchId = batchResult.rows[0].id;

    const allRecords = [];
    for (const sheet of parsed.sheets) {
      for (const record of sheet.records) {
        allRecords.push({
          sheet_name: sheet.sheet_name,
          source_type: sheet.source_type,
          row_number: record.row_number,
          csv_data: record,
        });
      }
    }
    db.insertRawCases(client, batchId, allRecords);

    await client.query('COMMIT');

    res.status(201).json({
      message: 'File uploaded successfully',
      batch: {
        id: batchId,
        filename: file.name,
        totalRows: parsed.totalRecords,
        dstbCount: parsed.dstbCount,
        mnCount: parsed.mnCount,
      },
      sheets: parsed.sheets.map(s => ({
        name: s.sheet_name,
        sourceType: s.source_type,
        recordCount: s.record_count,
      })),
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('CSV import error:', error);
    res.status(500).json({ error: 'Failed to process file' });
  } finally {
    client.release();
  }
});

router.get('/batches', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const result = await db.getBatches();
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

router.get('/batches/:id', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { id } = req.params;

    const batchResult = await db.getBatch(id);
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const recordsResult = await db.getRawCases(id);

    res.json({
      batch: batchResult.rows[0],
      records: recordsResult.rows,
    });
  } catch (error) {
    console.error('Error fetching batch:', error);
    res.status(500).json({ error: 'Failed to fetch batch' });
  }
});

module.exports = router;
