const express = require('express');
const router = express.Router();
const { logAuditEvent } = require('../utils/auditLogger');
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { canTransferCase } = require('../policies/caseAccessPolicy');

// ==================== INITIATE TRANSFER ====================
router.post('/', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { validated_case_id, to_facility_id, transfer_type, notes } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    if (!validated_case_id || !to_facility_id) {
      return res.status(400).json({ error: 'Case ID and receiving facility are required.' });
    }

    if (!['referral', 'transfer'].includes(transfer_type)) {
      return res.status(400).json({ error: 'Transfer type must be "referral" or "transfer".' });
    }

    // Fetch the case
    const caseResult = await db.pool.query(
      'SELECT id, current_responsible_facility_id FROM validated_tb_cases WHERE id = $1',
      [validated_case_id]
    );
    if (caseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found.' });
    }

    const caseRecord = caseResult.rows[0];

    if (!canTransferCase(req.user, caseRecord)) {
      return res.status(403).json({ error: 'Access denied. Only the current responsible facility can initiate transfers.' });
    }

    // Verify receiving facility exists
    const facResult = await db.pool.query(
      'SELECT id, name FROM health_facilities WHERE id = $1',
      [to_facility_id]
    );
    if (facResult.rows.length === 0) {
      return res.status(400).json({ error: 'Receiving facility not found.' });
    }

    // Cannot transfer to same facility
    if (caseRecord.current_responsible_facility_id === to_facility_id) {
      return res.status(400).json({ error: 'Cannot transfer to the same facility.' });
    }

    // Create transfer record
    const result = await db.pool.query(
      `INSERT INTO case_transfers (validated_case_id, from_facility_id, to_facility_id, transfer_type, status, initiated_by_user_id, notes)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)
       RETURNING *`,
      [validated_case_id, caseRecord.current_responsible_facility_id, to_facility_id, transfer_type, req.user.id, notes || null]
    );

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'TRANSFER_INITIATED',
      resourceType: 'validated_tb_cases',
      resourceId: String(validated_case_id),
      result: 'SUCCESS',
      ipAddress,
      details: {
        transfer_id: result.rows[0].id,
        from_facility_id: caseRecord.current_responsible_facility_id,
        to_facility_id,
        transfer_type,
      },
    });

    res.status(201).json({
      message: 'Transfer initiated successfully.',
      transfer: result.rows[0],
    });
  } catch (error) {
    console.error('Error initiating transfer:', error);
    res.status(500).json({ error: 'Failed to initiate transfer.' });
  }
});

// ==================== ACCEPT TRANSFER ====================
router.put('/:id/accept', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { id } = req.params;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    // Fetch transfer
    const transferResult = await db.pool.query(
      'SELECT * FROM case_transfers WHERE id = $1',
      [id]
    );
    if (transferResult.rows.length === 0) {
      return res.status(404).json({ error: 'Transfer not found.' });
    }

    const transfer = transferResult.rows[0];

    if (transfer.status !== 'pending') {
      return res.status(400).json({ error: `Cannot accept transfer with status "${transfer.status}".` });
    }

    // Only receiving facility staff or admin can accept
    if (req.user.role !== 'admin' && req.user.facility_id !== transfer.to_facility_id) {
      return res.status(403).json({ error: 'Only the receiving facility can accept this transfer.' });
    }

    const result = await db.pool.query(
      `UPDATE case_transfers SET status = 'accepted', accepted_by_user_id = $1, accepted_at = NOW()
       WHERE id = $2 RETURNING *`,
      [req.user.id, id]
    );

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'TRANSFER_ACCEPTED',
      resourceType: 'case_transfers',
      resourceId: String(id),
      result: 'SUCCESS',
      ipAddress,
      details: { validated_case_id: transfer.validated_case_id },
    });

    res.json({ message: 'Transfer accepted.', transfer: result.rows[0] });
  } catch (error) {
    console.error('Error accepting transfer:', error);
    res.status(500).json({ error: 'Failed to accept transfer.' });
  }
});

