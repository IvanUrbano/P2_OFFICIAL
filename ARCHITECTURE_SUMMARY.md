# TBInsight — System Architecture & Status

## Overview

GIS-Based Predictive Tuberculosis Hotspot and Resource Prioritization Dashboard for Pasig City Health Office.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React)                              │
│                    Vercel: p2-official.vercel.app                          │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐      │
│  │Dashboard │TB Records│ GIS Map  │Alerts    │Analytics │Resources │      │
│  │    ✅    │    ✅    │    ✅    │    ✅    │    🚧    │    🚧    │      │
│  └──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘      │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │ HTTP (REST API)
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BACKEND (Express 5)                             │
│               Render: p2-official.onrender.com                             │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐            │
│  │  Auth (JWT)  │ TB Import    │ Dashboard    │ GIS/Map      │            │
│  │  Register    │ CSV/Excel    │ Aggregation  │ PostGIS      │            │
│  │  Login       │ Validation   │ Metrics      │ Choropleth   │            │
│  └──────────────┴──────────────┴──────────────┴──────────────┘            │
│  ┌──────────────────────────────────────────────────────────────┐         │
│  │              Pipeline Orchestrator (pipeline.js)             │         │
│  │  Query L3 → Build Series → Call ML → Store L4 → Alerts      │         │
│  └──────────────────────────────────────────────────────────────┘         │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │ HTTP (REST API)
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ML SERVICE (Python FastAPI)                        │
│                         localhost:8001                                      │
│  ┌──────────────────────────┬──────────────────────────┐                  │
│  │   ARIMA Forecasting      │  Random Forest Classifier │                  │
│  │   • auto_arima           │  • 8 features             │                  │
│  │   • 12-month horizon     │  • Low/Med/High risk      │                  │
│  │   • Fallback chain       │  • Walk-forward eval      │                  │
│  └──────────────────────────┴──────────────────────────┘                  │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PostgreSQL + PostGIS                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │  L0 Reference    │ L1 Raw      │ L2 Cleaned   │ L3 Aggregated    │    │
│  │  • barangays     │ • tb_cases  │ • tb_cases   │ • monthly_case   │    │
│  │  • facilities    │   _raw      │ • users      │ • demographic    │    │
│  │  • geom          │             │              │ • outcome        │    │
│  │                  │             │              │ • facility       │    │
│  │                  │             │              │ • bacteriological│    │
│  ├──────────────────┴─────────────┴──────────────┴──────────────────┤    │
│  │  L4 Predictions                                                │    │
│  │  • model_predictions • barangay_risk_scores • alerts • metadata  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Services

### Backend (Express.js 5)
- **Port**: 3000 (dev) / Render (prod)
- **Database**: PostgreSQL 14 + PostGIS
- **Auth**: JWT in httpOnly cookies + localStorage
- **File Upload**: express-fileupload (50MB limit)
- **Tests**: Node.js built-in test runner + supertest

### Frontend (React 19 + Vite 8)
- **Port**: 5173 (dev) / Vercel (prod)
- **Styling**: Tailwind CSS v4 (CSS-first config)
- **Charts**: Recharts
- **Maps**: Leaflet + react-leaflet
- **Routing**: react-router-dom v7

### ML Service (Python FastAPI)
- **Port**: 8001
- **Models**: ARIMA (pmdarima) + Random Forest (scikit-learn)
- **Evaluation**: Walk-forward temporal validation
- **Fallback**: Rule-based classification when ML unavailable

---

## Completed Features

| Feature | Status | Notes |
|---------|--------|-------|
| User Authentication | ✅ | JWT, rate limiting, role-based access |
| TB Case Import | ✅ | CSV/Excel with flexible header matching |
| Data Aggregation | ✅ | 5 summary tables rebuilt on import |
| Dashboard Metrics | ✅ | KPIs, trends, demographics, outcomes |
| GIS Choropleth Map | ✅ | PostGIS-powered, risk overlays |
| ARIMA Forecasting | ✅ | 12-month horizon, auto-calibration |
| Risk Classification | ✅ | Random Forest with 8 features |
| Alert Generation | ✅ | Rule-based escalation alerts |
| Walk-Forward Evaluation | ✅ | Temporal validation for both models |
| Backend Tests | ✅ | 80+ tests across auth, parser, pipeline |
| ML Service Tests | ✅ | 52 tests across ARIMA, RF, endpoints |

