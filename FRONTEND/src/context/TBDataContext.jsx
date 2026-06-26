import { createContext, useContext, useState, useMemo, useCallback } from 'react';

const TBDataContext = createContext(null);

// ===== CONSTANTS =====

// Barangay configuration with base monthly rates and trends
const BARANGAY_CONFIG = {
  // High burden (5)
  'San Joaquin':    { tier: 'high',      baseRate: 3.2, trend: 'increasing' },
  'Pinagbuhatan':   { tier: 'high',      baseRate: 3.0, trend: 'stable' },
  'Rosario':        { tier: 'high',      baseRate: 2.8, trend: 'increasing' },
  'Dela Paz':       { tier: 'high',      baseRate: 2.6, trend: 'decreasing' },
  'Manggahan':      { tier: 'high',      baseRate: 2.4, trend: 'stable' },
  // Moderate burden (10)
  'Maybunga':       { tier: 'moderate',  baseRate: 1.8, trend: 'increasing' },
  'Caniogan':       { tier: 'moderate',  baseRate: 1.6, trend: 'stable' },
  'Kapasigan':      { tier: 'moderate',  baseRate: 1.5, trend: 'decreasing' },
  'Bambang':        { tier: 'moderate',  baseRate: 1.4, trend: 'stable' },
  'Bagong Katipunan': { tier: 'moderate', baseRate: 1.3, trend: 'increasing' },
  'Bagong Ilog':    { tier: 'moderate',  baseRate: 1.2, trend: 'stable' },
  'Kalawaan':       { tier: 'moderate',  baseRate: 1.1, trend: 'decreasing' },
  'Malinao':        { tier: 'moderate',  baseRate: 1.0, trend: 'stable' },
  'Santa Cruz':     { tier: 'moderate',  baseRate: 0.9, trend: 'stable' },
  'San Antonio':    { tier: 'moderate',  baseRate: 0.8, trend: 'decreasing' },
  // Low burden (15)
  'Kapitolyo':      { tier: 'low',       baseRate: 0.7, trend: 'stable' },
  'Palatiw':        { tier: 'low',       baseRate: 0.6, trend: 'decreasing' },
  'San Jose':       { tier: 'low',       baseRate: 0.6, trend: 'stable' },
  'Santo Tomas':    { tier: 'low',       baseRate: 0.5, trend: 'stable' },
  'Santa Lucia':    { tier: 'low',       baseRate: 0.5, trend: 'decreasing' },
  'Buting':         { tier: 'low',       baseRate: 0.5, trend: 'stable' },
  'Santolan':       { tier: 'low',       baseRate: 0.5, trend: 'increasing' },
  'Santa Rosa':     { tier: 'low',       baseRate: 0.4, trend: 'stable' },
  'San Miguel':     { tier: 'low',       baseRate: 0.4, trend: 'decreasing' },
  'Oranbo':         { tier: 'low',       baseRate: 0.4, trend: 'stable' },
  'Pineda':         { tier: 'low',       baseRate: 0.4, trend: 'stable' },
  'San Nicolas':    { tier: 'low',       baseRate: 0.3, trend: 'decreasing' },
  'Sumilang':       { tier: 'low',       baseRate: 0.3, trend: 'stable' },
  'Sagad':          { tier: 'low',       baseRate: 0.3, trend: 'stable' },
  'Ugong':          { tier: 'low',       baseRate: 0.3, trend: 'decreasing' },
};

const BARANGAYS = Object.keys(BARANGAY_CONFIG).map((name) => ({
  name,
  weight: BARANGAY_CONFIG[name].tier,
}));

const BARANGAY_COORDS = {
  'San Joaquin': { lat: 14.5582, lng: 121.0825 },
  'Pinagbuhatan': { lat: 14.5536, lng: 121.0789 },
  'Rosario': { lat: 14.5618, lng: 121.0756 },
  'Dela Paz': { lat: 14.5645, lng: 121.0812 },
  'Manggahan': { lat: 14.5598, lng: 121.0867 },
  'Maybunga': { lat: 14.5672, lng: 121.0734 },
  'Caniogan': { lat: 14.5615, lng: 121.0698 },
  'Kapasigan': { lat: 14.5578, lng: 121.0712 },
  'Bambang': { lat: 14.5701, lng: 121.0768 },
  'Bagong Katipunan': { lat: 14.5725, lng: 121.0745 },
  'Bagong Ilog': { lat: 14.5689, lng: 121.0782 },
  'Kalawaan': { lat: 14.5654, lng: 121.0721 },
  'Malinao': { lat: 14.5632, lng: 121.0705 },
  'Santa Cruz': { lat: 14.5591, lng: 121.0678 },
  'San Antonio': { lat: 14.5558, lng: 121.0734 },
  'Kapitolyo': { lat: 14.5612, lng: 121.0598 },
  'Palatiw': { lat: 14.5587, lng: 121.0612 },
  'San Jose': { lat: 14.5542, lng: 121.0634 },
  'Santo Tomas': { lat: 14.5568, lng: 121.0601 },
  'Santa Lucia': { lat: 14.5523, lng: 121.0645 },
  'Buting': { lat: 14.5498, lng: 121.0623 },
  'Santolan': { lat: 14.5678, lng: 121.0634 },
  'Santa Rosa': { lat: 14.5645, lng: 121.0612 },
  'San Miguel': { lat: 14.5601, lng: 121.0656 },
  'Oranbo': { lat: 14.5578, lng: 121.0589 },
  'Pineda': { lat: 14.5534, lng: 121.0578 },
  'San Nicolas': { lat: 14.5512, lng: 121.0601 },
  'Sumilang': { lat: 14.5489, lng: 121.0589 },
  'Sagad': { lat: 14.5545, lng: 121.0556 },
  'Ugong': { lat: 14.5521, lng: 121.0534 },
};

