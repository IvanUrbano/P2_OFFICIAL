const pool = require('./db');

async function migrate() {
  try {
    console.log('Starting database migration...');
    
    // Add the role column if it does not exist
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'staff';
    `);
    console.log('✅ Role column added (or already existed).');

    // Update all current users to 'admin' so the developer/existing accounts don't lose admin capabilities
    const updateRes = await pool.query(`
      UPDATE users SET role = 'admin' WHERE role IS NULL OR role = 'staff';
    `);
    console.log(`✅ Updated ${updateRes.rowCount} existing user(s) to 'admin'.`);

    // Verify the migration
    const res = await pool.query('SELECT id, username, email, role FROM users');
    console.log('Current users and their roles:');
    console.log(res.rows);

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
