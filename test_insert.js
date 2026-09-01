const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_kvc8PSp5FCjy@ep-delicate-surf-ay7m7t9k.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require',
});

(async () => {
  try {
    const r = await pool.query(
      `INSERT INTO interventions (title, description, intervention_type, barangay_name, priority, assigned_to, team, target_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      ['Test Intervention', 'Test description', 'screening', 'Rosario', 'medium', 'Test Officer', 'Test Team', '2026-09-15', 'test_user']
    );
    console.log('SUCCESS! Created intervention with id:', r.rows[0].id);

    const r2 = await pool.query('SELECT COUNT(*)::int AS count FROM interventions');
    console.log('Total interventions now:', r2.rows[0].count);

    // Clean up
    await pool.query('DELETE FROM interventions WHERE id = $1', [r.rows[0].id]);
    console.log('Cleaned up test row');
  } catch (e) {
    console.log('ERROR:', e.message);
    console.log('Full error:', e);
  }
  pool.end();
})();
