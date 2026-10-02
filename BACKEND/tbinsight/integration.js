const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { rebuildAllAggregations } = require('./aggregateMonthly');
const { flagPossibleDuplicates } = require('./duplicateFlags');
const { schedulePipelineRun } = require('./pipeline');

// ==================== INTEGRATION STATUS ====================
router.get('/status', authenticateToken, async (req, res) => {
  try {
    // Check if webhook_logs table exists
    const tableCheck = await pool.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'webhook_logs')"
    );
    if (!tableCheck.rows[0].exists) {
      return res.json({
        connected: false,
        status: 'waiting',
        message: 'No synchronization data available.',
        lastSync: null,
      });
    }

    // Get the most recent successful sync
    const lastSyncResult = await pool.query(
      `SELECT batch_id, records_received, records_imported, received_at, status
       FROM webhook_logs
       WHERE status = 'processed'
       ORDER BY received_at DESC LIMIT 1`
    );

    // Get total sync counts
    const statsResult = await pool.query(
      `SELECT
         COUNT(*)::int AS total_batches,
         COALESCE(SUM(records_received), 0)::int AS total_received,
         COALESCE(SUM(records_imported), 0)::int AS total_imported,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_batches
       FROM webhook_logs`
    );

    const stats = statsResult.rows[0];
    const lastSync = lastSyncResult.rows[0] || null;

    // Determine connection status based on last sync
    let connectionStatus = 'waiting';
    let statusMessage = 'No data received yet.';

    if (lastSync) {
      const hoursSinceLastSync = (Date.now() - new Date(lastSync.received_at).getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastSync < 24) {
        connectionStatus = 'connected';
        statusMessage = 'PASIG TB-IS is actively sending data.';
      } else if (hoursSinceLastSync < 168) {
        connectionStatus = 'connected';
        statusMessage = 'Last synchronization was within the past week.';
      } else {
        connectionStatus = 'standby';
        statusMessage = 'Last synchronization was over a week ago.';
      }
    }

    res.json({
      connected: connectionStatus !== 'waiting',
      status: connectionStatus,
      message: statusMessage,
      lastSync: lastSync ? {
        batchId: lastSync.batch_id,
        records: lastSync.records_received,
        accepted: lastSync.records_imported,
        receivedAt: lastSync.received_at,
      } : null,
      stats: {
        totalBatches: stats.total_batches,
        totalReceived: stats.total_received,
        totalImported: stats.total_imported,
        failedBatches: stats.failed_batches,
      },
    });
  } catch (err) {
    console.error('Integration status error:', err.message);
    res.status(500).json({ error: 'Unable to load integration status.' });
  }
});

// ==================== SYNC HISTORY ====================
router.get('/sync-history', authenticateToken, async (req, res) => {
  try {
    const tableCheck = await pool.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'webhook_logs')"
    );
    if (!tableCheck.rows[0].exists) {
      return res.json({ batches: [] });
    }

    const result = await pool.query(
      `SELECT id, source, batch_id, status, records_received, records_imported,
              error_message, received_at, processed_at
       FROM webhook_logs
       ORDER BY received_at DESC
       LIMIT 50`
    );

    const batches = result.rows.map(row => ({
      id: row.id,
      source: row.source,
      batchId: row.batch_id,
      status: row.status === 'processed' ? 'successful' : row.status === 'failed' ? 'failed' : row.status,
      records: row.records_received || 0,
      accepted: row.records_imported || 0,
      rejected: (row.records_received || 0) - (row.records_imported || 0),
      errorMessage: row.error_message,
      receivedAt: row.received_at,
      processedAt: row.processed_at,
    }));

    res.json({ batches });
  } catch (err) {
    console.error('Sync history error:', err.message);
    res.status(500).json({ error: 'Unable to load sync history.' });
  }
});

