# PHASE 1: DETAILED IMPLEMENTATION PLAN
## Pasig Clone System + Webhook Integration

---

## TABLE OF CONTENTS

1. [System Architecture](#1-system-architecture)
2. [Project Structure](#2-project-structure)
3. [Database Design](#3-database-design)
4. [Pasig Clone Backend](#4-pasig-clone-backend)
5. [Pasig Clone Frontend](#5-pasig-clone-frontend)
6. [P2_OFFICIAL Updates](#6-p2_official-updates)
7. [Webhook Integration](#7-webhook-integration)
8. [Testing Strategy](#8-testing-strategy)
9. [Deployment](#9-deployment)
10. [Implementation Checklist](#10-implementation-checklist)

---

## 1. SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FINAL ARCHITECTURE                                │
└─────────────────────────────────────────────────────────────────────────────┘

                         ┌─────────────────────────┐
                         │   Pasig TB-DOTS System   │
                         │   (Exports Excel file)   │
                         └───────────┬─────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │   Excel File (2 sheets)         │
                    │   - DSTB (18 columns)           │
                    │   - MN (28 columns)             │
                    └────────────────┬────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASIG CLONE SYSTEM (New)                                                   │
│  Port: 5001 (backend), 5174 (frontend)                                     │
│  Database: PostgreSQL (same instance, schema: pasig_clone)                 │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  BACKEND (Express.js)                                               │   │
│  │                                                                      │   │
│  │  POST /api/data/csv          - Upload Excel (2 sheets)              │   │
│  │  POST /api/data/validate/:id - Validate batch                       │   │
│  │  POST /api/webhook/send      - Send to P2_OFFICIAL                  │   │
│  │                                                                      │   │
│  │  Services:                                                           │   │
│  │  - multiSheetParser.js    - Parses both DSTB + MN sheets            │   │
│  │  - validator.js           - Data quality checks                     │   │
│  │  - webhookSender.js       - HTTP client with HMAC signing           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  FRONTEND (React + Vite)                                            │   │
│  │                                                                      │   │
│  │  Pages:                                                             │   │
│  │  - LoginPage.jsx           - Authentication                         │   │
│  │  - CsvImportPage.jsx       - Upload Excel files                     │   │
│  │  - ValidationPage.jsx      - Review validation results              │   │
│  │  - WebhookStatusPage.jsx   - Send status + history                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ POST /api/webhook/pasig-clone
                                     │ Header: X-Webhook-Secret: <secret>
                                     │ Header: X-Webhook-Signature: sha256=<hmac>
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  P2_OFFICIAL SYSTEM (Existing)                                              │
│  Port: 5000 (backend), 5173 (frontend)                                     │
│  Database: PostgreSQL (schema: public)                                     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  BACKEND (Express.js)                                               │   │
│  │                                                                      │   │
│  │  POST /api/webhook/pasig-clone  - Receive webhook (NEW)             │   │
│  │  POST /api/tb/import            - Existing import (updated)         │   │
│  │  POST /api/tb/pipeline          - ML pipeline (manual trigger)      │   │
│  │                                                                      │   │
│  │  Updated Files:                                                      │   │
│  │  - tbinsight/webhook.js       - Webhook endpoint (NEW)              │   │
│  │  - tbinsight/parseCaseFile.js - Multi-sheet support (UPDATED)       │   │
│  │  - middleware/webhookAuth.js  - HMAC verification (NEW)             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ML SERVICE (Python FastAPI) - Port 8001                           │   │
│  │  - ARIMA Forecasting                                                │   │
│  │  - Random Forest Classification                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. PROJECT STRUCTURE

```
C:\Users\iVAN\Desktop\P2_OFFICIAL\                    # Root (Git repo)
│
├── package.json                                       # npm workspace root
├── render.yaml                                        # Deployment config
├── vercel.json                                        # Frontend deployment
├── IMPLEMENTATION_PLAN.md                             # This file
│
├── PASIG_CLONE/                                       # NEW SYSTEM
│   ├── package.json                                   # Workspace config
│   │
│   ├── backend/                                       # Express.js
│   │   ├── server.js                                  # Entry point (port 5001)
│   │   ├── db.js                                      # PostgreSQL pool
│   │   ├── .env                                       # Environment variables
│   │   ├── .env.example                               # Template
│   │   ├── init.sql                                   # Schema creation
│   │   │
│   │   ├── routes/
│   │   │   ├── auth.js                                # JWT authentication
│   │   │   ├── dataEntry.js                           # Manual data encoding
│   │   │   ├── csvImport.js                           # CSV/Excel upload
│   │   │   ├── validation.js                          # Data validation
│   │   │   └── webhook.js                             # Send to P2_OFFICIAL
│   │   │
│   │   ├── middleware/
│   │   │   └── auth.js                                # JWT verification
│   │   │
│   │   ├── services/
│   │   │   ├── multiSheetParser.js                    # Parse DSTB + MN sheets
│   │   │   ├── validator.js                           # Validation rules
│   │   │   └── webhookSender.js                       # HTTP client + HMAC
│   │   │
│   │   └── package.json
│   │
│   ├── frontend/                                      # React + Vite
│   │   ├── src/
│   │   │   ├── main.jsx                               # Entry point
│   │   │   ├── App.jsx                                # Router
│   │   │   │
│   │   │   ├── api/
│   │   │   │   └── axios.js                           # Axios instance
│   │   │   │
│   │   │   ├── pages/
│   │   │   │   ├── LoginPage.jsx                      # Login
│   │   │   │   ├── CsvImportPage.jsx                  # Upload Excel
│   │   │   │   ├── ValidationPage.jsx                 # Review validation
│   │   │   │   └── WebhookStatusPage.jsx              # Send status
│   │   │   │
│   │   │   ├── components/
│   │   │   │   ├── Layout.jsx                         # Page layout
│   │   │   │   └── ProtectedRoute.jsx                 # Auth guard
│   │   │   │
│   │   │   └── styles/
│   │   │       └── globals.css                        # Tailwind imports
│   │   │
│   │   ├── index.html
│   │   ├── vite.config.js
│   │   ├── tailwind.config.js
│   │   ├── package.json
│   │   └── postcss.config.js
│   │
│   └── README.md
│
└── P2_OFFICIAL/                                       # EXISTING SYSTEM
    ├── BACKEND/
    │   ├── server.js                                  # UPDATED: Mount webhook route
    │   ├── tbinsight/
    │   │   ├── webhook.js                             # NEW: Webhook endpoint
    │   │   ├── parseCaseFile.js                       # UPDATED: Multi-sheet
    │   │   ├── importCases.js                         # UPDATED: source_type
    │   │   └── ... (existing files)
    │   ├── middleware/
    │   │   └── webhookAuth.js                         # NEW: HMAC verification
    │   └── db/
    │       └── migrations/
    │           └── 007_webhook_logs.sql               # NEW: Webhook log table
    │
    ├── FRONTEND/                                      # (existing, no changes)
    └── ML_SERVICE/                                    # (existing, no changes)
```

---

## 3. DATABASE DESIGN

### 3.1 Same PostgreSQL, Separate Schemas

```
PostgreSQL Database
│
├── Schema: public (P2_OFFICIAL)
│   ├── barangays
│   ├── health_facilities
│   ├── tb_cases_raw
│   ├── tb_cases
│   ├── monthly_case_summary
│   ├── demographic_summary
│   ├── outcome_summary
│   ├── facility_summary
│   ├── bacteriological_summary
│   ├── model_predictions
│   ├── barangay_risk_scores
│   ├── alerts
│   ├── model_metadata
│   ├── interventions
│   ├── users
│   └── webhook_logs (NEW)
│
└── Schema: pasig_clone (NEW)
    ├── users
    ├── raw_tb_cases
    ├── validated_tb_cases
    ├── import_batches
    └── webhook_logs
```

### 3.2 Pasig Clone Schema (init.sql)

```sql
-- Pasig Clone Database Schema
-- File: PASIG_CLONE/backend/init.sql

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Import batches
CREATE TABLE IF NOT EXISTS import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename TEXT NOT NULL,
    uploaded_by INTEGER REFERENCES users(id),
    status TEXT DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'validated', 'sent', 'failed')),
    total_rows INTEGER DEFAULT 0,
    dstb_count INTEGER DEFAULT 0,
    mn_count INTEGER DEFAULT 0,
    valid_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    validated_at TIMESTAMP,
    sent_at TIMESTAMP
);

-- Raw TB cases (from CSV)
CREATE TABLE IF NOT EXISTS raw_tb_cases (
    id BIGSERIAL PRIMARY KEY,
    batch_id UUID REFERENCES import_batches(id),
    sheet_name TEXT NOT NULL,           -- 'DSTB' or 'MN'
    source_type TEXT NOT NULL,          -- 'DSTB' or 'MN'
    row_number INTEGER,
    csv_data JSONB NOT NULL,            -- Original CSV row as JSON
    created_at TIMESTAMP DEFAULT NOW()
);

-- Validated TB cases (after validation)
CREATE TABLE IF NOT EXISTS validated_tb_cases (
    id BIGSERIAL PRIMARY KEY,
    batch_id UUID REFERENCES import_batches(id),
    source_type TEXT NOT NULL,          -- 'DSTB' or 'MN'

    -- Common fields (both sheets)
    barangay_name TEXT,
    date_of_diagnosis DATE,
    date_of_notification DATE,
    age INTEGER,
    sex TEXT,
    city TEXT,
    screening_facility TEXT,
    treatment_facility TEXT,
    source_of_patient TEXT,
    anatomical_site TEXT,
    registration_group TEXT,
    bacteriological_status TEXT,
    date_started_treatment DATE,
    outcome_status TEXT,
    date_of_outcome DATE,
    record_created_at TIMESTAMP,

    -- DSTB-specific fields
    date_of_screening DATE,
    validation_status TEXT,

    -- MN-specific fields
    itis_case_id TEXT,

    -- Validation results
    is_valid BOOLEAN DEFAULT true,
    validation_errors JSONB,
    validation_warnings JSONB,

    created_at TIMESTAMP DEFAULT NOW()
);

-- Webhook logs
CREATE TABLE IF NOT EXISTS webhook_logs (
    id SERIAL PRIMARY KEY,
    batch_id UUID REFERENCES import_batches(id),
    payload JSONB,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'acknowledged')),
    response_code INTEGER,
    response_body TEXT,
    error_message TEXT,
    sent_at TIMESTAMP DEFAULT NOW(),
    acknowledged_at TIMESTAMP
);

-- Indexes
CREATE INDEX idx_raw_cases_batch ON raw_tb_cases(batch_id);
CREATE INDEX idx_validated_cases_batch ON validated_tb_cases(batch_id);
CREATE INDEX idx_webhook_logs_batch ON webhook_logs(batch_id);
```

### 3.3 P2_OFFICIAL Schema Updates

```sql
-- File: P2_OFFICIAL/BACKEND/db/migrations/007_webhook_logs.sql

-- Webhook logs for tracking received webhooks
CREATE TABLE IF NOT EXISTS webhook_logs (
    id SERIAL PRIMARY KEY,
    source TEXT NOT NULL,                    -- 'pasig-clone'
    batch_id UUID,
    payload JSONB,
    status TEXT DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed')),
    records_received INTEGER DEFAULT 0,
    records_imported INTEGER DEFAULT 0,
    error_message TEXT,
    received_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP
);

CREATE INDEX idx_webhook_logs_source ON webhook_logs(source);
CREATE INDEX idx_webhook_logs_received ON webhook_logs(received_at);
```

---

## 4. PASIG CLONE BACKEND

### 4.1 Server Setup (server.js)

```javascript
// File: PASIG_CLONE/backend/server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const db = require('./db');

const authRoutes = require('./routes/auth');
const csvImportRoutes = require('./routes/csvImport');
const validationRoutes = require('./routes/validation');
const webhookRoutes = require('./routes/webhook');

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors({
  origin: ['http://localhost:5174', process.env.FRONTEND_URL],
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/data', csvImportRoutes);
app.use('/api/data', validationRoutes);
app.use('/api/webhook', webhookRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'pasig-clone', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Pasig Clone backend running on port ${PORT}`);
});

module.exports = app;
```

### 4.2 Multi-Sheet Parser (services/multiSheetParser.js)

```javascript
// File: PASIG_CLONE/backend/services/multiSheetParser.js

const XLSX = require('xlsx');

/**
 * Parse both DSTB and MN sheets from an Excel file.
 * Returns structured data with source_type tagging.
 */
function parseMultiSheetExcel(fileBuffer, filename) {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });

  const result = {
    filename,
    sheets: [],
    totalRecords: 0,
    dstbCount: 0,
    mnCount: 0,
  };

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const normalizedSheet = sheetName.toUpperCase().trim();

    // Determine source_type from sheet name
    let source_type;
    if (normalizedSheet.includes('MN') || normalizedSheet.includes('MICROSCOPIC')) {
      source_type = 'MN';
    } else {
      source_type = 'DSTB';
    }

    // Parse headers
    const rawHeaders = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
    const columnMap = buildColumnMap(rawHeaders, source_type);

    // Parse data rows
    const rawData = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const records = [];

    rawData.forEach((rawRow, index) => {
      const mappedRow = mapRow(rawRow, columnMap, source_type);
      mappedRow.row_number = index + 2;
      mappedRow.sheet_name = sheetName;
      records.push(mappedRow);
    });

    const sheetData = {
      sheet_name: sheetName,
      source_type,
      record_count: records.length,
      records,
    };

    result.sheets.push(sheetData);
    result.totalRecords += records.length;

    if (source_type === 'DSTB') {
      result.dstbCount += records.length;
    } else {
      result.mnCount += records.length;
    }
  }

  return result;
}

/**
 * Build column map based on source_type.
 * Handles different headers between DSTB and MN sheets.
 */
function buildColumnMap(rawHeaders, sourceType) {
  const map = {};

  for (const raw of rawHeaders) {
    const header = String(raw || '');
    const normalized = header.trim().toLowerCase();

    // Skip row number column
    if (normalized === 'no.' || normalized === 'no') continue;

    // Date fields
    if (normalized.includes('notification') && normalized.includes('date')) {
      map[header] = 'date_of_notification';
    } else if (normalized.includes('screening') && normalized.includes('date')) {
      map[header] = 'date_of_screening';
    } else if (normalized.includes('diagnosis') && normalized.includes('date')) {
      map[header] = 'date_of_diagnosis';
    } else if (normalized.includes('treatment') && normalized.includes('started')) {
      map[header] = 'date_started_treatment';
    } else if (normalized.includes('outcome') && normalized.includes('date')) {
      map[header] = 'date_of_outcome';
    } else if (normalized.includes('record') && normalized.includes('created')) {
      map[header] = 'record_created_at';
    }
    // Simple fields
    else if (normalized === 'age') {
      map[header] = 'age';
    } else if (normalized === 'sex') {
      map[header] = 'sex';
    } else if (normalized.includes('barangay') || normalized === 'brgy') {
      map[header] = 'barangay_name';
    } else if (normalized.includes('city') || normalized.includes('municipality')) {
      map[header] = 'city';
    }
    // Facility fields
    else if (normalized.includes('treatment') && (normalized.includes('health') || normalized.includes('facility'))) {
      map[header] = 'treatment_facility';
    } else if (normalized.includes('screening') && (normalized.includes('health') || normalized.includes('facility'))) {
      map[header] = 'screening_facility';
    }
    // Other fields
    else if (normalized.includes('source') && normalized.includes('patient')) {
      map[header] = 'source_of_patient';
    } else if (normalized.includes('anatomical')) {
      map[header] = 'anatomical_site';
    } else if (normalized.includes('registration')) {
      map[header] = 'registration_group';
    } else if (normalized.includes('bacteriological')) {
      map[header] = 'bacteriological_status';
    } else if (normalized.includes('outcome') && !normalized.includes('date')) {
      map[header] = 'outcome_status';
    }
    // DSTB-specific
    else if (normalized.includes('validation') && sourceType === 'DSTB') {
      map[header] = 'validation_status';
    }
    // MN-specific
    else if ((normalized.includes('itis') || normalized.includes('lite')) && normalized.includes('case')) {
      map[header] = 'itis_case_id';
    }
  }

  return map;
}

/**
 * Map a raw row to structured fields.
 */
function mapRow(rawRow, columnMap, sourceType) {
  const mapped = {
    source_type: sourceType,
    validation_status: null,
    itis_case_id: null,
  };

  for (const [csvCol, field] of Object.entries(columnMap)) {
    const val = rawRow[csvCol];
    if (val !== undefined && val !== null) {
      mapped[field] = val instanceof Date ? val : String(val).trim();
    }
  }

  // Parse dates
  mapped.date_of_screening = parseDate(mapped.date_of_screening);
  mapped.date_of_diagnosis = parseDate(mapped.date_of_diagnosis);
  mapped.date_of_notification = parseDate(mapped.date_of_notification);
  mapped.date_started_treatment = parseDate(mapped.date_started_treatment);
  mapped.date_of_outcome = parseDate(mapped.date_of_outcome);
  mapped.record_created_at = mapped.record_created_at
    ? new Date(mapped.record_created_at).toISOString()
    : null;

  // Parse age
  mapped.age = mapped.age ? parseInt(mapped.age) : null;

  // Normalize sex
  mapped.sex = normalizeSex(mapped.sex);

  return mapped;
}

/**
 * Parse date to YYYY-MM-DD format.
 */
function parseDate(dateVal) {
  if (!dateVal) return null;
  if (dateVal instanceof Date) {
    if (isNaN(dateVal.getTime())) return null;
    return dateVal.toISOString().split('T')[0];
  }

  const str = String(dateVal).trim();
  if (!str) return null;

  // Try various formats
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`;
  }

  // "February 06, 2025" format
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];
  const writtenMatch = str.match(/^(month)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (writtenMatch) {
    const monthIndex = monthNames.indexOf(writtenMatch[1].toLowerCase());
    if (monthIndex >= 0) {
      const m = String(monthIndex + 1).padStart(2, '0');
      const d = String(writtenMatch[2]).padStart(2, '0');
      return `${writtenMatch[3]}-${m}-${d}`;
    }
  }

  return null;
}

/**
 * Normalize sex value.
 */
function normalizeSex(val) {
  if (!val) return null;
  const v = String(val).trim().toLowerCase();
  if (v === 'm' || v === 'male') return 'Male';
  if (v === 'f' || v === 'female') return 'Female';
  return null;
}

module.exports = {
  parseMultiSheetExcel,
  buildColumnMap,
  mapRow,
  parseDate,
  normalizeSex,
};
```

### 4.3 CSV Import Route (routes/csvImport.js)

```javascript
// File: PASIG_CLONE/backend/routes/csvImport.js

const express = require('express');
const router = express.Router();
const fileUpload = require('express-fileupload');
const { parseMultiSheetExcel } = require('../services/multiSheetParser');
const { validateBatch } = require('../services/validator');
const db = require('../db');
const { authorizeRoles } = require('../middleware/auth');

// Enable file upload
router.use(fileUpload());

/**
 * POST /api/data/csv
 * Upload Excel file with DSTB and MN sheets.
 */
router.post('/csv', authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.files.file;
    const maxSize = 50 * 1024 * 1024; // 50MB

    if (file.size > maxSize) {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }

    // Parse multi-sheet Excel
    const parsed = parseMultiSheetExcel(file.data, file.name);

    // Create import batch
    const batchResult = await db.query(
      `INSERT INTO import_batches (filename, uploaded_by, total_rows, dstb_count, mn_count)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [file.name, req.user.id, parsed.totalRecords, parsed.dstbCount, parsed.mnCount]
    );

    const batchId = batchResult.rows[0].id;

    // Store raw records
    for (const sheet of parsed.sheets) {
      for (const record of sheet.records) {
        await db.query(
          `INSERT INTO raw_tb_cases (batch_id, sheet_name, source_type, row_number, csv_data)
           VALUES ($1, $2, $3, $4, $5)`,
          [batchId, sheet.sheet_name, sheet.source_type, record.row_number, record]
        );
      }
    }

    res.status(201).json({
      message: 'File uploaded successfully',
      batch: {
        id: batchId,
        filename: file.name,
        totalRows: parsed.totalRecords,
        dstbCount: parsed.dstbCount,
        mnCount: parsed.mnCount,
      },
      sheets: parsed.sheets.map(s => ({
        name: s.sheet_name,
        sourceType: s.source_type,
        recordCount: s.record_count,
      })),
    });
  } catch (error) {
    console.error('CSV import error:', error);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

/**
 * GET /api/data/batches
 * List all import batches.
 */
router.get('/batches', authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM import_batches ORDER BY created_at DESC LIMIT 50`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

/**
 * GET /api/data/batches/:id
 * Get batch details with records.
 */
router.get('/batches/:id', authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const { id } = req.params;

    const batchResult = await db.query(
      `SELECT * FROM import_batches WHERE id = $1`,
      [id]
    );

    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const recordsResult = await db.query(
      `SELECT * FROM raw_tb_cases WHERE batch_id = $1 ORDER BY row_number`,
      [id]
    );

    res.json({
      batch: batchResult.rows[0],
      records: recordsResult.rows,
    });
  } catch (error) {
    console.error('Error fetching batch:', error);
    res.status(500).json({ error: 'Failed to fetch batch' });
  }
});

module.exports = router;
```

### 4.4 Validator Service (services/validator.js)

```javascript
// File: PASIG_CLONE/backend/services/validator.js

const db = require('../db');

// Valid barangays in Pasig City
const VALID_BARANGAYS = [
  'bagong ilog', 'bambang', 'buting', 'caniogan', 'dela paz',
  'kalawaan', 'kapasigan', 'kapitolyo', 'malinao', 'manggahan',
  'maybunga', 'oranbo', 'palatiw', 'pinagbuhatan', 'pineda',
  'rosario', 'sagad', 'san antonio', 'san joaquin', 'san jose',
  'san miguel', 'san nicolas', 'santa cruz', 'santa lucia',
  'santa rosa', 'santo tomas', 'santolan', 'sumilang', 'ugong',
];

const VALID_SEX = ['male', 'female'];
const VALID_OUTCOME = [
  'cured', 'treatment completed', 'died', 'treatment failed',
  'lost to follow-up', 'not evaluated', 'on treatment',
];

/**
 * Validate a batch of records.
 * Returns validation results for each record.
 */
async function validateBatch(batchId) {
  const records = await db.query(
    `SELECT * FROM raw_tb_cases WHERE batch_id = $1 ORDER BY row_number`,
    [batchId]
  );

  const results = {
    total: records.rows.length,
    valid: 0,
    invalid: 0,
    warnings: 0,
    errors: [],
    validatedRecords: [],
  };

  for (const record of records.rows) {
    const csvData = record.csv_data;
    const validation = validateRecord(csvData, record.source_type);

    results.validatedRecords.push({
      raw_id: record.id,
      source_type: record.source_type,
      row_number: record.row_number,
      ...csvData,
      is_valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
    });

    if (validation.valid) {
      results.valid++;
    } else {
      results.invalid++;
      results.errors.push({
        row: record.row_number,
        source_type: record.source_type,
        errors: validation.errors,
      });
    }

    if (validation.warnings.length > 0) {
      results.warnings++;
    }
  }

  // Update batch status
  await db.query(
    `UPDATE import_batches
     SET status = 'validated',
         valid_count = $1,
         error_count = $2,
         validated_at = NOW()
     WHERE id = $3`,
    [results.valid, results.invalid, batchId]
  );

  // Store validated records
  for (const record of results.validatedRecords) {
    if (record.is_valid) {
      await db.query(
        `INSERT INTO validated_tb_cases
         (batch_id, source_type, barangay_name, date_of_diagnosis, date_of_notification,
          age, sex, city, screening_facility, treatment_facility, source_of_patient,
          anatomical_site, registration_group, bacteriological_status, date_started_treatment,
          outcome_status, date_of_outcome, record_created_at, date_of_screening,
          validation_status, itis_case_id, is_valid, validation_errors, validation_warnings)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
        [
          batchId, record.source_type, record.barangay_name, record.date_of_diagnosis,
          record.date_of_notification, record.age, record.sex, record.city,
          record.screening_facility, record.treatment_facility, record.source_of_patient,
          record.anatomical_site, record.registration_group, record.bacteriological_status,
          record.date_started_treatment, record.outcome_status, record.date_of_outcome,
          record.record_created_at, record.date_of_screening, record.validation_status,
          record.itis_case_id, record.is_valid, JSON.stringify(record.errors),
          JSON.stringify(record.warnings),
        ]
      );
    }
  }

  return results;
}

/**
 * Validate a single record.
 */
function validateRecord(csvData, sourceType) {
  const errors = [];
  const warnings = [];

  // Required: barangay_name
  if (!csvData.barangay_name || csvData.barangay_name.trim() === '') {
    errors.push('Barangay is required');
  } else if (!VALID_BARANGAYS.includes(csvData.barangay_name.trim().toLowerCase())) {
    errors.push(`Unknown barangay: "${csvData.barangay_name}"`);
  }

  // Required: date_of_diagnosis
  if (!csvData.date_of_diagnosis) {
    errors.push('Date of Diagnosis is required');
  }

  // Required: sex
  if (!csvData.sex || csvData.sex.trim() === '') {
    errors.push('Sex is required');
  } else if (!VALID_SEX.includes(csvData.sex.trim().toLowerCase())) {
    errors.push(`Invalid sex: "${csvData.sex}"`);
  }

  // Age validation (optional but if present, must be 0-120)
  if (csvData.age !== null && csvData.age !== undefined) {
    const age = parseInt(csvData.age);
    if (isNaN(age) || age < 0 || age > 120) {
      errors.push(`Invalid age: "${csvData.age}"`);
    }
  }

  // City validation (should be Pasig)
  if (csvData.city && csvData.city.trim() !== '') {
    if (!csvData.city.toLowerCase().includes('pasig')) {
      warnings.push(`City is "${csvData.city}", expected "Pasig"`);
    }
  }

  // DSTB-specific: validation_status
  if (sourceType === 'DSTB') {
    if (csvData.validation_status) {
      const status = csvData.validation_status.toLowerCase();
      if (!status.includes('validated') && !status.includes('not validated')) {
        warnings.push(`Unknown validation status: "${csvData.validation_status}"`);
      }
    }
  }

  // MN-specific: itis_case_id
  if (sourceType === 'MN') {
    if (!csvData.itis_case_id || csvData.itis_case_id.trim() === '') {
      warnings.push('MN record missing ITIS Case ID');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

module.exports = {
  validateBatch,
  validateRecord,
  VALID_BARANGAYS,
};
```

### 4.5 Webhook Sender Service (services/webhookSender.js)

```javascript
// File: PASIG_CLONE/backend/services/webhookSender.js

const crypto = require('crypto');
const db = require('../db');

/**
 * Send validated data to P2_OFFICIAL via webhook.
 */
async function sendWebhook(batchId) {
  // Get batch info
  const batchResult = await db.query(
    `SELECT * FROM import_batches WHERE id = $1`,
    [batchId]
  );

  if (batchResult.rows.length === 0) {
    throw new Error('Batch not found');
  }

  const batch = batchResult.rows[0];

  if (batch.status !== 'validated') {
    throw new Error('Batch must be validated before sending');
  }

  // Get validated records
  const recordsResult = await db.query(
    `SELECT * FROM validated_tb_cases WHERE batch_id = $1 AND is_valid = true`,
    [batchId]
  );

  // Group by source_type
  const dstbRecords = recordsResult.rows.filter(r => r.source_type === 'DSTB');
  const mnRecords = recordsResult.rows.filter(r => r.source_type === 'MN');

  // Build payload
  const payload = {
    source: 'pasig-clone',
    batch_id: batchId,
    timestamp: new Date().toISOString(),
    sheets: [
      {
        sheet_name: 'DSTB',
        source_type: 'DSTB',
        record_count: dstbRecords.length,
        records: dstbRecords.map(formatRecord),
      },
      {
        sheet_name: 'MN',
        source_type: 'MN',
        record_count: mnRecords.length,
        records: mnRecords.map(formatRecord),
      },
    ],
  };

  // Generate HMAC signature
  const secret = process.env.WEBHOOK_SECRET;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  // Send to P2_OFFICIAL
  const webhookUrl = process.env.P2_OFFICIAL_WEBHOOK_URL;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': secret,
        'X-Webhook-Signature': `sha256=${signature}`,
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await response.text();

    // Log webhook
    await db.query(
      `INSERT INTO webhook_logs (batch_id, payload, status, response_code, response_body)
       VALUES ($1, $2, $3, $4, $5)`,
      [batchId, payload, response.ok ? 'sent' : 'failed', response.status, responseBody]
    );

    // Update batch status
    await db.query(
      `UPDATE import_batches SET status = 'sent', sent_at = NOW() WHERE id = $1`,
      [batchId]
    );

    return {
      success: response.ok,
      status: response.status,
      message: response.ok ? 'Webhook sent successfully' : 'Webhook failed',
    };
  } catch (error) {
    // Log error
    await db.query(
      `INSERT INTO webhook_logs (batch_id, payload, status, error_message)
       VALUES ($1, $2, 'failed', $3)`,
      [batchId, payload, error.message]
    );

    throw error;
  }
}

/**
 * Format a record for the webhook payload.
 */
function formatRecord(record) {
  return {
    barangay_name: record.barangay_name,
    date_of_diagnosis: record.date_of_diagnosis,
    date_of_notification: record.date_of_notification,
    date_of_screening: record.date_of_screening,
    age: record.age,
    sex: record.sex,
    city: record.city,
    screening_facility: record.screening_facility,
    treatment_facility: record.treatment_facility,
    source_of_patient: record.source_of_patient,
    anatomical_site: record.anatomical_site,
    registration_group: record.registration_group,
    bacteriological_status: record.bacteriological_status,
    date_started_treatment: record.date_started_treatment,
    outcome_status: record.outcome_status,
    date_of_outcome: record.date_of_outcome,
    record_created_at: record.record_created_at,
    source_type: record.source_type,
    validation_status: record.validation_status,
    itis_case_id: record.itis_case_id,
  };
}

module.exports = {
  sendWebhook,
};
```

### 4.6 Webhook Route (routes/webhook.js)

```javascript
// File: PASIG_CLONE/backend/routes/webhook.js

const express = require('express');
const router = express.Router();
const { sendWebhook } = require('../services/webhookSender');
const { authorizeRoles } = require('../middleware/auth');

/**
 * POST /api/webhook/send
 * Send validated batch to P2_OFFICIAL.
 */
router.post('/send', authorizeRoles('admin'), async (req, res) => {
  try {
    const { batchId } = req.body;

    if (!batchId) {
      return res.status(400).json({ error: 'batchId is required' });
    }

    const result = await sendWebhook(batchId);

    res.json({
      message: result.message,
      success: result.success,
      status: result.status,
    });
  } catch (error) {
    console.error('Webhook send error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/webhook/logs
 * Get webhook history.
 */
router.get('/logs', authorizeRoles('admin'), async (req, res) => {
  try {
    const db = require('../db');
    const result = await db.query(
      `SELECT wl.*, ib.filename
       FROM webhook_logs wl
       LEFT JOIN import_batches ib ON wl.batch_id = ib.id
       ORDER BY wl.sent_at DESC
       LIMIT 50`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching webhook logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

module.exports = router;
```

### 4.7 Environment Variables (.env)

```bash
# PASIG_CLONE/backend/.env

# Server
PORT=5001
NODE_ENV=development

# Database (same PostgreSQL as P2_OFFICIAL)
DB_USER=postgres
DB_HOST=localhost
DB_NAME=tb_system
DB_PASSWORD=your_password
DB_PORT=5432
DB_SCHEMA=pasig_clone

# JWT
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d

# Webhook
WEBHOOK_SECRET=shared_secret_with_p2_official
P2_OFFICIAL_WEBHOOK_URL=http://localhost:5000/api/webhook/pasig-clone

# Frontend URL
FRONTEND_URL=http://localhost:5174
```

---

## 5. PASIG CLONE FRONTEND

### 5.1 Vite Config (vite.config.js)

```javascript
// File: PASIG_CLONE/frontend/vite.config.js

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:5001',
    },
  },
});
```

### 5.2 Main App (App.jsx)

```jsx
// File: PASIG_CLONE/frontend/src/App.jsx

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import axios from './api/axios';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import CsvImportPage from './pages/CsvImportPage';
import ValidationPage from './pages/ValidationPage';
import WebhookStatusPage from './pages/WebhookStatusPage';

function ProtectedRoute({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      await axios.get('/api/auth/profile');
      setIsAuthenticated(true);
    } catch {
      setIsAuthenticated(false);
    }
  };

  if (isAuthenticated === null) return <div>Loading...</div>;
  if (!isAuthenticated) return <Navigate to="/login" />;
  return children;
}

export default function App() {
  const [currentBatch, setCurrentBatch] = useState(null);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<CsvImportPage onBatchCreated={setCurrentBatch} />} />
                  <Route
                    path="/validate"
                    element={<ValidationPage batch={currentBatch} />}
                  />
                  <Route path="/webhook" element={<WebhookStatusPage />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
```

### 5.3 CSV Import Page (CsvImportPage.jsx)

```jsx
// File: PASIG_CLONE/frontend/src/pages/CsvImportPage.jsx

import { useState } from 'react';
import axios from '../api/axios';

export default function CsvImportPage({ onBatchCreated }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file');
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post('/api/data/csv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setResult(response.data);
      onBatchCreated(response.data.batch);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Import TB Data</h1>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">
            Upload an Excel file exported from the DOH TB-DOTS registry.
            The file should contain two sheets: DSTB and MN.
          </p>
        </div>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files[0])}
            className="hidden"
            id="file-upload"
          />
          <label htmlFor="file-upload" className="cursor-pointer">
            <div className="text-gray-500">
              <p className="text-lg">Click to select file</p>
              <p className="text-sm">Supports .xlsx, .xls, .csv (max 50MB)</p>
            </div>
          </label>
          {file && (
            <p className="mt-4 text-sm text-gray-700">
              Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </div>

        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="mt-4 w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
        >
          {uploading ? 'Uploading...' : 'Upload File'}
        </button>

        {error && (
          <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-4 p-4 bg-green-50 text-green-700 rounded-lg">
            <p className="font-semibold">Upload Successful!</p>
            <p>Batch ID: {result.batch.id}</p>
            <p>Total Records: {result.batch.totalRows}</p>
            <p>DSTB Records: {result.batch.dstbCount}</p>
            <p>MN Records: {result.batch.mnCount}</p>

            <div className="mt-4">
              <a
                href={`/validate?batchId=${result.batch.id}`}
                className="text-blue-600 underline"
              >
                Go to Validation →
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

### 5.4 Validation Page (ValidationPage.jsx)

```jsx
// File: PASIG_CLONE/frontend/src/pages/ValidationPage.jsx

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from '../api/axios';

export default function ValidationPage() {
  const [searchParams] = useSearchParams();
  const batchId = searchParams.get('batchId');

  const [validation, setValidation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (batchId) {
      validateBatch();
    }
  }, [batchId]);

  const validateBatch = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.post(`/api/data/validate/${batchId}`);
      setValidation(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Validation failed');
    } finally {
      setLoading(false);
    }
  };

  if (!batchId) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-gray-600">No batch selected. Please upload a file first.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Data Validation</h1>

      {loading && (
        <div className="text-center py-8">
          <p className="text-gray-600">Validating data...</p>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg mb-4">
          {error}
        </div>
      )}

      {validation && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-gray-600">Total Records</p>
              <p className="text-2xl font-bold">{validation.summary.total}</p>
            </div>
            <div className="bg-green-50 rounded-lg shadow p-4">
              <p className="text-sm text-green-600">Valid</p>
              <p className="text-2xl font-bold text-green-700">{validation.summary.valid}</p>
            </div>
            <div className="bg-red-50 rounded-lg shadow p-4">
              <p className="text-sm text-red-600">Invalid</p>
              <p className="text-2xl font-bold text-red-700">{validation.summary.invalid}</p>
            </div>
            <div className="bg-yellow-50 rounded-lg shadow p-4">
              <p className="text-sm text-yellow-600">Warnings</p>
              <p className="text-2xl font-bold text-yellow-700">{validation.summary.warnings}</p>
            </div>
          </div>

          {/* Errors */}
          {validation.errors.length > 0 && (
            <div className="bg-white rounded-lg shadow p-4 mb-6">
              <h2 className="text-lg font-semibold mb-2 text-red-700">Validation Errors</h2>
              <div className="max-h-64 overflow-y-auto">
                {validation.errors.map((err, idx) => (
                  <div key={idx} className="p-2 border-b text-sm">
                    <span className="font-mono">Row {err.row}</span> ({err.source_type}):
                    <span className="text-red-600 ml-2">{err.errors.join(', ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Send Button */}
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-lg font-semibold mb-2">Send to P2_OFFICIAL</h2>
            <p className="text-sm text-gray-600 mb-4">
              Send {validation.summary.valid} validated records to the main TBInsight system.
            </p>
            <a
              href={`/webhook?batchId=${batchId}`}
              className="inline-block bg-blue-600 text-white py-2 px-6 rounded-lg hover:bg-blue-700"
            >
              Continue to Send →
            </a>
          </div>
        </>
      )}
    </div>
  );
}
```

### 5.5 Webhook Status Page (WebhookStatusPage.jsx)

```jsx
// File: PASIG_CLONE/frontend/src/pages/WebhookStatusPage.jsx

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from '../api/axios';

export default function WebhookStatusPage() {
  const [searchParams] = useSearchParams();
  const batchId = searchParams.get('batchId');

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const response = await axios.get('/api/webhook/logs');
      setLogs(response.data);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  };

  const sendWebhook = async () => {
    if (!batchId) {
      setError('No batch ID provided');
      return;
    }

    setSending(true);
    setError(null);

    try {
      const response = await axios.post('/api/webhook/send', { batchId });
      setResult(response.data);
      fetchLogs(); // Refresh logs
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send webhook');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Send to P2_OFFICIAL</h1>

      {/* Send Section */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Webhook Delivery</h2>

        {batchId ? (
          <>
            <p className="text-gray-600 mb-4">
              Ready to send batch <span className="font-mono">{batchId}</span> to P2_OFFICIAL.
            </p>

            <button
              onClick={sendWebhook}
              disabled={sending}
              className="bg-green-600 text-white py-2 px-6 rounded-lg hover:bg-green-700 disabled:bg-gray-400"
            >
              {sending ? 'Sending...' : 'Send Now'}
            </button>
          </>
        ) : (
          <p className="text-gray-600">No batch selected. Please validate data first.</p>
        )}

        {error && (
          <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        {result && (
          <div className={`mt-4 p-4 rounded-lg ${result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            <p className="font-semibold">{result.message}</p>
            <p>Status Code: {result.status}</p>
          </div>
        )}
      </div>

      {/* Webhook Logs */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Webhook History</h2>

        {logs.length === 0 ? (
          <p className="text-gray-600">No webhook history yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Date</th>
                  <th className="text-left p-2">Batch</th>
                  <th className="text-left p-2">Filename</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Response</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b">
                    <td className="p-2">{new Date(log.sent_at).toLocaleString()}</td>
                    <td className="p-2 font-mono text-xs">{log.batch_id?.substring(0, 8)}...</td>
                    <td className="p-2">{log.filename}</td>
                    <td className="p-2">
                      <span className={`px-2 py-1 rounded ${log.status === 'sent' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="p-2">{log.response_code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## 6. P2_OFFICIAL UPDATES

### 6.1 Updated parseCaseFile.js (Multi-Sheet Support)

```javascript
// File: P2_OFFICIAL/BACKEND/tbinsight/parseCaseFile.js
// UPDATED: Add multi-sheet support

function parseCaseFile(fileBuffer, filename, validBarangays = new Set()) {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });

  const allRows = [];
  const allErrors = [];
  const allWarnings = [];
  let validCount = 0;
  let errorCount = 0;

  // UPDATED: Process ALL sheets
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const normalizedSheet = sheetName.toUpperCase().trim();

    // Determine source_type from sheet name
    const source_type = normalizedSheet.includes('MN') ? 'MN' : 'DSTB';

    // Extract raw headers
    const rawHeaders = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || [];

    // Build column map with source_type awareness
    const columnMap = buildColumnMap(rawHeaders, source_type);

    // Parse data rows
    const rawData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    rawData.forEach((rawRow, index) => {
      const rowNum = index + 2;

      // Map raw row to internal fields
      const mappedRow = {};
      for (const [csvCol, field] of Object.entries(columnMap)) {
        const val = rawRow[csvCol];
        if (val !== undefined && val !== null) {
          mappedRow[field] = val instanceof Date ? val : String(val).trim();
        }
      }

      // Set source_type
      mappedRow.source_type = source_type;

      // Set validation_status based on source_type
      if (source_type === 'DSTB') {
        mappedRow.validation_status = mappedRow.validation_status || null;
      } else {
        mappedRow.validation_status = null; // MN records don't have this
      }

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

      // Normalize sex
      mappedRow.sex = normalizeSex(mappedRow.sex);

      // Trim barangay name
      if (mappedRow.barangay_name) {
        mappedRow.barangay_name = mappedRow.barangay_name.trim();
      }

      // Validate
      const validation = validateRow(mappedRow, validBarangays);

      mappedRow.row_number = rowNum;
      mappedRow.sheet_name = sheetName;
      mappedRow.validation_status = validation.valid ? 'Validated' : 'Not Validated';
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

      allRows.push(mappedRow);
    });
  }

  return {
    rows: allRows,
    errors: allErrors,
    warnings: allWarnings,
    totalRows: allRows.length,
    validCount,
    errorCount,
  };
}

/**
 * UPDATED: Build column map with source_type awareness.
 */
function buildColumnMap(rawHeaders, sourceType) {
  const map = {};

  for (const raw of rawHeaders) {
    const header = String(raw || '');
    const normalized = header.trim().toLowerCase();

    // Skip row-number column
    if (normalized === 'no.' || normalized === 'no') continue;

    // Date fields
    if (normalized.includes('notification') && normalized.includes('date')) {
      map[header] = 'date_of_notification';
    } else if (normalized.includes('screening') && normalized.includes('date')) {
      map[header] = 'date_of_screening';
    } else if (normalized.includes('diagnosis') && normalized.includes('date')) {
      map[header] = 'date_of_diagnosis';
    } else if (normalized.includes('treatment') && normalized.includes('started')) {
      map[header] = 'date_started_treatment';
    } else if (normalized.includes('outcome') && normalized.includes('date')) {
      map[header] = 'date_of_outcome';
    } else if (normalized.includes('record') && normalized.includes('created')) {
      map[header] = 'record_created_at';
    }
    // Simple fields
    else if (normalized === 'age') {
      map[header] = 'age';
    } else if (normalized === 'sex') {
      map[header] = 'sex';
    } else if (normalized.includes('barangay') || normalized === 'brgy') {
      map[header] = 'barangay_name';
    } else if (normalized.includes('city') || normalized.includes('municipality')) {
      map[header] = 'city';
    }
    // Facility fields
    else if (normalized.includes('treatment') && (normalized.includes('health') || normalized.includes('facility'))) {
      map[header] = 'treatment_facility';
    } else if (normalized.includes('screening') && (normalized.includes('health') || normalized.includes('facility'))) {
      map[header] = 'screening_facility';
    }
    // Other fields
    else if (normalized.includes('source') && normalized.includes('patient')) {
      map[header] = 'source_of_patient';
    } else if (normalized.includes('anatomical')) {
      map[header] = 'anatomical_site';
    } else if (normalized.includes('registration')) {
      map[header] = 'registration_group';
    } else if (normalized.includes('bacteriological')) {
      map[header] = 'bacteriological_status';
    } else if (normalized.includes('outcome') && !normalized.includes('date')) {
      map[header] = 'outcome_status';
    }
    // DSTB-specific
    else if (normalized.includes('validation')) {
      map[header] = 'validation_status';
    }
    // MN-specific: ITIS Lite Case No.
    else if ((normalized.includes('itis') || normalized.includes('lite')) && normalized.includes('case')) {
      map[header] = 'itis_case_id';
    }
  }

  return map;
}
```

### 6.2 New Webhook Endpoint (tbinsight/webhook.js)

```javascript
// File: P2_OFFICIAL/BACKEND/tbinsight/webhook.js

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { validateRow } = require('./parseCaseFile');
const { rebuildAggregations } = require('./aggregateMonthly');

/**
 * POST /api/webhook/pasig-clone
 * Receive webhook from Pasig Clone system.
 */
router.post('/pasig-clone', async (req, res) => {
  try {
    // Verify signature
    const signature = req.headers['x-webhook-signature'];
    const secret = req.headers['x-webhook-secret'];

    if (!verifySignature(req.body, signature, secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { source, batch_id, timestamp, sheets } = req.body;

    // Validate payload structure
    if (source !== 'pasig-clone' || !sheets || !Array.isArray(sheets)) {
      return res.status(400).json({ error: 'Invalid payload structure' });
    }

    // Get valid barangays for validation
    const barangaysResult = await db.query('SELECT name FROM barangays');
    const validBarangays = new Set(barangaysResult.rows.map(r => r.name.toLowerCase()));

    let totalRecords = 0;
    let importedCount = 0;
    let errorCount = 0;
    const errors = [];

    // Process each sheet
    for (const sheet of sheets) {
      const { source_type, records } = sheet;

      for (const record of records) {
        totalRecords++;

        // Add source_type to record
        record.source_type = source_type;

        // Validate record
        const validation = validateRow(record, validBarangays);

        if (validation.valid) {
          // Insert into tb_cases
          await db.query(
            `INSERT INTO tb_cases
             (barangay_name, date_of_diagnosis, date_of_notification, date_of_screening,
              age, sex, city, screening_facility, treatment_facility, source_of_patient,
              anatomical_site, registration_group, bacteriological_status, date_started_treatment,
              outcome_status, date_of_outcome, record_created_at, source_type,
              validation_status, itis_case_id, location_classification)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
            [
              record.barangay_name,
              record.date_of_diagnosis,
              record.date_of_notification,
              record.date_of_screening,
              record.age,
              record.sex,
              record.city,
              record.screening_facility,
              record.treatment_facility,
              record.source_of_patient,
              record.anatomical_site,
              record.registration_group,
              record.bacteriological_status,
              record.date_started_treatment,
              record.outcome_status,
              record.date_of_outcome,
              record.record_created_at,
              source_type,
              record.validation_status,
              record.itis_case_id,
              'Pasig City', // Default for Pasig Clone data
            ]
          );

          importedCount++;
        } else {
          errorCount++;
          errors.push({
            row: record.row_number,
            source_type,
            errors: validation.errors,
          });
        }
      }
    }

    // Rebuild aggregations if any records were imported
    if (importedCount > 0) {
      await rebuildAggregations();
    }

    // Log webhook
    await db.query(
      `INSERT INTO webhook_logs (source, batch_id, payload, status, records_received, records_imported)
       VALUES ($1, $2, $3, 'processed', $4, $5)`,
      [source, batch_id, req.body, totalRecords, importedCount]
    );

    res.json({
      success: true,
      message: `Webhook processed: ${importedCount} records imported, ${errorCount} errors`,
      totalRecords,
      importedCount,
      errorCount,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined, // Return first 10 errors
    });
  } catch (error) {
    console.error('Webhook processing error:', error);

    // Log failed webhook
    await db.query(
      `INSERT INTO webhook_logs (source, batch_id, payload, status, error_message)
       VALUES ($1, $2, $3, 'failed', $4)`,
      [req.body.source, req.body.batch_id, req.body, error.message]
    );

    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Verify HMAC signature.
 */
function verifySignature(payload, signature, secret) {
  if (!signature || !secret) return false;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature.replace('sha256=', '')),
    Buffer.from(expectedSignature)
  );
}

module.exports = router;
```

### 6.3 Webhook Auth Middleware (middleware/webhookAuth.js)

```javascript
// File: P2_OFFICIAL/BACKEND/middleware/webhookAuth.js

const crypto = require('crypto');

/**
 * Middleware to verify webhook signature.
 */
function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-webhook-signature'];
  const secret = req.headers['x-webhook-secret'];

  if (!signature || !secret) {
    return res.status(401).json({ error: 'Missing webhook credentials' });
  }

  // Verify secret matches
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  // Verify HMAC signature
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  const providedSignature = signature.replace('sha256=', '');

  if (!crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

module.exports = { verifyWebhookSignature };
```

### 6.4 Database Migration (007_webhook_logs.sql)

```sql
-- File: P2_OFFICIAL/BACKEND/db/migrations/007_webhook_logs.sql

-- Webhook logs for tracking received webhooks
CREATE TABLE IF NOT EXISTS webhook_logs (
    id SERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    batch_id UUID,
    payload JSONB,
    status TEXT DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed')),
    records_received INTEGER DEFAULT 0,
    records_imported INTEGER DEFAULT 0,
    error_message TEXT,
    received_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_source ON webhook_logs(source);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_received ON webhook_logs(received_at);
```

### 6.5 Updated server.js

```javascript
// File: P2_OFFICIAL/BACKEND/server.js
// UPDATED: Mount webhook route

const webhookRoutes = require('./tbinsight/webhook');

// ... existing code ...

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/tb', tbRoutes);
app.use('/api/webhook', webhookRoutes); // NEW: Webhook endpoint

// ... existing code ...
```

---

## 7. WEBHOOK INTEGRATION

### 7.1 Complete Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: Upload Excel to Pasig Clone                           │
│  POST /api/data/csv                                            │
│  - Parse both DSTB + MN sheets                                 │
│  - Store raw records in raw_tb_cases                           │
│  - Return batch ID                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: Validate Batch                                        │
│  POST /api/data/validate/:batchId                              │
│  - Run validation rules                                        │
│  - Store valid records in validated_tb_cases                   │
│  - Return validation summary                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: Send Webhook                                          │
│  POST /api/webhook/send                                        │
│  - Build payload with source_type per record                   │
│  - Generate HMAC-SHA256 signature                              │
│  - POST to P2_OFFICIAL                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: Receive at P2_OFFICIAL                                │
│  POST /api/webhook/pasig-clone                                 │
│  - Verify HMAC signature                                       │
│  - Parse payload (DSTB + MN records)                           │
│  - Insert into tb_cases with source_type                       │
│  - Rebuild aggregations                                        │
│  - Log webhook                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 5: Run ML Pipeline (Manual Trigger)                      │
│  POST /api/tb/pipeline                                         │
│  - ARIMA forecasting                                           │
│  - Random Forest classification                                │
│  - Risk scoring                                                │
│  - Alert generation                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Payload Structure

```json
{
  "source": "pasig-clone",
  "batch_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-09-04T10:30:00Z",
  "sheets": [
    {
      "sheet_name": "DSTB",
      "source_type": "DSTB",
      "record_count": 150,
      "records": [
        {
          "barangay_name": "San Antonio",
          "date_of_diagnosis": "2025-02-06",
          "date_of_notification": "2025-02-06",
          "date_of_screening": "2025-02-06",
          "age": 31,
          "sex": "Male",
          "city": "Pasig City",
          "screening_facility": "SAN ANTONIO HEALTH CENTER - IDOTS",
          "treatment_facility": null,
          "source_of_patient": "PRIVATE FACILITY",
          "anatomical_site": "Pulmonary",
          "registration_group": "NEW",
          "bacteriological_status": "Clinically-diagnosed TB",
          "date_started_treatment": null,
          "outcome_status": "DIAGNOSED",
          "date_of_outcome": "2025-02-06",
          "record_created_at": "2025-04-25T11:51:23Z",
          "source_type": "DSTB",
          "validation_status": "Not Validated",
          "itis_case_id": null
        }
      ]
    },
    {
      "sheet_name": "MN",
      "source_type": "MN",
      "record_count": 25,
      "records": [
        {
          "barangay_name": "Bambang",
          "date_of_diagnosis": "2025-01-14",
          "date_of_notification": "2025-01-14",
          "date_of_screening": null,
          "age": 67,
          "sex": "Male",
          "city": "Pasig City",
          "screening_facility": "BAMBANG HEALTH CENTER - IDOTS",
          "treatment_facility": "BAMBANG HEALTH CENTER - IDOTS",
          "source_of_patient": "PRIVATE FACILITY",
          "anatomical_site": "Pulmonary",
          "registration_group": "NEW",
          "bacteriological_status": "Clinically-diagnosed TB",
          "date_started_treatment": "2025-01-14",
          "outcome_status": "TREATMENT COMPLETED",
          "date_of_outcome": "2025-06-19",
          "record_created_at": "2025-01-16T15:11:46Z",
          "source_type": "MN",
          "validation_status": null,
          "itis_case_id": "ITIS-2025-001"
        }
      ]
    }
  ]
}
```

---

## 8. TESTING STRATEGY

### 8.1 Unit Tests

```javascript
// File: PASIG_CLONE/backend/test/multiSheetParser.test.js

const { parseMultiSheetExcel, parseDate, normalizeSex } = require('../services/multiSheetParser');

describe('Multi-Sheet Parser', () => {
  test('should parse date in "February 06, 2025" format', () => {
    expect(parseDate('February 06, 2025')).toBe('2025-02-06');
  });

  test('should normalize sex values', () => {
    expect(normalizeSex('M')).toBe('Male');
    expect(normalizeSex('F')).toBe('Female');
    expect(normalizeSex('male')).toBe('Male');
  });
});
```

### 8.2 Integration Tests

```javascript
// File: P2_OFFICIAL/BACKEND/test/webhook.test.js

const request = require('supertest');
const app = require('../server');

describe('Webhook Endpoint', () => {
  test('POST /api/webhook/pasig-clone should receive valid payload', async () => {
    const payload = {
      source: 'pasig-clone',
      batch_id: 'test-batch-id',
      timestamp: new Date().toISOString(),
      sheets: [
        {
          sheet_name: 'DSTB',
          source_type: 'DSTB',
          record_count: 1,
          records: [
            {
              barangay_name: 'San Antonio',
              date_of_diagnosis: '2025-02-06',
              sex: 'Male',
              source_type: 'DSTB',
            },
          ],
        },
      ],
    };

    const response = await request(app)
      .post('/api/webhook/pasig-clone')
      .set('X-Webhook-Secret', process.env.WEBHOOK_SECRET)
      .set('X-Webhook-Signature', generateSignature(payload))
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
```

---

## 9. DEPLOYMENT

### 9.1 Render Configuration (render.yaml)

```yaml
# File: render.yaml

services:
  # Pasig Clone Backend
  - type: web
    name: pasig-clone-backend
    runtime: node
    plan: free
    buildCommand: cd PASIG_CLONE/backend && npm install
    startCommand: cd PASIG_CLONE/backend && node server.js
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: tb-system-db
          property: connectionString
      - key: JWT_SECRET
        generateValue: true
      - key: WEBHOOK_SECRET
        generateValue: true
      - key: P2_OFFICIAL_WEBHOOK_URL
        value: https://p2-official.onrender.com/api/webhook/pasig-clone

  # Pasig Clone Frontend
  - type: web
    name: pasig-clone-frontend
    runtime: node
    plan: free
    buildCommand: cd PASIG_CLONE/frontend && npm install && npm run build
    startCommand: cd PASIG_CLONE/frontend && npm run preview
    envVars:
      - key: VITE_API_URL
        value: https://pasig-clone-backend.onrender.com

databases:
  - name: tb-system-db
    plan: free
    databaseName: tb_system
```

### 9.2 Environment Variables

**Pasig Clone (.env)**
```
PORT=5001
DATABASE_URL=<from_render>
JWT_SECRET=<generated>
WEBHOOK_SECRET=<generated>
P2_OFFICIAL_WEBHOOK_URL=https://p2-official.onrender.com/api/webhook/pasig-clone
FRONTEND_URL=https://pasig-clone-frontend.onrender.com
```

**P2_OFFICIAL (.env)**
```
WEBHOOK_SECRET=<same_as_pasig_clone>
```

---

## 10. IMPLEMENTATION CHECKLIST

### Week 1: Project Setup
- [ ] Create monorepo structure
- [ ] Initialize Pasig Clone backend (Express)
- [ ] Initialize Pasig Clone frontend (React + Vite)
- [ ] Set up PostgreSQL database with schemas
- [ ] Configure environment variables

### Week 2: Pasig Clone Backend
- [ ] Implement multi-sheet parser (multiSheetParser.js)
- [ ] Implement CSV import route (csvImport.js)
- [ ] Implement validator service (validator.js)
- [ ] Implement webhook sender (webhookSender.js)
- [ ] Implement webhook route (webhook.js)
- [ ] Implement authentication (auth.js, middleware)

### Week 3: Pasig Clone Frontend
- [ ] Create login page
- [ ] Create CSV import page
- [ ] Create validation page
- [ ] Create webhook status page
- [ ] Set up routing and auth

### Week 4: P2_OFFICIAL Updates
- [ ] Update parseCaseFile.js for multi-sheet support
- [ ] Create webhook endpoint (webhook.js)
- [ ] Create webhook auth middleware
- [ ] Create database migration (007_webhook_logs.sql)
- [ ] Update server.js to mount webhook route

### Week 5: Testing & Integration
- [ ] Unit tests for parser and validator
- [ ] Integration tests for webhook flow
- [ ] End-to-end testing
- [ ] Fix bugs and issues

### Week 6: Deployment
- [ ] Deploy Pasig Clone to Render
- [ ] Deploy P2_OFFICIAL updates
- [ ] Configure webhook URLs
- [ ] Test production flow
- [ ] Document API endpoints

---

## DOCUMENT HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-09-04 | System | Initial implementation plan |

---

**END OF IMPLEMENTATION PLAN**
