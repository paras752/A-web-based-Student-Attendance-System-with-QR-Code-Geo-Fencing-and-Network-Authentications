const { Router } = require('express');
const { body } = require('express-validator');
const courseController = require('../controllers/course.controller');
const { requireAuth } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const { validate } = require('../middleware/validate');

const router = Router();

router.use(requireAuth);

router.get('/', courseController.list);

// Staff only. This is the full institutional catalogue; exposing it to students was what
// made self-enrolment possible in the first place.
router.get('/all', roleGuard('teacher', 'admin'), courseController.listAll);

router.post(
  '/',
  roleGuard('teacher', 'admin'),
  [
    body('courseName').trim().notEmpty().withMessage('courseName is required'),
    body('courseCode').trim().notEmpty().withMessage('courseCode is required'),
  ],
  validate,
  courseController.create
);

// Roster management. 'student' is deliberately absent from every guard below: enrolment
// decides who appears in the official attendance report, so it belongs to the registrar and
// the course's own teacher, never to the person being enrolled.
router.get('/:id/roster', roleGuard('teacher', 'admin'), courseController.roster);

router.post(
  '/:id/enrol',
  roleGuard('teacher', 'admin'),
  [body('studentId').isInt({ min: 1 }).withMessage('studentId is required')],
  validate,
  courseController.enrol
);

router.delete('/:id/enrol/:studentId', roleGuard('teacher', 'admin'), courseController.unenrol);

router.get('/:id/sessions', roleGuard('teacher', 'admin'), courseController.listSessions);

module.exports = router;
