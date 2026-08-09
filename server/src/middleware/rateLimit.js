const rateLimit = require('express-rate-limit');

// Applied to auth and attendance-submission endpoints per Section 3.2.7's security architecture.
//
// Both limiters key on the *account*, not the source IP. Keying on IP is the library default
// and is wrong for this system specifically: the network factor requires students to be on the
// institutional subnet, so an entire lecture theatre arrives through the campus NAT as one or
// two source addresses. An IP bucket is therefore shared by the whole class, and a cohort
// checking in at the start of a lecture - exactly the load this system is built for - would
// throttle itself. The limit exists to stop one account hammering the endpoint, and that is
// what it now measures.

function accountKey(req, fallbackSuffix = '') {
  if (req.user?.id) return `user:${req.user.id}`;
  // Unauthenticated: bucket per (address, identifier) so one account being attacked cannot
  // lock out every other person behind the same NAT.
  return `ip:${req.ip}|${fallbackSuffix}`;
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const identifier = String(req.body?.identifier || req.body?.email || '').trim().toLowerCase();
    return accountKey(req, identifier);
  },
  message: { error: { message: 'Too many attempts. Please try again later.' } },
});

const attendanceLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // requireAuth runs ahead of this on /attendance/verify, so req.user is always populated
  // and the unauthenticated branch is unreachable in practice.
  keyGenerator: (req) => accountKey(req),
  message: { error: { message: 'Too many attendance submissions. Please slow down.' } },
});

module.exports = { authLimiter, attendanceLimiter };
