/**
 * Data cleaning stage for the Pasig TB import pipeline.
 *
 * Pipeline: upload (.xlsx/.xls/.csv) -> parse (multiSheetParser) -> raw_tb_cases
 *           -> CLEAN (this file) -> validate (validator) -> validated_tb_cases
 *           -> webhook to TBInsight (webhookSender)
 *
 * Cleaning is deterministic and never invents data. It only:
 *   - trims / collapses whitespace and turns placeholder values ("N/A", "-", "none") into null
 *   - maps barangay spellings to the 30 official PSGC names (Sto. -> Santo, Brgy prefix, (Pob.), typos)
 *   - standardizes city, sex, outcome status, age and dates
 * Every change it makes to a meaningful field is reported back as a note so the
 * validation screen can show what was corrected.
 */

const { computeAge, splitFullName } = require('./patientIdentity');

// Pasig City barangays (canonical spelling used by TBInsight). The live list is loaded
// from the database at startup and refreshed periodically (services/barangayRegistry.js
// -> setBarangays); this built-in list is only the fallback when the database can't be
// reached. The array is updated IN PLACE so every module holding it sees the new list.
const PASIG_BARANGAYS = [
  'Bagong Ilog', 'Bagong Katipunan', 'Bambang', 'Buting', 'Caniogan', 'Dela Paz',
  'Kalawaan', 'Kapasigan', 'Kapitolyo', 'Malinao', 'Manggahan', 'Maybunga',
  'Oranbo', 'Palatiw', 'Pinagbuhatan', 'Pineda', 'Rosario', 'Sagad',
  'San Antonio', 'San Joaquin', 'San Jose', 'San Miguel', 'San Nicolas',
  'Santa Cruz', 'Santa Lucia', 'Santa Rosa', 'Santo Tomas', 'Santolan',
  'Sumilang', 'Ugong',
];

// Explicit spellings seen in registries that simple normalization cannot resolve.
const BARANGAY_ALIASES = {
  'de la paz': 'Dela Paz',
  'delapaz': 'Dela Paz',
  'mangahan': 'Manggahan',
  'bagong ilog pasig': 'Bagong Ilog',
  'san nicolas poblacion': 'San Nicolas',
  'kapasigan poblacion': 'Kapasigan',
  'sto tomas': 'Santo Tomas',
  'sta rosa': 'Santa Rosa',
  'sta cruz': 'Santa Cruz',
  'sta lucia': 'Santa Lucia',
};

const PLACEHOLDERS = new Set(['', '-', '--', '---', 'n/a', 'na', 'n.a.', 'none', 'null', 'nil', '.', '?', '#n/a']);

// Canonical outcome values (upper case, as TBInsight stores and queries them).
const OUTCOME_MAP = {
  'cured': 'CURED',
  'treatment completed': 'TREATMENT COMPLETED',
  'treatment complete': 'TREATMENT COMPLETED',
  'tx completed': 'TREATMENT COMPLETED',
  'completed': 'TREATMENT COMPLETED',
  'on treatment': 'ON TREATMENT',
  'on tx': 'ON TREATMENT',
  'ongoing treatment': 'ON TREATMENT',
  'on going treatment': 'ON TREATMENT',
  'ongoing': 'ON TREATMENT',
  'lost to follow up': 'LOST TO FF-UP',
  'lost to follow-up': 'LOST TO FF-UP',
  'lost to followup': 'LOST TO FF-UP',
  'lost to ff-up': 'LOST TO FF-UP',
  'lost to ff up': 'LOST TO FF-UP',
  'ltfu': 'LOST TO FF-UP',
  'died': 'DIED',
  'dead': 'DIED',
  'expired': 'DIED',
  'treatment failed': 'TREATMENT FAILED',
  'failed': 'TREATMENT FAILED',
  'not evaluated': 'NOT EVALUATED',
  'refused': 'REFUSED',
  'excluded': 'EXCLUDED',
};

const DATE_FIELDS = [
  'date_of_birth',
  'date_of_screening', 'date_of_diagnosis', 'date_of_notification',
  'date_started_treatment', 'date_of_outcome',
  'microscopy_release_date', 'rdt_release_date',
];

