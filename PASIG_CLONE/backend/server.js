require('dotenv').config();
 
// Validate required environment variables
const requiredEnvVars = ['DATABASE_URL', 'AUTH_DATABASE_URL', 'JWT_SECRET', 'WEBHOOK_SECRET', 'TBINSIGHT_WEBHOOK_URL'];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
 
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('./config');
const { initSchema } = require('./db/pasigSchema');
 
const authRoutes = require('./routes/auth');
const csvImportRoutes = require('./routes/csvImport');
const validationRoutes = require('./routes/validation');
const webhookRoutes = require('./routes/webhook');
 
const app = express();
 
// Trust first proxy (required for rate limiting behind Render's reverse proxy)
app.set('trust proxy', 1);
 
app.use(cors({
  origin: ['http://localhost:5174', config.frontendUrl],
  credentials: true,
}));
app.use(helmet());
app.use(morgan('dev'));
const fileUpload = require('express-fileupload');
app.use(fileUpload({ 
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max file upload
  abortOnLimit: true, 
  responseOnLimit: 'File too large. Maximum size is 500MB.' 
}));

// JSON size limits for different routes
app.use('/api/auth', express.json({ limit: '50mb' }));
app.use('/api/webhook', express.json({ limit: '100mb' })); // Large payloads from TBInsight
app.use(express.json({ limit: '50mb' })); // Default for other routes
app.use(cookieParser());
 
app.use('/api/auth', authRoutes);
app.use('/api/data', csvImportRoutes);
app.use('/api/data', validationRoutes);
app.use('/api/webhook', webhookRoutes);
 
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'pasig-clone', timestamp: new Date().toISOString() });
});
 
// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});
 
async function start() {
  try {
    await initSchema();
    app.listen(config.port, () => {
      console.log(`🚀 Pasig Clone backend running on port ${config.port}`);
      console.log(`📦 File upload limits:`);
      console.log(`   • JSON payload: 50 MB (general), 100 MB (webhook)`);
      console.log(`   • File upload: 500 MB`);
      console.log(`✅ Supports large CSV/Excel files`);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}
 
start();
 
module.exports = app;