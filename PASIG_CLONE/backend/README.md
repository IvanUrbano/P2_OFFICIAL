# Pasig Clone Backend

TB-DOTS data ingestion system for Pasig City. Parses multi-sheet Excel files and sends validated cases to TBInsight via webhook.

## Setup

```bash
cd PASIG_CLONE/backend
cp .env.example .env
npm install
npm start
```

## API Endpoints

### Authentication (`/api/auth/*`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/register` | admin | Create new user |
| POST | `/login` | none | Login, get JWT |
| GET | `/profile` | any | Current user info |
| POST | `/logout` | none | Clear cookie |

### Data (`/api/data/*`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/import` | staff+ | Upload Excel (DSTB + MN sheets) |
| GET | `/batches` | staff+ | List all import batches |
| GET | `/batches/:id` | staff+ | Batch details with raw records |

### Validation (`/api/data/*`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/validate/:batchId` | staff+ | Validate batch, store in validated_tb_cases |

### Webhook (`/api/webhook/*`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/send` | admin | Send validated batch to TBInsight |
| GET | `/logs` | admin | Webhook delivery history |

### Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | none | Health check |

## Excel Format

### DSTB Sheet
18 columns: No., Date Reported, Facility Name, Barangay, Case Classification, Treatment Regimen, Patient Type, Date Treatment Started, Outcome, Outcome Date, Sex, Age, Registration Date, Validation Status, Smear Sample Date, Smear Result, GeneXpert Date, GeneXpert Result

### MN Sheet
28 columns: ITIS Lite Case No., ITIS Lite Case, No., Type, Date Reported, Facility Name, Barangay, Case Classification, Treatment Regimen, Patient Type, Patient Name, Last Name, First Name, Middle Name, Sex, Age, Age Group, Indigenous Group, Date Treatment Started, Outcome, Outcome Date, Registration Date, Province, Region, Referred to DOTS, Referral Status, Contact Name, Contact Relationship, ...
