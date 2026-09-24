# TBInsight Implementation Plan v3 — Post-Client Feedback

> **Date**: September 24, 2026
> **Source**: Client meeting "Paglilinaw sa Hotspot" (Sep 23, 2026)
> **Status**: Ready for implementation

---

## Context

Client meeting revealed gaps between the current system and client expectations regarding hotspot criteria transparency, population data accuracy, treatment success rate formula, NLG integration for GIS, reporting requirements, and multi-facility support. This plan addresses all feedback items across 3 phases.

---

## Decisions Made

| Topic | Decision |
|---|---|
| Population data | JSON file with 2024 + 2025 DOH FHSIS data |
| Population DB storage | Single value (latest year) in `barangays`/`barangays_geom`; historical looked up from JSON |
| TSR formula | (Cured + Completed) / Total Patients x 100% |
| GIS NLG | Map-level card + per-barangay NLG |
| GIS risk breakdown | Show 4 components with weights |
| Reports | Add treatment cascade + year-over-year trending |
| Multi-facility | User facility assignment + data entry form |
| Offline | Not needed (web-based only) |
| TPT / Contact investigation | Out of scope |
| EMR integration | Blocked, skip |
| Data sufficiency | Add indicator |
| Intervention overdue | Verify logic + add notifications |
| Population admin | JSON file update + seed endpoint (no Excel upload) |
| Dataset | 2025 CASES_JRU (2).xlsx — 4,780 DSTB + 1,820 MN cases (single year) |

---

## Dataset Assessment

**File**: `2025 CASES_JRU (2).xlsx`

### Structure
| Sheet | Rows | Description |
|---|---|---|
| DSTB | 4,780 | Drug-Susceptible TB cases |
| MN | 1,820 | Multi-drug Resistant TB cases |
| Sheet4 | Summary | Quarterly breakdown |

### Column Mapping (DSTB)
| Excel Column | System Field |
|---|---|
| # | id |
| Validation Status | validation_status |
| Date of Screening | date_of_screening |
| Date of Diagnosis | date_of_diagnosis |
| Date of Notification | date_of_notification |
| Age | age |
| Sex | sex |
| Brgy | barangay_name |
| City/Municipality | city |
| Screening/Diagnosing Health Facility | screening_facility |
| Treatment Health Facility | treatment_facility |
| Source of Patient | source_of_patient |
| Anatomical Site | anatomical_site |
| Registration Group | registration_group |
| Bacteriologic Status | bacteriological_status |
| Date Started Tx | date_started_treatment |
| Outcome/Status | outcome_status |
| Date of Outcome/Status | date_of_outcome |

### Column Mapping (MN)
| Excel Column | System Field |
|---|---|
| No. | id |
| Type | type (always "MN") |
| Date of Diagnosis | date_of_diagnosis |
| Date of Notification | date_of_notification |
| ITIS Lite Case No. | itis_case_id |
| Age | age |
| Sex | sex |
| Brgy | barangay_name |
| City/Municipality | city |
| Province | province |
| Region | region |
| Screening/Diagnosing Health Facility | screening_facility |
| Treatment Health Facility | treatment_facility |
| Referred to DOTS | referred_to_dots |
| Referral Status | referral_status |
| Source of Patient | source_of_patient |
| Anatomical Site | anatomical_site |
| Registration Group | registration_group |
| Bacteriologic Status | bacteriological_status |
| Microscopy Result | microscopy_result |
| Microscopy Release Date | microscopy_release_date |
| RDT Result | rdt_result |
| RDT Release Date | rdt_release_date |
| Date Started Tx | date_started_treatment |
| Outcome/Status | outcome_status |
| Date of Outcome/Status | date_of_outcome |
| Outcome Reason | outcome_reason |

### Data Quality Issues
- 191 DSTB + 237 MN rows with NULL barangay (cannot map to GIS)
- ~200+ rows from non-Pasig barangays (Antipolo, San Mateo, etc.) — must filter out
- 46% of DSTB rows are "Not validated"
- Only 1 year of data (2025) — limits ARIMA forecasting reliability

