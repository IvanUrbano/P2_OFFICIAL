/**
 * One-shot pipeline runner:
 *   1. Start Python ML service in background
 *   2. Wait for it to be healthy
 *   3. Login as admin and get JWT
 *   4. Call POST /api/tb/pipeline
 *   5. Print results
 *   6. Kill Python process
 */

const { execSync, spawn } = require('child_process');
const http = require('http');
const path = require('path');
const pool = require('./db');

const ML_URL = 'http://localhost:8001';
const EXPRESS_URL = 'http://localhost:5050';
const SKIP_SPAWN_ML = true; // ML service already running and healthy on :8001
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Set TEST_ADMIN_EMAIL and TEST_PASSWORD env vars before running this script (no hardcoded credentials).');
  process.exit(1);
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = JSON.stringify(body);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      timeout: 120_000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

async function waitForService(url, maxWaitMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await httpGet(url);
      if (res.status === 200) return true;
    } catch { }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

(async () => {
  let pythonProcess = null;

  try {
    // ── Step 1: Start Python ML service (skipped — already running) ──
    if (!SKIP_SPAWN_ML) {
      console.log('🐍 Starting Python ML service on port 8001...');
      // Pass env with PORT=8001 to avoid inheriting Express's PORT from .env
      const mlEnv = { ...process.env, PORT: '8001' };
      pythonProcess = spawn('python', ['main.py'], {
        cwd: path.join(__dirname, '..', 'ML_SERVICE'),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        env: mlEnv,
      });

      pythonProcess.stdout.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) console.log(`  [python] ${msg}`);
      });
      pythonProcess.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) console.log(`  [python] ${msg}`);
      });
    } else {
      console.log('🐍 Skipping ML service spawn — using already-running instance on :8001');
    }

    // ── Step 2: Wait for ML service to be healthy ──
    console.log('⏳ Waiting for ML service to be ready...');
    const mlReady = await waitForService(`${ML_URL}/api/ml/health`);
    if (!mlReady) {
      throw new Error('ML service did not become healthy within 30s');
    }
    console.log('✅ ML service is healthy');

    // ── Step 3: Check Express backend is running ──
    console.log('⏳ Checking Express backend...');
    const expressReady = await waitForService(`${EXPRESS_URL}/api/health`);
    if (!expressReady) {
      throw new Error('Express backend not reachable. Is it running on port 5000?');
    }
    console.log('✅ Express backend is healthy');

    // ── Step 4: Login as admin ──
    console.log(`🔑 Logging in as ${ADMIN_EMAIL}...`);
    const loginRes = await httpPost(`${EXPRESS_URL}/api/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    if (loginRes.status !== 200) {
      // Try reading the response for more details
      const loginBody = JSON.parse(loginRes.body);
      throw new Error(`Login failed (${loginRes.status}): ${loginBody.error || loginRes.body}`);
    }

    // Token is issued as an httpOnly cookie, not in the JSON body — grab it
    // from Set-Cookie and forward it as the Cookie header on the next request.
    const setCookie = loginRes.headers['set-cookie'];
    const tokenCookie = (setCookie || []).map(c => c.split(';')[0]).find(c => c.startsWith('token='));
    if (!tokenCookie) {
      throw new Error('No token cookie in login response headers: ' + JSON.stringify(setCookie));
    }
    console.log('✅ Login successful, got auth cookie');

    // ── Step 5: Run the pipeline ──
    console.log('🚀 Running pipeline (this may take 30-60 seconds for ARIMA)...');
    const pipelineRes = await httpPost(`${EXPRESS_URL}/api/tb/pipeline`, {}, {
      'Cookie': tokenCookie,
    });

    if (pipelineRes.status !== 200) {
      throw new Error(`Pipeline failed (${pipelineRes.status}): ${pipelineRes.body}`);
    }

    const pipelineData = JSON.parse(pipelineRes.body);
    console.log('\n✅ Pipeline completed!\n');
    console.log(JSON.stringify(pipelineData, null, 2));

    // ── Step 6: Verify L4 tables ──
    console.log('\n📊 Verifying L4 tables...');
    const predictions = await pool.query('SELECT COUNT(*) FROM model_predictions');
    const riskScores = await pool.query('SELECT COUNT(*) FROM barangay_risk_scores');
    const alerts = await pool.query('SELECT COUNT(*) FROM alerts');
    const metadata = await pool.query("SELECT COUNT(*) FROM model_metadata WHERE run_type = 'pipeline'");

    console.log(`  model_predictions:      ${predictions.rows[0].count} rows`);
    console.log(`  barangay_risk_scores:   ${riskScores.rows[0].count} rows`);
    console.log(`  alerts:                 ${alerts.rows[0].count} rows`);
    console.log(`  model_metadata:         ${metadata.rows[0].count} rows`);

    // Show risk class distribution
    const dist = await pool.query(
      `SELECT risk_class, COUNT(*) as count FROM barangay_risk_scores
       WHERE period = (SELECT MAX(period) FROM barangay_risk_scores)
       GROUP BY risk_class ORDER BY count DESC`
    );
    console.log('\n📊 Risk class distribution:');
    for (const row of dist.rows) {
      console.log(`  ${row.risk_class}: ${row.count} barangays`);
    }

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  } finally {
    // Kill Python process
    if (pythonProcess) {
      console.log('\n🧹 Shutting down Python ML service...');
      try { process.kill(-pythonProcess.pid, 'SIGTERM'); } catch { }
      try { pythonProcess.kill('SIGTERM'); } catch { }
    }
    await pool.end();
    process.exit(0);
  }
})();
