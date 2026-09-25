# PASIG TB-IS Multi-User Implementation - Quick Reference

## What Changed?

### Database (3 changes)
1. **import_batches**: Added `file_hash`, `validated_by`, `validated_at`, `synced_by`, `synced_at`, `sync_status`, `sync_error`
2. **validated_tb_cases**: Added `source_record_id`, `record_status`, `updated_by`, `updated_at`
3. **New table**: `audit_logs` - Tracks all actions

### Backend (NEW FILES)
- `utils/fileHash.js` - Calculate SHA256 hashes
- `services/recordDuplicateDetector.js` - Classify records

### Backend (UPDATED FILES)
- `routes/csvImport.js` - File hash check + duplicate detection + new `/import-history` endpoint
- `routes/validation.js` - Track who validated, when
- `routes/webhook.js` - Pass userId for audit trail
- `services/webhookSender.js` - Detailed sync tracking + error logging
- `init.sql` - Schema with all new fields

---

## Key Behavior Changes

### Import
```
OLD: User uploads → Batch created
NEW: User uploads 
     → Calculate SHA256 hash
     → Check if file_hash exists
     → IF YES: Return 409 with previous batch info
     → IF NO: Create batch with file_hash
     → Log audit event
```

### Validation
```
OLD: Validate records
NEW: Validate records
     → Track validated_by (from JWT)
     → Record validated_at (timestamp)
     → Update import_batches status
     → Log audit event
```

### Sync
```
OLD: Send webhook → Mark as 'sent'
NEW: Send webhook
     → Track synced_by (from JWT)
     → Set sync_status = 'syncing'
     → If success: sync_status = 'synced', synced_at = NOW()
     → If failure: sync_status = 'sync_failed', sync_error = message
     → Log audit event
     → Return records sent/accepted counts
```

---

## API Endpoints (NEW & CHANGED)

### New Endpoints

```
GET /api/data/import-history
Returns: { batches: [{ id, filename, imported_by_username, total_rows, valid_count, error_count, status, sync_status, created_at, validated_at, synced_at }] }
Requires: Authentication

GET /api/data/stats (ENHANCED)
Returns: {
  total,                    // org-wide total
  validated,               // org-wide validated
  invalid,                 // org-wide invalid
  pending,                 // org-wide pending
  synced,                  // org-wide synced
  recentImports: [...],    // last 5 batches
  latestSync: {...},       // most recent sync
  pendingActions: {
    requiresValidation: #,
    readyForSync: #,
    failedSync: #
  }
}
```

### Changed Endpoints

```
POST /api/data/import
Response now includes: { isDuplicate, previousImport: { batchId, importedBy, importedAt, status } }
HTTP 409 if duplicate

POST /api/webhook/send
Now requires userId in body processing
Response includes: { recordsSent, recordsAccepted }
```

---

## Environment Variables (NO CHANGES)

All required env vars already in place. No new vars needed.

---

## Testing Commands

### Test Duplicate File Detection
```bash
# First upload succeeds
curl -X POST http://localhost:3000/api/data/import \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@test.xlsx"

# Store the fileHash from response
# Second upload with same file returns 409
curl -X POST http://localhost:3000/api/data/import \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@test.xlsx"
# Response: { error: "File already imported", isDuplicate: true, previousImport: {...} }
```

### Test Enhanced Stats
```bash
curl http://localhost:3000/api/data/stats \
  -H "Authorization: Bearer $TOKEN"

# Should return new fields:
# recentImports, latestSync, pendingActions
```

### Test Sync Tracking
```bash
curl -X POST http://localhost:3000/api/webhook/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "batchId": "xxx-xxx-xxx" }'

# Response should include:
# { recordsSent, recordsAccepted }
```

### Check Audit Logs
```sql
SELECT * FROM audit_logs 
ORDER BY created_at DESC 
LIMIT 20;
```

---

## Common Issues & Fixes

### Issue: File hash not calculating
**Fix**: Ensure `utils/fileHash.js` is in correct path and crypto module is available

### Issue: Duplicate detection not working
**Fix**: Run migration to add `file_hash` column with UNIQUE constraint

### Issue: Sync not tracking user
**Fix**: Ensure JWT middleware is working and userId is passed to sendWebhook

### Issue: Audit logs not recording
**Fix**: Ensure `audit_logs` table exists (run migration)

---

## Code Examples

