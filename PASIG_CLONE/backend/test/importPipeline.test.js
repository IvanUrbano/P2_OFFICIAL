// Tests for the import pipeline: parse (Excel/CSV rows) -> clean -> validate -> webhook payload.
// Uses small made-up rows laid out like the real registry sheets. Run with: node --test test/
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseCsvText, parseCsvFile, parseSheetRows, findHeaderRow, buildColumnMap, detectTypeFromHeaders,
} = require('../services/multiSheetParser');
const {
  cleanRecord, cleanDate, cleanAge, cleanOutcome, matchBarangay, isBlankRecord, PASIG_BARANGAYS,
} = require('../services/dataCleaner');
const { validateRecord, getValidBarangays } = require('../services/validator');
const { formatRecord, isPasigRecord, toYmd } = require('../services/webhookSender');

// DSTB layout: title rows, then headers on row 6 starting with "#"
const DSTB_HEADERS = ['#', 'Validation Status', 'Date of Screening', 'Date of Diagnosis', 'Date of Notification',
  'Age', 'Sex', 'Brgy', 'City/Municipality', 'Screening/Diagnosing Health Facility', 'Treatment Health Facility',
  'Source of Patient', 'Anatomical Site', 'Registration Group', 'Bacteriologic Status', 'Date Started Tx',
  'Outcome/Status', 'Date of Outcome/Status'];

// MN layout: headers on row 1 starting with "No."
const MN_HEADERS = ['No.', 'Type', 'Date of Diagnosis', 'Date of Notification', 'ITIS Lite Case No.', 'Age', 'Sex',
  'Brgy', 'City/Municipality', 'Province', 'Region', 'Screening/Diagnosing Health Facility',
  'Treatment Health Facility', 'Referred to DOTS', 'Referral Status', 'Source of Patient', 'Anatomical Site',
  'Registration Group', 'Bacteriologic Status', 'Microscopy Result', 'Microscopy Release Date', 'RDT Result',
  'RDT Release Date', 'Date Started Tx', 'Outcome/Status', 'Date of Outcome/Status', 'Outcome Reason'];

function dstbSheet(dataRows) {
  return [
    ['PASIG CITY HEALTH DEPARTMENT'],
    ['TB-DOTS Program'],
    ['List of Drug-Susceptible TB Cases, 2025'],
    [],
    ['Generated from ITIS'],
    DSTB_HEADERS,
    ...dataRows,
  ];
}

describe('column mapping (real registry headers)', () => {
  it('maps every DSTB header', () => {
    const map = buildColumnMap(DSTB_HEADERS, 'DSTB');
    const fields = Object.values(map);
    for (const f of ['validation_status', 'date_of_screening', 'date_of_diagnosis', 'date_of_notification',
      'age', 'sex', 'barangay_name', 'city', 'screening_facility', 'treatment_facility', 'source_of_patient',
      'anatomical_site', 'registration_group', 'bacteriological_status', 'date_started_treatment',
      'outcome_status', 'date_of_outcome']) {
      assert.ok(fields.includes(f), `missing ${f}`);
    }
    assert.equal(map[0], undefined, '"#" column is skipped');
  });

  it('maps every MN header and keeps Outcome Reason separate from Outcome/Status', () => {
    const map = buildColumnMap(MN_HEADERS, 'MN');
    const byHeader = Object.fromEntries(Object.entries(map).map(([i, f]) => [MN_HEADERS[i], f]));
    assert.equal(byHeader['Outcome/Status'], 'outcome_status');
    assert.equal(byHeader['Outcome Reason'], 'outcome_reason');
    assert.equal(byHeader['Date Started Tx'], 'date_started_treatment');
    assert.equal(byHeader['Bacteriologic Status'], 'bacteriological_status');
    assert.equal(byHeader['ITIS Lite Case No.'], 'itis_case_id');
    assert.equal(byHeader['Microscopy Release Date'], 'microscopy_release_date');
    assert.equal(byHeader['RDT Result'], 'rdt_result');
    assert.equal(byHeader['Referred to DOTS'], 'referred_to_dots');
    assert.equal(byHeader['Referral Status'], 'referral_status');
    assert.equal(byHeader['Type'], 'type');
    assert.equal(Object.keys(map).length, MN_HEADERS.length - 1, 'all columns except No. are mapped');
  });
});

describe('header row detection', () => {
  it('finds DSTB headers on row 6 below title rows', () => {
    assert.equal(findHeaderRow(dstbSheet([])), 5);
  });

  it('does not mistake a long title mentioning age and sex for headers', () => {
    const rows = [['TB cases by age, sex and barangay with diagnosis outcome'], DSTB_HEADERS];
    assert.equal(findHeaderRow(rows), 1);
  });

  it('returns -1 when there is no header row', () => {
    assert.equal(findHeaderRow([['hello'], ['world']]), -1);
  });
});

