const ExcelJS = require('exceljs');
const path = require('path');

async function createTestFile() {
  const workbook = new ExcelJS.Workbook();

  const dstb = workbook.addWorksheet('DSTB');
  dstb.addRow(['', 'CASE FILE REGISTRY']);
  dstb.addRow(['No.', 'Date Reported', 'Facility Name', 'Barangay', 'Case Classification', 'Treatment Regimen', 'Patient Type', 'Date Treatment Started', 'Outcome', 'Outcome Date', 'Sex', 'Age', 'Registration Date', 'Validation Status']);
  dstb.addRow(['001', '01/15/2026', 'Pasig City Hospital', 'San Antonio', 'Pulmonary', 'Category I', 'New', '01/20/2026', 'Cured', '06/15/2026', 'M', '35', '01/15/2026', 'Validated']);
  dstb.addRow(['002', '01/18/2026', 'Pasig Health Center', 'Kapitolyo', 'Pulmonary', 'Category II', 'Relapse', '01/22/2026', 'Died', '03/10/2026', 'F', '52', '01/18/2026', 'Unvalidated']);
  dstb.addRow(['003', '02/01/2026', 'Pasig City Hospital', 'Santolan', 'Extrapulmonary', 'Category I', 'New', '02/05/2026', 'Treatment Completed', '08/01/2026', 'M', '28', '02/01/2026', 'Validated']);

  const mn = workbook.addWorksheet('MN');
  mn.addRow(['', 'M-N REGISTRY']);
  mn.addRow(['ITIS Lite Case No.', 'ITIS Lite Case', 'No.', 'Type', 'Date Reported', 'Facility Name', 'Barangay', 'Case Classification', 'Treatment Regimen', 'Patient Type', 'Patient Name', 'Last Name', 'First Name', 'Middle Name', 'Sex', 'Age', 'Age Group', 'Indigenous Group', 'Date Treatment Started', 'Outcome', 'Outcome Date', 'Registration Date', 'Province', 'Region', 'Referred to DOTS', 'Referral Status', 'Contact Name', 'Contact Relationship']);
  mn.addRow(['ITIS-2026-001', 'Case 001', '001', 'TB', '01/15/2026', 'Pasig City Hospital', 'San Antonio', 'Pulmonary', 'Category I', 'New', 'Juan Dela Cruz', 'Dela Cruz', 'Juan', 'Santos', 'M', '35', '35-44', 'None', '01/20/2026', 'Cured', '06/15/2026', '01/15/2026', 'Metro Manila', 'NCR', 'Yes', 'Referred', 'Maria Dela Cruz', 'Spouse']);
  mn.addRow(['ITIS-2026-002', 'Case 002', '002', 'TB', '01/18/2026', 'Pasig Health Center', 'Kapitolyo', 'Pulmonary', 'Category II', 'Relapse', 'Ana Santos', 'Santos', 'Ana', 'Reyes', 'F', '52', '45-54', 'None', '01/22/2026', 'Died', '03/10/2026', '01/18/2026', 'Metro Manila', 'NCR', 'No', 'N/A', 'Pedro Santos', 'Son']);
  mn.addRow(['ITIS-2026-003', 'Case 003', '003', 'TB', '02/01/2026', 'Pasig City Hospital', 'Santolan', 'Extrapulmonary', 'Category I', 'New', 'Jose Reyes', 'Reyes', 'Jose', 'Cruz', 'M', '28', '25-34', 'None', '02/05/2026', 'Treatment Completed', '08/01/2026', '02/01/2026', 'Metro Manila', 'NCR', 'Yes', 'Completed', 'Lisa Reyes', 'Sister']);

  const filePath = path.join(__dirname, 'test_cases.xlsx');
  await workbook.xlsx.writeFile(filePath);
  console.log('Test file created:', filePath);
}

createTestFile();
