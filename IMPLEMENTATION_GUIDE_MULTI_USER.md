# PASIG TB-IS Multi-User Data Import Workflow - Implementation Guide

## Overview

Transform PASIG TB-IS from a per-user import system to a **centralized multi-user organization system** where:
- **Data belongs to the organization**, not individual users
- **All authorized users see the same dataset** based on their role
- **Every action is audited** with user tracking
- **Duplicate detection** prevents accidental re-imports
- **Idempotent synchronization** ensures no duplicate records in TBInsight

---

## Phase 1: Database Schema Enhancement

### Step 1.1: Create Migration Script

**File**: `PASIG_CLONE/backend/db/migrations/001_add_audit_and_hash_fields.sql`

**Changes**:
1. Add `file_hash` to `import_batches` (SHA256 of uploaded file)
2. Add audit trail fields to `import_batches`:
   - `validated_by` (user ID who validated)
   - `validated_at` (timestamp)
   - `synced_by` (user ID who initiated sync)
   - `synced_at` (timestamp)
   - `sync_status` (enum: pending, syncing, synced, sync_failed)
   - `sync_error` (text: error message if sync failed)
3. Add record classification fields to `validated_tb_cases`:
   - `source_record_id` (stable identifier from source system)
   - `record_status` (enum: new, existing, updated, duplicate)
   - `updated_by` (user ID who last modified)
   - `updated_at` (timestamp)
4. Add unique constraint on `file_hash` to prevent duplicate uploads

**Key Point**: Use `IF NOT EXISTS` to ensure idempotent migrations

### Step 1.2: Update init.sql

Incorporate new fields into initial schema for fresh deployments.

---

## Phase 2: Backend Implementation

### Step 2.1: File Hash Generation & Duplicate Detection

**File**: Update `PASIG_CLONE/backend/routes/csvImport.js`

```javascript
// Add to imports:
const crypto = require('crypto');

// In POST /api/data/import handler:
1. Calculate file_hash = SHA256(file.data)
2. Check if file_hash exists in import_batches
3. If exists:
   - Return 409 Conflict
   - Include previous batch metadata (ID, date, status)
4. If not exists:
   - Proceed with import
   - Store file_hash in database
```

**Extract user ID from JWT** (already available in `req.user.id`)

### Step 2.2: Record-Level Duplicate Detection

**File**: Create `PASIG_CLONE/backend/services/recordDuplicateDetector.js`

**Logic**:
```javascript
async function detectRecordStatus(sourceType, recordData) {
  // Use source_type + stable identifier to find existing records
  const sourceId = recordData.itis_case_id || recordData.patient_id; // adapt to schema
  
  const existing = await pool.query(
    `SELECT id, source_record_id, data FROM validated_tb_cases 
     WHERE source_type = $1 AND source_record_id = $2`,
    [sourceType, sourceId]
  );
  
  if (existing.rows.length === 0) return 'new';
  
  const current = existing.rows[0];
  const dataMatch = JSON.stringify(current.data) === JSON.stringify(recordData);
  
  if (dataMatch) return 'duplicate';
  return 'updated';
}
```

### Step 2.3: Update Validation Endpoint

**File**: Update `PASIG_CLONE/backend/routes/validation.js`

**Changes**:
```javascript
POST /api/data/validate/:batchId

1. Extract user from req.user
2. Call validateBatch(batchId)
3. For each record:
   - Run recordDuplicateDetector
   - Classify as: new, existing, updated, duplicate, invalid
4. Store classification in validated_tb_cases
5. Record validated_by and validated_at in import_batches
6. Return summary:
   {
     total: X,
     new: X,
     updated: X,
     duplicate: X,
     invalid: X,
     validatedBy: user.username,
     validatedAt: timestamp
   }
```

### Step 2.4: Synchronization Tracking

**File**: Update `PASIG_CLONE/backend/services/webhookSender.js`

**Changes**:
```javascript
async function sendWebhook(batchId, userId) {
  1. Update batch: sync_status = 'syncing', synced_by = userId, synced_at = NOW()
  2. Send webhook with payload
  3. On success:
     - Update batch: sync_status = 'synced'
     - Log: "Synced X records"
  4. On failure:
     - Update batch: sync_status = 'sync_failed', sync_error = error message
     - Log error details
  5. Return sync result with counts
}
```

