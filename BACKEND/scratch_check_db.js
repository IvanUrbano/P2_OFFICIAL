const pool = require('./db');

async function check() {
  try {
    const res = await pool.query('SELECT id, username, email FROM users');
    console.log('Current users:');
    console.log(res.rows);
  } catch (err) {
    console.error('Error querying users:', err.message);
  } finally {
    await pool.end();
  }
}

check();
