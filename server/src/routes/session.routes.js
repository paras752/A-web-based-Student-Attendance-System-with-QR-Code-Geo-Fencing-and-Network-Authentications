const { Router } = require('express');
const { body } = require('express-validator');
const sessionController = require('../controllers/session.controller');
const { requireAuth } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const { validate } = require('../middleware/validate');

const router = Router();

router.use(requireAuth);

router.get('/active', roleGuard('student'), sessionController.activeForStudent);

router.post(
  '/',
  roleGuard('teacher'),
  [
    body('courseId').isInt().withMessage('courseId is required'),
    body('geofenceLat').isFloat({ min: -90, max: 90 }).withMessage('geofenceLat must be a valid latitude'),
    body('geofenceLng').isFloat({ min: -180, max: 180 }).withMessage('geofenceLng must be a valid longitude'),
    body('geofenceRadiusM')
      .optional()
      .isInt({ min: 5, max: 2000 })
      .withMessage('geofenceRadiusM must be between 5 and 2000 metres'),
    body('authorisedSubnet')
      .optional()
      .matches(/^(any|(\d{1,3}\.){3}\d{1,3}(\/(3[0-2]|[12]?\d))?)$/i)
      .withMessage('authorisedSubnet must be "any" or a CIDR range like 192.168.1.0/24'),
    body('authorisedSsid').optional().trim().isLength({ max: 64 }).withMessage('authorisedSsid is too long'),
    body('startTime').isISO8601().withMessage('startTime must be an ISO date'),
    body('endTime')
      .isISO8601()
      .withMessage('endTime must be an ISO date')
      .custom((value, { req }) => new Date(value) > new Date(req.body.startTime))
      .withMessage('endTime must be after startTime'),
  ],
  validate,
  sessionController.create
);

router.get('/:id/qr', roleGuard('teacher'), sessionController.getQr);
router.patch('/:id/end', roleGuard('teacher'), sessionController.end);
router.get('/:id/live', roleGuard('teacher'), sessionController.live);

module.exports = router;
