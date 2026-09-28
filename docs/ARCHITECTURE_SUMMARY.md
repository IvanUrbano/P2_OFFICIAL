# TBInsight — System Architecture Summary

**Last Updated**: September 2026  
**System**: GIS-Based Predictive TB Hotspot & Resource Prioritization Dashboard — Pasig City Health Office

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│               PASIG CLONE (External Data Importing System)           │
│          Port: 5001 (backend) · 5174 (frontend)                      │
│          DB:   pasig_clone_db (Neon PostgreSQL)                       │
│                                                                      │
│  [Excel Upload] → [Parse DSTB + MN Sheets] → [Validate Records]     │
│        → [Duplicate Detection (SHA256)] → [Audit Logging]            │
│        → [HMAC Webhook] ──────────────────────────────────────────┐  │
└──────────────────────────────────────────────────────────────────┼──┘
                                                                   │
                            POST /api/webhook/pasig-clone          │
                            Header: X-Webhook-Signature: sha256=…  │
                                                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    TBInsight (Main System)                           │
│                                                                      │
│  FRONTEND  ──────────────────────────────────────────────────────┐   │
│  React 19 + Vite 8                                               │   │
│  Vercel: p2-official.vercel.app                                  │   │
│  ┌───────────┬───────────┬──────────┬──────────┬──────────────┐  │   │
│  │ Dashboard │ TB Records│  GIS Map │  Alerts  │ Health Facil │  │   │
│  │    ✅     │    ✅     │    ✅    │    ✅    │     ✅       │  │   │
│  └───────────┴───────────┴──────────┴──────────┴──────────────┘  │   │
│                              │ HTTP REST API                     │   │
│  BACKEND  ───────────────────┘                                   │   │
│  Express.js 5                                                    │   │
│  Render: p2-official.onrender.com                                │   │
│  ┌────────────┬─────────────┬─────────────┬─────────────────┐   │   │
│  │ Auth (JWT) │ TB Import   │  Dashboard  │ GIS / PostGIS   │   │   │
│  │ Register   │ CSV/Excel   │  KPIs       │ Choropleth map  │   │   │
│  │ Login      │ Validation  │  Aggregation│ Barangay geom   │   │   │
│  └────────────┴─────────────┴─────────────┴─────────────────┘   │   │
│  ┌─────────────────────────────────────────────────────────┐     │   │
│  │           Pipeline Orchestrator (pipeline.js)           │     │   │
│  │  L3 query → ML service → L4 store → Alert generation   │     │   │
│  └─────────────────────────────────────────────────────────┘     │   │
│                │ HTTP                                             │   │
│  ML SERVICE ───┘                                                 │   │
│  Python FastAPI — Port 8001                                      │   │
│  • ARIMA Forecasting (12-month horizon, auto-calibration)        │   │
│  • Random Forest Classifier (8 features, Low/Med/High risk)      │   │
│  • Walk-forward temporal validation                              │   │
│  • Rule-based fallback when ML unavailable                       │   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  PostgreSQL 14 + PostGIS  (Neon)                     │
│  AUTH_DATABASE_URL — shared auth DB (TBInsight users live here)      │
│                                                                      │
│  L0 Reference       L1 Raw           L2 Cleaned      L3 Aggregated  │
│  • barangays        • tb_cases_raw   • tb_cases       • monthly_case │
│  • health_facilities                • users            _summary      │
│  • barangays_geom                                    • demographic   │
│  • barangay_popul.                                     _summary      │
│                                                      • outcome       │
│                                                        _summary      │
│                                                      • facility      │
│                                                        _summary      │
│                                                      • bacteriolog.  │
│                                                        _summary      │
│                                                                      │
│  L4 Predictions                                                      │
│  • model_predictions  • barangay_risk_scores  • alerts              │
│  • model_metadata                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Services

### TBInsight Backend (Express.js 5)
- **Port**: 3000 (dev) / Render (prod)
- **Database**: `AUTH_DATABASE_URL` — Neon PostgreSQL + PostGIS
- **Auth**: JWT in httpOnly cookies + localStorage
- **File Upload**: express-fileupload (50 MB limit)
- **Tests**: Node.js built-in test runner + supertest (80+ tests)

### TBInsight Frontend (React 19 + Vite 8)
- **Port**: 5173 (dev) / Vercel (prod)
- **Styling**: Tailwind CSS v4 (CSS-first config)
- **Charts**: Recharts
- **Maps**: Leaflet + react-leaflet
- **Routing**: react-router-dom v7

### ML Service (Python FastAPI)
- **Port**: 8001 (local / same server as backend)
- **Models**: ARIMA (pmdarima) + Random Forest (scikit-learn)
- **Evaluation**: Walk-forward temporal validation (52 tests)
- **Fallback**: Rule-based risk classification when ML unavailable

### PASIG CLONE Backend (Express.js)
- **Port**: 5001 (dev)
- **Database**: `DATABASE_URL` — separate Neon PostgreSQL (`pasig_clone_db`)
- **Auth**: Shared JWT; users verified against TBInsight auth DB
- **Purpose**: Receives Excel exports from Pasig TB-DOTS system, validates, and pushes data to TBInsight via HMAC-signed webhook

