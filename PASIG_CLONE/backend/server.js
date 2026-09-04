require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('./config');
const { initSchema } = require('./db/pasigSchema');
const apiRoutes = require('./routes/api');

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.use('/api', apiRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'pasig-clone-backend' });
});

async function start() {
  try {
    await initSchema();
    app.listen(config.port, () => {
      console.log(`Pasig Clone backend running on port ${config.port}`);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