### Recommendation
- Filter to Pasig barangays only during import
- Use for basic analytics, reports, and risk scoring
- Show "Low Reliability" warning for forecasts (Phase 3A)
- Historical data (2024, 2023) needed for reliable long-term forecasting

---

## Phase 1: Core Risk Transparency, Population, TSR, NLG & Reports

---

### 1A. Update Population Data to DOH FHSIS 2024 + 2025

**Problem**: Current population in `pasig-barangays.geojson` is placeholder data. Incidence calculations are wrong.

**Action**:

1. Create `BACKEND/data/pasig-population.json`:
```json
{
  "source": "DOH FHSIS",
  "defaultYear": 2025,
  "years": {
    "2024": {
      "City of Pasig": 833749,
      "Bagong Ilog": 21120,
      "Bagong Katipunan": 881,
      "Bambang": 21595,
      "Buting": 10742,
      "Caniogan": 29162,
      "Dela Paz": 20566,
      "Kalawaan": 33369,
      "Kapasigan": 4961,
      "Kapitolyo": 9556,
      "Malinao": 4998,
      "Manggahan": 91442,
      "Maybunga": 47301,
      "Oranbo": 3388,
      "Palatiw": 28546,
      "Pinagbuhatan": 169842,
      "Pineda": 20241,
      "Rosario": 76806,
      "Sagad": 6264,
      "San Antonio": 12169,
      "San Joaquin": 14346,
      "San Jose": 1872,
      "San Miguel": 41736,
      "San Nicolas": 2703,
      "Santa Cruz": 5815,
      "Santa Rosa": 1021,
      "Santo Tomas": 13398,
      "Santolan": 60147,
      "Sumilang": 4496,
      "Ugong": 29842,
      "Santa Lucia": 45424
    },
    "2025": {
      "City of Pasig": 842708,
      "Bagong Ilog": 21345,
      "Bagong Katipunan": 892,
      "Bambang": 21827,
      "Buting": 10861,
      "Caniogan": 29464,
      "Dela Paz": 20782,
      "Kalawaan": 33732,
      "Kapasigan": 5007,
      "Kapitolyo": 9662,
      "Malinao": 5050,
      "Manggahan": 92423,
      "Maybunga": 47802,
      "Oranbo": 3421,
      "Palatiw": 28852,
      "Pinagbuhatan": 171659,
      "Pineda": 20459,
      "Rosario": 77632,
      "Sagad": 6332,
      "San Antonio": 12307,
      "San Joaquin": 14510,
      "San Jose": 1905,
      "San Miguel": 42181,
      "San Nicolas": 2724,
      "Santa Cruz": 5883,
      "Santa Rosa": 1036,
      "Santo Tomas": 13542,
      "Santolan": 60797,
      "Sumilang": 4546,
      "Ugong": 30159,
      "Santa Lucia": 45916
    }
  }
}
```

2. Update `BACKEND/data/pasig-barangays.geojson`:
   - Rename "Kapasigan Extension" to "Bagong Katipunan"
   - Update all 30 barangay population values to 2025 FHSIS data

3. Update `BACKEND/tbinsight/barangays.js`:
   - Seed function reads from `pasig-population.json` (defaultYear)
   - Add `getPopulationForYear(barangayName, year)` helper function

4. Run `POST /api/tb/barangays/seed` to update database tables

**Files**:
| File | Action |
|---|---|
| `BACKEND/data/pasig-population.json` | CREATE |
| `BACKEND/data/pasig-barangays.geojson` | MODIFY |
| `BACKEND/tbinsight/barangays.js` | MODIFY |

---

### 1B. Fix Treatment Success Rate Formula

**Problem**: Current TSR uses evaluated cases as denominator. Client formula uses total patients.

**Current** (`insightDataBuilder.js:292-294`):
```js
successRate = evaluatedCount > 0
  ? Math.round(((curedCount + completedCount) / evaluatedCount) * 1000) / 10
  : 0;
```