---

## Database Schema

### TBInsight DB (AUTH_DATABASE_URL)

#### Layer 0 — Reference Data (never deleted by reset_data.js)
| Table | Description |
|-------|-------------|
| `barangays` | 30 Pasig barangays: name, population, centroid |
| `barangays_geom` | PostGIS polygons for spatial queries |
| `health_facilities` | 39 health facilities mapped to barangays |
| `barangay_population` | Population per barangay |

#### Layer 1 — Raw Import
| Table | Description |
|-------|-------------|
| `tb_cases_raw` | Verbatim CSV/Excel rows — audit trail |

#### Layer 2 — Cleaned
| Table | Description |
|-------|-------------|
| `tb_cases` | 16-column validated records for analytics |
| `users` | id, username, email, password_hash, role |

#### Layer 3 — Aggregated (rebuilt on each import)
| Table | Description |
|-------|-------------|
| `monthly_case_summary` | Cases per barangay per month |
| `demographic_summary` | Age/sex breakdowns |
| `outcome_summary` | Treatment outcomes |
| `facility_summary` | Cases per health facility |
| `bacteriological_summary` | TB type breakdowns |

#### Layer 4 — Predictions (rebuilt by ML pipeline)
| Table | Description |
|-------|-------------|
| `model_predictions` | ARIMA forecasts + RF classifications + actuals |
| `barangay_risk_scores` | Weighted risk scores for choropleth |
| `alerts` | Generated alerts with severity level |
| `model_metadata` | Pipeline run tracking (kept across resets) |

#### Security / Audit (never deleted)
| Table | Description |
|-------|-------------|
| `audit_logs` | Security and action history |
| `login_attempts` | Failed login tracking for rate limiting |

---

### PASIG CLONE DB (DATABASE_URL)
| Table | Description |
|-------|-------------|
| `import_batches` | One row per uploaded Excel file; tracks file_hash, status, sync_status, who did what |
| `validated_tb_cases` | Parsed + validated records with record_status (new/updated/duplicate) |
| `webhook_logs` | Log of every webhook send attempt |
| `audit_logs` | Full action audit trail (import, validate, sync) |
| `users` | PASIG CLONE user accounts |

---

## ML Pipeline Flow

```
1. Query L3 (monthly_case_summary) + L0 (barangay_population)
   │
   ▼
2. Build time series per barangay (30 barangays)
   │
   ▼
3. POST /forecast (Python ARIMA) → 12-month predictions per barangay
   │
   ▼
4. Compute 8 Random Forest features per barangay:
   • rolling_12m_incidence     • lag_1m
   • recent_trend             • lag_2m
   • seasonality_flag         • lag_3m
   • neighbor_risk            • historical_bias
   │
   ▼
5. Auto-calibrate risk thresholds (tertile method — data-driven)
   │
   ▼
6. POST /classify (Python Random Forest) → Low / Med / High per barangay
   │
   ▼
7. Compute weighted risk score:
   risk_score = 0.45×incidence + 0.25×trend + 0.20×neighbor_risk + 0.10×forecast_error
   │
   ▼
8. UPSERT into L4: model_predictions, barangay_risk_scores, alerts
   │
   ▼
9. Update model_metadata with run timestamp and evaluation results
```

---

## PASIG CLONE → TBInsight Data Flow

