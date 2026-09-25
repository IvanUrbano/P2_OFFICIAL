const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

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