describe('parseSheetRows', () => {
  it('reads DSTB rows, skips blank and TOTAL rows, keeps spreadsheet row numbers', () => {
    const rows = dstbSheet([
      [1, 'Validated', '2025-01-02', '2025-01-05', '2025-01-06', 34, 'M', 'Sto. Tomas', 'Pasig City',
        'Santo Tomas HC', 'Santo Tomas HC', 'Public', 'Pulmonary', 'New', 'Bacteriologically-confirmed',
        '2025-01-07', 'Cured', '2025-07-07'],
      [],
      ['', '', '', '', '', '', '', '', ''],
      [2, 'Not validated', '', '1/15/2025', '', '51 yrs', 'female', 'BRGY. SAN JOSE', 'PASIG CITY'],
      ['TOTAL', '', '', '', '', '', '', '', ''],
    ]);
    const { records, headerRow } = parseSheetRows(rows, 'DSTB', 'DSTB');
    assert.equal(headerRow, 6);
    assert.equal(records.length, 2);
    assert.equal(records[0].row_number, 7);
    assert.equal(records[0].barangay_name, 'Sto. Tomas');
    assert.equal(records[0].date_started_treatment, '2025-01-07');
    assert.equal(records[0].bacteriological_status, 'Bacteriologically-confirmed');
    assert.equal(records[1].row_number, 10);
  });

  it('converts Excel Date cells to YYYY-MM-DD', () => {
    const rows = dstbSheet([[1, 'Validated', null, new Date(Date.UTC(2025, 2, 9)), null, 40, 'F', 'Ugong', 'Pasig']]);
    const { records } = parseSheetRows(rows, 'DSTB', 'DSTB');
    assert.equal(records[0].date_of_diagnosis, '2025-03-09');
  });
});

describe('CSV parsing', () => {
  it('handles quotes, commas inside quotes, CRLF and BOM', () => {
    const text = '﻿A,B,C\r\n"x, y","say ""hi""",3\r\n';
    assert.deepEqual(parseCsvText(text), [['A', 'B', 'C'], ['x, y', 'say "hi"', '3']]);
  });

  it('auto-detects semicolon-delimited files', () => {
    assert.deepEqual(parseCsvText('a;b\n1;2\n'), [['a', 'b'], ['1', '2']]);
  });

  it('detects MN from headers and DSTB otherwise', () => {
    assert.equal(detectTypeFromHeaders(MN_HEADERS, 'export.csv'), 'MN');
    assert.equal(detectTypeFromHeaders(DSTB_HEADERS, 'export.csv'), 'DSTB');
    assert.equal(detectTypeFromHeaders(DSTB_HEADERS, 'MN.csv'), 'MN', 'file name wins when it says MN');
  });

  it('parses a CSV export of the MN sheet end to end', () => {
    const line = (cells) => cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',');
    const csv = [
      line(MN_HEADERS),
      line([1, 'MN', '01/20/2025', '01/21/2025', 'ITIS-0001', 29, 'Male', 'San Nicolas (Pob.)', 'City of Pasig',
        'Metro Manila', 'NCR', 'San Nicolas HC', 'San Nicolas HC', 'Yes', 'Enrolled', 'Public', 'Pulmonary',
        'New', 'Clinically-diagnosed', 'Negative', '01/19/2025', 'MTB not detected', '01/19/2025',
        '01/22/2025', 'On treatment', '', 'n/a']),
    ].join('\n');
    const parsed = parseCsvFile(Buffer.from(csv), 'registry.csv');
    assert.equal(parsed.mnCount, 1);
    assert.equal(parsed.dstbCount, 0);
    const r = parsed.sheets[0].records[0];
    assert.equal(r.itis_case_id, 'ITIS-0001');
    assert.equal(r.outcome_status, 'On treatment');
    assert.equal(r.outcome_reason, 'n/a');
  });
});