// ==================== SYNC DETAILS ====================
router.get('/sync/:batchId', authenticateToken, async (req, res) => {
  try {
    const { batchId } = req.params;

    const tableCheck = await pool.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'webhook_logs')"
    );
    if (!tableCheck.rows[0].exists) {
      return res.status(404).json({ error: 'Sync record not found.' });
    }

    const result = await pool.query(
      `SELECT * FROM webhook_logs WHERE batch_id = $1`,
      [batchId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sync record not found.' });
    }

    const row = result.rows[0];

    // Count rejected records if available
    let rejectedRecords = [];
    try {
      const rejectedResult = await pool.query(
        `SELECT id, barangay_name, source_type, date_of_diagnosis, sex, age
         FROM tb_cases
         WHERE batch_id = $1
         AND (barangay_name IS NULL OR date_of_diagnosis IS NULL OR sex IS NULL)
         LIMIT 20`,
        [batchId]
      );
      rejectedRecords = rejectedResult.rows;
    } catch { /* tb_cases may not have the batch */ }

    res.json({
      id: row.id,
      source: row.source,
      batchId: row.batch_id,
      status: row.status === 'processed' ? 'successful' : row.status === 'failed' ? 'failed' : row.status,
      records: row.records_received || 0,
      accepted: row.records_imported || 0,
      rejected: (row.records_received || 0) - (row.records_imported || 0),
      errorMessage: row.error_message,
      receivedAt: row.received_at,
      processedAt: row.processed_at,
      rejectedRecords,
    });
  } catch (err) {
    console.error('Sync detail error:', err.message);
    res.status(500).json({ error: 'Unable to load sync details.' });
  }
});

// ==================== UNDO A BATCH IMPORT ====================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/tb/integration/batches/:batchId  (admin only)
 *
 * Undo an import: removes everything the batch brought in — cleaned cases (tb_cases),
 * raw rows (tb_cases_raw) and its webhook log entry (so the same batch id can be sent
 * again) — then rebuilds the aggregated tables from the remaining cases, all in ONE
 * transaction. If anything fails, nothing is deleted.
 *
 * Predictions (forecasts, risk scores, alerts) were built from the removed data, so they
 * are deleted in the same transaction and the analysis is re-run on any remaining cases.
 */
