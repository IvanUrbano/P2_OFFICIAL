const ExcelJS = require('exceljs');

const DSTB_COLUMNS = [
  'No.', 'Date Reported', 'Facility Name', 'Barangay', 'Case Classification',
  'Treatment Regimen', 'Patient Type', 'Date Treatment Started', 'Outcome',
  'Outcome Date', 'Sex', 'Age', 'Registration Date', 'Validation Status',
  'Smear Sample Date', 'Smear Result', 'GeneXpert Date', 'GeneXpert Result'
];

const MN_COLUMNS = [
  'ITIS Lite Case No.', 'ITIS Lite Case', 'No.', 'Type', 'Date Reported',
  'Facility Name', 'Barangay', 'Case Classification', 'Treatment Regimen',
  'Patient Type', 'Patient Name', 'Last Name', 'First Name', 'Middle Name',
  'Sex', 'Age', 'Age Group', 'Indigenous Group', 'Date Treatment Started',
  'Outcome', 'Outcome Date', 'Registration Date', 'Province', 'Region',
  'Referred to DOTS', 'Referral Status', 'Contact Name', 'Contact Relationship',
  'Microscopy Result', 'Microscopy Result Date', 'Microscopy Release Date',
  'RDT Result', 'RDT Result Date', 'RDT Release Date'
];

function normalizeHeader(header) {
  if (!header) return '';
  return String(header).trim().toLowerCase().replace(/\s+/g, '_');
}

