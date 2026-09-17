const XLSX = require('xlsx');

// ==================== HEADER MATCHING ====================

// Month abbreviations for DD-Mon-YY parsing
const MONTH_ABBR = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Match a normalized (lowercase, trimmed) header to an internal field name.
 * Uses keyword-based matching — tolerant of mangled headers, extra spaces,
 * column reordering, and minor naming differences.
 *
 * Order matters: more specific rules come first to avoid false matches.
 */
function matchHeader(normalized) {
  // Skip row-number column
  if (normalized === 'no.' || normalized === 'no') return null;

  // --- Date fields (most specific — contain "date") ---
  if (normalized.includes('notification') && normalized.includes('date'))
    return 'date_of_notification';
  if (normalized.includes('screening') && normalized.includes('date'))
    return 'date_of_screening';
  if (normalized.includes('diagnosis') && normalized.includes('date'))
    return 'date_of_diagnosis';
  if (normalized.includes('treatment') && normalized.includes('started'))
    return 'date_started_treatment';
  if (normalized.includes('outcome') && normalized.includes('date'))
    return 'date_of_outcome';
  if (normalized.includes('record') && normalized.includes('created'))
    return 'record_created_at';

  // --- Simple exact matches ---
  if (normalized === 'age') return 'age';
  if (normalized === 'sex') return 'sex';
  if (normalized.includes('city') || normalized.includes('municipality')) return 'city';
  if (normalized.includes('barangay')) return 'barangay_name';

  // --- Facility fields (contain "treatment"/"screening" + "health"/"facility") ---
  if (
    normalized.includes('treatment') &&
    (normalized.includes('health') || normalized.includes('facility'))
  )
    return 'treatment_facility';
  if (
    normalized.includes('screening') &&
    (normalized.includes('health') || normalized.includes('facility'))
  )
    return 'screening_facility';

  // --- Other fields ---
  if (normalized.includes('source') && normalized.includes('patient'))
    return 'source_of_patient';
  if (normalized.includes('anatomical')) return 'anatomical_site';
  if (normalized.includes('registration')) return 'registration_group';
  if (normalized.includes('bacteriological') || normalized.includes('bacteriologic')) return 'bacteriological_status';
  if (normalized.includes('validation')) return 'validation_status';
  if (normalized.includes('itis') && normalized.includes('lite')) return 'itis_case_id';
  if (normalized.includes('source') && normalized.includes('type')) return 'source_type';
  if (normalized.includes('outcome') && !normalized.includes('date') && !normalized.includes('reason')) return 'outcome_status';
  if (normalized === 'type') return 'type';
  if (normalized.includes('province')) return 'province';
  if (normalized.includes('region')) return 'region';
  if (normalized.includes('referred') || normalized.includes('dots')) return 'referred_to_dots';
  if (normalized.includes('referral') && normalized.includes('status')) return 'referral_status';
  if (normalized.includes('microscopy') && normalized.includes('result')) return 'microscopy_result';
  if (normalized.includes('microscopy') && normalized.includes('date')) return 'microscopy_release_date';
  if (normalized.includes('rdt') && normalized.includes('result')) return 'rdt_result';
  if (normalized.includes('rdt') && normalized.includes('date')) return 'rdt_release_date';
  if (normalized.includes('outcome') && normalized.includes('reason')) return 'outcome_reason';

  return null;
}

/**
 * Build a column map from raw CSV headers.
 * Returns { originalHeader: internalFieldName, ... }
 * Keys are RAW (untrimmed) so they match what sheet_to_json produces.
 * Matching is done on the trimmed, lowercased form.
 * Unrecognized headers are silently skipped.
 */
function buildColumnMap(rawHeaders) {
  const map = {};
  for (const raw of rawHeaders) {
    const header = String(raw || ''); // preserve original text (spaces, etc.)
    const normalized = header.trim().toLowerCase();
    const field = matchHeader(normalized);
    if (field) {
      map[header] = field;
    }
  }
  return map;
}

// ==================== VALIDATION CONSTANTS ====================

// Valid values for enum-like fields
const VALID_SEX = ['male', 'female', 'm', 'f'];
const VALID_CITIES = ['pasig', 'pasig city'];
const VALID_ANATOMICAL_SITES = ['pulmonary', 'extra-pulmonary', 'extrapulmonary'];
const VALID_OUTCOME_STATUSES = [
  'cured', 'treatment completed', 'died', 'treatment failed',
  'lost to follow-up', 'not evaluated', 'refused', 'on treatment',
  'excluded',
];

