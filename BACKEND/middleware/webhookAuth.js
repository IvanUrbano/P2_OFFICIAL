const crypto = require('crypto');

/**
 * Middleware to verify webhook HMAC-SHA256 signature.
 * The sender signs the payload with WEBHOOK_SECRET and sends the signature
 * in the X-Webhook-Signature header. The server verifies using its own
 * WEBHOOK_SECRET env var — the secret is NOT sent in the request.
 *
 * IMPORTANT: This middleware MUST be used with a raw body capture middleware
 * that stores the raw request body in req.rawBody. Re-stringifying parsed JSON
 * will NOT work because JSON.stringify may produce different key ordering,
 * causing signature mismatches.
 */
function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-webhook-signature'];

  if (!signature) {
    console.warn('Webhook rejected: Missing X-Webhook-Signature header');
    return res.status(401).json({ error: 'Missing X-Webhook-Signature header' });
  }

  // Use server's configured WEBHOOK_SECRET to verify
  const serverSecret = process.env.WEBHOOK_SECRET;
  if (!serverSecret) {
    console.error('WEBHOOK_SECRET env var not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // Use the raw body string (captured before JSON parsing) for signature verification
  // This ensures the signature matches exactly what the sender signed
  const bodyToVerify = req.rawBody;
  if (!bodyToVerify || typeof bodyToVerify !== 'string') {
    console.error('Webhook rejected: raw body not available or not a string. Current type:', typeof bodyToVerify);
    return res.status(500).json({ error: 'Server configuration error: raw body unavailable' });
  }

  // Verify HMAC signature with timing-safe comparison
  // bodyToVerify is a string, which is what we need
  const expectedSignature = crypto
    .createHmac('sha256', serverSecret)
    .update(bodyToVerify)
    .digest('hex');

  const providedSignature = signature.replace('sha256=', '');

  const providedBuffer = Buffer.from(providedSignature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    console.warn(`Webhook rejected: signature mismatch.`);
    console.warn(`  Expected (first 16 chars): ${expectedSignature.slice(0, 16)}...`);
    console.warn(`  Provided (first 16 chars): ${providedSignature.slice(0, 16)}...`);
    console.warn(`  Body length: ${bodyToVerify.length}`);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  console.log('✅ Webhook signature verified successfully');
  next();
}

module.exports = { verifyWebhookSignature };
