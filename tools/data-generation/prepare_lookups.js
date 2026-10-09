#!/usr/bin/env node
/**
 * Build the two lookup files the generators use, from the real 2025 registry:
 *
 *   lookups/fac_resolved.json  facility name in the file -> {id, code, name} of the TBInsight
 *                              health facility it resolves to (registry name or facility alias,
 *                              exactly as Pasig Clone's facility_ref_id() does), or null
 *   lookups/bgymap.json        Brgy value in the file -> official barangay name, or null
 *                              (Pasig Clone's dataCleaner.matchBarangay)
 *
 * Reads both databases (BACKEND/.env and PASIG_CLONE/backend/.env); writes nothing to them.
 * Usage: node tools/data-generation/prepare_lookups.js "<2025 registry .xlsx>"
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PASIG = path.join(ROOT, 'PASIG_CLONE', 'backend');
const req = (name, from) => require(require.resolve(name, { paths: [from] }));
const dotenv = req('dotenv', path.join(ROOT, 'BACKEND'));
const { Pool } = req('pg', path.join(ROOT, 'BACKEND'));
const { parseRegistryFile } = require(path.join(PASIG, 'services', 'multiSheetParser'));
const { matchBarangay } = require(path.join(PASIG, 'services', 'dataCleaner'));

const dbUrl = file => dotenv.parse(fs.readFileSync(file)).DATABASE_URL;

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node prepare_lookups.js "<2025 registry .xlsx>"');
    process.exit(1);
  }
  const parsed = await parseRegistryFile(fs.readFileSync(file), path.basename(file));
  const records = parsed.sheets.flatMap(s => s.records);

  // Barangays
  const bgymap = {};
  for (const r of records) {
    const raw = r.barangay_name == null ? '' : String(r.barangay_name);
    const m = matchBarangay(raw);
    bgymap[raw] = m.matched ? m.name : null;
  }

  // Facilities: normalised with Pasig Clone's own norm_facility(), matched to the TBInsight
  // registry by name first, then through facility_aliases.
  const tb = new Pool({ connectionString: dbUrl(path.join(ROOT, 'BACKEND', '.env')) });
  const pc = new Pool({ connectionString: dbUrl(path.join(PASIG, '.env')) });
  try {
    const facs = (await tb.query('SELECT id, name, facility_code FROM health_facilities')).rows;
    const norm = async names => (await pc.query('SELECT n, norm_facility(n) AS k FROM unnest($1::text[]) n', [names])).rows;
    const byNorm = new Map((await norm(facs.map(f => f.name))).map(f => [f.k, f.n]));
    const facByName = new Map(facs.map(f => [f.name, f]));
    const facById = new Map(facs.map(f => [f.id, f]));
    const aliases = new Map((await pc.query('SELECT alias_norm, facility_id FROM facility_aliases')).rows
      .map(a => [a.alias_norm, a.facility_id]));

    const names = [...new Set(records.flatMap(r => [r.treatment_facility, r.screening_facility])
      .filter(Boolean).map(n => String(n).trim()))];
    const resolved = {};
    for (const { n, k } of await norm(names)) {
      const f = byNorm.has(k) ? facByName.get(byNorm.get(k)) : aliases.has(k) ? facById.get(aliases.get(k)) : null;
      resolved[n] = f ? { id: f.id, code: f.facility_code, name: f.name } : null;
    }

    const out = path.join(__dirname, 'lookups');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'fac_resolved.json'), JSON.stringify(resolved, null, 1));
    fs.writeFileSync(path.join(out, 'bgymap.json'), JSON.stringify(bgymap));
    console.log(`facilities: ${names.length} names, ${Object.values(resolved).filter(Boolean).length} resolved`);
    console.log(`barangays: ${Object.keys(bgymap).length} spellings, ${Object.values(bgymap).filter(Boolean).length} matched`);
  } finally {
    await tb.end();
    await pc.end();
  }
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
