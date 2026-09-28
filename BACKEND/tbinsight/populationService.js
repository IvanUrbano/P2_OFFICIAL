/**
 * populationService.js
 *
 * Unified population lookup service for TBInsight.
 *
 * SOURCE A — 2025 Population: Existing GeoJSON (read-only, authoritative)
 * SOURCE B — Future Population: Neon PostgreSQL barangay_population table
 *
 * Key rule: Case year MUST match population year for incidence.
 *           Missing population returns null (NOT zero).
 */

const fs = require('fs');
const path = require('path');
const pool = require('../db');

const GEOJSON_REFERENCE_YEAR = 2025;

let geojsonPopulationCache = null;

// ==================== GEOJSON (2025) ====================

function loadGeoJSONPopulation() {
  if (geojsonPopulationCache) return geojsonPopulationCache;
  const geojsonPath = path.join(__dirname, '..', 'data', 'pasig-barangays.geojson');
  const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  geojsonPopulationCache = {};
  for (const feature of geojson.features) {
    const name = feature.properties.name;
    const population = feature.properties.population;
    if (name && population && population > 0) {
      geojsonPopulationCache[name] = population;
    }
  }
  return geojsonPopulationCache;
}

// ==================== UNIFIED LOOKUP ====================

async function getPopulation(barangayName, year) {
  const yearNum = Number(year);

  if (yearNum === GEOJSON_REFERENCE_YEAR) {
    const pop = loadGeoJSONPopulation()[barangayName];
    if (pop && pop > 0) {
      return {
        population: pop,
        reference_year: GEOJSON_REFERENCE_YEAR,
        source_organization: null,
        source_reference: null,
        storage_type: 'geojson',
        available: true,
      };
    }
    return { population: null, reference_year: null, source_organization: null, source_reference: null, storage_type: null, available: false };
  }

  const result = await pool.query(
    `SELECT population, source_organization, source_reference, notes, status
     FROM barangay_population
     WHERE barangay_name = $1 AND reference_year = $2`,
    [barangayName, yearNum]
  );

  if (result.rows.length > 0 && result.rows[0].population > 0) {
    const row = result.rows[0];
    return {
      population: row.population,
      reference_year: yearNum,
      source_organization: row.source_organization,
      source_reference: row.source_reference,
      storage_type: 'database',
      available: true,
    };
  }

  return { population: null, reference_year: null, source_organization: null, source_reference: null, storage_type: null, available: false };
}

async function getPopulationMap(year) {
  const barangays = await pool.query('SELECT name FROM barangays ORDER BY name');
  const map = {};
  for (const row of barangays.rows) {
    map[row.name] = await getPopulation(row.name, year);
  }
  return map;
}

// ==================== INCIDENCE ====================

function calculateIncidence(caseCount, population) {
  if (population === null || population === undefined || population <= 0) return null;
  return (caseCount / population) * 100000;
}

function calculateAnnualizedIncidence(monthlyCases, population) {
  if (population === null || population === undefined || population <= 0) return null;
  return ((monthlyCases * 12) / population) * 100000;
}

// ==================== YEARS ====================

async function getAvailablePopulationYears() {
  const dbYears = await pool.query(
    `SELECT DISTINCT reference_year FROM barangay_population WHERE status = 'ACTIVE' ORDER BY reference_year DESC`
  );
  const years = dbYears.rows.map(r => r.reference_year);
  if (!years.includes(GEOJSON_REFERENCE_YEAR)) years.unshift(GEOJSON_REFERENCE_YEAR);
  return years;
}

// ==================== CRUD ====================