const TEXT_FIELDS = [
  'screening_facility', 'treatment_facility', 'source_of_patient', 'anatomical_site',
  'registration_group', 'bacteriological_status', 'validation_status', 'itis_case_id',
  'type', 'province', 'region', 'referred_to_dots', 'referral_status',
  'microscopy_result', 'rdt_result', 'outcome_reason',
  'last_name', 'first_name', 'middle_name', 'suffix', 'full_name',
];

const MONTH_ABBR = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

// ---------- generic helpers ----------

function cleanText(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val;
  const s = String(val).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  if (PLACEHOLDERS.has(s.toLowerCase())) return null;
  return s;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Two-digit years (Excel re-saves CSV dates as e.g. "11-Apr-57"): 20YY unless that
// would be in the future, else 19YY — so birth years like 57 become 1957, not 2057.
function expandYear(y) {
  if (y >= 100) return y;
  return y <= new Date().getUTCFullYear() % 100 ? 2000 + y : 1900 + y;
}

function validYmd(y, m, d) {
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // e.g. Feb 30
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Parse any date the registries use into YYYY-MM-DD, or null.
 * Supports Date objects, Excel serial numbers, ISO, M/D/YYYY, DD-Mon-YY, "January 5, 2025", "5 Jan 2025".
 */
function cleanDate(val) {
  if (val === null || val === undefined || val === '') return null;

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    // Excel dates arrive as UTC midnight; use UTC parts so the day never shifts.
    return validYmd(val.getUTCFullYear(), val.getUTCMonth() + 1, val.getUTCDate());
  }

  // Excel serial number (days since 1899-12-30), e.g. 45678 or "45678"
  const asNum = typeof val === 'number' ? val : (/^\d{5}(\.\d+)?$/.test(String(val).trim()) ? Number(val) : NaN);
  if (!isNaN(asNum) && asNum > 20000 && asNum < 80000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(asNum) * 86400000);
    return validYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  const s = cleanText(val);
  if (!s) return null;

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); // 2025-01-05, 2025/1/5
  if (m) return validYmd(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/); // 1/5/2025 (M/D/Y, Philippine registry default)
  if (m) {
    const y = expandYear(+m[3]);
    let mo = +m[1];
    let d = +m[2];
    if (mo > 12 && d <= 12) [mo, d] = [d, mo]; // clearly D/M/Y
    return validYmd(y, mo, d);
  }

  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})\.?[-\s,]*(\d{2}|\d{4})$/); // 07-Jan-25, 7 January 2025
  if (m) {
    const mon = MONTH_ABBR[m[2].toLowerCase().slice(0, 4)] || MONTH_ABBR[m[2].toLowerCase().slice(0, 3)];
    if (mon) return validYmd(expandYear(+m[3]), mon, +m[1]);
  }

  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/); // January 5, 2025 / Jan. 5 2025
  if (m) {
    const word = m[1].toLowerCase();
    const idx = MONTH_NAMES.indexOf(word);
    const mon = idx >= 0 ? idx + 1 : MONTH_ABBR[word.slice(0, 3)];
    if (mon) return validYmd(+m[3], mon, +m[2]);
  }

  return null;
}

function cleanSex(val) {
  const s = cleanText(val);
  if (!s) return null;
  const v = s.toLowerCase().replace(/\./g, '');
  if (v === 'm' || v === 'male' || v === 'lalaki') return 'Male';
  if (v === 'f' || v === 'female' || v === 'babae') return 'Female';
  return s; // leave unrecognized value so validation reports it
}

function cleanAge(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? Math.floor(val) : null;
  const s = cleanText(val);
  if (!s) return null;
  const m = s.match(/^(\d{1,3})(\.\d+)?\s*(y|yr|yrs|year|years|y\/o|yo)?\.?$/i);
  if (m) return parseInt(m[1], 10);
  const months = s.match(/^(\d{1,2})\s*(mo|mos|month|months)\.?$/i);
  if (months) return 0; // infants recorded in months
  return s; // leave as-is; validation will flag it
}

// ---------- barangay / city ----------

