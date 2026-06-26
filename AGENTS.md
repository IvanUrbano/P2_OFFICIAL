# TB System — Agents Guide

## Project Structure

npm workspaces monorepo with `BACKEND/` (Express 5 + PostgreSQL) and `FRONTEND/` (React 19 + Vite 8 + Tailwind v4).

Frontend directory layout is **non-standard**: shared components live in `FRONTEND/components/` (outside `src/`), while page components are in `FRONTEND/src/pages/`.

## Commands

| Command | Where | What |
|---|---|---|
| `npm install` | root | Installs all workspace deps |
| `npm run dev` | root | Starts backend + frontend concurrently |
| `npm run dev --prefix FRONTEND` | root or FRONTEND | Vite dev on `localhost:5173` |
| `npm run dev` | BACKEND | nodemon on `localhost:5000` |
| `npm run lint` | FRONTEND | ESLint (frontend only) |
| `npm run build` | FRONTEND | Vite build → `FRONTEND/dist/` |

No test suite exists. CI (`/.github/workflows/ci.yml`) only runs `npm run build` on the frontend — no backend checks or lint.

## Database Setup

- PostgreSQL DB `tb_system` required (see README.md for config)
- Backend auto-runs `BACKEND/init.sql` on startup to create tables (idempotent: `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`)
- Migration script: `node BACKEND/migrate_db.js` (adds `role` column + sets existing users to admin)
- Optional restore: `psql -U <user> -d tb_system -f tb_system_backup.dump`
- Schema: single `users` table (id, username, email, password, role, created_at, updated_at) with indexes on email and username

## Environment

- Backend: **`BACKEND/.env.example` is missing** — create `BACKEND/.env` manually with `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT`. In production, `DATABASE_URL` takes precedence over discrete vars.
- Frontend: `VITE_API_URL` defaults to `http://localhost:5000`. Set via `FRONTEND/.env` (local) or Vercel env vars (production). `FRONTEND/.env.production.example` shows the Render URL format.
- Login rate-limit: 5 attempts / 15 min window (config via `LOGIN_LIMIT_WINDOW_MINS`, `LOGIN_LIMIT_MAX`).

## Auth

- JWT stored in httpOnly cookie + returned in response body; client also stores in `localStorage` for `Authorization: Bearer` header
- Register is admin-only (`POST /api/auth/register` needs admin JWT + `authorizeRoles('admin')`)
- API base: `/api/auth/*` (login, register, logout, profile, users CRUD)
- Health check: `GET /api/health` (pings database)
- Backend `package.json` has **no `name` field** — this is required by npm workspaces; it works but is a known quirk

## CORS

Allows `localhost:5173`, `localhost:5174`, `localhost:3000`, and any Vercel preview matching `^https://p2-official[a-z0-9-]*\.vercel\.app$`. `FRONTEND_URL` env var also allowed.

## Deployment

- **Backend**: Render via `render.yaml` (Node, free plan, `BACKEND/` root dir)
- **Frontend**: Vercel via `FRONTEND/vercel.json` (SPA rewrites, build from `FRONTEND/`)
- Root `package.json` has a `vercel-build` script used by Vercel monorepo setups (`cd FRONTEND && npm install --no-package-lock && npm run build`)

## Key Quirks

- `BACKEND/.env.example` is **missing** from the repo — README references it but it doesn't exist. Create one if needed.
- `init.sql` runs automatically on every backend startup.
- ESLint covers frontend only. Backend has no lint or typecheck config.
- No TypeScript anywhere — all `.js`/`.jsx`.
- Frontend uses Tailwind v4 (no `tailwind.config.js` — CSS-based config via `@tailwindcss/vite` plugin, theme defined in `src/index.css` with `@theme`).
- Express 5 (not 4) — async route handlers automatically catch rejections; no need for explicit `try/catch` wrappers around async middleware.
- `BACKEND/scratch_check_db.js` is a one-off debug utility for querying users — not part of the app.

## TBInsight — GIS-Based TB Hotspot & Resource-Prioritization System

### Architecture: Two Systems, One Monorepo

- **System 1: Express Backend** (`BACKEND/`) — CSV import, aggregation, dashboard API, orchestration
- **System 2: Python FastAPI** (`ML_SERVICE/`) — ARIMA forecasting + Random Forest classification
- **Frontend** (`FRONTEND/`) — React dashboard with choropleth, forecasts, alerts

### TBInsight Database Schema (9 tables)

Migration: `node BACKEND/db/migrations/002_tbinsight_full_schema.sql`

| Layer | Tables | Purpose |
|---|---|---|
| L0 Reference | `barangays`, `health_facilities` | 30 Pasig barangays, facility-to-barangay mapping |
| L1 Raw | `tb_cases_raw` | Verbatim CSV rows (traceability) |
| L2 Cleaned | `tb_cases` | Validated records (analytics source) |
| L3 Aggregated | `monthly_case_summary`, `demographic_summary`, `outcome_summary`, `facility_summary`, `bacteriological_summary` | SQL GROUP BY results (dashboard reads) |
| L4 Predictions | `model_predictions`, `barangay_risk_scores`, `alerts`, `model_metadata` | ARIMA forecasts, RF classifications, risk scores, alerts |

### TBInsight File Structure