**New**:
```js
const totalPatients = totalRes.rows[0]?.total_cases || 0;
successRate = totalPatients > 0
  ? Math.round(((curedCount + completedCount) / totalPatients) * 1000) / 10
  : 0;
```

**Files**:
| File | Action |
|---|---|
| `BACKEND/tbinsight/insightDataBuilder.js` | MODIFY |
| `BACKEND/tbinsight/nlgEngine.js` | MODIFY (label text) |

---

### 1C. GIS Risk Breakdown Panel

**Problem**: Client wants to understand WHY a barangay is classified as High/Medium/Low.

**Action**: Add collapsible section in barangay detail modal showing:

| Component | Weight | Display |
|---|---|---|
| Incidence Rate | 45% | cases/100k (normalized 0-1) |
| Trend Direction | 25% | slope value (normalized 0-1) |
| Neighbor Risk | 20% | avg neighbor incidence (normalized 0-1) |
| Forecast Error | 10% | avg absolute error (normalized 0-1) |

Plus: final score (0-100), classification, plain-language explanation.

**Files**:
| File | Action |
|---|---|
| `FRONTEND/src/pages/GisMap.jsx` | MODIFY |

---

### 1D. GIS NLG Insight — Map-Level + Per-Barangay

**Problem**: GIS page has no natural language insights.

**Action**: Two NLG components.

**Map-Level NLG Card** (top of GIS sidebar):
- Summarizes overall situation: risk distribution, TSR, trend, high-risk barangays
- Updates when year filter changes
- Example: "3 barangays are high-risk: Pinagbuhatan, Manggahan, Rosario. Pasig TSR is 72%, below the 85% target."

**Per-Barangay NLG** (inside barangay detail modal):
- Example: "Barangay Rosario: 77,632 pop, 45 cases. Risk: Medium (52/100). TSR: 82%. Trend: Increasing."

**New endpoint**:
```
GET /api/tb/insights/gis?year=2025
Response: {
  mapLevel: { sections: [{ id, title, text }], meta: {...} },
  barangays: [{ name, sections: [{ id, title, text }], meta: {...} }]
}
```

**Files**:
| File | Action |
|---|---|
| `BACKEND/tbinsight/gisInsightBuilder.js` | CREATE |
| `BACKEND/tbinsight/gisNlgEngine.js` | CREATE |
| `BACKEND/tbinsight/routes.js` | MODIFY |
| `FRONTEND/src/components/GisInsightCard.jsx` | CREATE |
| `FRONTEND/src/pages/GisMap.jsx` | MODIFY |
| `FRONTEND/src/services/insightService.js` | MODIFY |

---

### 1E. Reports — Treatment Cascade

**Problem**: Client wants to see: Enrolled -> Started -> Completed -> Defaulted.

**Cascade stages**:
| Stage | Logic |
|---|---|
| Total Enrolled | COUNT(*) |
| Started Treatment | date_started_treatment IS NOT NULL |
| Cured | outcome_status = 'CURED' |
| Treatment Completed | outcome_status = 'TREATMENT COMPLETED' |
| On Treatment | outcome_status = 'ON TREATMENT' |
| Lost to Follow-Up | outcome_status = 'LOST TO FOLLOW-UP' |
| Died | outcome_status = 'DIED' |
| Not Evaluated | outcome_status = 'NOT EVALUATED' |

Plus: TSR = (Cured + Completed) / Total x 100%, Default Rate = LTFU / Total x 100%

**Files**:
| File | Action |
|---|---|
| `BACKEND/tbinsight/routes.js` | MODIFY |
| `FRONTEND/src/pages/Reports.jsx` | MODIFY |
| `FRONTEND/src/utils/exportReports.js` | MODIFY |

---

### 1F. Year-Over-Year Trending

**Problem**: Client wants to compare yearly case counts (2024 vs 2025 vs 2026).

