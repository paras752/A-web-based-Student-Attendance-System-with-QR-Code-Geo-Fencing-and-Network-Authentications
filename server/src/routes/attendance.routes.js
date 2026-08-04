const { Router } = require('express');
const { body } = require('express-validator');
const attendanceController = require('../controllers/attendance.controller');
const reportController = require('../controllers/report.controller');
const { requireAuth } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const { validate } = require('../middleware/validate');
const { attendanceLimiter } = require('../middleware/rateLimit');

const router = Router();

router.use(requireAuth);

router.post(
  '/verify',
  roleGuard('student'),
  attendanceLimiter,
  [
    body('qrPayload').isObject().withMessage('qrPayload is required'),
    body('coordinates.lat').isFloat().withMessage('coordinates.lat is required'),
    body('coordinates.lng').isFloat().withMessage('coordinates.lng is required'),
  ],
  validate,
  attendanceController.verify
);

router.get('/history', roleGuard('student'), attendanceController.history);

router.get('/reports', roleGuard('teacher', 'admin'), reportController.courseReport);

module.exports = router;
