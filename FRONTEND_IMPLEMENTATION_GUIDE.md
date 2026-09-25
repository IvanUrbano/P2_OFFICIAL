# PASIG TB-IS Frontend Implementation Guide

## Overview

Update the Pasig Clone frontend to display **organization-wide data** instead of per-user data, with proper audit trail display and improved UX for the multi-user workflow.

---

## 1. Dashboard Page Enhancements

### File: `PASIG_CLONE/frontend/src/pages/DashboardPage.jsx`

### Current Issues
- Displays stats that might be per-user
- No "Recent Imports" section
- No "Latest Sync" information
- No "Pending Actions" widget

### Required Changes

#### 1.1 Fetch Enhanced Stats Endpoint
The backend now returns:
```javascript
{
  total,           // Total TB records
  validated,       // Valid records
  invalid,         // Invalid records
  pending,         // Batches pending validation
  synced,          // Synced batches count
  recentImports,   // Array of recent 5 batches
  latestSync,      // Most recent successful sync info
  pendingActions: {
    requiresValidation,  // Batches needing validation
    readyForSync,        // Batches ready for sync
    failedSync           // Failed syncs
  }
}
```

#### 1.2 Add "Recent Imports" Card
Display the 5 most recent import batches with columns:
- Batch ID (truncated UUID)
- File Name
- Imported By (username)
- Records (count)
- Status (badge)
- Date (created_at)

#### 1.3 Add "Latest Synchronization" Card
Display the most recent successful sync:
- Batch ID
- File Name
- Records Transferred
- Synced By (username)
- Date (synced_at)

#### 1.4 Add "Pending Actions" Widget
Show counts with action links:
- "X records require validation" → Link to Validation page
- "X batches ready for sync" → Link to Sync page
- "X synchronizations failed" → Link to Sync History (filtered for failed)

### Design
Use existing card design with:
- Consistent spacing and borders
- Status badges (same as TBInsight)
- Icon indicators
- Hover effects for links

---

## 2. Import History Page (New)

### File: `PASIG_CLONE/frontend/src/pages/ImportHistoryPage.jsx`

### Purpose
Central location to view all import batches for the organization

### Layout
1. **Header Card**: Title, description, export/filter options
2. **Filter Bar** (optional):
   - Filter by status: All / Uploaded / Validated / Synced / Failed
   - Filter by date range: Last 7 days / 30 days / All time
3. **Table**: Import history with columns:
   | Batch ID | File Name | Imported By | Records | Validated | Rejected | Sync Status | Imported At | Actions |

4. **Status Badges**:
   - `Uploaded` → Gray
   - `Validated` → Blue
   - `Syncing` → Orange (spinning)
   - `Synced` → Green
   - `Sync Failed` → Red

5. **Actions Column** (dropdown menu):
   - View Details
   - View Records
   - View Validation Results
   - Retry Sync (if failed)
   - Download Records (CSV export)

### Empty State
```
No imports yet

No datasets have been imported into PASIG TB-IS.
Start by importing your first TB records file.
[Import New File Button]
```

### Loading State
Table rows with skeleton loaders for data

### Error State
```
Failed to load import history

Please try again or contact support.
[Retry Button]
```

---

## 3. Data Import Page Enhancements

### File: `PASIG_CLONE/frontend/src/pages/DataImportPage.jsx`

### Current State
Has upload form, needs duplicate detection UI

### Required Changes

#### 3.1 Add Duplicate File Detection
After file selection, calculate and check file hash:

**Before Upload**:
```javascript
// When file selected:
1. Read file
2. Calculate SHA256 hash (using crypto-js library)
3. Send POST /api/data/import-check with { fileHash }
4. If exists: Show alert card below

// Backend returns:
{
  isDuplicate: true,
  previousImport: {
    batchId,
    filename,
    importedBy,
    importedAt,
    status,
    syncStatus
  }
}
```

**Alert Card Design**:
```
⚠️ File Already Imported

This file has already been processed and imported into PASIG TB-IS.

Previous Import:
- Batch ID: IMP-2026-09-001
- File: TB_September_2026.xlsx
- Imported By: Maria Santos
- Imported At: September 15, 2026 - 9:35 AM
- Status: Validated
- Sync Status: Synced

[View Batch Details] [Import Anyway (Confirm)]
```

#### 3.2 Show File Hash Verification
After successful upload:
```
✅ File uploaded successfully

File Hash: a7c3d5f8e2b9... (first 16 chars)
Batch ID: IMP-2026-09-002

This hash can be used to verify file integrity.
```

---

## 4. Validation Page Enhancements

### File: `PASIG_CLONE/frontend/src/pages/ValidationPage.jsx`

### Current State
Shows validation results, needs record classification display

### Required Changes

#### 4.1 Record Classification Summary
Add section showing:
```
Validation Results
- Total Records: 450
- Valid: 438 (97.3%)
- Invalid: 12 (2.7%)

New Records: 400
Updated Records: 38
Duplicate Records: 12
```

#### 4.2 Display "Validated By" and "Validated At"
Add badges showing:
```
✅ Validated by: Maria Santos
   on September 15, 2026 - 9:35 AM
```

#### 4.3 Record Status Badges
In the validation results table, add column:
- **Status**: new | updated | duplicate | invalid
- Color code each status

---

## 5. Sync History Page (Existing - Enhance)

### File: `PASIG_CLONE/frontend/src/pages/SyncHistoryPage.jsx`

### Required Enhancements

#### 5.1 Add "Synced By" Column
Display username of who initiated the sync

#### 5.2 Add Sync Error Display
If status is "Sync Failed":
```
❌ Sync Failed

Error: [error message from sync_error field]
[Retry Sync] [View Details]
```

