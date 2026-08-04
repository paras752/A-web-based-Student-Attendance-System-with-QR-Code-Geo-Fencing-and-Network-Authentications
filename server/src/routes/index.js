const { Router } = require('express');
const authRoutes = require('./auth.routes');
const courseRoutes = require('./course.routes');
const sessionRoutes = require('./session.routes');
const attendanceRoutes = require('./attendance.routes');
const adminRoutes = require('./admin.routes');

const router = Router();

router.use('/auth', authRoutes);
router.use('/courses', courseRoutes);
router.use('/sessions', sessionRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
