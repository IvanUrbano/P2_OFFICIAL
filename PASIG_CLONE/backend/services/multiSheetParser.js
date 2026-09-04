const ExcelJS = require('exceljs');

function normalizeHeader(header) {
  if (!header) return '';
  return String(header).trim().toLowerCase();
}

function buildColumnMap(rawHeaders, sourceType) {
  const map = {};

  for (let i = 0; i < rawHeaders.length; i++) {
    const header = String(rawHeaders[i] || '');
    const normalized = normalizeHeader(header);

    if (normalized === 'no.' || normalized === 'no') continue;

    if (normalized.includes('notification') && normalized.includes('date')) {
      map[i] = 'date_of_notification';
    } else if (normalized.includes('screening') && normalized.includes('date')) {
      map[i] = 'date_of_screening';
    } else if (normalized.includes('diagnosis') && normalized.includes('date')) {
      map[i] = 'date_of_diagnosis';
    } else if (normalized.includes('treatment') && normalized.includes('started')) {
      map[i] = 'date_started_treatment';
    } else if (normalized.includes('outcome') && normalized.includes('date')) {
      map[i] = 'date_of_outcome';
    } else if (normalized.includes('record') && normalized.includes('created')) {
      map[i] = 'record_created_at';
    } else if (normalized === 'age') {
      map[i] = 'age';
    } else if (normalized === 'sex') {
      map[i] = 'sex';
    } else if (normalized.includes('barangay') || normalized === 'brgy') {
      map[i] = 'barangay_name';
    } else if (normalized.includes('city') || normalized.includes('municipality')) {
      map[i] = 'city';
    } else if (normalized.includes('treatment') && (normalized.includes('health') || normalized.includes('facility'))) {
      map[i] = 'treatment_facility';
    } else if (normalized.includes('screening') && (normalized.includes('health') || normalized.includes('facility'))) {
      map[i] = 'screening_facility';
    } else if (normalized.includes('source') && normalized.includes('patient')) {
      map[i] = 'source_of_patient';
    } else if (normalized.includes('anatomical')) {
      map[i] = 'anatomical_site';
    } else if (normalized.includes('registration')) {
      map[i] = 'registration_group';
    } else if (normalized.includes('bacteriological')) {
      map[i] = 'bacteriological_status';
    } else if (normalized.includes('outcome') && !normalized.includes('date')) {
      map[i] = 'outcome_status';
    } else if (normalized.includes('validation') && sourceType === 'DSTB') {
      map[i] = 'validation_status';
    } else if ((normalized.includes('itis') || normalized.includes('lite')) && normalized.includes('case')) {
      map[i] = 'itis_case_id';
    }
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
  const name = sheetName.toUpperCase();
  if (name.includes('DSTB') || name.includes('B-MODE')) return 'DSTB';
  if (name.includes('MN') || name.includes('M-N') || name.includes('MICROSCOPIC')) return 'MN';
  return null;
}

async function parseMultiSheetExcel(fileBuffer, filename) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const result = {
    filename,
    sheets: [],
    totalRecords: 0,
    dstbCount: 0,
    mnCount: 0,
  };

  workbook.eachSheet((sheet) => {
    const sourceType = detectSheetType(sheet.name);
    if (!sourceType) return;

    let headerRowIndex = null;
    for (let r = 1; r <= Math.min(5, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      const firstCell = row.getCell(1).text;
      if (firstCell && (firstCell.trim() === 'No.' || firstCell.trim().toUpperCase().includes('ITIS'))) {
        headerRowIndex = r;
        break;
      }
    }

    if (!headerRowIndex) return;

    const headerRow = sheet.getRow(headerRowIndex);
    const rawHeaders = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      rawHeaders[colNumber - 1] = cell.text;
    });

    const columnMap = buildColumnMap(rawHeaders, sourceType);
    const records = [];

    for (let r = headerRowIndex + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const firstCell = row.getCell(1).text;
      if (!firstCell || firstCell.trim() === '' || firstCell.trim().toUpperCase() === 'TOTAL') continue;

      const values = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        values[colNumber - 1] = cell.value;
      });

      const mapped = {
        source_type: sourceType,
        validation_status: null,
        itis_case_id: null,
      };

      for (const [colIndex, field] of Object.entries(columnMap)) {
        const val = values[parseInt(colIndex)];
        if (val !== undefined && val !== null) {
          mapped[field] = val instanceof Date ? val : String(val).trim();
        }
      }

      mapped.date_of_screening = parseDate(mapped.date_of_screening);
      mapped.date_of_diagnosis = parseDate(mapped.date_of_diagnosis);
      mapped.date_of_notification = parseDate(mapped.date_of_notification);
      mapped.date_started_treatment = parseDate(mapped.date_started_treatment);
      mapped.date_of_outcome = parseDate(mapped.date_of_outcome);
      mapped.record_created_at = mapped.record_created_at
        ? new Date(mapped.record_created_at).toISOString()
        : null;

      mapped.age = mapped.age ? parseInt(mapped.age) : null;
      mapped.sex = normalizeSex(mapped.sex);
      mapped.row_number = r;
      mapped.sheet_name = sheet.name;

      records.push(mapped);
    }

    const sheetData = {
      sheet_name: sheet.name,
      source_type: sourceType,
      record_count: records.length,
      records,
    };

    result.sheets.push(sheetData);
    result.totalRecords += records.length;

    if (sourceType === 'DSTB') {
      result.dstbCount += records.length;
    } else {
      result.mnCount += records.length;
    }
  });

  return result;
}

module.exports = {
  parseMultiSheetExcel,
  buildColumnMap,
  parseDate,
  normalizeSex,
  detectSheetType,
};
