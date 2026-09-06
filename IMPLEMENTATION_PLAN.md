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
│  Database: Separate PostgreSQL Database (pasig_clone_db)                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  BACKEND (Express.js)                                               │   │
│  │                                                                      │   │
│  │  POST /api/data/import          - Upload Excel (2 sheets)              │   │
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
                                     │ Header: X-Webhook-Signature: sha256=<hmac>
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  P2_OFFICIAL SYSTEM (Existing)                                              │
│  Port: 3000 (backend), 5173 (frontend)                                     │
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
P2_OFFICIAL/                                           # Root (Git repo)
│
├── package.json                                       # npm workspace root
├── render.yaml                                        # Deployment config
├── vercel.json                                        # Frontend deployment
├── IMPLEMENTATION_PLAN.md                             # This file
│
├── PASIG_CLONE/                                       # NEW SYSTEM
│   │
│   ├── backend/                                       # Express.js
│   │   ├── server.js                                  # Entry point (port 5001)
│   │   ├── init.sql                                   # Schema creation (5 tables)
│   │   ├── .env                                       # Environment variables
│   │   ├── .env.example                               # Template
│   │   ├── package.json                               # Dependencies (exceljs, etc.)
│   │   │
│   │   ├── config/
│   │   │   └── index.js                               # Centralized env config
│   │   │
│   │   ├── db/
│   │   │   └── pasigSchema.js                         # PostgreSQL pool + CRUD helpers
│   │   │
│   │   ├── routes/
│   │   │   ├── auth.js                                # JWT authentication (4 endpoints)
│   │   │   ├── csvImport.js                           # Excel upload + batch tracking
│   │   │   ├── validation.js                          # Batch validation
│   │   │   └── webhook.js                             # Send to TBInsight
│   │   │
│   │   ├── middleware/
│   │   │   └── auth.js                                # JWT verification + roles
│   │   │
│   │   ├── services/
│   │   │   ├── multiSheetParser.js                    # Parse DSTB + MN sheets (ExcelJS)
│   │   │   ├── validator.js                           # Validation rules (30 barangays)
│   │   │   └── webhookSender.js                       # HTTP client + HMAC + retry
│   │   │
│   │   └── test/
│   │       └── multiSheetParser.test.js               # Unit tests (node:test)
│   │
│   ├── frontend/                                      # React 18 + Vite 5
│   │   ├── src/
│   │   │   ├── main.jsx                               # Entry point
│   │   │   ├── App.jsx                                # Router (nested routes)
│   │   │   ├── index.css                              # Tailwind v4 import
│   │   │   │
│   │   │   ├── api/
│   │   │   │   └── axios.js                           # Axios instance + interceptors
│   │   │   │
│   │   │   ├── pages/
│   │   │   │   ├── LoginPage.jsx                      # Login form
│   │   │   │   ├── CsvImportPage.jsx                  # Upload Excel
│   │   │   │   ├── ValidationPage.jsx                 # Review validation
│   │   │   │   └── WebhookStatusPage.jsx              # Send status
│   │   │   │
│   │   │   └── components/
│   │   │       ├── Layout.jsx                         # Nav + content layout
│   │   │       └── ProtectedRoute.jsx                 # Auth guard (Outlet pattern)
│   │   │
│   │   ├── index.html
│   │   ├── vite.config.js
│   │   └── package.json
│   │
│   └── README.md
│
└── P2_OFFICIAL/                                       # EXISTING SYSTEM
    ├── BACKEND/
    │   ├── server.js                                  # UPDATED: Mount webhook route
    │   ├── tbinsight/
    │   │   ├── webhook.js                             # NEW: Webhook endpoint
    │   │   ├── parseCaseFile.js                       # UPDATED: Multi-sheet + detectSheetType
    │   │   ├── importCases.js                         # UPDATED: source_type
    │   │   └── ... (existing files)
    │   ├── middleware/
    │   │   └── webhookAuth.js                         # NEW: HMAC verification
    │   └── db/
    │       └── migrations/
    │           └── 007_webhook_logs.sql               # NEW: Webhook log table + idempotency index
    │
    ├── FRONTEND/                                      # (existing, no changes)
    └── ML_SERVICE/                                    # (existing, no changes)
```

### Key Differences from Plan

| Aspect | Plan | Actual |
|---|---|---|
| **Database layer** | `db.js` (raw pool) | `db/pasigSchema.js` (pool + CRUD helpers) |
| **Config** | Direct `process.env` | `config/index.js` (centralized) |
| **Parser library** | `xlsx` (SheetJS) | `exceljs` (async, row-based) |
| **Frontend routing** | `children` prop pattern | `<Outlet />` nested routes |
| **State management** | Lifted to `App.jsx` | URL query params (`?batchId=...`) |
| **Tailwind config** | `tailwind.config.js` | CSS-based (Tailwind v4) |
| **Webhook security** | `X-Webhook-Secret` header | HMAC-only (no raw secret) |
| **Webhook reliability** | No retry/timeout | 30s timeout + 2 retries |
| **Validation logic** | Reject all unknown barangays | Pasig-only validation, non-Pasig warned |
| **Tests** | Jest | `node:test` + `assert/strict` |

---

## 3. DATABASE DESIGN

### 3.1 Separate PostgreSQL Databases

```
┌─────────────────────────────────────────────┐
│  TBInsight Database (neondb)                │
│  Schema: public                             │
│                                             │
│  ├── barangays                              │
│  ├── health_facilities                      │
│  ├── tb_cases_raw                           │
│  ├── tb_cases                               │
│  ├── monthly_case_summary                   │
│  ├── demographic_summary                    │
│  ├── outcome_summary                        │
│  ├── facility_summary                       │
│  ├── bacteriological_summary                │
│  ├── model_predictions                      │
│  ├── barangay_risk_scores                   │
│  ├── alerts                                 │
│  ├── model_metadata                         │
│  ├── interventions                          │
│  ├── users                                  │
│  └── webhook_logs (NEW)                     │
└─────────────────────────────────────────────┘
                    │
                    │ REST API / Webhook
                    │ (HMAC-SHA256 signed)
                    ▼
┌─────────────────────────────────────────────┐
│  Pasig Clone Database (pasig_clone_db)      │
│  Schema: public                             │
│                                             │
│  ├── users                                  │
│  ├── import_batches                         │
│  ├── raw_tb_cases                           │
│  ├── validated_tb_cases                     │
│  └── webhook_logs                           │
└─────────────────────────────────────────────┘
```

### 3.2 Pasig Clone Schema (init.sql)

```sql
-- Pasig Clone Database Schema
-- File: PASIG_CLONE/backend/init.sql
-- NOTE: Uses password_hash (not password) for clarity.

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,              -- Renamed from 'password' for clarity
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