describe('cleaning', () => {
  it('standardizes barangay spellings to the official names', () => {
    const cases = {
      'Sto. Tomas': 'Santo Tomas',
      'STA. LUCIA': 'Santa Lucia',
      'Sta Rosa': 'Santa Rosa',
      'BRGY. SAN JOSE': 'San Jose',
      'Barangay Kapitolyo': 'Kapitolyo',
      'San Nicolas (Pob.)': 'San Nicolas',
      'De La Paz': 'Dela Paz',
      'Pinagbuhatn': 'Pinagbuhatan', // one-letter typo
      'bagong katipunan': 'Bagong Katipunan',
      '  Santolan  ': 'Santolan',
    };
    for (const [raw, expected] of Object.entries(cases)) {
      const m = matchBarangay(raw);
      assert.equal(m.matched, true, raw);
      assert.equal(m.name, expected, raw);
    }
  });

  it('does not force non-Pasig barangays onto a Pasig name', () => {
    for (const raw of ['San Isidro', 'San Roque', 'Dalig', 'Concepcion Uno']) {
      assert.equal(matchBarangay(raw).matched, false, raw);
    }
  });

  it('covers all 30 official barangays', () => {
    assert.equal(PASIG_BARANGAYS.length, 30);
    for (const n of PASIG_BARANGAYS) assert.equal(matchBarangay(n.toUpperCase()).name, n);
  });

  it('parses the date formats seen in registries', () => {
    assert.equal(cleanDate('2025-01-05'), '2025-01-05');
    assert.equal(cleanDate('1/5/2025'), '2025-01-05');
    assert.equal(cleanDate('07-Jan-25'), '2025-01-07');
    assert.equal(cleanDate('January 5, 2025'), '2025-01-05');
    assert.equal(cleanDate('5 Jan 2025'), '2025-01-05');
    assert.equal(cleanDate(45662), '2025-01-05'); // Excel serial number
    assert.equal(cleanDate(new Date(Date.UTC(2025, 0, 5))), '2025-01-05');
    assert.equal(cleanDate('2025-02-30'), null);
    assert.equal(cleanDate('N/A'), null);
  });

  it('cleans ages and outcomes', () => {
    assert.equal(cleanAge('45 yrs'), 45);
    assert.equal(cleanAge(33), 33);
    assert.equal(cleanAge('8 mos'), 0);
    assert.equal(cleanAge('abc'), 'abc'); // left for validation to reject
    assert.equal(cleanOutcome('Lost to follow up'), 'LOST TO FF-UP');
    assert.equal(cleanOutcome('tx completed'), 'TREATMENT COMPLETED');
    assert.equal(cleanOutcome('cured'), 'CURED');
    assert.equal(cleanOutcome('-'), null);
  });

  it('cleans a full record and reports what changed', () => {
    const { record, notes, isPasig } = cleanRecord({
      barangay_name: 'Sto. Tomas', city: 'PASIG CITY', sex: 'm', age: '34',
      date_of_diagnosis: '1/5/2025', date_started_treatment: '1/3/2025',
      outcome_status: 'on treatment', microscopy_release_date: 'pending', screening_facility: '  Santo  Tomas HC ',
    });
    assert.equal(record.barangay_name, 'Santo Tomas');
    assert.equal(record.city, 'Pasig City');
    assert.equal(record.sex, 'Male');
    assert.equal(record.age, 34);
    assert.equal(record.date_of_diagnosis, '2025-01-05');
    assert.equal(record.outcome_status, 'ON TREATMENT');
    assert.equal(record.microscopy_release_date, null);
    assert.equal(record.screening_facility, 'Santo Tomas HC');
    assert.equal(isPasig, true);
    assert.ok(notes.some(n => n.includes('standardized')));
    assert.ok(notes.some(n => n.includes('before diagnosis')));
    assert.ok(notes.some(n => n.includes('microscopy release date')));
  });

  it('marks records from other cities as non-Pasig even if the barangay name matches', () => {
    const { isPasig } = cleanRecord({ barangay_name: 'San Jose', city: 'Antipolo City', sex: 'F', date_of_diagnosis: '2025-01-01' });
    assert.equal(isPasig, false);
  });

  it('detects blank rows', () => {
    assert.equal(isBlankRecord({ barangay_name: null, sex: ' ', age: null }), true);
    assert.equal(isBlankRecord({ barangay_name: 'Ugong' }), false);
  });
});

describe('clean + validate', () => {
  it('accepts a messy but valid Pasig record after cleaning', async () => {
    const valid = await getValidBarangays();
    const { record } = cleanRecord({ barangay_name: 'STA. CRUZ', city: 'pasig', sex: 'F', date_of_diagnosis: '07-Mar-25', age: '61' });
    const result = validateRecord(record, 'DSTB', valid);
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  });

  it('rejects a Pasig record with an unknown barangay', async () => {
    const valid = await getValidBarangays();
    const { record } = cleanRecord({ barangay_name: 'Nowhere', city: 'Pasig City', sex: 'M', date_of_diagnosis: '2025-01-01' });
    const result = validateRecord(record, 'DSTB', valid);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('Unknown barangay'));
  });
});

describe('webhook payload', () => {
  it('sends dates as plain YYYY-MM-DD without a timezone shift', () => {
    const localMidnight = new Date(2025, 0, 5); // what pg returns for DATE '2025-01-05'
    assert.equal(toYmd(localMidnight), '2025-01-05');
    const payload = formatRecord({ barangay_name: 'Ugong', date_of_diagnosis: localMidnight, microscopy_release_date: null });
    assert.equal(payload.date_of_diagnosis, '2025-01-05');
    assert.equal(payload.microscopy_release_date, null);
  });

  it('only sends Pasig records', () => {
    assert.equal(isPasigRecord({ barangay_name: 'Santo Tomas', city: 'Pasig City' }), true);
    assert.equal(isPasigRecord({ barangay_name: 'Bagong Katipunan', city: null }), true);
    assert.equal(isPasigRecord({ barangay_name: 'San Jose', city: 'Antipolo City' }), false);
    assert.equal(isPasigRecord({ barangay_name: 'San Isidro', city: 'Antipolo City' }), false);
  });
});
