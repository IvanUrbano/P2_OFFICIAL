# TB System - Setup & Installation Guide

Welcome to the TB System project. This project is configured using **npm Workspaces**, allowing you to manage and run both the frontend and backend easily.

---

## Prerequisites

Before starting, make sure you have the following installed:
1. **Node.js** (v18 or higher recommended)
2. **npm** (comes packaged with Node.js)
3. **PostgreSQL** (v14 or higher recommended)
4. **Python 3.10+** (for ML service)

---

## Quick Start (Recommended)

### 1. Clone the Repository
Clone/fork the repository and navigate into the root directory:
```bash
git clone <your-repository-url>
cd P2_OFFICIAL
```

### 2. Install All Dependencies (Automatically)
Run the following command in the **root** folder. This will automatically install dependencies for both the `BACKEND` and `FRONTEND` folders:
```bash
npm install
```

### 3. Create Backend Environment File (`.env`)
1. In the `BACKEND` directory, copy the template environment file:
   ```bash
   cp BACKEND/.env.example BACKEND/.env
   ```
2. Open `BACKEND/.env` and replace the database credentials with your local PostgreSQL details:
   ```env
   DB_USER=your_postgres_username
   DB_HOST=localhost
   DB_NAME=tb_system
   DB_PASSWORD=your_postgres_password
   DB_PORT=5432
   ```

### 4. Database Setup
1. Ensure PostgreSQL is running.
2. Log into PostgreSQL and create the database:
   ```sql
   CREATE DATABASE tb_system;
   ```
3. *(Optional)* To restore the database backup dump, run:
   ```bash
   psql -U your_postgres_username -d tb_system -f tb_system_backup.dump
   ```
   *Note: If you skip this, the server will automatically run `BACKEND/init.sql` on startup to initialize the database tables.*

### 5. Start Both Servers with One Command
From the **root** directory, run:
```bash
npm run dev
```
This will start both the React frontend and the Express backend concurrently. You can access the application at `http://localhost:5173`.

### 6. Start the ML Service (Optional)
The Python ML service provides ARIMA forecasting and Random Forest classification. To start it:
```bash
cd ML_SERVICE
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

---

## Running Tests

### Backend Tests
```bash
# Run all backend tests
cd BACKEND && npm test

# Run specific test suites
node --test test/auth.test.js
node --test test/middleware.test.js
node --test test/tbinsight/pipeline.test.js
node --test test/tbinsight/parseCaseFile.test.js
```

### ML Service Tests
```bash
cd ML_SERVICE
python tests/test_rf.py
python tests/test_endpoints.py
python tests/test_arima.py
```

---

## API Endpoints

### Authentication
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | none | Login with email/password |
| POST | `/api/auth/register` | admin | Register new user |
| POST | `/api/auth/logout` | any | Logout (clear cookie) |
| GET | `/api/auth/profile` | any | Get current user profile |
| GET | `/api/auth/users` | admin | List all users |
| DELETE | `/api/auth/users/:id` | admin | Delete a user |

### TBInsight
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/tb/barangays` | any | List 30 barangays |
| GET | `/api/tb/facilities` | any | List health facilities |
| POST | `/api/tb/import` | admin | Upload CSV data |
| GET | `/api/tb/dashboard/summary` | any | Dashboard summary metrics |
| GET | `/api/tb/dashboard/monthly` | any | Monthly trend data |
| GET | `/api/tb/gis/choropleth` | any | Map choropleth data |
| GET | `/api/tb/forecasts` | any | ARIMA forecasts |
| GET | `/api/tb/predictions/risk` | any | RF risk classifications |
| GET | `/api/tb/alerts` | any | Active alerts |
| POST | `/api/tb/pipeline` | admin | Run full prediction pipeline |
| POST | `/api/tb/evaluate` | admin | Run walk-forward evaluation |

### ML Service (Python)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ml/health` | Service health check |
| POST | `/api/ml/thresholds` | Compute risk band thresholds |
| POST | `/api/ml/forecast` | ARIMA forecasting |
| POST | `/api/ml/classify` | RF risk classification |
| POST | `/api/ml/pipeline` | Combined forecast + classify |
| POST | `/api/ml/evaluate` | Walk-forward evaluation |

---

## Machine Learning

### Models
- **ARIMA**: Time series forecasting using `pmdarima.auto_arima`
- **Random Forest**: Risk classification (Low/Medium/High) using `sklearn.RandomForestClassifier`

### RF Features (8)
| Feature | Description |
|---------|-------------|
| `forecasted_incidence` | Annualized incidence per 100k from 12-month window |
| `recent_trend` | Linear regression slope of case counts over 12-month window |
| `seasonality_flag` | 1 if seasonal pattern detected, 0 otherwise |
| `lag_1m` | Case count 1 month ago (momentum) |
| `lag_2m` | Case count 2 months ago (momentum) |
| `lag_3m` | Case count 3 months ago (momentum) |
| `neighbor_risk` | Average incidence of other barangays, normalized [0,1] |
| `historical_bias` | AVG(|actual - forecasted|) from past predictions |

### Walk-Forward Evaluation
Both ARIMA and RF models support walk-forward temporal evaluation:
- **ARIMA**: Trains on months 1..T, predicts T+1, slides forward. Reports MAE and MAPE.
- **RF**: Trains on all barangay-months before T, predicts month T. Reports accuracy, F1, precision, recall, confusion matrix.
- Minimum 24 months training history before evaluation starts.
- Trigger via `POST /api/tb/evaluate` (admin only).

---

## Project Structure

```
P2_OFFICIAL/
├── BACKEND/                 # Express.js backend
│   ├── routes/              # Auth routes
│   ├── middleware/           # Auth, rate limiting
│   ├── tbinsight/           # TBInsight modules
│   │   ├── pipeline.js      # Pipeline orchestrator
│   │   ├── mlClient.js      # Python ML service client
│   │   ├── scoring.js       # Risk scoring + alerts
│   │   ├── routes.js        # All /api/tb/* endpoints
│   │   └── parseCaseFile.js # CSV parser
│   ├── test/                # Backend tests
│   └── data/                # GeoJSON, CSVs
├── ML_SERVICE/              # Python FastAPI ML service
│   ├── arima_forecast.py    # ARIMA + walk-forward
│   ├── rf_classifier.py     # RF + walk-forward
│   ├── routes.py            # FastAPI endpoints
│   ├── models.py            # Pydantic schemas
│   ├── config.py            # ML configuration
│   └── tests/               # ML tests
└── FRONTEND/                # React + Vite
```

---

## Deployment

- **Backend**: Render via `render.yaml`
- **Frontend**: Vercel via `FRONTEND/vercel.json`
- **ML Service**: Can be deployed separately (e.g., Railway, Fly.io)
