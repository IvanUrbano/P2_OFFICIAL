const crypto = require('crypto');

/**
 * Middleware to verify webhook HMAC-SHA256 signature.
 * Checks that the secret matches WEBHOOK_SECRET and the signature is valid.
 */
function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-webhook-signature'];
  const secret = req.headers['x-webhook-secret'];

  if (!signature || !secret) {
    return res.status(401).json({ error: 'Missing webhook credentials' });
  }

  // Verify secret matches server's configured secret
  const serverSecret = process.env.WEBHOOK_SECRET;
  if (!serverSecret || secret !== serverSecret) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  // Verify HMAC signature with length check
  const expectedSignature = crypto
    .createHmac('sha256', secret)
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