### Step 2.5: User Context in All Operations

**Ensure every route**:
1. Extracts `req.user` from authenticated middleware
2. Stores user ID in database operations
3. Logs action to audit table

**Audit Table** (create in migration):
```sql
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  action TEXT,
  resource_type TEXT,
  resource_id TEXT,
  timestamp TIMESTAMP DEFAULT NOW(),
  result TEXT,
  details JSONB
);
```

### Step 2.6: New Route: Import History

**File**: Update `PASIG_CLONE/backend/routes/csvImport.js`

```javascript
GET /api/data/import-history
- Return all batches for organization
- Include: id, filename, imported_by (with username join), 
           total_rows, valid_count, error_count,
           status, created_at, validated_at, synced_at
- Order by created_at DESC
- Include sync_status
```

### Step 2.7: Enhanced Dashboard Stats

**File**: Update `PASIG_CLONE/backend/routes/csvImport.js`

```javascript
GET /api/data/stats
- Return organization-wide stats (not per-user)
- totalRecords: count from validated_tb_cases
- validated: count where is_valid = true
- pending: count needing validation
- synced: count from batches where sync_status = 'synced'
- recentImports: last 5 batches with user info
- latestSync: most recent successful sync with details
- pendingActions: validation needed count, ready for sync count, failed sync count
```

---

## Phase 3: Frontend Implementation

### Step 3.1: Import History Page

**File**: Create `PASIG_CLONE/frontend/src/pages/ImportHistoryPage.jsx`

**Features**:
- Table with columns: Batch ID, File Name, Imported By, Records, Validated, Rejected, Sync Status, Imported At, Actions
- Status badges: Uploaded, Validated, Syncing, Synced, Failed
- Actions: View Details, View Records, Retry Sync
- Empty state: "No imports yet. Start by uploading a file."
- Loading skeleton

### Step 3.2: Duplicate File Alert

**File**: Update `PASIG_CLONE/frontend/src/pages/DataImportPage.jsx`

**When file uploaded**:
1. Show loading state while checking hash
2. If duplicate detected:
   - Display alert card: "File Already Imported"
   - Show: Previous Batch ID, Imported By, Date, Status
   - Option to proceed anyway (with confirmation)
3. If new:
   - Show upload success
   - Show file hash checksum (for verification)

### Step 3.3: Enhanced Dashboard

**File**: Update `PASIG_CLONE/frontend/src/pages/DashboardPage.jsx`

**Changes**:
1. **Organization-wide KPIs** (not per-user):
   - Total TB Records
   - Validated Records
   - Pending Validation
   - Synced to TBInsight
2. **Recent Imports Section**:
   - Show last 5 batches
   - Columns: Batch ID, File, Imported By, Records, Status, Date
   - Status badges with colors
3. **Latest Synchronization**:
   - Last successful sync details
   - Batch ID, Records Transferred, Status, Initiated By, Date
4. **Pending Actions Widget**:
   - X records require validation (link to validation page)
   - X batches ready for synchronization (link to sync page)
   - X synchronization failed (link to sync history with filter)

### Step 3.4: User Info Display

**Throughout UI**:
- Show "Imported By: Maria Santos" on batch items
- Show "Validated By: John Doe" on validation results
- Show "Synced By: Admin User" on sync history

### Step 3.5: Audit Trail Component

**File**: Create `PASIG_CLONE/frontend/src/components/AuditTrail.jsx`

**Displays**:
- Timeline of actions on a batch
- For each action: User, Action, Timestamp, Status
- Chronological order

---

## Phase 4: Testing & Validation