```
BACKEND/
├── tbinsight/
│   ├── barangays.js          — Seed & query reference data
│   ├── parseCaseFile.js      — CSV/Excel parser (18 columns, xlsx library)
│   ├── importCases.js        — Transactional import (raw + cleaned)
│   ├── aggregateMonthly.js   — Rebuild all L3 aggregated tables
│   ├── mlClient.js           — HTTP client for Python ML service
│   ├── scoring.js            — Risk score computation + alert generation
│   ├── pipeline.js           — Orchestration: query data, call Python, store results
│   └── routes.js             — All /api/tb/* endpoints
├── data/
│   ├── pasig-barangays.geojson       — 30 barangay centroids + boundaries
│   ├── pasig-population.csv          — Population per barangay
│   └── pasig-health-facilities.csv   — Facility-to-barangay mapping
├── db/migrations/
│   └── 002_tbinsight_full_schema.sql — Full 9-table migration (auto-runs on startup)
└── test/tbinsight/
    ├── parseCaseFile.test.js — Parser unit tests (21 tests)
    └── pipeline.test.js      — Scoring & pipeline unit tests (19 tests)
```

### TBInsight Commands

| Command | What |
|---|---|
| `node BACKEND/db/migrations/002_tbinsight_full_schema.sql` (via psql) | Create all 9 tables |
| `node --test BACKEND/test/tbinsight/parseCaseFile.test.js` | Run parser tests |
| `node --test BACKEND/test/tbinsight/pipeline.test.js` | Run scoring & pipeline tests |

### TBInsight API Endpoints

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/tb/barangays` | any | 30 barangays + population |
| `GET` | `/api/tb/facilities` | any | Health facility list |
| `POST` | `/api/tb/barangays/seed` | admin | Seed reference data |
| `POST` | `/api/tb/import` | admin | Upload CSV → raw + cleaned + aggregate |
| `GET` | `/api/tb/import-history` | admin | Past imports |
| `GET` | `/api/tb/import/:batchId/errors` | admin | Validation errors |
| `GET` | `/api/tb/dashboard/summary` | any | Key metrics |
| `GET` | `/api/tb/dashboard/monthly` | any | Monthly trend |
| `GET` | `/api/tb/dashboard/barangay/:name` | any | Per-barangay breakdown |
| `GET` | `/api/tb/dashboard/demographics` | any | Age/sex distributions |
| `GET` | `/api/tb/dashboard/outcomes` | any | Treatment outcomes |
| `GET` | `/api/tb/dashboard/facilities` | any | Cases per facility |
| `GET` | `/api/tb/gis/choropleth` | any | Map data (risk scores) |
| `GET` | `/api/tb/forecasts` | any | ARIMA predictions |
| `GET` | `/api/tb/predictions/risk` | any | RF risk classifications |
| `GET` | `/api/tb/alerts` | any | Active alerts |
| `PUT` | `/api/tb/alerts/:id/read` | any | Mark alert read |
| `POST` | `/api/tb/pipeline` | admin | Run full prediction pipeline |
| `GET` | `/api/tb/pipeline/status` | any | Latest pipeline run metadata |
| `GET` | `/api/tb/ml/health` | any | Python ML service health check |

### TBInsight Data Flow

1. **Import**: CSV/Excel → `parseCaseFile` (18 cols, validate, cross-check facilities) → `importCases` (transaction: tb_cases_raw + tb_cases) → `rebuildAggregations` (5 L3 tables)
2. **Aggregation**: Pure SQL `GROUP BY` from `tb_cases` → `monthly_case_summary`, `demographic_summary`, `outcome_summary`, `facility_summary`, `bacteriological_summary`
3. **Pipeline** (`POST /api/tb/pipeline`): Express orchestrator queries L3 + L0 → builds series → calls Python `/forecast` (ARIMA) → computes RF features → calls Python `/classify` (RF) → computes risk scores → stores in L4 + L6 (idempotent: DELETE + INSERT per period)
4. **Dashboard**: React reads L3 + L4 for choropleth, forecasts, alerts, charts

### TBInsight Key Design Decisions

- **CSV parser**: `xlsx` (SheetJS) — single library for CSV + Excel
- **Barangay join**: CSV `Barangay` column = source of truth (not facility name)
- **Facility validation**: Warning only (not rejection) — facility data may use abbreviations
- **Date column**: `date_of_diagnosis` is the ARIMA time key
- **Incidence formula**: (cases ÷ population) × 100,000
- **Risk thresholds**: Tertiles on 3-year window (not absolute WHO thresholds)
- **RF features (6)**: forecasted_count, trend, seasonality, density, neighbor_risk, historical_bias (Approach B feedback loop)
- **Historical bias**: AVG(forecast_error) per barangay from past runs; 0 on first run
- **Neighbor risk**: Computed as average incidence of all other barangays, normalized to 0-1
- **Risk scoring**: Weighted index — 45% incidence + 25% trend + 20% neighbor risk + 10% forecast error
- **Alert rules**: Rule-based — escalation (Medium→High), danger (High), surge (>30% increase)
- **Pipeline idempotency**: DELETE + INSERT per period — safe to re-run
- **Module format**: CommonJS (`require`/`module.exports`) — matches existing codebase
- **DB pool**: Reuses `BACKEND/db.js` — no duplicate pools
- **File upload**: `express-fileupload` middleware (50MB limit)
- **Auto-run migration**: `db.js` runs `002_tbinsight_full_schema.sql` on startup (idempotent)
- **ML service client**: Native `fetch` (Node 24) — no extra dependency
