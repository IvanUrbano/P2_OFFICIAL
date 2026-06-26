/**
 * Seed the TBInsight database with realistic test data.
 *
 * Populates:
 *   L0 — barangays (30), health_facilities (39)
 *   L1 — tb_cases_raw  (traceability)
 *   L2 — tb_cases      (analytics source)
 *   L3 — all 5 aggregated tables
 *
 * Usage:  node seed_data.js   (run from BACKEND/)
 * Safe to re-run (TRUNCATE + re-insert).
 */

const pool = require('./db');
const { v4: uuidv4 } = require('uuid');

// ── Constants ──────────────────────────────────────────────────

const BARANGAYS = [
  { name: 'Bagong Ilog',      pop: 26512 },
  { name: 'Bambang',          pop: 13786 },
  { name: 'Buting',           pop: 11234 },
  { name: 'Caniogan',         pop: 15892 },
  { name: 'Dela Paz',         pop: 28456 },
  { name: 'Kalawaan',         pop: 18234 },
  { name: 'Kapasigan',        pop: 12567 },
  { name: 'Kapitolyo',        pop: 21345 },
  { name: 'Malinao',          pop: 14567 },
  { name: 'Manggahan',        pop: 32145 },
  { name: 'Maybunga',         pop: 27890 },
  { name: 'Oranbo',           pop:  9876 },
  { name: 'Palatiw',          pop: 16789 },
  { name: 'Pinagbuhatan',     pop: 45678 },
  { name: 'Pineda',           pop: 19234 },
  { name: 'Rosario',          pop: 34567 },
  { name: 'Sagad',            pop:  8765 },
  { name: 'San Antonio',      pop: 23456 },
  { name: 'San Joaquin',      pop: 18901 },
  { name: 'San Jose',         pop: 15678 },
  { name: 'San Miguel',       pop: 12345 },
  { name: 'San Nicolas',      pop: 11234 },
  { name: 'Santa Cruz',       pop:  9876 },
  { name: 'Santa Lucia',      pop: 13456 },
  { name: 'Santa Rosa',       pop: 10234 },
  { name: 'Santo Tomas',      pop:  8765 },
  { name: 'Santolan',         pop: 21567 },
  { name: 'Sumilang',         pop: 11234 },
  { name: 'Ugong',            pop: 16789 },
  { name: 'Kapasigan Extension', pop: 7890 },
];

const FACILITIES = [
  ['Bagong Ilog HC','Bagong Ilog','HC'],
  ['Bagong Ilog PC','Bagong Ilog','PC'],
  ['Bambang HC','Bambang','HC'],
  ['Buting HC','Buting','HC'],
  ['Caniogan HC','Caniogan','HC'],
  ['Dela Paz HC','Dela Paz','HC'],
  ['Kalawaan HC','Kalawaan','HC'],
  ['Ismar HC','Kalawaan','HC'],
  ['Kapasigan HC','Kapasigan','HC'],
  ['Kapitolyo HC','Kapitolyo','HC'],
  ['Malinao HC','Malinao','HC'],
  ['Manggahan HC','Manggahan','HC'],
  ['Napico HC','Manggahan','HC'],
  ['Karangalan HC','Manggahan','HC'],
  ['Maybunga ITC','Maybunga','ITC'],
  ['Maybunga Floodway','Maybunga','Floodway'],
  ['Oranbo HC','Oranbo','HC'],
  ['Palatiw HC','Palatiw','HC'],
  ['Pinagbuhatan HC','Pinagbuhatan','HC'],
  ['Pinagbuhatan Puericulture Center','Pinagbuhatan','PC'],
  ['E. Santos','Pinagbuhatan','HC'],
  ['Nagpayong HC','Pinagbuhatan','HC'],
  ['Pineda HC','Pineda','HC'],
  ['Rosario HC','Rosario','HC'],
  ['Sagad HC','Sagad','HC'],
  ['San Antonio HC','San Antonio','HC'],
  ['San Joaquin HC','San Joaquin','HC'],
  ['San Jose HC','San Jose','HC'],
  ['San Miguel HC','San Miguel','HC'],
  ['San Nicolas HC','San Nicolas','HC'],
  ['Santa Cruz HC','Santa Cruz','HC'],
  ['Santa Lucia HC','Santa Lucia','HC'],
  ['Santa Rosa HC','Santa Rosa','HC'],
  ['Santo Tomas HC','Santo Tomas','HC'],
  ['Santolan HC','Santolan','HC'],
  ['Dona Betang HC','Santolan','HC'],
  ['Sumilang HC','Sumilang','HC'],
  ['Ugong HC','Ugong','HC'],
  ['Kapasigan Extension HC','Kapasigan Extension','HC'],
];

