const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_kvc8PSp5FCjy@ep-delicate-surf-ay7m7t9k.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require',
});

(async () => {
  try {
    const r = await pool.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'interventions') AS exists"
    );
    console.log('Table exists:', r.rows[0].exists);

    if (r.rows[0].exists) {
      const r2 = await pool.query('SELECT COUNT(*)::int AS count FROM interventions');
      console.log('Row count:', r2.rows[0].count);
    } else {
      console.log('TABLE DOES NOT EXIST - need to run migration');
    }
  } catch (e) {
    console.log('ERROR:', e.message);
  }
  pool.end();
})();
