# TBInsight + PASIG CLONE — Implementation Plan

**Last Updated**: September 2026  
**Status**: Core system complete; frontend pages and polish in progress

---

## What This System Is

**TBInsight** is a GIS-based predictive tuberculosis hotspot and resource-prioritization dashboard for the Pasig City Health Office. It ingests TB case data, runs ARIMA forecasting and Random Forest risk classification, and displays results on a choropleth map with barangay-level alerts.

**PASIG CLONE** is a separate data-importing system that receives Excel exports from the official Pasig TB-DOTS system, validates and deduplicates them, and pushes clean records into TBInsight via a signed webhook.

Both systems share a JWT-based authentication layer but have separate databases.

---

## System Overview

```
Pasig TB-DOTS Excel Export
         │
         ▼
 PASIG CLONE (port 5001/5174)
 ├─ Parse DSTB + MN sheets
 ├─ Validate records
 ├─ SHA256 duplicate detection
 ├─ Record classification (new/updated/duplicate)
 ├─ Audit logging
 └─ HMAC webhook → TBInsight
         │
         ▼
 TBInsight (port 3000/5173)
 ├─ Verify HMAC signature
 ├─ Idempotent upsert into tb_cases_raw + tb_cases
 ├─ Rebuild L3 aggregation tables
 ├─ (Optional) ML pipeline → L4 predictions + alerts
 └─ Dashboard / Map / Records / Alerts / Facilities
```

---

## Phase 1: TBInsight Core System ✅ COMPLETE

### 1.1 Authentication
- [x] Register, Login, Logout endpoints
- [x] JWT in httpOnly cookies + localStorage
- [x] Role-based access (admin / user)
- [x] Rate limiting on login (login_attempts table)
- [x] Audit logs for auth events

### 1.2 TB Case Import (TBInsight)
- [x] POST `/api/tb/import` — CSV / Excel file upload
- [x] Flexible header matching (tolerates column reordering, renamed headers)
- [x] Multi-sheet Excel support (DSTB + MN sheets)
- [x] Store verbatim rows in `tb_cases_raw` (Layer 1)
- [x] Parse, clean, validate into `tb_cases` (Layer 2)
- [x] Rebuild all 5 Layer 3 aggregation tables on each import

### 1.3 Data Aggregation (Layer 3)
Five summary tables rebuilt atomically on every successful import:
- [x] `monthly_case_summary` — cases per barangay per month
- [x] `demographic_summary` — age/sex breakdowns
- [x] `outcome_summary` — treatment outcomes (cured, completed, died, etc.)
- [x] `facility_summary` — cases per health facility
- [x] `bacteriological_summary` — TB type (bacteriologically confirmed, clinical, etc.)

### 1.4 ML Pipeline (Layer 4)
Triggered via POST `/api/tb/pipeline` or manually from dashboard:
- [x] Query monthly_case_summary + barangay_population
- [x] Build time series per barangay (30 barangays)
- [x] ARIMA forecast: 12-month horizon, auto-calibrated, with fallback chain
- [x] Compute 8 Random Forest features per barangay
- [x] Auto-calibrate risk thresholds via tertile method
- [x] Random Forest classification: Low / Medium / High risk
- [x] Weighted risk score: `0.45×incidence + 0.25×trend + 0.20×neighbor_risk + 0.10×forecast_error`
- [x] Upsert into `model_predictions`, `barangay_risk_scores`, `alerts`
- [x] Record run in `model_metadata`

### 1.5 GIS Map
- [x] PostGIS choropleth — barangay polygons colored by risk score
- [x] Overlay: health facilities, alert markers
- [x] 30 Pasig barangays with GeoJSON shapes

### 1.6 Dashboard
- [x] KPI cards: total cases, active cases, high-risk barangays, alert count
- [x] Monthly trend chart
- [x] Demographic breakdown
- [x] Outcome summary
- [x] Recent alerts

### 1.7 TB Records
- [x] Paginated table of all tb_cases
- [x] Filter by barangay, date range, TB type, outcome

### 1.8 Health Facilities
- [x] Grouped by barangay
- [x] Null/empty barangay_name normalized to `'Unassigned'` at backend (not frontend)
- [x] Flat list endpoint available

### 1.9 Alerts
- [x] List view of all active alerts
- [x] Severity levels: Low, Medium, High, Critical

### 1.10 Backend Tests
- [x] 80+ tests: auth, import parser, pipeline, webhook
- [x] Node.js built-in test runner + supertest

