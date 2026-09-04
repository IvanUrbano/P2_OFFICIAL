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

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/import` | Upload Excel file (multipart/form-data) |
| GET | `/api/cases` | List all imported cases |
| GET | `/api/cases/pending` | List cases not yet sent via webhook |
| POST | `/api/webhook/send` | Send pending cases to TBInsight |
| GET | `/api/stats` | Get import statistics |

## Excel Format

### DSTB Sheet
18 columns: No., Date Reported, Facility Name, Barangay, Case Classification, Treatment Regimen, Patient Type, Date Treatment Started, Outcome, Outcome Date, Sex, Age, Registration Date, Validation Status, Smear Sample Date, Smear Result, GeneXpert Date, GeneXpert Result

### MN Sheet
28 columns: ITIS Lite Case No., ITIS Lite Case, No., Type, Date Reported, Facility Name, Barangay, Case Classification, Treatment Regimen, Patient Type, Patient Name, Last Name, First Name, Middle Name, Sex, Age, Age Group, Indigenous Group, Date Treatment Started, Outcome, Outcome Date, Registration Date, Province, Region, Referred to DOTS, Referral Status, Contact Name, Contact Relationship, ...