-- Indexes (all idempotent with IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_raw_cases_batch ON raw_tb_cases(batch_id);
CREATE INDEX IF NOT EXISTS idx_validated_cases_batch ON validated_tb_cases(batch_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_batch ON webhook_logs(batch_id);
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
// Uses centralized config + async schema initialization

require('dotenv').config();

// Validate required environment variables
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'WEBHOOK_SECRET', 'TBINSIGHT_WEBHOOK_URL'];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { initSchema } = require('./db/pasigSchema');

const authRoutes = require('./routes/auth');
const csvImportRoutes = require('./routes/csvImport');
const validationRoutes = require('./routes/validation');
const webhookRoutes = require('./routes/webhook');

const app = express();

app.use(cors({
  origin: ['http://localhost:5174', config.frontendUrl],
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/data', csvImportRoutes);
app.use('/api/data', validationRoutes);
app.use('/api/webhook', webhookRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'pasig-clone', timestamp: new Date().toISOString() });
});

async function start() {
  try {
    await initSchema();  // Runs init.sql on startup (idempotent)
    app.listen(config.port, () => {
      console.log(`Pasig Clone backend running on port ${config.port}`);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();

module.exports = app;
```

### 4.2 Config Module (config/index.js)

```javascript
// File: PASIG_CLONE/backend/config/index.js
// Centralizes all environment variable access

require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '5001', 10),
  db: {
    connectionString: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  webhook: {
    url: process.env.TBINSIGHT_WEBHOOK_URL,
    secret: process.env.WEBHOOK_SECRET,
  },
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5174',
};
```

### 4.3 Database Layer (db/pasigSchema.js)

```javascript
// File: PASIG_CLONE/backend/db/pasigSchema.js
// PostgreSQL pool + CRUD helpers + schema initialization

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => {
  console.error('[pasig-clone] Unexpected pool error:', err.message);
});

// Execute multi-statement SQL by splitting on statement boundaries
const execSql = async (sqlContent) => {
  const client = await pool.connect();
  try {
    const cleaned = sqlContent
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');

    const statements = cleaned
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const stmt of statements) {
      await client.query(stmt);
    }
  } finally {
    client.release();
  }
};

async function initSchema() {
  const initSqlPath = path.join(__dirname, '..', 'init.sql');
  if (fs.existsSync(initSqlPath)) {
    const sql = fs.readFileSync(initSqlPath, 'utf8');
    await execSql(sql);
    console.log('[pasig-clone] Tables initialized from init.sql');
  } else {
    console.warn('[pasig-clone] init.sql not found, skipping schema initialization');
  }
}

// --- CRUD Helpers ---

function insertBatch(filename, uploadedBy, totalRows, dstbCount, mnCount) {
  return pool.query(
    `INSERT INTO import_batches (filename, uploaded_by, total_rows, dstb_count, mn_count)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [filename, uploadedBy, totalRows, dstbCount, mnCount]
  );
}

function insertRawCase(batchId, sheetName, sourceType, rowNumber, csvData) {
  return pool.query(
    `INSERT INTO raw_tb_cases (batch_id, sheet_name, source_type, row_number, csv_data)
     VALUES ($1, $2, $3, $4, $5)`,
    [batchId, sheetName, sourceType, rowNumber, csvData]
  );
}

function insertValidatedCase(batchId, record) {
  return pool.query(
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

function updateBatchValidation(batchId, validCount, errorCount) {
  return pool.query(
    `UPDATE import_batches
     SET status = 'validated', valid_count = $1, error_count = $2, validated_at = NOW()
     WHERE id = $3`,
    [validCount, errorCount, batchId]
  );
}

function updateBatchSent(batchId) {
  return pool.query(
    `UPDATE import_batches SET status = 'sent', sent_at = NOW() WHERE id = $1`,
    [batchId]
  );
}

function getBatch(batchId) {
  return pool.query(`SELECT * FROM import_batches WHERE id = $1`, [batchId]);
}

function getRawCases(batchId) {
  return pool.query(
    `SELECT * FROM raw_tb_cases WHERE batch_id = $1 ORDER BY row_number`,
    [batchId]
  );
}

function getValidatedCases(batchId) {
  return pool.query(
    `SELECT * FROM validated_tb_cases WHERE batch_id = $1 AND is_valid = true`,
    [batchId]
  );
}

function deleteValidatedCases(batchId) {
  return pool.query(
    `DELETE FROM validated_tb_cases WHERE batch_id = $1`,
    [batchId]
  );
}

function getBatches() {
  return pool.query(
    `SELECT * FROM import_batches ORDER BY created_at DESC LIMIT 50`
  );
}

function logWebhook(batchId, payload, status, responseCode, responseBody) {
  return pool.query(
    `INSERT INTO webhook_logs (batch_id, payload, status, response_code, response_body)
     VALUES ($1, $2, $3, $4, $5)`,
    [batchId, JSON.stringify(payload), status, responseCode, responseBody]
  );
}

function logWebhookError(batchId, payload, errorMessage) {
  return pool.query(
    `INSERT INTO webhook_logs (batch_id, payload, status, error_message)
     VALUES ($1, $2, 'failed', $3)`,
    [batchId, JSON.stringify(payload), errorMessage]
  );
}

function getWebhookLogs() {
  return pool.query(
    `SELECT wl.*, ib.filename
     FROM webhook_logs wl
     LEFT JOIN import_batches ib ON wl.batch_id = ib.id
     ORDER BY wl.sent_at DESC
     LIMIT 50`
  );
}

module.exports = {
  pool,
  initSchema,
  insertBatch,
  insertRawCase,
  insertValidatedCase,
  deleteValidatedCases,
  updateBatchValidation,
  updateBatchSent,
  getBatch,
  getRawCases,
  getValidatedCases,
  getBatches,
  logWebhook,
  logWebhookError,
  getWebhookLogs,
};
```

### 4.4 Multi-Sheet Parser (services/multiSheetParser.js)

```javascript
// File: PASIG_CLONE/backend/services/multiSheetParser.js
// Uses ExcelJS (async) instead of xlsx (SheetJS)

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

    // Date fields
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
    }
    // Simple fields
    else if (normalized === 'age') {
      map[i] = 'age';
    } else if (normalized === 'sex') {
      map[i] = 'sex';
    } else if (normalized.includes('barangay') || normalized === 'brgy') {
      map[i] = 'barangay_name';
    } else if (normalized.includes('city') || normalized.includes('municipality')) {
      map[i] = 'city';
    }
    // Facility fields
    else if (normalized.includes('treatment') && (normalized.includes('health') || normalized.includes('facility'))) {
      map[i] = 'treatment_facility';
    } else if (normalized.includes('screening') && (normalized.includes('health') || normalized.includes('facility'))) {
      map[i] = 'screening_facility';
    }
    // Other fields
    else if (normalized.includes('source') && normalized.includes('patient')) {
      map[i] = 'source_of_patient';
    } else if (normalized.includes('anatomical')) {
      map[i] = 'anatomical_site';
    } else if (normalized.includes('registration')) {
      map[i] = 'registration_group';
    } else if (normalized.includes('bacteriological')) {
      map[i] = 'bacteriological_status';
    } else if (normalized.includes('outcome') && !normalized.includes('date')) {
      map[i] = 'outcome_status';
    }
    // DSTB-specific
    else if (normalized.includes('validation') && sourceType === 'DSTB') {
      map[i] = 'validation_status';
    }
    // MN-specific
    else if (normalized.includes('itis') && normalized.includes('lite')) {
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

  // Try ISO format
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`;
  }

  // Try written month format: "February 06, 2025"
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

  // Fallback: try Date parser
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
    if (!sourceType) return; // Skip unknown sheets

    // Scan first 5 rows to find header row (starts with "No." or "ITIS")
    let headerRowIndex = null;
    for (let r = 1; r <= Math.min(5, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      const firstCell = row.getCell(1).text;
      if (firstCell && (firstCell.trim() === 'No.' || firstCell.trim().toUpperCase().includes('ITIS'))) {
        headerRowIndex = r;
        break;
      }
    }

    if (!headerRowIndex) return; // No header found

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
```

**Key differences from plan:**
- Uses `exceljs` (async) instead of `xlsx` (sync)
- `parseMultiSheetExcel()` is `async` — must be awaited
- `detectSheetType()` is exported as standalone function
- `buildColumnMap()` uses integer column indices (not string keys)
- Header detection scans first 5 rows (not assumed row 1)
- Exports `detectSheetType`, does NOT export `mapRow`

### 4.5 CSV Import Route (routes/csvImport.js)

```javascript
// File: PASIG_CLONE/backend/routes/csvImport.js
// Uses db helpers instead of raw SQL queries

const express = require('express');
const router = express.Router();
const fileUpload = require('express-fileupload');
const { parseMultiSheetExcel } = require('../services/multiSheetParser');
const db = require('../db/pasigSchema');
const { authorizeRoles } = require('../middleware/auth');

router.use(fileUpload());

/**
 * POST /api/data/import
 * Upload Excel file with DSTB and MN sheets.
 */
router.post('/import', authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.files.file;
    const maxSize = 50 * 1024 * 1024; // 50MB

    if (file.size > maxSize) {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }

    // Validate file extension — only .xlsx and .xls are supported
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls'].includes(ext)) {
      return res.status(400).json({ error: 'Unsupported file type. Only .xlsx and .xls files are accepted.' });
    }

    // Parse multi-sheet Excel (async)
    const parsed = await parseMultiSheetExcel(file.data, file.name);

    // Warn if expected sheets are missing
    const warnings = [];
    if (parsed.dstbCount === 0) warnings.push('Required DSTB sheet missing');
    if (parsed.mnCount === 0) warnings.push('Required MN sheet missing');

    // Create import batch
    const batchResult = await db.insertBatch(
      file.name,
      req.user.id,
      parsed.totalRecords,
      parsed.dstbCount,
      parsed.mnCount
    );

    const batchId = batchResult.rows[0].id;

    // Store raw records
    for (const sheet of parsed.sheets) {
      for (const record of sheet.records) {
        await db.insertRawCase(batchId, sheet.sheet_name, sheet.source_type, record.row_number, record);
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
      warnings: warnings.length > 0 ? warnings : undefined,
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
    const result = await db.getBatches();
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

    const batchResult = await db.getBatch(id);
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const recordsResult = await db.getRawCases(id);

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

**Key differences from plan:**
- Route path is `POST /import` (not `/csv`)
- Uses `db.insertBatch()` and `db.insertRawCase()` helpers
- Validates file extension (`.xlsx` / `.xls` only)
- Returns `warnings` array when sheets are missing
- `parseMultiSheetExcel()` is `await`ed (async)

### 4.6 Validator Service (services/validator.js)

```javascript
// File: PASIG_CLONE/backend/services/validator.js
// Key differences from plan:
// - getValidBarangays() is async (returns Set, includes "kapasigan extension")
// - Non-Pasig records are warned (not rejected)
// - Validation idempotency (delete before re-insert)

const db = require('../db/pasigSchema');

const VALID_SEX = ['male', 'female'];
const VALID_OUTCOME = [
  'cured', 'treatment completed', 'died', 'treatment failed',
  'lost to follow-up', 'not evaluated', 'on treatment',
];

async function getValidBarangays() {
  // Hardcoded list of 30 Pasig barangays (includes "kapasigan extension")
  return new Set([
    'bagong ilog', 'bambang', 'buting', 'caniogan', 'dela paz',
    'kalawaan', 'kapasigan', 'kapasigan extension', 'kapitolyo', 'malinao', 'manggahan',
    'maybunga', 'oranbo', 'palatiw', 'pinagbuhatan', 'pineda',
    'rosario', 'sagad', 'san antonio', 'san joaquin', 'san jose',
    'san miguel', 'san nicolas', 'santa cruz', 'santa lucia',
    'santa rosa', 'santo tomas', 'santolan', 'sumilang', 'ugong',
  ]);
}

async function validateBatch(batchId) {
  const records = await db.getRawCases(batchId);
  const validBarangays = await getValidBarangays();

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
    const validation = validateRecord(csvData, record.source_type, validBarangays);

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
  await db.updateBatchValidation(batchId, results.valid, results.invalid);

  // Idempotency: delete existing validated records before re-inserting
  await db.deleteValidatedCases(batchId);

  // Store validated records
  for (const record of results.validatedRecords) {
    if (record.is_valid) {
      await db.insertValidatedCase(batchId, record);
    }
  }

  return results;
}

function validateRecord(csvData, sourceType, validBarangays) {
  const errors = [];
  const warnings = [];

  // Determine if this is a Pasig City record based on city field
  const normalizedCity = (csvData.city || '').trim().toLowerCase();
  const isPasig = normalizedCity === 'pasig city' || normalizedCity === 'pasig';

  // Required: barangay_name
  if (!csvData.barangay_name || csvData.barangay_name.trim() === '') {
    errors.push('Barangay is required');
  } else if (isPasig && !validBarangays.has(csvData.barangay_name.trim().toLowerCase())) {
    // Only reject unknown barangays for Pasig City records
    errors.push(`Unknown barangay: "${csvData.barangay_name}"`);
  } else if (!isPasig) {
    // Non-Pasig records: retain but warn — excluded from Pasig analytics
    warnings.push(`Non-Pasig record: city="${csvData.city}", barangay="${csvData.barangay_name}"`);
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
  getValidBarangays,
};
```

**Key differences from plan:**
- `getValidBarangays()` is async (returns `Set` with 30 barangays including "kapasigan extension")
- `validateRecord()` takes `validBarangays` as third parameter
- Non-Pasig records are warned (not rejected) — allows importing data from other cities
- `deleteValidatedCases()` called before re-inserting (validation idempotency)
- Uses `db.insertValidatedCase()` helper instead of raw SQL

### 4.7 Webhook Sender Service (services/webhookSender.js)

```javascript
// File: PASIG_CLONE/backend/services/webhookSender.js
// Key improvements over plan:
// - Uses node-fetch with 30s timeout + 2 retries for 5xx/network
// - Only sends X-Webhook-Signature (no raw secret header)
// - Adds schema_version to payload
// - Uses config module for env vars

const crypto = require('crypto');
const fetch = require('node-fetch');
const config = require('../config');
const db = require('../db/pasigSchema');

function signPayload(payload, secret) {
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return `sha256=${signature}`;
}

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

async function sendWebhook(batchId) {
  const batchResult = await db.getBatch(batchId);
  if (batchResult.rows.length === 0) {
    throw new Error('Batch not found');
  }

  const batch = batchResult.rows[0];
  if (batch.status !== 'validated') {
    throw new Error('Batch must be validated before sending');
  }

  const recordsResult = await db.getValidatedCases(batchId);

  const dstbRecords = recordsResult.rows.filter(r => r.source_type === 'DSTB');
  const mnRecords = recordsResult.rows.filter(r => r.source_type === 'MN');

  const payload = {
    schema_version: '1.0',                    // NEW: version for receiver validation
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

  const secret = config.webhook.secret;
  const signature = signPayload(payload, secret);
  const webhookUrl = config.webhook.url;

  const MAX_RETRIES = 2;
  const TIMEOUT_MS = 30000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,      // Only HMAC — no raw secret
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const responseBody = await response.text();

      await db.logWebhook(batchId, payload, response.ok ? 'sent' : 'failed', response.status, responseBody);

      if (response.ok) {
        await db.updateBatchSent(batchId);
        return { success: true, status: response.status, message: 'Webhook sent successfully' };
      }

      // 4xx errors — don't retry (permanent failure)
      if (response.status >= 400 && response.status < 500) {
        return { success: false, status: response.status, message: 'Webhook failed (client error)' };
      }

      // 5xx errors — retry if attempts remain
      if (attempt < MAX_RETRIES) {
        console.log(`Webhook retry ${attempt}/${MAX_RETRIES} after ${response.status}`);
        continue;
      }

      return { success: false, status: response.status, message: 'Webhook failed after retries' };
    } catch (error) {
      // Network/timeout errors — retry if attempts remain
      if (attempt < MAX_RETRIES) {
        console.log(`Webhook retry ${attempt}/${MAX_RETRIES} after error: ${error.message}`);
        continue;
      }

      await db.logWebhookError(batchId, payload, error.message);
      return { success: false, status: 0, message: `Webhook failed: ${error.message}` };
    }
  }
}

module.exports = { sendWebhook, signPayload, formatRecord };
```

**Key differences from plan:**
- Uses `node-fetch` (v2) instead of native `fetch`
- Only sends `X-Webhook-Signature` (no `X-Webhook-Secret` header — security fix)
- Adds `schema_version: '1.0'` to payload
- 30-second timeout via `AbortController`
- Up to 2 retries for 5xx/network errors (no retry for 4xx)
- Uses `config.webhook.secret` and `config.webhook.url`
- Exports `signPayload` and `formatRecord` individually

### 4.8 Webhook Route (routes/webhook.js)

```javascript
// File: PASIG_CLONE/backend/routes/webhook.js
// Uses db helper instead of raw SQL

const express = require('express');
const router = express.Router();
const { sendWebhook } = require('../services/webhookSender');
const db = require('../db/pasigSchema');
const { authorizeRoles } = require('../middleware/auth');

/**
 * POST /api/webhook/send
 * Send validated batch to TBInsight.
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
    const result = await db.getWebhookLogs();
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching webhook logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

module.exports = router;
```

### 4.9 Environment Variables (.env)

```bash
# PASIG_CLONE/backend/.env

# Server
PORT=5001
NODE_ENV=development

# Database (SEPARATE from TBInsight — create in Neon dashboard)
DATABASE_URL=postgresql://user:password@localhost:5432/pasig_clone_db?sslmode=require

# JWT
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d

# Webhook
TBINSIGHT_WEBHOOK_URL=http://localhost:3000/api/webhook/pasig-clone
WEBHOOK_SECRET=shared_secret_with_tbinsight

# Frontend URL
FRONTEND_URL=http://localhost:5174
```

**Note:** The `config/index.js` module reads these env vars and exports them as a structured object. All services import `config` instead of accessing `process.env` directly.

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

**Note:** Tailwind v4 uses CSS-based configuration via `@tailwindcss/vite` plugin. No `tailwind.config.js` or `postcss.config.js` needed.

### 5.2 Main App (App.jsx)

```jsx
// File: PASIG_CLONE/frontend/src/App.jsx
// Uses React Router v6 nested routes with Outlet pattern

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import CsvImportPage from './pages/CsvImportPage';
import ValidationPage from './pages/ValidationPage';
import WebhookStatusPage from './pages/WebhookStatusPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<CsvImportPage />} />
            <Route path="/validate" element={<ValidationPage />} />
            <Route path="/webhook" element={<WebhookStatusPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

**Key difference from plan:** Uses `<Outlet />` pattern instead of `children` prop. State is managed via URL query params (`?batchId=...`), not lifted to `App.jsx`.

### 5.3 ProtectedRoute Component

```jsx
// File: PASIG_CLONE/frontend/src/components/ProtectedRoute.jsx
// Uses Outlet pattern for nested route protection

import { useState, useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import axios from '../api/axios';

export default function ProtectedRoute() {
  const [isAuthenticated, setIsAuthenticated] = useState(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        await axios.get('/api/auth/profile');
        setIsAuthenticated(true);
      } catch {
        setIsAuthenticated(false);
      }
    };
    checkAuth();
  }, []);

  if (isAuthenticated === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}
```

### 5.4 Layout Component

```jsx
// File: PASIG_CLONE/frontend/src/components/Layout.jsx
// Two-tier layout: header + nav tabs + content area

import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import axios from '../api/axios';

const NAV_ITEMS = [
  { label: 'Import', path: '/', icon: 'ri-upload-cloud-2-line' },
  { label: 'Validate', path: '/validate', icon: 'ri-checkbox-circle-line' },
  { label: 'Webhook', path: '/webhook', icon: 'ri-send-plane-line' },
];

export default function Layout() {
  const [user, setUser] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get('/api/auth/profile')
      .then(res => setUser(res.data.user))
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    try {
      await axios.post('/api/auth/logout');
    } catch {}
    localStorage.removeItem('token');
    navigate('/login');
  };

  const initials = user ? (user.username?.[0] || 'U').toUpperCase() : 'U';

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Tier 1: Logo + User Bar */}
      <header className="bg-[#1a5276] text-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
            <span className="text-sm font-bold">P2</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Pasig TB-DOTS</h1>
            <p className="text-xs text-white/60">Data Integration System</p>
          </div>
        </div>

        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2 hover:bg-white/10 rounded-lg px-3 py-1.5 transition-colors"
          >
            <div className="w-7 h-7 bg-white/20 rounded-full flex items-center justify-center text-xs font-semibold">
              {initials}
            </div>
            <span className="text-sm hidden sm:inline">{user?.username || 'User'}</span>
            <i className="ri-arrow-down-s-line text-white/60" />
          </button>

          {showDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
              <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg shadow-lg border z-50 py-1">
                <div className="px-4 py-2 border-b">
                  <p className="text-sm font-medium text-gray-900">{user?.username}</p>
                  <p className="text-xs text-gray-500">{user?.email}</p>
                  <span className="inline-block mt-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{user?.role}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <i className="ri-logout-box-r-line" />
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Tier 2: Nav Items */}
      <nav className="bg-white border-b px-6 flex gap-1">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`
            }
          >
            <i className={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Page Content */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-6 lg:px-10 pt-6 pb-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
```

### 5.5 Axios Instance

```javascript
// File: PASIG_CLONE/frontend/src/api/axios.js
// Includes JWT interceptor for automatic token handling

import axios from 'axios';

const instance = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5001',
  withCredentials: true,
});

// Request interceptor: attach Bearer token from localStorage
instance.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: redirect to login on 401
instance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default instance;
```

### 5.6 CSV Import Page

```jsx
// File: PASIG_CLONE/frontend/src/pages/CsvImportPage.jsx
// Uses URL-based state (no onBatchCreated prop)

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from '../api/axios';

export default function CsvImportPage() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

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
      const response = await axios.post('/api/data/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setResult(response.data);
      // Navigate to validation page with batchId in URL
      navigate(`/validate?batchId=${response.data.batch.id}`);
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
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files[0])}
            className="hidden"
            id="file-upload"
          />
          <label htmlFor="file-upload" className="cursor-pointer">
            <div className="text-gray-500">
              <p className="text-lg">Click to select file</p>
              <p className="text-sm">Supports .xlsx, .xls (max 50MB)</p>
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
          </div>
        )}
      </div>
    </div>
  );
}
```

**Key difference from plan:** No `onBatchCreated` prop — navigates to `/validate?batchId=...` instead.

### 5.7 Validation Page

```jsx
// File: PASIG_CLONE/frontend/src/pages/ValidationPage.jsx
// Reads batchId from URL search params

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
            <h2 className="text-lg font-semibold mb-2">Send to TBInsight</h2>
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

### 5.8 Webhook Status Page

```jsx
// File: PASIG_CLONE/frontend/src/pages/WebhookStatusPage.jsx
// Reads batchId from URL search params

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
      <h1 className="text-2xl font-bold mb-6">Send to TBInsight</h1>

      {/* Send Section */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Webhook Delivery</h2>

        {batchId ? (
          <>
            <p className="text-gray-600 mb-4">
              Ready to send batch <span className="font-mono">{batchId}</span> to TBInsight.
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
    else if (normalized.includes('itis') && normalized.includes('lite')) {
      map[header] = 'itis_case_id';
    }
  }

  return map;
}
```

### 6.2 New Webhook Endpoint (tbinsight/webhook.js)

```javascript
// File: P2_OFFICIAL/BACKEND/tbinsight/webhook.js
// Improved over plan: better error handling, idempotency, record validation

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { validateRow } = require('./parseCaseFile');
const { rebuildAggregations } = require('./aggregateMonthly');
const { verifyWebhookSignature } = require('../middleware/webhookAuth');

/**
 * POST /api/webhook/pasig-clone
 * Receive webhook from Pasig Clone system.
 */
router.post('/pasig-clone', verifyWebhookSignature, async (req, res) => {
  const client = await pool.connect();
  try {
    const { source, batch_id, timestamp, sheets, schema_version } = req.body;

    // Validate payload structure
    if (schema_version !== '1.0') {
      return res.status(400).json({ error: 'Unsupported payload version. Expected schema_version "1.0".' });
    }

    if (source !== 'pasig-clone' || !sheets || !Array.isArray(sheets)) {
      return res.status(400).json({ error: 'Invalid payload structure' });
    }

    if (!batch_id || typeof batch_id !== 'string') {
      return res.status(400).json({ error: 'batch_id is required' });
    }

    // Validate batch_id is a proper UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(batch_id)) {
      return res.status(400).json({ error: 'batch_id must be a valid UUID' });
    }

    if (!timestamp) {
      return res.status(400).json({ error: 'timestamp is required' });
    }

    // Idempotency: check if this batch was already processed
    const existing = await pool.query(
      "SELECT id FROM webhook_logs WHERE batch_id = $1 AND status = 'processed'",
      [batch_id]
    );
    if (existing.rows.length > 0) {
      return res.json({
        success: true,
        message: 'Webhook already processed (duplicate)',
      });
    }

    const barangaysResult = await pool.query('SELECT name FROM barangays');
    const validBarangays = new Set(barangaysResult.rows.map(r => r.name.toLowerCase()));

    let totalRecords = 0;
    let importedCount = 0;
    let errorCount = 0;
    const errors = [];

    await client.query('BEGIN');

    for (const sheet of sheets) {
      const { source_type, records } = sheet;

      if (!source_type || !['DSTB', 'MN'].includes(source_type)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Invalid source_type: "${source_type}"` });
      }

      if (!Array.isArray(records)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'records must be an array' });
      }

      if (sheet.record_count !== undefined && sheet.record_count !== records.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `record_count mismatch: expected ${sheet.record_count}, got ${records.length}`,
        });
      }

      for (const record of records) {
        totalRecords++;
        record.source_type = source_type;

        const validation = validateRow(record, validBarangays);

        if (validation.valid) {
          // Classify location based on city field, not barangay
          const normalizedCity = String(record.city || '').trim().toLowerCase();
          const locationClassification =
            normalizedCity === 'pasig city' || normalizedCity === 'pasig'
              ? 'Pasig City'
              : 'Non-Pasig';

          await client.query(
            `INSERT INTO tb_cases (
              batch_id, date_of_diagnosis, date_of_screening, date_of_notification,
              age, sex, barangay_name, screening_facility, treatment_facility,
              source_of_patient, anatomical_site, registration_group, bacteriological_status,
              date_started_treatment, outcome_status, date_of_outcome,
              validation_status, itis_case_id, source_type, location_classification
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
            [
              batch_id,
              record.date_of_diagnosis, record.date_of_screening, record.date_of_notification,
              record.age, record.sex, record.barangay_name, record.screening_facility,
              record.treatment_facility, record.source_of_patient, record.anatomical_site,
              record.registration_group, record.bacteriological_status, record.date_started_treatment,
              record.outcome_status, record.date_of_outcome, record.validation_status,
              record.itis_case_id, source_type, locationClassification,
            ]
          );
          importedCount++;
        } else {
          errorCount++;
          errors.push({ row: record.row_number, source_type, errors: validation.errors });
        }
      }
    }

    await client.query('COMMIT');
    client.release();

    // Rebuild aggregations separately — data is already committed
    if (importedCount > 0) {
      try {
        await rebuildAggregations();
      } catch (aggErr) {
        console.error('Aggregation rebuild failed after commit:', aggErr.message);
        // Don't return 500 — data was imported successfully
      }
    }

    // Log webhook — handle duplicate-key violation gracefully
    try {
      await pool.query(
        `INSERT INTO webhook_logs (source, batch_id, payload, status, records_received, records_imported)
         VALUES ($1, $2, $3, 'processed', $4, $5)`,
        [source, batch_id, req.body, totalRecords, importedCount]
      );
    } catch (logErr) {
      if (logErr.code === '23505') {
        // Unique constraint violation — duplicate webhook, already logged
        console.log(`Webhook log for batch ${batch_id} already exists (duplicate)`);
      } else {
        console.error('Failed to log webhook:', logErr.message);
      }
    }

    res.json({
      success: true,
      message: `Webhook processed: ${importedCount} imported, ${errorCount} errors`,
      totalRecords, importedCount, errorCount,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Webhook processing error:', error);
    await pool.query(
      `INSERT INTO webhook_logs (source, batch_id, payload, status, error_message)
       VALUES ($1, $2, $3, 'failed', $4)`,
      [req.body.source, req.body.batch_id, req.body, error.message]
    ).catch(() => {});
    res.status(500).json({ error: 'Webhook processing failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
```

**Key differences from plan:**
- `records` validation: explicit `Array.isArray(records)` check
- `schema_version` check: more specific error message
- `client.release()` called both after COMMIT and in `finally` block (double release is harmless)
- Aggregation failure does not cause 500 response (data was imported successfully)
- Webhook log duplicate handling: catches `23505` error code gracefully

### 6.3 Webhook Auth Middleware (middleware/webhookAuth.js)

```javascript
// File: P2_OFFICIAL/BACKEND/middleware/webhookAuth.js
// SECURITY FIX: Only reads X-Webhook-Signature (no raw secret header)
// The secret is never sent in the request — verified server-side only

const crypto = require('crypto');

/**
 * Middleware to verify webhook HMAC-SHA256 signature.
 * The sender signs the payload with WEBHOOK_SECRET and sends the signature
 * in the X-Webhook-Signature header. The server verifies using its own
 * WEBHOOK_SECRET env var — the secret is NOT sent in the request.
 */
function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-webhook-signature'];

  if (!signature) {
    return res.status(401).json({ error: 'Missing X-Webhook-Signature header' });
  }

  // Use server's configured WEBHOOK_SECRET to verify
  const serverSecret = process.env.WEBHOOK_SECRET;
  if (!serverSecret) {
    console.error('WEBHOOK_SECRET env var not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // Verify HMAC signature with length check
  const expectedSignature = crypto
    .createHmac('sha256', serverSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  const providedSignature = signature.replace('sha256=', '');

  const providedBuffer = Buffer.from(providedSignature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

module.exports = { verifyWebhookSignature };
```

**Key differences from plan:**
- Only reads `X-Webhook-Signature` header (removed `X-Webhook-Secret` — security fix)
- Secret is never sent in the request — verified server-side only
- Uses `crypto.timingSafeEqual()` for constant-time comparison (prevents timing attacks)
- Length check before `timingSafeEqual` prevents built-in exception on mismatched lengths

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

-- Idempotency: prevent duplicate webhook processing
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_logs_source_batch
  ON webhook_logs(source, batch_id) WHERE batch_id IS NOT NULL;
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
│  POST /api/data/import                                            │
│  - Parse both DSTB + MN sheets (ExcelJS async)               │
│  - Store raw records in raw_tb_cases                           │
│  - Return batch ID                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: Validate Batch                                        │
│  POST /api/data/validate/:batchId                              │
│  - Run validation rules (30 barangays, sex/age/dates)         │
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
│  - POST to TBInsight (30s timeout, 2 retries)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: Receive at TBInsight                                  │
│  POST /api/webhook/pasig-clone                                 │
│  - Verify HMAC signature (timing-safe)                         │
│  - Validate payload (schema_version, source, batch_id, etc.)  │
│  - Insert into tb_cases with source_type                       │
│  - Rebuild aggregations (in try/catch)                         │
│  - Log to webhook_logs (idempotent)                            │
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
  "schema_version": "1.0",
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

### 7.3 Security Model

| Aspect | Implementation |
|---|---|
| **Authentication** | HMAC-SHA256 signature in `X-Webhook-Signature` header |
| **Secret storage** | `WEBHOOK_SECRET` env var on both sides (must match) |
| **Secret transmission** | Never sent in request — verified server-side only |
| **Signature algorithm** | `HMAC-SHA256(JSON.stringify(payload), secret)` |
| **Verification** | `crypto.timingSafeEqual()` for constant-time comparison |
| **Idempotency** | App-level check + unique partial index on `(source, batch_id)` |
| **Retry logic** | 2 retries for 5xx/network errors (Pasig Clone sender) |
| **Timeout** | 30 seconds (Pasig Clone sender) |

---

## 8. TESTING STRATEGY

### 8.1 Unit Tests (node:test)

```javascript
// File: PASIG_CLONE/backend/test/multiSheetParser.test.js
// Uses Node.js built-in test runner (not Jest)

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDate,
  normalizeSex,
  detectSheetType,
  buildColumnMap,
} = require('../services/multiSheetParser');
const { validateRecord, getValidBarangays } = require('../services/validator');

describe('parseDate', () => {
  it('returns null for empty input', () => {
    assert.equal(parseDate(null), null);
    assert.equal(parseDate(''), null);
    assert.equal(parseDate(undefined), null);
  });

  it('parses ISO format YYYY-MM-DD', () => {
    assert.equal(parseDate('2025-02-06'), '2025-02-06');
    assert.equal(parseDate('2025-12-31'), '2025-12-31');
  });

  it('parses written month format "February 06, 2025"', () => {
    assert.equal(parseDate('February 06, 2025'), '2025-02-06');
  });

  it('parses Date objects', () => {
    const d = new Date('2025-01-14T00:00:00Z');
    assert.equal(parseDate(d), '2025-01-14');
  });

  it('returns null for invalid Date objects', () => {
    assert.equal(parseDate(new Date('invalid')), null);
  });

  it('returns null for unparseable strings', () => {
    assert.equal(parseDate('not-a-date'), null);
  });
});

describe('normalizeSex', () => {
  it('returns null for empty input', () => {
    assert.equal(normalizeSex(null), null);
    assert.equal(normalizeSex(''), null);
  });

  it('normalizes M to Male', () => {
    assert.equal(normalizeSex('M'), 'Male');
    assert.equal(normalizeSex('m'), 'Male');
  });

  it('normalizes F to Female', () => {
    assert.equal(normalizeSex('F'), 'Female');
    assert.equal(normalizeSex('f'), 'Female');
  });

  it('returns null for unrecognized values', () => {
    assert.equal(normalizeSex('X'), null);
    assert.equal(normalizeSex('other'), null);
  });
});

describe('detectSheetType', () => {
  it('detects DSTB sheets', () => {
    assert.equal(detectSheetType('DSTB'), 'DSTB');
    assert.equal(detectSheetType('dstb'), 'DSTB');
    assert.equal(detectSheetType('B-MODE'), 'DSTB');
  });

  it('detects MN sheets', () => {
    assert.equal(detectSheetType('MN'), 'MN');
    assert.equal(detectSheetType('mn'), 'MN');
    assert.equal(detectSheetType('M-N'), 'MN');
    assert.equal(detectSheetType('MICROSCOPIC'), 'MN');
  });

  it('returns null for unknown sheets', () => {
    assert.equal(detectSheetType('Sheet1'), null);
    assert.equal(detectSheetType('Data'), null);
  });
});

describe('buildColumnMap', () => {
  it('maps common headers for DSTB', () => {
    const headers = ['No.', 'Date of Diagnosis', 'Barangay', 'Sex', 'Age'];
    const map = buildColumnMap(headers, 'DSTB');
    assert.equal(map[1], 'date_of_diagnosis');
    assert.equal(map[2], 'barangay_name');
    assert.equal(map[3], 'sex');
    assert.equal(map[4], 'age');
  });

  it('skips No. column', () => {
    const headers = ['No.', 'Sex'];
    const map = buildColumnMap(headers, 'DSTB');
    assert.equal(map[0], undefined);
    assert.equal(map[1], 'sex');
  });

  it('maps validation_status for DSTB', () => {
    const headers = ['Validation Status'];
    const map = buildColumnMap(headers, 'DSTB');
    assert.equal(map[0], 'validation_status');
  });

  it('does not map validation_status for MN', () => {
    const headers = ['Validation Status'];
    const map = buildColumnMap(headers, 'MN');
    assert.equal(map[0], undefined);
  });
});

describe('validateRecord', () => {
  const validBarangays = new Set([
    'san antonio', 'bambang', 'pinagbuhatan', 'dela paz',
    'bagong ilog', 'buting', 'caniogan', 'kalawaan', 'kapasigan',
    'kapitolyo', 'malinao', 'manggahan', 'maybunga', 'oranbo',
    'palatiw', 'pineda', 'rosario', 'sagad', 'san joaquin',
    'san jose', 'san miguel', 'san nicolas', 'santa cruz',
    'santa lucia', 'santa rosa', 'santo tomas', 'santolan',
    'sumilang', 'ugong',
  ]);

  const validRecord = {
    barangay_name: 'San Antonio',
    date_of_diagnosis: '2025-02-06',
    sex: 'Male',
    age: 30,
    city: 'Pasig City',
  };

  it('passes for a valid record', () => {
    const result = validateRecord(validRecord, 'DSTB', validBarangays);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('requires barangay_name', () => {
    const result = validateRecord({ ...validRecord, barangay_name: '' }, 'DSTB', validBarangays);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Barangay is required')));
  });

  it('rejects unknown barangay for Pasig City records', () => {
    const result = validateRecord({ ...validRecord, barangay_name: 'Unknown' }, 'DSTB', validBarangays);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Unknown barangay')));
  });

  it('warns about non-Pasig city', () => {
    const result = validateRecord({ ...validRecord, city: 'Manila' }, 'DSTB', validBarangays);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some(w => w.includes('Non-Pasig')));
  });

  it('warns about MN record missing ITIS Case ID', () => {
    const result = validateRecord({ ...validRecord, itis_case_id: '' }, 'MN', validBarangays);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some(w => w.includes('MN record missing ITIS Case ID')));
  });
});

describe('getValidBarangays', () => {
  it('returns a Set with Pasig barangays', async () => {
    const barangays = await getValidBarangays();
    assert.ok(barangays instanceof Set);
    assert.ok(barangays.size >= 28, `Expected at least 28 barangays, got ${barangays.size}`);
  });

  it('includes San Antonio', async () => {
    const barangays = await getValidBarangays();
    assert.ok(barangays.has('san antonio'));
  });

  it('includes Pinagbuhatan', async () => {
    const barangays = await getValidBarangays();
    assert.ok(barangays.has('pinagbuhatan'));
  });
});
```

### 8.2 Running Tests

```bash
# Pasig Clone tests (node:test)
cd PASIG_CLONE/backend
node --test test/multiSheetParser.test.js

# TBInsight backend tests
cd BACKEND
npm test
```

---

## 9. DEPLOYMENT

### 9.1 Render Configuration (render.yaml)

```yaml
# File: render.yaml

services:
  # TBInsight Backend
  - type: web
    name: tb-system-backend
    env: node
    plan: free
    rootDir: BACKEND
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: DATABASE_URL
        sync: false
      - key: JWT_SECRET
        generateValue: true
      - key: WEBHOOK_SECRET
        sync: false
        # Set manually — must match Pasig Clone's WEBHOOK_SECRET
      - key: FRONTEND_URL
        value: https://p2-official.vercel.app

  # Pasig Clone Backend
  - type: web
    name: pasig-clone-backend
    env: node
    plan: free
    rootDir: PASIG_CLONE/backend
    buildCommand: npm install
    startCommand: node server.js
    envVars:
      - key: DATABASE_URL
        sync: false
        # Set manually: postgresql://...@ep-xxx.neon.tech/pasig_clone_db?sslmode=require
      - key: JWT_SECRET
        generateValue: true
      - key: WEBHOOK_SECRET
        sync: false
        # Set manually — must match TBInsight's WEBHOOK_SECRET
      - key: TBINSIGHT_WEBHOOK_URL
        value: https://tb-system-backend.onrender.com/api/webhook/pasig-clone
      - key: FRONTEND_URL
        value: https://pasig-clone-frontend.onrender.app

  # Pasig Clone Frontend
  - type: web
    name: pasig-clone-frontend
    env: node
    plan: free
    rootDir: PASIG_CLONE/frontend
    buildCommand: npm install && npm run build
    startCommand: npm run preview -- --host 0.0.0.0 --port $PORT
    envVars:
      - key: VITE_API_URL
        value: https://pasig-clone-backend.onrender.app

databases: []
  # TBInsight: DATABASE_URL set manually in Render Dashboard
  # Pasig Clone: DATABASE_URL points to separate Neon database (pasig_clone_db)
```

### 9.2 Environment Variables

**Pasig Clone (.env)**
```
PORT=5001
DATABASE_URL=<pasig_clone_db connection string — SEPARATE from TBInsight>
JWT_SECRET=<generated>
WEBHOOK_SECRET=<shared with TBInsight>
TBINSIGHT_WEBHOOK_URL=https://tb-system-backend.onrender.com/api/webhook/pasig-clone
FRONTEND_URL=https://pasig-clone-frontend.onrender.app
```

**TBInsight (.env)**
```
WEBHOOK_SECRET=<same_as_pasig_clone>
```

### 9.3 Deployment Checklist

| Service | Platform | URL |
|---|---|---|
| TBInsight Frontend | Vercel | p2-official.vercel.app |
| TBInsight Backend | Render | tb-system-backend.onrender.com |
| ML Service | Render | tb-system-ml.onrender.com |
| Pasig Clone Backend | Render | pasig-clone-backend.onrender.app |
| Pasig Clone Frontend | Render | pasig-clone-frontend.onrender.app |

**Important:** `WEBHOOK_SECRET` must be set manually in both Render services (must match).

---

## 10. IMPLEMENTATION CHECKLIST

### Week 1: Project Setup
- [x] Create monorepo structure
- [x] Initialize Pasig Clone backend (Express)
- [x] Initialize Pasig Clone frontend (React + Vite)
- [x] Set up PostgreSQL database with schemas
- [x] Configure environment variables

### Week 2: Pasig Clone Backend
- [x] Implement multi-sheet parser (multiSheetParser.js) — **ExcelJS async**
- [x] Implement CSV import route (csvImport.js)
- [x] Implement validator service (validator.js)
- [x] Implement webhook sender (webhookSender.js) — **with retry + timeout**
- [x] Implement webhook route (webhook.js)
- [x] Implement authentication (auth.js, middleware)
- [x] Add centralized config module (config/index.js)
- [x] Add database abstraction layer (db/pasigSchema.js)

### Week 3: Pasig Clone Frontend
- [x] Create login page
- [x] Create CSV import page
- [x] Create validation page
- [x] Create webhook status page
- [x] Set up routing (Outlet pattern) and auth

### Week 4: P2_OFFICIAL Updates
- [x] Update parseCaseFile.js for multi-sheet support + detectSheetType
- [x] Create webhook endpoint (webhook.js)
- [x] Create webhook auth middleware (webhookAuth.js) — **HMAC-only, no raw secret**
- [x] Create database migration (007_webhook_logs.sql) — **with idempotency index**
- [x] Update server.js to mount webhook route

### Week 5: Testing & Integration
- [x] Unit tests for parser and validator (28 tests — PASIG_CLONE/backend/test/multiSheetParser.test.js)
- [x] Integration tests for webhook flow (18 tests — BACKEND/test/webhook.test.js)
- [x] Auth & middleware tests (50 tests — BACKEND/test/auth.test.js + middleware.test.js)
- [x] TBInsight pipeline & route tests (115 tests — BACKEND/test/tbinsight/*.test.js + routes.test.js)
- [x] Total: 211 tests across 7 test files
- [x] End-to-end testing
- [x] Fix bugs and issues

### Week 5b: Pre-Deployment Fixes
- [x] Fix validation response mismatch (item 9) — backend/frontend structures match
- [x] Fix P2 parser unknown-sheet handling (item 10) — skip unknown sheets (return null)
- [x] Preserve original DSTB validation_status (item 11) — source_validation_status + record_validation_status
- [x] Add schema_version to webhook payload (item 12) — sender includes "1.0", receiver validates
- [x] Webhook idempotency (item 13) — app-level check + unique index + 23505 catch
- [x] Validation idempotency (item 14) — DELETE before re-insert
- [x] Webhook error handling after commit (item 15) — rebuildAggregations in try/catch
- [x] Webhook timeout and retry (item 16) — 30s timeout, 2 retries for 5xx/network
- [x] Validate env vars at startup (item 17) — DATABASE_URL, JWT_SECRET, WEBHOOK_SECRET checked
- [x] Import naming (item 18) — /api/data/import consistent
- [x] Excel-only file extension check (item 19) — backend validates .xlsx/.xls only
- [x] Comprehensive webhook tests (item 20) — 18 tests, all passing

### Week 5c: Verification Fixes (Items 21–25)
- [x] Fix GeoJSON corruption (item 21) — removed stray `g` character at end of pasig-barangays.geojson; 30 barangays verified across all 4 sources
- [x] Fix City/Municipality header mapping (item 22) — parseCaseFile.js now uses `includes('city')` instead of `=== 'city'`; matches multiSheetParser.js behavior
- [x] Add missing DSTB/MN sheet warning (item 23) — csvImport.js returns `warnings` array when DSTB or MN sheet is missing (soft warning, import still succeeds)
- [x] Fix VITE_API_URL fallback (item 24) — frontend axios.js fallback changed from port 5000 to 3000; .env.production.example URL corrected to tb-system-backend.onrender.com
- [x] Fix Render PORT for Pasig Clone frontend (item 25) — added `--port $PORT` to vite preview start command in render.yaml

### Week 6: Deployment
- [ ] Deploy Pasig Clone to Render
- [ ] Deploy P2_OFFICIAL updates
- [ ] Configure webhook URLs
- [ ] Test production flow
- [ ] Document API endpoints

### Week 5d: Pre-Production Audit (45 fixes)
- [x] CRITICAL 1: Add `authenticate` to unprotected routes (csvImport, validation, webhook)
- [x] CRITICAL 2: Add RemixIcon CSS CDN to Pasig Clone frontend
- [x] CRITICAL 3: Fix DELETE without WHERE clause in scoring.js
- [x] CRITICAL 4: Fix ML incidence rate (annualize with ×12)
- [x] CRITICAL 5: Add ML Service to root render.yaml; clear duplicate ML_SERVICE/render.yaml
- [x] CRITICAL 6: Insert raw_cases inside BEGIN transaction; bulk INSERT function `insertRawCases`
- [x] CRITICAL 7: Prevent DB connection silently failing + trust proxy + 10MB webhook limit
- [x] CRITICAL 8: Add missing `await` + export `insertRawCases` in pasigSchema.js
- [x] CRITICAL 9: Fix `_buildTrainingRows` using released client → pool.query()
- [x] CRITICAL 10: DELETE moved inside BEGIN transaction in pipeline.js
- [x] CRITICAL 11: Filter `validation_status = 'Validated'` on all 5 aggregation queries
- [x] MEDIUM 1: Add global error handler to Pasig Clone server.js
- [x] MEDIUM 2: Wrap `validateBatch` in transaction (validator.js)
- [x] MEDIUM 3: GET /notifications no longer seeds data — moved to POST /alerts/seed
- [x] MEDIUM 4: Backfill endpoint validates period format (YYYY-MM)
- [x] MEDIUM 5: Remove hardcoded ML API key fallback — fail loudly if not set
- [x] MEDIUM 6: Delete unreachable RegisterPage.jsx
- [x] MEDIUM 7: ErrorBoundary redirect uses `replace()` instead of `href`
- [x] MEDIUM 8: Settings page uses `/api/health` instead of gated root endpoint
- [x] MEDIUM 9: Fix fragile semicolon splitting in pasigSchema.js
- [x] LOW 1: Delete debug utility `_check_rate.js`
- [x] LOW 2: Add 404 catch-all route in App.jsx
- [x] LOW 3: Add `authorizeRoles('admin')` on intervention mutation routes
- [x] LOW 4: Create `BACKEND/.env.example`
- [x] LOW 5: Gate ML root endpoint behind API key
- [x] LOW 6: Increase webhook retry timeout (3 retries, 60s timeout)
- [x] LOW 7: Delete dead `BarangayWatchlist.jsx`
- [x] LOW 8: Rotate .env secrets for both systems

---

## DOCUMENT HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-09-04 | System | Initial implementation plan |
| 2.0 | 2026-09-04 | System | Updated checklist — Weeks 1-5 complete, separate databases architecture |
| 3.0 | 2026-09-06 | System | Week 5c verification fixes — GeoJSON, City/Municipality header, missing sheet warning, VITE_API_URL, Render PORT |
| 4.0 | 2026-09-06 | System | Updated all sections to match actual implementation — ExcelJS async, config module, db/pasigSchema.js, Outlet routing, HMAC-only security, retry/timeout, node:test |
| 5.0 | 2026-09-06 | System | Week 5d pre-production audit — 45 fixes across CRITICAL/MEDIUM/LOW: transactions, auth, rate limiting, error handling, dead code cleanup |

---

**END OF IMPLEMENTATION PLAN**