### 1.11 ML Service Tests
- [x] 52 tests: ARIMA, Random Forest, endpoints
- [x] Walk-forward temporal validation

---

## Phase 2: PASIG CLONE System ✅ COMPLETE

### 2.1 Authentication
- [x] Shared JWT with TBInsight — same token works on both systems
- [x] Login page in PASIG CLONE frontend

### 2.2 Excel Import
- [x] Upload Excel with 2 sheets: DSTB (18 columns) + MN (28 columns)
- [x] Multi-sheet parser
- [x] 500 MB file size limit

### 2.3 Duplicate Detection (File Level)
- [x] SHA256 hash calculated on upload
- [x] 409 Conflict returned if same file uploaded again
- [x] Previous batch info returned with conflict response

### 2.4 Record Validation
- [x] Required fields check
- [x] Date format validation
- [x] Barangay name matching
- [x] Record-level classification: new / updated / duplicate / existing

### 2.5 Audit Logging
- [x] Every import, validation, and sync logged to `audit_logs`
- [x] User ID extracted from JWT (not user input)
- [x] Tracks: who imported, who validated, who synced, timestamps

### 2.6 Webhook Sync
- [x] POST `/api/webhook/pasig-clone` on TBInsight
- [x] HMAC-SHA256 signature in `X-Webhook-Signature` header
- [x] TBInsight verifies signature before processing
- [x] Idempotent upsert on TBInsight side — no duplicate records created
- [x] Sync status tracking: pending → syncing → synced / sync_failed
- [x] Sync error captured and stored on failure
- [x] Exponential backoff retry logic

### 2.7 Import History Endpoint
- [x] GET `/api/data/import-history` — all batches, most recent first
- [x] Shows: filename, imported_by username, status, sync_status, timestamps

### 2.8 Enhanced Stats Endpoint
- [x] GET `/api/data/stats` returns org-wide counts + recentImports + latestSync + pendingActions

### 2.9 PASIG CLONE Frontend Pages
- [x] LoginPage
- [x] CsvImportPage (upload Excel)
- [x] ValidationPage (review records before sync)
- [x] WebhookStatusPage (send history)
- [x] ImportHistoryPage

### 2.10 Health Facilities Route (PASIG CLONE)
- [x] GET `/api/facilities` — returns facilities from shared DB (health_facilities table)
- [x] Grouped by barangay_name; null/empty → `'Unassigned'`

---

## Phase 3: Frontend Polish 🚧 IN PROGRESS

### 3.1 TBInsight Frontend — Remaining Pages

| Page | Route | Status | Notes |
|------|-------|--------|-------|
| Analytics | `/analytics` | 🚧 | Advanced visualizations, trend analysis |
| Data Integration | `/data-integration` | 🚧 | Import status, batch history, error review |
| Resource Prioritization | `/resources` | 🚧 | Risk-based resource allocation |
| Users (admin) | `/users` | 🚧 | User management, role assignment |
| Settings | `/settings` | 🚧 | Profile update, preferences |
| Register | (wire up route) | 🚧 | RegisterPage.jsx exists, needs route + nav link |

### 3.2 PASIG CLONE Frontend — Remaining Components

| Component | Status | Notes |
|-----------|--------|-------|
| Dashboard org-wide KPIs | 🚧 | recentImports, latestSync, pendingActions cards |
| Duplicate file detection UI | 🚧 | Show warning when 409 returned |
| Audit Trail component | 🚧 | View audit log entries |
| Sync error display | 🚧 | Show error message when sync_failed |
| Retry sync button | 🚧 | Re-trigger failed sync |
| "Validated By" display | 🚧 | Show on validation results |
| "Synced By" display | 🚧 | Show on sync history |

---

## Phase 4: Infrastructure & Code Quality 🗓️ BACKLOG

| Item | Priority | Impact |
|------|----------|--------|
| Frontend tests (Vitest + React Testing Library) | High | Regression prevention |
| Remove `dist/` from TBInsight repo | High | Cleaner git history |
| Centralized auth state (Context or Zustand) | Medium | Scalability |
| Route-level code splitting (React.lazy) | Medium | Initial load performance |
| `.env.example` files for both backends | Low | Developer onboarding |
| Move `components/` inside `src/` | Low | Convention |

---

## Database Reset (Both Systems)

Use `BACKEND/reset_data.js` — the single source of truth for cleaning data:

```bash
# Preview — shows row counts, deletes nothing
node reset_data.js

# Execute — deletes rows in both DBs (one transaction each, all-or-nothing)
node reset_data.js --confirm
```

