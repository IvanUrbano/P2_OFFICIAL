const express = require('express');
const router = express.Router();
const { logAuditEvent } = require('../utils/auditLogger');
const db = require('../db/pasigSchema');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { resolveUserScope, responsibleBarangay } = require('../policies/caseAccessPolicy');
const { ACTIONS, can, assertCaseAction, referralPermissions } = require('../policies/permissions');
const { addTransferNames } = require('../services/transferNames');
const { logReviews } = require('../services/caseFollowUp');
const pinService = require('../services/pinService');
const notifications = require('../services/notifications');

// Barangay-based referrals / transfers (see policies/caseAccessPolicy.js).
// Lifecycle: PENDING -> ACCEPTED / REJECTED / CANCELLED (all final).
//
//   pending   — sent by the barangay responsible for the case. The receiving barangay
//               sees it in its inbox WITHOUT patient identity; no record access yet.
//   accepted  — reviewed by the receiving barangay: it becomes responsible (view +
//               edit). The patient's home barangay keeps view-only access. The patient's
//               own barangay is never changed.
//   rejected  — reviewed by the receiving barangay: declined; nothing changes.
//   cancelled — withdrawn by the sending barangay before review.
//
// IDs drive transfer relationships; names are retained as display fields.

async function findBarangay(id, legacyName) {
  if (id !== undefined && id !== null && id !== '') {
    const barangayId = Number(id);
    if (!Number.isInteger(barangayId) || barangayId <= 0) return null;
    const result = await db.pool.query('SELECT id, name FROM barangay_ref WHERE id = $1', [barangayId]);
    return result.rows[0] || null;
  }
  const name = String(legacyName ?? '').trim();
  if (!name) return null;
  const result = await db.pool.query(
    'SELECT id, name FROM barangay_ref WHERE lower(trim(name)) = lower($1) LIMIT 1',
    [name]
  );
  return result.rows[0] || null;
}

async function loadTransfer(id) {
  const r = await db.pool.query('SELECT * FROM case_transfers WHERE id = $1', [id]);
  return r.rows[0] || null;
}

