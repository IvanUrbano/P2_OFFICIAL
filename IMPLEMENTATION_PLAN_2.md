# IMPLEMENTATION PLAN 2: Professor Feedback Response

## AI-Powered Automated Insights (Template-Based NLG) + Data Integration Pipeline Finalization

---

## TABLE OF CONTENTS

1. [Overview](#1-overview)
2. [Deliverable 1: AI-Powered Automated Insights](#2-deliverable-1)
3. [Deliverable 2: Data Integration Pipeline](#3-deliverable-2)
4. [NLG Engine Specification](#4-nlg-engine-specification)
5. [Testing Strategy](#5-testing-strategy)
6. [Implementation Checklist](#6-implementation-checklist)
7. [Timeline](#7-timeline)
8. [Defense Terminology](#8-defense-terminology)

---

## 1. OVERVIEW

### 1.1 Professor Feedback

| # | Feedback | Deliverable |
|---|----------|-------------|
| 1 | "Use models for verbal interpretation of table reports" | AI-Powered Automated Insights (Template-Based NLG) |
| 2 | "Finalize pipeline of data integration from clone system to actual" | Data Integration Pipeline Finalization |

### 1.2 Architecture

```
DELIVERABLE 1: Template-Based Natural Language Generation
═══════════════════════════════════════════════════════════

TB Records
    ↓
Aggregation / ARIMA / Random Forest
    ↓
Calculated Metrics (trends, %, counts, risk classes)
    ↓
┌───────────────────────────┐
│  Insight Data Builder     │  ← Pure metric calculation (no text)
│  insightDataBuilder.js    │
└───────────┬───────────────┘
            │
            ▼
┌───────────────────────────┐
│  Template-Based NLG       │  ← Pure text generation (no math)
│  nlgEngine.js             │
└───────────┬───────────────┘
            │
            ▼
Structured Verbal Interpretation
            │
      ┌─────┴─────┐
      ▼           ▼
  Analytics   Forecasting
    Page        Page
      │           │
      ▼           ▼
┌───────────────────────────┐
│  AiInsightPanel.jsx       │  ← Reusable display component
└───────────────────────────┘


DELIVERABLE 2: Data Integration Pipeline
═════════════════════════════════════════

Pasig Clone ──HMAC POST──▶ TBInsight Backend
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              Verify HMAC   Insert to    Rebuild
              + Validate    tb_cases     Aggregations
                                │
                                ▼
                    ┌───────────┴───────────┐
                    ▼                       ▼
              Webhook Log UI         Dashboard/Reports
              (DataIntegration.jsx)  (auto-updated)
```

### 1.3 Key Design Principle

```
ARIMA computes forecasts.
Random Forest classifies risk.
NLG explains these results in natural language.
```

The NLG component **never calculates** — it only converts computed findings into readable text. Every generated statement corresponds to an actual computed value.

### 1.4 File Summary

| # | File | Action | Deliverable |
|---|------|--------|-------------|
| 1 | `BACKEND/tbinsight/insightDataBuilder.js` | CREATE | NLG |
| 2 | `BACKEND/tbinsight/nlgEngine.js` | CREATE | NLG |
| 3 | `FRONTEND/src/components/AiInsightPanel.jsx` | CREATE | NLG |
| 4 | `FRONTEND/src/services/insightService.js` | CREATE | NLG |
| 5 | `BACKEND/db/migrations/008_add_source_type_columns.sql` | CREATE | Pipeline |
| 6 | `BACKEND/tbinsight/routes.js` | MODIFY | Both (add 3 endpoints) |
| 7 | `FRONTEND/src/pages/Analytics.jsx` | MODIFY | NLG (add insight panel) |
| 8 | `FRONTEND/src/pages/Forecasting.jsx` | MODIFY | NLG (add insight panel) |
| 9 | `FRONTEND/src/pages/DataIntegration.jsx` | MODIFY | Pipeline (webhook UI) |

---

## 2. DELIVERABLE 1: AI-POWERED AUTOMATED INSIGHTS

### 2.1 Data Flow

```
Analytics.jsx / Forecasting.jsx
         │
         │ User clicks [✦ Generate Insight]
         ▼
GET /api/tb/insights/analytics?year=2026&month=8&barangay=All
         │
         ▼
┌──────────────────────────────┐
│  Insight Data Builder        │
│  (insightDataBuilder.js)     │
│                              │
│  Input: raw DB data + filters│
│  Output: structured metrics  │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  NLG Engine                  │
│  (nlgEngine.js)              │
│                              │
│  Input: metrics object       │
│  Output: text sections       │
└──────────────┬───────────────┘
               │
               ▼
JSON response with sections
               │
               ▼
<AiInsightPanel type="analytics" data={...} />
```

### 2.2 Backend: Insight Data Builder

**NEW FILE:** `BACKEND/tbinsight/insightDataBuilder.js`

Pure metric calculation module. Two exported functions:

#### `buildAnalyticsMetrics(cases, barangays, riskData, forecastsData, filters)`

| Metric | Source | Calculation |
|--------|--------|-------------|
| `trend.direction` | Monthly case counts | Last 3 months avg vs prior 3 months avg |
| `trend.changePercent` | Monthly case counts | `((recent - older) / older) * 100` |
| `highestBarangay` | `cases` grouped by barangay | Max case count |
| `lowestBarangay` | `cases` grouped by barangay | Min case count |
| `significantChanges[]` | Per-barangay monthly history | z-score >= 2.0 AND current > historical mean |
| `riskCounts` | `riskData` / `forecastsData` | Count by risk_class |
| `highRiskBarangays[]` | `riskData` / `forecastsData` | Where `risk_class === 'High'` |
| `demographics.sexSplit` | `cases` | Male/Female percentages |
| `demographics.dominantAgeGroup` | `cases` | Age group with highest count |
| `treatment.successRate` | `cases` outcome_status | `(CURED + COMPLETED) / evaluated * 100` |
| `treatment.outcomeBreakdown` | `cases` | Counts per outcome |
| `summary` | All above | Date range, total, barangays with data |

#### `buildForecastingMetrics(forecasts, aggregatedMonthly, riskData, barangays, filters)`

| Metric | Source | Calculation |
|--------|--------|-------------|
| `direction.trend` | `forecasts` | Growth rate sign |
| `direction.growthRate` | `forecasts` vs historical avg | `((firstForecast - monthlyAvg) / monthlyAvg) * 100` |
| `predictedCases.total` | `forecasts` | Sum of forecasted counts (future only) |
| `predictedCases.monthlyAvg` | `forecasts` | `total / horizon` |
| `peakPeriod` | `forecasts` | Period with max forecasted count |
| `highRiskForecastBarangays[]` | `forecasts` | Where `risk_class === 'High'` |
| `confidence.avgRelativeCIWidth` | `forecasts` | `AVG((upper - lower) / forecasted)` |
| `confidence.interpretation` | Computed | `< 0.3` narrow, `0.3-0.6` moderate, `> 0.6` wide |
| `modelInfo` | Pipeline metadata | Method, horizon, barangays processed |

#### Significance Rule (Defensible)

```javascript
// Per barangay: compute monthly case counts across its history
// z-score = (current_month - mean) / stddev
// Significant if: zScore >= 2.0 AND current_month > historical_mean
// This avoids flagging trivial changes (e.g., 1 to 2 cases)
```

#### Confidence Interpretation Rule (Defensible)

```javascript
// Relative CI Width = (Upper CI - Lower CI) / Forecasted Value
// < 0.3  -> "narrow confidence intervals, indicating high forecast certainty"
// 0.3-0.6 -> "moderate confidence intervals"
// > 0.6  -> "wide confidence intervals, indicating significant uncertainty"
```

### 2.3 Backend: New API Endpoints

**MODIFIED FILE:** `BACKEND/tbinsight/routes.js`

#### `GET /api/tb/insights/analytics`

Query params: `year, month, barangay, outcome, sex, ageGroup, bacteriological`

Response:
```json
{
  "type": "analytics",
  "sections": [
    { "id": "keyTrend", "title": "Key Trend", "icon": "📈", "text": "..." },
    { "id": "highestLowest", "title": "Highest / Lowest", "icon": "📊", "text": "..." },
    { "id": "significantChanges", "title": "Significant Changes", "icon": "⚠️", "text": "..." },
    { "id": "riskFindings", "title": "Risk Findings", "icon": "🎯", "text": "..." },
    { "id": "demographics", "title": "Demographics", "icon": "👥", "text": "..." },
    { "id": "treatment", "title": "Treatment", "icon": "💊", "text": "..." },
    { "id": "overallSummary", "title": "Overall Summary", "icon": "📝", "text": "..." }
  ],
  "meta": {
    "basedOn": "2026 • August • All Barangays",
    "generatedAt": "2026-09-07T22:30:00Z"
  }
}
```

#### `GET /api/tb/insights/forecasting`

Query params: `startYear, endYear, barangay, horizon`

Same response structure as analytics but with forecasting sections.

#### `GET /api/tb/webhook-logs`

Response:
```json
{
  "logs": [
    {
      "id": 1,
      "source": "pasig-clone",
      "batch_id": "...",
      "status": "processed",
      "records_received": 175,
      "records_imported": 170,
      "received_at": "2026-09-04T10:30:00Z"
    }
  ]
}
```

### 2.4 Frontend: AiInsightPanel Component

**NEW FILE:** `FRONTEND/src/components/AiInsightPanel.jsx`

Props:
```jsx
<AiInsightPanel
  type="analytics"          // or "forecasting"
  data={insightData}        // from API response
  loading={false}
  error={null}
  onRetry={() => {}}
/>
```

Visual layout:
```
┌──────────────────────────────────────────────────┐
│ ✦ NLG-GENERATED ANALYTICS INSIGHT               │
│                                                  │
│ Based on: Aug 2026 • All Barangays              │
│ ──────────────────────────────────────────────── │
│                                                  │
│ 📈 KEY TREND                                     │
│ TB cases show an increasing trend of 18.4%...   │
│                                                  │
│ 📊 HIGHEST / LOWEST                              │
│ Barangay San Jose recorded the highest...       │
│                                                  │
│ ⚠ SIGNIFICANT CHANGES                            │
│ Barangay Manggahan showed a 32% increase...     │
│                                                  │
│ 🎯 RISK FINDINGS                                 │
│ 4 barangays are classified as high-risk...      │
│                                                  │
│ 👥 DEMOGRAPHICS                                  │
│ Males account for 62% of cases...               │
│                                                  │
│ 💊 TREATMENT                                     │
│ Treatment success rate is 82%...                 │
│                                                  │
│ ──────────────────────────────────────────────── │
│ OVERALL SUMMARY                                   │
│ TB activity increased during the current...     │
│                                                  │
│ Generated from calculated TBInsight model results │
└──────────────────────────────────────────────────┘
```

States:
- **Loading:** "Generating interpretation from the current TBInsight model results..."
- **Error:** "Unable to generate the interpretation. The underlying analytics and charts are still available. [Retry]"
- **Success:** Full section display

Key principle: NLG failure never breaks the page. Charts always render regardless.

### 2.5 Frontend: Insight Service

**NEW FILE:** `FRONTEND/src/services/insightService.js`

```javascript
import API from '../api/axios';

export async function getAnalyticsInsight(filters) {
  const params = new URLSearchParams();
  if (filters.year) params.set('year', filters.year);
  if (filters.month) params.set('month', filters.month);
  if (filters.barangay) params.set('barangay', filters.barangay);
  if (filters.outcome) params.set('outcome', filters.outcome);
  if (filters.sex) params.set('sex', filters.sex);
  if (filters.ageGroup) params.set('ageGroup', filters.ageGroup);
  if (filters.bacteriological) params.set('bacteriological', filters.bacteriological);
  const res = await API.get(`/api/tb/insights/analytics?${params}`);
  return res.data;
}

export async function getForecastingInsight(filters) {
  const params = new URLSearchParams();
  if (filters.startYear) params.set('startYear', filters.startYear);
  if (filters.endYear) params.set('endYear', filters.endYear);
  if (filters.barangay) params.set('barangay', filters.barangay);
  if (filters.horizon) params.set('horizon', filters.horizon);
  const res = await API.get(`/api/tb/insights/forecasting?${params}`);
  return res.data;
}

export async function getWebhookLogs() {
  const res = await API.get('/api/tb/webhook-logs');
  return res.data;
}
```

### 2.6 Frontend: Analytics.jsx Integration

Integration points:

| Location | Line | Change |
|----------|------|--------|
| Imports | Line 1-7 | Add `AiInsightPanel` + `insightService` imports |
| State | After line 168 | Add `insightData`, `insightLoading`, `insightError` state |
| Generate handler | New function | `handleGenerateInsight()` calls API with current applied filters |
| Button | Lines 728-735 | Add "Generate Insight" button next to "Apply Filters" |
| Panel | Lines 1090-1117 | Replace existing "Key Insights" section with `<AiInsightPanel>` |

Filter flow:
```
User selects filters
       ↓
[Apply Filters]  ->  Charts/Tables update
       ↓
[Generate Insight]  ->  Backend computes metrics  ->  NLG generates text  ->  Panel displays
```

### 2.7 Frontend: Forecasting.jsx Integration

Integration points:

| Location | Line | Change |
|----------|------|--------|
| Imports | Line 1-6 | Add `AiInsightPanel` + `insightService` imports |
| State | After line 152 | Add `insightData`, `insightLoading`, `insightError` state |
| Generate handler | New function | `handleGenerateInsight()` calls API with applied filters |
| Button | Lines 725-735 | Add "Generate Insight" button next to "Run Forecast" |
| Panel | Lines 1231-1277 | Replace existing "Forecast Summary" section with `<AiInsightPanel>` |

---

## 3. DELIVERABLE 2: DATA INTEGRATION PIPELINE

### 3.1 Current State Assessment

| Component | Status | File |
|-----------|--------|------|
| Webhook endpoint | ✅ Done | `BACKEND/tbinsight/webhook.js` |
| HMAC-SHA256 verification | ✅ Done | `BACKEND/middleware/webhookAuth.js` |
| Webhook route mounting | ✅ Done | `BACKEND/server.js:94` |
| `WEBHOOK_SECRET` validation | ✅ Done | `BACKEND/server.js:8` |
| `webhook_logs` table | ✅ Done | Migration `007_webhook_logs.sql` |
| Pasig Clone sender | ✅ Done | `PASIG_CLONE/backend/services/webhookSender.js` |
| Pasig Clone frontend | ✅ Done | `PASIG_CLONE/frontend/src/pages/WebhookStatusPage.jsx` |
| Render deployment config | ✅ Done | `render.yaml` (lines 38-77) |
| End-to-end tested | ❓ Unknown | Needs verification |

### 3.2 Gaps to Fix

| # | Gap | Fix |
|---|-----|-----|
| 1 | `tb_cases` may lack `source_type` + `location_classification` columns | New migration `008` |
| 2 | No webhook log viewer in TBInsight frontend | Add to `DataIntegration.jsx` |
| 3 | No read endpoint for webhook logs in TBInsight API | Add `GET /api/tb/webhook-logs` |

### 3.3 Migration

**NEW FILE:** `BACKEND/db/migrations/008_add_source_type_columns.sql`

```sql
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'DSTB';
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS location_classification TEXT DEFAULT 'Pasig City';
ALTER TABLE tb_cases_raw ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'DSTB';
ALTER TABLE tb_cases_raw ADD COLUMN IF NOT EXISTS location_classification TEXT DEFAULT 'Pasig City';
```

### 3.4 DataIntegration.jsx Enhancement

Add a "Webhook Integration" section alongside existing CSV import:

```
┌──────────────────────────────────────────────────┐
│ Webhook Integration                              │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ Connection Status                            │ │
│ │ ● Connected — Last webhook: Sep 4, 2026     │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ Webhook History                              │ │
│ │                                              │ │
│ │ Date       │ Source      │ Records │ Status  │ │
│ │ Sep 4      │ pasig-clone │ 175     │ Done    │ │
│ │ Sep 2      │ pasig-clone │ 120     │ Done    │ │
│ │ Aug 28     │ pasig-clone │ 95      │ Failed  │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### 3.5 End-to-End Pipeline Verification Steps

```
STEP 1: Pasig Clone — Upload Excel
  POST /api/data/import -> Parses DSTB + MN sheets -> Stores raw records

STEP 2: Pasig Clone — Validate
  POST /api/data/validate/:batchId -> Validates against 30 barangays

STEP 3: Pasig Clone — Send Webhook
  POST /api/webhook/send -> HMAC-SHA256 signed payload -> POST to TBInsight

STEP 4: TBInsight — Receive Webhook
  POST /api/webhook/pasig-clone -> Verify HMAC -> Insert into tb_cases -> Rebuild aggregations

STEP 5: TBInsight — Run Pipeline (manual trigger)
  POST /api/tb/pipeline -> ARIMA forecasts -> RF classification -> Risk scores -> Alerts
```

---

## 4. NLG ENGINE SPECIFICATION

### 4.1 Analytics NLG — Conditional Templates

#### 1. Key Trend — 3 Branches

**Condition:**
```javascript
const direction = changePercent > 5 ? 'increasing'
               : changePercent < -5 ? 'decreasing'
               : 'stable';
```

| Branch | Condition | Template |
|--------|-----------|----------|
| Increasing | `changePercent > 5` | "TB cases show an **increasing trend** of **{changePercent}%** over the last 3 months ({recentCount} cases) compared with the prior 3 months ({priorCount} cases)." |
| Decreasing | `changePercent < -5` | "TB cases show a **decreasing trend** of **{abs(changePercent)}%** over the last 3 months ({recentCount} cases) compared with the prior 3 months ({priorCount} cases)." |
| Stable | `-5 <= changePercent <= 5` | "TB cases remained **relatively stable** over the last 3 months, with {recentCount} cases compared with {priorCount} cases during the prior 3 months." |

#### 2. Highest / Lowest — 3 Branches

| Branch | Condition | Template |
|--------|-----------|----------|
| Normal | `hasData && !isSame` | "Barangay **{highest.name}** recorded the highest case count ({highest.cases} cases), while Barangay **{lowest.name}** recorded the lowest ({lowest.cases} cases)." |
| Same barangay | `hasData && isSame` | "Barangay **{highest.name}** recorded both the highest and lowest case counts ({highest.cases} cases), as only one barangay reported cases during this period." |
| No data | `!hasData` | "No barangay data available for the selected period." |

#### 3. Significant Changes — 3 Branches

| Branch | Condition | Template |
|--------|-----------|----------|
| Significant increase(s) | `significant.length > 0 && hasIncrease` | "Barangay **{name}** showed a notable **{changePercent}% increase** in {month}, with cases exceeding its historical average ({zScore} standard deviations above the mean)." |
| Significant decrease(s) | `significant.length > 0 && hasDecrease` | "Barangay **{name}** showed a notable **{abs(changePercent)}% decrease** in {month}, with cases below its historical average." |
| No significant changes | `significant.length === 0` | "No barangay showed a statistically notable change compared with its historical average during the selected period." |

#### 4. Risk Findings — 3 Branches

| Branch | Condition | Template |
|--------|-----------|----------|
| Few high-risk | `highCount > 0 && highCount <= 5` | "**{highCount}** barangay(s) are classified as **high-risk**: {name1}, {name2}, ..." |
| Many high-risk | `highCount > 5` | "**{highCount}** barangays are classified as **high-risk**, including {name1}, {name2}, {name3}, and {name4}." |
| No high-risk | `highCount === 0` | "No barangays are currently classified as high-risk based on the selected results." |

Optional: If no high-risk but medium-risk exists, append: "However, {medCount} barangay(s) are classified as medium-risk and should continue to be monitored."

#### 5. Demographics — 4 Branches

| Branch | Condition | Template |
|--------|-----------|----------|
| Male majority | `malePct > femalePct + 5` | "Males account for **{malePct}%** of reported cases. The **{dominantAge.group}** age group represents the largest demographic at **{dominantAge.percentage}%**." |
| Female majority | `femalePct > malePct + 5` | "Females account for **{femalePct}%** of reported cases. The **{dominantAge.group}** age group represents the largest demographic at **{dominantAge.percentage}%**." |
| Balanced | `abs(malePct - femalePct) <= 5` | "Cases were relatively balanced by sex, with males at **{malePct}%** and females at **{femalePct}%**. The **{dominantAge.group}** age group represents the largest demographic at **{dominantAge.percentage}%**." |
| No data | `malePct === 0 && femalePct === 0` | "No demographic data available for the selected period." |

#### 6. Treatment — 3 Branches

| Branch | Condition | Template |
|--------|-----------|----------|
| Above target | `rate > 85` | "Treatment success rate is **{rate}%**, **exceeding** the DOH target of 85%." |
| Below target | `rate < 85` | "Treatment success rate is **{rate}%**, **below** the DOH target of 85%." |
| Meets target | `rate === 85` | "Treatment success rate is **{rate}%**, **meeting** the 85% target." |

#### 7. Overall Summary — Rule-Based Synthesis

Build dynamically from findings:

```javascript
function generateOverallSummary(metrics) {
  const parts = [];

  // Part 1: Trend
  if (metrics.trend.direction === 'increasing') {
    parts.push('TB activity is increasing during the selected period.');
  } else if (metrics.trend.direction === 'decreasing') {
    parts.push('TB activity shows a declining trend during the selected period.');
  } else {
    parts.push('TB activity remained stable during the selected period.');
  }

  // Part 2: Risk
  if (metrics.riskCounts.high > 0) {
    parts.push(`${metrics.riskCounts.high} barangay(s) are classified as high-risk.`);
  } else {
    parts.push('No barangays are currently classified as high-risk.');
  }

  // Part 3: Treatment
  if (metrics.treatment.successRate >= 85) {
    parts.push('Treatment success is at or above the 85% target, indicating favorable current treatment outcomes.');
  } else {
    parts.push('Treatment success remains below the 85% target, indicating areas that may require closer monitoring.');
  }

  return parts.join(' ');
}
```

### 4.2 Forecasting NLG — Conditional Templates

#### 1. Forecast Direction — 3 Branches

| Branch | Condition | Template |
|--------|-----------|----------|
| Increasing | `growthRate > 5` | "TB cases are projected to **increase** over the next {horizon} months." |
| Decreasing | `growthRate < -5` | "TB cases are projected to **decrease** over the next {horizon} months." |
| Stable | `-5 <= growthRate <= 5` | "TB cases are projected to remain **relatively stable** over the next {horizon} months." |

#### 2. Predicted Cases — 2 Branches

| Branch | Condition | Template |
|--------|-----------|----------|
| Has forecasts | `total > 0` | "The model projects approximately **{total}** total cases, averaging **{monthlyAvg}** per month." |
| No forecasts | `total === 0` | "No forecast data available for the selected parameters." |

#### 3. Peak Period — 2 Branches

| Branch | Condition | Template |
|--------|-----------|----------|
| Has peak | `peakPeriod !== null` | "The highest caseload is expected in **{month}**, with **{count}** projected cases." |
| No peak | `peakPeriod === null` | "Unable to determine peak period from the available forecast data." |

#### 4. Growth Rate — 3 Branches

| Branch | Condition | Template |
|--------|-----------|----------|
| Rising | `growthRate > 0` | "Expected growth rate: **+{rate}%** compared with the historical average." |
| Falling | `growthRate < 0` | "Expected growth rate: **{rate}%** compared with the historical average (declining)." |
| Flat | `growthRate === 0` | "The forecast indicates **no significant change** compared with the historical average." |

#### 5. High-Risk Areas — 3 Branches

| Branch | Condition | Template |
|--------|-----------|----------|
| Few | `count > 0 && count <= 5` | "**{count}** barangay(s) remain in the high-risk category: {names}." |
| Many | `count > 5` | "**{count}** barangays remain in the high-risk category, including {top4}." |
| None | `count === 0` | "No barangays are projected to be in the high-risk category." |

#### 6. Forecast Confidence — 3 Branches

| Branch | Condition | Template |
|--------|-----------|----------|
| High certainty | `avgRelativeCIWidth < 0.3` | "The 95% confidence intervals are **narrow**, indicating **high forecast certainty**." |
| Moderate | `0.3 <= avgRelativeCIWidth <= 0.6` | "The 95% confidence intervals are **moderate**, suggesting **reasonable forecast certainty**." |
| Low certainty | `avgRelativeCIWidth > 0.6` | "The 95% confidence intervals are **wide**, indicating **significant forecast uncertainty**." |

#### 7. Overall Interpretation — Rule-Based Synthesis

```javascript
function generateOverallInterpretation(metrics) {
  const parts = [];

  if (metrics.direction.growthRate > 5) {
    parts.push('The forecast indicates that TB activity may remain elevated in the coming months.');
  } else if (metrics.direction.growthRate < -5) {
    parts.push('The forecast suggests a potential decline in TB activity.');
  } else {
    parts.push('The forecast suggests relatively stable TB activity in the near term.');
  }

  if (metrics.highRiskForecastBarangays.length > 0) {
    parts.push(`${metrics.highRiskForecastBarangays.length} barangay(s) are projected to remain in the high-risk category.`);
  } else {
    parts.push('No barangays are projected to be in the high-risk category.');
  }

  if (metrics.confidence.avgRelativeCIWidth > 0.6) {
    parts.push('However, the wide confidence intervals suggest that these projections should be interpreted with caution.');
  }

  return parts.join(' ');
}
```

### 4.3 Total Branch Count

| Section | Analytics Branches | Forecasting Branches |
|---------|-------------------|---------------------|
| Key Trend / Direction | 3 | 3 |
| Highest/Lowest | 3 | — |
| Predicted Cases | — | 2 |
| Peak Period | — | 2 |
| Significant Changes | 3 | — |
| Growth Rate | — | 3 |
| Risk Findings | 3 | 3 |
| Demographics | 4 | — |
| Treatment | 3 | — |
| Forecast Confidence | — | 3 |
| Overall Summary | Dynamic synthesis | Dynamic synthesis |
| **Total** | **19 branches** | **16 branches** |

---

## 5. TESTING STRATEGY

### 5.1 Backend Tests

| Test File | What's Tested |
|-----------|---------------|
| `test/tbinsight/insightDataBuilder.test.js` | Metric calculation: trend direction, z-score significance, CI width interpretation |
| `test/tbinsight/nlgEngine.test.js` | Text generation: all sections produce non-empty strings, correct branch selection, correct variable interpolation |

### 5.2 Manual Verification

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Load Analytics page with default data | Charts render, "Generate Insight" button visible |
| 2 | Click "Generate Insight" | Panel appears with 7 sections, "Based on" header shows current period |
| 3 | Apply filters (Year: 2026, Barangay: San Jose) then Generate | Panel updates to reflect filtered data |
| 4 | Load Forecasting page, Run Forecast | Forecast charts render |
| 5 | Click "Generate Insight" | Panel appears with 7 forecasting sections |
| 6 | Verify NLG failure handling | Disconnect backend -> Generate -> Error state with Retry button |
| 7 | Verify pipeline end-to-end | Pasig Clone send -> TBInsight receive -> Data appears in records |

---

## 6. IMPLEMENTATION CHECKLIST

### Deliverable 1: AI-Powered Automated Insights

- [ ] Create `BACKEND/tbinsight/insightDataBuilder.js`
  - [ ] `buildAnalyticsMetrics()` with trend, barangays, risk, demographics, treatment
  - [ ] `buildForecastingMetrics()` with direction, predictions, peak, confidence
  - [ ] Z-score significance calculation
  - [ ] Relative CI width interpretation
- [ ] Create `BACKEND/tbinsight/nlgEngine.js`
  - [ ] `generateAnalyticsInsight()` with 7 conditional sections
  - [ ] `generateForecastingInsight()` with 7 conditional sections
  - [ ] Rule-based Overall Summary synthesis
  - [ ] Meta object with `basedOn` context
- [ ] Add endpoints to `BACKEND/tbinsight/routes.js`
  - [ ] `GET /api/tb/insights/analytics`
  - [ ] `GET /api/tb/insights/forecasting`
- [ ] Create `FRONTEND/src/services/insightService.js`
  - [ ] `getAnalyticsInsight()`
  - [ ] `getForecastingInsight()`
  - [ ] `getWebhookLogs()`
- [ ] Create `FRONTEND/src/components/AiInsightPanel.jsx`
  - [ ] Section rendering with icons
  - [ ] "Based on" header
  - [ ] Loading state
  - [ ] Error state with retry
  - [ ] Disclaimer footer
- [ ] Modify `FRONTEND/src/pages/Analytics.jsx`
  - [ ] Add state for insight data/loading/error
  - [ ] Add "Generate Insight" button
  - [ ] Replace Key Insights section with `<AiInsightPanel>`
- [ ] Modify `FRONTEND/src/pages/Forecasting.jsx`
  - [ ] Add state for insight data/loading/error
  - [ ] Add "Generate Insight" button
  - [ ] Replace Forecast Summary section with `<AiInsightPanel>`

### Deliverable 2: Data Integration Pipeline

- [ ] Create `BACKEND/db/migrations/008_add_source_type_columns.sql`
- [ ] Add `GET /api/tb/webhook-logs` endpoint to `routes.js`
- [ ] Modify `FRONTEND/src/pages/DataIntegration.jsx`
  - [ ] Add Webhook Integration section
  - [ ] Connection status indicator
  - [ ] Webhook log history table
- [ ] Verify end-to-end pipeline
  - [ ] Pasig Clone deployed on Render
  - [ ] TBInsight receiving webhooks
  - [ ] Data visible in dashboard and records

---

## 7. TIMELINE

| Phase | Dates | Tasks |
|-------|-------|-------|
| **Phase 1** | TBD | Verify pipeline end-to-end (Pasig Clone + TBInsight on Render) |
| **Phase 2** | TBD | Backend: `insightDataBuilder.js` + `nlgEngine.js` |
| **Phase 3** | TBD | Backend: API endpoints + migration 008 + webhook-logs endpoint |
| **Phase 4** | TBD | Frontend: `AiInsightPanel.jsx` + `insightService.js` + Analytics integration |
| **Phase 5** | TBD | Frontend: Forecasting integration |
| **Phase 6** | TBD | Frontend: DataIntegration webhook UI |
| **Phase 7** | TBD | Testing + template refinement with real data |

---

## 8. DEFENSE TERMINOLOGY

| Don't Say | Say Instead |
|-----------|-------------|
| "AI analyzes the data" | "NLG component generates natural-language interpretations from calculated results" |
| "The system uses AI to understand TB data" | "Template-based NLG converts statistical findings into readable summaries" |
| "AI-powered insights" (in thesis paper) | "Automated Data Interpretation via Natural Language Generation" |
| "The model figures out patterns" | "ARIMA computes forecasts; NLG translates them into text" |

### How to Explain the Architecture

> "TBInsight uses a two-layer approach to data interpretation. The first layer consists of analytical models — ARIMA for time-series forecasting and Random Forest for risk classification — that compute statistical results from the TB case data. The second layer is a template-based Natural Language Generation engine that converts these computed results into plain-language interpretations. This separation ensures that the analytical models perform the actual computation, while the NLG component serves as a presentation layer that makes the findings accessible to non-technical health workers. Unlike large language models, this approach guarantees that every generated statement corresponds to an actual computed value — it cannot hallucinate or fabricate conclusions."