**Kept (never touched):**
- `users` — login accounts (both DBs)
- `audit_logs`, `login_attempts` — security history
- `model_metadata` — pipeline run history
- `barangays`, `barangays_geom`, `health_facilities`, `barangay_population` — reference/map data
- PostGIS system tables

**Deleted:**
- `tb_cases_raw`, `tb_cases` — imported case records
- `monthly_case_summary`, `demographic_summary`, `outcome_summary`, `facility_summary`, `bacteriological_summary` — aggregated summaries
- `model_predictions`, `barangay_risk_scores`, `alerts` — ML predictions
- `webhook_logs` — webhook send history (TBInsight side)
- All corresponding PASIG CLONE tables (import_batches, validated_tb_cases, webhook_logs)

---

## Environment Variables

### BACKEND/.env (TBInsight)
```
AUTH_DATABASE_URL=postgresql://...@neon.tech/neondb    # Main DB
DATABASE_URL=...                                        # (legacy; some routes may use this)
JWT_SECRET=...
WEBHOOK_SECRET=...                                      # HMAC key for webhook verification
ML_SERVICE_URL=http://localhost:8001
PORT=3000
```

### PASIG_CLONE/backend/.env
```
DATABASE_URL=postgresql://...@neon.tech/pasig_clone_db  # PASIG CLONE DB
AUTH_DATABASE_URL=postgresql://...                       # Shared auth DB (same as TBInsight)
JWT_SECRET=...                                           # Must match TBInsight
WEBHOOK_SECRET=...                                       # Must match TBInsight
TBINSIGHT_WEBHOOK_URL=https://p2-official.onrender.com/api/webhook/pasig-clone
PORT=5001
```

---

## API Endpoints Summary

### TBInsight Backend

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, returns JWT cookie |
| POST | `/api/auth/logout` | Clear JWT cookie |
| GET | `/api/auth/me` | Current user info |
| POST | `/api/tb/import` | Import CSV/Excel case file |
| POST | `/api/tb/pipeline` | Trigger ML pipeline |
| GET | `/api/dashboard` | Dashboard KPIs and summaries |
| GET | `/api/tb/cases` | Paginated TB case records |
| GET | `/api/alerts` | Active alerts |
| GET | `/api/map/barangays` | Barangay GeoJSON + risk scores |
| GET | `/api/map/facilities` | Health facilities with coordinates |
| POST | `/api/webhook/pasig-clone` | Receive HMAC-signed data from PASIG CLONE |

### PASIG CLONE Backend

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login (validates against shared auth DB) |
| POST | `/api/data/import` | Upload Excel file (2 sheets) |
| GET | `/api/data/stats` | Org-wide import statistics |
| GET | `/api/data/import-history` | All import batches |
| POST | `/api/data/validate/:id` | Validate and classify records in batch |
| POST | `/api/webhook/send` | Send validated batch to TBInsight |
| GET | `/api/facilities` | Health facilities grouped by barangay |

---

## Key Implementation Notes

1. **Barangay name normalization**: Always normalize `null` or empty `barangay_name` to `'Unassigned'` at the backend before grouping or returning data. Never rely on the frontend to handle nulls.

2. **Idempotency**: The ML pipeline and webhook processing are both idempotent. Re-running the pipeline or re-sending a webhook will not create duplicate records — it overwrites existing data for the same time period.

3. **HMAC verification**: All webhooks from PASIG CLONE must include `X-Webhook-Signature: sha256=<hmac>`. TBInsight rejects unsigned or incorrectly signed requests with 401.

4. **File cleanup scripts**: Only `BACKEND/reset_data.js` should be used for data cleanup. `cleanup_data.sql` and `cleanup_tbinsight.js` are redundant legacy scripts — delete them.

5. **PASIG CLONE frontend DashboardPage.jsx**: The standalone `DashboardPage.jsx` in `PASIG_CLONE/frontend/src/pages/` is no longer routed — it should be deleted.

6. **dist/ in TBInsight**: The `FRONTEND/dist/` build output is currently committed to the repo — it should be removed and added to `.gitignore`.

7. **ML Service location**: In production, the ML Service runs on the same Render instance as the TBInsight backend (port 8001). In development, start it separately with `uvicorn`.

8. **CommonJS throughout**: Both backends use `require()`/`module.exports` (CommonJS). Do not introduce ES module syntax (`import`/`export`) without converting the entire backend.
