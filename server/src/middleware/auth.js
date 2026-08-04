const { verifyAccessToken } = require('../utils/jwt');
const { ApiError } = require('./errorHandler');

// Verifies signature, issuer, audience, and expiry before a request reaches any controller
// (Section 3.2.1: "accepting a token without full verification is a leading cause of
// real-world JWT vulnerabilities"). Tokens are read only from the Authorization: Bearer header.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'Missing or malformed Authorization header'));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.userId, role: payload.role };
    return next();
  } catch (err) {
    return next(new ApiError(401, 'Invalid or expired access token'));
  }
}

module.exports = { requireAuth };
