# TBInsight & Pasig Clone — TB Data Integration Platform

> A two-system tuberculosis data platform for Pasig City: **TBInsight** provides surveillance, GIS mapping, and statistical forecasting (ARIMA) with risk classification (Random Forest), while **Pasig Clone** handles data ingestion from DOH TB-DOTS registries and integrates with TBInsight via webhooks.

![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react)
![Express](https://img.shields.io/badge/Express-5-000000?style=flat&logo=express)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat&logo=vite)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-06B6D4?style=flat&logo=tailwindcss)

---

## System Overview

This repository contains two independent systems with **separate databases**, integrated via REST API / webhooks:

| System | Purpose | Port | Frontend |
|---|---|---|---|
| **TBInsight** | Surveillance dashboard, GIS mapping, ML forecasting, alerts | Backend: 5000, Frontend: 5173, ML: 8001 | React 19 + Vite 8 |
| **Pasig Clone** | Data ingestion from DOH TB-DOTS Excel exports, validation, webhook integration | Backend: 5001, Frontend: 5174 | React 18 + Vite 5 |

### Integration Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  Pasig TB-DOTS Registry                                            │
│  (Exports Excel file with DSTB + MN sheets)                        │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ Upload Excel
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PASIG CLONE SYSTEM (Port 5001 / 5174)                             │
│  Database: pasig_clone_db (separate Neon database)                  │
│                                                                     │
│  1. Parse multi-sheet Excel (DSTB + MN)                            │
│  2. Store raw records in import_batches + raw_tb_cases              │
│  3. Validate (barangay, sex, age, dates, facilities)               │
│  4. Store validated records in validated_tb_cases                   │
│  5. Send webhook to TBInsight with HMAC-SHA256 signature           │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ POST /api/webhook/pasig-clone
                           │ Header: X-Webhook-Secret: <secret>
                           │ Header: X-Webhook-Signature: sha256=<hmac>
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  TBINSIGHT SYSTEM (Port 5000 / 5173)                               │
│  Database: neondb (separate Neon database)                         │
│                                                                     │
│  1. Verify HMAC signature                                           │
│  2. Validate each record                                            │
│  3. Insert into tb_cases with source_type (DSTB/MN)                │
│  4. Rebuild aggregations (5 L3 summary tables)                     │
│  5. Log to webhook_logs                                             │
│  6. Dashboard + ML Pipeline reads L3 + L4 for analytics            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Features

### TBInsight Features

| Feature | Description |
|---|---|
| **Dashboard** | KPI cards, trend badges, monthly charts, demographic breakdowns, outcome analysis, facility analysis |
| **TB Records Management** | Paginated table with 10+ filters (barangay, year, month, sex, outcome, facility, bacteriological status, validation, source type, location), search, sort, CSV export |
| **GIS Hotspot Mapping** | Leaflet + PostGIS choropleth with polygon boundaries, risk overlays, barangay tooltips, dark mode tiles, spatial queries |
| **Analytics** | Demographics (age/sex), treatment outcomes, facility analysis, bacteriological status breakdowns |
| **Forecasting** | ARIMA time series forecasting with 12-month horizon, actual vs predicted charts, backtest results |
| **Risk Classification** | Random Forest with 8 engineered features, tertile/Jenks thresholds, probability outputs |
| **Reports** | Summary reports with PDF generation (jsPDF), CSV/Excel export, print-optimized styles |
| **Alerts & Notifications** | Rule-based alert engine (escalation, surge, hotspot, forecast), unified alerts+notifications, mark read/resolve |
| **Data Integration** | CSV/Excel upload with flexible 18-column parser, batch tracking, validation errors, auto-aggregation |
| **Intervention Planning** | CRUD for interventions, status tracking, counts by barangay |
| **User Management** | Admin-only registration, role-based access (admin/staff), profile management |
| **Authentication** | JWT in httpOnly cookies + localStorage, bcrypt hashing, login rate limiting |
| **Dark Mode** | Light/dark theme toggle with localStorage persistence, CSS variable overrides |
| **Print Support** | A4 print styles, hidden controls during print, GIS map print layout |
| **ML Pipeline** | End-to-end: CSV import → aggregation → ARIMA forecast → RF classification → risk scoring → alerts |
| **Walk-Forward Evaluation** | Temporal validation for ARIMA (MAE/MAPE) and RF (accuracy/F1/precision/recall) |

### Pasig Clone Features

| Feature | Description |
|---|---|
| **Multi-Sheet Excel Import** | Parse DOH TB-DOTS exports with DSTB and MN sheets, auto-detect sheet type |
| **Batch Tracking** | Import batches with status tracking (uploaded → validated → sent) |
| **Data Validation** | Validate against 30 Pasig barangays, sex/age/date checks, DSTB/MN-specific rules |
| **JWT Authentication** | Login/register with role-based access (admin/staff), httpOnly cookies |
| **Webhook Integration** | Send validated batches to TBInsight with HMAC-SHA256 signed payloads |
| **Webhook History** | Track webhook delivery status and response codes |

---

## Tech Stack

### TBInsight

#### Frontend
- **React 19** — UI framework
- **Vite 8** — Build tool & dev server
- **Tailwind CSS v4** — Utility-first CSS (CSS-first config, no tailwind.config.js)
- **Recharts** — Chart library for dashboard analytics
- **Leaflet + React-Leaflet** — Interactive GIS mapping
- **Axios** — HTTP client with interceptors
- **jsPDF + jspdf-autotable** — PDF report generation
- **xlsx (SheetJS)** — Excel export
- **file-saver** — Client-side file downloads

#### Backend
- **Express 5** — REST API framework (async handlers auto-catch rejections)
- **PostgreSQL** — Primary database (via `pg` driver)
- **JWT** — Authentication (httpOnly cookies + Bearer tokens)
- **bcryptjs** — Password hashing
- **express-fileupload** — File upload handling (50MB limit)
- **express-rate-limit** — Login rate limiting
- **xlsx (SheetJS)** — CSV/Excel parsing on backend

#### ML Service
- **Python FastAPI** — ML microservice framework
- **pmdarima** — ARIMA time series forecasting
- **scikit-learn** — Random Forest classification
- **statsmodels** — Statistical modeling
- **pandas + numpy** — Data processing
- **jenkspy** — Jenks natural breaks classification

### Pasig Clone

#### Frontend
- **React 18** — UI framework
- **Vite 5** — Build tool & dev server
- **Tailwind CSS v4** — Utility-first CSS
- **React Router v6** — Client-side routing
- **Axios** — HTTP client with JWT interceptors

#### Backend
- **Express 4** — REST API framework
- **PostgreSQL** — Separate PostgreSQL database (pasig_clone_db)
- **JWT** — Authentication (httpOnly cookies + Bearer tokens)
- **bcryptjs** — Password hashing
- **ExcelJS** — Multi-sheet Excel parsing
- **express-fileupload** — File upload handling
- **node-fetch** — HTTP client for webhook delivery
- **crypto** — HMAC-SHA256 signature generation

### Deployment
- **Vercel** — TBInsight frontend hosting (SPA with rewrites)
- **Render** — Backend + ML service + Pasig Clone hosting (free tier)
- **GitHub Actions** — CI/CD (frontend build on push/PR)

---

## Architecture

### TBInsight 4-Layer Data Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  L0 — Reference Data                                           │
│  barangays (30), health_facilities, barangays_geom (PostGIS)   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  L1 — Raw Import                                               │
│  tb_cases_raw (verbatim CSV rows for traceability)             │
└──────────────────────────┬──────────────────────────────────────┘
                           │  parseCaseFile → importCases
┌──────────────────────────▼──────────────────────────────────────┐
│  L2 — Cleaned Records                                          │
│  tb_cases (validated records for analytics)                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │  rebuildAggregations (GROUP BY)
┌──────────────────────────▼──────────────────────────────────────┐
│  L3 — Aggregated Tables                                        │
│  monthly_case_summary, demographic_summary, outcome_summary,   │
│  facility_summary, bacteriological_summary                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │  Pipeline (ARIMA + RF + Scoring)
┌──────────────────────────▼──────────────────────────────────────┐
│  L4 — Predictions & Analytics                                  │
│  model_predictions, barangay_risk_scores, alerts,              │
│  model_metadata                                                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Dashboard & Reports (React SPA)                               │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
CSV Import (TBInsight direct or Pasig Clone webhook)
  → parseCaseFile (validate, normalize, 18+ columns, source_type tagging)
  → importCases / webhook insert (tb_cases_raw + tb_cases)
  → rebuildAggregations (5 L3 summary tables)
  → Pipeline:
      → Query L3 + L0 → Build time series
      → ARIMA forecast (12-month horizon)
      → Compute 8 RF features
      → RF classification (High/Medium/Low)
      → Risk scoring (weighted index)
      → Store L4 + Generate alerts
  → Dashboard reads L3 + L4 → React renders
```

---

## Getting Started

### Prerequisites

- **Node.js** v18+ (tested with v24.16.0)
- **PostgreSQL** 14+ with PostGIS extension
- **Python** 3.10+ (for ML service, optional)
- **npm** (for workspaces)

### TBInsight Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/tb-system.git
cd tb-system

# Install all dependencies (root + BACKEND + FRONTEND)
npm install

# Set up environment variables
cp BACKEND/.env.example BACKEND/.env
# Edit BACKEND/.env with your database credentials
```

#### TBInsight Environment Variables

Create `BACKEND/.env`:

```env
# Database
DB_USER=postgres
DB_HOST=localhost
DB_NAME=tb_system
DB_PASSWORD=your_password
DB_PORT=5432
# Or use full connection string (production):
# DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Server
PORT=5000
NODE_ENV=development

# Authentication
JWT_SECRET=your_secret_key_here
JWT_EXPIRES_IN=7d

# Rate Limiting
LOGIN_LIMIT_WINDOW_MINS=15
LOGIN_LIMIT_MAX=5

# ML Service (optional)
ML_SERVICE_URL=http://localhost:8001

# CORS
FRONTEND_URL=http://localhost:5173

# Webhook (Pasig Clone integration)
WEBHOOK_SECRET=shared_secret_with_pasig_clone
```

Create `FRONTEND/.env`:

```env
VITE_API_URL=http://localhost:5000
```

#### Running TBInsight

```bash
# Start both backend + frontend concurrently
npm run dev

# Or start them separately:
npm run dev:backend    # Backend on port 5000
npm run dev:frontend   # Frontend on port 5173
```

### Pasig Clone Installation

```bash
# Install backend dependencies
cd PASIG_CLONE/backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

#### Pasig Clone Environment Variables

Create `PASIG_CLONE/backend/.env`:

```env
# Server
PORT=5001
NODE_ENV=development

# PostgreSQL (SEPARATE database from TBInsight — create in Neon dashboard)
DATABASE_URL=postgresql://user:password@localhost:5432/pasig_clone_db?sslmode=require

# Authentication
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d

# Webhook (TBInsight integration)
TBINSIGHT_WEBHOOK_URL=http://localhost:5000/api/webhook/pasig-clone
WEBHOOK_SECRET=shared_secret_with_tbinsight

# CORS
FRONTEND_URL=http://localhost:5174
```

Create `PASIG_CLONE/frontend/.env`:

```env
VITE_API_URL=http://localhost:5001
```

#### Running Pasig Clone

```bash
# Start backend (port 5001)
cd PASIG_CLONE/backend
npm run dev

# Start frontend (port 5174) — in a separate terminal
cd PASIG_CLONE/frontend
npm run dev
```

### Database Setup

The database is auto-initialized on backend startup. Tables are created idempotently via `CREATE TABLE IF NOT EXISTS`.

- **TBInsight** creates 14 tables in the `public` schema
- **Pasig Clone** creates 5 tables in the `pasig_clone` schema
- **Webhook logs** table is created in `public` schema by migration 007

To manually seed reference data (30 Pasig barangays):
```bash
curl -X POST http://localhost:5000/api/tb/barangays/seed
```

---

## Database Schema

### 21 Tables Across 2 Separate Databases

#### TBInsight Database — `neondb` (16 tables, `public` schema)

| Layer | Table | Purpose |
|---|---|---|
| **L0** | `barangays` | 30 Pasig City barangays with population and centroids |
| **L0** | `health_facilities` | Facility-to-barangay mapping |
| **L0** | `barangays_geom` | PostGIS polygons for map rendering |
| **L1** | `tb_cases_raw` | Verbatim CSV rows for traceability |
| **L2** | `tb_cases` | Validated records for analytics (18+ columns) |
| **L2** | `users` | User authentication and roles |
| **L3** | `monthly_case_summary` | Cases per barangay per month |
| **L3** | `demographic_summary` | Age/sex breakdowns per barangay |
| **L3** | `outcome_summary` | Treatment outcomes per barangay |
| **L3** | `facility_summary` | Cases per facility per barangay |
| **L3** | `bacteriological_summary` | TB type breakdowns per barangay |
| **L4** | `model_predictions` | ARIMA forecasts + RF classifications |
| **L4** | `barangay_risk_scores` | Weighted risk scores (0-100) |
| **L4** | `alerts` | Generated alerts + notifications |
| **L4** | `model_metadata` | Pipeline run tracking |
| **WH** | `webhook_logs` | Incoming webhook tracking from Pasig Clone |

#### Pasig Clone Database — `pasig_clone_db` (5 tables, `public` schema)

| Table | Purpose |
|---|---|
| `users` | Pasig Clone user accounts (admin/staff) |
| `import_batches` | Import batch tracking with status and counts |
| `raw_tb_cases` | Raw parsed records from Excel (JSONB storage) |
| `validated_tb_cases` | Validated records ready for webhook delivery |
| `webhook_logs` | Webhook delivery history |

### STIS Integration Fields (Migration 006)

| Field | Table | Description |
|---|---|---|
| `validation_status` | `tb_cases`, `tb_cases_raw` | "Validated" / "Not Validated" (DSTB only) |
| `itis_case_id` | `tb_cases`, `tb_cases_raw` | External STIS case ID (MN only) |
| `source_type` | `tb_cases`, `tb_cases_raw` | "DSTB" or "MN" discriminator |
| `location_classification` | `tb_cases`, `tb_cases_raw` | "Pasig City" or "Non-Pasig" |

---

## API Reference

### TBInsight — Authentication (`/api/auth/*`) — 8 Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/register` | admin | Register new user |
| POST | `/login` | none | Login (rate limited) |
| POST | `/logout` | none | Logout |
| GET | `/profile` | any | Get profile |
| PUT | `/profile` | any | Update profile |
| PUT | `/password` | any | Change password |
| GET | `/users` | admin | List all users |
| DELETE | `/users/:id` | admin | Delete user |

### TBInsight — TBInsight (`/api/tb/*`) — 49 Endpoints

#### Reference Data
| Method | Endpoint | Description |
|---|---|---|
| GET | `/barangays` | List 30 barangays with population |
| GET | `/facilities` | List health facilities |
| GET | `/filter-options` | Dropdown filter values |
| POST | `/barangays/seed` | Seed reference data (admin) |

#### Import
| Method | Endpoint | Description |
|---|---|---|
| POST | `/import` | Upload CSV/Excel (admin, 50MB limit) |
| GET | `/import-history` | Past imports (admin) |
| GET | `/import/:batchId/errors` | Batch validation errors (admin) |

#### Case Records
| Method | Endpoint | Description |
|---|---|---|
| GET | `/cases` | List records with 10+ filters, pagination, sort |
| GET | `/cases/export` | Export filtered records as CSV |

#### Dashboard Analytics
| Method | Endpoint | Description |
|---|---|---|
| GET | `/dashboard/summary` | Key metrics (total, active, success rate) |
| GET | `/dashboard/monthly` | Monthly trend data |
| GET | `/dashboard/barangay/:name` | Per-barangay breakdown |
| GET | `/dashboard/demographics` | Age/sex distributions |
| GET | `/dashboard/outcomes` | Treatment outcomes |
| GET | `/dashboard/facilities` | Cases per facility |
| GET | `/dashboard/bacteriological` | Bacteriological status |

#### GIS
| Method | Endpoint | Description |
|---|---|---|
| GET | `/gis/geojson` | Full GeoJSON with polygons + risk data |
| GET | `/gis/years` | Available years for filter |
| GET | `/gis/barangay-at` | Spatial point-in-polygon query |
| GET | `/gis/areas` | Barangay areas in km² |
| GET | `/gis/choropleth` | Choropleth risk data |

#### Forecasting & Predictions
| Method | Endpoint | Description |
|---|---|---|
| GET | `/forecasts` | ARIMA predictions |
| GET | `/forecast/actual-vs-predicted` | Actual vs predicted chart data |
| GET | `/forecast/backtest` | Backtest results |
| GET | `/predictions/risk` | RF risk classifications |
| GET | `/barangays/watchlist` | Barangay risk watchlist table |

#### Alerts & Notifications
| Method | Endpoint | Description |
|---|---|---|
| GET | `/alerts` | Alerts with filtering/pagination |
| GET | `/alerts/:id` | Single alert detail |
| GET | `/alerts/counts` | Summary counts (critical, high, unread, today) |
| GET | `/alerts/unread-count` | Unread count for bell badge |
| GET | `/alerts/stale-check` | Check if alerts need re-evaluation |
| PUT | `/alerts/:id/read` | Mark alert as read |
| PUT | `/alerts/read-all` | Mark all alerts as read |
| PUT | `/alerts/:id/resolve` | Resolve alert |
| POST | `/alerts/evaluate` | Trigger alert evaluation (admin) |

#### Pipeline & ML
| Method | Endpoint | Description |
|---|---|---|
| POST | `/pipeline` | Run full prediction pipeline (admin) |
| GET | `/pipeline/status` | Latest pipeline status |
| POST | `/evaluate` | Walk-forward evaluation (admin) |
| PUT | `/predictions/backfill` | Backfill predictions (admin) |
| GET | `/ml/health` | Python ML service health |

#### Reports
| Method | Endpoint | Description |
|---|---|---|
| GET | `/reports/summary` | Report summary data (monthly, quarterly, annual, barangay) |

#### Interventions
| Method | Endpoint | Description |
|---|---|---|
| GET | `/interventions` | List interventions |
| GET | `/interventions/counts` | Intervention counts |
| GET | `/interventions/:id` | Single intervention |
| POST | `/interventions` | Create intervention |
| PUT | `/interventions/:id` | Update intervention |
| POST | `/interventions/:id/complete` | Mark complete |
| DELETE | `/interventions/:id` | Delete intervention |

### TBInsight — Webhook (`/api/webhook/*`) — 1 Endpoint

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/pasig-clone` | HMAC | Receive webhook from Pasig Clone |

### Pasig Clone — Authentication (`/api/auth/*`) — 4 Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/register` | admin | Create new user |
| POST | `/login` | none | Login, get JWT |
| GET | `/profile` | any | Current user info |
| POST | `/logout` | none | Clear cookie |

### Pasig Clone — Data (`/api/data/*`) — 3 Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/import` | staff+ | Upload Excel (DSTB + MN sheets) |
| GET | `/batches` | staff+ | List all import batches |
| GET | `/batches/:id` | staff+ | Batch details with raw records |

### Pasig Clone — Validation (`/api/data/*`) — 1 Endpoint

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/validate/:batchId` | staff+ | Validate batch, store in validated_tb_cases |

### Pasig Clone — Webhook (`/api/webhook/*`) — 2 Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/send` | admin | Send validated batch to TBInsight |
| GET | `/logs` | admin | Webhook delivery history |

### Pasig Clone — Health — 1 Endpoint

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | none | Health check |

---

## Frontend Routes

### TBInsight Routes (14 routes)

| Route | Component | Description |
|---|---|---|
| `/login` | LoginPage | Login page |
| `/dashboard` | DashboardPage | Main dashboard with KPIs and charts |
| `/records` | TBRecords | TB case records table with filters |
| `/analytics` | Analytics | Demographics, outcomes, facility analysis |
| `/forecasting` | Forecasting | ARIMA forecast visualizations |
| `/gis-map` | GisMap | Interactive GIS choropleth map |
| `/reports` | Reports | Report generation and export |
| `/data-integration` | DataIntegration | CSV/Excel import and batch management |
| `/interventions` | InterventionPlanning | Intervention CRUD and tracking |
| `/alert` | Alert | Alert detail view |
| `/notifications` | Notifications | Notification center |
| `/users` | Users | User management (admin) |
| `/settings` | Settings | Application settings |
| `/profile` | Profile | User profile management |

### Pasig Clone Routes (4 routes)

| Route | Component | Description |
|---|---|---|
| `/login` | LoginPage | Login form |
| `/` | CsvImportPage | Upload Excel files, view batch results |
| `/validate` | ValidationPage | Validate batch, view summary and errors |
| `/webhook` | WebhookStatusPage | Send batch to TBInsight, view delivery history |

---

## ML Pipeline

### ARIMA Forecasting

- **Seasonal period**: 12 (monthly, annual seasonality)
- **Minimum history**: 24 months
- **Fallback chain**: ARIMA → Exponential Smoothing → Seasonal Naive
- **Configuration**: `auto_arima(seasonal=True, stepwise=True, max_order=8)`
- **Output**: 12-month forecast with 95% confidence intervals

### Random Forest Classification

**8 Engineered Features:**

| # | Feature | Description |
|---|---|---|
| 1 | `forecasted_incidence` | Annualized incidence per 100k |
| 2 | `recent_trend` | Linear regression slope (12-month window) |
| 3 | `seasonality_flag` | 1 if autocorrelation at lag 12 > 0.3 |
| 4 | `lag_1m` | Case count 1 month ago |
| 5 | `lag_2m` | Case count 2 months ago |
| 6 | `lag_3m` | Case count 3 months ago |
| 7 | `neighbor_risk` | Average incidence of other barangays, normalized [0,1] |
| 8 | `historical_bias` | AVG(\|actual - forecasted\|) from past predictions |

**Configuration**: `n_estimators=300, max_depth=8, class_weight="balanced"`

### Risk Scoring Formula

```
risk_score = 0.45 × normalized_incidence
           + 0.25 × normalized_trend
           + 0.20 × neighbor_risk
           + 0.10 × normalized_forecast_error

Score × 100 → [0, 100]
Classification: Low (≤33), Medium (≤66), High (>66)
```

### Alert Rules

| Alert Type | Condition | Source |
|---|---|---|
| `case_increase` | ≥20% month-over-month increase | analytics |
| `high_risk_escalation` | Medium → High risk transition | analytics |
| `high_risk_hotspot` | High risk classification | gis |
| `forecast_exceeds_threshold` | Forecasted incidence > 4,200/100k | forecasting |
| `low_treatment_success` | Success rate < 85% | analytics |

---

## Testing

### TBInsight Backend Tests (~120 tests)

```bash
cd BACKEND
npm test
```

| Test File | Tests | What's Tested |
|---|---|---|
| `test/auth.test.js` | 36 | Login, register, logout, profile, user management |
| `test/middleware.test.js` | 11 | JWT validation, token formats, security |
| `test/tbinsight/parseCaseFile.test.js` | 21 | Header matching, column mapping, validation |
| `test/tbinsight/pipeline.test.js` | 19 | Risk scoring, alert generation, features |
| `test/tbinsight/routes.test.js` | ~33 | All major API endpoints |
| `test/webhook.test.js` | 6 | Webhook endpoint, HMAC verification, payload validation |

### Pasig Clone Backend Tests (34 tests)

```bash
cd PASIG_CLONE/backend
node --test test/multiSheetParser.test.js
```

| Test File | Tests | What's Tested |
|---|---|---|
| `test/multiSheetParser.test.js` | 34 | parseDate, normalizeSex, detectSheetType, buildColumnMap, validateRecord, VALID_BARANGAYS |

### ML Service Tests (52 tests)

```bash
cd ML_SERVICE
pytest
```

| Test File | Tests | What's Tested |
|---|---|---|
| `tests/test_thresholds.py` | 6 | Classification boundaries, tertile splits |
| `tests/test_arima.py` | 14 | Fallback detection, forecasting, trends |
| `tests/test_rf.py` | 16 | Feature validation, RF prediction, evaluation |
| `tests/test_endpoints.py` | 16 | All 6 FastAPI endpoints |

### Frontend Lint

```bash
cd FRONTEND
npm run lint
```

---

## Deployment

### Architecture

```
TBInsight Frontend (Vercel)     TBInsight Backend (Render)      ML Service (Render)
p2-official.vercel.app       →  p2-official.onrender.com      →  localhost:8001
     │                              │                              │
     │   React 19 SPA               │   Express 5 API              │   FastAPI
     │   Vite 8 Build               │   PostgreSQL                  │   ARIMA + RF
     │   Tailwind v4                │   JWT Auth                    │   scikit-learn

Pasig Clone Frontend (Render)  Pasig Clone Backend (Render)
pasig-clone-frontend.onrender  →  pasig-clone-backend.onrender
     │                              │
     │   React 18 SPA               │   Express 4 API
     │   Vite 5 Build               │   PostgreSQL (pasig_clone_db)
     │   Tailwind v4                │   JWT + HMAC Auth
```

### Vercel (TBInsight Frontend)

- **Config**: `FRONTEND/vercel.json` (SPA rewrites)
- **Root config**: `vercel.json` (monorepo build)
- **Build command**: `cd FRONTEND && npm install --no-package-lock && npm run build`
- **Output**: `FRONTEND/dist/`

### Render (TBInsight Backend)

- **Config**: `BACKEND/render.yaml`
- **Service**: `tb-system-backend` (Node.js, free tier)
- **Build**: `npm install`
- **Start**: `npm start`
- **Auto-migrations**: Run on startup via `db.js`

### Render (ML Service)

- **Config**: `ML_SERVICE/render.yaml`
- **Service**: `tb-system-ml` (Python, free tier)
- **Build**: `pip install -r requirements.txt`
- **Start**: `uvicorn main:app --host 0.0.0.0 --port $PORT`

### Render (Pasig Clone Backend)

- **Service**: `pasig-clone-backend` (Node.js, free tier)
- **Build**: `cd PASIG_CLONE/backend && npm install`
- **Start**: `cd PASIG_CLONE/backend && node server.js`
- **Env vars**: `DATABASE_URL` (points to `pasig_clone_db` — separate database), `JWT_SECRET`, `WEBHOOK_SECRET` (must match TBInsight's value — set manually, not generated), `TBINSIGHT_WEBHOOK_URL`

### Render (Pasig Clone Frontend)

- **Service**: `pasig-clone-frontend` (Node.js, free tier)
- **Build**: `cd PASIG_CLONE/frontend && npm install && npm run build`
- **Start**: `cd PASIG_CLONE/frontend && npm run preview -- --host 0.0.0.0`
- **Env vars**: `VITE_API_URL` (points to Pasig Clone backend)

### CI/CD

- **GitHub Actions** (`.github/workflows/ci.yml`)
- **Trigger**: Push to `main`, PR to `main`
- **Steps**: Checkout → Node.js 22 → Install → Build frontend
- **Runner**: `ubuntu-latest`

---

## Project Structure

```
tb-system/
├── BACKEND/                              # TBInsight Backend
│   ├── server.js                         # Express app setup
│   ├── db.js                             # PostgreSQL pool + auto-migration
│   ├── init.sql                          # Users table (idempotent)
│   ├── routes/
│   │   └── auth.js                       # 8 auth endpoints
│   ├── tbinsight/
│   │   ├── routes.js                     # 49 TBInsight endpoints
│   │   ├── parseCaseFile.js              # CSV/Excel parser (multi-sheet, 18+ columns)
│   │   ├── importCases.js                # Transactional import
│   │   ├── aggregateMonthly.js           # Rebuild L3 summary tables
│   │   ├── barangays.js                  # Reference data queries
│   │   ├── mlClient.js                   # Python ML service client
│   │   ├── scoring.js                    # Risk score computation
│   │   ├── pipeline.js                   # Pipeline orchestration
│   │   ├── alertEngine.js                # Rule-based alert evaluation
│   │   └── webhook.js                    # Webhook endpoint (Pasig Clone)
│   ├── middleware/
│   │   ├── auth.js                       # JWT verification
│   │   ├── rateLimiter.js                # Login rate limiting
│   │   └── webhookAuth.js                # HMAC webhook verification
│   ├── data/
│   │   ├── pasig-barangays.geojson
│   │   └── pasig-health-facilities.csv
│   ├── db/migrations/
│   │   ├── 002_tbinsight_full_schema.sql
│   │   ├── 006_add_stis_fields.sql
│   │   └── 007_webhook_logs.sql
│   └── test/
│       ├── auth.test.js
│       ├── middleware.test.js
│       ├── webhook.test.js
│       └── tbinsight/
│           ├── parseCaseFile.test.js
│           ├── pipeline.test.js
│           └── routes.test.js
├── FRONTEND/                             # TBInsight Frontend
│   ├── src/
│   │   ├── App.jsx                       # Router + routes
│   │   ├── main.jsx                      # React root
│   │   ├── index.css                     # Tailwind v4 theme
│   │   ├── theme.jsx                     # Light/dark mode context
│   │   ├── api/axios.js                  # Axios instance
│   │   ├── pages/                        # 16 page components
│   │   └── utils/
│   │       ├── alertConstants.js
│   │       ├── exportReports.js
│   │       └── timeAgo.js
│   ├── components/
│   │   ├── Layout.jsx                    # App layout wrapper
│   │   ├── Topbar.jsx                    # Navigation bar
│   │   ├── Logo.jsx                      # App logo
│   │   ├── FilterSelect.jsx              # Reusable filter dropdown
│   │   ├── ErrorBoundary.jsx             # Error boundary
│   │   └── SkeletonBlock.jsx             # Loading placeholder
│   └── vite.config.js
├── PASIG_CLONE/                          # Pasig Clone System
│   ├── backend/
│   │   ├── server.js                     # Express app (port 5001)
│   │   ├── init.sql                      # 5 tables in pasig_clone schema
│   │   ├── config/index.js               # Config (port, db, jwt, webhook)
│   │   ├── db/
│   │   │   └── pasigSchema.js            # Schema init + CRUD helpers
│   │   ├── middleware/
│   │   │   └── auth.js                   # JWT verification + roles
│   │   ├── routes/
│   │   │   ├── auth.js                   # Login, register, profile
│   │   │   ├── csvImport.js              # Upload Excel, batch tracking
│   │   │   ├── validation.js             # Validate batch
│   │   │   └── webhook.js               # Send batch, view logs
│   │   ├── services/
│   │   │   ├── multiSheetParser.js       # ExcelJS multi-sheet parser
│   │   │   ├── validator.js              # Validation rules (30 barangays)
│   │   │   └── webhookSender.js          # HMAC-signed webhook delivery
│   │   └── test/
│   │       └── multiSheetParser.test.js  # 34 unit tests
│   └── frontend/
│       ├── src/
│       │   ├── App.jsx                   # BrowserRouter + routes
│       │   ├── main.jsx                  # React root
│       │   ├── index.css                 # Tailwind v4
│       │   ├── api/axios.js              # Axios with JWT interceptor
│       │   ├── components/
│       │   │   ├── Layout.jsx            # Top navbar layout
│       │   │   └── ProtectedRoute.jsx    # Auth guard
│       │   └── pages/
│       │       ├── LoginPage.jsx         # Login form
│       │       ├── CsvImportPage.jsx     # Upload Excel
│       │       ├── ValidationPage.jsx    # Validate batch
│       │       └── WebhookStatusPage.jsx # Send + webhook history
│       └── vite.config.js
├── ML_SERVICE/                           # Python ML Microservice
│   ├── main.py                           # FastAPI app
│   ├── routes.py                         # 6 ML endpoints
│   ├── models.py                         # Pydantic schemas
│   ├── config.py                         # Model configuration
│   ├── arima_forecast.py                 # ARIMA forecasting
│   ├── rf_classifier.py                  # Random Forest classifier
│   ├── thresholds.py                     # Classification thresholds
│   ├── requirements.txt
│   └── tests/
├── .github/workflows/ci.yml              # CI/CD pipeline
├── package.json                          # Root workspace config
├── render.yaml                           # Render deployment config
├── README.md
└── LICENSE
```

---

## License

This project is licensed under the MIT License.

---

## Acknowledgments

- **Pasig City TB Program** — Data and domain expertise
- **ARIMA (pmdarima)** — Time series forecasting
- **Scikit-learn** — Random Forest classification
- **Leaflet** — Interactive map rendering
- **PostGIS** — Spatial database extensions
