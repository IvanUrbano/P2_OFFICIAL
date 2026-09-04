const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseExcel, validateCase } = require('../services/multiSheetParser');
const { sendPendingCases } = require('../services/webhookSender');
const db = require('../db/pasigSchema');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      const ext = path.extname(file.originalname);
      cb(null, `pasig_${timestamp}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const allowed = ['.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx and .xls files are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const parsed = await parseExcel(filePath);
    const stats = { DSTB: { total: 0, valid: 0, errors: [] }, MN: { total: 0, valid: 0, errors: [] } };

    for (const row of parsed.DSTB) {
      stats.DSTB.total++;
      const validation = validateCase(row, 'DSTB');
      if (validation.valid) {
        await db.insertCase('DSTB', row, { sourceFile: req.file.filename });
        stats.DSTB.valid++;
      } else {
        stats.DSTB.errors.push({ row: stats.DSTB.total, errors: validation.errors });
      }
    }

    for (const row of parsed.MN) {
      stats.MN.total++;
      const validation = validateCase(row, 'MN');
      if (validation.valid) {
        await db.insertCase('MN', row, { sourceFile: req.file.filename });
        stats.MN.valid++;
      } else {
        stats.MN.errors.push({ row: stats.MN.total, errors: validation.errors });
      }
    }

    res.json({
      message: 'File processed',
      file: req.file.filename,
      stats,
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/cases', async (req, res) => {
  try {
    const result = await db.getAllCases();
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cases/pending', async (req, res) => {
  try {
    const result = await db.getPendingCases();
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhook/send', async (req, res) => {
  try {
    const result = await sendPendingCases();
    res.json({
      message: `Webhook sent: ${result.sent}/${result.total} cases`,
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const total = await db.pool.query(`SELECT COUNT(*) FROM pasig_clone.cases`);
    const pending = await db.pool.query(`SELECT COUNT(*) FROM pasig_clone.cases WHERE webhook_sent = FALSE`);
    const sent = await db.pool.query(`SELECT COUNT(*) FROM pasig_clone.cases WHERE webhook_sent = TRUE`);
    const dstb = await db.pool.query(`SELECT COUNT(*) FROM pasig_clone.cases WHERE dataset = 'DSTB'`);
    const mn = await db.pool.query(`SELECT COUNT(*) FROM pasig_clone.cases WHERE dataset = 'MN'`);

    res.json({
      total: parseInt(total.rows[0].count),
      pending: parseInt(pending.rows[0].count),
      sent: parseInt(sent.rows[0].count),
      byDataset: {
        DSTB: parseInt(dstb.rows[0].count),
        MN: parseInt(mn.rows[0].count),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
