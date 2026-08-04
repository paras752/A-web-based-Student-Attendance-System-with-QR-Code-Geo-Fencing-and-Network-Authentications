const asyncHandler = require('../utils/asyncHandler');
const courseService = require('../services/course.service');
const sessionService = require('../services/session.service');

const list = asyncHandler(async (req, res) => {
  const courses = await courseService.listCoursesForUser(req.user);
  res.json({ courses });
});

const listAll = asyncHandler(async (req, res) => {
  const courses = await courseService.listAllCourses();
  res.json({ courses });
});

const create = asyncHandler(async (req, res) => {
  const { courseName, courseCode, creditHours, teacherId } = req.body;
  // Admins may assign any teacher; a teacher creating their own course is auto-assigned.
  const resolvedTeacherId = req.user.role === 'admin' ? teacherId : req.user.id;
  const course = await courseService.createCourse({
    courseName,
    courseCode,
    teacherId: resolvedTeacherId,
    creditHours,
  });
  res.status(201).json({ course });
});

const enrol = asyncHandler(async (req, res) => {
  const courseId = Number(req.params.id);
  const studentId = req.user.role === 'student' ? req.user.id : req.body.studentId;
  const result = await courseService.enrolStudent({ courseId, studentId });
  res.status(201).json({ enrolment: result });
});

const listSessions = asyncHandler(async (req, res) => {
  const courseId = Number(req.params.id);
  const sessions = await sessionService.listSessionsForCourse(courseId, req.user.id, req.user);
  res.json({ sessions });
});

module.exports = { list, listAll, create, enrol, listSessions };