### Calculate File Hash (Frontend)
```javascript
import { calculateFileHash } from '../utils/fileHash.js';

const file = document.getElementById('fileInput').files[0];
const buffer = await file.arrayBuffer();
const hash = calculateFileHash(new Uint8Array(buffer));
console.log('File hash:', hash);
```

### Classify a Record (Backend)
```javascript
import { classifyRecord } from '../services/recordDuplicateDetector.js';

const classification = await classifyRecord(recordData, 'DSTB');
// Returns: { status: 'new' | 'updated' | 'duplicate', existingId, sourceRecordId }
```

### Log Audit Event (Backend)
```javascript
import { logAuditEvent } from '../utils/auditLogger.js';

await logAuditEvent({
  userId: req.user.id,
  action: 'IMPORT_FILE',
  resourceType: 'import_batch',
  resourceId: batchId,
  result: 'SUCCESS',
  details: { filename, recordCount }
});
```

---

## Frontend TODO (Not Yet Implemented)

Priority 1 (Critical):
- [ ] Update Dashboard with org-wide stats
- [ ] Add Recent Imports card
- [ ] Add Pending Actions widget
- [ ] Create Import History page

Priority 2 (High):
- [ ] Add duplicate file detection UI
- [ ] Show file hash after upload
- [ ] Show "Validated By" on validation results
- [ ] Show "Synced By" on sync history

Priority 3 (Medium):
- [ ] Create Audit Trail component
- [ ] Add sync error display
- [ ] Add retry sync button
- [ ] Record classification display

---

## Database Schema Reference

### import_batches (Key Columns)
```sql
id UUID PRIMARY KEY                    -- Batch ID
filename TEXT                          -- Original filename
uploaded_by INTEGER                    -- User ID who imported
file_hash TEXT UNIQUE                  -- SHA256 hash for duplicate detection
status TEXT                            -- imported, validated, sent, failed
sync_status TEXT                       -- pending, syncing, synced, sync_failed
sync_error TEXT                        -- Error message if sync_failed
validated_by INTEGER                   -- User ID who validated
validated_at TIMESTAMP                 -- When validation completed
synced_by INTEGER                      -- User ID who initiated sync
synced_at TIMESTAMP                    -- When sync completed
```

### validated_tb_cases (Key New Columns)
```sql
source_record_id TEXT                  -- Stable identifier for duplicates
record_status TEXT                     -- new, existing, updated, duplicate
updated_by INTEGER                     -- User ID who updated
updated_at TIMESTAMP                   -- When last updated
```

### audit_logs (New Table)
```sql
id SERIAL PRIMARY KEY
user_id INTEGER NOT NULL               -- Who performed action
action TEXT NOT NULL                   -- Action type
resource_type TEXT                     -- Resource being acted on
resource_id TEXT                       -- Resource ID
result TEXT                            -- SUCCESS, FAILURE
details JSONB                          -- Additional context
created_at TIMESTAMP DEFAULT NOW()
```

---

## Architecture Diagram

```
User Upload
    ↓
[File Hash Check]
    ↓
    ├─ Duplicate Found → Return 409
    └─ New File → Continue
    ↓
[Create Batch + Store file_hash + Log Audit]
    ↓
User Validates
    ↓
[Record Classification + Track Validator + Log Audit]
    ↓
User Syncs
    ↓
[Send Webhook + Track Syncer + Log Status/Error + Log Audit]
    ↓
TBInsight Receives
    ↓
[Process Records (Idempotent - no duplicates)]
```

---

## Quick Checklist for Code Review

- [ ] File hash is calculated for every import
- [ ] Duplicate file detection returns 409
- [ ] User ID is extracted from JWT (not from request body)
- [ ] All operations create audit logs
- [ ] Sync status properly tracks: pending → syncing → synced/sync_failed
- [ ] Error messages are safe (no SQL, no stack traces)
- [ ] Database migrations include `IF NOT EXISTS`
- [ ] Backward compatibility maintained
- [ ] Organization data (not per-user)
- [ ] All endpoints require authentication

---

## Performance Tips

1. File hash calculation: O(n) where n = file size
   - For 500MB file: ~1 second on modern CPU
   - Consider caching for verification only

2. Duplicate detection queries use indexes:
   - `idx_import_batches_file_hash` - O(log n)
   - `idx_validated_cases_source_record` - O(log n)

3. Audit log queries may slow down with large datasets:
   - Implement retention policy (delete after 1 year)
   - Archive old logs to separate table

4. Dashboard stats queries:
   - Use COUNT() with WHERE clauses
   - Rely on indexes for sync_status, status fields
   - Consider caching if called frequently
