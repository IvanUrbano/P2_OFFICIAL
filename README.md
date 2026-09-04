# TBInsight — TB Surveillance & GIS Mapping System

> A comprehensive tuberculosis surveillance, risk assessment, and GIS mapping system for Pasig City, featuring AI-powered forecasting, real-time hotspot detection, and automated alert management.

![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react)
![Express](https://img.shields.io/badge/Express-5-000000?style=flat&logo=express)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat&logo=vite)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-06B6D4?style=flat&logo=tailwindcss)

---

## Features

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

---

## Tech Stack

### Frontend
- **React 19** — UI framework
- **Vite 8** — Build tool & dev server
- **Tailwind CSS v4** — Utility-first CSS (CSS-first config, no tailwind.config.js)
- **Recharts** — Chart library for dashboard analytics
- **Leaflet + React-Leaflet** — Interactive GIS mapping
- **Axios** — HTTP client with interceptors
- **jsPDF + jspdf-autotable** — PDF report generation
- **xlsx (SheetJS)** — Excel export
- **file-saver** — Client-side file downloads

### Backend
- **Express 5** — REST API framework (async handlers auto-catch rejections)
- **PostgreSQL** — Primary database (via `pg` driver)
- **JWT** — Authentication (httpOnly cookies + Bearer tokens)
- **bcryptjs** — Password hashing
- **express-fileupload** — File upload handling (50MB limit)
- **express-rate-limit** — Login rate limiting
- **xlsx (SheetJS)** — CSV/Excel parsing on backend

### ML Service
- **Python FastAPI** — ML microservice framework
- **pmdarima** — ARIMA time series forecasting
- **scikit-learn** — Random Forest classification
- **statsmodels** — Statistical modeling
- **pandas + numpy** — Data processing
- **jenkspy** — Jenks natural breaks classification

### Deployment
- **Vercel** — Frontend hosting (SPA with rewrites)
- **Render** — Backend + ML service hosting (free tier)
- **GitHub Actions** — CI/CD (frontend build on push/PR)

---

## Architecture

### 4-Layer Data Architecture

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
CSV Import
  → parseCaseFile (validate, normalize, 18 columns)
  → importCases (tb_cases_raw + tb_cases)
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

### Installation

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

### Environment Variables

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

# CORS (optional)
FRONTEND_URL=http://localhost:5173
```

Create `FRONTEND/.env`:

```env
VITE_API_URL=http://localhost:5000
```

### Running Locally

```bash
# Start both backend + frontend concurrently
npm run dev

# Or start them separately:
npm run dev:backend    # Backend on port 5000
npm run dev:frontend   # Frontend on port 5173
```

### Database Setup

The database is auto-initialized on backend startup. Tables are created idempotently via `CREATE TABLE IF NOT EXISTS`.

To manually seed reference data (30 Pasig barangays):
```bash
curl -X POST http://localhost:5000/api/tb/barangays/seed
```

---

## Database Schema

### 16 Tables Across 4 Layers

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

### STIS Integration Fields (Migration 006)

| Field | Table | Description |
|---|---|---|
| `validation_status` | `tb_cases`, `tb_cases_raw` | "Validated" / "Not Validated" (DSTB only) |
| `itis_case_id` | `tb_cases`, `tb_cases_raw` | External STIS case ID (MN only) |
| `source_type` | `tb_cases`, `tb_cases_raw` | "DSTB" or "MN" discriminator |
| `location_classification` | `tb_cases`, `tb_cases_raw` | "Pasig City" or "Non-Pasig" |

---

## API Reference

### Authentication (`/api/auth/*`) — 8 Endpoints

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

### TBInsight (`/api/tb/*`) — 49 Endpoints

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

---

## Frontend Routes

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

### Backend Tests (~120 tests)

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
Frontend (Vercel)          Backend (Render)           ML Service (Render)
p2-official.vercel.app  →  p2-official.onrender.com  →  localhost:8001
     │                          │                          │
     │   React 19 SPA           │   Express 5 API          │   FastAPI
     │   Vite 8 Build           │   PostgreSQL              │   ARIMA + RF
     │   Tailwind v4            │   JWT Auth                │   scikit-learn
```

### Vercel (Frontend)

- **Config**: `FRONTEND/vercel.json` (SPA rewrites)
- **Root config**: `vercel.json` (monorepo build)
- **Build command**: `cd FRONTEND && npm install --no-package-lock && npm run build`
- **Output**: `FRONTEND/dist/`

### Render (Backend)

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

### CI/CD

- **GitHub Actions** (`.github/workflows/ci.yml`)
- **Trigger**: Push to `main`, PR to `main`
- **Steps**: Checkout → Node.js 22 → Install → Build frontend
- **Runner**: `ubuntu-latest`

---

## Project Structure

```
tb-system/
├── BACKEND/
│   ├── server.js                 # Express app setup
│   ├── db.js                     # PostgreSQL pool + auto-migration
│   ├── init.sql                  # Users table (idempotent)
│   ├── routes/
│   │   └── auth.js               # 8 auth endpoints
│   ├── tbinsight/
│   │   ├── routes.js             # 49 TBInsight endpoints
│   │   ├── parseCaseFile.js      # CSV/Excel parser (18 columns)
│   │   ├── importCases.js        # Transactional import
│   │   ├── aggregateMonthly.js   # Rebuild L3 summary tables
│   │   ├── barangays.js          # Reference data queries
│   │   ├── mlClient.js           # Python ML service client
│   │   ├── scoring.js            # Risk score computation
│   │   ├── pipeline.js           # Pipeline orchestration
│   │   └── alertEngine.js        # Rule-based alert evaluation
│   ├── middleware/
│   │   ├── auth.js               # JWT verification
│   │   └── rateLimiter.js        # Login rate limiting
│   ├── data/
│   │   ├── pasig-barangays.geojson
│   │   └── pasig-health-facilities.csv
│   ├── db/migrations/
│   │   ├── 002_tbinsight_full_schema.sql
│   │   └── 006_add_stis_fields.sql
│   └── test/
│       ├── auth.test.js
│       ├── middleware.test.js
│       └── tbinsight/
│           ├── parseCaseFile.test.js
│           ├── pipeline.test.js
│           └── routes.test.js
├── FRONTEND/
│   ├── src/
│   │   ├── App.jsx               # Router + routes
│   │   ├── main.jsx              # React root
│   │   ├── index.css             # Tailwind v4 theme
│   │   ├── theme.jsx             # Light/dark mode context
│   │   ├── api/axios.js          # Axios instance
│   │   ├── pages/                # 16 page components
│   │   └── utils/
│   │       ├── alertConstants.js
│   │       ├── exportReports.js
│   │       └── timeAgo.js
│   ├── components/
│   │   ├── Layout.jsx            # App layout wrapper
│   │   ├── Topbar.jsx            # Navigation bar
│   │   ├── Logo.jsx              # App logo
│   │   ├── FilterSelect.jsx      # Reusable filter dropdown
│   │   ├── ErrorBoundary.jsx     # Error boundary
│   │   └── SkeletonBlock.jsx     # Loading placeholder
│   ├── public/images/
│   │   ├── BACKGROUND.png
│   │   ├── tbinsight-logo.png
│   │   └── tbinsight-icon.png
│   └── vite.config.js
├── ML_SERVICE/
│   ├── main.py                   # FastAPI app
│   ├── routes.py                 # 6 ML endpoints
│   ├── models.py                 # Pydantic schemas
│   ├── config.py                 # Model configuration
│   ├── arima_forecast.py         # ARIMA forecasting
│   ├── rf_classifier.py          # Random Forest classifier
│   ├── thresholds.py             # Classification thresholds
│   ├── requirements.txt
│   └── tests/
├── .github/workflows/ci.yml      # CI/CD pipeline
├── package.json                  # Root workspace config
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
