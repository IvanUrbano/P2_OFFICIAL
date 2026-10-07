const MONTH_ABBR = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function normalizeHeader(header) {
  if (!header) return '';
  return String(header).replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Map spreadsheet header text to system field names.
 * Order matters: the more specific checks (dates, "outcome reason") run before the general ones.
 * Handles the real registry headers, e.g. "Date Started Tx", "Bacteriologic Status",
 * "Screening/Diagnosing Health Facility", "Outcome/Status", "Date of Outcome/Status".
 */
function buildColumnMap(rawHeaders, sourceType) {
  const map = {};

  for (let i = 0; i < rawHeaders.length; i++) {
    const n = normalizeHeader(rawHeaders[i]);
    if (!n) continue;

    if (n === 'no.' || n === 'no' || n === '#' || n === 'no. #') continue;

    let field = null;
    // The registry's ITIS column is not used or stored (the Case ID identifies the case).
    if (n.includes('itis')) continue;
    // Case ID carried by the file (<FACILITY>-<D|M>-<YEAR>-<NNNNN>, services/caseIds.js)
    if (n === 'case id' || n === 'case_id' || n === 'caseid') field = 'file_case_id';
    // Patient identity (stays in PASIG; never sent to TBInsight)
    else if (n.includes('birth') || n === 'dob' || n === 'birthday') field = 'date_of_birth';
    else if (n.includes('last name') || n.includes('surname') || n.includes('family name') || n === 'lastname') field = 'last_name';
    else if (n.includes('first name') || n.includes('given name') || n === 'firstname') field = 'first_name';
    else if (n.includes('middle') || n === 'mi' || n === 'm.i.' || n === 'm.i') field = 'middle_name';
    else if (n === 'suffix' || n.includes('name extension') || n === 'ext' || n === 'ext.' || n === 'extension') field = 'suffix';
    else if (['name', 'full name', 'patient name', "patient's name", 'name of patient'].includes(n)) field = 'full_name';
    else if (n.includes('microscopy') && n.includes('date')) field = 'microscopy_release_date';
    else if (n.includes('microscopy') && n.includes('result')) field = 'microscopy_result';
    else if (n.includes('rdt') && n.includes('date')) field = 'rdt_release_date';
    else if (n.includes('rdt') && n.includes('result')) field = 'rdt_result';
    else if (n.includes('notification') && n.includes('date')) field = 'date_of_notification';
    else if (n.includes('screening') && n.includes('date')) field = 'date_of_screening';
    else if ((n.includes('diagnosis') && n.includes('date')) || n === 'date diagnosed') field = 'date_of_diagnosis';
    else if (n.includes('date') && n.includes('start') && (n.includes('tx') || n.includes('treatment'))) field = 'date_started_treatment';
    else if (n.includes('treatment') && n.includes('started')) field = 'date_started_treatment';
    else if (n.includes('outcome') && n.includes('date')) field = 'date_of_outcome';
    else if (n.includes('record') && n.includes('created')) field = 'record_created_at';
    else if (n.includes('outcome') && n.includes('reason')) field = 'outcome_reason';
    else if (n === 'age' || n === 'age (years)' || n === 'age(yrs)') field = 'age';
    else if (n === 'sex' || n === 'gender') field = 'sex';
    else if (n.includes('barangay') || n === 'brgy' || n === 'brgy.' || n === 'bgy') field = 'barangay_name';
    else if (n.includes('city') || n.includes('municipality')) field = 'city';
    else if (n.includes('treatment') && (n.includes('health') || n.includes('facility'))) field = 'treatment_facility';
    else if ((n.includes('screening') || n.includes('diagnosing')) && (n.includes('health') || n.includes('facility'))) field = 'screening_facility';
    else if (n.includes('source') && n.includes('patient')) field = 'source_of_patient';
    else if (n.includes('anatomical')) field = 'anatomical_site';
    else if (n.includes('registration')) field = 'registration_group';
    else if (n.includes('bacteriolog')) field = 'bacteriological_status';
    else if (n.includes('outcome')) field = 'outcome_status';
    else if (n.includes('validation') && sourceType === 'DSTB') field = 'validation_status';
    else if (n === 'type') field = 'type';
    else if (n.includes('province')) field = 'province';
    else if (n.includes('region')) field = 'region';
    else if (n.includes('referral') && n.includes('status')) field = 'referral_status';
    else if (n.includes('referred') || n.includes('dots')) field = 'referred_to_dots';

    // First matching column wins; later duplicate headers are ignored.
    if (field && !Object.values(map).includes(field)) map[i] = field;
  }

  return map;
}

function parseDate(dateVal) {
  if (!dateVal) return null;
  if (dateVal instanceof Date) {
    if (isNaN(dateVal.getTime())) return null;
    return dateVal.toISOString().split('T')[0];
  }

  const str = String(dateVal).trim();
  if (!str) return null;

  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`;
  }

  // DD-Mon-YY or DD-Mon-YYYY (e.g., "07-Jan-23", "16-Dec-25")
  const ddmMonMatch = str.match(/^(\d{1,2})\-([A-Za-z]{3})\-(\d{2,4})$/);
  if (ddmMonMatch) {
    const [, day, monStr, yearStr] = ddmMonMatch;
    const monthNum = MONTH_ABBR[monStr.toLowerCase()];
    if (monthNum) {
      let y = parseInt(yearStr);
      if (y >= 0 && y < 100) y += 2000;
      const d = parseInt(day);
      if (d >= 1 && d <= 31) {
        return `${y}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }

  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];
  const writtenMatch = str.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (writtenMatch) {
    const monthIndex = monthNames.indexOf(writtenMatch[1].toLowerCase());
    if (monthIndex >= 0) {
      const m = String(monthIndex + 1).padStart(2, '0');
      const d = String(writtenMatch[2]).padStart(2, '0');
      return `${writtenMatch[3]}-${m}-${d}`;
    }
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

  return null;
}

