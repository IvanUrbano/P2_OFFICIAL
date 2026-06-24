# TB System — Agents Guide

## Project Structure

npm workspaces monorepo with `BACKEND/` (Express 5 + PostgreSQL) and `FRONTEND/` (React 19 + Vite 8 + Tailwind v4).

## Commands

| Command | Where | What |
|---|---|---|
| `npm install` | root | Installs all workspace deps |
| `npm run dev` | root | Starts backend + frontend concurrently |
| `npm run dev --prefix FRONTEND` | root or FRONTEND | Vite dev on `localhost:5173` |
| `npm run dev` | BACKEND | nodemon on `localhost:5000` |
| `npm run lint` | FRONTEND | ESLint (frontend only) |
| `npm run build` | FRONTEND | Vite build → `FRONTEND/dist/` |

No test suite exists.

## Database Setup

- PostgreSQL DB `tb_system` required (see README.md for config)
- Backend auto-runs `BACKEND/init.sql` on startup to create tables
- Migration script: `node BACKEND/migrate_db.js` (adds `role` column + sets existing users to admin)
- Optional restore: `psql -U <user> -d tb_system -f tb_system_backup.dump`

## Environment

- Backend: copy `.env.example` (does not exist yet — create manually) to `BACKEND/.env` with `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT`. In production, `DATABASE_URL` takes precedence.
- Frontend: `VITE_API_URL` (defaults to `http://localhost:5000`), set via `FRONTEND/.env` or Vercel env vars.
- Login rate-limit: 5 attempts / 15 min window (config via `LOGIN_LIMIT_WINDOW_MINS`, `LOGIN_LIMIT_MAX`).

## Auth

- JWT stored in httpOnly cookie + returned in response body; client also stores in `localStorage` for `Authorization: Bearer` header
- Register is admin-only (`POST /api/auth/register` needs admin JWT)
- API base: `/api/auth/*` (login, register, logout, profile, users CRUD)
- Health check: `GET /api/health`

## CORS

Allows `localhost:5173`, `localhost:5174`, `localhost:3000`, and any Vercel preview matching `^https://p2-official[a-z0-9-]*\.vercel\.app$`.

## Deployment

- **Backend**: Render via `render.yaml` (Node, free plan, `BACKEND/` root dir)
- **Frontend**: Vercel via `FRONTEND/vercel.json` (SPA rewrites, build from `FRONTEND/`)
- Root `package.json` has a `vercel-build` script used by Vercel monorepo setups

## Key Quirks

- `BACKEND/.env.example` is **missing** from the repo — README references it but it doesn't exist. Create one if needed.
- `init.sql` runs automatically on every backend startup (idempotent `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`).
- ESLint covers frontend only. Backend has no lint config.
- No TypeScript anywhere.
- Frontend uses Tailwind v4 (no `tailwind.config.js` — CSS‑based config via `@tailwindcss/vite` plugin).
