const crypto = require('crypto');

/**
 * Middleware to verify webhook HMAC-SHA256 signature.
 * The sender signs the payload with WEBHOOK_SECRET and sends the signature
 * in the X-Webhook-Signature header. The server verifies using its own
 * WEBHOOK_SECRET env var — the secret is NOT sent in the request.
 */
function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-webhook-signature'];

  if (!signature) {
    return res.status(401).json({ error: 'Missing X-Webhook-Signature header' });
  }

  // Use server's configured WEBHOOK_SECRET to verify
  const serverSecret = process.env.WEBHOOK_SECRET;
  if (!serverSecret) {
    console.error('WEBHOOK_SECRET env var not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // Verify HMAC signature with length check
  const expectedSignature = crypto
    .createHmac('sha256', serverSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  const providedSignature = signature.replace('sha256=', '');

  const providedBuffer = Buffer.from(providedSignature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

module.exports = { verifyWebhookSignature };
