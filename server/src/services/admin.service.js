const pool = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');

async function listUsers({ role } = {}) {
  const params = [];
  let where = '';
  if (role) {
    where = 'WHERE role = ?';
    params.push(role);
  }
  const [rows] = await pool.query(
    `SELECT id, name, email, role, created_at FROM users ${where} ORDER BY created_at DESC`,
    params
  );
  return rows;
}

async function deleteUser(userId) {
  const [result] = await pool.query('DELETE FROM users WHERE id = ?', [userId]);
  if (result.affectedRows === 0) {
    throw new ApiError(404, 'User not found');
  }
}

async function getAnalytics() {
  const [[userCounts]] = await pool.query(
    `SELECT
       SUM(role = 'student') AS students,
       SUM(role = 'teacher') AS teachers,
       SUM(role = 'admin')   AS admins
     FROM users`
  );

  const [[courseCounts]] = await pool.query('SELECT COUNT(*) AS totalCourses FROM courses');
  const [[sessionCounts]] = await pool.query(
    `SELECT COUNT(*) AS totalSessions,
            SUM(is_active = 1 AND NOW() BETWEEN start_time AND end_time) AS activeSessions
     FROM sessions`
  );
  const [[attendanceCounts]] = await pool.query(
    'SELECT COUNT(*) AS totalAttendanceRecords FROM attendance_records'
  );

  const [topCourses] = await pool.query(
    `SELECT c.course_name, c.course_code, COUNT(ar.id) AS attendanceCount
     FROM courses c
     LEFT JOIN sessions s ON s.course_id = c.id
     LEFT JOIN attendance_records ar ON ar.session_id = s.id
     GROUP BY c.id
     ORDER BY attendanceCount DESC
     LIMIT 5`
  );

  return {
    users: {
      students: Number(userCounts.students || 0),
      teachers: Number(userCounts.teachers || 0),
      admins: Number(userCounts.admins || 0),
    },
    totalCourses: courseCounts.totalCourses,
    totalSessions: sessionCounts.totalSessions,
    activeSessions: Number(sessionCounts.activeSessions || 0),
    totalAttendanceRecords: attendanceCounts.totalAttendanceRecords,
    topCourses,
  };
}

module.exports = { listUsers, deleteUser, getAnalytics };
