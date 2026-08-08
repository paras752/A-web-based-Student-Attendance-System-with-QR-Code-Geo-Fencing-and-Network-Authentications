const { Router } = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/auth.controller');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const env = require('../config/env');
const { ApiError } = require('../middleware/errorHandler');

const router = Router();

// Runs before validation on purpose. A closed endpoint should answer "closed" whatever you
// send it: with the checks the other way round, a probe posting role=admin got 400 "only
// student accounts can be created here" - which describes a rule that does not apply,
// implies the endpoint is open, and lets the caller distinguish payload shapes on a route
// that is not accepting any payload at all.
function registrationOpen(req, res, next) {
  if (!env.allowPublicRegistration) {
    return next(
      new ApiError(
        403,
        "Accounts are issued by your institution. Sign in with the student ID and password you were given, or contact your administrator."
      )
    );
  }
  return next();
}

router.post(
  '/register',
  authLimiter,
  registrationOpen,
  [
    body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Name is required'),
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
    // Self-service signup creates students and nothing else. A teacher account can create
    // courses and sessions - including setting the geofence radius and authorised subnet
    // that the attendance checks are measured against - so letting anyone mint one from the
    // public form would hand an ordinary student staff-level control over attendance data.
    // Staff accounts are provisioned by an admin via POST /admin/users instead.
    body('role')
      .optional()
      .equals('student')
      .withMessage('Only student accounts can be created here; ask an admin for a staff account'),
  ],
  validate,
  authController.register
);

router.post(
  '/login',
  authLimiter,
  [
    // Accepts either an email or a college-issued student number, so it cannot be validated
    // as an email. normalizeEmail() is deliberately not applied either: it lowercases and
    // rewrites the value, which would corrupt a case-sensitive student number.
    body('identifier')
      .optional()
      .trim()
      .isLength({ min: 1, max: 190 })
      .withMessage('Enter your student ID or email'),
    body('email').optional().trim().isLength({ min: 1, max: 190 }),
    body().custom((value) => {
      if (!value.identifier && !value.email) {
        throw new Error('Enter your student ID or email');
      }
      return true;
    }),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  authController.login
);

// Public: lets the login screen show a real network status instead of a decorative badge.
router.get('/status', authController.status);

router.post('/refresh', authController.refresh);

router.post('/logout', authController.logout);

router.get('/me', requireAuth, authController.me);

// There is no PATCH /me. Name, email, programme, semester and section are institutional
// facts that attendance reports are read against, so they are corrected by an admin via
// PATCH /admin/users/:id/profile - never by the person they describe.

router.post(
  '/me/password',
  requireAuth,
  authLimiter,
  [
    body('currentPassword').notEmpty().withMessage('Your current password is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters'),
  ],
  validate,
  authController.changePassword
);

module.exports = router;