function normalizeSex(val) {
  if (!val) return null;
  const v = String(val).trim().toLowerCase();
  if (v === 'm' || v === 'male') return 'Male';
  if (v === 'f' || v === 'female') return 'Female';
  return null;
}

function detectSheetType(sheetName) {
  const name = sheetName.toUpperCase().trim();
  if (name === 'DSTB' || name.includes('DSTB') || name.includes('B-MODE')) return 'DSTB';
  if (name === 'MN' || name === 'M-N' || name.includes('MICROSCOPIC')) return 'MN';
  return null; // Unknown sheet — skip
}

/**
 * For CSV files (no sheet names): decide DSTB vs MN from the file name, then the headers.
 * MN registries carry an "ITIS Lite Case No." / microscopy / RDT columns (used here only to
 * recognise the file type; the ITIS number itself is ignored); DSTB ones do not.
 */
function detectTypeFromHeaders(headers, filename = '') {
  const byName = detectSheetType(String(filename).replace(/\.[^.]+$/, '').replace(/[_]/g, ' '));
  if (byName) return byName;
  const h = headers.map(normalizeHeader).join(' | ');
  if ((h.includes('itis') && h.includes('lite')) || h.includes('microscopy') || h.includes('rdt')) return 'MN';
  return 'DSTB';
}

// Header words that identify the header row of a registry sheet.
const HEADER_HINTS = ['brgy', 'barangay', 'age', 'sex', 'diagnosis', 'outcome', 'facility', 'itis'];

/**
 * Find the header row: the first row (within the first 20) where at least three
 * different cells are short header-like labels containing a known header word.
 * Registries often have title rows above it (the DSTB sheet's headers are on row 6),
 * and a long title such as "Cases by Age and Sex" must not count as a header row.
 */
function findHeaderRow(rows) {
  const limit = Math.min(20, rows.length);
  for (let r = 0; r < limit; r++) {
    const cells = (rows[r] || []).map(c => normalizeHeader(plainCellValue(c)));
    const headerCells = cells.filter(c => c && c.length <= 45 && HEADER_HINTS.some(h => c === h || c.includes(h)));
    if (headerCells.length >= 3) return r;
  }
  return -1;
}

/**
 * Convert an ExcelJS cell value into a plain value (Date, number or string).
 */
function plainCellValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return plainCellValue(v.result); // formula
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if ('text' in v) return v.text; // hyperlink
    if ('error' in v) return null;
    return String(v);
  }
  return v;
}

/**
 * Shared row parser for Excel sheets and CSV files.
 * @param {Array<Array>} rows - 2D array of cell values (row 0 = first line of the sheet)
 * @param {string} sheetName
 * @param {'DSTB'|'MN'} sourceType
 * @returns {{ records: Array, headerRow: number, mappedColumns: string[], unmappedHeaders: string[] }}
 */
