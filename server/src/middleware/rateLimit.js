const rateLimit = require('express-rate-limit');

// Applied to auth and attendance-submission endpoints per Section 3.2.7's security architecture.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts. Please try again later.' } },
});

const attendanceLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many attendance submissions. Please slow down.' } },
});

module.exports = { authLimiter, attendanceLimiter };