// ==================== INITIATE REFERRAL / TRANSFER ====================
router.post('/', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { validated_case_id, transfer_type } = req.body;
    const reason = String(req.body.reason ?? req.body.notes ?? '').trim() || null;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    const targetBarangay = await findBarangay(req.body.to_barangay_id, req.body.to_barangay);
    if (!validated_case_id || !targetBarangay) {
      return res.status(400).json({ error: 'Case and a valid receiving barangay are required.' });
    }
    const toBarangayId = Number(targetBarangay.id);
    const toBarangay = targetBarangay.name;
    if (!['referral', 'transfer'].includes(transfer_type)) {
      return res.status(400).json({ error: 'Transfer type must be "referral" or "transfer".' });
    }

    // Optional, informational: the facility in the receiving barangay that will see the patient.
    let toFacilityId = null;
    if (req.body.to_facility_id !== undefined && req.body.to_facility_id !== null && req.body.to_facility_id !== '') {
      toFacilityId = Number(req.body.to_facility_id);
      const fac = await db.authPool.query('SELECT id FROM health_facilities WHERE id = $1', [toFacilityId]);
      if (!Number.isInteger(toFacilityId) || fac.rows.length === 0) {
        return res.status(400).json({ error: 'Receiving facility not found.' });
      }
    }

    const caseResult = await db.pool.query(
      `SELECT id, case_no, barangay_name, barangay_id, responsible_barangay, responsible_barangay_id,
              is_archived, match_status, merged_into_case_no
       FROM validated_tb_cases
       WHERE id = $1 AND is_archived = false AND merged_into_case_no IS NULL`,
      [validated_case_id]
    );
    if (caseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found.' });
    }
    const caseRecord = caseResult.rows[0];
    const fromBarangayId = caseRecord.responsible_barangay_id ?? caseRecord.barangay_id;
    if (fromBarangayId == null) {
      return res.status(409).json({ error: 'This case has no linked barangay ID and cannot be referred yet.' });
    }

    // Only the barangay the case is assigned to (or an admin) can refer it.
    try {
      assertCaseAction(req.user, await resolveUserScope(req.user), ACTIONS.CASE_REFER, caseRecord);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message, code: err.code });
    }

    const fromBarangay = responsibleBarangay(caseRecord);
    if (Number(fromBarangayId) === toBarangayId) {
      return res.status(400).json({ error: `${toBarangay} is already responsible for this case.` });
    }

    const open = await db.pool.query(
      `SELECT 1 FROM case_transfers WHERE validated_case_id = $1 AND status = 'pending' LIMIT 1`,
      [validated_case_id]
    );
    if (open.rows.length > 0) {
      return res.status(409).json({ error: 'This case already has a pending referral/transfer. Wait for it to be accepted, or cancel it.' });
    }

    const result = await db.pool.query(
      `INSERT INTO case_transfers
        (validated_case_id, from_barangay_id, to_barangay_id, to_facility_id, transfer_type,
         status, initiated_by_user_id, initiated_at, reason)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW(), $7)
       RETURNING *`,
      [validated_case_id, fromBarangayId, toBarangayId, toFacilityId, transfer_type, req.user.id, reason]
    );

    await logReviews(db.pool, req.user.id, [{
      validated_case_id,
      case_no: caseRecord.case_no || null,
      review_type: 'transfer',
      decision: 'sent',
      previous_status: null,
      new_status: 'pending',
      notes: reason,
    }]);

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'TRANSFER_INITIATED',
      resourceType: 'validated_tb_cases',
      resourceId: String(validated_case_id),
      result: 'SUCCESS',
      ipAddress,
      details: { transfer_id: result.rows[0].id, from_barangay: fromBarangay, to_barangay: toBarangay, transfer_type, reason },
    });

    const kind = transfer_type === 'referral' ? 'referral' : 'transfer';
    await notifications.notifyBarangay(toBarangayId, {
      type: 'referral_received', severity: 'warning', actorId: req.user.id,
      title: `Incoming ${kind} from ${fromBarangay || 'another barangay'}`,
      message: `Case ${caseRecord.case_no || `#${validated_case_id}`} was sent to ${toBarangay}${reason ? ` — "${reason.slice(0, 140)}"` : ''}. Accept or reject it in Incoming Referrals.`,
      link: '/records?view=referrals', entityType: 'case_transfer', entityId: result.rows[0].id,
    });

    res.status(201).json({
      message: `${transfer_type === 'referral' ? 'Referral' : 'Transfer'} sent to ${toBarangay}. It takes effect when ${toBarangay} accepts it.`,
      transfer: result.rows[0],
    });
  } catch (error) {
    // uq_case_transfers_one_pending: someone referred this case at the same moment.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This case already has a pending referral/transfer. Wait for it to be accepted, or cancel it.' });
    }
    console.error('Error initiating transfer:', error);
    res.status(500).json({ error: 'Failed to initiate transfer.' });
  }
});

