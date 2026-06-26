# TBInsight — Complete Project Plan

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│     EXTERNAL TB SYSTEM (TO BE BUILT)                │
│     Express + PostgreSQL (separate DB)              │
│     Port: 5001                                      │
│                                                     │
│  Health Workers: login, encode, update TB records   │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐                │
│  │ ext_users    │  │ ext_tb_records│                │
│  │ (auth)       │  │ (18+ cols)   │                │
│  └──────────────┘  └──────┬───────┘                │
│                           │                         │
│  GET /api/integration/records (API Key Auth)        │
└─────────────────────────────┼───────────────────────┘
                              │
                     HTTP Pull (server-to-server)
                              │
                              ▼
┌─────────────────────────────────────────────────────┐
│     TBINSIGHT BACKEND (EXISTING)                    │
│     Express 5 + PostgreSQL (separate DB)            │
│     Port: 5000                                      │
│                                                     │
│  ┌────────────────────────────────────────────────┐ │
│  │  Data Integration Module                       │ │
│  │  Pull → Review → Verify → Sync                │ │
│  └──────────────────┬─────────────────────────────┘ │
│                     │                               │
│              TB Records (14 tables, L0-L4)          │
│              Single source of truth                 │
│                     │                               │
│    ┌────────┬───────┼────────┬──────────┐          │
│    ▼        ▼       ▼        ▼          ▼          │
│ Dashboard  GIS   Forecast  Reports    Alerts       │
│                        │                           │
│                        ▼                           │
│              ML Service (Python FastAPI)           │
│              ARIMA + Random Forest                 │
│              Port: 8001                            │
└─────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────┐
│     FRONTEND (EXISTING)                             │
│     React 19 + Vite 8 + Tailwind v4                │
│     Port: 5173                                      │
│                                                     │
│  14 pages: Login, Dashboard, TB Records, Analytics, │
│  Data Integration, GIS Map, Resource Prioritization,│
│  Reports, Alerts, Notifications, Users, Settings,   │
│  MyProfile                                          │
└─────────────────────────────────────────────────────┘
```

---

## Phase 1: Fix Critical Bugs

**Est. Time: 1-2 hours**

### 1.1 Fix ML Client URL Prefix

**File:** `BACKEND/tbinsight/mlClient.js`

**Problem:** All 4 HTTP calls to the Python ML service are missing the `/api/ml` prefix. The FastAPI app mounts routes at `/api/ml` (in `main.py:46`), but the Express client calls `/forecast`, `/classify`, `/thresholds`, `/health` without it.

| Current (Broken) | Correct |
|---|---|
| `mlPost('/forecast', ...)` | `mlPost('/api/ml/forecast', ...)` |
| `mlPost('/classify', ...)` | `mlPost('/api/ml/classify', ...)` |
| `mlPost('/thresholds', ...)` | `mlPost('/api/ml/thresholds', ...)` |
| `GET ${ML_BASE}/health` | `GET ${ML_BASE}/api/ml/health` |

### 1.2 Remove Committed Credentials

**Files:** `BACKEND/.env`, `.gitignore`

**Problem:** `BACKEND/.env` is tracked in git with production PostgreSQL password, local DB password, and JWT secret.

**Actions:**
1. Run `git rm --cached BACKEND/.env` to untrack the file
2. Add `BACKEND/.env` to root `.gitignore`
3. Replace actual passwords with placeholders

### 1.3 Create BACKEND/.env.example

**File:** `BACKEND/.env.example` (new)

### 1.4 Add ML_SERVICE_URL to Backend render.yaml

**File:** Root `render.yaml` — add ML_SERVICE_URL env var

---

## Phase 2: External TB Information Source System

**Est. Time: 8-10 hours**

### 2A: Project Setup

| # | Task | Files |
|---|---|---|
| 2A.1 | Create `EXTERNAL_SYSTEM/` directory | New folder at monorepo root |
| 2A.2 | Initialize `package.json` | Express 5, pg, bcryptjs, jsonwebtoken, cookie-parser, cors, dotenv, uuid |
| 2A.3 | Create `.env` | Own DB credentials, own JWT secret, API_KEY for TBInsight |
| 2A.4 | Create `.env.example` | Template |
| 2A.5 | Create `db.js` | PostgreSQL pool, auto-run init.sql |
| 2A.6 | Create `init.sql` | 3 tables (see below) |
| 2A.7 | Create `server.js` | Express app on port 5001 |
| 2A.8 | Add to root workspaces | Add `"EXTERNAL_SYSTEM"` to workspaces array |
| 2A.9 | Add dev script | `"dev:external"` |
| 2A.10 | Add concurrently command | Update `dev` script to run all 3 |

### 2B: Database Schema (External System)

**File:** `EXTERNAL_SYSTEM/init.sql`

#### Table: `ext_users`

| Column | Type | Constraints |
|---|---|---|
| `id` | SERIAL | PRIMARY KEY |
| `username` | VARCHAR(50) | UNIQUE NOT NULL |
| `email` | VARCHAR(100) | UNIQUE NOT NULL |
| `password` | VARCHAR(255) | NOT NULL |
| `role` | VARCHAR(20) | DEFAULT 'health_worker' |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

#### Table: `ext_tb_records`

| Column | Type | Constraints |
|---|---|---|
| `id` | BIGSERIAL | PRIMARY KEY |
| `case_id` | VARCHAR(50) | UNIQUE NOT NULL |
| `patient_name` | TEXT | NOT NULL |
| `age` | INTEGER | NOT NULL |
| `sex` | TEXT | NOT NULL |
| `barangay` | TEXT | NOT NULL |
| `address` | TEXT | |
| `date_of_diagnosis` | DATE | NOT NULL |
| `date_of_screening` | DATE | |
| `date_of_notification` | DATE | |
| `screening_facility` | TEXT | |
| `treatment_facility` | TEXT | |
| `source_of_patient` | TEXT | |
| `anatomical_site` | TEXT | |
| `registration_group` | TEXT | |
| `bacteriological_status` | TEXT | |
| `date_started_treatment` | DATE | |
| `outcome_status` | TEXT | |
| `date_of_outcome` | DATE | |
| `previous_treatment` | BOOLEAN | DEFAULT FALSE |
| `comorbidities` | TEXT | |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `source_file` | TEXT | |

#### Table: `ext_treatment_updates`

| Column | Type | Constraints |
|---|---|---|
| `id` | SERIAL | PRIMARY KEY |
| `record_id` | BIGINT | FK ext_tb_records ON DELETE CASCADE |
| `update_date` | DATE | NOT NULL |
| `outcome_status` | TEXT | NOT NULL |
| `notes` | TEXT | |
| `updated_by` | INTEGER | FK ext_users(id) |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

### 2C: Auth Routes

**File:** `EXTERNAL_SYSTEM/routes/auth.js`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | None | Register health worker |
| POST | `/api/auth/login` | None | JWT login |
| POST | `/api/auth/logout` | None | Clear cookie |
| GET | `/api/auth/profile` | JWT | Current user |

### 2D: TB Records CRUD Routes

**File:** `EXTERNAL_SYSTEM/routes/records.js`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/records` | JWT | Create new TB record |
| GET | `/api/records` | JWT | List records (paginated, filterable) |
| GET | `/api/records/:id` | JWT | Get single record |
| PUT | `/api/records/:id` | JWT | Update record |
| DELETE | `/api/records/:id` | JWT | Delete record |
| PUT | `/api/records/:id/treatment` | JWT | Add treatment update |
| GET | `/api/records/:id/history` | JWT | Get treatment history |

