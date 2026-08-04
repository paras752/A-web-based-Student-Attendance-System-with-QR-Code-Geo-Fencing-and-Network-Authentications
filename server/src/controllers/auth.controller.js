const asyncHandler = require('../utils/asyncHandler');
const authService = require('../services/auth.service');

const REFRESH_COOKIE_NAME = 'ssas_refresh';
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// Refresh token is delivered as an httpOnly cookie (never readable by client JS) so an
// XSS bug can't exfiltrate it; only the short-lived access token goes into the JSON body
// for the SPA to hold in memory (Section 2.6).
function sendTokenPair(res, result) {
  res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, REFRESH_COOKIE_OPTS);
  res.json({ accessToken: result.accessToken, user: result.user });
}

const register = asyncHandler(async (req, res) => {
  const { name, email, password, role, profile } = req.body;
  const user = await authService.register({ name, email, password, role, profile });
  res.status(201).json({ user });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login({ email, password });
  sendTokenPair(res, result);
});

const refresh = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
  const result = await authService.refresh({ refreshToken });
  sendTokenPair(res, result);
});

const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
  await authService.logout({ refreshToken });
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
  res.status(204).send();
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.getProfile(req.user.id);
  res.status(200).json({ user });
});

module.exports = { register, login, refresh, logout, me };
