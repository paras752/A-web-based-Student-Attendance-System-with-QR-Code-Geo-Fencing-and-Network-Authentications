const { Router } = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/auth.controller');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');

const router = Router();

router.post(
  '/register',
  authLimiter,
  [
    body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Name is required'),
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
    body('role').isIn(['student', 'teacher']).withMessage('Role must be student or teacher'),
  ],
  validate,
  authController.register
);

router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  authController.login
);

router.post('/refresh', authController.refresh);

router.post('/logout', authController.logout);

router.get('/me', requireAuth, authController.me);

module.exports = router;
