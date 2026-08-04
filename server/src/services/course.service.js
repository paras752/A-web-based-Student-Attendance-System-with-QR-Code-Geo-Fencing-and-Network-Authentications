const pool = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');

async function createCourse({ courseName, courseCode, teacherId, creditHours }) {
  const [existing] = await pool.query('SELECT id FROM courses WHERE course_code = ?', [
    courseCode,
  ]);
  if (existing.length > 0) {
    throw new ApiError(409, 'A course with this code already exists');
  }

  const [result] = await pool.query(
    'INSERT INTO courses (course_name, course_code, teacher_id, credit_hours) VALUES (?, ?, ?, ?)',
    [courseName, courseCode, teacherId, creditHours || 3]
  );
  return getCourseById(result.insertId);
}

async function getCourseById(courseId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.course_name, c.course_code, c.credit_hours, c.teacher_id,
            u.name AS teacher_name
     FROM courses c
     LEFT JOIN users u ON u.id = c.teacher_id
     WHERE c.id = ?`,
    [courseId]
  );
  const course = rows[0];
  if (!course) throw new ApiError(404, 'Course not found');
  return course;
}

// Admin sees every course; a teacher sees their own; a student sees courses they're enrolled in.
async function listCoursesForUser(user) {
  if (user.role === 'admin') {
    const [rows] = await pool.query(
      `SELECT c.id, c.course_name, c.course_code, c.credit_hours, c.teacher_id, u.name AS teacher_name
       FROM courses c LEFT JOIN users u ON u.id = c.teacher_id
       ORDER BY c.course_name`
    );
    return rows;
  }
  if (user.role === 'teacher') {
    const [rows] = await pool.query(
      `SELECT c.id, c.course_name, c.course_code, c.credit_hours, c.teacher_id, u.name AS teacher_name
       FROM courses c LEFT JOIN users u ON u.id = c.teacher_id
       WHERE c.teacher_id = ? ORDER BY c.course_name`,
      [user.id]
    );
    return rows;
  }
  const [rows] = await pool.query(
    `SELECT c.id, c.course_name, c.course_code, c.credit_hours, c.teacher_id, u.name AS teacher_name
     FROM courses c
     JOIN enrolments e ON e.course_id = c.id
     LEFT JOIN users u ON u.id = c.teacher_id
     WHERE e.student_id = ? ORDER BY c.course_name`,
    [user.id]
  );
  return rows;
}

// Lets a student browse every course in the institution so they can self-enrol; separate
// from listCoursesForUser, which scopes a student's results to courses already enrolled in.
async function listAllCourses() {
  const [rows] = await pool.query(
    `SELECT c.id, c.course_name, c.course_code, c.credit_hours, c.teacher_id, u.name AS teacher_name
     FROM courses c LEFT JOIN users u ON u.id = c.teacher_id
     ORDER BY c.course_name`
  );
  return rows;
}

async function enrolStudent({ courseId, studentId }) {
  await getCourseById(courseId);
  const [studentRows] = await pool.query('SELECT user_id FROM students WHERE user_id = ?', [
    studentId,
  ]);
  if (studentRows.length === 0) {
    throw new ApiError(404, 'Student not found');
  }
  try {
    await pool.query('INSERT INTO enrolments (student_id, course_id) VALUES (?, ?)', [
      studentId,
      courseId,
    ]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new ApiError(409, 'Student is already enrolled in this course');
    }
    throw err;
  }
  return { courseId, studentId };
}

async function assertTeacherOwnsCourse(courseId, teacherId) {
  const course = await getCourseById(courseId);
  if (course.teacher_id !== teacherId) {
    throw new ApiError(403, 'You do not own this course');
  }
  return course;
}

module.exports = {
  createCourse,
  getCourseById,
  listCoursesForUser,
  listAllCourses,
  enrolStudent,
  assertTeacherOwnsCourse,
};