const SEXES = ['Male', 'Female'];
const AGE_GROUPS_WEIGHTED = [
  [0,  14, 0.08], [15, 24, 0.18], [25, 34, 0.25],
  [35, 44, 0.20], [45, 54, 0.14], [55, 64, 0.09], [65, 90, 0.06],
];
const REG_GROUPS = ['NEW', 'NEW', 'NEW', 'NEW', 'RELAPSE', 'RETREATMENT', 'TRANSFER IN'];
const BACTERIO = [
  'BACTORIOLOGICALLY-CONFIRMED TB', 'BACTORIOLOGICALLY-CONFIRMED TB',
  'BACTORIOLOGICALLY-CONFIRMED TB', 'BACTORIOLOGICALLY-CONFIRMED TB',
  'CLINICTBALLY-DIAGNOSED', 'CLINICTBALLY-DIAGNOSED',
];
const OUTCOMES = [
  'ON TREATMENT', 'ON TREATMENT', 'ON TREATMENT',
  'CURED', 'CURED', 'TREATMENT COMPLETED', 'TREATMENT COMPLETED',
  'DIED', 'LOST TO FOLLOW-UP', 'EXCLUDED',
];
const ANAT_SITES = ['P', 'P', 'P', 'P', 'EP'];
const SOURCES = [
  'PUBLIC HEALTH CENTER', 'PUBLIC HEALTH CENTER', 'PUBLIC HEALTH CENTER',
  'OTHER PUBLIC FACILITY', 'PRIVATE FACILITY', 'PASSIVE',
];

const BATCH_SIZE = 500; // rows per multi-INSERT

// ── Helpers ────────────────────────────────────────────────────

function randomAge() {
  const r = Math.random();
  let cum = 0;
  for (const [min, max, w] of AGE_GROUPS_WEIGHTED) {
    cum += w;
    if (r <= cum) return min + Math.floor(Math.random() * (max - min + 1));
  }
  return 30;
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  // escape single quotes for SQL
  return `'${String(v).replace(/'/g, "''")}'`;
}

// Facility lookup
const FAC_BY_BRGY = {};
for (const [name, brgy] of FACILITIES) {
  if (!FAC_BY_BRGY[brgy]) FAC_BY_BRGY[brgy] = [];
  FAC_BY_BRGY[brgy].push(name);
}

// ── Main ───────────────────────────────────────────────────────

