const pool = require('./db');
pool.query('SELECT username, email, role FROM users LIMIT 5')
  .then(r => { console.log(JSON.stringify(r.rows, null, 2)); process.exit(); })
  .catch(e => { console.error(e.message); process.exit(1); });
