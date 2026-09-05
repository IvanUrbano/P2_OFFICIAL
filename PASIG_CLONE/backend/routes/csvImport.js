const express = require('express');
const router = express.Router();
const fileUpload = require('express-fileupload');
const { parseMultiSheetExcel } = require('../services/multiSheetParser');
const db = require('../db/pasigSchema');
const { authorizeRoles } = require('../middleware/auth');

router.use(fileUpload());

router.post('/import', authorizeRoles('admin', 'staff'), async (req, res) => {
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

    const batchResult = await db.insertBatch(
      file.name,
      req.user.id,
      parsed.totalRecords,
      parsed.dstbCount,
      parsed.mnCount
    );

    const batchId = batchResult.rows[0].id;

    for (const sheet of parsed.sheets) {
      for (const record of sheet.records) {
        await db.insertRawCase(batchId, sheet.sheet_name, sheet.source_type, record.row_number, record);
      }
    }

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
    console.error('CSV import error:', error);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

router.get('/batches', authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const result = await db.getBatches();
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

router.get('/batches/:id', authorizeRoles('admin', 'staff'), async (req, res) => {
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
