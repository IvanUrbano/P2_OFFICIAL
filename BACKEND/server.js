const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fileUpload = require('express-fileupload');
require('dotenv').config();

// Import database connection
const pool = require('./db');

// Import routes
const authRoutes = require('./routes/auth');
const tbInsightRoutes = require('./tbinsight/routes');
const webhookRoutes = require('./tbinsight/webhook');
const { apiLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 5000;

// ==================== MIDDLEWARE ====================
const allowedOrigins = [
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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(fileUpload({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  abortOnLimit: true,
  responseOnLimit: 'File size exceeds 50MB limit.',
}));

// ==================== ROUTES ====================
app.use('/api/auth', apiLimiter, authRoutes);
app.use('/api/tb', apiLimiter, tbInsightRoutes);
app.use('/api/webhook', webhookRoutes);

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

// Root endpoint
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

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
