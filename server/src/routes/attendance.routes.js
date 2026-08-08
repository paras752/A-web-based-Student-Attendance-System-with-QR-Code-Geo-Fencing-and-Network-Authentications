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
    // Bounded, not just numeric. An out-of-range pair (lat 999) is not a real position, and
    // letting it through means the haversine call downstream computes a distance from a
    // point that does not exist rather than the request being rejected as malformed.
    body('coordinates.lat')
      .isFloat({ min: -90, max: 90 })
      .withMessage('coordinates.lat must be a latitude between -90 and 90'),
    body('coordinates.lng')
      .isFloat({ min: -180, max: 180 })
      .withMessage('coordinates.lng must be a longitude between -180 and 180'),
  ],
  validate,
  attendanceController.verify
);

router.get('/history', roleGuard('student'), attendanceController.history);
router.get('/summary', roleGuard('student'), attendanceController.summary);

router.get('/reports', roleGuard('teacher', 'admin'), reportController.courseReport);

module.exports = router;
