const express = require('express');
const router = express.Router();
const { validateBatch } = require('../services/validator');
const { logAuditEvent } = require('../utils/auditLogger');
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');

router.post('/validate/:batchId', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { batchId } = req.params;

    // Run validation
    const results = await validateBatch(batchId);

    // Update batch with validation tracking
    await db.pool.query(
      `UPDATE import_batches
       SET validated_by = $1, validated_at = NOW(), status = 'validated', valid_count = $2, error_count = $3
       WHERE id = $4`,
      [req.user.id, results.valid, results.invalid, batchId]
    );

    // Log audit event
    await logAuditEvent({
      userId: req.user.id,
      action: 'VALIDATE_BATCH',
      resourceType: 'import_batch',
      resourceId: batchId,
      result: 'SUCCESS',
      details: { valid: results.valid, invalid: results.invalid, warnings: results.warnings },
    });

    console.log(`✅ Batch ${batchId} validated: ${results.valid} valid, ${results.invalid} invalid`);

    res.json({
      message: 'Validation complete',
      summary: {
        total: results.total,
        valid: results.valid,
        invalid: results.invalid,
        warnings: results.warnings,
        cleaned: results.cleaned,
        nonPasig: results.nonPasig,
        skippedBlank: results.skippedBlank,
        validatedBy: req.user.username,
        validatedAt: new Date().toISOString(),
      },
      errors: results.errors,
      warningDetails: results.validatedRecords
        .filter(r => r.warnings && r.warnings.length > 0)
        .slice(0, 200)
        .map(r => ({ row: r.row_number, source_type: r.source_type, warnings: r.warnings })),
    });
  } catch (error) {
    console.error('❌ Validation error:', error);
    await logAuditEvent({
      userId: req.user.id,
      action: 'VALIDATE_BATCH',
      resourceType: 'import_batch',
      resourceId: req.params.batchId,
      result: 'FAILURE',
      details: { error: error.message },
    });
    res.status(500).json({ error: 'Validation failed' });
  }
});

module.exports = router;