// ==================== ACCEPT (review) ====================
// The receiving barangay accepts: it becomes responsible for the case.
router.put('/:id/accept', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { id } = req.params;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    const transfer = await loadTransfer(id);
    if (!transfer) return res.status(404).json({ error: 'Transfer not found.' });
    if (transfer.status !== 'pending') {
      return res.status(400).json({ error: `Cannot accept a ${transfer.status} referral/transfer.` });
    }
    if (transfer.to_barangay_id == null) {
      return res.status(400).json({ error: 'This older transfer has no receiving barangay. Ask an admin to re-send it.' });
    }
    if (!can(req.user, await resolveUserScope(req.user), ACTIONS.REFERRAL_ACCEPT, transfer)) {
      return res.status(403).json({ error: `Only ${transfer.to_barangay} can accept this referral/transfer.` });
    }

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE case_transfers
       SET status = 'accepted', reviewed_by_user_id = $1, reviewed_at = NOW()
       WHERE id = $2 AND status = 'pending' RETURNING *`,
      [req.user.id, id]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This referral/transfer was already handled.' });
    }
    // History needs the case as it is BEFORE responsibility moves.
    const caseRow = (await client.query(
      'SELECT case_no, barangay_id, responsible_barangay_id FROM validated_tb_cases WHERE id = $1',
      [transfer.validated_case_id]
    )).rows[0] || {};
    // Responsibility moves. Back to the patient's own barangay = clear the override.
    await client.query(
      `UPDATE validated_tb_cases
        SET responsible_barangay_id = CASE WHEN barangay_id = $1 THEN NULL ELSE $1 END
       WHERE id = $2`,
            [transfer.to_barangay_id, transfer.validated_case_id]
    );
    // History: the review decision and the responsibility change it caused.
    await logReviews(client, req.user.id, [{
      validated_case_id: transfer.validated_case_id,
      case_no: caseRow.case_no || null,
      review_type: 'transfer',
      decision: 'accepted',
      previous_status: 'pending',
      new_status: 'accepted',
      notes: transfer.reason || null,
    }]);
    const newStoredId = caseRow.barangay_id === transfer.to_barangay_id ? null : transfer.to_barangay_id;
    await client.query(
      `INSERT INTO case_history
         (validated_case_id, case_no, change_type, changed_fields, source, changed_by_user_id, notes)
       VALUES ($1, $2, 'transferred',
               $3::jsonb, 'transfer', $4,
               $5)`,
      [
        transfer.validated_case_id,
        caseRow.case_no || null,
        JSON.stringify({
          responsible_barangay: { old: transfer.from_barangay || null, new: transfer.to_barangay || null },
          responsible_barangay_id: { old: caseRow.responsible_barangay_id ?? null, new: newStoredId },
        }),
        req.user.id,
        `Responsibility changed: ${transfer.from_barangay || 'unassigned'} -> ${transfer.to_barangay} (referral accepted by ${req.user.username})`,
      ]
    );
    await client.query('COMMIT');

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'TRANSFER_ACCEPTED',
      resourceType: 'case_transfers',
      resourceId: String(id),
      result: 'SUCCESS',
      ipAddress,
      details: {
        validated_case_id: transfer.validated_case_id,
        from_barangay: transfer.from_barangay,
        to_barangay: transfer.to_barangay,
      },
    });

    await notifications.resolveEntity('case_transfer', id, ['referral_received']);
    await notifications.notify(
      [transfer.initiated_by_user_id, ...(await notifications.barangayStaff(transfer.from_barangay_id))], {
        type: 'referral_accepted', severity: 'success', actorId: req.user.id,
        title: `${transfer.to_barangay} accepted a referral`,
        message: `Case ${caseRow.case_no || `#${transfer.validated_case_id}`} is now managed by ${transfer.to_barangay}. Your barangay keeps view-only access.`,
        link: `/records?record=${transfer.validated_case_id}`, entityType: 'case_transfer', entityId: id,
      });

    res.json({ message: `Accepted. ${transfer.to_barangay} is now responsible for this case.`, transfer: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error accepting transfer:', error);
    res.status(500).json({ error: 'Failed to accept transfer.' });
  } finally {
    client.release();
  }
});

// ==================== CANCEL (sender) / REJECT (receiver) ====================
// While pending: the sending barangay withdraws it (cancelled), or the receiving
// barangay declines it (rejected). Either way reviewed_by/at record who closed it.
router.put('/:id/cancel', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { id } = req.params;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    const transfer = await loadTransfer(id);
    if (!transfer) return res.status(404).json({ error: 'Transfer not found.' });
    if (transfer.status !== 'pending') {
      return res.status(400).json({ error: 'Only a pending referral/transfer can be cancelled or declined.' });
    }

    const perms = referralPermissions(req.user, await resolveUserScope(req.user), transfer);
    // ?action=reject is the receiver's review decision; otherwise the sender withdraws
    // (a receiver using plain cancel is treated as rejecting).
    const declined = req.query.action === 'reject' ? perms.reject : (!perms.cancel && perms.reject);
    if (req.query.action === 'reject' ? !perms.reject : !(perms.cancel || perms.reject)) {
      return res.status(403).json({ error: 'Only the sending or receiving barangay can cancel or reject this referral/transfer.' });
    }

    const result = declined
      ? await db.pool.query(
        `UPDATE case_transfers SET status = 'rejected', reviewed_by_user_id = $1, reviewed_at = NOW()
         WHERE id = $2 AND status = 'pending' RETURNING *`,
        [req.user.id, id]
      )
      : await db.pool.query(
        `UPDATE case_transfers SET status = 'cancelled', reviewed_by_user_id = $1, reviewed_at = NOW()
         WHERE id = $2 AND status = 'pending' RETURNING *`,
        [req.user.id, id]
      );
    if (result.rows.length === 0) return res.status(409).json({ error: 'This referral/transfer was already handled.' });

    const closed = result.rows[0];
    const closedCaseNo = ((await db.pool.query('SELECT case_no FROM validated_tb_cases WHERE id = $1', [transfer.validated_case_id])).rows[0] || {}).case_no || null;
    await logReviews(db.pool, req.user.id, [{
      validated_case_id: transfer.validated_case_id,
      case_no: closedCaseNo,
      review_type: 'transfer',
      decision: declined ? 'rejected' : 'cancelled',
      previous_status: 'pending',
      new_status: closed.status,
      notes: transfer.reason || null,
    }]);

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: declined ? 'TRANSFER_REJECTED' : 'TRANSFER_CANCELLED',
      resourceType: 'case_transfers',
      resourceId: String(id),
      result: 'SUCCESS',
      ipAddress,
      details: { validated_case_id: transfer.validated_case_id, from_barangay: transfer.from_barangay, to_barangay: transfer.to_barangay },
    });

    await notifications.resolveEntity('case_transfer', id, ['referral_received']);
    const caseLabel = closedCaseNo || `#${transfer.validated_case_id}`;
    if (declined) {
      await notifications.notify(
        [transfer.initiated_by_user_id, ...(await notifications.barangayStaff(transfer.from_barangay_id))], {
          type: 'referral_rejected', severity: 'danger', actorId: req.user.id,
          title: `${transfer.to_barangay} rejected a referral`,
          message: `Case ${caseLabel} stays with your barangay. You can refer it again to another barangay.`,
          link: `/records?record=${transfer.validated_case_id}`, entityType: 'case_transfer', entityId: id,
        });
    } else {
      await notifications.notify(await notifications.barangayStaff(transfer.to_barangay_id), {
        type: 'referral_cancelled', severity: 'info', actorId: req.user.id,
        title: `${transfer.from_barangay || 'The sending barangay'} cancelled a referral`,
        message: `The referral of case ${caseLabel} to ${transfer.to_barangay} was withdrawn. No action needed.`,
        link: '/records?view=referrals', entityType: 'case_transfer', entityId: id,
      });
    }

    res.json({ message: declined ? 'Referral/transfer rejected.' : 'Referral/transfer cancelled.', transfer: result.rows[0] });
  } catch (error) {
    console.error('Error cancelling transfer:', error);
    res.status(500).json({ error: 'Failed to cancel transfer.' });
  }
});

