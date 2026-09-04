require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '5001', 10),
  db: {
    connectionString: process.env.DATABASE_URL,
  },
  webhook: {
    url: process.env.TBINSIGHT_WEBHOOK_URL,
    secret: process.env.WEBHOOK_SECRET,
  },
};
