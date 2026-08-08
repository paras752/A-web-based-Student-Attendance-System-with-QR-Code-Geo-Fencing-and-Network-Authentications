const pool = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');

async function createCourse({ courseName, courseCode, teacherId, creditHours }) {
  const [existing] = await pool.query('SELECT id FROM courses WHERE course_code = ?', [
    courseCode,
  ]);
  if (existing.length > 0) {
    throw new ApiError(409, 'A course with this code already exists');
  }

  // An admin picks the owner from a request body, so this is the one path where teacher_id
  // is caller-supplied. The foreign key now rejects a non-teacher outright, but it would
  // surface as an opaque 500; checking here turns it into an answer the UI can show.
  if (teacherId) {
    const [teacherRows] = await pool.query('SELECT user_id FROM teachers WHERE user_id = ?', [
      teacherId,
    ]);
    if (teacherRows.length === 0) {
      throw new ApiError(400, 'That user is not a teacher, so they cannot own a course');
    }
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

// The full institutional catalogue. Used by staff when building a roster - it is NOT a
// self-service menu for students, who see only what they are enrolled in via
// listCoursesForUser.
async function listAllCourses() {
  const [rows] = await pool.query(
    `SELECT c.id, c.course_name, c.course_code, c.credit_hours, c.teacher_id, u.name AS teacher_name
     FROM courses c LEFT JOIN users u ON u.id = c.teacher_id
     ORDER BY c.course_name`
  );
  return rows;
}

// Enrolment is a registrar's decision, not a student's. It decides who appears on a
// teacher's roster and in the attendance report a college acts on, so a student who could
// enrol themselves could insert themselves into the official record of a class they are not
// registered for - and, just as damaging, quietly inflate their own attendance denominator.
async function enrolStudent({ courseId, studentId }) {
  await getCourseById(courseId);
  const [studentRows] = await pool.query('SELECT user_id FROM students WHERE user_id = ?', [
    studentId,
  ]);
  if (studentRows.length === 0) {
    throw new ApiError(404, 'That user is not a student');
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

// Removing an enrolment leaves any attendance already recorded in place: the check-in
// happened, and deleting the evidence because the roster changed would be rewriting history.
// Reports iterate the current roster, so the student simply stops appearing.
async function unenrolStudent({ courseId, studentId }) {
  const [result] = await pool.query(
    'DELETE FROM enrolments WHERE course_id = ? AND student_id = ?',
    [courseId, studentId]
  );
  if (result.affectedRows === 0) {
    throw new ApiError(404, 'That student is not enrolled in this course');
  }
  return { courseId, studentId };
}

async function listRoster(courseId) {
  await getCourseById(courseId);
  const [rows] = await pool.query(
    `SELECT u.id AS student_id, u.name, u.email, s.student_number, s.program, s.semester, s.section,
            e.enrolment_date
     FROM enrolments e
     JOIN users u ON u.id = e.student_id
     JOIN students s ON s.user_id = u.id
     WHERE e.course_id = ?
     ORDER BY s.student_number`,
    [courseId]
  );
  return rows;
}

// Students not yet on this course's roster, for the "add student" picker.
async function listEnrollableStudents(courseId) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, s.student_number, s.program, s.semester, s.section
     FROM users u
     JOIN students s ON s.user_id = u.id
     WHERE u.role = 'student'
       AND u.id NOT IN (SELECT student_id FROM enrolments WHERE course_id = ?)
     ORDER BY s.student_number`,
    [courseId]
  );
  return rows;
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
  unenrolStudent,
  listRoster,
  listEnrollableStudents,
  assertTeacherOwnsCourse,
};