**Action**:
- New dashboard chart: grouped bar chart showing cases per year
- Reports: year-over-year comparison table

**New endpoint**:
```
GET /api/tb/dashboard/yearly
Response: { yearly: [{ year: 2024, case_count: 1250 }, ...] }
```

**Files**:
| File | Action |
|---|---|
| `BACKEND/tbinsight/routes.js` | MODIFY |
| `FRONTEND/src/components/YearlyTrendChart.jsx` | CREATE |
| `FRONTEND/src/pages/DashboardPage.jsx` | MODIFY |
| `FRONTEND/src/pages/Reports.jsx` | MODIFY |

---

## Phase 2: Multi-Facility Support

---

### 2A. User Facility Assignment

**Problem**: Pasig has 42+ health centers. Staff need facility assignment.

**Action**:
1. Add `facility_name TEXT` column to `users` table
2. Admin selects facility when creating staff account
3. Staff see ALL data (not filtered)
4. Data entry auto-tagged with user's facility

**Migration**:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS facility_name TEXT;
```

**Files**:
| File | Action |
|---|---|
| `BACKEND/db/migrations/012_user_facility.sql` | CREATE |
| `BACKEND/init.sql` | MODIFY |
| `BACKEND/routes/auth.js` | MODIFY |
| `FRONTEND/src/pages/Users.jsx` | MODIFY |

---

### 2B. Simplified Data Entry Form

**Problem**: Only CSV upload exists. Staff need a simple form.

**Form fields**:
| Field | Type | Required |
|---|---|---|
| Barangay | Dropdown | Yes |
| Age | Number | No |
| Sex | M/F | No |
| Date of Diagnosis | Date | Yes |
| Screening Facility | Auto-filled | Yes |
| Outcome Status | Dropdown | No |

**New endpoint**:
```
POST /api/tb/cases
Body: { barangay_name, age, sex, date_of_diagnosis, screening_facility, outcome_status, ... }
Response: { id, message: "Case created successfully" }
```

**Files**:
| File | Action |
|---|---|
| `BACKEND/tbinsight/routes.js` | MODIFY |
| `FRONTEND/src/pages/DataEntry.jsx` | CREATE |
| `FRONTEND/src/App.jsx` | MODIFY |
| `FRONTEND/components/Layout.jsx` | MODIFY |

---

## Phase 3: Polish & Verification

---

### 3A. Data Sufficiency Indicator

**Problem**: Client concerned about 8,000 record threshold. System works with any data.

**Reliability levels**:
| Months of Data | Label | Color |
|---|---|---|
| <6 | Low Reliability | Red |
| 6-12 | Medium Reliability | Yellow |
| >12 | High Reliability | Green |

**Files**:
| File | Action |
|---|---|
| `BACKEND/tbinsight/routes.js` | MODIFY |
| `FRONTEND/src/pages/Forecasting.jsx` | MODIFY |
| `FRONTEND/src/pages/GisMap.jsx` | MODIFY |

---

### 3B. Intervention Overdue Notifications

**Problem**: Overdue logic exists but no automatic notification.

**Action**:
1. Verify `isOverdue()` in `InterventionPlanning.jsx`
2. Add overdue count to sidebar nav badge

**Files**:
| File | Action |
|---|---|
| `BACKEND/tbinsight/routes.js` | MODIFY |
| `FRONTEND/components/Layout.jsx` | MODIFY |

---

### 3C. NLG Engine — Include TSR

**Problem**: NLG insights should reference TSR.

**Files**:
| File | Action |
|---|---|
| `BACKEND/tbinsight/nlgEngine.js` | MODIFY |
| `BACKEND/tbinsight/gisNlgEngine.js` | MODIFY |

---

## Excluded Items

| Item | Reason |
|---|---|
| TPT tracking | Out of scope per client |
| Contact investigation | Out of scope per client |
| Offline encoding | Web-based system only |
| EMR integration | Blocked by government privacy restrictions |
| Excel population upload | JSON file approach chosen |
| Detailed FHSIS age groups | Only total population needed |

---

## Complete File Change Summary

### New Files (7)

| File | Phase | Description |
|---|---|---|
| `BACKEND/data/pasig-population.json` | 1A | FHSIS 2024 + 2025 population |
| `BACKEND/tbinsight/gisInsightBuilder.js` | 1D | GIS metrics computation |
| `BACKEND/tbinsight/gisNlgEngine.js` | 1D, 3C | GIS NLG templates |
| `FRONTEND/src/components/GisInsightCard.jsx` | 1D | Map-level NLG card |
| `FRONTEND/src/components/YearlyTrendChart.jsx` | 1F | Yearly bar chart |
| `FRONTEND/src/pages/DataEntry.jsx` | 2B | Case entry form |
| `BACKEND/db/migrations/012_user_facility.sql` | 2A | Add facility_name column |

### Modified Files (16)

| File | Phase | Description |
|---|---|---|
| `BACKEND/data/pasig-barangays.geojson` | 1A | Fix name + population |
| `BACKEND/tbinsight/barangays.js` | 1A | Read from JSON, add lookup |
| `BACKEND/tbinsight/insightDataBuilder.js` | 1B | Fix TSR denominator |
| `BACKEND/tbinsight/nlgEngine.js` | 1B, 3C | Update TSR text |
| `BACKEND/tbinsight/routes.js` | 1D, 1E, 1F, 2B, 3A, 3B | New endpoints |
| `FRONTEND/src/pages/GisMap.jsx` | 1C, 1D, 3A | Risk panel + NLG + badge |
| `FRONTEND/src/pages/Reports.jsx` | 1E, 1F | Cascade + yearly |
| `FRONTEND/src/utils/exportReports.js` | 1E | Cascade in exports |
| `FRONTEND/src/pages/DashboardPage.jsx` | 1F | Yearly chart |
| `FRONTEND/src/services/insightService.js` | 1D | GIS insight function |
| `BACKEND/init.sql` | 2A | Add facility_name column |
| `BACKEND/routes/auth.js` | 2A | Accept facility_name |
| `FRONTEND/src/pages/Users.jsx` | 2A | Facility dropdown |
| `FRONTEND/src/App.jsx` | 2B | Add data entry route |
| `FRONTEND/components/Layout.jsx` | 2B, 3B | Nav items + badges |
| `FRONTEND/src/pages/Forecasting.jsx` | 3A | Reliability badge |

---

## Implementation Order

| Step | Phase | Task | Size | Dependencies |
|---|---|---|---|---|
| 1 | 1A | Update population data | S | None |
| 2 | 1B | Fix TSR formula | S | None |
| 3 | 1C | GIS risk breakdown panel | M | None |
| 4 | 1D | GIS NLG insight | L | Steps 1, 2 |
| 5 | 1E | Treatment cascade in reports | M | Step 2 |
| 6 | 1F | Year-over-year trending | M | None |
| 7 | 2A | User facility assignment | S | None |
| 8 | 2B | Data entry form | M | Step 7 |
| 9 | 3A | Data sufficiency indicator | S | None |
| 10 | 3B | Overdue notifications | S | None |
| 11 | 3C | TSR in NLG engine | S | Steps 2, 4 |

---

## Workflow for Future Population Updates

When new FHSIS data is released (e.g., 2026):
1. Add new year's data to `pasig-population.json`
2. Update `defaultYear` to 2026
3. Run `POST /api/tb/barangays/seed`
4. System automatically uses new population for incidence calculations

---

## Dataset Import Workflow

To import `2025 CASES_JRU (2).xlsx`:
1. Parse DSTB sheet (skip header rows 1-5, row 6 = headers)
2. Parse MN sheet (row 1 = headers)
3. Filter to Pasig barangays only (30 barangays)
4. Normalize barangay names (uppercase matching)
5. Map columns to `tb_cases` schema
6. Insert into `tb_cases_raw` (L1) + `tb_cases` (L2)
7. Rebuild aggregations (L3)