router.delete('/batches/:batchId', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { batchId } = req.params;
  if (!UUID_RE.test(batchId)) {
    return res.status(400).json({ error: 'Invalid batch id.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Cases in OTHER batches may be flagged as possible duplicates of a case in this
    // batch (duplicate_of_case_id always points at the earliest match). Release those
    // flags first — the FK would otherwise block the delete — then re-flag the same
    // groups among the remaining rows below, so flags end up as if this batch had never
    // been imported.
    const released = await client.query(
      `UPDATE tb_cases
       SET duplicate_status = 'unique', duplicate_of_case_id = NULL, duplicate_flag_reason = NULL
       WHERE batch_id IS DISTINCT FROM $1
         AND duplicate_of_case_id IN (
           SELECT id FROM tb_cases WHERE batch_id = $1 AND COALESCE(source_type, '') <> 'MANUAL'
         )
       RETURNING source_type, dstb_fingerprint, itis_case_id`,
      [batchId]
    );

    // Guard: manually entered cases (source_type='MANUAL') are never part of an
    // import batch (they get a per-record batch_id only as a schema requirement).
    const cases = await client.query(
      `DELETE FROM tb_cases WHERE batch_id = $1 AND COALESCE(source_type, '') <> 'MANUAL'`,
      [batchId]
    );

    const releasedRows = released.rows || [];
    const reflagged = await flagPossibleDuplicates(client, {
      dstbFingerprints: [...new Set(releasedRows
        .filter(r => r.source_type === 'DSTB' && r.dstb_fingerprint).map(r => r.dstb_fingerprint))],
      mnItisCaseIds: [...new Set(releasedRows
        .filter(r => r.source_type === 'MN' && r.itis_case_id).map(r => r.itis_case_id))],
    });
    const raw = await client.query('DELETE FROM tb_cases_raw WHERE batch_id = $1', [batchId]);
    const logs = await client.query(
      `DELETE FROM webhook_logs WHERE batch_id = $1
       RETURNING source, records_received, records_imported, received_at`,
      [batchId]
    );

    if (cases.rowCount === 0 && raw.rowCount === 0 && logs.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Batch not found.' });
    }

    await rebuildAllAggregations(client);

    // Forecasts, risk levels (GIS colors) and alerts were computed from data that
    // included this batch, so they are removed with it. If cases remain, the analysis
    // is re-run on them after commit; model_metadata (run history) is kept.
    const clearedRisk = await client.query('DELETE FROM barangay_risk_scores');
    const clearedForecasts = await client.query('DELETE FROM model_predictions');
    const clearedAlerts = await client.query('DELETE FROM alerts');

    // Permanent record of the undo. Written inside the transaction on purpose: if the audit
    // row cannot be saved, the whole undo rolls back instead of deleting data untraceably.
    const original = logs.rows[0] || {};
    await client.query(
      `INSERT INTO audit_logs (user_id, username, action, target_username, result, ip_address, details)
       VALUES ($1, $2, 'IMPORT_UNDO', $3, 'SUCCESS', $4, $5)`,
      [
        req.user?.id || null,
        req.user?.username || 'unknown',
        batchId,
        req.ip || null,
        JSON.stringify({
          batchId,
          source: original.source || null,
          originalReceivedAt: original.received_at || null,
          recordsReceived: original.records_received ?? null,
          recordsImported: original.records_imported ?? null,
          deleted: { cases: cases.rowCount, rawRows: raw.rowCount, logs: logs.rowCount },
          duplicateFlags: { released: releasedRows.length, reflagged: reflagged.dstb + reflagged.mn },
        }),
      ]
    );
    await client.query('COMMIT');

    const remaining = Number((await pool.query('SELECT COUNT(*)::int AS n FROM tb_cases')).rows[0].n);
    if (remaining > 0) schedulePipelineRun(`undo:${batchId}`, 5000);

    console.log(
      `🗑️  Batch ${batchId} undone by ${req.user?.username || req.user?.id || 'unknown'}: ` +
      `${cases.rowCount} cases, ${raw.rowCount} raw rows, ${logs.rowCount} log entries removed`
    );
    res.json({
      success: true,
      batchId,
      deleted: { cases: cases.rowCount, rawRows: raw.rowCount, logs: logs.rowCount },
      duplicateFlags: { released: releasedRows.length, reflagged: reflagged.dstb + reflagged.mn },
      aggregatesRebuilt: true,
      modelResultsCleared: {
        riskScores: clearedRisk.rowCount, forecasts: clearedForecasts.rowCount, alerts: clearedAlerts.rowCount,
      },
      analysisRerunScheduled: remaining > 0,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    console.error('Batch undo error:', err.message);
    res.status(500).json({ error: 'Unable to undo this import. Nothing was deleted.' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/tb/integration/undo-history  (admin only)
 * Permanent record of undone imports, newest first.
 */
router.get('/undo-history', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, target_username AS batch_id, details, created_at
       FROM audit_logs
       WHERE action = 'IMPORT_UNDO'
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json({ entries: result.rows });
  } catch (err) {
    console.error('Undo history error:', err.message);
    res.status(500).json({ error: 'Unable to load undo history.' });
  }
});

// ==================== INTEGRATION STATS ====================
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const tableCheck = await pool.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'webhook_logs')"
    );
    if (!tableCheck.rows[0].exists) {
      return res.json({ received: 0, accepted: 0, rejected: 0, failed: 0 });
    }

    const result = await pool.query(
      `SELECT
         COALESCE(SUM(records_received), 0)::int AS received,
         COALESCE(SUM(records_imported), 0)::int AS accepted,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM webhook_logs`
    );

    const row = result.rows[0];
    res.json({
      received: row.received,
      accepted: row.accepted,
      rejected: row.received - row.accepted,
      failed: row.failed,
    });
  } catch (err) {
    console.error('Integration stats error:', err.message);
    res.status(500).json({ error: 'Unable to load integration stats.' });
  }
});

module.exports = router;
