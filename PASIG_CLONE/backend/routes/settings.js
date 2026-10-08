/**
 * Settings page data. Everything here is READ-ONLY system information — the rules
 * (Case ID format, validation, duplicate detection) and the sync secret are defined in
 * code / server configuration and are never editable from the UI. The sync secret is
 * reported only as "configured", never returned.
 *
 *   GET  /api/settings/rules            Case ID, validation, duplicate and import rules; security policy
 *   GET  /api/settings/sync             TBInsight endpoint, last sync, pending / failed batches   (admin)
 *   POST /api/settings/test-connection  one live health check of TBInsight                        (admin)
 *   GET  /api/settings/system           version, uptime, database and schema status               (admin)
 *
 * Test Connection answers 200 with { ok: false } when TBInsight cannot be reached: the
 * client treats 401/403 as "signed out", so a failed check must never use those codes.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');
const router = express.Router();
const db = require('../db/pasigSchema');
const config = require('../config');
const pkg = require('../package.json');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { logAuditEvent } = require('../utils/auditLogger');
const { CASE_ID_RE } = require('../services/caseIds');
const { UNLOCK_MINUTES, MAX_FAILED } = require('../services/pinService');

const STARTED_AT = new Date();
const HEALTH_TIMEOUT_MS = parseInt(process.env.TBINSIGHT_HEALTH_TIMEOUT_MS || '20000', 10);

const testLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many connection tests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// The endpoint without anything that could carry a credential (userinfo, query string).
function describeEndpoint() {
  try {
    const u = new URL(config.webhook.url);
    return {
      host: u.host,
      path: u.pathname,
      display: `${u.protocol}//${u.host}${u.pathname}`,
      healthUrl: `${u.origin}/api/health`,
    };
  } catch {
    return { host: null, path: null, display: null, healthUrl: null };
  }
}

// ==================== RULES (read-only) ====================
router.get('/rules', authenticate, authorizeRoles('admin', 'staff'), (req, res) => {
  res.json({
    caseId: {
      format: 'FACILITY-D|M-YEAR-NNNNN',
      example: 'ROS-D-2025-00042',
      pattern: CASE_ID_RE.source,
      parts: [
        { label: 'Facility code', text: 'Treatment facility (screening facility if there is none); UNK when neither is known' },
        { label: 'D | M', text: 'DSTB or MN' },
        { label: 'Year', text: 'Year of diagnosis' },
        { label: 'NNNNN', text: 'Running number per facility, type and year' },
      ],
      source: 'Taken from the DSTB / MN registry (the file\'s "Case ID" column, or typed in Add TB Record). The system never generates one.',
    },
    validation: [
      'Case ID is required and must match the format above.',
      'Date of Diagnosis, Sex and Age are required. Age is worked out from the date of birth and the diagnosis date.',
      'Patient name and date of birth are required for manual entry, and optional for imported historical records.',
      'A record with no barangay, or one that is not a registered Pasig barangay, is listed under Needs Assignment and is not sent to TBInsight until it is assigned.',
      'Records from outside Pasig City are kept but are not sent to TBInsight.',
    ],
    duplicates: [
      'One Case ID identifies one TB case (episode). A Case ID that already belongs to a case is never added a second time.',
      'In an import, a row that carries the Case ID of an existing case is applied as a later report of that case. If it disagrees about the patient or the diagnosis date, it is held for a person to decide.',
      'The same name and date of birth with a different Case ID is a possible returning patient. A person chooses: same case, new episode, or different person. Nothing is merged automatically.',
    ],
    import: {
      fileTypes: ['.xlsx', '.xls', '.csv'],
      maxFileMb: 500,
      sheets: ['DSTB', 'MN'],
    },
    security: {
      password: { minLength: 8, rules: ['At least one uppercase letter', 'At least one lowercase letter', 'At least one number'] },
      login: { maxAttempts: 5, windowMinutes: 15 },
      recordsPin: { unlockMinutes: UNLOCK_MINUTES, maxFailed: MAX_FAILED, lockoutMinutes: 15 },
    },
  });
});

// ==================== SYNC (admin) ====================
router.get('/sync', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const endpoint = describeEndpoint();
    const [last, failed, counts] = await Promise.all([
      db.pool.query(
        `SELECT id, filename, synced_at, sync_result FROM import_batches
         WHERE sync_status = 'synced' ORDER BY synced_at DESC NULLS LAST LIMIT 1`
      ),
      db.pool.query(
        `SELECT id, filename, sync_error, sync_started_at FROM import_batches
         WHERE sync_status = 'sync_failed' ORDER BY sync_started_at DESC NULLS LAST LIMIT 1`
      ),
      db.pool.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'validated' AND sync_status = 'pending')::int AS ready,
                COUNT(*) FILTER (WHERE sync_status = 'sync_failed')::int AS failed,
                COUNT(*) FILTER (WHERE sync_status = 'syncing')::int AS syncing
         FROM import_batches`
      ),
    ]);
    const ok = last.rows[0] || null;
    const bad = failed.rows[0] || null;
    const result = ok?.sync_result || {};
    res.json({
      endpoint: { display: endpoint.display, host: endpoint.host },
      secretConfigured: Boolean(config.webhook.secret),
      signing: 'HMAC-SHA256 on every request',
      maxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES || '3', 10),
      timeoutSeconds: Math.round(parseInt(process.env.WEBHOOK_TIMEOUT_MS || '60000', 10) / 1000),
      autoSync: 'Manually entered records are sent automatically after saving',
      lastSuccess: ok ? {
        batchId: ok.id,
        filename: ok.filename,
        at: ok.synced_at,
        sent: result.recordsSent ?? null,
        imported: result.recordsImported ?? null,
        updated: result.recordsUpdated ?? null,
        rejected: result.recordsRejected ?? null,
      } : null,
      lastFailure: bad ? {
        batchId: bad.id,
        filename: bad.filename,
        at: bad.sync_started_at,
        error: bad.sync_error ? String(bad.sync_error).slice(0, 300) : null,
      } : null,
      counts: counts.rows[0],
    });
  } catch (error) {
    console.error('Settings sync error:', error);
    res.status(500).json({ error: 'Failed to load synchronization settings.' });
  }
});

router.post('/test-connection', testLimiter, authenticate, authorizeRoles('admin'), async (req, res) => {
  const endpoint = describeEndpoint();
  const checkedAt = new Date().toISOString();
  const started = Date.now();
  let outcome;

  if (!endpoint.healthUrl) {
    outcome = { ok: false, state: 'misconfigured', message: 'The TBInsight address is not a valid URL. Check the server configuration.' };
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint.healthUrl, { signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      const responseMs = Date.now() - started;
      if (response.ok && body.status === 'ok') {
        outcome = { ok: true, state: 'connected', responseMs, message: 'TBInsight replied and its database is connected.' };
      } else {
        outcome = {
          ok: false, state: 'error', responseMs, httpStatus: response.status,
          message: body.database === 'disconnected'
            ? 'TBInsight is running but cannot reach its database.'
            : `TBInsight replied with an error (HTTP ${response.status}).`,
        };
      }
    } catch (err) {
      const timedOut = err.name === 'AbortError';
      outcome = {
        ok: false, state: 'unreachable', responseMs: Date.now() - started,
        message: timedOut
          ? `No reply within ${Math.round(HEALTH_TIMEOUT_MS / 1000)} seconds. TBInsight may be starting up; try again in a minute.`
          : `TBInsight cannot be reached at ${endpoint.host}. Check that it is running.`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // The automatic check made when the tab opens is not logged; a person pressing
  // Test Connection is.
  if (!req.body?.auto) {
    await logAuditEvent({
      userId: req.user.id, username: req.user.username, action: 'TEST_SYNC_CONNECTION',
      resourceType: 'webhook', resourceId: null, result: outcome.ok ? 'SUCCESS' : 'FAILURE',
      ipAddress: req.ip || null, details: { state: outcome.state, host: endpoint.host },
    });
  }
  res.json({ ...outcome, checkedAt, host: endpoint.host });
});

// ==================== SYSTEM (admin) ====================
async function timed(pool) {
  const t = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, ms: Date.now() - t };
  } catch {
    return { ok: false, ms: null };
  }
}

// What the code needs from the database, by migration. A missing item means the server
// was started with SKIP_MIGRATIONS=true (or a migration failed) and the schema is behind.
async function schemaChecks() {
  const checks = [
    { migration: '015', label: 'Patient identity classes', sql: `SELECT 1 FROM information_schema.columns WHERE table_name = 'validated_tb_cases' AND column_name = 'identity_class'` },
    { migration: '017', label: 'Case status and treatment outcome', sql: `SELECT 1 FROM information_schema.columns WHERE table_name = 'validated_tb_cases' AND column_name = 'treatment_outcome'` },
    { migration: '018', label: 'Case ID required per batch', sql: `SELECT 1 FROM information_schema.columns WHERE table_name = 'import_batches' AND column_name = 'case_id_required'` },
    { migration: '019', label: 'Case ID unique per case', sql: `SELECT 1 FROM pg_indexes WHERE indexname = 'uq_validated_case_id'` },
  ];
  const out = [];
  for (const c of checks) {
    try {
      const r = await db.pool.query(c.sql);
      out.push({ migration: c.migration, label: c.label, applied: r.rows.length > 0 });
    } catch {
      out.push({ migration: c.migration, label: c.label, applied: false });
    }
  }
  return out;
}

router.get('/system', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const [pasig, auth, schema] = await Promise.all([timed(db.pool), timed(db.authPool), schemaChecks()]);
    res.json({
      name: 'PASIG TB-IS',
      version: pkg.version,
      environment: process.env.NODE_ENV || 'development',
      node: process.version,
      startedAt: STARTED_AT.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      serverTime: new Date().toISOString(),
      databases: { records: pasig, accounts: auth },
      startupMigrations: process.env.SKIP_MIGRATIONS === 'true' ? 'skipped' : 'automatic',
      schema,
      schemaUpToDate: schema.every(s => s.applied),
      patientNamesEnabled: config.patientNames.enabled,
    });
  } catch (error) {
    console.error('Settings system error:', error);
    res.status(500).json({ error: 'Failed to load system information.' });
  }
});

module.exports = router;