### 2E: Integration API (For TBInsight to Pull)

**File:** `EXTERNAL_SYSTEM/routes/integration.js`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/integration/records` | API Key | Returns TB records for TBInsight to pull |

**Query Parameters:** `lastSync`, `page`, `limit`

**Response:**
```json
{
  "records": [...],
  "total": 1200,
  "page": 1,
  "limit": 100,
  "hasMore": true,
  "syncTimestamp": "2025-06-26T12:00:00Z"
}
```

**Middleware:** `EXTERNAL_SYSTEM/middleware/apiKeyAuth.js`

### 2F: Seed Data

**File:** `EXTERNAL_SYSTEM/seed.js`

| # | Task |
|---|---|
| 2F.1 | Generate ~1200 realistic TB records across 30 barangays, Jan 2023-Dec 2025 |
| 2F.2 | Realistic demographics matching Philippines TB stats |
| 2F.3 | Realistic outcomes (60% Cured/Completed, 15% Active, etc.) |
| 2F.4 | Map to actual 39 Pasig health facilities |
| 2F.5 | Seasonal patterns (higher May-Oct) |
| 2F.6 | Create 2 default users (admin + health worker) |
| 2F.7 | Idempotent seed (skip if data exists) |

### 2G: Frontend - External System UI

**Location:** `FRONTEND/src/pages/external/` (new directory)

| # | Task | File |
|---|---|---|
| 2G.1 | External Login Page | `LoginPage.jsx` |
| 2G.2 | External Layout | `ExternalLayout.jsx` |
| 2G.3 | Records List | `RecordsList.jsx` |
| 2G.4 | Add Record Form | `RecordForm.jsx` |
| 2G.5 | Edit Record | `RecordForm.jsx` (same, pre-filled) |
| 2G.6 | Treatment Update | `TreatmentUpdate.jsx` |
| 2G.7 | Record Detail | `RecordDetail.jsx` |
| 2G.8 | Routes | `App.jsx` `/external/*` routes |

---

## Phase 3: Data Integration Module (The Bridge)

**Est. Time: 4-5 hours**

### 3A: Backend - External System Client

**File:** `BACKEND/tbinsight/externalClient.js` (new)

| # | Task |
|---|---|
| 3A.1 | Create HTTP client (fetch wrapper) |
| 3A.2 | `fetchRecords(lastSync, page, limit)` |
| 3A.3 | Handle pagination (loop through all pages) |
| 3A.4 | Handle errors (timeout, connection refused, auth failure) |
| 3A.5 | Configure via `EXTERNAL_SYSTEM_URL` env var |

### 3B: Backend - Integration Endpoints

**File:** `BACKEND/tbinsight/routes.js` (add new endpoints)

| # | Method | Path | Auth | Description |
|---|---|---|---|---|
| 3B.1 | POST | `/api/tb/integration/pull` | JWT admin | Pull from External System |
| 3B.2 | GET | `/api/tb/integration/records` | JWT admin | List pulled records |
| 3B.3 | PUT | `/api/tb/integration/verify/:id` | JWT admin | Verify single record |
| 3B.4 | POST | `/api/tb/integration/verify-all` | JWT admin | Bulk verify all |
| 3B.5 | DELETE | `/api/tb/integration/reject/:id` | JWT admin | Reject record |
| 3B.6 | POST | `/api/tb/integration/sync` | JWT admin | Sync verified to TB Records |
| 3B.7 | GET | `/api/tb/integration/sync-logs` | JWT admin | Sync history |
| 3B.8 | POST | `/api/tb/integration/auto-pipeline` | JWT admin | Optionally trigger ML pipeline |

### 3C: Database - Staging Table

**File:** `BACKEND/db/migrations/003_integration_staging.sql` (new)

#### Table: `imported_records`

| Column | Type | Constraints |
|---|---|---|
| `id` | BIGSERIAL | PRIMARY KEY |
| `external_id` | BIGINT | ID from External System |
| `case_id` | VARCHAR(50) | |
| `patient_name` | TEXT | |
| `age` | INTEGER | |
| `sex` | TEXT | |
| `barangay` | TEXT | |
| `date_of_diagnosis` | DATE | |
| All other TB fields... | ... | ... |
| `validation_status` | TEXT | DEFAULT 'Pending' |
| `validation_errors` | JSONB | Array of error messages |
| `pulled_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `verified_at` | TIMESTAMPTZ | |
| `synced_at` | TIMESTAMPTZ | |

#### Table: `sync_logs`

| Column | Type | Constraints |
|---|---|---|
| `id` | SERIAL | PRIMARY KEY |
| `pull_timestamp` | TIMESTAMPTZ | DEFAULT NOW() |
| `records_pulled` | INTEGER | |
| `records_verified` | INTEGER | |
| `records_synced` | INTEGER | |
| `records_rejected` | INTEGER | |
| `synced_by` | INTEGER | FK users(id) |
| `status` | TEXT | 'completed'/'partial'/'failed' |
| `errors` | JSONB | |

### 3D: Import Logic

**File:** `BACKEND/tbinsight/importFromExternal.js` (new)

| # | Task |
|---|---|
| 3D.1 | Map External System fields to TBInsight columns |
| 3D.2 | Validate each record (same rules as parseCaseFile.js) |
| 3D.3 | Check for duplicates (case_id or barangay+date+name) |
| 3D.4 | Store in imported_records with validation_status |
| 3D.5 | Sync logic: copy Verified to tb_cases + tb_cases_raw, then rebuildAggregations() |

### 3E: Frontend - Data Integration Page

**File:** `FRONTEND/src/pages/DataIntegration.jsx` (rewrite)

| # | Task |
|---|---|
| 3E.1 | "Pull from External System" button |
| 3E.2 | Pull progress indicator |
| 3E.3 | Review table with status badges |
| 3E.4 | Verify single record |
| 3E.5 | Bulk verify all |
| 3E.6 | Reject records |
| 3E.7 | Sync to TB Records button |
| 3E.8 | Sync success feedback |
| 3E.9 | Sync history tab |
| 3E.10 | Connection status indicator |

---

## Phase 4: Connect Frontend to Backend APIs

**Est. Time: 4-5 hours**

### 4A: Dashboard

| # | Task | Source API |
|---|---|---|
| 4A.1 | KPI cards | GET /api/tb/dashboard/summary |
| 4A.2 | Monthly trend + forecast | GET /api/tb/dashboard/monthly |
| 4A.3 | Barangay bar chart | GET /api/tb/dashboard/monthly (grouped) |
| 4A.4 | Treatment donut | GET /api/tb/dashboard/outcomes |
| 4A.5 | Age donut | GET /api/tb/dashboard/demographics |
| 4A.6 | Gender donut | GET /api/tb/dashboard/demographics |
| 4A.7 | GIS map | GET /api/tb/gis/choropleth |
| 4A.8 | Alerts list | GET /api/tb/alerts |
| 4A.9 | Forecast table | GET /api/tb/forecasts |

Pattern: API first, context fallback for offline/demo mode.

### 4B: TB Records

| # | Task | Source API |
|---|---|---|
| 4B.1 | Fetch records | GET /api/tb/cases with pagination + filters |
| 4B.2 | Pagination | Use pagination.totalPages |
| 4B.3 | Search/filter | Pass query params |
| 4B.4 | CSV export | Export from API data |
| 4B.5 | Add record | POST /api/tb/import |
| 4B.6 | Delete record | DELETE /api/tb/cases/:id (new endpoint) |

### 4C-4H: Other Pages

Each page switches from context data to API data with context fallback.

---

## Phase 5: ML Pipeline End-to-End

**Est. Time: 3-4 hours**

| # | Task |
|---|---|
| 5A.1 | Seed reference data |
| 5A.2 | Import first dataset |
| 5A.3 | Run pipeline (POST /api/tb/pipeline) |
| 5A.4 | Verify L4 tables populated |
| 5A.5 | Verify dashboard choropleth |
| 5B.1 | Dynamic thresholds (replace hardcoded 150/350) |
| 5B.2 | Store thresholds in model_metadata |
| 5C.1 | Auto-trigger pipeline after sync (optional) |

---

## Phase 6: Auth & User Management

**Est. Time: 2-3 hours**

| # | Task | Files |
|---|---|---|
| 6.1 | Fix role case mismatch (Admin vs admin) | Sidebar.jsx, Topbar.jsx |
| 6.2 | Add user edit endpoint PUT /api/auth/users/:id | routes/auth.js |
| 6.3 | Add password change PUT /api/auth/password | routes/auth.js |
| 6.4 | Extract shared authorizeRoles middleware | BACKEND/middleware/ |
| 6.5 | Frontend user edit | Users.jsx |
| 6.6 | Frontend password change | MyProfile.jsx |

---

## Phase 7: Deployment & CI

**Est. Time: 2-3 hours**

| # | Task | Files |
|---|---|---|
| 7.1 | Add backend tests to CI | ci.yml |
| 7.2 | Add ML Python tests to CI | ci.yml |
| 7.3 | Add lint to CI | ci.yml |
| 7.4 | Deploy ML service to Render | ML_SERVICE/render.yaml |
| 7.5 | Set ML_SERVICE_URL in Render | Render dashboard |
| 7.6 | Rotate leaked DB password | Render dashboard |
| 7.7 | Test production auth | Manual |
| 7.8 | Test production import | Manual |
| 7.9 | Test production pipeline | Manual |
| 7.10 | Document deployment steps | README.md |

---

## Phase 8: Polish & Documentation

**Est. Time: 1 hour**

| # | Task | File |
|---|---|---|
| 8.1 | Delete dead migration 001_tbinsight_data_layer.sql | Cleanup |
| 8.2 | Delete scratch_check_db.js | Cleanup |
| 8.3 | Add name to BACKEND/package.json | Fix |
| 8.4 | Fix FRONTEND/.env duplicate URL | Fix |
| 8.5 | Fix alert icon names (React vs Remix) | DashboardPage.jsx |
| 8.6 | Unify barangay lists into shared constant | New shared file |
| 8.7 | Update README with full architecture + setup | README.md |

---

## Summary

| Phase | New Files | Modified Files | Est. Time |
|---|---|---|---|
| 1: Fix Bugs | 1 | 3 | 1-2 hrs |
| 2: External System | 17 | 2 | 8-10 hrs |
| 3: Data Integration | 4 | 3 | 4-5 hrs |
| 4: Frontend -> Backend | 0 | 9 | 4-5 hrs |
| 5: ML Pipeline | 0 | 2 | 3-4 hrs |
| 6: Auth | 1 | 4 | 2-3 hrs |
| 7: Deployment | 0 | 2 | 2-3 hrs |
| 8: Polish | 0 | 7 | 1 hr |
| **Total** | **23 new files** | **32 modified** | **~25-33 hrs** |

---

## Execution Order

```
Phase 1 (bugs) -> Phase 2 (External System) -> Phase 3 (bridge)
                                                        |
Phase 6 (auth, parallel) ----------------------------->|
                                                        v
                                              Phase 4 (frontend connect)
                                                        |
                                                        v
                                              Phase 5 (ML pipeline)
                                                        |
                                                        v
                                              Phase 7 (deploy) -> Phase 8 (polish)
```
