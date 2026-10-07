const express = require('express');
const router = express.Router();
const { validateBatch } = require('../services/validator');
const { logAuditEvent } = require('../utils/auditLogger');
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const notifications = require('../services/notifications');
const { LIVE, NEEDS_LOCATION, NEEDS_FACILITY, MATCH_PENDING, READY } = require('../services/validationQueue');

// After a batch is validated: admins learn what still needs review on the Validation
// page; each barangay's staff learn how many cases from the file are now theirs.
async function notifyValidated(batchId, results, user) {
  try {
    const batch = (await db.pool.query('SELECT filename FROM import_batches WHERE id = $1', [batchId])).rows[0] || {};
    const file = batch.filename || 'Import';
    const c = (await db.pool.query(
      `SELECT COUNT(*) FILTER (WHERE ${MATCH_PENDING})::int AS matches,
              COUNT(*) FILTER (WHERE ${NEEDS_LOCATION} OR ${NEEDS_FACILITY})::int AS assignment
       FROM validated_tb_cases v WHERE v.batch_id = $1 AND ${LIVE}`,
      [batchId]
    )).rows[0];
    const issues = Number(results.invalid) || 0;
    const assignment = Number(c.assignment) || 0;
    const matches = Number(c.matches) || 0;
    let adminIds = [];
    try { adminIds = await notifications.admins(); }
    catch (err) { console.error('[notifications] admin lookup failed:', err.message); }
    const reviewers = [user.id, ...adminIds];
    const base = { actorId: user.id, includeActor: true, entityType: 'import_batch', entityId: batchId };
    if (issues > 0) {
      await notifications.notify(reviewers, {
        ...base, type: 'validation_issues', severity: 'warning',
        title: `${file}: ${issues} validation issue${issues === 1 ? '' : 's'}`,
        message: 'Review and resolve the data issues before syncing.',
        link: `/validation?batchId=${batchId}&tab=issues`,
      });
    }
    if (assignment > 0) {
      await notifications.notify(adminIds, {
        ...base, type: 'assignment_needed', severity: 'warning',
        title: `${file}: ${assignment} case${assignment === 1 ? '' : 's'} need assignment`,
        message: 'Assign the missing location or facility information.',
        link: `/validation?batchId=${batchId}&tab=assignment`,
      });
    }
    if (matches > 0 || (!issues && !assignment)) {
      await notifications.notify(reviewers, {
        ...base, type: 'validation_summary', severity: matches ? 'warning' : 'success',
        title: matches
          ? `${file}: ${matches} possible match${matches === 1 ? '' : 'es'} need review`
          : `${file} validated`,
        message: matches
          ? 'Review possible patient matches before syncing.'
          : `All ${results.valid} records are ready to sync.`,
        link: `/validation?batchId=${batchId}${matches ? '&tab=matches' : ''}`,
      });
    }

    const perBarangay = (await db.pool.query(
      `SELECT v.barangay_id, COUNT(*)::int AS n FROM validated_tb_cases v
       WHERE v.batch_id = $1 AND ${LIVE} AND ${READY} AND v.barangay_id IS NOT NULL
       GROUP BY v.barangay_id`,
      [batchId]
    )).rows;
    for (const b of perBarangay) {
      await notifications.notify(await notifications.barangayStaff(b.barangay_id), {
        type: 'case_assigned', severity: 'info', actorId: user.id,
        title: `${b.n} new TB case${b.n === 1 ? '' : 's'} in your barangay`,
        message: `From ${file}. They are now listed in All Records.`,
        link: '/records', entityType: 'import_batch', entityId: batchId,
      });
    }
  } catch (err) {
    console.error('[notifications] validation summary failed:', err.message);
  }
}

router.post('/validate/:batchId', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { batchId } = req.params;

    // Running validation writes validated_by / status onto the batch, so it is a
    // batch-level action: the uploader of the file, or an administrator. Uploading a
    // batch is NOT what grants edit rights on the rows inside it — those stay with the
    // record's barangay (policies/permissions.js).
    const batch = (await db.pool.query('SELECT id, uploaded_by FROM import_batches WHERE id = $1', [batchId])).rows[0];
    if (!batch) return res.status(404).json({ error: 'Batch not found.' });
    if (req.user.role !== 'admin' && Number(batch.uploaded_by) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Only the uploader or an administrator can validate this batch.' });
    }

    // Run validation (the acting user decides any auto-merge on a Case ID match)
    const results = await validateBatch(batchId, req.user);

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
    await notifyValidated(batchId, results, req.user);

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
        possibleMatches: results.possibleMatches,
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
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Validation failed' });
  }
});

module.exports = router;
