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
};