// Facility assignments
const FACILITIES = {
  'Bagong Ilog':      ['Bagong Ilog HC', 'Bagong Ilog PC'],
  'Kalawaan':         ['Kalawaan HC', 'Ismar HC'],
  'Manggahan':        ['Manggahan HC', 'Napico HC', 'Karangalan HC'],
  'Santolan':         ['Santolan HC', 'Dona Betang HC'],
  'Maybunga':         ['Maybunga ITC', 'Maybunga Floodway'],
  'Pinagbuhatan':     ['Pinagbuhatan HC', 'Pinagbuhatan Puericulture Center', 'E. Santos HC', 'Nagpayong HC'],
  'San Joaquin':      ['San Joaquin HC', 'San Joaquin Sentro'],
  'Rosario':          ['Rosario HC', 'Rosario Super Health Center'],
  'Dela Paz':         ['Dela Paz HC', 'Dela Paz Sentro'],
  'Bambang':          ['Bambang HC'],
  'Bagong Katipunan': ['Bagong Katipunan HC'],
  'Caniogan':         ['Caniogan HC'],
  'Kapasigan':        ['Kapasigan HC'],
  'Malinao':          ['Malinao HC'],
  'Santa Cruz':       ['Santa Cruz HC'],
  'San Antonio':      ['San Antonio HC'],
  'Kapitolyo':        ['Kapitolyo HC'],
  'Palatiw':          ['Palatiw HC'],
  'San Jose':         ['San Jose HC'],
  'Santo Tomas':      ['Santo Tomas HC'],
  'Santa Lucia':      ['Santa Lucia HC'],
  'Buting':           ['Buting HC'],
  'Santa Rosa':       ['Santa Rosa HC'],
  'San Miguel':       ['San Miguel HC'],
  'Oranbo':           ['Oranbo HC'],
  'Pineda':           ['Pineda HC'],
  'San Nicolas':      ['San Nicolas HC'],
  'Sumilang':         ['Sumilang HC'],
  'Sagad':            ['Sagad HC'],
  'Ugong':            ['Ugong HC'],
};

const STATUSES = ['Cured', 'Completed', 'Active', 'Treatment', 'Defaulted', 'Failed', 'Died', 'Not Evaluated'];
const STATUS_WEIGHTS = [0.25, 0.22, 0.14, 0.12, 0.12, 0.08, 0.04, 0.03];
const SEX_OPTIONS = ['Male', 'Female'];
const SEX_WEIGHTS = [0.60, 0.40];
const SOURCE_OPTIONS = ['Walk-in', 'Referral', 'Contact Tracing', 'Screening'];
const SOURCE_WEIGHTS = [0.35, 0.30, 0.20, 0.15];
const ANATOMICAL_SITES = ['Pulmonary', 'Extra-pulmonary'];
const ANATOMICAL_WEIGHTS = [0.82, 0.18];
const REGISTRATION_GROUPS = ['New', 'Relapse', 'Treatment After Failure', 'Return After Default'];
const REGISTRATION_WEIGHTS = [0.60, 0.20, 0.10, 0.10];
const BACTERIOLOGICAL_STATUS = ['Confirmed', 'Clinically Diagnosed', 'Smear Negative'];
const BACTERIOLOGICAL_WEIGHTS = [0.45, 0.35, 0.20];
const VALIDATION_STATUSES = ['Validated', 'Pending'];
const VALIDATION_WEIGHTS = [0.75, 0.25];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YEARS = [2023, 2024, 2025];

// ===== HEALTHCARE DATE VALIDATION HELPERS =====

