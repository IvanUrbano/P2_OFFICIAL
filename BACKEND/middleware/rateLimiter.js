const rateLimit = require('express-rate-limit');

// Rate limiter specifically for login attempts
const loginLimiter = rateLimit({
  // Read window in minutes from env, fallback to 15 minutes
  windowMs: (parseInt(process.env.LOGIN_LIMIT_WINDOW_MINS, 10) || 15) * 60 * 1000,
  
  // Read max attempts from env, fallback to 5
  max: parseInt(process.env.LOGIN_LIMIT_MAX, 10) || 5,
  
  requestPropertyName: 'rateLimit',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  
  // Custom message
  message: { error: 'Too many login attempts. Please try again later.' },
  
  // Custom handler to return retryAfter in seconds to the client
  handler: (req, res, next, options) => {
    const defaultWindowMs = (parseInt(process.env.LOGIN_LIMIT_WINDOW_MINS, 10) || 15) * 60 * 1000;
    const resetTime = req.rateLimit ? req.rateLimit.resetTime : new Date(Date.now() + defaultWindowMs);
    const retryAfter = Math.max(0, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
    
    res.status(429).json({
      error: options.message.error || 'Too many login attempts. Please try again later.',
      retryAfter: retryAfter // in seconds
    });
  }
});

module.exports = { loginLimiter };
