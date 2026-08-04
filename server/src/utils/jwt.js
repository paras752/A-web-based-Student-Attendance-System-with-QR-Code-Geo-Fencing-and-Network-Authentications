const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');

// Section 3.2.1 / 4.9.1: short-lived HMAC-SHA256 access token carrying userId + role,
// plus a longer-lived refresh token whose hash is stored server-side so it can be revoked.
function signAccessToken(user) {
  return jwt.sign({ userId: user.id, role: user.role }, env.jwt.accessSecret, {
    algorithm: 'HS256',
    expiresIn: env.jwt.accessExpiresIn,
    issuer: 'ssas',
    audience: 'ssas-client',
  });
}

function signRefreshToken(user) {
  return jwt.sign({ userId: user.id }, env.jwt.refreshSecret, {
    algorithm: 'HS256',
    expiresIn: env.jwt.refreshExpiresIn,
    issuer: 'ssas',
    audience: 'ssas-client',
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret, {
    algorithms: ['HS256'],
    issuer: 'ssas',
    audience: 'ssas-client',
  });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret, {
    algorithms: ['HS256'],
    issuer: 'ssas',
    audience: 'ssas-client',
  });
}

// Refresh tokens are stored hashed (never in plaintext) so a leaked DB dump can't be replayed.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
};
