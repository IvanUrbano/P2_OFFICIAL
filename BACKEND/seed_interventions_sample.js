#!/usr/bin/env node
/**
 * Sample interventions for the Dashboard / Intervention Planning pages.
 *
 *   node seed_interventions_sample.js            -> insert the sample rows (skips if already seeded)
 *   node seed_interventions_sample.js --remove   -> delete only the rows this script inserted
 *
 * Every sample row carries metadata {"sample": true}, so --remove never touches real interventions.
 * Dates are relative to today, so the sample always has a mix of overdue / upcoming / completed work.
 * Uses the database configured in BACKEND/.env (see db.js).
 */
const pool = require('./db');

// [title, description, type, barangay, priority, status, assigned_to, team, target offset (days), completed offset (days)]
const SAMPLE = [
  ['Mass TB screening at Pinagbuhatan covered court', 'Chest X-ray and symptom screening for residents of high-incidence puroks.', 'screening', 'Pinagbuhatan', 'high', 'in_progress', 'Dr. A. Reyes', 'Screening Team A', 10],
  ['Household contact tracing for new cases', 'Visit and screen household contacts of cases diagnosed in the last 60 days.', 'contact_tracing', 'Manggahan', 'high', 'pending', 'N. Santos, RN', 'Contact Tracing Unit', -5],
  ['Barangay TB awareness assembly', 'Community talk on symptoms, free testing and treatment adherence.', 'education', 'San Miguel', 'medium', 'pending', 'M. Cruz', 'Health Education Unit', 21],
  ['Quarterly anti-TB drug stock replenishment', 'Deliver 2nd-line and FDC stock to the health center to prevent stock-outs.', 'medicine_allocation', 'Santolan', 'high', 'completed', 'J. Bautista, RPh', 'Pharmacy', -12, -14],
  ['Follow-up of patients who missed treatment', 'Home visits for patients with 2+ missed DOTS doses this month.', 'follow_up', 'Bagong Ilog', 'high', 'in_progress', 'L. Garcia, RN', 'DOTS Team', -2],
  ['School-based symptom screening', 'Teacher-assisted symptom checklist and referral for students.', 'screening', 'Caniogan', 'medium', 'pending', 'Dr. P. Lim', 'Screening Team B', 30],
  ['Workplace screening at Ugong business district', 'Screening for informal-sector and office workers.', 'screening', 'Ugong', 'low', 'completed', 'Dr. A. Reyes', 'Screening Team A', -30, -33],
  ['Contact tracing for cluster in Rosario', 'Trace and test contacts linked to the reported cluster.', 'contact_tracing', 'Rosario', 'medium', 'in_progress', 'N. Santos, RN', 'Contact Tracing Unit', 7],
  ['Adherence counselling for treatment-support partners', 'Train treatment partners to improve completion rates.', 'education', 'Maybunga', 'low', 'completed', 'M. Cruz', 'Health Education Unit', -20, -22],
  ['Replenish DOTS supplies at health center', 'Sputum cups, masks and IEC materials.', 'medicine_allocation', 'Kapasigan', 'medium', 'pending', 'J. Bautista, RPh', 'Pharmacy', -9],
  ['Lost-to-follow-up tracing', 'Locate and re-enroll patients lost to follow-up for 2+ months.', 'follow_up', 'Sagad', 'high', 'pending', 'L. Garcia, RN', 'DOTS Team', 14],
  ['Community screening drive', 'Door-to-door symptom screening with mobile X-ray.', 'screening', 'Santa Lucia', 'medium', 'in_progress', 'Dr. P. Lim', 'Screening Team B', 18],
  ['Peer-educator TB orientation', 'Orient barangay health workers and youth peer educators.', 'education', 'Palatiw', 'low', 'pending', 'M. Cruz', 'Health Education Unit', 45],
  ['Missed-dose home visits', 'Weekly follow-up for patients with interrupted therapy.', 'follow_up', 'Dela Paz', 'medium', 'completed', 'L. Garcia, RN', 'DOTS Team', -6, -8],
  ['Contact investigation for MDR-TB case', 'Priority investigation of close contacts, with preventive therapy referral.', 'contact_tracing', 'Buting', 'high', 'in_progress', 'N. Santos, RN', 'Contact Tracing Unit', 3],
];

async function main() {
  const remove = process.argv.includes('--remove');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (remove) {
      const del = await client.query(`DELETE FROM interventions WHERE metadata->>'sample' = 'true'`);
      await client.query('COMMIT');
      console.log(`Removed ${del.rowCount} sample intervention(s).`);
      return;
    }

    const existing = await client.query(`SELECT COUNT(*)::int AS n FROM interventions WHERE metadata->>'sample' = 'true'`);
    if (existing.rows[0].n > 0) {
      await client.query('ROLLBACK');
      console.log(`Sample already seeded (${existing.rows[0].n} rows). Run with --remove first to re-seed.`);
      return;
    }

    for (const [title, description, type, barangay, priority, status, assignedTo, team, targetOffset, doneOffset] of SAMPLE) {
      await client.query(
        `INSERT INTO interventions
           (title, description, intervention_type, barangay_name, priority, status,
            assigned_to, team, target_date, completed_at, created_by, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CURRENT_DATE + $9::int,
                 CASE WHEN $10::int IS NULL THEN NULL ELSE NOW() + ($10::int * INTERVAL '1 day') END,
                 'sample-data', '{"sample": true}'::jsonb)`,
        [title, description, type, barangay, priority, status, assignedTo, team, targetOffset, doneOffset ?? null]
      );
    }
    await client.query('COMMIT');
    console.log(`Inserted ${SAMPLE.length} sample interventions.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Seeding failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