async function getPopulationReferences() {
  const dbResult = await pool.query(`
    SELECT reference_year, source_organization, source_reference, status,
           COUNT(*) as barangay_count, MIN(created_at) as created_at, MAX(updated_at) as updated_at
    FROM barangay_population
    GROUP BY reference_year, source_organization, source_reference, status
    ORDER BY reference_year DESC
  `);

  const references = dbResult.rows.map(row => ({
    reference_year: row.reference_year,
    source_organization: row.source_organization,
    source_reference: row.source_reference,
    status: row.status,
    barangay_count: parseInt(row.barangay_count),
    storage_type: 'database',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  const has2025 = references.some(r => r.reference_year === GEOJSON_REFERENCE_YEAR);
  if (!has2025) {
    references.unshift({
      reference_year: GEOJSON_REFERENCE_YEAR,
      source_organization: null,
      source_reference: null,
      status: 'ACTIVE',
      barangay_count: Object.keys(loadGeoJSONPopulation()).length,
      storage_type: 'geojson',
      created_at: null,
      updated_at: null,
    });
  }

  return references;
}

async function getPopulationByYear(referenceYear) {
  const yearNum = Number(referenceYear);

  if (yearNum === GEOJSON_REFERENCE_YEAR) {
    const popMap = loadGeoJSONPopulation();
    return Object.entries(popMap).map(([name, pop]) => ({
      barangay_name: name,
      population: pop,
      reference_year: GEOJSON_REFERENCE_YEAR,
      source_organization: null,
      source_reference: null,
      storage_type: 'geojson',
    }));
  }

  const result = await pool.query(
    `SELECT * FROM barangay_population WHERE reference_year = $1 ORDER BY barangay_name`,
    [yearNum]
  );
  return result.rows.map(row => ({ ...row, storage_type: 'database' }));
}

async function validatePopulationData(referenceYear, records) {
  const barangaysResult = await pool.query('SELECT name FROM barangays ORDER BY name');
  const recognizedBarangays = barangaysResult.rows.map(r => r.name);

  const validation = {
    expected: recognizedBarangays.length,
    submitted: records.length,
    matched: 0,
    missing: [],
    unmatched: [],
    duplicates: [],
    invalid: [],
    valid_records: [],
  };

  const seen = new Set();
  for (const record of records) {
    const name = record.barangay_name?.trim();
    const pop = record.population;

    if (seen.has(name)) { validation.duplicates.push(name); continue; }
    seen.add(name);

    if (!recognizedBarangays.includes(name)) { validation.unmatched.push(name); continue; }
    if (!pop || isNaN(pop) || parseInt(pop) <= 0) { validation.invalid.push({ barangay_name: name, population: pop }); continue; }

    validation.matched++;
    validation.valid_records.push({ barangay_name: name, population: parseInt(pop), reference_year: Number(referenceYear) });
  }

  validation.missing = recognizedBarangays.filter(b => !seen.has(b));
  return validation;
}

async function savePopulationData(referenceYear, sourceOrganization, sourceReference, notes, records, userId) {
  const yearNum = Number(referenceYear);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const barangaysResult = await client.query('SELECT name FROM barangays');
    const allBarangays = barangaysResult.rows.map(r => r.name);
    const isComplete = records.length === allBarangays.length &&
                       records.every(r => allBarangays.includes(r.barangay_name));
    const status = isComplete ? 'ACTIVE' : 'INCOMPLETE';

    await client.query('DELETE FROM barangay_population WHERE reference_year = $1', [yearNum]);

    for (const record of records) {
      await client.query(
        `INSERT INTO barangay_population
         (barangay_name, population, reference_year, source_organization, source_reference, notes, status, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [record.barangay_name, parseInt(record.population), yearNum, sourceOrganization, sourceReference, notes || null, status, userId || null]
      );
    }

    await client.query('COMMIT');
    return { success: true, status, records_saved: records.length, reference_year: yearNum };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updatePopulationRecord(id, population, userId) {
  const result = await pool.query(
    `UPDATE barangay_population SET population = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3 RETURNING *`,
    [parseInt(population), userId || null, id]
  );
  return result.rows[0] || null;
}

// ==================== EXCEL PARSING ====================

/**
 * Parse population Excel template.
 * Extracts reference info from rows 4-7 and barangay data from rows 11-40.
 *
 * @param {Buffer} fileBuffer - Excel file buffer
 * @returns {object} { reference_year, source_organization, source_reference, notes, records: [{barangay_name, population}] }
 */
function parsePopulationExcel(fileBuffer) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(fileBuffer, { type: 'buffer' });

  // Get the "Population Import" sheet (first sheet or by name)
  const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('population')) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Extract reference info from rows 4-7 (0-indexed)
  // Row 4: Reference Year (column B = index 1)
  // Row 5: Source / Organization (column B = index 1)
  // Row 6: Dataset / Reference Name (column B = index 1)
  // Row 7: Notes (column B = index 1)
  const referenceYear = data[4] ? data[4][1] : null;
  const sourceOrganization = data[5] ? String(data[5][1] || '').trim() : '';
  const sourceReference = data[6] ? String(data[6][1] || '').trim() : '';
  const notes = data[7] ? String(data[7][1] || '').trim() : '';

  // Extract barangay data from rows 11-40 (0-indexed)
  // Column A (index 0): No.
  // Column B (index 1): Barangay Name
  // Column C (index 2): Population
  const records = [];
  for (let i = 10; i <= 39; i++) {
    const row = data[i];
    if (!row) continue;

    const barangayName = row[1] ? String(row[1]).trim() : '';
    const population = row[2];

    if (barangayName) {
      records.push({
        barangay_name: barangayName,
        population: population !== null && population !== undefined ? String(population) : '',
      });
    }
  }

  return {
    reference_year: referenceYear ? Number(referenceYear) : null,
    source_organization: sourceOrganization,
    source_reference: sourceReference,
    notes: notes,
    records: records,
  };
}

/**
 * Parse CSV population data.
 * Supports both simple format (barangay_name,population) and template format
 * with reference info at the top.
 *
 * @param {string} csvContent - CSV file content as string
 * @returns {object} { reference_year, source_organization, source_reference, notes, records: [{barangay_name, population}] }
 */
function parsePopulationCsv(csvContent) {
  const lines = csvContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  let reference_year = null;
  let source_organization = '';
  let source_reference = '';
  let notes = '';
  const records = [];

  // Detect template format: first line starts with "TBInsight"
  const isTemplate = lines[0] && lines[0].startsWith('TBInsight');

  if (isTemplate) {
    // Parse reference info from template
    for (const line of lines) {
      if (line.startsWith('Reference Year')) {
        const parts = line.split(',');
        const val = parts[1]?.trim();
        if (val && !isNaN(val) && val.toLowerCase() !== 'example: 2026') {
          reference_year = Number(val);
        } else if (val && val.includes('Example:')) {
          // Don't extract example value
        }
      }
      if (line.startsWith('Source / Organization')) {
        const parts = line.split(',');
        const val = parts[1]?.trim();
        if (val && !val.startsWith('Enter')) source_organization = val;
      }
      if (line.startsWith('Dataset / Reference')) {
        const parts = line.split(',');
        const val = parts[1]?.trim();
        if (val && !val.startsWith('Enter')) source_reference = val;
      }
      if (line.startsWith('Notes')) {
        const parts = line.split(',');
        const val = parts[1]?.trim();
        if (val && !val.startsWith('Additional')) notes = val;
      }
    }

    // Parse barangay data: lines starting with a number followed by comma
    for (const line of lines) {
      const match = line.match(/^(\d+),([^,]*),(.*)$/);
      if (match) {
        const barangayName = match[2]?.trim();
        const population = match[3]?.trim() || '';
        if (barangayName) {
          records.push({ barangay_name: barangayName, population });
        }
      }
    }
  } else {
    // Simple format: barangay_name,population
    const dataLines = lines.filter(l => !l.startsWith('barangay_name'));
    for (const line of dataLines) {
      const parts = line.split(',');
      const barangayName = parts[0]?.trim();
      const population = parts[1]?.trim() || '';
      if (barangayName) {
        records.push({ barangay_name: barangayName, population });
      }
    }
  }

  return { reference_year, source_organization, source_reference, notes, records };
}

// ==================== EXPORTS ====================

module.exports = {
  getPopulation,
  getPopulationMap,
  calculateIncidence,
  calculateAnnualizedIncidence,
  getAvailablePopulationYears,
  getPopulationReferences,
  getPopulationByYear,
  validatePopulationData,
  savePopulationData,
  updatePopulationRecord,
  parsePopulationExcel,
  parsePopulationCsv,
  GEOJSON_REFERENCE_YEAR,
};