#### 5.3 Add Sync Status Tracking
Show intermediate state:
- `Pending` → Not yet synced
- `Syncing` → Currently syncing (show spinner)
- `Synced` → Successfully synced
- `Sync Failed` → Failed (show error)

#### 5.4 Retry Failed Sync
Add "Retry Sync" button for failed syncs:
```javascript
onClick={() => {
  POST /api/webhook/send
  { batchId }
  // Shows loading state, then updates with result
}}
```

---

## 6. TB Records Page (No Major Changes)

The organizational data is already being displayed. Ensure it shows:
- Records from all batches (not filtered by user)
- "Imported By" field for each record (if available)

---

## 7. Audit Trail Component (New)

### File: `PASIG_CLONE/frontend/src/components/AuditTrail.jsx`

### Purpose
Display timeline of all actions on a batch (import, validation, sync)

### Props
```javascript
{
  resourceType: 'import_batch',
  resourceId: batchId,
  compact: false  // true for inline, false for full page
}
```

### Display
Vertical timeline showing:
```
✅ Imported
   by Maria Santos
   September 15, 2026 - 9:35 AM
   450 records

→ [Arrow down]

✅ Validated
   by John Doe
   September 15, 2026 - 10:12 AM
   438 valid, 12 invalid

→ [Arrow down]

✅ Synced
   by Admin User
   September 15, 2026 - 10:45 AM
   438 records synced to TBInsight
```

### For Failed Actions
```
❌ Sync Failed
   by Maria Santos
   September 15, 2026 - 10:45 AM
   Error: Connection timeout
   [Retry]
```

---

## 8. Duplicate File Detection Alert

### File: `PASIG_CLONE/frontend/src/components/DuplicateFileAlert.jsx`

### Purpose
Reusable alert component for showing duplicate file detection

### Props
```javascript
{
  batchId,
  filename,
  importedBy,
  importedAt,
  status,
  syncStatus,
  onProceed,     // Callback if user chooses to import anyway
  onViewDetails  // Callback to view original batch
}
```

### Usage
In DataImportPage after file upload check returns isDuplicate

---

## 9. Status Badge Component

### File: `PASIG_CLONE/frontend/src/components/StatusBadge.jsx` (Update existing)

### Add Support For
- `uploaded` → Gray
- `validated` → Blue
- `syncing` → Orange (with spinner)
- `synced` → Green
- `sync_failed` → Red
- `new` → Gray
- `updated` → Blue
- `duplicate` → Yellow
- `invalid` → Red

---

## 10. Frontend API Updates

Create or update API client methods:

### File: `PASIG_CLONE/frontend/src/api/axios.js` or new `dataImportApi.js`

```javascript
// Import History
GET /api/data/import-history
Returns: { batches: [] }

// Import Duplicate Check
POST /api/data/import-check
Body: { fileHash }
Returns: { isDuplicate: bool, previousImport?: {} }

// Enhanced Stats
GET /api/data/stats
Returns: { 
  total, validated, invalid, pending, synced,
  recentImports: [],
  latestSync: {},
  pendingActions: {}
}

// Audit Trail
GET /api/data/audit-trail/:resourceType/:resourceId
Returns: { logs: [] }
```

---

## 11. Theme/Colors

### Use Existing Theme
From `PASIG_CLONE/frontend/src/theme.jsx`:
- Primary Navy: `#0F2D52`
- Secondary Blue: `#2E6FAF`
- Border: `#E2E8F0`
- Success: `#10B981`
- Warning: `#F97316`
- Error: `#EF4444`

### Status Colors
- New: `#3B82F6` (Blue)
- Updated: `#8B5CF6` (Purple)
- Duplicate: `#FBBF24` (Yellow)
- Invalid: `#EF4444` (Red)

---

## 12. Implementation Checklist

### Dashboard Page
- [ ] Update stats endpoint call
- [ ] Add Recent Imports card
- [ ] Add Latest Synchronization card
- [ ] Add Pending Actions widget
- [ ] Style with existing design system
- [ ] Handle loading states
- [ ] Handle empty states

### Import History Page
- [ ] Create new page component
- [ ] Build table with all columns
- [ ] Add status badges
- [ ] Add action dropdown menu
- [ ] Implement filters (status, date range)
- [ ] Handle loading/empty/error states
- [ ] Add pagination (if needed)

### Data Import Page
- [ ] Add file hash calculation
- [ ] Add duplicate check before upload
- [ ] Show duplicate alert card
- [ ] Display file hash after success
- [ ] Update error messages
- [ ] Test upload flow

### Validation Page
- [ ] Add record classification summary
- [ ] Display "Validated By" and "Validated At"
- [ ] Add status badges to records table
- [ ] Update validation results display

### Sync History Page
- [ ] Add "Synced By" column
- [ ] Add sync error display
- [ ] Implement retry sync button
- [ ] Add sync status indicators

### New Components
- [ ] Create AuditTrail.jsx
- [ ] Create DuplicateFileAlert.jsx
- [ ] Update StatusBadge.jsx

### Navigation
- [ ] Add Import History to sidebar/navigation menu
- [ ] Ensure all pages accessible from dashboard

---

## 13. Development Notes

### Frontend Libraries Needed
- `crypto-js` for SHA256 hashing (install if not present)
- Existing React Router for navigation
- Existing Tailwind CSS for styling

### Key Principles
1. **Organization-Wide View**: All stats are organizational, not per-user
2. **Audit Trail**: Show who performed each action
3. **User Feedback**: Clear success/failure messages with actions
4. **Consistent Design**: Match existing TBInsight/Pasig Clone design
5. **Safe Error Messages**: Don't expose technical details

### Testing Priority
1. Duplicate file detection works
2. Dashboard shows correct organizational stats
3. Import history displays all batches
4. Sync retry works
5. Audit trail is accurate
