# Webhook Signature Verification Fix - Testing Guide

## Problem Fixed
The webhook data transfer from Pasig Clone to TBInsight was failing with "failed" status in sync history because of a **JSON signature verification mismatch**.

### Root Cause
- When Express parses JSON, then re-stringifies it, the key order and formatting may differ
- This caused the HMAC-SHA256 signature to not match
- Result: 401 Unauthorized error → webhook marked as "failed"

## Changes Made

### 1. `/BACKEND/server.js`
Added a **raw body capture middleware** for webhook routes:
```javascript
// Captures raw bytes BEFORE JSON parsing
const rawBodyCapture = express.raw({ type: 'application/json', limit: '10mb' });
app.use('/api/webhook', webhookLimiter, rawBodyCapture, (req, res, next) => {
  req.rawBody = req.body;
  express.json({ limit: '10mb' })(req, res, next);
});
```

### 2. `/BACKEND/middleware/webhookAuth.js`
Updated signature verification to use raw body:
```javascript
// Now uses req.rawBody instead of JSON.stringify(req.body)
const expectedSignature = crypto
  .createHmac('sha256', serverSecret)
  .update(bodyToVerify)  // Uses raw bytes, not re-stringified JSON
  .digest('hex');
```

## How to Test

### Option 1: Direct Manual Test
1. Ensure both systems are running:
   ```bash
   # Terminal 1: TBInsight Backend
   cd BACKEND
   npm start
   
   # Terminal 2: Pasig Clone Backend
   cd PASIG_CLONE/backend
   npm start
   ```

2. Verify environment variables are set in `.env`:
   - Both systems must have matching `WEBHOOK_SECRET`
   - Pasig Clone must have `TBINSIGHT_WEBHOOK_URL` pointing to TBInsight webhook

3. In Pasig Clone Frontend/Admin:
   - Upload a CSV file (parse and validate it)
   - Click "Send to TBInsight" button
   - Check sync history → should now show "success" instead of "failed"

### Option 2: Check Webhook Logs
1. Access TBInsight integration status endpoint:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:5000/api/tb/integration/status
   ```

2. Should now show:
   ```json
   {
     "connected": true,
     "status": "connected",
     "message": "PASIG TB-IS is actively sending data.",
     "lastSync": { ... }
   }
   ```

3. Check sync history:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:5000/api/tb/integration/sync-history
   ```

### Option 3: Monitor Backend Logs
Both systems will log verification attempts:

**TBInsight** (should now show):
```
✅ Webhook signature verified successfully
✅ Batch XXX: N imported, 0 errors
```

**Pasig Clone** (should show):
```
Webhook sent successfully
```

## Next Steps to Verify

1. **Check if data now flows through**:
   - Query TBInsight: `SELECT COUNT(*) FROM tb_cases;`
   - Should increase after sending batches from Pasig Clone

2. **Verify aggregations rebuild**:
   - Query: `SELECT COUNT(*) FROM monthly_case_summary;`
   - Should have data grouped by barangay and month

3. **Run the pipeline**:
   ```bash
   curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:5000/api/tb/pipeline
   ```
   - Should now process data and generate forecasts/risk scores

## Troubleshooting

If webhook still shows "failed":

1. **Check WEBHOOK_SECRET matching**:
   ```bash
   # On Pasig Clone
   echo $WEBHOOK_SECRET
   
   # On TBInsight
   echo $WEBHOOK_SECRET
   # They MUST be identical
   ```

2. **Check TBINSIGHT_WEBHOOK_URL**:
   ```bash
   echo $TBINSIGHT_WEBHOOK_URL
   # Should be: http://localhost:5000/api/webhook/pasig-clone
   # or production URL if deployed
   ```

3. **Monitor detailed logs**:
   - Look for "Invalid signature" messages
   - Check that X-Webhook-Signature header is being sent
   - Verify raw body is being captured (should see logs about verification)

4. **Test signature locally** (Node.js):
   ```javascript
   const crypto = require('crypto');
   const payload = { test: 'data' };
   const body = JSON.stringify(payload);
   const secret = process.env.WEBHOOK_SECRET;
   
   const sig1 = crypto.createHmac('sha256', secret).update(body).digest('hex');
   console.log('Signature:', `sha256=${sig1}`);
   
   // This should match what Pasig Clone sends
   ```

## Environment Variables Required

Both systems need these set correctly:

**TBInsight** (.env):
```
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret
WEBHOOK_SECRET=your-shared-secret-key
```

**Pasig Clone** (.env):
```
DATABASE_URL=postgresql://...
AUTH_DATABASE_URL=postgresql://...
JWT_SECRET=your-secret
WEBHOOK_SECRET=your-shared-secret-key  # MUST MATCH TBInsight
TBINSIGHT_WEBHOOK_URL=http://localhost:5000/api/webhook/pasig-clone
```

## Success Indicators

✅ Webhook logs show "processed" status  
✅ TBInsight database has new records in `tb_cases` table  
✅ `monthly_case_summary` table is populated  
✅ Pipeline successfully generates forecasts  
✅ Risk scores appear in the dashboard  

