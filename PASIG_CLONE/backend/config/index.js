require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '5001', 10),
  db: {
    connectionString: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  webhook: {
    url: process.env.TBINSIGHT_WEBHOOK_URL,
    secret: process.env.WEBHOOK_SECRET,
  },
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5174',
  // Patient-name display for OPERATIONAL records (created after deployment/client
  // approval). Off until approved: every record is then de-identified in the API.
  // Historical records are de-identified regardless (services/pinService.js).
  patientNames: {
    enabled: String(process.env.PATIENT_NAMES_ENABLED || '').toLowerCase() === 'true',
  },
};