// Known health facilities per barangay (for cross-checking, warnings only)
const FACILITY_MAP = {
  'bagong ilog': ['bagong ilog hc', 'bagong ilog pc'],
  'bambang': ['bambang hc'],
  'buting': ['buting hc'],
  'caniogan': ['caniogan hc', 'caniogan health center - idots'],
  'dela paz': ['dela paz hc'],
  'kalawaan': ['kalawaan hc', 'ismar hc'],
  'kapasigan': ['kapasigan hc'],
  'kapitolyo': ['kapitolyo hc'],
  'malinao': ['malinao hc'],
  'manggahan': ['manggahan hc', 'napico hc', 'karangalan hc'],
  'maybunga': ['maybunga itc', 'maybunga floodway'],
  'oranbo': ['oranbo hc'],
  'palatiw': ['palatiw hc'],
  'pinagbuhatan': [
    'pinagbuhatan hc', 'pinagbuhatan puericulture center',
    'e. santos', 'nagpayong hc',
  ],
  'pineda': ['pineda hc'],
  'rosario': ['rosario hc'],
  'sagad': ['sagad hc'],
  'san antonio': ['san antonio hc'],
  'san joaquin': ['san joaquin hc'],
  'san jose': ['san jose hc'],
  'san miguel': ['san miguel hc'],
  'san nicolas': ['san nicolas hc'],
  'santa cruz': ['santa cruz hc'],
  'santa lucia': ['santa lucia hc'],
  'santa rosa': ['santa rosa hc'],
  'santo tomas': ['santo tomas hc'],
  'santolan': ['santolan hc', 'dona betang hc'],
  'sumilang': ['sumilang hc'],
  'ugong': ['ugong hc'],
  'kapasigan extension': ['kapasigan extension hc'],
};

// ==================== DATE PARSING ====================

/**
 * Parse a date value into a YYYY-MM-DD string.
 * Handles: Date objects, ISO strings, MM/DD/YYYY, YYYY-MM-DD, M/D/YYYY,
 *          DD-Mon-YY, DD-Mon-YYYY (e.g., "8-Jul-26", "16-Dec-25")
 * Returns date as YYYY-MM-DD (no timezone shift), or null on failure.
 */