### Test Scenario 1: Multi-User Import
1. Admin 1 logs in
2. Imports Batch A (450 records)
3. Logs out
4. Admin 2 logs in
5. Verify: Can see Batch A and its records
6. Verify: Dashboard shows organizational stats (not Admin 1's only)

### Test Scenario 2: Duplicate File Detection
1. Admin 1 imports file "TB_Sept_2026.xlsx"
2. Admin 1 receives success with batch ID
3. Admin 1 tries to import same file again
4. System detects duplicate
5. Shows alert: "File Already Imported - Batch: IMP-001, Imported By: Admin 1"

### Test Scenario 3: Record Duplicates
1. Batch A: Import 100 records
2. Batch B: Import same 100 records (renamed file)
3. Validation runs on Batch B
4. Records classified as:
   - 100 "duplicate"
   - 0 "new"
5. Verify: Only Batch A sends to TBInsight, Batch B marked as duplicate

### Test Scenario 4: Record Updates
1. Batch A: Import record for patient XYZ (age 30)
2. Sync to TBInsight
3. Batch B: Same patient XYZ (age 31 - updated)
4. Validation classifies as "updated"
5. Sync updates TBInsight record (not duplicate)
6. Audit trail shows: "Updated By: Admin 2"

### Test Scenario 5: Concurrent Operations
1. Admin 1 uploading file (processing)
2. Admin 2 tries to upload same file
3. Backend ensures:
   - No race condition
   - One succeeds, one gets "already processing" or duplicate error
   - File hash constraint prevents duplicate

### Test Scenario 6: Failed Sync & Retry
1. Admin 1 syncs batch to TBInsight
2. Network fails midway
3. Batch marked as "sync_failed" with error message
4. Admin 2 clicks "Retry Sync"
5. System retries idempotently (no duplicate records in TBInsight)

---

## Implementation Checklist

### Database
- [ ] Create migration script (001_add_audit_and_hash_fields.sql)
- [ ] Add file_hash field and unique constraint
- [ ] Add audit trail fields to import_batches
- [ ] Add record classification fields to validated_tb_cases
- [ ] Create audit_logs table
- [ ] Update init.sql for fresh deploys

### Backend
- [ ] Implement file hash generation (SHA256)
- [ ] Implement duplicate file detection
- [ ] Create recordDuplicateDetector.js
- [ ] Update validation endpoint with classification
- [ ] Add user tracking to all operations
- [ ] Enhance sync tracking with status and error messages
- [ ] Create import history endpoint
- [ ] Enhance stats endpoint
- [ ] Add audit logging service
- [ ] Add error handling and safe messages

### Frontend
- [ ] Create ImportHistoryPage.jsx
- [ ] Add duplicate file alert to DataImportPage
- [ ] Enhance Dashboard with org-wide KPIs
- [ ] Add "Imported By" display on batch items
- [ ] Add pending actions widget
- [ ] Create AuditTrail component
- [ ] Update navigation to include Import History

### Testing
- [ ] Multi-user scenario testing
- [ ] Duplicate detection testing
- [ ] Record classification testing
- [ ] Sync idempotency testing
- [ ] Concurrent operation testing
- [ ] Error recovery testing

---

## Key Design Principles

1. **Organization Owns Data**: All authorized users see same dataset
2. **User Tracking**: Every action records who performed it
3. **Duplicate Prevention**: File-level and record-level detection
4. **Idempotent Sync**: Retries don't create duplicate records
5. **Audit Trail**: Complete history of all important actions
6. **Safe Error Messages**: Never expose SQL/stack traces to users
7. **Transaction Safety**: Use database transactions for consistency
8. **Scalability**: Support 500 MB files and 100+ user concurrent operations

---

## Database Schema Changes Summary

### import_batches (new columns)
```sql
file_hash TEXT UNIQUE NOT NULL,
validated_by INTEGER,
validated_at TIMESTAMP,
synced_by INTEGER,
synced_at TIMESTAMP,
sync_status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'syncing', 'synced', 'sync_failed')),
sync_error TEXT
```

### validated_tb_cases (new columns)
```sql
source_record_id TEXT,
record_status TEXT DEFAULT 'new' CHECK (status IN ('new', 'existing', 'updated', 'duplicate')),
updated_by INTEGER,
updated_at TIMESTAMP
```

### audit_logs (new table)
```sql
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  timestamp TIMESTAMP DEFAULT NOW(),
  result TEXT,
  details JSONB
);
```
