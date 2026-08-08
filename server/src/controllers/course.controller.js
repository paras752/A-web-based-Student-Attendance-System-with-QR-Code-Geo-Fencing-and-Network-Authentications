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

// A teacher may only manage the roster of a course they own; an admin may manage any. The
// student's own id is never used here - the route guard keeps students out entirely, so
// there is no path by which a caller enrols themselves.
async function assertMayManageRoster(user, courseId) {
  if (user.role === 'teacher') {
    await courseService.assertTeacherOwnsCourse(courseId, user.id);
  }
}

const enrol = asyncHandler(async (req, res) => {
  const courseId = Number(req.params.id);
  await assertMayManageRoster(req.user, courseId);
  const result = await courseService.enrolStudent({
    courseId,
    studentId: Number(req.body.studentId),
  });
  res.status(201).json({ enrolment: result });
});

const unenrol = asyncHandler(async (req, res) => {
  const courseId = Number(req.params.id);
  await assertMayManageRoster(req.user, courseId);
  await courseService.unenrolStudent({ courseId, studentId: Number(req.params.studentId) });
  res.status(204).send();
});

const roster = asyncHandler(async (req, res) => {
  const courseId = Number(req.params.id);
  await assertMayManageRoster(req.user, courseId);
  const [enrolled, enrollable] = await Promise.all([
    courseService.listRoster(courseId),
    courseService.listEnrollableStudents(courseId),
  ]);
  res.json({ enrolled, enrollable });
});

const listSessions = asyncHandler(async (req, res) => {
  const courseId = Number(req.params.id);
  const sessions = await sessionService.listSessionsForCourse(courseId, req.user.id, req.user);
  res.json({ sessions });
});

module.exports = { list, listAll, create, enrol, unenrol, roster, listSessions };