/** Parse a YYYY-MM-DD string into a Date object (midnight local). Returns null if invalid. */
function parseDate(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

/** Get today's date as YYYY-MM-DD string (local timezone). */
function todayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Healthcare-standard validation for imported records.
 * Enforces: Screening Date ≤ Diagnosis Date ≤ Treatment Start Date
 * All dates must be valid, not in the future, and not before 2020.
 * Returns { valid: boolean, errors: string[] }.
 */
function validateImportedRecord(rec) {
  const errors = [];
  const today = todayStr();
  const VALID_STATUSES = ['Cured', 'Completed', 'Active', 'Treatment', 'Defaulted', 'Failed', 'Died', 'Not Evaluated'];

  // Required: record ID
  if (!rec.id) errors.push('Missing record ID');

  // Required: Barangay
  if (!rec.barangay || typeof rec.barangay !== 'string' || rec.barangay.trim() === '') {
    errors.push('Barangay is required');
  }

  // Required: Age
  if (rec.age === undefined || rec.age === null || rec.age === '') {
    errors.push('Age is required');
  } else {
    const age = Number(rec.age);
    if (isNaN(age) || !Number.isInteger(age) || age < 0 || age > 120) {
      errors.push('Age must be an integer between 0 and 120');
    }
  }

  // Required: Sex
  if (!rec.sex || !['Male', 'Female'].includes(rec.sex)) {
    errors.push('Sex must be Male or Female');
  }

  // Required: Status
  if (!rec.status || !VALID_STATUSES.includes(rec.status)) {
    errors.push(`Invalid treatment outcome: "${rec.status}"`);
  }

  // ── Date validations — healthcare standard ──
  const dateFields = [
    { key: 'diagnosisDate', label: 'Diagnosis date' },
    { key: 'screeningDate', label: 'Screening date' },
    { key: 'treatmentStartDate', label: 'Treatment start date' },
  ];

  for (const { key, label } of dateFields) {
    const val = rec[key];
    if (!val || (typeof val === 'string' && val.trim() === '')) {
      errors.push(`${label} is required`);
    } else {
      const d = parseDate(val);
      if (!d) {
        errors.push(`${label} is not a valid date (received: "${val}")`);
      } else if (val > today) {
        errors.push(`${label} cannot be in the future (received: "${val}")`);
      } else if (val < '2020-01-01') {
        errors.push(`${label} cannot be before 2020-01-01`);
      }
    }
  }

  // ── Date sequencing ──
  if (rec.screeningDate && rec.diagnosisDate && parseDate(rec.screeningDate) && parseDate(rec.diagnosisDate)) {
    if (rec.screeningDate > rec.diagnosisDate) {
      errors.push('Screening date must be on or before diagnosis date');
    }
  }
  if (rec.diagnosisDate && rec.treatmentStartDate && parseDate(rec.diagnosisDate) && parseDate(rec.treatmentStartDate)) {
    if (rec.treatmentStartDate < rec.diagnosisDate) {
      errors.push('Treatment start date cannot be before diagnosis date');
    }
    // Healthcare: treatment should start within 60 days of diagnosis
    const diag = parseDate(rec.diagnosisDate);
    const treat = parseDate(rec.treatmentStartDate);
    if (diag && treat) {
      const diffDays = Math.round((treat - diag) / (1000 * 60 * 60 * 24));
      if (diffDays > 60) {
        errors.push(`Treatment should start within 60 days of diagnosis (${diffDays} days exceeded)`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ===== SEEDED RANDOM FUNCTION =====
function seededRandom(seed) {
  let x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

function pickWeighted(arr, weights, seed) {
  const r = seededRandom(seed);
  let cumulative = 0;
  for (let i = 0; i < arr.length; i++) {
    cumulative += weights[i];
    if (r <= cumulative) return arr[i];
  }
  return arr[arr.length - 1];
}

function pickFrom(arr, seed) {
  return arr[Math.floor(seededRandom(seed) * arr.length)];
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Generate realistic age: mostly 20-60, with small numbers of children and elderly
function randomAge(seed) {
  const r = seededRandom(seed);
  // 5% children (0-14), 65% adults (20-59), 20% middle-aged (40-60), 10% elderly (60-90)
  if (r < 0.05) return Math.floor(seededRandom(seed + 100) * 15);           // 0-14
  if (r < 0.70) return Math.floor(seededRandom(seed + 200) * 40) + 20;      // 20-59
  if (r < 0.90) return Math.floor(seededRandom(seed + 300) * 21) + 40;      // 40-60
  return Math.floor(seededRandom(seed + 400) * 31) + 60;                     // 60-90
}

// ===== GENERATE INITIAL RECORDS =====
function generateInitialRecords() {
  const records = [];
  let idCounter = 0;

  const barangayNames = Object.keys(BARANGAY_CONFIG);

  // For each barangay, generate cases for each month (Jan 2023 - Dec 2025 = 36 months)
  barangayNames.forEach((barangayName, bIdx) => {
    const config = BARANGAY_CONFIG[barangayName];
    const facilities = FACILITIES[barangayName] || [`${barangayName} HC`];

    for (let monthIdx = 0; monthIdx < 36; monthIdx++) {
      const year = 2023 + Math.floor(monthIdx / 12);
      const month = monthIdx % 12; // 0 = Jan, 11 = Dec

      // Seasonal multiplier: higher in dry season (Jan-May: 1.05-1.15), lower in wet (Jun-Sep: 0.88-0.95)
      let seasonalMultiplier;
      if (month <= 4) {
        // Jan-May (dry season)
        seasonalMultiplier = 1.05 + seededRandom(bIdx * 1000 + monthIdx * 7) * 0.10;
      } else if (month <= 8) {
        // Jun-Sep (wet season)
        seasonalMultiplier = 0.88 + seededRandom(bIdx * 1000 + monthIdx * 11) * 0.07;
      } else {
        // Oct-Dec (transitional)
        seasonalMultiplier = 0.97 + seededRandom(bIdx * 1000 + monthIdx * 13) * 0.08;
      }

      // Trend multiplier: progresses over the 36 months
      const trendProgress = monthIdx / 35; // 0 to 1 over the full period
      let trendMultiplier;
      if (config.trend === 'increasing') {
        trendMultiplier = 0.75 + trendProgress * 0.60; // 0.75 → 1.35
      } else if (config.trend === 'decreasing') {
        trendMultiplier = 1.25 - trendProgress * 0.55; // 1.25 → 0.70
      } else {
        // stable with slight variation
        trendMultiplier = 0.95 + seededRandom(bIdx * 500 + monthIdx * 3) * 0.10;
      }

      // Noise factor: 0.7 to 1.3
      const noise = 0.7 + seededRandom(bIdx * 2000 + monthIdx * 17) * 0.6;

      // Expected count
      const expected = config.baseRate * seasonalMultiplier * trendMultiplier * noise;
      const count = Math.max(0, Math.round(expected));

      // Generate individual records for this month
      for (let c = 0; c < count; c++) {
        idCounter++;
        const recordSeed = bIdx * 100000 + monthIdx * 1000 + c * 7 + 42;

        // Diagnosis date within the month
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const dayOfMonth = Math.floor(seededRandom(recordSeed + 1) * daysInMonth) + 1;
        const diagnosisDate = new Date(year, month, dayOfMonth);

        // Screening date: 1-10 days before diagnosis
        const screeningOffset = Math.floor(seededRandom(recordSeed + 2) * 10) + 1;
        const screeningDate = new Date(diagnosisDate);
        screeningDate.setDate(screeningDate.getDate() - screeningOffset);

        // Notification date: 0-2 days after diagnosis
        const notificationOffset = Math.floor(seededRandom(recordSeed + 3) * 3);
        const notificationDate = new Date(diagnosisDate);
        notificationDate.setDate(notificationDate.getDate() + notificationOffset);

        // Treatment start date: 1-14 days after diagnosis
        const treatmentOffset = Math.floor(seededRandom(recordSeed + 4) * 14) + 1;
        const treatmentStartDate = new Date(diagnosisDate);
        treatmentStartDate.setDate(treatmentStartDate.getDate() + treatmentOffset);

        // Status
        const status = pickWeighted(STATUSES, STATUS_WEIGHTS, recordSeed + 5);
        const hasOutcome = ['Cured', 'Completed', 'Defaulted', 'Failed', 'Died'].includes(status);

        // Outcome date: 30-240 days after treatment start for completed outcomes
        let outcomeDate = null;
        if (hasOutcome) {
          const outcomeOffset = 30 + Math.floor(seededRandom(recordSeed + 6) * 210);
          outcomeDate = new Date(treatmentStartDate);
          outcomeDate.setDate(outcomeDate.getDate() + outcomeOffset);
          // Don't let outcome date go past Dec 2025
          if (outcomeDate > new Date(2025, 11, 31)) {
            outcomeDate = new Date(2025, 11, 31);
          }
        }

        // Facility selection
        const facility = pickFrom(facilities, recordSeed + 7);
        const treatmentFacility = seededRandom(recordSeed + 8) > 0.2
          ? facility
          : pickFrom(facilities, recordSeed + 9);

        // Create the record
        const id = `TB-${year}-${String(idCounter).padStart(4, '0')}`;
        records.push({
          id,
          barangay: barangayName,
          age: randomAge(recordSeed + 10),
          sex: pickWeighted(SEX_OPTIONS, SEX_WEIGHTS, recordSeed + 11),
          diagnosisDate: formatDate(diagnosisDate),
          facility,
          status,
          validationStatus: pickWeighted(VALIDATION_STATUSES, VALIDATION_WEIGHTS, recordSeed + 12),
          screeningDate: formatDate(screeningDate),
          notificationDate: formatDate(notificationDate),
          city: 'Pasig City',
          treatmentFacility,
          sourcePatient: pickWeighted(SOURCE_OPTIONS, SOURCE_WEIGHTS, recordSeed + 13),
          anatomicalSite: pickWeighted(ANATOMICAL_SITES, ANATOMICAL_WEIGHTS, recordSeed + 14),
          registrationGroup: pickWeighted(REGISTRATION_GROUPS, REGISTRATION_WEIGHTS, recordSeed + 15),
          bacteriologicalStatus: pickWeighted(BACTERIOLOGICAL_STATUS, BACTERIOLOGICAL_WEIGHTS, recordSeed + 16),
          treatmentStartDate: formatDate(treatmentStartDate),
          outcomeDate: outcomeDate ? formatDate(outcomeDate) : '-',
          createdAt: new Date(year, month, dayOfMonth, 8 + Math.floor(seededRandom(recordSeed + 17) * 10), Math.floor(seededRandom(recordSeed + 18) * 60)).toISOString(),
        });
      }
    }
  });

  // Sort records by diagnosis date
  records.sort((a, b) => a.diagnosisDate.localeCompare(b.diagnosisDate));

  // Re-assign IDs in chronological order
  records.forEach((r, idx) => {
    const year = r.diagnosisDate.slice(0, 4);
    r.id = `TB-${year}-${String(idx + 1).padStart(4, '0')}`;
  });

  return records;
}

// ===== CONTEXT PROVIDER =====
export function TBDataProvider({ children }) {
  const [records, setRecords] = useState(() => generateInitialRecords());

  // ── Import/Verification State ──
  const [importedRecords, setImportedRecords] = useState(() => {
    try {
      const stored = localStorage.getItem('tbinsight_imported_records');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const [syncLogs, setSyncLogs] = useState(() => {
    try {
      const stored = localStorage.getItem('tbinsight_sync_logs');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  // Persist imported records and sync logs
  const updateImportedRecords = useCallback((updater) => {
    setImportedRecords(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('tbinsight_imported_records', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const updateSyncLogs = useCallback((updater) => {
    setSyncLogs(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('tbinsight_sync_logs', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // CRUD Operations
  const addRecord = useCallback((record) => {
    setRecords((prev) => [...prev, record]);
  }, []);

  const addTestRecord = useCallback(() => {
    setRecords((prev) => {
      const idx = prev.length + 1;
      const seed = idx * 137 + 503;
      const barangayName = pickFrom(Object.keys(BARANGAY_CONFIG), seed);
      const config = BARANGAY_CONFIG[barangayName];
      const facilities = FACILITIES[barangayName] || [`${barangayName} HC`];

      // Random month in the range
      const year = 2023 + Math.floor(seededRandom(seed + 100) * 4);
      const month = Math.floor(seededRandom(seed + 200) * 12);
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const dayOfMonth = Math.floor(seededRandom(seed + 300) * daysInMonth) + 1;
      const diagnosisDate = new Date(year, month, dayOfMonth);

      const screeningOffset = Math.floor(seededRandom(seed + 400) * 10) + 1;
      const screeningDate = new Date(diagnosisDate);
      screeningDate.setDate(screeningDate.getDate() - screeningOffset);

      const notificationOffset = Math.floor(seededRandom(seed + 500) * 3);
      const notificationDate = new Date(diagnosisDate);
      notificationDate.setDate(notificationDate.getDate() + notificationOffset);

      const treatmentOffset = Math.floor(seededRandom(seed + 600) * 14) + 1;
      const treatmentStartDate = new Date(diagnosisDate);
      treatmentStartDate.setDate(treatmentStartDate.getDate() + treatmentOffset);

      const status = pickWeighted(STATUSES, STATUS_WEIGHTS, seed + 700);
      const hasOutcome = ['Cured', 'Completed', 'Defaulted', 'Failed', 'Died'].includes(status);
      let outcomeDate = null;
      if (hasOutcome) {
        const outcomeOffset = 30 + Math.floor(seededRandom(seed + 800) * 210);
        outcomeDate = new Date(treatmentStartDate);
        outcomeDate.setDate(outcomeDate.getDate() + outcomeOffset);
      }

      const facility = pickFrom(facilities, seed + 900);
      const treatmentFacility = seededRandom(seed + 1000) > 0.2
        ? facility
        : pickFrom(facilities, seed + 1100);

      const record = {
        id: `TB-${year}-${String(idx).padStart(4, '0')}`,
        barangay: barangayName,
        age: randomAge(seed + 1200),
        sex: pickWeighted(SEX_OPTIONS, SEX_WEIGHTS, seed + 1300),
        diagnosisDate: formatDate(diagnosisDate),
        facility,
        status,
        validationStatus: pickWeighted(VALIDATION_STATUSES, VALIDATION_WEIGHTS, seed + 1400),
        screeningDate: formatDate(screeningDate),
        notificationDate: formatDate(notificationDate),
        city: 'Pasig City',
        treatmentFacility,
        sourcePatient: pickWeighted(SOURCE_OPTIONS, SOURCE_WEIGHTS, seed + 1500),
        anatomicalSite: pickWeighted(ANATOMICAL_SITES, ANATOMICAL_WEIGHTS, seed + 1600),
        registrationGroup: pickWeighted(REGISTRATION_GROUPS, REGISTRATION_WEIGHTS, seed + 1700),
        bacteriologicalStatus: pickWeighted(BACTERIOLOGICAL_STATUS, BACTERIOLOGICAL_WEIGHTS, seed + 1800),
        treatmentStartDate: formatDate(treatmentStartDate),
        outcomeDate: outcomeDate ? formatDate(outcomeDate) : '-',
        createdAt: new Date().toISOString(),
      };
      return [...prev, record];
    });
  }, []);

  const deleteRecord = useCallback((id) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const updateRecord = useCallback((id, updates) => {
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  }, []);

  // ── Sync from External System (real REST API fetch with validation) ──
  // Fetches from TB-IS Integration API Server at http://localhost:3001/api/records
  // Validates each record against healthcare standards before importing
  const syncFromExternalSystem = useCallback(async () => {
    const syncId = `sync_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}`;
    const startTime = Date.now();

    try {
      // Real fetch from External TB-IS REST API
      const response = await fetch('http://localhost:3001/api/records');
      if (!response.ok) throw new Error(`API returned ${response.status}: ${response.statusText}`);
      const payload = await response.json();
      const externalRecords = payload.records || [];

      if (externalRecords.length === 0) {
        throw new Error('External TB-IS returned 0 records. Make sure the API server is running and records have been seeded.');
      }

      // Get existing TBInsight record IDs to detect duplicates
      const existingIds = new Set(records.map(r => r.id));
      const alreadyImportedIds = new Set(importedRecords.map(r => r.id));

      let imported = 0;
      let dupsSkipped = 0;
      let failed = 0;
      let validationFailed = 0;
      const newRecords = [];
      const validationErrors = [];

      for (const extRec of externalRecords) {
        const caseId = extRec.id;

        // Skip if already in TBInsight records
        if (existingIds.has(caseId)) {
          dupsSkipped++;
          continue;
        }
        // Skip if already in imported records queue
        if (alreadyImportedIds.has(caseId)) {
          dupsSkipped++;
          continue;
        }

        // Validate record against healthcare standards before importing
        const validation = validateImportedRecord(extRec);
        if (!validation.valid) {
          validationFailed++;
          validationErrors.push({ id: caseId, errors: validation.errors });
          continue;
        }

        // Map External System fields → TBInsight TB Records fields (integration engine)
        try {
          const mapped = {
            id: caseId,
            barangay: extRec.barangay,
            age: extRec.age,
            sex: extRec.sex,
            diagnosisDate: extRec.diagnosisDate,
            facility: extRec.facility,
            status: extRec.status,
            validationStatus: extRec.validationStatus,
            screeningDate: extRec.screeningDate,
            notificationDate: extRec.notificationDate,
            city: extRec.city,
            treatmentFacility: extRec.treatmentFacility,
            sourcePatient: extRec.sourcePatient,
            anatomicalSite: extRec.anatomicalSite,
            registrationGroup: extRec.registrationGroup,
            bacteriologicalStatus: extRec.bacteriologicalStatus,
            treatmentStartDate: extRec.treatmentStartDate,
            outcomeDate: extRec.outcomeDate,
            createdAt: extRec.createdAt,
            encodedBy: extRec.encodedBy || 'System Generated',
            // Import metadata
            importedAt: new Date().toISOString(),
            importedFrom: 'TB-IS-Pasig',
            verificationStatus: 'Pending',
          };
          newRecords.push(mapped);
          imported++;
        } catch {
          failed++;
        }
      }

      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

      const log = {
        syncId,
        timestamp: new Date().toISOString(),
        duration,
        imported,
        failed,
        validationFailed,
        dupsSkipped,
        status: imported > 0 ? 'Success' : validationFailed > 0 ? 'Partial' : 'Skipped',
        source: 'TB-IS-Pasig',
        totalFetched: externalRecords.length,
        validationErrors: validationErrors.slice(0, 20), // First 20 errors for display
      };

      updateImportedRecords(prev => [...newRecords, ...prev]);
      updateSyncLogs(prev => [log, ...prev]);

      return { success: true, log, imported, dupsSkipped, failed, validationFailed };
    } catch (err) {
      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
      const log = {
        syncId,
        timestamp: new Date().toISOString(),
        duration,
        imported: 0,
        failed: 1,
        validationFailed: 0,
        dupsSkipped: 0,
        status: 'Failed',
        source: 'TB-IS-Pasig',
        error: err.message,
      };
      updateSyncLogs(prev => [log, ...prev]);
      return { success: false, log };
    }
  }, [records, importedRecords, updateImportedRecords, updateSyncLogs]);

  // ── Verify a single imported record → add to TB Records ──
  const verifyRecord = useCallback((caseId) => {
    // First, capture the record from importedRecords (separate read)
    const record = importedRecords.find(r => r.id === caseId);
    if (!record) return;

    // Add to TB Records with verified status
    const verifiedRecord = {
      ...record,
      verificationStatus: 'Verified',
      verifiedAt: new Date().toISOString(),
    };
    setRecords(prev => [...prev, verifiedRecord]);

    // Remove from imported queue (separate state update)
    updateImportedRecords(prev => prev.filter(r => r.id !== caseId));
  }, [importedRecords, updateImportedRecords, setRecords]);

  // ── Verify ALL pending imported records ──
  const verifyAllRecords = useCallback(() => {
    if (importedRecords.length === 0) return;

    // Add all to TB Records with verified status
    const verifiedRecords = importedRecords.map(r => ({
      ...r,
      verificationStatus: 'Verified',
      verifiedAt: new Date().toISOString(),
    }));
    setRecords(prev => [...prev, ...verifiedRecords]);

    // Clear the imported queue (separate state update)
    updateImportedRecords([]);
  }, [importedRecords, updateImportedRecords, setRecords]);

  // ── Reject a single imported record with reason ──
  const rejectRecord = useCallback((caseId, reason = '') => {
    // Capture the record before removing
    const record = importedRecords.find(r => r.id === caseId);

    if (record) {
      // Log the rejection to syncLogs (separate state update)
      const log = {
        syncId: `reject_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}`,
        timestamp: new Date().toISOString(),
        imported: 0,
        failed: 1,
        dupsSkipped: 0,
        status: 'Rejected',
        source: 'TB-IS-Pasig',
        rejectedCaseId: caseId,
        rejectionReason: reason || 'No reason provided',
      };
      updateSyncLogs(prev => [log, ...prev]);
    }

    // Remove from imported queue (separate state update)
    updateImportedRecords(prev => prev.filter(r => r.id !== caseId));
  }, [importedRecords, updateImportedRecords, updateSyncLogs]);

  // Analytics
  const analytics = useMemo(() => {
    const totalCases = records.length;
    const activeCases = records.filter((r) => r.status === 'Active' || r.status === 'Treatment').length;
    const cured = records.filter((r) => r.status === 'Cured').length;
    const completed = records.filter((r) => r.status === 'Completed').length;
    const successRate = totalCases > 0 ? ((cured + completed) / totalCases) * 100 : 0;

    // High-risk areas: barangays with > 20 total cases
    const barangayCounts = {};
    records.forEach((r) => {
      barangayCounts[r.barangay] = (barangayCounts[r.barangay] || 0) + 1;
    });
    const highRiskAreas = Object.values(barangayCounts).filter((c) => c > 20).length;

    // Monthly trend - all 36 months
    const monthlyTrend = [];
    YEARS.forEach((year) => {
      const maxMonth = 12;
      for (let m = 1; m <= maxMonth; m++) {
        const key = `${year}-${String(m).padStart(2, '0')}`;
        const count = records.filter((r) => r.diagnosisDate.startsWith(key)).length;
        monthlyTrend.push({ month: `${MONTHS[m - 1]} ${String(year).slice(2)}`, actual: count });
      }
    });

    // Barangay cases
    const barangayCases = Object.entries(barangayCounts)
      .map(([name, cases]) => ({ name, cases }))
      .sort((a, b) => b.cases - a.cases);

    // Treatment outcomes
    const treatmentOutcomes = {};
    STATUSES.forEach((s) => {
      treatmentOutcomes[s] = records.filter((r) => r.status === s).length;
    });

    // Age distribution
    const ageDistribution = { '0-14': 0, '15-64': 0, '65+': 0 };
    records.forEach((r) => {
      if (r.age <= 14) ageDistribution['0-14']++;
      else if (r.age <= 64) ageDistribution['15-64']++;
      else ageDistribution['65+']++;
    });

    // Gender distribution
    const genderDistribution = { Male: 0, Female: 0 };
    records.forEach((r) => {
      genderDistribution[r.sex] = (genderDistribution[r.sex] || 0) + 1;
    });

    // Year breakdown
    const yearBreakdown = { '2023': 0, '2024': 0, '2025': 0 };
    records.forEach((r) => {
      const y = r.diagnosisDate.slice(0, 4);
      if (yearBreakdown[y] !== undefined) yearBreakdown[y]++;
    });

    // Forecast next month (6-month moving average)
    const last6Months = monthlyTrend.slice(-6);
    const forecastNextMonth = Math.round(
      last6Months.reduce((sum, m) => sum + m.actual, 0) / last6Months.length
    );

    // Generate 6-month forecast trend for the chart (dashed line)
    const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const forecastTrend = [];
    if (last6Months.length >= 2) {
      const avgMonthly = last6Months.reduce((s, m) => s + m.actual, 0) / last6Months.length;
      // Compute simple growth rate from first to last of last 6 months
      const firstHalf = last6Months.slice(0, 3).reduce((s, m) => s + m.actual, 0) / 3;
      const secondHalf = last6Months.slice(3).reduce((s, m) => s + m.actual, 0) / Math.max(1, last6Months.slice(3).length);
      const growthRate = firstHalf > 0 ? (secondHalf - firstHalf) / firstHalf : 0;

      // Find the last month in monthlyTrend to continue from
      const lastEntry = monthlyTrend[monthlyTrend.length - 1];
      const lastLabel = lastEntry?.month || '';
      // Parse the last month label (e.g. "Dec 26") to get month index and year
      const lastMonthIdx = MONTHS_SHORT.indexOf(lastLabel.split(' ')[0]);
      const lastYearShort = parseInt(lastLabel.split(' ')[1] || '26', 10);
      const lastYear = lastYearShort < 100 ? 2000 + lastYearShort : lastYearShort;

      let runningForecast = forecastNextMonth;
      for (let i = 1; i <= 6; i++) {
        let fm = lastMonthIdx + i;
        let fy = lastYear;
        while (fm >= 12) { fm -= 12; fy++; }
        // Apply growth with slight dampening for realism
        const dampening = 1 - (i * 0.03); // reduces growth over time
        runningForecast = Math.max(1, Math.round(avgMonthly * (1 + growthRate * i * dampening)));
        forecastTrend.push({
          month: `${MONTHS_SHORT[fm]} ${String(fy).slice(2)}`,
          forecast: runningForecast,
        });
      }
    }

    return {
      totalCases,
      activeCases,
      highRiskAreas,
      successRate,
      forecastNextMonth,
      lastSync: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      monthlyTrend,
      forecastTrend,
      barangayCases,
      treatmentOutcomes,
      ageDistribution,
      genderDistribution,
      yearBreakdown,
    };
  }, [records]);

  // Alerts
  const alerts = useMemo(() => {
    const generated = [];
    let alertId = 1;

    // High-Risk Hotspot Detected: > 20 cases per barangay
    const barangayCounts = {};
    records.forEach((r) => {
      barangayCounts[r.barangay] = (barangayCounts[r.barangay] || 0) + 1;
    });
    Object.entries(barangayCounts).forEach(([barangay, count]) => {
      if (count > 20) {
        generated.push({
          id: `alert-${alertId++}`,
          type: 'High',
          title: 'High-Risk Hotspot Detected',
          desc: `${barangay} has ${count} total cases`,
          timestamp: new Date().toISOString(),
          barangay,
          icon: 'MapPin',
        });
      }
    });

    // Low Success Rate: < 70% (only for barangays with >= 5 records)
    const barangaySuccess = {};
    records.forEach((r) => {
      if (!barangaySuccess[r.barangay]) barangaySuccess[r.barangay] = { total: 0, success: 0 };
      barangaySuccess[r.barangay].total++;
      if (r.status === 'Cured' || r.status === 'Completed') barangaySuccess[r.barangay].success++;
    });
    Object.entries(barangaySuccess).forEach(([barangay, { total, success }]) => {
      if (total >= 5) {
        const rate = (success / total) * 100;
        if (rate < 70) {
          generated.push({
            id: `alert-${alertId++}`,
            type: 'Medium',
            title: 'Low Success Rate',
            desc: `${barangay} treatment success rate is ${rate.toFixed(1)}% (${success}/${total})`,
            timestamp: new Date().toISOString(),
            barangay,
            icon: 'AlertTriangle',
          });
        }
      }
    });

    // Rapid Increase in Cases: > 20% month-over-month growth
    const monthlyByBarangay = {};
    records.forEach((r) => {
      const monthKey = r.diagnosisDate.slice(0, 7);
      if (!monthlyByBarangay[r.barangay]) monthlyByBarangay[r.barangay] = {};
      monthlyByBarangay[r.barangay][monthKey] = (monthlyByBarangay[r.barangay][monthKey] || 0) + 1;
    });
    Object.entries(monthlyByBarangay).forEach(([barangay, months]) => {
      const sorted = Object.entries(months).sort((a, b) => b[0].localeCompare(a[0]));
      if (sorted.length >= 2) {
        const [currMonth, currCount] = sorted[0];
        const [prevMonth, prevCount] = sorted[1];
        if (prevCount > 0) {
          const growth = ((currCount - prevCount) / prevCount) * 100;
          if (growth > 20) {
            generated.push({
              id: `alert-${alertId++}`,
              type: 'Medium',
              title: 'Rapid Increase in Cases',
              desc: `Cases in ${barangay} increased ${growth.toFixed(1)}% from ${prevMonth} to ${currMonth}`,
              timestamp: new Date().toISOString(),
              barangay,
              icon: 'TrendingUp',
            });
          }
        }
      }
    });

    // High Active Case Load: > 5 active cases
    const activeByBarangay = {};
    records.forEach((r) => {
      if (r.status === 'Active' || r.status === 'Treatment') {
        activeByBarangay[r.barangay] = (activeByBarangay[r.barangay] || 0) + 1;
      }
    });
    Object.entries(activeByBarangay).forEach(([barangay, active]) => {
      if (active > 5) {
        generated.push({
          id: `alert-${alertId++}`,
          type: 'High',
          title: 'High Active Case Load',
          desc: `${barangay} has ${active} active cases requiring attention`,
          timestamp: new Date().toISOString(),
          barangay,
          icon: 'Users',
        });
      }
    });

    // System alerts
    generated.push(
      { id: `alert-${alertId++}`, type: 'Low', title: 'Data Sync Completed', desc: 'All records synchronized successfully', timestamp: new Date().toISOString(), barangay: 'System', icon: 'RefreshCw' },
      { id: `alert-${alertId++}`, type: 'Low', title: 'Forecast Updated', desc: 'Predictive models have been recalculated', timestamp: new Date().toISOString(), barangay: 'System', icon: 'BarChart2' },
      { id: `alert-${alertId++}`, type: 'Low', title: 'Report Generated', desc: 'Monthly summary report is ready for review', timestamp: new Date().toISOString(), barangay: 'System', icon: 'FileText' }
    );

    return generated;
  }, [records]);

  // Forecast Data
  const forecastData = useMemo(() => {
    return BARANGAYS.map((barangay) => {
      const bRecords = records.filter((r) => r.barangay === barangay.name);
      const monthlyCounts = {};
      bRecords.forEach((r) => {
        const key = r.diagnosisDate.slice(0, 7);
        monthlyCounts[key] = (monthlyCounts[key] || 0) + 1;
      });
      const sortedMonths = Object.entries(monthlyCounts).sort((a, b) => a[0].localeCompare(b[0]));
      const historical = sortedMonths.map(([month, cases]) => ({ month, cases }));
      const last6 = historical.slice(-6).map((m) => m.cases);
      const avgMonthly = last6.length > 0 ? last6.reduce((a, b) => a + b, 0) / last6.length : 0;
      const growthRate = last6.length >= 2 && last6[0] > 0 ? (last6[last6.length - 1] - last6[0]) / last6[0] : 0;
      const forecast = [];
      const lastDate = historical.length > 0 ? historical[historical.length - 1].month : '2025-12';
      const [fYear, fMonth] = lastDate.split('-').map(Number);
      for (let i = 1; i <= 6; i++) {
        let fm = fMonth + i;
        let fy = fYear;
        while (fm > 12) { fm -= 12; fy++; }
        const predicted = Math.max(0, Math.round(avgMonthly * (1 + growthRate * i)));
        forecast.push({ month: `${fy}-${String(fm).padStart(2, '0')}`, predicted });
      }
      const predictedCases = forecast.length > 0 ? forecast[0].predicted : 0;
      const risk = predictedCases > 8 ? 'High' : predictedCases > 4 ? 'Moderate' : 'Low';
      return {
        barangay: barangay.name,
        cases: bRecords.length,
        historical,
        forecast,
        predictedCases,
        growthRate: growthRate * 100,
        risk,
      };
    });
  }, [records]);

  // GIS Data
  const gisData = useMemo(() => {
    return BARANGAYS.map((barangay) => {
      const bRecords = records.filter((r) => r.barangay === barangay.name);
      const activeCount = bRecords.filter((r) => r.status === 'Active' || r.status === 'Treatment').length;
      const curedCount = bRecords.filter((r) => r.status === 'Cured' || r.status === 'Completed').length;
      const successRate = bRecords.length > 0 ? (curedCount / bRecords.length) * 100 : 0;
      const forecastItem = forecastData.find((f) => f.barangay === barangay.name);
      const facilities = FACILITIES[barangay.name] || [`${barangay.name} HC`];
      return {
        barangay: barangay.name,
        lat: BARANGAY_COORDS[barangay.name]?.lat || 14.56,
        lng: BARANGAY_COORDS[barangay.name]?.lng || 121.07,
        cases: bRecords.length,
        activeCases: activeCount,
        risk: bRecords.length > 20 ? 'High' : bRecords.length > 10 ? 'Moderate' : 'Low',
        forecast: forecastItem?.predictedCases || 0,
        successRate,
        facility: facilities[0],
      };
    });
  }, [records, forecastData]);

  // Resource Data
  const resourceData = useMemo(() => {
    return BARANGAYS.map((barangay) => {
      const bRecords = records.filter((r) => r.barangay === barangay.name);
      const cases = bRecords.length;
      const active = bRecords.filter((r) => r.status === 'Active' || r.status === 'Treatment').length;
      const curedCount = bRecords.filter((r) => r.status === 'Cured' || r.status === 'Completed').length;
      const successRate = cases > 0 ? (curedCount / cases) * 100 : 0;
      const forecastItem = forecastData.find((f) => f.barangay === barangay.name);
      const forecast = forecastItem?.predictedCases || 0;
      const priorityScore =
        cases * 0.3 +
        active * 0.25 +
        (cases > 0 ? (forecast / cases) * 20 : 0) +
        (100 - successRate) * 0.25;
      const interventions = [];
      if (successRate < 75) interventions.push('Intensive treatment support');
      if (active > 5) interventions.push('Contact tracing expansion');
      if (forecast > cases * 1.2) interventions.push('Preventive screening campaign');
      if (cases > 20) interventions.push('Resource allocation review');
      return {
        barangay: barangay.name,
        cases,
        active,
        successRate,
        forecast,
        priorityScore: Math.round(priorityScore * 100) / 100,
        interventions,
        rank: 0,
      };
    })
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }, [records, forecastData]);

  const value = useMemo(
    () => ({
      records,
      addRecord,
      addTestRecord,
      deleteRecord,
      updateRecord,
      analytics,
      alerts,
      forecastData,
      gisData,
      resourceData,
      // Import/Verification
      importedRecords,
      syncLogs,
      syncFromExternalSystem,
      verifyRecord,
      verifyAllRecords,
      rejectRecord,
    }),
    [records, addRecord, addTestRecord, deleteRecord, updateRecord, analytics, alerts, forecastData, gisData, resourceData, importedRecords, syncLogs, syncFromExternalSystem, verifyRecord, verifyAllRecords, rejectRecord]
  );

  return <TBDataContext.Provider value={value}>{children}</TBDataContext.Provider>;
}

export function useTBData() {
  const ctx = useContext(TBDataContext);
  if (!ctx) throw new Error('useTBData must be used within TBDataProvider');
  return ctx;
}

export default TBDataContext;