function parseDate(dateVal) {
  if (dateVal === null || dateVal === undefined || dateVal === '') return null;

  // Handle Date objects (from xlsx cellDates)
  if (dateVal instanceof Date) {
    if (isNaN(dateVal.getTime())) return null;
    const y = dateVal.getFullYear();
    const m = dateVal.getMonth() + 1;
    const d = dateVal.getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const str = String(dateVal).trim();
  if (str === '') return null;

  // Handle ISO strings (from xlsx: "2024-01-14T16:00:00.000Z")
  const isoFullMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoFullMatch) {
    return `${isoFullMatch[1]}-${isoFullMatch[2]}-${isoFullMatch[3]}`;
  }

  // Try ISO format (YYYY-MM-DD)
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [_, year, month, day] = isoMatch;
    const y = parseInt(year);
    const m = parseInt(month);
    const d = parseInt(day);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // Try DD-Mon-YY or DD-Mon-YYYY (e.g., "8-Jul-26", "16-Dec-25")
  const ddmMonMatch = str.match(/^(\d{1,2})\-([A-Za-z]{3})\-(\d{2,4})$/);
  if (ddmMonMatch) {
    const [_, day, monStr, yearStr] = ddmMonMatch;
    const monthNum = MONTH_ABBR[monStr.toLowerCase()];
    if (monthNum) {
      let y = parseInt(yearStr);
      if (y >= 0 && y < 100) y += 2000; // 26 → 2026
      const d = parseInt(day);
      if (d >= 1 && d <= 31) {
        return `${y}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }

  // Try US format (MM/DD/YYYY or M/D/YYYY)
  const usMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (usMatch) {
    const [_, month, day, year] = usMatch;
    const y = parseInt(year);
    const m = parseInt(month);
    const d = parseInt(day);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

// ==================== SEX NORMALIZATION ====================

/**
 * Normalize sex to "Male" or "Female".
 * Accepts: M, F, Male, Female (case-insensitive).
 * Returns null if unrecognised.
 */
function normalizeSex(val) {
  if (!val) return null;
  const v = String(val).trim().toLowerCase();
  if (v === 'm' || v === 'male') return 'Male';
  if (v === 'f' || v === 'female') return 'Female';
  return null;
}

// ==================== ROW VALIDATION ====================

/**
 * Validate a single mapped row.
 * Returns { valid: boolean, errors: string[], warnings: string[] }
 */
function validateRow(row, validBarangays) {
  const errors = [];
  const warnings = [];

  // Required: barangay_name
  if (!row.barangay_name || row.barangay_name.trim() === '') {
    errors.push('Barangay is required');
  } else if (!validBarangays.has(row.barangay_name.trim().toLowerCase())) {
    const isPasig = row.city && VALID_CITIES.includes(row.city.trim().toLowerCase());
    if (isPasig) {
      errors.push(`Unknown barangay: "${row.barangay_name}"`);
    } else {
      warnings.push(`Non-Pasig record: unknown barangay "${row.barangay_name}"`);
    }
  }

  // Required: date_of_diagnosis
  if (!row.date_of_diagnosis) {
    errors.push('Date of Diagnosis is required');
  }

  // Required: sex
  if (!row.sex || row.sex.trim() === '') {
    errors.push('Sex is required');
  } else if (!['male', 'female'].includes(row.sex.trim().toLowerCase())) {
    errors.push(`Invalid sex: "${row.sex}". Must be Male or Female`);
  }

  // Age validation (optional but if present, must be 0–120)
  if (row.age !== null && row.age !== undefined && row.age !== '') {
    const age = parseInt(row.age);
    if (isNaN(age) || age < 0 || age > 120) {
      errors.push(`Invalid age: "${row.age}". Must be 0-120`);
    }
  }

  // City validation (optional, should be Pasig)
  if (row.city && row.city.trim() !== '') {
    if (!VALID_CITIES.includes(row.city.trim().toLowerCase())) {
      warnings.push(`City is "${row.city}", expected "Pasig"`);
    }
  }

  // Facility cross-check (warnings only, never rejections)
  const barangayKey = row.barangay_name ? row.barangay_name.trim().toLowerCase() : '';
  const knownFacilities = FACILITY_MAP[barangayKey] || [];

  if (row.screening_facility && row.screening_facility.trim() !== '') {
    const facilityLower = row.screening_facility.trim().toLowerCase();
    if (knownFacilities.length > 0 && !knownFacilities.includes(facilityLower)) {
      warnings.push(
        `Screening facility "${row.screening_facility}" does not match barangay "${row.barangay_name}"`
      );
    }
  }

  if (row.treatment_facility && row.treatment_facility.trim() !== '') {
    const facilityLower = row.treatment_facility.trim().toLowerCase();
    if (knownFacilities.length > 0 && !knownFacilities.includes(facilityLower)) {
      warnings.push(
        `Treatment facility "${row.treatment_facility}" does not match barangay "${row.barangay_name}"`
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ==================== SHEET TYPE DETECTION ====================

/**
 * Detect source_type from sheet name or headers.
 * MN sheets contain "MN" or "MICROSCOPIC" in the name; DSTB for "DSTB" or "B-MODE".
 * For CSV files (sheet name is "Sheet1"), fall back to header detection.
 * For multi-sheet Excel files, unknown sheets are skipped (return null).
 */
function detectSheetType(sheetName, headers = []) {
  const name = sheetName.toUpperCase().trim();
  if (name === 'DSTB' || name.includes('DSTB') || name.includes('B-MODE')) return 'DSTB';
  if (name === 'MN' || name === 'M-N' || name.includes('MICROSCOPIC')) return 'MN';

  // Fallback: check headers for MN-specific columns (itis_case_id present = MN)
  const headerStr = headers.map(h => String(h || '').toLowerCase()).join(' ');
  if (headerStr.includes('itis') && headerStr.includes('lite')) return 'MN';

  // Single-sheet CSV files have default name "Sheet1" — treat as DSTB
  if (name === 'SHEET1') return 'DSTB';

  // Unknown multi-sheet — skip
  return null;
}

// ==================== MAIN PARSER ====================

/**
 * Parse a CSV or Excel file buffer into structured case records.
 * Supports multi-sheet Excel files (DSTB + MN sheets).
 * Uses keyword-based header matching — works with mangled headers,
 * leading/trailing spaces, column reordering, and both 18-col and
 * 19-col formats.
 *
 * @param {Buffer} fileBuffer - Raw file content
 * @param {string} filename  - Original filename (for metadata)
 * @param {Set<string>} validBarangays - Lowercase barangay names for validation
 * @returns {{ rows, errors, warnings, totalRows, validCount, errorCount }}
 */
function parseCaseFile(fileBuffer, filename, validBarangays = new Set()) {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });

  const rows = [];
  const allErrors = [];
  const allWarnings = [];
  let validCount = 0;
  let errorCount = 0;

  // Process ALL sheets (multi-sheet support)
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    // Extract raw headers — preserve original text (spaces, etc.)
    // because sheet_to_json uses these exact strings as object keys
    const rawHeaders = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || [];

    const source_type = detectSheetType(sheetName, rawHeaders);

    if (!source_type) continue; // Skip unknown sheets

    // Build column map via keyword matching (keys are raw, untrimmed)
    const columnMap = buildColumnMap(rawHeaders);

    // Parse all data rows (keys are the trimmed header strings)
    const rawData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    rawData.forEach((rawRow, index) => {
      const rowNum = index + 2; // +2 = row 1 header + 0-based index

      // Map raw row → internal field names
      const mappedRow = {};
      for (const [csvCol, field] of Object.entries(columnMap)) {
        const val = rawRow[csvCol];
        if (val !== undefined && val !== null) {
          mappedRow[field] = val instanceof Date ? val : String(val).trim();
        }
      }

      // Set source_type and sheet_name
      mappedRow.source_type = source_type;
      mappedRow.sheet_name = sheetName;

      // Preserve original source validation_status (DSTB records have this from the Excel file)
      mappedRow.source_validation_status = source_type === 'DSTB' ? (mappedRow.validation_status || null) : null;

      // Parse dates
      mappedRow.date_of_screening = parseDate(mappedRow.date_of_screening);
      mappedRow.date_of_diagnosis = parseDate(mappedRow.date_of_diagnosis);
      mappedRow.date_of_notification = parseDate(mappedRow.date_of_notification);
      mappedRow.date_started_treatment = parseDate(mappedRow.date_started_treatment);
      mappedRow.date_of_outcome = parseDate(mappedRow.date_of_outcome);
      mappedRow.record_created_at = mappedRow.record_created_at
        ? new Date(mappedRow.record_created_at).toISOString()
        : null;

      // Parse age
      if (mappedRow.age !== null && mappedRow.age !== undefined && mappedRow.age !== '') {
        mappedRow.age = parseInt(mappedRow.age);
      } else {
        mappedRow.age = null;
      }

      // Normalize sex (M → Male, F → Female)
      mappedRow.sex = normalizeSex(mappedRow.sex);

      // Trim barangay name
      if (mappedRow.barangay_name) {
        mappedRow.barangay_name = mappedRow.barangay_name.trim();
      }

      // Validate
      const validation = validateRow(mappedRow, validBarangays);

      mappedRow.row_number = rowNum;
      mappedRow.record_validation_status = validation.valid ? 'Validated' : 'Not Validated';
      mappedRow.validation_status = mappedRow.record_validation_status;
      mappedRow._errors = validation.errors;
      mappedRow._warnings = validation.warnings;

      if (validation.valid) {
        validCount++;
      } else {
        errorCount++;
        allErrors.push({ row: rowNum, source_type, errors: validation.errors });
      }

      if (validation.warnings.length > 0) {
        allWarnings.push({ row: rowNum, source_type, warnings: validation.warnings });
      }

      rows.push(mappedRow);
    });
  }

  return {
    rows,
    errors: allErrors,
    warnings: allWarnings,
    totalRows: rows.length,
    validCount,
    errorCount,
  };
}

module.exports = {
  parseCaseFile,
  validateRow,
  parseDate,
  normalizeSex,
  matchHeader,
  buildColumnMap,
  detectSheetType,
  VALID_SEX,
  VALID_ANATOMICAL_SITES,
  VALID_OUTCOME_STATUSES,
  FACILITY_MAP,
};