function barangayKey(val) {
  return String(val)
    .toLowerCase()
    .replace(/\(\s*pob(\.|lacion)?\s*\)/g, ' poblacion ')
    .replace(/\bpob\.?$/g, ' poblacion')
    .replace(/^\s*(brgy|bgy|barangay|brg)\.?\s+/g, '')
    .replace(/\bsto\.?\s+/g, 'santo ')
    .replace(/\bsta\.?\s+/g, 'santa ')
    .replace(/[.,'"`]/g, ' ')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CANONICAL_BY_KEY = new Map(PASIG_BARANGAYS.map(n => [barangayKey(n), n]));

/** Replace the barangay list (from the database). Ignores empty input. */
function setBarangays(names) {
  const clean = [...new Set((names || []).map(n => String(n || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  if (clean.length === 0) return false;
  PASIG_BARANGAYS.splice(0, PASIG_BARANGAYS.length, ...clean);
  CANONICAL_BY_KEY.clear();
  for (const n of clean) CANONICAL_BY_KEY.set(barangayKey(n), n);
  return true;
}

function isPasigBarangay(name) {
  const n = String(name || '').trim().toLowerCase();
  return n !== '' && PASIG_BARANGAYS.some(b => b.toLowerCase() === n);
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

/**
 * Map a raw barangay value to its official Pasig name.
 * Returns { name, matched, corrected } — name is the canonical name when matched,
 * otherwise the cleaned original text (so non-Pasig records keep their value).
 */
function matchBarangay(val) {
  const s = cleanText(val);
  if (!s) return { name: null, matched: false, corrected: false };

  let key = barangayKey(s);
  // "San Nicolas poblacion" -> also try without the poblacion suffix
  const keys = [key, key.replace(/\s*poblacion\s*/g, ' ').trim()];

  for (const k of keys) {
    if (CANONICAL_BY_KEY.has(k)) {
      const name = CANONICAL_BY_KEY.get(k);
      // A capitalization-only change ("SAN ANTONIO" -> "San Antonio") is not a correction.
      return { name, matched: true, corrected: name.toLowerCase() !== s.toLowerCase() };
    }
    if (BARANGAY_ALIASES[k]) {
      const name = BARANGAY_ALIASES[k];
      return { name, matched: true, corrected: name.toLowerCase() !== s.toLowerCase() };
    }
  }

  // Conservative typo tolerance: one unique closest official name, small edit distance.
  key = keys[1];
  let best = null;
  let bestDist = Infinity;
  let tie = false;
  for (const [k, name] of CANONICAL_BY_KEY) {
    const d = levenshtein(key, k);
    if (d < bestDist) { best = name; bestDist = d; tie = false; }
    else if (d === bestDist) tie = true;
  }
  const allowed = key.length >= 9 ? 2 : key.length >= 6 ? 1 : 0;
  if (best && !tie && bestDist <= allowed) {
    return { name: best, matched: true, corrected: true };
  }

  return { name: s, matched: false, corrected: false };
}

function isPasigCity(val) {
  const s = cleanText(val);
  if (!s) return false;
  const v = s.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  return v === 'pasig' || v === 'pasig city' || v === 'city of pasig' ||
    v.startsWith('pasig city ') || v.startsWith('city of pasig ') || v === 'pasig metro manila';
}

function cleanCity(val) {
  const s = cleanText(val);
  if (!s) return null;
  return isPasigCity(s) ? 'Pasig City' : s;
}

function cleanOutcome(val) {
  const s = cleanText(val);
  if (!s) return null;
  const key = s.toLowerCase().replace(/[_]/g, ' ').replace(/\s+/g, ' ').trim();
  return OUTCOME_MAP[key] || OUTCOME_MAP[key.replace(/-/g, ' ')] || s.toUpperCase();
}

function cleanValidationStatus(val) {
  const s = cleanText(val);
  if (!s) return null;
  const v = s.toLowerCase();
  if (v.includes('not') && v.includes('valid')) return 'Not Validated';
  if (v.includes('valid')) return 'Validated';
  return s;
}

// ---------- record-level ----------

/**
 * Clean one parsed record. Returns { record, notes, isPasig }.
 *   record  — cleaned copy (the input is not mutated)
 *   notes   — human-readable list of corrections made (shown as warnings)
 *   isPasig — true when the barangay is one of the 30 Pasig barangays
 */
function cleanRecord(input) {
  const rec = { ...input };
  const notes = [];

  for (const f of TEXT_FIELDS) {
    if (f in rec) rec[f] = cleanText(rec[f]);
  }

  // Dates
  for (const f of DATE_FIELDS) {
    if (!(f in rec)) continue;
    const raw = rec[f];
    const cleaned = cleanDate(raw);
    // "No Data" is how the registry export writes an empty date — blank, not unreadable.
    const noData = /^no\s*data$/i.test(String(raw ?? '').trim());
    if (raw !== null && raw !== undefined && cleanText(raw) !== null && !noData && !cleaned) {
      notes.push(`Unreadable ${f.replace(/_/g, ' ')} "${raw}" was cleared`);
    }
    rec[f] = cleaned;
  }

  // Name: a single "LAST, FIRST MIDDLE" column fills the separate fields when they're empty
  if (rec.full_name && !rec.last_name && !rec.first_name) {
    const parts = splitFullName(rec.full_name);
    if (parts) Object.assign(rec, parts);
  }
  delete rec.full_name;

  // Sex / age. Age is calculated from date of birth and date of diagnosis; the file's
  // own Age column is only used to warn when it disagrees.
  rec.sex = cleanSex(rec.sex);
  const reportedAge = cleanAge(rec.age);
  const computedAge = computeAge(rec.date_of_birth, rec.date_of_diagnosis);
  if (computedAge !== null) {
    if (reportedAge !== null && reportedAge !== computedAge) {
      notes.push(`Age ${reportedAge} in the file differs from the age calculated from date of birth (${computedAge}); using ${computedAge}`);
    }
    rec.age = computedAge;
  } else {
    rec.age = reportedAge;
  }

  // City
  const rawCity = rec.city;
  rec.city = cleanCity(rawCity);

  // Barangay
  const rawBgy = rec.barangay_name;
  const bgy = matchBarangay(rawBgy);
  rec.barangay_name = bgy.name;
  if (bgy.matched && bgy.corrected) {
    notes.push(`Barangay "${cleanText(rawBgy)}" standardized to "${bgy.name}"`);
  }
  // A Pasig barangay with a blank city is a Pasig record
  if (bgy.matched && !rec.city) rec.city = 'Pasig City';

  // Outcome / validation status
  rec.outcome_status = cleanOutcome(rec.outcome_status);
  if ('validation_status' in rec) rec.validation_status = cleanValidationStatus(rec.validation_status);

  // Logical date checks (flag only — never change dates the user entered)
  if (rec.date_of_diagnosis && rec.date_started_treatment && rec.date_started_treatment < rec.date_of_diagnosis) {
    notes.push('Treatment start date is before diagnosis date');
  }
  if (rec.date_of_diagnosis && rec.date_of_outcome && rec.date_of_outcome < rec.date_of_diagnosis) {
    notes.push('Outcome date is before diagnosis date');
  }
  const today = new Date().toISOString().slice(0, 10);
  if (rec.date_of_diagnosis && rec.date_of_diagnosis > today) {
    notes.push('Diagnosis date is in the future');
  }

  if (rec.date_of_birth && rec.date_of_birth > today) {
    notes.push('Date of birth is in the future');
  }

  const isPasig = bgy.matched && (rec.city === 'Pasig City' || !rawCity);
  return { record: rec, notes, isPasig };
}

/**
 * True when every meaningful field is empty (e.g. trailing formatted-but-empty spreadsheet rows).
 */
function isBlankRecord(rec) {
  const keys = ['barangay_name', 'date_of_diagnosis', 'age', 'sex', 'screening_facility', 'itis_case_id', 'outcome_status'];
  return keys.every(k => rec[k] === null || rec[k] === undefined || cleanText(rec[k]) === null);
}

module.exports = {
  PASIG_BARANGAYS,
  setBarangays,
  isPasigBarangay,
  cleanRecord,
  cleanText,
  cleanDate,
  cleanSex,
  cleanAge,
  cleanCity,
  cleanOutcome,
  cleanValidationStatus,
  matchBarangay,
  isPasigCity,
  isBlankRecord,
};
