const express = require('express');
const router = express.Router();
const { validateBatch } = require('../services/validator');
const { authenticate, authorizeRoles } = require('../middleware/auth');

router.post('/validate/:batchId', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { batchId } = req.params;

    const results = await validateBatch(batchId);

    res.json({
      message: 'Validation complete',
      summary: {
        total: results.total,
        valid: results.valid,
        invalid: results.invalid,
        warnings: results.warnings,
      },
      errors: results.errors,
    });
  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({ error: 'Validation failed' });
  }
});

module.exports = router;