function parseSheetRows(rows, sheetName, sourceType) {
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    return { records: [], headerRow: null, mappedColumns: [], unmappedHeaders: [] };
  }

  const rawHeaders = (rows[headerIdx] || []).map(h => (h === null || h === undefined ? '' : String(plainCellValue(h))));
  const columnMap = buildColumnMap(rawHeaders, sourceType);
  const mappedIdx = new Set(Object.keys(columnMap).map(Number));
  const unmappedHeaders = rawHeaders
    .map((h, i) => ({ h: String(h).trim(), i }))
    .filter(({ h, i }) => h && !mappedIdx.has(i) && !['no.', 'no', '#'].includes(h.toLowerCase()))
    .map(({ h }) => h);

  const records = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const values = (rows[r] || []).map(plainCellValue);
    const nonEmpty = values.filter(v => v !== null && v !== undefined && String(v).trim() !== '');
    if (nonEmpty.length === 0) continue; // blank line
    const first = String(values[0] ?? '').trim().toUpperCase();
    if (first === 'TOTAL' || first === 'GRAND TOTAL') continue;

    const mapped = { source_type: sourceType, validation_status: null };
    for (const [colIndex, field] of Object.entries(columnMap)) {
      const val = values[Number(colIndex)];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        mapped[field] = val instanceof Date || typeof val === 'number' ? val : String(val).trim();
      }
    }

    // Row must carry at least one case field (skips stray notes under the table)
    const hasCaseData = ['barangay_name', 'date_of_diagnosis', 'age', 'sex', 'last_name', 'full_name']
      .some(f => mapped[f] !== undefined && mapped[f] !== null);
    if (!hasCaseData) continue;

    // Keep original values in raw storage as JSON-safe values; dates -> YYYY-MM-DD
    for (const f of ['date_of_birth', 'date_of_screening', 'date_of_diagnosis', 'date_of_notification',
      'date_started_treatment', 'date_of_outcome', 'microscopy_release_date', 'rdt_release_date']) {
      if (mapped[f] instanceof Date) mapped[f] = parseDate(mapped[f]);
    }
    if (mapped.record_created_at !== undefined) {
      const d = parseDate(mapped.record_created_at);
      mapped.record_created_at = d ? new Date(d).toISOString() : null;
    }
    if (typeof mapped.age === 'number') mapped.age = Math.floor(mapped.age);

    mapped.row_number = r + 1; // 1-based, matches the spreadsheet row
    mapped.sheet_name = sheetName;
    records.push(mapped);
  }

  return {
    records,
    headerRow: headerIdx + 1,
    mappedColumns: Object.values(columnMap),
    unmappedHeaders,
  };
}

// ---------- CSV ----------

/**
 * RFC 4180 CSV parser: quoted fields, escaped quotes (""), commas/newlines inside quotes,
 * CRLF or LF line endings, UTF-8 BOM. Auto-detects ; or tab delimiters (Excel regional exports).
 */
function parseCsvText(text) {
  let s = String(text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

  const firstLine = s.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',';

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function decodeCsvBuffer(buffer) {
  const utf8 = buffer.toString('utf8');
  // Fall back to latin1 when the file is not valid UTF-8 (e.g. "Ñ" saved by old Excel)
  return utf8.includes('�') ? buffer.toString('latin1') : utf8;
}

function parseCsvFile(fileBuffer, filename) {
  const rows = parseCsvText(decodeCsvBuffer(fileBuffer));
  const headerIdx = findHeaderRow(rows);
  const headers = headerIdx >= 0 ? rows[headerIdx] : [];
  const sourceType = detectTypeFromHeaders(headers, filename);
  const sheetName = sourceType;
  const parsed = parseSheetRows(rows, sheetName, sourceType);

  const result = { filename, sheets: [], totalRecords: 0, dstbCount: 0, mnCount: 0, fileType: 'csv' };
  if (parsed.headerRow) {
    result.sheets.push({
      sheet_name: sheetName,
      source_type: sourceType,
      record_count: parsed.records.length,
      header_row: parsed.headerRow,
      unmapped_headers: parsed.unmappedHeaders,
      records: parsed.records,
    });
    result.totalRecords = parsed.records.length;
    if (sourceType === 'DSTB') result.dstbCount = parsed.records.length;
    else result.mnCount = parsed.records.length;
  }
  return result;
}

// ---------- Excel ----------

function worksheetToRows(sheet) {
  const rows = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber - 1] = cell.value;
    });
    rows[rowNumber - 1] = values;
  });
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

async function parseMultiSheetExcel(fileBuffer, filename) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const result = { filename, sheets: [], totalRecords: 0, dstbCount: 0, mnCount: 0, fileType: 'xlsx' };

  workbook.eachSheet((sheet) => {
    const sourceType = detectSheetType(sheet.name);
    if (!sourceType) return;

    const parsed = parseSheetRows(worksheetToRows(sheet), sheet.name, sourceType);
    if (!parsed.headerRow) return;

    result.sheets.push({
      sheet_name: sheet.name,
      source_type: sourceType,
      record_count: parsed.records.length,
      header_row: parsed.headerRow,
      unmapped_headers: parsed.unmappedHeaders,
      records: parsed.records,
    });
    result.totalRecords += parsed.records.length;
    if (sourceType === 'DSTB') result.dstbCount += parsed.records.length;
    else result.mnCount += parsed.records.length;
  });

  return result;
}

/**
 * Parse any supported registry file (.xlsx, .xls*, .csv) into the same structure.
 * (*) .xls is only readable when it is actually an .xlsx saved with the old extension;
 *     true legacy .xls files must be re-saved as .xlsx or .csv.
 */
async function parseRegistryFile(fileBuffer, filename) {
  const ext = String(filename).split('.').pop().toLowerCase();
  if (ext === 'csv' || ext === 'txt') return parseCsvFile(fileBuffer, filename);
  return parseMultiSheetExcel(fileBuffer, filename);
}

module.exports = {
  parseRegistryFile,
  parseMultiSheetExcel,
  parseCsvFile,
  parseCsvText,
  parseSheetRows,
  findHeaderRow,
  buildColumnMap,
  parseDate,
  normalizeSex,
  detectSheetType,
  detectTypeFromHeaders,
};
