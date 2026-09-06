const rateLimit = require('express-rate-limit');

// Rate limiter specifically for login attempts
const loginLimiter = rateLimit({
  windowMs: (parseInt(process.env.LOGIN_LIMIT_WINDOW_MINS, 10) || 15) * 60 * 1000,
  max: parseInt(process.env.LOGIN_LIMIT_MAX, 10) || 5,
  requestPropertyName: 'rateLimit',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
  handler: (req, res, next, options) => {
    const defaultWindowMs = (parseInt(process.env.LOGIN_LIMIT_WINDOW_MINS, 10) || 15) * 60 * 1000;
    const resetTime = req.rateLimit ? req.rateLimit.resetTime : new Date(Date.now() + defaultWindowMs);
    const retryAfter = Math.max(0, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
    res.status(429).json({
      error: options.message.error || 'Too many login attempts. Please try again later.',
      retryAfter: retryAfter
    });
  }
});

// General rate limiter for all API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.API_LIMIT_MAX, 10) || 300,
  skip: (req) => req.method === 'OPTIONS',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// Rate limiter for webhook endpoints (stricter — external calls only)
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many webhook requests. Please slow down.' },
});

module.exports = { loginLimiter, apiLimiter, webhookLimiter };
