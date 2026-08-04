const { Router } = require('express');
const { body } = require('express-validator');
const courseController = require('../controllers/course.controller');
const { requireAuth } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const { validate } = require('../middleware/validate');

const router = Router();

router.use(requireAuth);

router.get('/', courseController.list);
router.get('/all', courseController.listAll);

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

router.post(
  '/:id/enrol',
  roleGuard('student', 'admin'),
  courseController.enrol
);

router.get('/:id/sessions', roleGuard('teacher', 'admin'), courseController.listSessions);

module.exports = router;