async function seed() {
  const client = await pool.connect();
  const start = Date.now();

  try {
    await client.query('BEGIN');

    // ── L0: Reference data ──────────────────────────────────
    console.log('📍 Seeding L0 (barangays + facilities)...');

    // Batch barangays
    const brgyValues = BARANGAYS.map(b => {
      const lon = (121.06 + (Math.random() - 0.5) * 0.06).toFixed(6);
      const lat = (14.56 + (Math.random() - 0.5) * 0.04).toFixed(6);
      return `(${esc(b.name)},${b.pop},${lon},${lat})`;
    }).join(',');
    await client.query(
      `INSERT INTO barangays (name,population,centroid_lon,centroid_lat)
       VALUES ${brgyValues}
       ON CONFLICT (name) DO UPDATE SET
         population=EXCLUDED.population, centroid_lon=EXCLUDED.centroid_lon, centroid_lat=EXCLUDED.centroid_lat`
    );
    console.log(`   ✅ ${BARANGAYS.length} barangays`);

    // Batch facilities
    const facValues = FACILITIES.map(([n, b, t]) =>
      `(${esc(n)},${esc(b)},${esc(t)})`
    ).join(',');
    await client.query(
      `INSERT INTO health_facilities (name,barangay_name,facility_type)
       VALUES ${facValues}
       ON CONFLICT (name,barangay_name) DO UPDATE SET facility_type=EXCLUDED.facility_type`
    );
    console.log(`   ✅ ${FACILITIES.length} facilities`);

    // ── L1+L2: Generate cases in memory, then batch INSERT ─
    console.log('🦠 Generating TB case data...');
    const batchId = uuidv4();
    const totalPop = BARANGAYS.reduce((s, b) => s + b.pop, 0);
    const now = new Date().toISOString();

    // Pre-generate all cases in memory
    const rawRows = [];   // for tb_cases_raw
    const cleanRows = []; // for tb_cases
    let rowNum = 0;

    // 24 months: Jan 2024 – Dec 2025
    for (let m = 0; m < 24; m++) {
      const year = 2024 + Math.floor(m / 12);
      const month = m % 12;
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const seasonalMult = (month >= 5 && month <= 10) ? 1.3 : 0.85;

      for (const brgy of BARANGAYS) {
        const weight = brgy.pop / totalPop;
        const noise = 1 + (Math.random() - 0.5) * 0.6;
        const numCases = Math.max(1, Math.round(weight * 500 * seasonalMult * noise));

        for (let i = 0; i < numCases; i++) {
          rowNum++;
          const day = 1 + Math.floor(Math.random() * daysInMonth);
          const diag = new Date(year, month, day);

          const screenOff = Math.floor(Math.random() * 31);
          const screen = new Date(diag); screen.setDate(screen.getDate() - screenOff);

          const notifOff = Math.floor(Math.random() * 8);
          const notif = new Date(diag); notif.setDate(notif.getDate() + notifOff);

          const treatOff = Math.floor(Math.random() * 15);
          const treat = new Date(diag); treat.setDate(treat.getDate() + treatOff);

          const outMonths = 2 + Math.floor(Math.random() * 8);
          const outcome = new Date(treat); outcome.setMonth(outcome.getMonth() + outMonths);
          if (outcome > new Date(2025, 11, 31)) outcome.setTime(new Date(2025, 11, 31).getTime());

          const age = randomAge();
          const sex = pick(SEXES);
          const brgyFac = FAC_BY_BRGY[brgy.name] || [brgy.name + ' HC'];
          const fac = pick(brgyFac);
          const reg = pick(REG_GROUPS);
          const bact = pick(BACTERIO);
          const outStatus = pick(OUTCOMES);
          const anat = pick(ANAT_SITES);
          const src = pick(SOURCES);

          const diagS = fmtDate(diag);
          const screenS = fmtDate(screen);
          const notifS = fmtDate(notif);
          const treatS = fmtDate(treat);
          const outS = fmtDate(outcome);

          // raw row (21 cols)
          rawRows.push(
            `(${esc(batchId)},${rowNum},${esc('Validated')},` +
            `${esc(screenS)},${esc(diagS)},${esc(notifS)},` +
            `${age},${esc(sex)},${esc(brgy.name)},${esc('PASIG CITY')},` +
            `${esc(fac)},${esc(fac)},` +
            `${esc(src)},${esc(anat)},` +
            `${esc(reg)},${esc(bact)},` +
            `${esc(treatS)},${esc(outStatus)},${esc(outS)},` +
            `${esc(now)},${esc('seed_data.js')})`
          );

          // cleaned row (16 cols)
          cleanRows.push(
            `(${esc(batchId)},` +
            `${esc(diagS)},${esc(screenS)},${esc(notifS)},` +
            `${age},${esc(sex)},${esc(brgy.name)},` +
            `${esc(fac)},${esc(fac)},` +
            `${esc(src)},${esc(anat)},` +
            `${esc(reg)},${esc(bact)},` +
            `${esc(treatS)},${esc(outStatus)},${esc(outS)})`
          );
        }
      }

      if ((m + 1) % 6 === 0) {
        console.log(`   ... generated data for ${m + 1}/24 months`);
      }
    }

    console.log(`   📝 ${rowNum} cases generated in memory`);

    // Batch INSERT tb_cases_raw
    console.log('💾 Inserting tb_cases_raw...');
    for (let i = 0; i < rawRows.length; i += BATCH_SIZE) {
      const batch = rawRows.slice(i, i + BATCH_SIZE);
      await client.query(
        `INSERT INTO tb_cases_raw (
          batch_id,row_number,validation_status,
          date_of_screening,date_of_diagnosis,date_of_notification,
          age,sex,barangay_name,city,
          screening_facility,treatment_facility,
          source_of_patient,anatomical_site,
          registration_group,bacteriological_status,
          date_started_treatment,outcome_status,date_of_outcome,
          record_created_at,source_file
        ) VALUES ${batch.join(',')}`
      );
    }
    console.log(`   ✅ tb_cases_raw: ${rawRows.length} rows`);

    // Batch INSERT tb_cases
    console.log('💾 Inserting tb_cases...');
    for (let i = 0; i < cleanRows.length; i += BATCH_SIZE) {
      const batch = cleanRows.slice(i, i + BATCH_SIZE);
      await client.query(
        `INSERT INTO tb_cases (
          batch_id,
          date_of_diagnosis,date_of_screening,date_of_notification,
          age,sex,barangay_name,
          screening_facility,treatment_facility,
          source_of_patient,anatomical_site,
          registration_group,bacteriological_status,
          date_started_treatment,outcome_status,date_of_outcome
        ) VALUES ${batch.join(',')}`
      );
    }
    console.log(`   ✅ tb_cases: ${cleanRows.length} rows`);

    // Free memory
    rawRows.length = 0;
    cleanRows.length = 0;

    // ── L3: Aggregations (SQL GROUP BY — fast) ──────────────
    console.log('📊 Building L3 aggregations...');

    await client.query('DELETE FROM monthly_case_summary');
    const m1 = await client.query(`
      INSERT INTO monthly_case_summary (barangay_name, month, case_count)
      SELECT barangay_name, DATE_TRUNC('month', date_of_diagnosis)::DATE, COUNT(*)
      FROM tb_cases GROUP BY barangay_name, DATE_TRUNC('month', date_of_diagnosis)`);
    console.log(`   ✅ monthly_case_summary: ${m1.rowCount}`);

    await client.query('DELETE FROM demographic_summary');
    const m2 = await client.query(`
      INSERT INTO demographic_summary (barangay_name, month, sex, age_group, case_count)
      SELECT barangay_name, DATE_TRUNC('month', date_of_diagnosis)::DATE, sex,
        CASE WHEN age IS NULL THEN 'Unknown' WHEN age<=14 THEN '0-14' WHEN age<=24 THEN '15-24'
          WHEN age<=34 THEN '25-34' WHEN age<=44 THEN '35-44' WHEN age<=54 THEN '45-54'
          WHEN age<=64 THEN '55-64' ELSE '65+' END,
        COUNT(*)
      FROM tb_cases GROUP BY barangay_name, DATE_TRUNC('month', date_of_diagnosis), sex,
        CASE WHEN age IS NULL THEN 'Unknown' WHEN age<=14 THEN '0-14' WHEN age<=24 THEN '15-24'
          WHEN age<=34 THEN '25-34' WHEN age<=44 THEN '35-44' WHEN age<=54 THEN '45-54'
          WHEN age<=64 THEN '55-64' ELSE '65+' END`);
    console.log(`   ✅ demographic_summary: ${m2.rowCount}`);

    await client.query('DELETE FROM outcome_summary');
    const m3 = await client.query(`
      INSERT INTO outcome_summary (barangay_name, month, outcome_status, case_count)
      SELECT barangay_name, DATE_TRUNC('month', date_of_diagnosis)::DATE,
        COALESCE(outcome_status,'Unknown'), COUNT(*)
      FROM tb_cases GROUP BY barangay_name, DATE_TRUNC('month', date_of_diagnosis), COALESCE(outcome_status,'Unknown')`);
    console.log(`   ✅ outcome_summary: ${m3.rowCount}`);

    await client.query('DELETE FROM facility_summary');
    const m4 = await client.query(`
      INSERT INTO facility_summary (facility_name, barangay_name, month, case_count)
      SELECT COALESCE(screening_facility,'Unknown'), barangay_name,
        DATE_TRUNC('month', date_of_diagnosis)::DATE, COUNT(*)
      FROM tb_cases WHERE screening_facility IS NOT NULL AND screening_facility!=''
      GROUP BY barangay_name, DATE_TRUNC('month', date_of_diagnosis), screening_facility`);
    console.log(`   ✅ facility_summary: ${m4.rowCount}`);

    await client.query('DELETE FROM bacteriological_summary');
    const m5 = await client.query(`
      INSERT INTO bacteriological_summary (barangay_name, month, bacteriological_status, case_count)
      SELECT barangay_name, DATE_TRUNC('month', date_of_diagnosis)::DATE,
        COALESCE(bacteriological_status,'Unknown'), COUNT(*)
      FROM tb_cases GROUP BY barangay_name, DATE_TRUNC('month', date_of_diagnosis), COALESCE(bacteriological_status,'Unknown')`);
    console.log(`   ✅ bacteriological_summary: ${m5.rowCount}`);

    await client.query('COMMIT');

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n🎉 Seeding complete in ${elapsed}s!`);
    console.log(`   Cases: ${rowNum}  |  Months: 24  |  Barangays: ${BARANGAYS.length}`);

    // Summary
    const summary = await pool.query(`
      SELECT barangay_name, COUNT(*) as cases
      FROM tb_cases GROUP BY barangay_name ORDER BY cases DESC LIMIT 10`);
    console.log('\n   Top 10 barangays:');
    for (const r of summary.rows) {
      console.log(`     ${r.barangay_name}: ${r.cases}`);
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seeding failed:', err.message);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
}

seed();