function matchColumn(normalized, targets) {
  for (const t of targets) {
    if (normalized.includes(t) || normalized === t) return true;
  }
  return false;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  const str = String(value).trim();
  if (!str) return null;

  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

  const parts = str.split(/[\/\-\.]/);
  if (parts.length === 3) {
    const [m, day, y] = parts.map(Number);
    if (m && day && y) return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

function parseAge(value) {
  if (!value) return null;
  const n = parseInt(String(value).replace(/\D/g, ''), 10);
  return isNaN(n) ? null : n;
}

function normalizeSex(value) {
  if (!value) return null;
  const v = String(value).trim().toUpperCase();
  if (v === 'M' || v === 'MALE') return 'MALE';
  if (v === 'F' || v === 'FEMALE') return 'FEMALE';
  return v;
}

function normalizeValidationStatus(value) {
  if (!value) return 'pending';
  const v = String(value).trim().toUpperCase();
  if (v === 'VALIDATED' || v === 'VALID') return 'validated';
  if (v === 'UNVALIDATED' || v === 'UNVALID') return 'unvalidated';
  if (v === 'PENDING') return 'pending';
  return 'pending';
}

function mapDSTBRow(row) {
  const fields = {};
  const data = row;

  const dateReportedIdx = 1;
  const facilityIdx = 2;
  const barangayIdx = 3;
  const caseClassificationIdx = 4;
  const treatmentRegimenIdx = 5;
  const patientTypeIdx = 6;
  const dateTreatmentStartedIdx = 7;
  const outcomeIdx = 8;
  const outcomeDateIdx = 9;
  const sexIdx = 10;
  const ageIdx = 11;
  const registrationDateIdx = 12;
  const validationStatusIdx = 13;

  fields.patient_no = data[0] ? String(data[0]).trim() : null;
  fields.date_reported = parseDate(data[dateReportedIdx]);
  fields.facility_name = data[facilityIdx] ? String(data[facilityIdx]).trim() : null;
  fields.barangay = data[barangayIdx] ? String(data[barangayIdx]).trim() : null;
  fields.case_classification = data[caseClassificationIdx] ? String(data[caseClassificationIdx]).trim() : null;
  fields.treatment_regimen = data[treatmentRegimenIdx] ? String(data[treatmentRegimenIdx]).trim() : null;
  fields.patient_type = data[patientTypeIdx] ? String(data[patientTypeIdx]).trim() : null;
  fields.date_treatment_started = parseDate(data[dateTreatmentStartedIdx]);
  fields.outcome = data[outcomeIdx] ? String(data[outcomeIdx]).trim() : null;
  fields.outcome_date = parseDate(data[outcomeDateIdx]);
  fields.sex = normalizeSex(data[sexIdx]);
  fields.age = parseAge(data[ageIdx]);
  fields.registration_date = parseDate(data[registrationDateIdx]);
  fields.validation_status = normalizeValidationStatus(data[validationStatusIdx]);

  return fields;
}

function mapMNRow(row) {
  const fields = {};
  const data = row;

  fields.itis_case_id = data[0] ? String(data[0]).trim() : null;
  fields.patient_no = data[2] ? String(data[2]).trim() : null;
  fields.date_reported = parseDate(data[5]);
  fields.facility_name = data[6] ? String(data[6]).trim() : null;
  fields.barangay = data[7] ? String(data[7]).trim() : null;
  fields.case_classification = data[8] ? String(data[8]).trim() : null;
  fields.treatment_regimen = data[9] ? String(data[9]).trim() : null;
  fields.patient_type = data[10] ? String(data[10]).trim() : null;
  fields.last_name = data[12] ? String(data[12]).trim() : null;
  fields.first_name = data[13] ? String(data[13]).trim() : null;
  fields.middle_name = data[14] ? String(data[14]).trim() : null;
  fields.sex = normalizeSex(data[15]);
  fields.age = parseAge(data[16]);
  fields.age_group = data[17] ? String(data[17]).trim() : null;
  fields.indigenous_group = data[18] ? String(data[18]).trim() : null;
  fields.date_treatment_started = parseDate(data[19]);
  fields.outcome = data[20] ? String(data[20]).trim() : null;
  fields.outcome_date = parseDate(data[21]);
  fields.registration_date = parseDate(data[22]);
  fields.contact_name = data[27] ? String(data[27]).trim() : null;
  fields.contact_relationship = data[28] ? String(data[28]).trim() : null;
  fields.validation_status = 'validated';

  return fields;
}

function detectSheetType(sheetName) {
  const name = sheetName.toUpperCase();
  if (name.includes('DSTB') || name.includes('B-MODE')) return 'DSTB';
  if (name.includes('MN') || name.includes('M-N') || name.includes('CASE')) return 'MN';
  return null;
}

async function parseExcel(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const results = { DSTB: [], MN: [], errors: [] };

  workbook.eachSheet((sheet, sheetId) => {
    const sheetType = detectSheetType(sheet.name);
    if (!sheetType) {
      results.errors.push(`Skipping unknown sheet: "${sheet.name}"`);
      return;
    }

    let headerRow = null;
    let dataStartRow = 3;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        const firstCell = row.getCell(1).text;
        if (firstCell && firstCell.trim().toUpperCase().includes('CASE')) {
          return;
        }
      }
      if (rowNumber === 2) {
        const firstCell = row.getCell(1).text;
        if (firstCell && (firstCell.trim() === 'No.' || firstCell.trim() === 'ITIS Lite Case No.')) {
          headerRow = rowNumber;
          dataStartRow = rowNumber + 1;
        }
      }
    });

    if (!headerRow) {
      results.errors.push(`No header row found in sheet: "${sheet.name}"`);
      return;
    }

    const mapper = sheetType === 'DSTB' ? mapDSTBRow : mapMNRow;

    for (let r = dataStartRow; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const firstCell = row.getCell(1).text;
      if (!firstCell || firstCell.trim() === '' || firstCell.trim().toUpperCase() === 'TOTAL') {
        continue;
      }

      const values = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        values[colNumber - 1] = cell.text || cell.value;
      });

      const mapped = mapper(values);
      mapped._source_sheet = sheet.name;
      results[sheetType].push(mapped);
    }
  });

  return results;
}

function validateCase(row, dataset) {
  const errors = [];
  if (!row.patient_no) errors.push('Missing patient_no');
  if (!row.facility_name) errors.push('Missing facility_name');
  if (!row.date_reported) errors.push('Missing date_reported');
  return { valid: errors.length === 0, errors };
}

module.exports = {
  parseExcel,
  validateCase,
  detectSheetType,
  DSTB_COLUMNS,
  MN_COLUMNS,
};
