const { Router } = require('express');
const { body } = require('express-validator');
const adminController = require('../controllers/admin.controller');
const { requireAuth } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const { validate } = require('../middleware/validate');

const router = Router();

router.use(requireAuth, roleGuard('admin'));

router.get('/users', adminController.listUsers);
router.get('/users/:id', adminController.getUser);

// The only route that can mint a teacher or admin account. Public /auth/register is pinned
// to 'student', so staff privileges always originate from an authenticated admin here.
router.post(
  '/users',
  [
    body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Name is required'),
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('role').isIn(['student', 'teacher', 'admin']).withMessage('Role must be student, teacher or admin'),
  ],
  validate,
  adminController.createUser
);

// Bulk student provisioning. Capped so a runaway paste cannot tie the server up hashing
// passwords - bcrypt at 12 rounds is ~100ms each by design.
router.post(
  '/students/import',
  [
    body('students').isArray({ min: 1, max: 500 }).withMessage('Provide between 1 and 500 students'),
  ],
  validate,
  adminController.importStudents
);

router.patch(
  '/users/:id/role',
  [body('role').isIn(['student', 'teacher', 'admin']).withMessage('Role must be student, teacher or admin')],
  validate,
  adminController.changeUserRole
);

// The only route that can correct a user's name, email or academic details. These used to be
// self-service on PATCH /auth/me, which meant a student could rename themselves - and
// rosters and reports identify students by name.
router.patch(
  '/users/:id/profile',
  [
    body('name').optional().trim().isLength({ min: 2, max: 120 }).withMessage('Name is too short'),
    body('email').optional().isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('profile.program').optional({ nullable: true }).trim().isLength({ max: 100 }),
    body('profile.semester').optional({ nullable: true }).trim().isLength({ max: 20 }),
    body('profile.section').optional({ nullable: true }).trim().isLength({ max: 20 }),
    body('profile.department').optional({ nullable: true }).trim().isLength({ max: 100 }),
    body('profile.designation').optional({ nullable: true }).trim().isLength({ max: 100 }),
  ],
  validate,
  adminController.updateUserProfile
);

// Correcting a student's college ID. The '@' exclusion is not cosmetic: login resolves an
// identifier against email OR student_number, so a student number containing '@' could be
// made to collide with somebody's email address and make sign-in ambiguous.
router.patch(
  '/users/:id/student-number',
  [
    body('studentNumber')
      .trim()
      .isLength({ min: 1, max: 40 })
      .withMessage('A college ID is required (max 40 characters)')
      .matches(/^[A-Za-z0-9._-]+$/)
      .withMessage('A college ID may only contain letters, numbers, dots, dashes and underscores'),
  ],
  validate,
  adminController.setStudentNumber
);

// Password recovery path for a system with no mail server: the admin issues a temporary
// password and passes it to the user directly.
router.post(
  '/users/:id/reset-password',
  [body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')],
  validate,
  adminController.resetUserPassword
);

router.delete('/users/:id', adminController.deleteUser);
router.get('/analytics', adminController.analytics);

module.exports = router;
