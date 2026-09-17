const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fileUpload = require('express-fileupload');
require('dotenv').config();

// Validate required environment variables
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'WEBHOOK_SECRET'];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// Import database connection
const pool = require('./db');

// Import routes
const authRoutes = require('./routes/auth');
const tbInsightRoutes = require('./tbinsight/routes');
const webhookRoutes = require('./tbinsight/webhook');
const integrationRoutes = require('./tbinsight/integration');
const { apiLimiter, webhookLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust first proxy (required for rate limiting behind Render's reverse proxy)
app.set('trust proxy', 1);

// ==================== MIDDLEWARE ====================
const allowedOrigins = [
  'http://localhost:5050',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5001',
  'http://localhost:3000',
  process.env.FRONTEND_URL, // e.g. https://p2-official.vercel.app
].filter(Boolean);

// Also allow any Vercel preview deployment URLs for this project
const vercelPreviewPattern = /^https:\/\/p2-official[a-z0-9-]*\.vercel\.app$/;

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, mobile apps)
    if (!origin) return callback(null, true);

    const isAllowed =
      allowedOrigins.includes(origin) ||
      vercelPreviewPattern.test(origin);

    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
}));

// Apply larger JSON limit to most routes (50MB default to support large imports)
// Webhook routes will override this with their own even larger limit (100MB)
app.use((req, res, next) => {
  // Skip JSON parsing for webhook routes — they have custom middleware
  if (req.path.startsWith('/api/webhook')) {
    return next();
  }
  express.json({ limit: '50mb' })(req, res, next);
});

app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(fileUpload({
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max file upload
  abortOnLimit: true,
  responseOnLimit: 'File size exceeds 500MB limit.',
}));

// ==================== REQUEST TIMEOUT ====================
// Kill requests that take too long to prevent pool exhaustion
// Timeout varies by endpoint: import/pipeline/evaluate can take longer
const slowRequestTimeout = (timeoutMs) => (req, res, next) => {
  req.setTimeout(timeoutMs, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request timeout' });
    }
  });
  next();
};

// Apply 60s timeout to all API routes by default
app.use('/api', slowRequestTimeout(60_000));

// Extend timeout for long-running endpoints (up to 10 minutes for large file processing)
app.use('/api/tb/pipeline', slowRequestTimeout(600_000));
app.use('/api/tb/evaluate', slowRequestTimeout(600_000));
app.use('/api/tb/import', slowRequestTimeout(600_000));

// ==================== WEBHOOK RAW BODY CAPTURE ====================
// CRITICAL: Use raw body parser with VERY LARGE limit BEFORE custom middleware
// This prevents the global JSON parser from rejecting large webhook payloads
// Supports payloads up to 100MB
const rawBodyParser = express.raw({ type: 'application/json', limit: '100mb' });

app.use('/api/webhook', webhookLimiter, rawBodyParser, (req, res, next) => {
  // At this point, req.body is a Buffer
  // Convert to string for signature verification
  const rawBodyString = req.body.toString('utf8');
  req.rawBody = rawBodyString;
  
  // Parse JSON for route handlers
  try {
    req.body = JSON.parse(rawBodyString);
    console.log('✅ Webhook payload parsed successfully');
  } catch (err) {
    console.error('❌ Webhook JSON parse error:', err.message);
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  next();
});

// ==================== ROUTES ====================
app.use('/api/auth', apiLimiter, authRoutes);
app.use('/api/tb', apiLimiter, tbInsightRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/tb/integration', apiLimiter, integrationRoutes);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: result.rows[0].now,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
      error: err.message,
    });
  }
});

// Root endpoint (dev only — exposes API surface)
if (process.env.NODE_ENV !== 'production') {
  app.get('/', (req, res) => {
    res.json({
      message: 'TB System API is running',
      version: '1.0.0',
      endpoints: {
        health: 'GET /api/health',
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        logout: 'POST /api/auth/logout',
        profile: 'GET /api/auth/profile',
        tbInsight: {
          barangays: 'GET /api/tb/barangays',
          facilities: 'GET /api/tb/facilities',
          import: 'POST /api/tb/import',
          importHistory: 'GET /api/tb/import-history',
          dashboard: 'GET /api/tb/dashboard/summary',
          monthly: 'GET /api/tb/dashboard/monthly',
          choropleth: 'GET /api/tb/gis/choropleth',
          forecasts: 'GET /api/tb/forecasts',
          alerts: 'GET /api/tb/alerts',
        },
      },
    });
  });
}

// ==================== GLOBAL ERROR HANDLER ====================
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body.' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`✅ Webhook endpoint: POST http://localhost:${PORT}/api/webhook/pasig-clone`);
  console.log(`✅ Webhook signature: ${process.env.WEBHOOK_SECRET ? '✓ WEBHOOK_SECRET configured' : '❌ WEBHOOK_SECRET NOT SET'}`);
  console.log(`📦 File upload limits:`);
  console.log(`   • JSON payload: 50 MB (general), 100 MB (webhook)`);
  console.log(`   • File upload: 500 MB`);
  console.log(`   • Request timeout: 10 minutes (for large imports)`);
});
