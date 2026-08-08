const asyncHandler = require('../utils/asyncHandler');
const authService = require('../services/auth.service');
const env = require('../config/env');
const { isIpInSubnet, normaliseIp } = require('../utils/subnet');

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

// Student accounts belong to the institution, not to whoever can reach the sign-up form: the
// student number on the account is what attendance records and reports are keyed against, so
// an account the college did not issue corresponds to no real enrolled person. With
// provisioning on (the default) students are created by an admin and this endpoint is closed
// by the registrationOpen guard in auth.routes, which runs ahead of validation so the refusal
// does not depend on the shape of the body. ALLOW_PUBLIC_REGISTRATION=true reopens it.
const register = asyncHandler(async (req, res) => {
  const { name, email, password, profile } = req.body;
  // The role is pinned server-side rather than taken from the request: this is the public,
  // unauthenticated endpoint, so a caller must never be able to choose their own privilege
  // level. Staff accounts come from POST /admin/users, which sits behind an admin guard.
  const user = await authService.register({ name, email, password, role: 'student', profile });
  res.status(201).json({ user });
});

const login = asyncHandler(async (req, res) => {
  // `identifier` is the email or student number. `email` is still accepted so an older
  // client (or a saved API call) keeps working.
  const { identifier, email, password } = req.body;
  const result = await authService.login({ identifier: identifier || email, password });
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

// PATCH /auth/me is deliberately gone. Everything it used to write - name, email,
// programme, semester, section - is a fact the institution asserts about a person, not a
// preference they own, and reports and rosters are read against those facts. Corrections go
// through PATCH /admin/users/:id/profile. The one thing a user genuinely owns, their
// password, still has POST /auth/me/password below.

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await authService.changePassword(req.user.id, { currentPassword, newPassword });
  // Changing the password revokes every refresh token, including this browser's, so clear
  // the cookie too rather than leaving one behind that is guaranteed to fail on next use.
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
  res.status(204).send();
});

// Public, unauthenticated probe backing the login screen's status chips. It only reflects
// the caller's own network back at them - it reveals nothing they don't already know about
// themselves, and never says anything about other users or sessions.
const status = asyncHandler(async (req, res) => {
  const onCampusNetwork = isIpInSubnet(req.ip, env.campusSubnet);
  res.json({
    onCampusNetwork,
    clientIp: normaliseIp(req.ip),
    // Advertised so the client can explain *why* it says what it says rather than
    // presenting an unexplained green light.
    enforced: env.campusSubnet.trim().toLowerCase() !== 'any',
    // Lets the sign-in and sign-up screens tell the truth about whether self-service
    // registration exists, instead of offering a link that always 403s.
    allowPublicRegistration: env.allowPublicRegistration,
  });
});

module.exports = { register, login, refresh, logout, me, changePassword, status };
