const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const res = await pool.query("SELECT COUNT(*) FILTER (WHERE UPPER(outcome_status) IN ('CURED', 'TREATMENT COMPLETED')) AS success, COUNT(*) FILTER (WHERE outcome_status IS NOT NULL AND outcome_status != '') AS total, COUNT(*) FILTER (WHERE UPPER(outcome_status) = 'NOT EVALUATED') AS not_eval FROM tb_cases");
  const row = res.rows[0];
  const evaluated = Number(row.total) - Number(row.not_eval);
  const rate = (Number(row.success) / (evaluated || 1)) * 100;
  console.log(JSON.stringify({success: String(row.success), total: String(row.total), not_eval: String(row.not_eval), evaluated, raw: rate, fixed1: rate.toFixed(1)}));
  await pool.end();
})();