// ==================== COMPLETE TRANSFER ====================
router.put('/:id/complete', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { id } = req.params;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    // Fetch transfer
    const transferResult = await db.pool.query(
      'SELECT * FROM case_transfers WHERE id = $1',
      [id]
    );
    if (transferResult.rows.length === 0) {
      return res.status(404).json({ error: 'Transfer not found.' });
    }

    const transfer = transferResult.rows[0];

    if (transfer.status !== 'accepted') {
      return res.status(400).json({ error: `Cannot complete transfer with status "${transfer.status}".` });
    }

    // Only receiving facility staff or admin can complete
    if (req.user.role !== 'admin' && req.user.facility_id !== transfer.to_facility_id) {
      return res.status(403).json({ error: 'Only the receiving facility can complete this transfer.' });
    }

    // Update transfer status
    const result = await db.pool.query(
      `UPDATE case_transfers SET status = 'completed', completed_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );

    // Update current responsible facility on the case
    await db.pool.query(
      'UPDATE validated_tb_cases SET current_responsible_facility_id = $1 WHERE id = $2',
      [transfer.to_facility_id, transfer.validated_case_id]
    );

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'TRANSFER_COMPLETED',
      resourceType: 'case_transfers',
      resourceId: String(id),
      result: 'SUCCESS',
      ipAddress,
      details: {
        validated_case_id: transfer.validated_case_id,
        from_facility_id: transfer.from_facility_id,
        to_facility_id: transfer.to_facility_id,
      },
    });

    res.json({ message: 'Transfer completed. Case responsibility updated.', transfer: result.rows[0] });
  } catch (error) {
    console.error('Error completing transfer:', error);
    res.status(500).json({ error: 'Failed to complete transfer.' });
  }
});

// ==================== CANCEL TRANSFER ====================
router.put('/:id/cancel', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { id } = req.params;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    // Fetch transfer
    const transferResult = await db.pool.query(
      'SELECT * FROM case_transfers WHERE id = $1',
      [id]
    );
    if (transferResult.rows.length === 0) {
      return res.status(404).json({ error: 'Transfer not found.' });
    }

    const transfer = transferResult.rows[0];

    if (!['pending', 'accepted'].includes(transfer.status)) {
      return res.status(400).json({ error: `Cannot cancel transfer with status "${transfer.status}".` });
    }

    // Only admin or the initiator can cancel
    if (req.user.role !== 'admin' && req.user.id !== transfer.initiated_by_user_id) {
      return res.status(403).json({ error: 'Only the initiator or an admin can cancel this transfer.' });
    }

    const result = await db.pool.query(
      `UPDATE case_transfers SET status = 'cancelled' WHERE id = $1 RETURNING *`,
      [id]
    );

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'TRANSFER_CANCELLED',
      resourceType: 'case_transfers',
      resourceId: String(id),
      result: 'SUCCESS',
      ipAddress,
      details: { validated_case_id: transfer.validated_case_id },
    });

    res.json({ message: 'Transfer cancelled.', transfer: result.rows[0] });
  } catch (error) {
    console.error('Error cancelling transfer:', error);
    res.status(500).json({ error: 'Failed to cancel transfer.' });
  }
});

// ==================== LIST TRANSFERS ====================
router.get('/', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    let where = '1=1';
    const params = [];
    let paramIdx = 1;

    // Staff only see transfers involving their facility
    if (req.user.role !== 'admin' && req.user.facility_id) {
      where += ` AND (ct.from_facility_id = $${paramIdx} OR ct.to_facility_id = $${paramIdx})`;
      params.push(req.user.facility_id);
      paramIdx++;
    }

    if (req.query.status) {
      where += ` AND ct.status = $${paramIdx++}`;
      params.push(req.query.status);
    }

    const result = await db.pool.query(
      `SELECT ct.*,
              hf1.name AS from_facility_name,
              hf2.name AS to_facility_name,
              u1.username AS initiated_by_username,
              u2.username AS accepted_by_username,
              vtc.barangay_name, vtc.date_of_diagnosis, vtc.source_type
       FROM case_transfers ct
       LEFT JOIN health_facilities hf1 ON ct.from_facility_id = hf1.id
       LEFT JOIN health_facilities hf2 ON ct.to_facility_id = hf2.id
       LEFT JOIN users u1 ON ct.initiated_by_user_id = u1.id
       LEFT JOIN users u2 ON ct.accepted_by_user_id = u2.id
       LEFT JOIN validated_tb_cases vtc ON ct.validated_case_id = vtc.id
       WHERE ${where}
       ORDER BY ct.created_at DESC
       LIMIT 100`,
      params
    );

    res.json({ transfers: result.rows });
  } catch (error) {
    console.error('Error fetching transfers:', error);
    res.status(500).json({ error: 'Failed to fetch transfers.' });
  }
});

module.exports = router;