```
Excel Export (Pasig TB-DOTS)
    ↓
PASIG CLONE: Parse DSTB + MN sheets
    ↓
Validate records (required fields, date formats, barangay names)
    ↓
SHA256 hash check → reject if file already imported (409)
    ↓
Store in validated_tb_cases (classified: new / updated / duplicate)
    ↓
User reviews in Validation page → approves
    ↓
POST /api/webhook/pasig-clone on TBInsight
    Header: X-Webhook-Signature: sha256=<HMAC-SHA256>
    ↓
TBInsight: Verify HMAC → idempotent upsert into tb_cases_raw + tb_cases
    ↓
TBInsight: Rebuild L3 aggregation tables
    ↓
(Optional) Trigger ML pipeline → rebuild L4 predictions
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Two separate databases | PASIG CLONE data pipeline isolated from TBInsight analytics |
| Shared JWT auth | Single sign-on across both systems |
| Layered data architecture (L0–L4) | Clear separation: reference → raw → cleaned → aggregated → predicted |
| Pipeline idempotency | Safe to re-run; DELETE + INSERT per period, no duplicates |
| HMAC-SHA256 webhook verification | Prevents unauthorized data injection |
| SHA256 file hash in PASIG CLONE | Prevents duplicate file imports at the source |
| Record classification (new/updated/duplicate) | Transparent change tracking before sync |
| Rule-based ML fallback | Dashboard stays functional when ML service is down |
| Tertile risk thresholds | Data-driven; adapts to Pasig case volumes vs. fixed WHO thresholds |
| Historical bias feature | Corrects systematic ARIMA errors per barangay |
| null/empty barangay_name → 'Unassigned' | Backend normalizes before grouping; frontend never sees nulls |
| CommonJS modules | Matches existing codebase convention throughout |
| Express 5 | Async error handling without try/catch wrappers |

---

## Deployment

| Service | Platform | URL |
|---------|----------|-----|
| TBInsight Frontend | Vercel | p2-official.vercel.app |
| TBInsight Backend | Render | p2-official.onrender.com |
| ML Service | Same Render instance as backend | :8001 |
| TBInsight DB | Neon | AUTH_DATABASE_URL in BACKEND/.env |
| PASIG CLONE Backend | Local / separate Render service | :5001 |
| PASIG CLONE DB | Neon | DATABASE_URL in PASIG_CLONE/backend/.env |

---

## Feature Status

### TBInsight
| Feature | Status |
|---------|--------|
| User Authentication (JWT, rate limiting, role-based) | ✅ |
| TB Case Import (CSV/Excel, flexible header matching) | ✅ |
| Data Aggregation (5 summary tables) | ✅ |
| Dashboard KPIs + trends + demographics + outcomes | ✅ |
| GIS Choropleth Map (PostGIS, risk overlays) | ✅ |
| Health Facilities page (grouped by barangay, Unassigned fallback) | ✅ |
| ARIMA Forecasting (12-month, auto-calibration) | ✅ |
| Risk Classification (Random Forest, 8 features) | ✅ |
| Alert Generation | ✅ |
| Walk-Forward Evaluation | ✅ |
| Backend Tests (80+) | ✅ |
| ML Service Tests (52) | ✅ |
| Analytics page | 🚧 |
| Data Integration page | 🚧 |
| Resource Prioritization page | 🚧 |
| Users / Settings pages | 🚧 |

### PASIG CLONE
| Feature | Status |
|---------|--------|
| Login + JWT auth | ✅ |
| Excel import (DSTB + MN sheets) | ✅ |
| Record validation | ✅ |
| SHA256 duplicate file detection | ✅ |
| Record-level duplicate classification | ✅ |
| Audit logging | ✅ |
| HMAC webhook send to TBInsight | ✅ |
| Sync status tracking (pending → syncing → synced / sync_failed) | ✅ |
| Retry on sync failure | ✅ |
| Import History page | ✅ |
| Validation page | ✅ |
| Dashboard org-wide KPIs | 🚧 |
| Duplicate detection UI on Import page | 🚧 |
| Audit Trail component | 🚧 |

---

## Repository Structure

```
P2_OFFICIAL/
├── BACKEND/                  # TBInsight Express backend
│   ├── routes/               # tbinsight/, auth/, map/
│   ├── middleware/           # auth, webhookAuth, validation
│   ├── services/             # pipeline.js orchestrator
│   ├── data/                 # GeoJSON and reference data files
│   ├── backups/              # DB dump files (gitignored)
│   ├── tests/                # 80+ backend tests
│   ├── reset_data.js         # Wipes both DBs (preview + --confirm modes)
│   └── .env                  # AUTH_DATABASE_URL (gitignored)
│
├── FRONTEND/                 # TBInsight React frontend
│   ├── src/
│   │   ├── pages/            # All page components
│   │   ├── components/       # Shared UI components
│   │   └── ...
│   └── .env                  # VITE_API_URL (gitignored)
│
├── ML_SERVICE/               # Python FastAPI ML service
│   ├── models/               # ARIMA + Random Forest
│   ├── tests/                # 52 ML tests
│   └── main.py
│
├── PASIG_CLONE/
│   ├── backend/              # Express backend for data import
│   │   ├── routes/           # csvImport, validation, webhook, facilities
│   │   ├── services/         # webhookSender, recordDuplicateDetector
│   │   ├── utils/            # fileHash, auditLogger
│   │   ├── db/migrations/    # 001_add_audit_and_hash_fields.sql
│   │   └── .env              # DATABASE_URL (gitignored)
│   └── frontend/             # React frontend for data import workflow
│       └── src/pages/        # LoginPage, CsvImportPage, ValidationPage,
│                             # WebhookStatusPage, ImportHistoryPage
│
├── docs/                     # All planning and architecture docs
├── .gitignore                # Root-level gitignore
└── package.json              # Monorepo scripts
```

---

## Dev Commands

```bash
# Root (monorepo)
npm run dev                    # Start TBInsight backend + frontend

# TBInsight Backend
cd BACKEND && npm run dev      # nodemon on :3000 (or :5000)
cd BACKEND && npm test         # Run all 80+ backend tests

# TBInsight Frontend
cd FRONTEND && npm run dev     # Vite on :5173
cd FRONTEND && npm run build   # Production build

# ML Service
cd ML_SERVICE
uvicorn main:app --host 0.0.0.0 --port 8001
python tests/test_arima.py
python tests/test_rf.py
python tests/test_endpoints.py

# PASIG CLONE Backend
cd PASIG_CLONE/backend && npm run dev   # :5001

# PASIG CLONE Frontend
cd PASIG_CLONE/frontend && npm run dev  # :5174

# Reset all imported data (keeps users, reference data, model history)
cd BACKEND
node reset_data.js             # Preview — shows row counts, deletes nothing
node reset_data.js --confirm   # Actually deletes (both DBs, one transaction each)
```