---

## Remaining Work

### Frontend Pages (Priority Order)

| Page | Route | Description | Complexity |
|------|-------|-------------|------------|
| **Analytics** | `/analytics` | Advanced visualizations, trend analysis, statistical breakdowns | Medium |
| **Data Integration** | `/data-integration` | Import status, batch history, error review, data quality | Medium |
| **Resource Prioritization** | `/resources` | Risk-based resource allocation, recommendations, action plans | Medium |
| **Users** | `/users` | User management (admin only), role assignment | Low |
| **Settings** | `/settings` | Profile update, preferences, notifications | Low |
| **Register** | Wire up | RegisterPage.jsx exists, needs route + navigation link | Low |

### Infrastructure Improvements

| Issue | Priority | Impact |
|-------|----------|--------|
| Add frontend tests (Vitest + RTL) | High | Code quality, regression prevention |
| Centralized state (Context/Zustand) | Medium | Scalability, auth state management |
| Route-level code splitting | Medium | Bundle size, initial load performance |
| Move `components/` inside `src/` | Low | Code organization convention |
| Add `.env.example` for backend | Low | Developer onboarding |
| Remove `dist/` from repo | Low | Clean repository |

---

## Commands Reference

```bash
# Root (monorepo)
npm install                    # Install all dependencies
npm run dev                    # Start backend + frontend

# Backend
cd BACKEND
npm run dev                    # nodemon on :5000
npm test                       # Run all backend tests

# Frontend
cd FRONTEND
npm run dev                    # Vite on :5173
npm run build                  # Production build
npm run lint                   # ESLint check

# ML Service
cd ML_SERVICE
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
python tests/test_arima.py     # Run ARIMA tests
python tests/test_rf.py        # Run RF tests
python tests/test_endpoints.py # Run endpoint tests
```

---

## Database Schema

### Layer 0 — Reference Data
- `barangays` (30 Pasig barangays + population + centroid)
- `health_facilities` (39 facilities mapped to barangays)
- `barangays_geom` (PostGIS polygons for spatial queries)

### Layer 1 — Raw Import
- `tb_cases_raw` (verbatim CSV rows for traceability)

### Layer 2 — Cleaned
- `tb_cases` (validated 16-column records for analytics)
- `users` (id, username, email, password, role)

### Layer 3 — Aggregated
- `monthly_case_summary` (cases per barangay per month)
- `demographic_summary` (age/sex breakdowns)
- `outcome_summary` (treatment outcomes)
- `facility_summary` (cases per facility)
- `bacteriological_summary` (TB type breakdowns)

### Layer 4 — Predictions
- `model_predictions` (ARIMA forecasts + RF classifications + actuals)
- `barangay_risk_scores` (weighted risk scores for choropleth)
- `alerts` (generated alerts with severity)
- `model_metadata` (pipeline run tracking)

---

## ML Pipeline Flow

```
1. Query L3 (monthly_case_summary) + L0 (barangay populations)
   │
   ▼
2. Build time series per barangay
   │
   ▼
3. Call Python /forecast (ARIMA) → 12-month predictions
   │
   ▼
4. Compute 8 RF features per barangay:
   • forecasted_incidence    • lag_1m
   • recent_trend            • lag_2m
   • seasonality_flag        • lag_3m
   • neighbor_risk           • historical_bias
   │
   ▼
5. Auto-calibrate risk thresholds (tertile method)
   │
   ▼
6. Call Python /classify (Random Forest) → risk classes
   │
   ▼
7. Compute weighted risk scores:
   risk_score = 0.45×incidence + 0.25×trend + 0.20×neighbor_risk + 0.10×forecast_error
   │
   ▼
8. Store in L4 tables + generate alerts
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Layered data architecture | Clear separation of concerns, auditability |
| Pipeline idempotency | Safe to re-run (DELETE + INSERT per period) |
| Rule-based fallback | Resilient when ML service is down |
| CSV parser flexibility | Tolerates mangled headers, column reordering |
| Tertile risk thresholds | Data-driven (not absolute WHO thresholds) |
| Historical bias feature | Captures systematic ARIMA errors per barangay |
| CommonJS modules | Matches existing codebase convention |
| Express 5 | Async handlers auto-catch rejections |