// ==================== LIST ====================
// Admin: all. Staff: referrals sent from or to their barangay (?direction=incoming|outgoing
// narrows it). Each row carries the user's permissions on it (policies/permissions.js),
// and patient identity only where the user may view the case (a pending incoming referral
// shows the case ID, barangay and reason — no name).
router.get('/', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const scope = await resolveUserScope(req.user);
    let where = '1=1';
    const params = [];

    const direction = ['incoming', 'outgoing'].includes(req.query.direction) ? req.query.direction : null;
    if (!isAdmin) {
      if (!scope || scope.barangay_id == null) return res.json({ transfers: [], barangay: scope?.barangay_name || null });
      params.push(scope.barangay_id);
      const n = `$${params.length}`;
      where += direction === 'incoming' ? ` AND ct.to_barangay_id = ${n}`
        : direction === 'outgoing' ? ` AND ct.from_barangay_id = ${n}`
          : ` AND (ct.from_barangay_id = ${n} OR ct.to_barangay_id = ${n})`;
    }
    if (req.query.status) {
      params.push(req.query.status);
      where += ` AND ct.status = $${params.length}`;
    }

    const result = await db.pool.query(
      `SELECT ct.*,
              vtc.case_no, p.patient_no, vtc.last_name, vtc.first_name, vtc.middle_name, vtc.suffix, vtc.identity_class,
              vtc.barangay_name, vtc.barangay_id, vtc.responsible_barangay, vtc.responsible_barangay_id,
              vtc.date_of_diagnosis, vtc.source_type, vtc.outcome_status
       FROM case_transfers ct
       LEFT JOIN validated_tb_cases vtc ON ct.validated_case_id = vtc.id
       LEFT JOIN patients p ON p.id = vtc.patient_id
       WHERE ${where}
       ORDER BY (ct.status = 'pending') DESC, ct.created_at DESC
       LIMIT 200`,
      params
    );

    const unlocked = pinService.isUnlocked(req);
    const rows = (await addTransferNames(result.rows)).map((t) => {
      const permissions = referralPermissions(req.user, scope, t);
      const row = { ...t, direction: permissions.direction, permissions };
      if (!permissions.viewCase) {
        return {
          ...row,
          last_name: null, first_name: null, middle_name: null, suffix: null, date_of_birth: null,
          identity_hidden: true,
        };
      }
      return pinService.protectIdentity(req, row);
    });

    res.json({ transfers: rows, barangay: scope?.barangay_name || null });
  } catch (error) {
    console.error('Error fetching transfers:', error);
    res.status(500).json({ error: 'Failed to fetch transfers.' });
  }
});

module.exports = router;
